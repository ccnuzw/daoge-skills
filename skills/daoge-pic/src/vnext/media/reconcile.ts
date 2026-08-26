import fs from 'node:fs';
import path from 'node:path';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { createId } from '../shared/ids';
import { recoverAssetMediaOperations } from '../domain/assets';
import { archiveStagedImage } from './archive';
import { StudioPaths } from '../studio/workspace';

interface StoredAsset { id: string; storage_path: string; }
interface PendingMedia { asset_id: string; studio_id: string; staged_path: string; final_storage_path: string; media_type: string; content_hash: string; byte_size: number; source_json: string; run_id: string; run_item_id: string; }
interface PendingAssetMediaOperation { id: string; studio_id: string; asset_id: string; operation: 'import' | 'trash' | 'restore'; source_path: string; target_path: string; asset_json: string | null; relation_json: string | null; }

export interface MediaReconciliationResult { quarantinedOrphans: number; missingRows: number; }

function normalizedRelative(paths: StudioPaths, value: string): string { return path.relative(paths.workspaceRoot, value).split(path.sep).join('/'); }
function missingAlreadyRecorded(db: StudioDatabase, studioId: string, assetId: string): boolean { return Boolean(db.prepare("SELECT id FROM events WHERE studio_id = ? AND entity_type = 'asset' AND entity_id = ? AND event_type = 'asset.media_missing' LIMIT 1").get(studioId, assetId)); }


export function recoverGeneratedMediaCommits(db: StudioDatabase, paths: StudioPaths, studioId: string): number {
  const pending = db.prepare('SELECT asset_id, studio_id, staged_path, final_storage_path, media_type, content_hash, byte_size, source_json, run_id, run_item_id FROM media_commit_journal WHERE studio_id = ? ORDER BY created_at').all(studioId) as unknown as PendingMedia[];
  let recovered = 0;
  for (const entry of pending) {
    const finalPath = path.resolve(paths.workspaceRoot, entry.final_storage_path);
    const stagedPath = path.resolve(paths.workspaceRoot, entry.staged_path);
    if (!fs.existsSync(finalPath) && fs.existsSync(stagedPath)) archiveStagedImage(paths, { stagingPath: stagedPath, mediaType: entry.media_type, contentHash: entry.content_hash, byteSize: entry.byte_size }, { assetId: entry.asset_id, bucket: 'generated' });
    if (!fs.existsSync(finalPath)) continue;
    withTransaction(db, () => {
      const existing = db.prepare('SELECT id FROM assets WHERE studio_id = ? AND content_hash = ? AND deleted_at IS NULL').get(studioId, entry.content_hash) as { id: string } | undefined;
      if (existing) {
        db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(asset_id, relation_type, target_type, target_id) DO NOTHING').run(createId('assetrel'), existing.id, 'output_of', 'run_item', entry.run_item_id, JSON.stringify({ runId: entry.run_id }), new Date().toISOString());
        if (existing.id !== entry.asset_id) fs.rmSync(finalPath, { force: true });
        appendStudioEvent(db, { studioId, entityType: 'asset', entityId: existing.id, eventType: 'asset.recovered_reuse', payload: { runId: entry.run_id, runItemId: entry.run_item_id } });
      } else {
        const timestamp = new Date().toISOString();
        db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(entry.asset_id, studioId, 'generated', entry.media_type, entry.final_storage_path, entry.content_hash, entry.byte_size, entry.source_json, timestamp, timestamp);
        db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(createId('assetrel'), entry.asset_id, 'output_of', 'run_item', entry.run_item_id, JSON.stringify({ runId: entry.run_id }), timestamp);
        appendStudioEvent(db, { studioId, entityType: 'asset', entityId: entry.asset_id, eventType: 'asset.generated_recovered', payload: { runId: entry.run_id, runItemId: entry.run_item_id } });
      }
      db.prepare('DELETE FROM media_commit_journal WHERE asset_id = ?').run(entry.asset_id);
    });
    recovered += 1;
  }
  return recovered;
}

export function reconcileManagedMedia(db: StudioDatabase, paths: StudioPaths, studioId: string): MediaReconciliationResult {
  recoverAssetMediaOperations(db, paths, studioId);
  const rows = db.prepare('SELECT id, storage_path FROM assets WHERE studio_id = ?').all(studioId) as unknown as StoredAsset[];
  const tracked = new Set(rows.map((row) => row.storage_path));
  for (const pending of db.prepare('SELECT final_storage_path FROM media_commit_journal WHERE studio_id = ?').all(studioId) as Array<{ final_storage_path: string }>) tracked.add(pending.final_storage_path);
  for (const pending of db.prepare('SELECT source_path, target_path FROM asset_media_operations WHERE studio_id = ?').all(studioId) as Array<{ source_path: string; target_path: string }>) { tracked.add(pending.source_path); tracked.add(pending.target_path); }
  const missing = rows.filter((row) => !fs.existsSync(path.resolve(paths.workspaceRoot, row.storage_path)) && !missingAlreadyRecorded(db, studioId, row.id));
  let quarantinedOrphans = 0;
  const trashDir = path.join(paths.assetRoot, 'trash');
  for (const bucket of ['imports', 'generated', 'exports']) {
    const directory = path.join(paths.assetRoot, bucket);
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const source = path.join(directory, entry.name);
      if (tracked.has(normalizedRelative(paths, source))) continue;
      fs.mkdirSync(trashDir, { recursive: true });
      const target = path.join(trashDir, 'orphan-' + Date.now() + '-' + entry.name);
      fs.renameSync(source, target);
      quarantinedOrphans += 1;
      appendStudioEvent(db, { studioId, entityType: 'media', entityId: entry.name, eventType: 'media.orphan_quarantined', payload: { bucket } });
    }
  }
  if (missing.length) {
    withTransaction(db, () => {
      for (const asset of missing) appendStudioEvent(db, { studioId, entityType: 'asset', entityId: asset.id, eventType: 'asset.media_missing', payload: {} });
    });
  }
  return { quarantinedOrphans, missingRows: missing.length };
}
