import fs from 'node:fs';
import path from 'node:path';
import { LocalStudioService } from '../api/server';
import { createLocalCapability } from '../api/local-auth';
import { StudioGeneratedAssetPersister } from '../media/generated-assets';
import { StudioAssetResolver } from '../media/asset-resolver';
import { createImageProvider } from '../providers/http-adapters';
import { GenerationWorker } from '../runner/worker';
import { promoteDueRetryWaitItems, reconcileTerminalRuns, recoverExpiredLeases } from '../runner/run-commands';
import { recoverStudioStartup } from '../runner/startup-recovery';
import { createId, nowIso } from '../shared/ids';
import { appendStudioEvent, closeStudioDatabase, openStudioDatabase, StudioDatabase } from '../studio/database';
import { loadProviderConfig, providerSnapshot, providerStatus } from '../studio/provider-config';
import { getStudioRuntimeSettings } from '../studio/runtime-settings';
import { initializeStudio } from '../studio/workspace';

export interface StudioDaemonOptions {
  workspaceRoot: string;
  providerTemplatePath: string;
  port?: number;
  pollMs?: number;
}

interface RuntimeRecord {
  pid: number;
  url: string;
  capability: string;
  port: number;
  workspaceRoot: string;
  startedAt: string;
  heartbeatAt: string;
  workerConcurrency: number | null;
  provider: { providerId: string; model: string; endpoint: string | null } | null;
}

function writeAtomically(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function isLivePid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function rememberedPort(portPath: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(portPath, 'utf8')) as { port?: unknown };
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
  } catch {
    return 0;
  }
}

function acquireLock(lockPath: string): void {
  try {
    const descriptor = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, acquiredAt: nowIso() }) + '\n');
    fs.closeSync(descriptor);
    return;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
  }
  try {
    const previous = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: number };
    if (isLivePid(Number(previous.pid))) throw new Error('Studio daemon is already running for this workspace.');
  } catch (error) {
    if (error instanceof Error && error.message === 'Studio daemon is already running for this workspace.') throw error;
  }
  fs.rmSync(lockPath, { force: true });
  const descriptor = fs.openSync(lockPath, 'wx', 0o600);
  fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, acquiredAt: nowIso() }) + '\n');
  fs.closeSync(descriptor);
}

export async function runStudioDaemon(options: StudioDaemonOptions): Promise<void> {
  const initialized = initializeStudio({ workspaceRoot: options.workspaceRoot, providerTemplatePath: options.providerTemplatePath });
  const runtimeDir = initialized.paths.runtimeDir;
  const lockPath = path.join(runtimeDir, 'daemon.lock');
  const runtimePath = path.join(runtimeDir, 'daemon.json');
  const portPath = path.join(runtimeDir, 'daemon.port.json');
  fs.mkdirSync(runtimeDir, { recursive: true });
  acquireLock(lockPath);
  const capability = createLocalCapability();

  let service: LocalStudioService;
  let workerDb: StudioDatabase;
  try {
    service = new LocalStudioService({ workspaceRoot: initialized.paths.workspaceRoot, providerTemplatePath: options.providerTemplatePath, capability });
    workerDb = openStudioDatabase(initialized.paths, initialized.manifest);
    recoverStudioStartup(workerDb, initialized.paths, initialized.manifest.studioId);
  } catch (error) {
    fs.rmSync(lockPath, { force: true });
    throw error;
  }
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let inFlightTick: Promise<void> | null = null;
  let startedUrl = '';
  let activeWorkerConcurrency: number | null = null;
  let activeProvider: { providerId: string; model: string; endpoint: string | null } | null = null;
  const workerId = createId('worker');

  const runtimeRecord = (): RuntimeRecord => ({ pid: process.pid, url: startedUrl, capability, port: Number(new URL(startedUrl).port), workspaceRoot: initialized.paths.workspaceRoot, startedAt: startedAt, heartbeatAt: nowIso(), workerConcurrency: activeWorkerConcurrency, provider: activeProvider });
  const startedAt = nowIso();
  const heartbeat = (): void => { if (startedUrl) writeAtomically(runtimePath, runtimeRecord()); };
  const close = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (inFlightTick) await inFlightTick.catch(() => undefined);
    await service.close();
    closeStudioDatabase(workerDb);
    try {
      const current = JSON.parse(fs.readFileSync(runtimePath, 'utf8')) as { pid?: number };
      if (current.pid === process.pid) fs.rmSync(runtimePath, { force: true });
    } catch { /* no runtime record remains */ }
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: number };
      if (current.pid === process.pid) fs.rmSync(lockPath, { force: true });
    } catch { /* lock is already gone */ }
  };

  try {
    const requestedPort = options.port === 0 ? 0 : options.port || rememberedPort(portPath);
    const started = await service.listen(requestedPort);
    startedUrl = started.url;
    writeAtomically(portPath, { port: Number(new URL(startedUrl).port) });
    const pollMs = Math.max(100, Math.min(5000, options.pollMs || 350));
    // A daemon uses one in-memory Provider identity for its lifetime. Configuration changes require a restart and cannot silently alter an in-flight run.
    const workerConfig = loadProviderConfig(initialized.paths);
    const workerStatus = providerStatus(initialized.paths);
    const runtimeSettings = getStudioRuntimeSettings(workerDb, initialized.manifest.studioId);
    activeWorkerConcurrency = workerStatus.configured ? runtimeSettings.maxWorkerConcurrency : null;
    const workerProvider = workerConfig ? createImageProvider(workerConfig) : null;
    const workerReady = Boolean(workerConfig && workerProvider && workerStatus.configured && workerProvider.validateConfig(workerConfig).valid);
    const workerSnapshot = workerConfig ? providerSnapshot(workerConfig) : null;
    activeProvider = workerSnapshot ? { providerId: workerSnapshot.providerId, model: workerSnapshot.model, endpoint: workerSnapshot.endpoint } : null;
    let configChangeReported = false;
    let runtimeChangeReported = false;
    const assetPersister = new StudioGeneratedAssetPersister({ db: workerDb, paths: initialized.paths, studioId: initialized.manifest.studioId });
    const assetResolver = new StudioAssetResolver({ db: workerDb, paths: initialized.paths });
    const worker = workerConfig && workerProvider && workerReady ? new GenerationWorker({
      db: workerDb,
      workerId,
      provider: workerProvider,
      providerConfig: workerConfig,
      assetPersister,
      assetResolver
    }) : null;
    heartbeat();
    heartbeatTimer = setInterval(heartbeat, 5000);
    const tick = async (): Promise<void> => {
      if (stopping) return;
      try {
        const recoveredLeases = recoverExpiredLeases(workerDb);
        const promotedRetries = promoteDueRetryWaitItems(workerDb);
        const reconciledRuns = reconcileTerminalRuns(workerDb);
        const currentConfig = loadProviderConfig(initialized.paths);
        const currentSnapshot = currentConfig ? providerSnapshot(currentConfig) : null;
        if (!configChangeReported && JSON.stringify(currentSnapshot) !== JSON.stringify(workerSnapshot)) {
          configChangeReported = true;
          appendStudioEvent(workerDb, { studioId: initialized.manifest.studioId, entityType: 'daemon', entityId: workerId, eventType: 'daemon.provider_config_changed', payload: { restartRequired: true } });
        }
        const currentRuntimeSettings = getStudioRuntimeSettings(workerDb, initialized.manifest.studioId);
        if (!runtimeChangeReported && currentRuntimeSettings.maxWorkerConcurrency !== runtimeSettings.maxWorkerConcurrency) {
          runtimeChangeReported = true;
          appendStudioEvent(workerDb, { studioId: initialized.manifest.studioId, entityType: 'daemon', entityId: workerId, eventType: 'daemon.runtime_settings_changed', payload: { restartRequired: true } });
        }
        if (worker) {
          const result = await worker.processOnce(activeWorkerConcurrency || 2);
          scheduleTick(result.claimed || recoveredLeases || promotedRetries || reconciledRuns ? 30 : pollMs);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message.replace(/[A-Za-z0-9_-]{20,}/g, '[redacted]') : 'unknown daemon worker failure';
        fs.appendFileSync(path.join(runtimeDir, 'daemon.log'), nowIso() + ' ' + message + '\n', { mode: 0o600 });
      }
      scheduleTick(pollMs);
    };
    const scheduleTick = (delay: number): void => {
      if (stopping) return;
      timer = setTimeout(() => {
        const next = tick();
        inFlightTick = next;
        void next.finally(() => { if (inFlightTick === next) inFlightTick = null; });
      }, delay);
    };
    scheduleTick(10);
    await new Promise<void>((resolve) => {
      const stop = (): void => { void close().finally(resolve); };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
      process.once('SIGHUP', stop);
    });
  } finally {
    await close();
  }
}
