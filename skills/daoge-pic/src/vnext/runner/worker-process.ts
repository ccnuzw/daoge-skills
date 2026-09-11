import { createImageProvider } from '../providers/http-adapters';
import { StudioGeneratedAssetPersister } from '../media/generated-assets';
import { StudioAssetResolver } from '../media/asset-resolver';
import { GenerationWorker } from './worker';
import { closeStudioDatabase, openStudioDatabase } from '../studio/database';
import { closeProviderDatabase, openProviderDatabase, resolveActiveProviderConfig, resolveProviderProfileConfig } from '../studio/provider-store';
import { attachStudio } from '../studio/workspace';
import { MAX_GLOBAL_CONCURRENCY, MAX_WORKER_BATCH_CONCURRENCY } from '../studio/runtime-settings';
import { DEFAULT_RETRY_POLICY } from './retry-policy';
import { ProviderHealthSample, ProviderOutcome } from '../runtime/provider-concurrency';
import { createId } from '../shared/ids';
import { isProviderId } from '../studio/provider-config';
import type { ResolvedProviderConfig } from '../studio/provider-config';
import type { ProviderDatabase } from '../studio/provider-store';

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '').trim() || null : null;
}
function isProviderConfig(value: unknown): value is ResolvedProviderConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  return typeof config.profileId === 'string' && typeof config.profileName === 'string' && Number.isInteger(config.configVersion) && Number(config.configVersion) > 0 && typeof config.providerId === 'string' && isProviderId(config.providerId) && typeof config.baseUrl === 'string' && typeof config.apiKey === 'string' && typeof config.model === 'string' && Boolean(config.options && typeof config.options === 'object') && typeof config.referenceEnabled === 'boolean' && typeof config.endpointTrustMode === 'string' && Boolean(config.limits && typeof config.limits === 'object') && Number.isInteger(config.descriptorVersion) && typeof config.adapterVersion === 'string';
}

function receiveProviderConfig(): Promise<ResolvedProviderConfig> {
  const { promise, resolve, reject } = Promise.withResolvers<ResolvedProviderConfig>();
  let timeout: NodeJS.Timeout;
  const onMessage = (message: unknown): void => {
    if (!message || typeof message !== 'object' || (message as Record<string, unknown>).type !== 'configure-provider') return;
    clearTimeout(timeout);
    process.removeListener('message', onMessage);
    const config = (message as Record<string, unknown>).config;
    if (!isProviderConfig(config)) reject(new Error('Worker process received an invalid Provider configuration.'));
    else resolve(config);
  };
  timeout = setTimeout(() => {
    process.removeListener('message', onMessage);
    reject(new Error('Worker process did not receive its assigned Provider configuration.'));
  }, 10_000);
  process.on('message', onMessage);
  return promise;
}

function send(message: Record<string, unknown>): void {
  if (process.send) process.send(message);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const workspaceRoot = valueAfter(args, '--workspace');
  if (!workspaceRoot) throw new Error('Worker process requires --workspace.');
  const expectedProfileId = valueAfter(args, '--provider-profile-id');
  const expectedConfigVersionText = valueAfter(args, '--provider-config-version');
  let expectedConfigVersion: number | null = null;
  if (expectedProfileId !== null || expectedConfigVersionText !== null) {
    const parsedVersion = Number(expectedConfigVersionText);
    if (!expectedProfileId || !Number.isInteger(parsedVersion) || parsedVersion < 1) throw new Error('Worker process provider identity is invalid.');
    expectedConfigVersion = parsedVersion;
  }
  const initialized = attachStudio(workspaceRoot);
  const assignedConfig = args.includes('--provider-config-ipc') ? await receiveProviderConfig() : null;
  if (assignedConfig && expectedProfileId !== null && (assignedConfig.profileId !== expectedProfileId || assignedConfig.configVersion !== expectedConfigVersion)) throw new Error('Worker process Provider identity does not match its assigned configuration.');
  const db = openStudioDatabase(initialized.paths, initialized.manifest, { skipIntegrityCheck: true, attachOnly: true });
  let providerDb: ProviderDatabase | null = null;
  const config = assignedConfig || (() => {
    providerDb = openProviderDatabase(initialized.paths, { attachOnly: true });
    return expectedProfileId !== null ? resolveProviderProfileConfig(providerDb, expectedProfileId, initialized.paths) : resolveActiveProviderConfig(providerDb, initialized.paths);
  })();
  if (!config || !config.baseUrl || !config.apiKey || !config.model) throw new Error('Worker process requires an assigned configured Provider.');
  const provider = createImageProvider(config);
  const validation = provider.validateConfig(config);
  if (!validation.valid) throw new Error('Worker Provider configuration is invalid.');
  let providerStats: ProviderHealthSample = { succeeded: 0, rateLimited: 0, transient: 0, unknown: 0, otherFailure: 0, maxRssBytes: 0, maxExternalBytes: 0 };
  const recordProviderOutcome = (outcome: ProviderOutcome): void => {
    if (outcome === 'success') providerStats.succeeded += 1;
    else if (outcome === 'rate_limited') providerStats.rateLimited += 1;
    else if (outcome === 'transient') providerStats.transient += 1;
    else if (outcome === 'unknown') providerStats.unknown += 1;
    else providerStats.otherFailure += 1;
  };
  const worker = new GenerationWorker({
    db,
    workerId: createId('worker_process'),
    provider,
    providerConfig: config,
    assetPersister: new StudioGeneratedAssetPersister({ db, paths: initialized.paths, studioId: initialized.manifest.studioId }),
    assetResolver: new StudioAssetResolver({ db, paths: initialized.paths }),
    manageRetries: false,
    onProviderOutcome: recordProviderOutcome,
    retryPolicy: { ...DEFAULT_RETRY_POLICY, ...(config.limits.maxRetryAttempts ? { maxAttempts: config.limits.maxRetryAttempts } : {}) }
  });
  let busy = false;
  let stopping = false;
  const finalize = (): void => {
    closeStudioDatabase(db);
    closeProviderDatabase(providerDb);
    process.exit(0);
  };
  const shutdown = (): void => {
    if (!stopping) {
      stopping = true;
      worker.shutdown();
    }
    if (!busy) finalize();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('message', (message: { type?: unknown; capacity?: unknown; globalLimit?: unknown }) => {
    if (message?.type === 'shutdown') return shutdown();
    if (message?.type !== 'tick' || busy || stopping) return;
    busy = true;
    providerStats = { succeeded: 0, rateLimited: 0, transient: 0, unknown: 0, otherFailure: 0, maxRssBytes: 0, maxExternalBytes: 0 };
    const capacity = Math.max(1, Math.min(MAX_WORKER_BATCH_CONCURRENCY, Number(message.capacity) || 1));
    const globalLimit = Math.max(1, Math.min(MAX_GLOBAL_CONCURRENCY, Number(message.globalLimit) || capacity));
    void worker.processOnce(capacity, globalLimit).then((result) => {
      const memory = process.memoryUsage();
      providerStats.maxRssBytes = memory.rss;
      providerStats.maxExternalBytes = Math.max(memory.external, memory.arrayBuffers);
      send({ type: 'tick-result', result, providerStats });
    }, (error) => send({ type: 'tick-error', message: error instanceof Error ? error.message : 'worker tick failed' })).finally(() => {
      busy = false;
      if (stopping) finalize();
    });
  });
  send({ type: 'ready', pid: process.pid });
}

void main().catch((error) => {
  send({ type: 'fatal', message: error instanceof Error ? error.message : 'worker process failed' });
  process.stderr.write((error instanceof Error ? error.message : 'Worker process failed.') + '\n');
  process.exitCode = 1;
});
