import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { createId } from '../shared/ids';
import { recoverAssetMediaOperations } from '../domain/assets';
import { archiveStagedImage, inspectManagedImageFile, inspectManagedImageFileAsync, plannedArchivePath, resolveManagedMediaPath } from './archive';
import { assertWorkspacePath, AssetBucket, ensureAssetBucket, StudioPaths } from '../studio/workspace';

const MAX_RECONCILE_ENTRIES = 10_000;
const MAX_RECONCILE_DEPTH = 32;

interface StoredAsset { id: string; kind: 'import' | 'generated' | 'export'; storage_path: string; media_type: string; content_hash: string; byte_size: number; deleted_at: string | null; }
interface PendingMedia { asset_id: string; studio_id: string; staged_path: string; final_storage_path: string; media_type: string; content_hash: string; byte_size: number; source_json: string; run_id: string; run_item_id: string; }

export interface MediaReconciliationResult { quarantinedOrphans: number; missingRows: number; }

function normalizedRelative(paths: StudioPaths, value: string): string {
  return path.relative(paths.workspaceRoot, value).split(path.sep).join('/');
}

function missingAlreadyRecorded(db: StudioDatabase, studioId: string, assetId: string): boolean {
  return Boolean(db.prepare("SELECT id FROM events WHERE studio_id = ? AND entity_type = 'asset' AND entity_id = ? AND event_type = 'asset.media_missing' LIMIT 1").get(studioId, assetId));
}

function generatedRecoveryRejected(db: StudioDatabase, studioId: string, assetId: string, reason: string): void {
  if (db.prepare("SELECT id FROM events WHERE studio_id = ? AND entity_type = 'media_commit' AND entity_id = ? AND event_type = 'media.commit_recovery_rejected' LIMIT 1").get(studioId, assetId)) return;
  withTransaction(db, () => appendStudioEvent(db, { studioId, entityType: 'media_commit', entityId: assetId, eventType: 'media.commit_recovery_rejected', payload: { reason } }));
}

function generatedRunBelongsToStudio(db: StudioDatabase, studioId: string, runId: string, runItemId: string): boolean {
  return Boolean(db.prepare('SELECT item.id FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE item.id = ? AND item.run_id = ? AND project.studio_id = ?').get(runItemId, runId, studioId));
}

export function recoverGeneratedMediaCommits(db: StudioDatabase, paths: StudioPaths, studioId: string): number {
  const pending = db.prepare('SELECT asset_id, studio_id, staged_path, final_storage_path, media_type, content_hash, byte_size, source_json, run_id, run_item_id FROM media_commit_journal WHERE studio_id = ? ORDER BY created_at').all(studioId) as unknown as PendingMedia[];
  let recovered = 0;
  for (const entry of pending) {
    try {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(entry.media_type) || !/^[a-f0-9]{64}$/.test(entry.content_hash) || !Number.isSafeInteger(entry.byte_size) || entry.byte_size <= 0) throw new Error('invalid_identity');
      if (entry.studio_id !== studioId || !generatedRunBelongsToStudio(db, studioId, entry.run_id, entry.run_item_id)) throw new Error('invalid_run_chain');
      const expected = { mediaType: entry.media_type, contentHash: entry.content_hash, byteSize: entry.byte_size };
      const planned = plannedArchivePath(paths, { assetId: entry.asset_id, bucket: 'generated', mediaType: entry.media_type });
      if (planned.storagePath !== entry.final_storage_path) throw new Error('invalid_final_path');
      const stagedPath = resolveManagedMediaPath(paths, entry.staged_path, 'staging', { mustExist: false });
      const finalPath = resolveManagedMediaPath(paths, entry.final_storage_path, 'generated', { mustExist: false });
      const stagedExists = fs.existsSync(stagedPath);
      const finalExists = fs.existsSync(finalPath);
      if (stagedExists && finalExists) throw new Error('ambiguous_files');
      if (finalExists) {
        inspectManagedImageFile(paths, entry.final_storage_path, 'generated', expected);
      } else {
        if (!stagedExists) throw new Error('missing_files');
        inspectManagedImageFile(paths, entry.staged_path, 'staging', expected);
        archiveStagedImage(paths, { stagingPath: stagedPath, ...expected }, { assetId: entry.asset_id, bucket: 'generated' });
        inspectManagedImageFile(paths, entry.final_storage_path, 'generated', expected);
      }
      const matches = db.prepare('SELECT id, deleted_at FROM assets WHERE studio_id = ? AND content_hash = ? ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, created_at').all(studioId, entry.content_hash) as Array<{ id: string; deleted_at: string | null }>;
      const existing = matches.find((asset) => !asset.deleted_at);
      if (!existing && matches.length) throw new Error('deleted_hash_conflict');
      withTransaction(db, () => {
        if (existing) {
          db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(asset_id, relation_type, target_type, target_id) DO NOTHING').run(createId('assetrel'), existing.id, 'output_of', 'run_item', entry.run_item_id, JSON.stringify({ runId: entry.run_id }), new Date().toISOString());
          appendStudioEvent(db, { studioId, entityType: 'asset', entityId: existing.id, eventType: 'asset.recovered_reuse', payload: { runId: entry.run_id, runItemId: entry.run_item_id } });
        } else {
          const timestamp = new Date().toISOString();
          db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(entry.asset_id, studioId, 'generated', entry.media_type, entry.final_storage_path, entry.content_hash, entry.byte_size, entry.source_json, timestamp, timestamp);
          db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(createId('assetrel'), entry.asset_id, 'output_of', 'run_item', entry.run_item_id, JSON.stringify({ runId: entry.run_id }), timestamp);
          appendStudioEvent(db, { studioId, entityType: 'asset', entityId: entry.asset_id, eventType: 'asset.generated_recovered', payload: { runId: entry.run_id, runItemId: entry.run_item_id } });
        }
        db.prepare('DELETE FROM media_commit_journal WHERE asset_id = ? AND studio_id = ?').run(entry.asset_id, studioId);
      });
      if (existing && existing.id !== entry.asset_id) fs.rmSync(finalPath, { force: true });
      recovered += 1;
    } catch (error) {
      const reason = error instanceof Error && error.message === 'invalid_run_chain' ? 'invalid_run_chain' : error instanceof Error && /identity|conflict|ambiguous/i.test(error.message) ? 'identity_mismatch' : 'invalid_or_missing_media';
      generatedRecoveryRejected(db, studioId, entry.asset_id, reason);
    }
  }
  return recovered;
}

function assetBucket(row: StoredAsset): AssetBucket {
  if (row.deleted_at) return 'trash';
  return row.kind === 'import' ? 'imports' : row.kind === 'generated' ? 'generated' : 'exports';
}

function quarantineOrphan(paths: StudioPaths, source: string, originalName: string): void {
  assertWorkspacePath(paths, path.dirname(source), { requireDirectory: true });
  const trashDir = ensureAssetBucket(paths, 'trash');
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-96) || 'media';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const target = path.join(trashDir, 'orphan-' + createId('media') + '-' + safeName);
    if (fs.existsSync(target)) continue;
    try {
      fs.renameSync(source, target);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Unable to allocate a collision-safe orphan quarantine name.');
}

export function reconcileManagedMedia(db: StudioDatabase, paths: StudioPaths, studioId: string): MediaReconciliationResult {
  recoverAssetMediaOperations(db, paths, studioId);
  const rows = db.prepare('SELECT id, kind, storage_path, media_type, content_hash, byte_size, deleted_at FROM assets WHERE studio_id = ?').all(studioId) as unknown as StoredAsset[];
  const tracked = new Set(rows.map((row) => row.storage_path));
  for (const pending of db.prepare('SELECT final_storage_path FROM media_commit_journal WHERE studio_id = ?').all(studioId) as Array<{ final_storage_path: string }>) tracked.add(pending.final_storage_path);
  for (const pending of db.prepare('SELECT source_path, target_path FROM asset_media_operations WHERE studio_id = ?').all(studioId) as Array<{ source_path: string; target_path: string }>) {
    tracked.add(pending.source_path);
    tracked.add(pending.target_path);
  }

  const missing = rows.filter((row) => {
    if (missingAlreadyRecorded(db, studioId, row.id)) return false;
    try {
      inspectManagedImageFile(paths, row.storage_path, assetBucket(row), { mediaType: row.media_type, contentHash: row.content_hash, byteSize: row.byte_size });
      return false;
    } catch {
      return true;
    }
  });

  let quarantinedOrphans = 0;
  let visited = 0;
  let limitReached = false;
  const walk = (directory: string, bucket: AssetBucket, depth: number): void => {
    if (limitReached) return;
    if (depth > MAX_RECONCILE_DEPTH) { limitReached = true; return; }
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_RECONCILE_ENTRIES) { limitReached = true; return; }
      const source = path.join(directory, entry.name);
      const stat = fs.lstatSync(source);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        walk(source, bucket, depth + 1);
        if (!fs.readdirSync(source).length) fs.rmdirSync(source);
        continue;
      }
      if (tracked.has(normalizedRelative(paths, source))) continue;
      quarantineOrphan(paths, source, entry.name);
      quarantinedOrphans += 1;
      appendStudioEvent(db, { studioId, entityType: 'media', entityId: createId('orphan'), eventType: 'media.orphan_quarantined', payload: { bucket, kind: stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'other' } });
    }
  };
  const assetRootExists = assertWorkspacePath(paths, paths.assetRoot, { requireDirectory: true });
  if (assetRootExists) {
    for (const bucket of ['imports', 'generated', 'exports'] as AssetBucket[]) {
      const bucketPath = path.join(paths.assetRoot, bucket);
      if (assertWorkspacePath(paths, bucketPath, { requireDirectory: true })) walk(bucketPath, bucket, 0);
    }
  }
  if (limitReached) appendStudioEvent(db, { studioId, entityType: 'media', entityId: 'managed-media', eventType: 'media.reconcile_limit_reached', payload: { maxEntries: MAX_RECONCILE_ENTRIES, maxDepth: MAX_RECONCILE_DEPTH } });
  if (missing.length) {
    withTransaction(db, () => {
      for (const asset of missing) appendStudioEvent(db, { studioId, entityType: 'asset', entityId: asset.id, eventType: 'asset.media_missing', payload: {} });
    });
  }
  return { quarantinedOrphans, missingRows: missing.length };
}

export async function reconcileManagedMediaAsync(db: StudioDatabase, paths: StudioPaths, studioId: string): Promise<MediaReconciliationResult> {
  recoverAssetMediaOperations(db, paths, studioId);
  const rows = db.prepare('SELECT id, kind, storage_path, media_type, content_hash, byte_size, deleted_at FROM assets WHERE studio_id = ?').all(studioId) as unknown as StoredAsset[];
  const tracked = new Set(rows.map((row) => row.storage_path));
  for (const pending of db.prepare('SELECT final_storage_path FROM media_commit_journal WHERE studio_id = ?').all(studioId) as Array<{ final_storage_path: string }>) tracked.add(pending.final_storage_path);
  for (const pending of db.prepare('SELECT source_path, target_path FROM asset_media_operations WHERE studio_id = ?').all(studioId) as Array<{ source_path: string; target_path: string }>) {
    tracked.add(pending.source_path);
    tracked.add(pending.target_path);
  }

  const missing: StoredAsset[] = [];
  for (const row of rows) {
    if (missingAlreadyRecorded(db, studioId, row.id)) continue;
    try {
      await inspectManagedImageFileAsync(paths, row.storage_path, assetBucket(row), { mediaType: row.media_type, contentHash: row.content_hash, byteSize: row.byte_size });
    } catch {
      missing.push(row);
    }
  }

  let quarantinedOrphans = 0;
  let visited = 0;
  let limitReached = false;
  const walk = async (directory: string, bucket: AssetBucket, depth: number): Promise<void> => {
    if (limitReached) return;
    if (depth > MAX_RECONCILE_DEPTH) { limitReached = true; return; }
    let entries: fs.Dirent[];
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_RECONCILE_ENTRIES) { limitReached = true; return; }
      const source = path.join(directory, entry.name);
      const stat = await fsp.lstat(source);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        await walk(source, bucket, depth + 1);
        if (!(await fsp.readdir(source)).length) await fsp.rmdir(source);
      } else if (!tracked.has(normalizedRelative(paths, source))) {
        quarantineOrphan(paths, source, entry.name);
        quarantinedOrphans += 1;
        appendStudioEvent(db, { studioId, entityType: 'media', entityId: createId('orphan'), eventType: 'media.orphan_quarantined', payload: { bucket, kind: stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'other' } });
      }
      if (visited % 100 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const assetRootExists = assertWorkspacePath(paths, paths.assetRoot, { requireDirectory: true });
  if (assetRootExists) {
    for (const bucket of ['imports', 'generated', 'exports'] as AssetBucket[]) {
      const bucketPath = path.join(paths.assetRoot, bucket);
      if (assertWorkspacePath(paths, bucketPath, { requireDirectory: true })) await walk(bucketPath, bucket, 0);
    }
  }
  if (limitReached) appendStudioEvent(db, { studioId, entityType: 'media', entityId: 'managed-media', eventType: 'media.reconcile_limit_reached', payload: { maxEntries: MAX_RECONCILE_ENTRIES, maxDepth: MAX_RECONCILE_DEPTH } });
  if (missing.length) withTransaction(db, () => { for (const asset of missing) appendStudioEvent(db, { studioId, entityType: 'asset', entityId: asset.id, eventType: 'asset.media_missing', payload: {} }); });
  return { quarantinedOrphans, missingRows: missing.length };
}
