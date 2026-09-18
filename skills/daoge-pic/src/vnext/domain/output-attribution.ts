import { StudioDatabase } from '../studio/database';
import { selectInStudioSql } from './studio-scope';

/**
 * Output attribution (plan 7.7.1 / 7.2).
 *
 * Two relationships used to be conventions rather than columns:
 *
 *   - "which project does this image belong to" was a five-hop JOIN through
 *     `asset_relations -> run_items -> runs -> rounds -> tasks`. Generated
 *     images now record their project the moment they are persisted.
 *   - "which image did this slot produce" lived inside `run_items.result_json`,
 *     so reading it required parsing JSON. It is a nullable column now, which
 *     also makes an empty slot exactly `asset_id IS NULL`.
 *
 * `asset_relations` stays, but only for real relations (references, deliveries,
 * sharing) — it no longer carries ownership.
 */

export interface OutputAttributionInput {
  studioId: string;
  assetId: string;
  runId: string;
  runItemId: string;
}

/** The project a run belongs to, or null when the run chain does not belong to this Studio. */
export function projectIdForRun(db: StudioDatabase, studioId: string, runId: string): string | null {
  // 归属查询走 studio-scope：Studio 谓词由表推导，不靠人手写（漏一处就是静默的跨租户读取）。
  const row = db.prepare(selectInStudioSql('generation_run', 'task.project_id AS project_id')).get(runId, studioId) as { project_id: string } | undefined;
  return row ? row.project_id : null;
}

/**
 * Record, at persist time, that `assetId` is the output of `runItemId`.
 *
 * The project is derived from the run chain and the whole write is skipped when
 * that chain does not belong to `studioId` — a mismatched caller must not be
 * able to move an image or claim a slot. Both writes are guarded so a re-run or
 * a reuse of an existing asset cannot move an image to a different project or
 * overwrite the slot's first output. (A run always resolves to a project:
 * runs -> rounds -> tasks all carry a NOT NULL parent.)
 */
export function attributeOutputAsset(db: StudioDatabase, input: OutputAttributionInput): void {
  const projectId = projectIdForRun(db, input.studioId, input.runId);
  if (!projectId) return;
  const timestamp = new Date().toISOString();
  db.prepare('UPDATE assets SET project_id = ?, updated_at = ? WHERE id = ? AND studio_id = ? AND project_id IS NULL').run(projectId, timestamp, input.assetId, input.studioId);
  db.prepare('UPDATE run_items SET asset_id = ? WHERE id = ? AND asset_id IS NULL').run(input.assetId, input.runItemId);
}

/** Imports get their project from the relation target when one names a project. */
export function attributeImportedAssetProject(db: StudioDatabase, input: { studioId: string; assetId: string; projectId: string | null }): void {
  if (!input.projectId) return;
  db.prepare('UPDATE assets SET project_id = ?, updated_at = ? WHERE id = ? AND studio_id = ? AND project_id IS NULL').run(input.projectId, new Date().toISOString(), input.assetId, input.studioId);
}
