import { InvalidCommandError } from '../domain/studio-commands';
import { nowIso } from '../shared/ids';
import { appendStudioEvent, StudioDatabase, withTransaction } from './database';

export const MIN_WORKER_CONCURRENCY = 1;
export const MAX_WORKER_CONCURRENCY = 30;
export type WorkerConcurrency = number;
export const DEFAULT_WORKER_CONCURRENCY: WorkerConcurrency = MAX_WORKER_CONCURRENCY;

export interface StudioRuntimeSettings {
  studioId: string;
  maxWorkerConcurrency: WorkerConcurrency;
  updatedAt: string;
}

interface StoredRuntimeSettings {
  studio_id: string;
  max_worker_concurrency: number;
  updated_at: string;
}

function isWorkerConcurrency(value: unknown): value is WorkerConcurrency {
  return Number.isInteger(value) && Number(value) >= MIN_WORKER_CONCURRENCY && Number(value) <= MAX_WORKER_CONCURRENCY;
}

function fromRow(row: StoredRuntimeSettings): StudioRuntimeSettings {
  return { studioId: row.studio_id, maxWorkerConcurrency: row.max_worker_concurrency as WorkerConcurrency, updatedAt: row.updated_at };
}

export function requireWorkerConcurrency(value: unknown): WorkerConcurrency {
  const normalized = Number(value);
  if (!isWorkerConcurrency(normalized)) throw new InvalidCommandError('工作区并发上限只能是 1 到 30 的整数。');
  return normalized;
}

export function requireRequestedConcurrency(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < MIN_WORKER_CONCURRENCY || normalized > MAX_WORKER_CONCURRENCY) throw new InvalidCommandError('本次运行并发只能是 1 到 30 的整数。');
  return normalized;
}

export function getStudioRuntimeSettings(db: StudioDatabase, studioId: string): StudioRuntimeSettings {
  const existing = db.prepare('SELECT studio_id, max_worker_concurrency, updated_at FROM studio_runtime_settings WHERE studio_id = ?').get(studioId) as StoredRuntimeSettings | undefined;
  if (existing) return fromRow(existing);
  return withTransaction(db, () => {
    const timestamp = nowIso();
    db.prepare('INSERT OR IGNORE INTO studio_runtime_settings (studio_id, max_worker_concurrency, updated_at) VALUES (?, ?, ?)').run(studioId, DEFAULT_WORKER_CONCURRENCY, timestamp);
    const created = db.prepare('SELECT studio_id, max_worker_concurrency, updated_at FROM studio_runtime_settings WHERE studio_id = ?').get(studioId) as StoredRuntimeSettings | undefined;
    if (!created) throw new InvalidCommandError('无法初始化 Studio 运行设置。');
    return fromRow(created);
  });
}

export function updateStudioRuntimeSettings(db: StudioDatabase, input: { studioId: string; maxWorkerConcurrency: unknown }): StudioRuntimeSettings {
  const maxWorkerConcurrency = requireWorkerConcurrency(input.maxWorkerConcurrency);
  return withTransaction(db, () => {
    const previous = getStudioRuntimeSettings(db, input.studioId);
    const timestamp = nowIso();
    db.prepare('UPDATE studio_runtime_settings SET max_worker_concurrency = ?, updated_at = ? WHERE studio_id = ?').run(maxWorkerConcurrency, timestamp, input.studioId);
    const next = { studioId: input.studioId, maxWorkerConcurrency, updatedAt: timestamp };
    if (previous.maxWorkerConcurrency !== maxWorkerConcurrency) {
      appendStudioEvent(db, { studioId: input.studioId, entityType: 'studio_runtime_settings', entityId: input.studioId, eventType: 'runtime_settings.updated', payload: { maxWorkerConcurrency } });
    }
    return next;
  });
}
