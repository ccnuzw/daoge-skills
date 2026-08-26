import fs from 'node:fs';
import path from 'node:path';
import { archiveStagedImage, discardStagedImage, plannedArchivePath, stageImage } from '../media/archive';
import { createId, nowIso } from '../shared/ids';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { AssetBucket, StudioPaths } from '../studio/workspace';
import { InvalidCommandError, StudioNotFoundError } from './studio-commands';

export type AssetKind = 'import' | 'generated' | 'export';
export type ReviewDecisionValue = 'keep' | 'review' | 'reject' | 'derive';

export interface StudioAsset {
  id: string;
  studioId: string;
  kind: AssetKind;
  mediaType: string;
  storagePath: string;
  contentHash: string;
  byteSize: number;
  source: Record<string, unknown>;
  deletedAt: string | null;
}

interface StoredAsset {
  id: string;
  studio_id: string;
  kind: AssetKind;
  media_type: string;
  storage_path: string;
  content_hash: string;
  byte_size: number;
  source_json: string;
  deleted_at: string | null;
}

interface PendingAssetOperation {
  id: string;
  studio_id: string;
  asset_id: string;
  operation: 'import' | 'trash' | 'restore';
  source_path: string;
  target_path: string;
  asset_json: string | null;
  relation_json: string | null;
}

interface PendingImportAsset { kind: AssetKind; mediaType: string; contentHash: string; byteSize: number; source: Record<string, unknown>; }
interface AssetRelationInput { targetType: string; targetId: string; relationType: string; metadata?: Record<string, unknown>; }

function parseObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function assetFromRow(row: StoredAsset): StudioAsset {
  return { id: row.id, studioId: row.studio_id, kind: row.kind, mediaType: row.media_type, storagePath: row.storage_path, contentHash: row.content_hash, byteSize: row.byte_size, source: parseObject(row.source_json), deletedAt: row.deleted_at };
}

function ensureStudio(db: StudioDatabase, studioId: string): void {
  if (!db.prepare('SELECT id FROM studios WHERE id = ?').get(studioId)) throw new StudioNotFoundError('Studio not found: ' + studioId);
}

function storageAbsolutePath(paths: StudioPaths, storagePath: string): string {
  const absolute = path.resolve(paths.workspaceRoot, storagePath);
  const assetRoot = path.resolve(paths.assetRoot) + path.sep;
  if (!absolute.startsWith(assetRoot)) throw new InvalidCommandError('Asset storage path is outside the managed asset root.');
  return absolute;
}

function workspaceAbsolutePath(paths: StudioPaths, storagePath: string): string {
  const absolute = path.resolve(paths.workspaceRoot, storagePath);
  const workspace = path.resolve(paths.workspaceRoot) + path.sep;
  if (!absolute.startsWith(workspace)) throw new InvalidCommandError('Media operation path is outside the Studio workspace.');
  return absolute;
}

function relativePath(paths: StudioPaths, absolutePath: string): string {
  const relative = path.relative(paths.workspaceRoot, absolutePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new InvalidCommandError('Managed media must remain in the Studio workspace.');
  return relative.split(path.sep).join('/');
}

function assertRelationTarget(targetType: string, targetId: string): void {
  if (!/^(project|creative_task|creative_round|run_item|style_kit|brand_kit)$/.test(targetType)) throw new InvalidCommandError('Unsupported asset relation target.');
  if (!String(targetId || '').trim()) throw new InvalidCommandError('Asset relation target id is required.');
}

function linkAsset(db: StudioDatabase, assetId: string, targetType: string, targetId: string, relationType: string, metadata: Record<string, unknown> = {}): void {
  assertRelationTarget(targetType, targetId);
  db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(asset_id, relation_type, target_type, target_id) DO UPDATE SET metadata_json = excluded.metadata_json').run(createId('assetrel'), assetId, relationType, targetType, targetId, JSON.stringify(metadata), nowIso());
}

function insertMediaOperation(db: StudioDatabase, input: { studioId: string; assetId: string; operation: PendingAssetOperation['operation']; sourcePath: string; targetPath: string; asset?: PendingImportAsset; relation?: AssetRelationInput }): void {
  db.prepare('DELETE FROM asset_media_operations WHERE asset_id = ? AND operation = ?').run(input.assetId, input.operation);
  db.prepare('INSERT INTO asset_media_operations (id, studio_id, asset_id, operation, source_path, target_path, asset_json, relation_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(createId('assetop'), input.studioId, input.assetId, input.operation, input.sourcePath, input.targetPath, input.asset ? JSON.stringify(input.asset) : null, input.relation ? JSON.stringify(input.relation) : null, nowIso());
}

function moveManagedMedia(sourcePath: string, targetPath: string): void {
  if (fs.existsSync(targetPath)) {
    if (!fs.existsSync(sourcePath)) return;
    throw new InvalidCommandError('Media operation target already exists.');
  }
  if (!fs.existsSync(sourcePath)) throw new InvalidCommandError('Managed media is missing.');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.renameSync(sourcePath, targetPath);
}

function finishImport(db: StudioDatabase, entry: PendingAssetOperation, asset: PendingImportAsset, relation: AssetRelationInput | null): void {
  const existing = db.prepare('SELECT id FROM assets WHERE id = ?').get(entry.asset_id) as { id: string } | undefined;
  if (!existing) {
    const timestamp = nowIso();
    db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(entry.asset_id, entry.studio_id, asset.kind, asset.mediaType, entry.target_path, asset.contentHash, asset.byteSize, JSON.stringify(asset.source), timestamp, timestamp);
    appendStudioEvent(db, { studioId: entry.studio_id, entityType: 'asset', entityId: entry.asset_id, eventType: 'asset.imported', payload: { mediaType: asset.mediaType, byteSize: asset.byteSize, recovered: true } });
  }
  if (relation) linkAsset(db, entry.asset_id, relation.targetType, relation.targetId, relation.relationType, relation.metadata || {});
  db.prepare('DELETE FROM asset_media_operations WHERE id = ?').run(entry.id);
}

export function recoverAssetMediaOperations(db: StudioDatabase, paths: StudioPaths, studioId: string): number {
  const operations = db.prepare('SELECT id, studio_id, asset_id, operation, source_path, target_path, asset_json, relation_json FROM asset_media_operations WHERE studio_id = ? ORDER BY created_at').all(studioId) as unknown as PendingAssetOperation[];
  let recovered = 0;
  for (const entry of operations) {
    const source = workspaceAbsolutePath(paths, entry.source_path);
    const target = workspaceAbsolutePath(paths, entry.target_path);
    if (!fs.existsSync(target) && fs.existsSync(source)) moveManagedMedia(source, target);
    if (!fs.existsSync(target)) continue;
    withTransaction(db, () => {
      if (entry.operation === 'import') {
        const asset = parseObject(entry.asset_json) as unknown as PendingImportAsset;
        if (!asset.kind || !asset.mediaType || !asset.contentHash) return;
        const relationValue = parseObject(entry.relation_json) as unknown as AssetRelationInput;
        finishImport(db, entry, asset, relationValue.targetType ? relationValue : null);
      } else if (entry.operation === 'trash') {
        const timestamp = nowIso();
        db.prepare('UPDATE assets SET storage_path = ?, deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ? AND studio_id = ?').run(entry.target_path, timestamp, timestamp, entry.asset_id, studioId);
        appendStudioEvent(db, { studioId, entityType: 'asset', entityId: entry.asset_id, eventType: 'asset.trashed_recovered', payload: {} });
        db.prepare('DELETE FROM asset_media_operations WHERE id = ?').run(entry.id);
      } else {
        const timestamp = nowIso();
        db.prepare('UPDATE assets SET storage_path = ?, deleted_at = NULL, updated_at = ? WHERE id = ? AND studio_id = ?').run(entry.target_path, timestamp, entry.asset_id, studioId);
        appendStudioEvent(db, { studioId, entityType: 'asset', entityId: entry.asset_id, eventType: 'asset.restored_recovered', payload: {} });
        db.prepare('DELETE FROM asset_media_operations WHERE id = ?').run(entry.id);
      }
    });
    recovered += 1;
  }
  return recovered;
}

export function importStudioAsset(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; bytes: Buffer; mediaType?: string; originalFilename?: string; targetType?: string; targetId?: string; source?: Record<string, unknown> }): StudioAsset {
  ensureStudio(db, input.studioId);
  recoverAssetMediaOperations(db, paths, input.studioId);
  const staged = stageImage(paths, input.bytes, input.mediaType);
  const existing = db.prepare('SELECT id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, deleted_at FROM assets WHERE studio_id = ? AND content_hash = ? AND deleted_at IS NULL').get(input.studioId, staged.contentHash) as StoredAsset | undefined;
  if (existing) {
    discardStagedImage(staged);
    withTransaction(db, () => {
      if (input.targetType && input.targetId) linkAsset(db, existing.id, input.targetType, input.targetId, 'attached_to');
      appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: existing.id, eventType: 'asset.reused', payload: { source: 'import' } });
    });
    return assetFromRow(existing);
  }
  const assetId = createId('asset');
  const planned = plannedArchivePath(paths, { assetId, bucket: 'imports', mediaType: staged.mediaType });
  const source = { ...input.source, originalFilename: input.originalFilename || null, importedAt: nowIso() };
  const relation = input.targetType && input.targetId ? { targetType: input.targetType, targetId: input.targetId, relationType: 'attached_to' } : undefined;
  withTransaction(db, () => insertMediaOperation(db, { studioId: input.studioId, assetId, operation: 'import', sourcePath: relativePath(paths, staged.stagingPath), targetPath: planned.storagePath, asset: { kind: 'import', mediaType: staged.mediaType, contentHash: staged.contentHash, byteSize: staged.byteSize, source }, relation }));
  archiveStagedImage(paths, staged, { assetId, bucket: 'imports' });
  const operation = db.prepare("SELECT id, studio_id, asset_id, operation, source_path, target_path, asset_json, relation_json FROM asset_media_operations WHERE asset_id = ? AND operation = 'import'").get(assetId) as unknown as PendingAssetOperation;
  withTransaction(db, () => finishImport(db, operation, { kind: 'import', mediaType: staged.mediaType, contentHash: staged.contentHash, byteSize: staged.byteSize, source }, relation || null));
  return { id: assetId, studioId: input.studioId, kind: 'import', mediaType: staged.mediaType, storagePath: planned.storagePath, contentHash: staged.contentHash, byteSize: staged.byteSize, source, deletedAt: null };
}

export function listStudioAssets(db: StudioDatabase, studioId: string, input: { includeDeleted?: boolean; targetType?: string; targetId?: string; limit?: number } = {}): StudioAsset[] {
  ensureStudio(db, studioId);
  const limit = Math.min(500, Math.max(1, Number.isInteger(input.limit) ? Number(input.limit) : 100));
  if (input.targetType && input.targetId) {
    assertRelationTarget(input.targetType, input.targetId);
    return (db.prepare('SELECT a.id, a.studio_id, a.kind, a.media_type, a.storage_path, a.content_hash, a.byte_size, a.source_json, a.deleted_at FROM assets a JOIN asset_relations r ON r.asset_id = a.id WHERE a.studio_id = ? AND r.target_type = ? AND r.target_id = ? AND (? = 1 OR a.deleted_at IS NULL) ORDER BY a.created_at DESC LIMIT ?').all(studioId, input.targetType, input.targetId, input.includeDeleted ? 1 : 0, limit) as unknown as StoredAsset[]).map(assetFromRow);
  }
  return (db.prepare('SELECT id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, deleted_at FROM assets WHERE studio_id = ? AND (? = 1 OR deleted_at IS NULL) ORDER BY created_at DESC LIMIT ?').all(studioId, input.includeDeleted ? 1 : 0, limit) as unknown as StoredAsset[]).map(assetFromRow);
}

export function getStudioAsset(db: StudioDatabase, studioId: string, assetId: string): StudioAsset | null {
  const row = db.prepare('SELECT id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, deleted_at FROM assets WHERE studio_id = ? AND id = ?').get(studioId, assetId) as StoredAsset | undefined;
  return row ? assetFromRow(row) : null;
}

export function assetFilePath(paths: StudioPaths, asset: StudioAsset): string { return storageAbsolutePath(paths, asset.storagePath); }

export function getAssetImpact(db: StudioDatabase, studioId: string, assetId: string): { relationCount: number; reviewCount: number; deliveryCount: number } {
  const asset = getStudioAsset(db, studioId, assetId);
  if (!asset) throw new StudioNotFoundError('Asset not found: ' + assetId);
  const relationCount = (db.prepare('SELECT COUNT(*) AS total FROM asset_relations WHERE asset_id = ?').get(assetId) as { total: number }).total;
  const reviewCount = (db.prepare('SELECT COUNT(*) AS total FROM review_decisions WHERE asset_id = ?').get(assetId) as { total: number }).total;
  const deliveryCount = (db.prepare("SELECT COUNT(*) AS total FROM deliveries d JOIN asset_relations ar ON ar.target_id = d.id AND ar.target_type = 'delivery' WHERE ar.asset_id = ? AND d.status = 'exported'").get(assetId) as { total: number }).total;
  return { relationCount, reviewCount, deliveryCount };
}

export function softDeleteAsset(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; assetId: string }): StudioAsset {
  recoverAssetMediaOperations(db, paths, input.studioId);
  const asset = getStudioAsset(db, input.studioId, input.assetId);
  if (!asset) throw new StudioNotFoundError('Asset not found: ' + input.assetId);
  if (asset.deletedAt) return asset;
  const sourcePath = storageAbsolutePath(paths, asset.storagePath);
  if (!fs.existsSync(sourcePath)) throw new InvalidCommandError('Active asset media is missing and cannot be deleted safely.');
  const targetPath = path.join(paths.assetRoot, 'trash', asset.id + path.extname(sourcePath));
  const storagePath = relativePath(paths, targetPath);
  withTransaction(db, () => insertMediaOperation(db, { studioId: input.studioId, assetId: asset.id, operation: 'trash', sourcePath: asset.storagePath, targetPath: storagePath }));
  moveManagedMedia(sourcePath, targetPath);
  const timestamp = nowIso();
  withTransaction(db, () => {
    db.prepare('UPDATE assets SET storage_path = ?, deleted_at = ?, updated_at = ? WHERE id = ?').run(storagePath, timestamp, timestamp, asset.id);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: asset.id, eventType: 'asset.trashed', payload: {} });
    db.prepare("DELETE FROM asset_media_operations WHERE asset_id = ? AND operation = 'trash'").run(asset.id);
  });
  return { ...asset, storagePath, deletedAt: timestamp };
}

export function restoreAsset(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; assetId: string }): StudioAsset {
  recoverAssetMediaOperations(db, paths, input.studioId);
  const asset = getStudioAsset(db, input.studioId, input.assetId);
  if (!asset) throw new StudioNotFoundError('Asset not found: ' + input.assetId);
  if (!asset.deletedAt) return asset;
  const sourcePath = storageAbsolutePath(paths, asset.storagePath);
  if (!fs.existsSync(sourcePath)) throw new InvalidCommandError('Deleted asset media is missing and cannot be restored.');
  const bucket: AssetBucket = asset.kind === 'import' ? 'imports' : asset.kind === 'generated' ? 'generated' : 'exports';
  const targetPath = path.join(paths.assetRoot, bucket, asset.id + path.extname(sourcePath));
  const storagePath = relativePath(paths, targetPath);
  withTransaction(db, () => insertMediaOperation(db, { studioId: input.studioId, assetId: asset.id, operation: 'restore', sourcePath: asset.storagePath, targetPath: storagePath }));
  moveManagedMedia(sourcePath, targetPath);
  const timestamp = nowIso();
  withTransaction(db, () => {
    db.prepare('UPDATE assets SET storage_path = ?, deleted_at = NULL, updated_at = ? WHERE id = ?').run(storagePath, timestamp, asset.id);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: asset.id, eventType: 'asset.restored', payload: {} });
    db.prepare("DELETE FROM asset_media_operations WHERE asset_id = ? AND operation = 'restore'").run(asset.id);
  });
  return { ...asset, storagePath, deletedAt: null };
}

export function setReviewDecision(db: StudioDatabase, input: { studioId: string; assetId: string; decision: ReviewDecisionValue; taskId?: string; roundId?: string; feedback?: Record<string, unknown> }): void {
  const asset = getStudioAsset(db, input.studioId, input.assetId);
  if (!asset || asset.deletedAt) throw new StudioNotFoundError('Active asset not found: ' + input.assetId);
  if (!['keep', 'review', 'reject', 'derive'].includes(input.decision)) throw new InvalidCommandError('Unsupported review decision.');
  const task = input.taskId ? db.prepare('SELECT t.id FROM creative_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.studio_id = ?').get(input.taskId, input.studioId) as { id: string } | undefined : undefined;
  if (input.taskId && !task) throw new InvalidCommandError('Review task does not belong to this Studio.');
  const round = input.roundId ? db.prepare('SELECT cr.id, cr.task_id FROM creative_rounds cr JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE cr.id = ? AND p.studio_id = ?').get(input.roundId, input.studioId) as { id: string; task_id: string } | undefined : undefined;
  if (input.roundId && !round) throw new InvalidCommandError('Review round does not belong to this Studio.');
  if (round && task && round.task_id !== task.id) throw new InvalidCommandError('Review round does not belong to the selected task.');
  withTransaction(db, () => {
    const timestamp = nowIso();
    db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(createId('review'), asset.id, input.taskId || null, input.roundId || null, input.decision, JSON.stringify(input.feedback || {}), timestamp, timestamp);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: asset.id, eventType: 'asset.reviewed', payload: { decision: input.decision } });
  });
}
