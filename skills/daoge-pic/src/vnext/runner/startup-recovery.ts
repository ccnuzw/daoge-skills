import fs from 'node:fs';
import { recoverAssetMediaOperations } from '../domain/assets';
import { MediaReconciliationResult, reconcileManagedMedia, reconcileManagedMediaAsync, recoverGeneratedMediaCommits } from '../media/reconcile';
import { pruneStudioEphemeralRecords, StudioDatabase } from '../studio/database';
import { StudioPaths } from '../studio/workspace';
import type { MediaProcessPool } from '../runtime/media-worker-pool';
import { markRunsResumePending, promoteDueRetryWaitItems, reconcileTerminalRuns, recoverExpiredLeases } from './run-commands';
import { expireStudioRequestLeases } from '../domain/request-queue';

export interface StartupRecoveryResult {
  generatedMediaCommits: number;
  assetMediaOperations: number;
  managedMedia: MediaReconciliationResult;
  expiredLeases: number;
  dueRetries: number;
  terminalRuns: number;
  resumePendingRuns: number;
  /** 请求队列里超期未处理的单：回队或失败（8.9#3 租约过期即自愈）。 */
  expiredRequests: number;
}

export function recoverStudioStartup(db: StudioDatabase, paths: StudioPaths, studioId: string, now = new Date()): StartupRecoveryResult {
  pruneStudioEphemeralRecords(db, now);
  const generatedMediaCommits = recoverGeneratedMediaCommits(db, paths, studioId);
  const assetMediaOperations = recoverAssetMediaOperations(db, paths, studioId);
  const managedMedia = reconcileManagedMedia(db, paths, studioId, { recoverAssetOperations: false });
  const terminalRuns = reconcileTerminalRuns(db, now);
  const expiredLeases = recoverExpiredLeases(db, now);
  const dueRetries = promoteDueRetryWaitItems(db, now);
  const resumePendingRuns = markRunsResumePending(db);
  const expiredRequests = expireStudioRequestLeases(db, now.toISOString());
  return { generatedMediaCommits, assetMediaOperations, managedMedia, expiredLeases, dueRetries, terminalRuns, resumePendingRuns, expiredRequests: expiredRequests.requeued + expiredRequests.failed };
}

export async function recoverStudioStartupAsync(db: StudioDatabase, paths: StudioPaths, studioId: string, now = new Date(), options: { mediaWorkerPool?: MediaProcessPool } = {}): Promise<StartupRecoveryResult> {
  pruneStudioEphemeralRecords(db, now);
  const generatedMediaCommits = recoverGeneratedMediaCommits(db, paths, studioId);
  const assetMediaOperations = recoverAssetMediaOperations(db, paths, studioId);
  const mediaReconciliationRequired = generatedMediaCommits > 0 || assetMediaOperations > 0 || fs.existsSync(paths.assetRoot) || Boolean(db.prepare('SELECT 1 FROM assets WHERE studio_id = ? LIMIT 1').get(studioId));
  const managedMedia = mediaReconciliationRequired
    ? options.mediaWorkerPool ? (await options.mediaWorkerPool.run<{ type: 'reconcile'; result: MediaReconciliationResult }>({ type: 'reconcile', studioId, recoverAssetOperations: false })).result : await reconcileManagedMediaAsync(db, paths, studioId, { recoverAssetOperations: false })
    : { quarantinedOrphans: 0, missingRows: 0 };
  const terminalRuns = reconcileTerminalRuns(db, now);
  const expiredLeases = recoverExpiredLeases(db, now);
  const dueRetries = promoteDueRetryWaitItems(db, now);
  const resumePendingRuns = markRunsResumePending(db);
  const expiredRequests = expireStudioRequestLeases(db, now.toISOString());
  return { generatedMediaCommits, assetMediaOperations, managedMedia, expiredLeases, dueRetries, terminalRuns, resumePendingRuns, expiredRequests: expiredRequests.requeued + expiredRequests.failed };
}
