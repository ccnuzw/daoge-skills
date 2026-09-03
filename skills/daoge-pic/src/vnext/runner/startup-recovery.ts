import { recoverAssetMediaOperations } from '../domain/assets';
import { MediaReconciliationResult, reconcileManagedMedia, reconcileManagedMediaAsync, recoverGeneratedMediaCommits } from '../media/reconcile';
import { StudioDatabase } from '../studio/database';
import { StudioPaths } from '../studio/workspace';
import { markRunsResumePending, promoteDueRetryWaitItems, reconcileTerminalRuns, recoverExpiredLeases } from './run-commands';

export interface StartupRecoveryResult {
  generatedMediaCommits: number;
  assetMediaOperations: number;
  managedMedia: MediaReconciliationResult;
  expiredLeases: number;
  dueRetries: number;
  terminalRuns: number;
  resumePendingRuns: number;
}

export function recoverStudioStartup(db: StudioDatabase, paths: StudioPaths, studioId: string, now = new Date()): StartupRecoveryResult {
  const generatedMediaCommits = recoverGeneratedMediaCommits(db, paths, studioId);
  const assetMediaOperations = recoverAssetMediaOperations(db, paths, studioId);
  const managedMedia = reconcileManagedMedia(db, paths, studioId);
  const terminalRuns = reconcileTerminalRuns(db, now);
  const expiredLeases = recoverExpiredLeases(db, now);
  const dueRetries = promoteDueRetryWaitItems(db, now);
  const resumePendingRuns = markRunsResumePending(db);
  return { generatedMediaCommits, assetMediaOperations, managedMedia, expiredLeases, dueRetries, terminalRuns, resumePendingRuns };
}

export async function recoverStudioStartupAsync(db: StudioDatabase, paths: StudioPaths, studioId: string, now = new Date()): Promise<StartupRecoveryResult> {
  const generatedMediaCommits = recoverGeneratedMediaCommits(db, paths, studioId);
  const assetMediaOperations = recoverAssetMediaOperations(db, paths, studioId);
  const managedMedia = await reconcileManagedMediaAsync(db, paths, studioId);
  const terminalRuns = reconcileTerminalRuns(db, now);
  const expiredLeases = recoverExpiredLeases(db, now);
  const dueRetries = promoteDueRetryWaitItems(db, now);
  const resumePendingRuns = markRunsResumePending(db);
  return { generatedMediaCommits, assetMediaOperations, managedMedia, expiredLeases, dueRetries, terminalRuns, resumePendingRuns };
}
