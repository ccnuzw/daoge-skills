import { createImageProvider } from '../providers/http-adapters';
import { StudioGeneratedAssetPersister } from '../media/generated-assets';
import { StudioAssetResolver } from '../media/asset-resolver';
import { GenerationWorker } from './worker';
import { closeStudioDatabase, openStudioDatabase } from '../studio/database';
import { closeProviderDatabase, openProviderDatabase, providerStatus, resolveActiveProviderConfig } from '../studio/provider-store';
import { initializeStudio } from '../studio/workspace';
import { createId } from '../shared/ids';
import { MAX_ACTIVE_PROVIDER_REQUESTS, MAX_GLOBAL_CONCURRENCY, MAX_WORKER_BATCH_CONCURRENCY } from '../studio/runtime-settings';

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '').trim() || null : null;
}

function send(message: Record<string, unknown>): void {
  if (process.send) process.send(message);
}

async function main(): Promise<void> {
  const workspaceRoot = valueAfter(process.argv.slice(2), '--workspace');
  if (!workspaceRoot) throw new Error('Worker process requires --workspace.');
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest, { skipIntegrityCheck: true });
  const providerDb = openProviderDatabase(initialized.paths);
  const config = resolveActiveProviderConfig(providerDb);
  const status = providerStatus(providerDb);
  if (!config || !status.configured) throw new Error('Worker process requires an active configured Provider.');
  const provider = createImageProvider(config);
  const validation = provider.validateConfig(config);
  if (!validation.valid) throw new Error('Worker Provider configuration is invalid.');
  const worker = new GenerationWorker({
    db,
    workerId: createId('worker_process'),
    provider,
    providerConfig: config,
    assetPersister: new StudioGeneratedAssetPersister({ db, paths: initialized.paths, studioId: initialized.manifest.studioId }),
    assetResolver: new StudioAssetResolver({ db, paths: initialized.paths }),
    manageRetries: false
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
    const capacity = Math.max(1, Math.min(MAX_ACTIVE_PROVIDER_REQUESTS, MAX_WORKER_BATCH_CONCURRENCY, Number(message.capacity) || 1));
    const globalLimit = Math.max(1, Math.min(MAX_ACTIVE_PROVIDER_REQUESTS, MAX_GLOBAL_CONCURRENCY, Number(message.globalLimit) || capacity));
    void worker.processOnce(capacity, globalLimit).then((result) => send({ type: 'tick-result', result }), (error) => send({ type: 'tick-error', message: error instanceof Error ? error.message : 'worker tick failed' })).finally(() => {
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
