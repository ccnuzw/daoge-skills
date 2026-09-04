import fs from 'node:fs';
import path from 'node:path';
import { LocalStudioService } from '../api/server';
import { createLocalCapability } from '../api/local-auth';
import { promoteDueRetryWaitItems, reconcileTerminalRuns, recoverExpiredLeases } from '../runner/run-commands';
import { recoverStudioStartupAsync } from '../runner/startup-recovery';
import { createId, nowIso } from '../shared/ids';
import { appendStudioEvent, closeStudioDatabase, openStudioDatabase, StudioDatabase } from '../studio/database';
import { providerSnapshot } from '../studio/provider-config';
import { closeProviderDatabase, importLegacyProviderEnvOnce, openProviderDatabase, ProviderDatabase, providerStatus, resolveActiveProviderConfig } from '../studio/provider-store';
import { MAX_GLOBAL_CONCURRENCY } from '../studio/runtime-settings';
import { ensureRuntimeDirectory, initializeStudio, studioPaths } from '../studio/workspace';
import { installDaemonRestartHandler } from './restart';
import { WorkbenchPresence } from './workbench-presence';
import { acquireDaemonLock } from './daemon-lock';
import { WorkerProcessPool } from './worker-pool';
import { MediaProcessPool } from './media-worker-pool';

export interface StudioDaemonOptions {
  workspaceRoot: string;
  capability?: string;
  sessionToken?: string;
  port?: number;
  pollMs?: number;
  workbenchPresence?: WorkbenchPresence;
}

interface RuntimeRecord {
  pid: number;
  url: string;
  capability: string;
  port: number;
  workspaceRoot: string;
  startedAt: string;
  heartbeatAt: string;
  provider: { profileId: string; configVersion: number; providerId: string; model: string; endpoint: string | null } | null;
  workerPool: { mode: 'child_process'; size: number; pids: number[] } | null;
  mediaWorkerPool: { mode: 'child_process'; size: number; pids: number[] } | null;
}
function writeAtomically(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

// SQLite owns daemon process exclusion; daemon.lock is only the authenticated owner identity record.

function rememberedPort(portPath: string): number {
  try {
    const parsed = JSON.parse(fs.readFileSync(portPath, 'utf8')) as { port?: unknown };
    const port = Number(parsed.port);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
  } catch {
    return 0;
  }
}
const SHUTDOWN_STEP_TIMEOUT_MS = 3000;

async function settleShutdownStep(operation: Promise<void>, label: string, failures: unknown[]): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  const guarded = operation.catch((error) => { failures.push(error); });
  await Promise.race([
    guarded,
    new Promise<void>((resolve) => {
      timeout = setTimeout(() => {
        failures.push(new Error(label + ' did not stop within ' + SHUTDOWN_STEP_TIMEOUT_MS + 'ms.'));
        resolve();
      }, SHUTDOWN_STEP_TIMEOUT_MS);
    })
  ]);
  clearTimeout(timeout);
}



export async function runStudioDaemon(options: StudioDaemonOptions): Promise<'stopped' | 'restart'> {
  const paths = studioPaths(options.workspaceRoot);
  const runtimeDir = ensureRuntimeDirectory(paths);
  const runtimePath = path.join(runtimeDir, 'daemon.json');
  const portPath = path.join(runtimeDir, 'daemon.port.json');
  const daemonLock = acquireDaemonLock({
    databasePath: paths.daemonLockDatabasePath,
    ownerRecordPath: paths.daemonOwnerRecordPath
  });

  let service: LocalStudioService | null = null;
  let workerDb: StudioDatabase | null = null;
  let workerProviderDb: ProviderDatabase | null = null;
  let workerPool: WorkerProcessPool | null = null;
  let mediaWorkerPool: MediaProcessPool | null = null;
  let restartRequested = false;
  let timer: NodeJS.Timeout | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let inFlightTick: Promise<void> | null = null;
  let stopping = false;
  let closePromise: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closePromise) return closePromise;
    stopping = true;
    clearTimeout(timer);
    clearInterval(heartbeatTimer);
    closePromise = (async (): Promise<void> => {
      const failures: unknown[] = [];
      if (mediaWorkerPool) {
        await settleShutdownStep(mediaWorkerPool.close(), 'Daemon media worker pool', failures);
        mediaWorkerPool = null;
      }
      if (workerPool) {
        await settleShutdownStep(workerPool.close(), 'Daemon worker pool', failures);
        workerPool = null;
      }
      if (service) {
        await settleShutdownStep(service.close(), 'Studio HTTP service', failures);
        service = null;
      }
      if (workerDb) {
        try { closeStudioDatabase(workerDb); } catch (error) { failures.push(error); }
        workerDb = null;
      }
      if (workerProviderDb) {
        try { closeProviderDatabase(workerProviderDb); } catch (error) { failures.push(error); }
        workerProviderDb = null;
      }
      try {
        const current = JSON.parse(fs.readFileSync(runtimePath, 'utf8')) as { pid?: number };
        if (current.pid === process.pid) fs.rmSync(runtimePath);
      } catch { /* no runtime record owned by this process remains */ }
      if (failures.length > 0) throw failures[0];
    })();
    return closePromise;
  };

  let resolveShutdown = (): void => undefined;
  const shutdownRequested = new Promise<void>((resolve) => { resolveShutdown = resolve; });
  let shutdownStarted = false;
  const finish = (): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    void close().then(resolveShutdown, resolveShutdown);
  };
  const stop = (): void => finish();
  const restart = (): void => {
    if (!shutdownStarted) restartRequested = true;
    finish();
  };
  const uninstallRestart = installDaemonRestartHandler(restart);
  const cleanupSignals = (): void => {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGHUP', stop);
    uninstallRestart();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('SIGHUP', stop);

  try {
    const initialized = initializeStudio({ workspaceRoot: paths.workspaceRoot });
    const capability = options.capability || createLocalCapability();
    const sessionToken = options.sessionToken || createLocalCapability();
    mediaWorkerPool = new MediaProcessPool(initialized.paths.workspaceRoot);
    service = new LocalStudioService({ workspaceRoot: initialized.paths.workspaceRoot, capability, sessionToken, workbenchPresence: options.workbenchPresence, mediaWorkerPool });
    workerDb = openStudioDatabase(initialized.paths, initialized.manifest);
    workerProviderDb = openProviderDatabase(initialized.paths);
    importLegacyProviderEnvOnce(workerProviderDb, initialized.paths);
    await recoverStudioStartupAsync(workerDb, initialized.paths, initialized.manifest.studioId, new Date(), { mediaWorkerPool });

    const daemonService = service;
    const daemonDb = workerDb;
    const daemonProviderDb = workerProviderDb;
    let startedUrl = '';
    let activeProvider: { profileId: string; configVersion: number; providerId: string; model: string; endpoint: string | null } | null = null;
    const startedAt = nowIso();
    const workerId = createId('worker_pool');
    const runtimeRecord = (): RuntimeRecord => ({ pid: process.pid, url: startedUrl, capability, port: Number(new URL(startedUrl).port), workspaceRoot: initialized.paths.workspaceRoot, startedAt, heartbeatAt: nowIso(), provider: activeProvider, workerPool: workerPool ? { mode: 'child_process', size: workerPool.processIds().length, pids: workerPool.processIds() } : null, mediaWorkerPool: mediaWorkerPool ? { mode: 'child_process', size: mediaWorkerPool.processIds().length, pids: mediaWorkerPool.processIds() } : null });
    const heartbeat = (): void => { if (startedUrl) writeAtomically(runtimePath, runtimeRecord()); };

    const requestedPort = options.port === 0 ? 0 : options.port || rememberedPort(portPath);
    const started = await daemonService.listen(requestedPort);
    startedUrl = started.url;
    writeAtomically(portPath, { port: Number(new URL(startedUrl).port) });
    const pollMs = Math.max(100, Math.min(5000, options.pollMs || 350));
    // A daemon uses one in-memory Provider identity for its lifetime. Configuration changes require a restart and cannot silently alter an in-flight run.
    const workerConfig = resolveActiveProviderConfig(daemonProviderDb);
    const workerStatus = providerStatus(daemonProviderDb);
    const workerReady = Boolean(workerConfig && workerStatus.configured);
    const workerSnapshot = workerConfig ? providerSnapshot(workerConfig) : null;
    activeProvider = workerSnapshot ? { profileId: workerSnapshot.profileId, configVersion: workerSnapshot.configVersion, providerId: workerSnapshot.providerId, model: workerSnapshot.model, endpoint: workerSnapshot.endpoint } : null;
    let configChangeReported = false;
    workerPool = workerReady ? new WorkerProcessPool(initialized.paths.workspaceRoot) : null;
    heartbeat();
    heartbeatTimer = setInterval(heartbeat, 5000);
    const tick = async (): Promise<void> => {
      if (stopping) return;
      try {
        const recoveredLeases = recoverExpiredLeases(daemonDb);
        const promotedRetries = promoteDueRetryWaitItems(daemonDb);
        const reconciledRuns = reconcileTerminalRuns(daemonDb);
        const currentConfig = resolveActiveProviderConfig(daemonProviderDb);
        const currentSnapshot = currentConfig ? providerSnapshot(currentConfig) : null;
        if (!configChangeReported && JSON.stringify(currentSnapshot) !== JSON.stringify(workerSnapshot)) {
          configChangeReported = true;
          appendStudioEvent(daemonDb, { studioId: initialized.manifest.studioId, entityType: 'daemon', entityId: workerId, eventType: 'daemon.provider_config_changed', payload: { restartRequired: true } });
        }
        if (workerPool) {
          const result = await workerPool.processOnce(MAX_GLOBAL_CONCURRENCY);
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
    await shutdownRequested;
    return restartRequested ? 'restart' : 'stopped';
  } finally {
    try { await close(); } finally {
      try { daemonLock.release(); } finally { cleanupSignals(); }
    }
  }
}
