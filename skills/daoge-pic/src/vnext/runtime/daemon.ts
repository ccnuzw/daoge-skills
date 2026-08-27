import fs from 'node:fs';
import path from 'node:path';
import { LocalStudioService } from '../api/server';
import { StudioGeneratedAssetPersister } from '../media/generated-assets';
import { StudioAssetResolver } from '../media/asset-resolver';
import { createImageProvider } from '../providers/http-adapters';
import { GenerationWorker } from '../runner/worker';
import { reconcileTerminalRuns, recoverExpiredLeases } from '../runner/run-commands';
import { createId, nowIso } from '../shared/ids';
import { appendStudioEvent, closeStudioDatabase, openStudioDatabase } from '../studio/database';
import { loadProviderConfig, providerSnapshot } from '../studio/provider-config';
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
  workspaceRoot: string;
  startedAt: string;
  heartbeatAt: string;
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
  fs.mkdirSync(runtimeDir, { recursive: true });
  acquireLock(lockPath);

  const service = new LocalStudioService({ workspaceRoot: initialized.paths.workspaceRoot, providerTemplatePath: options.providerTemplatePath });
  const workerDb = openStudioDatabase(initialized.paths, initialized.manifest);
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let startedUrl = '';
  const workerId = createId('worker');

  const runtimeRecord = (): RuntimeRecord => ({ pid: process.pid, url: startedUrl, workspaceRoot: initialized.paths.workspaceRoot, startedAt: startedAt, heartbeatAt: nowIso() });
  const startedAt = nowIso();
  const heartbeat = (): void => { if (startedUrl) writeAtomically(runtimePath, runtimeRecord()); };
  const close = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    closeStudioDatabase(workerDb);
    await service.close();
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
    const started = await service.listen(options.port || 0);
    startedUrl = started.url;
    heartbeat();
    heartbeatTimer = setInterval(heartbeat, 5000);
    const pollMs = Math.max(100, Math.min(5000, options.pollMs || 350));
    // A daemon uses one in-memory Provider identity for its lifetime. Configuration changes require a restart and cannot silently alter an in-flight run.
    const workerConfig = loadProviderConfig(initialized.paths);
    const workerProvider = workerConfig ? createImageProvider(workerConfig) : null;
    const workerReady = Boolean(workerConfig && workerProvider && workerProvider.validateConfig(workerConfig).valid);
    const workerSnapshot = workerConfig ? providerSnapshot(workerConfig) : null;
    let configChangeReported = false;
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
    const tick = async (): Promise<void> => {
      if (stopping) return;
      try {
        recoverExpiredLeases(workerDb);
        const reconciledRuns = reconcileTerminalRuns(workerDb);
        const currentConfig = loadProviderConfig(initialized.paths);
        const currentSnapshot = currentConfig ? providerSnapshot(currentConfig) : null;
        if (!configChangeReported && JSON.stringify(currentSnapshot) !== JSON.stringify(workerSnapshot)) {
          configChangeReported = true;
          appendStudioEvent(workerDb, { studioId: initialized.manifest.studioId, entityType: 'daemon', entityId: workerId, eventType: 'daemon.provider_config_changed', payload: { restartRequired: true } });
        }
        if (worker) {
          const result = await worker.processOnce(2);
          timer = setTimeout(() => { void tick(); }, result.claimed || reconciledRuns ? 30 : pollMs);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message.replace(/[A-Za-z0-9_-]{20,}/g, '[redacted]') : 'unknown daemon worker failure';
        fs.appendFileSync(path.join(runtimeDir, 'daemon.log'), nowIso() + ' ' + message + '\n', { mode: 0o600 });
      }
      timer = setTimeout(() => { void tick(); }, pollMs);
    };
    timer = setTimeout(() => { void tick(); }, 10);
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
