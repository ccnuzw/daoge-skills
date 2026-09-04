import fs from 'node:fs';
import path from 'node:path';
import { archiveStagedImage, archiveStagedImageAsync, ArchivedImage, createVerifiedSnapshot, createVerifiedSnapshotAsync, discardStagedImage, inspectManagedImageFile, ManagedMediaRoot, MediaValidationError, plannedArchivePath, resolveManagedMediaPath, stageImage, StagedImage, VerifiedManagedFile } from '../media/archive';
import { createId, nowIso } from '../shared/ids';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { AssetBucket, ensureCacheDirectory, StudioPaths } from '../studio/workspace';
import { InvalidCommandError, StudioNotFoundError } from './studio-commands';

export type AssetKind = 'import' | 'generated' | 'export';
export type ReviewDecisionValue = 'keep' | 'review' | 'reject' | 'derive';
export type AssetScope = 'round' | 'task' | 'project' | 'studio';

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
  expected_hash: string | null;
  expected_size: number | null;
  expected_media_type: string | null;
  phase: 'prepared' | 'moved';
}

interface PendingImportAsset { kind: AssetKind; mediaType: string; contentHash: string; byteSize: number; source: Record<string, unknown>; }
interface AssetRelationInput { targetType: string; targetId: string; relationType: string; metadata?: Record<string, unknown>; }
interface ExpectedMediaIdentity { mediaType: string; contentHash: string; byteSize: number; }

function parseObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}
function parseRequiredObject(value: string | null, label: string): Record<string, unknown> {
  if (value === null) throw new InvalidCommandError(label + ' is missing.');
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch { throw new InvalidCommandError(label + ' is invalid.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InvalidCommandError(label + ' is invalid.');
  return parsed as Record<string, unknown>;
}


function assetFromRow(row: StoredAsset): StudioAsset {
  return { id: row.id, studioId: row.studio_id, kind: row.kind, mediaType: row.media_type, storagePath: row.storage_path, contentHash: row.content_hash, byteSize: row.byte_size, source: parseObject(row.source_json), deletedAt: row.deleted_at };
}

function ensureStudio(db: StudioDatabase, studioId: string): void {
  if (!db.prepare('SELECT id FROM studios WHERE id = ?').get(studioId)) throw new StudioNotFoundError('Studio not found: ' + studioId);
}

function bucketForKind(kind: AssetKind): AssetBucket {
  return kind === 'import' ? 'imports' : kind === 'generated' ? 'generated' : 'exports';
}

function rootForAsset(asset: Pick<StudioAsset, 'kind' | 'deletedAt'>): ManagedMediaRoot {
  return asset.deletedAt ? 'trash' : bucketForKind(asset.kind);
}

function relativePath(paths: StudioPaths, absolutePath: string): string {
  const relative = path.relative(paths.workspaceRoot, absolutePath);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new InvalidCommandError('Managed media must remain in the Studio workspace.');
  return relative.split(path.sep).join('/');
}

function assertRelationTarget(targetType: string, targetId: string): void {
  if (!/^(studio|project|creative_task|creative_round|run_item|style_kit|brand_kit|delivery)$/.test(targetType)) throw new InvalidCommandError('Unsupported asset relation target.');
  if (!String(targetId || '').trim()) throw new InvalidCommandError('Asset relation target id is required.');
}

function linkAsset(db: StudioDatabase, assetId: string, targetType: string, targetId: string, relationType: string, metadata: Record<string, unknown> = {}): void {
  assertRelationTarget(targetType, targetId);
  db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(asset_id, relation_type, target_type, target_id) DO UPDATE SET metadata_json = excluded.metadata_json').run(createId('assetrel'), assetId, relationType, targetType, targetId, JSON.stringify(metadata), nowIso());
}

function insertMediaOperation(db: StudioDatabase, input: { studioId: string; assetId: string; operation: PendingAssetOperation['operation']; sourcePath: string; targetPath: string; expected: ExpectedMediaIdentity; asset?: PendingImportAsset; relation?: AssetRelationInput }): void {
  db.prepare('INSERT INTO asset_media_operations (id, studio_id, asset_id, operation, source_path, target_path, asset_json, relation_json, expected_hash, expected_size, expected_media_type, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(createId('assetop'), input.studioId, input.assetId, input.operation, input.sourcePath, input.targetPath, input.asset ? JSON.stringify(input.asset) : null, input.relation ? JSON.stringify(input.relation) : null, input.expected.contentHash, input.expected.byteSize, input.expected.mediaType, 'prepared', nowIso());
}

function assertNoPendingMediaOperation(db: StudioDatabase, studioId: string, assetId: string): void {
  if (db.prepare('SELECT id FROM asset_media_operations WHERE studio_id = ? AND asset_id = ? LIMIT 1').get(studioId, assetId)) throw new InvalidCommandError('Asset has a pending media operation that requires recovery or diagnosis.');
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

function markMediaOperationMoved(db: StudioDatabase, operationId: string): void {
  withTransaction(db, () => { db.prepare("UPDATE asset_media_operations SET phase = 'moved' WHERE id = ?").run(operationId); });
}

function finishImport(db: StudioDatabase, entry: PendingAssetOperation, asset: PendingImportAsset, relation: AssetRelationInput | null): void {
  const existing = db.prepare('SELECT id FROM assets WHERE id = ? AND studio_id = ?').get(entry.asset_id, entry.studio_id) as { id: string } | undefined;
  if (!existing) {
    const timestamp = nowIso();
    db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(entry.asset_id, entry.studio_id, asset.kind, asset.mediaType, entry.target_path, asset.contentHash, asset.byteSize, JSON.stringify(asset.source), timestamp, timestamp);
    appendStudioEvent(db, { studioId: entry.studio_id, entityType: 'asset', entityId: entry.asset_id, eventType: 'asset.imported', payload: { mediaType: asset.mediaType, byteSize: asset.byteSize, recovered: true } });
  }
  if (relation) linkAsset(db, entry.asset_id, relation.targetType, relation.targetId, relation.relationType, relation.metadata || {});
  db.prepare('DELETE FROM asset_media_operations WHERE id = ?').run(entry.id);
}

function storedAssetForOperation(db: StudioDatabase, entry: PendingAssetOperation): StoredAsset | null {
  return (db.prepare('SELECT id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, deleted_at FROM assets WHERE id = ? AND studio_id = ?').get(entry.asset_id, entry.studio_id) as StoredAsset | undefined) || null;
}

function expectedIdentity(entry: PendingAssetOperation, stored: StoredAsset | null): ExpectedMediaIdentity {
  const mediaType = entry.expected_media_type || '';
  const contentHash = entry.expected_hash || '';
  const byteSize = entry.expected_size;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mediaType) || !/^[a-f0-9]{64}$/.test(contentHash) || !Number.isSafeInteger(byteSize) || Number(byteSize) <= 0) throw new InvalidCommandError('Media recovery journal expected identity metadata is invalid.');
  if (entry.operation !== 'import' && (!stored || stored.media_type !== mediaType || stored.content_hash !== contentHash || stored.byte_size !== byteSize)) throw new InvalidCommandError('Asset metadata no longer matches its media recovery journal.');
  return { mediaType, contentHash, byteSize: Number(byteSize) };
}

function relationBelongsToStudio(db: StudioDatabase, studioId: string, targetType: string, targetId: string): boolean {
  if (targetType === 'studio') return targetId === studioId && Boolean(db.prepare('SELECT id FROM studios WHERE id = ?').get(targetId));
  if (targetType === 'project') return Boolean(db.prepare('SELECT id FROM projects WHERE id = ? AND studio_id = ?').get(targetId, studioId));
  if (targetType === 'creative_task') return Boolean(db.prepare('SELECT task.id FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.id = ? AND project.studio_id = ?').get(targetId, studioId));
  if (targetType === 'creative_round') return Boolean(db.prepare('SELECT round.id FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.id = ? AND project.studio_id = ?').get(targetId, studioId));
  if (targetType === 'run_item') return Boolean(db.prepare('SELECT item.id FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE item.id = ? AND project.studio_id = ?').get(targetId, studioId));
  if (targetType === 'style_kit') return Boolean(db.prepare('SELECT id FROM style_kits WHERE id = ? AND studio_id = ?').get(targetId, studioId));
  if (targetType === 'brand_kit') return Boolean(db.prepare('SELECT id FROM brand_kits WHERE id = ? AND studio_id = ?').get(targetId, studioId));
  if (targetType === 'delivery') return Boolean(db.prepare('SELECT delivery.id FROM deliveries delivery JOIN projects project ON project.id = delivery.project_id WHERE delivery.id = ? AND project.studio_id = ?').get(targetId, studioId));
  return false;
}

function importRecoveryMetadata(db: StudioDatabase, entry: PendingAssetOperation, expected: ExpectedMediaIdentity): { asset: PendingImportAsset; relation: AssetRelationInput | null } {
  if (entry.operation !== 'import') throw new InvalidCommandError('Only import journals may contain import metadata.');
  const rawAsset = parseRequiredObject(entry.asset_json, 'Import recovery journal metadata');
  if (rawAsset.kind !== 'import' || rawAsset.mediaType !== expected.mediaType || rawAsset.contentHash !== expected.contentHash || rawAsset.byteSize !== expected.byteSize || !rawAsset.source || typeof rawAsset.source !== 'object' || Array.isArray(rawAsset.source)) throw new InvalidCommandError('Import recovery journal metadata does not match its expected identity.');
  let relation: AssetRelationInput | null = null;
  if (entry.relation_json !== null) {
    const rawRelation = parseRequiredObject(entry.relation_json, 'Import recovery relation');
    if (typeof rawRelation.targetType !== 'string' || typeof rawRelation.targetId !== 'string' || rawRelation.relationType !== 'attached_to') throw new InvalidCommandError('Import recovery relation is invalid for its operation.');
    assertRelationTarget(rawRelation.targetType, rawRelation.targetId);
    if (!relationBelongsToStudio(db, entry.studio_id, rawRelation.targetType, rawRelation.targetId)) throw new InvalidCommandError('Import recovery relation target does not belong to its Studio.');
    if (rawRelation.metadata !== undefined && (!rawRelation.metadata || typeof rawRelation.metadata !== 'object' || Array.isArray(rawRelation.metadata))) throw new InvalidCommandError('Import recovery relation metadata is invalid.');
    relation = { targetType: rawRelation.targetType, targetId: rawRelation.targetId, relationType: rawRelation.relationType, metadata: rawRelation.metadata as Record<string, unknown> | undefined };
  }
  return { asset: rawAsset as unknown as PendingImportAsset, relation };
}

function recoveryRoots(entry: PendingAssetOperation, stored: StoredAsset | null): { source: ManagedMediaRoot; target: ManagedMediaRoot } {
  if (entry.operation === 'import') return { source: 'staging', target: 'imports' };
  if (!stored) throw new InvalidCommandError('Media recovery journal references an unknown asset.');
  const bucket = bucketForKind(stored.kind);
  return entry.operation === 'trash' ? { source: bucket, target: 'trash' } : { source: 'trash', target: bucket };
}

function recordRecoveryRejection(db: StudioDatabase, entry: PendingAssetOperation, reason: string): void {
  const exists = db.prepare("SELECT id FROM events WHERE studio_id = ? AND entity_type = 'media_operation' AND entity_id = ? AND event_type = 'media.recovery_rejected' LIMIT 1").get(entry.studio_id, entry.id);
  if (exists) return;
  withTransaction(db, () => appendStudioEvent(db, { studioId: entry.studio_id, entityType: 'media_operation', entityId: entry.id, eventType: 'media.recovery_rejected', payload: { operation: entry.operation, reason } }));
}

export function recoverAssetMediaOperations(db: StudioDatabase, paths: StudioPaths, studioId: string): number {
  const operations = db.prepare('SELECT id, studio_id, asset_id, operation, source_path, target_path, asset_json, relation_json, expected_hash, expected_size, expected_media_type, phase FROM asset_media_operations WHERE studio_id = ? ORDER BY created_at').all(studioId) as unknown as PendingAssetOperation[];
  let recovered = 0;
  for (const entry of operations) {
    try {
      if (entry.phase !== 'prepared' && entry.phase !== 'moved') throw new InvalidCommandError('Media recovery journal phase is invalid.');
      const stored = storedAssetForOperation(db, entry);
      if (entry.operation === 'import' && stored) throw new InvalidCommandError('Import recovery journal conflicts with an existing asset.');
      if (entry.operation !== 'import' && (entry.asset_json !== null || entry.relation_json !== null)) throw new InvalidCommandError('Non-import recovery journals may not contain import metadata or relations.');
      const expected = expectedIdentity(entry, stored);
      const importMetadata = entry.operation === 'import' ? importRecoveryMetadata(db, entry, expected) : null;
      const roots = recoveryRoots(entry, stored);
      const source = resolveManagedMediaPath(paths, entry.source_path, roots.source, { mustExist: false });
      const target = resolveManagedMediaPath(paths, entry.target_path, roots.target, { mustExist: false });
      const sourceExists = fs.existsSync(source);
      const targetExists = fs.existsSync(target);
      if (sourceExists && targetExists) throw new InvalidCommandError('Media recovery found an ambiguous duplicate file state.');
      if (targetExists) {
        inspectManagedImageFile(paths, entry.target_path, roots.target, expected);
      } else {
        if (!sourceExists) throw new InvalidCommandError('Media recovery source and target are both missing.');
        inspectManagedImageFile(paths, entry.source_path, roots.source, expected);
        moveManagedMedia(source, target);
        markMediaOperationMoved(db, entry.id);
        inspectManagedImageFile(paths, entry.target_path, roots.target, expected);
      }
      withTransaction(db, () => {
        if (entry.operation === 'import') {
          if (!importMetadata) throw new InvalidCommandError('Import recovery journal metadata is missing.');
          finishImport(db, entry, importMetadata.asset, importMetadata.relation);
          return;
        }
        const current = storedAssetForOperation(db, entry);
        if (!current || current.content_hash !== expected.contentHash || current.byte_size !== expected.byteSize || current.media_type !== expected.mediaType) throw new InvalidCommandError('Asset metadata no longer matches its media recovery journal.');
        const timestamp = nowIso();
        if (entry.operation === 'trash') {
          const changed = current.storage_path !== entry.target_path || !current.deleted_at;
          if (changed) {
            db.prepare('UPDATE assets SET storage_path = ?, deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ? AND studio_id = ?').run(entry.target_path, timestamp, timestamp, entry.asset_id, studioId);
            appendStudioEvent(db, { studioId, entityType: 'asset', entityId: entry.asset_id, eventType: 'asset.trashed_recovered', payload: {} });
          }
        } else {
          const changed = current.storage_path !== entry.target_path || Boolean(current.deleted_at);
          if (changed) {
            db.prepare('UPDATE assets SET storage_path = ?, deleted_at = NULL, updated_at = ? WHERE id = ? AND studio_id = ?').run(entry.target_path, timestamp, entry.asset_id, studioId);
            appendStudioEvent(db, { studioId, entityType: 'asset', entityId: entry.asset_id, eventType: 'asset.restored_recovered', payload: {} });
          }
        }
        db.prepare('DELETE FROM asset_media_operations WHERE id = ?').run(entry.id);
      });
      recovered += 1;
    } catch (error) {
      const reason = error instanceof Error && /identity|metadata|changed|duplicate/i.test(error.message) ? 'identity_mismatch' : 'invalid_or_missing_media';
      recordRecoveryRejection(db, entry, reason);
    }
  }
  return recovered;
}

export function importStagedStudioAsset(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; staged: StagedImage; declaredMediaType?: string; originalFilename?: string; targetType?: string; targetId?: string; source?: Record<string, unknown> }): StudioAsset {
  ensureStudio(db, input.studioId);
  recoverAssetMediaOperations(db, paths, input.studioId);
  const staged = input.staged;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(staged.mediaType)) throw new MediaValidationError('Only PNG, JPEG, WebP, and GIF images can be imported.');
  if (input.declaredMediaType && input.declaredMediaType !== staged.mediaType) throw new MediaValidationError('Declared image type does not match file content.');
  const matches = db.prepare('SELECT id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, deleted_at FROM assets WHERE studio_id = ? AND content_hash = ? ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, created_at').all(input.studioId, staged.contentHash) as unknown as StoredAsset[];
  const active = matches.find((asset) => !asset.deleted_at);
  if (active) {
    discardStagedImage(staged);
    withTransaction(db, () => {
      if (input.targetType && input.targetId) linkAsset(db, active.id, input.targetType, input.targetId, 'attached_to');
      appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: active.id, eventType: 'asset.reused', payload: { source: 'import' } });
    });
    return assetFromRow(active);
  }
  const deleted = matches[0];
  if (deleted) {
    discardStagedImage(staged);
    const restored = restoreAsset(db, paths, { studioId: input.studioId, assetId: deleted.id });
    withTransaction(db, () => {
      if (input.targetType && input.targetId) linkAsset(db, restored.id, input.targetType, input.targetId, 'attached_to');
      appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: restored.id, eventType: 'asset.restored_reused', payload: { source: 'import' } });
    });
    return restored;
  }
  const assetId = createId('asset');
  const planned = plannedArchivePath(paths, { assetId, bucket: 'imports', mediaType: staged.mediaType });
  const source = { ...input.source, originalFilename: input.originalFilename || null, importedAt: nowIso() };
  const relation = input.targetType && input.targetId ? { targetType: input.targetType, targetId: input.targetId, relationType: 'attached_to' } : undefined;
  const expected = { mediaType: staged.mediaType, contentHash: staged.contentHash, byteSize: staged.byteSize };
  withTransaction(db, () => insertMediaOperation(db, { studioId: input.studioId, assetId, operation: 'import', sourcePath: relativePath(paths, staged.stagingPath), targetPath: planned.storagePath, expected, asset: { kind: 'import', ...expected, source }, relation }));
  archiveStagedImage(paths, staged, { assetId, bucket: 'imports' });
  const operation = db.prepare("SELECT id, studio_id, asset_id, operation, source_path, target_path, asset_json, relation_json, expected_hash, expected_size, expected_media_type, phase FROM asset_media_operations WHERE asset_id = ? AND operation = 'import'").get(assetId) as unknown as PendingAssetOperation;
  markMediaOperationMoved(db, operation.id);
  withTransaction(db, () => finishImport(db, operation, { kind: 'import', ...expected, source }, relation || null));
  return { id: assetId, studioId: input.studioId, kind: 'import', mediaType: staged.mediaType, storagePath: planned.storagePath, contentHash: staged.contentHash, byteSize: staged.byteSize, source, deletedAt: null };
}

export function importStudioAsset(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; bytes: Buffer; mediaType?: string; originalFilename?: string; targetType?: string; targetId?: string; source?: Record<string, unknown> }): StudioAsset {
  return importStagedStudioAsset(db, paths, { ...input, staged: stageImage(paths, input.bytes, input.mediaType) });
}

export async function importStagedStudioAssetAsync(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; staged: StagedImage; declaredMediaType?: string; originalFilename?: string; targetType?: string; targetId?: string; source?: Record<string, unknown>; archiveStagedImage?: (staged: StagedImage, input: { assetId: string; bucket: 'imports' }) => Promise<ArchivedImage> }): Promise<StudioAsset> {
  ensureStudio(db, input.studioId);
  recoverAssetMediaOperations(db, paths, input.studioId);
  const staged = input.staged;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(staged.mediaType)) throw new MediaValidationError('Only PNG, JPEG, WebP, and GIF images can be imported.');
  if (input.declaredMediaType && input.declaredMediaType !== staged.mediaType) throw new MediaValidationError('Declared image type does not match file content.');
  const matches = db.prepare('SELECT id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, deleted_at FROM assets WHERE studio_id = ? AND content_hash = ? ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, created_at').all(input.studioId, staged.contentHash) as unknown as StoredAsset[];
  const active = matches.find((asset) => !asset.deleted_at);
  if (active) {
    discardStagedImage(staged);
    withTransaction(db, () => {
      if (input.targetType && input.targetId) linkAsset(db, active.id, input.targetType, input.targetId, 'attached_to');
      appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: active.id, eventType: 'asset.reused', payload: { source: 'import' } });
    });
    return assetFromRow(active);
  }
  const deleted = matches[0];
  if (deleted) {
    discardStagedImage(staged);
    const restored = restoreAsset(db, paths, { studioId: input.studioId, assetId: deleted.id });
    withTransaction(db, () => {
      if (input.targetType && input.targetId) linkAsset(db, restored.id, input.targetType, input.targetId, 'attached_to');
      appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: restored.id, eventType: 'asset.restored_reused', payload: { source: 'import' } });
    });
    return restored;
  }
  const assetId = createId('asset');
  const planned = plannedArchivePath(paths, { assetId, bucket: 'imports', mediaType: staged.mediaType });
  const source = { ...input.source, originalFilename: input.originalFilename || null, importedAt: nowIso() };
  const relation = input.targetType && input.targetId ? { targetType: input.targetType, targetId: input.targetId, relationType: 'attached_to' } : undefined;
  const expected = { mediaType: staged.mediaType, contentHash: staged.contentHash, byteSize: staged.byteSize };
  withTransaction(db, () => insertMediaOperation(db, { studioId: input.studioId, assetId, operation: 'import', sourcePath: relativePath(paths, staged.stagingPath), targetPath: planned.storagePath, expected, asset: { kind: 'import', ...expected, source }, relation }));
  if (input.archiveStagedImage) await input.archiveStagedImage(staged, { assetId, bucket: 'imports' });
  else await archiveStagedImageAsync(paths, staged, { assetId, bucket: 'imports' });
  const operation = db.prepare("SELECT id, studio_id, asset_id, operation, source_path, target_path, asset_json, relation_json, expected_hash, expected_size, expected_media_type, phase FROM asset_media_operations WHERE asset_id = ? AND operation = 'import'").get(assetId) as unknown as PendingAssetOperation;
  markMediaOperationMoved(db, operation.id);
  withTransaction(db, () => finishImport(db, operation, { kind: 'import', ...expected, source }, relation || null));
  return { id: assetId, studioId: input.studioId, kind: 'import', mediaType: staged.mediaType, storagePath: planned.storagePath, contentHash: staged.contentHash, byteSize: staged.byteSize, source, deletedAt: null };
}

function assetVisibilitySql(prefix: string, input: { includeDeleted?: boolean; deletedOnly?: boolean }): string {
  const column = prefix ? prefix + '.deleted_at' : 'deleted_at';
  return input.deletedOnly ? column + ' IS NOT NULL' : input.includeDeleted ? '1 = 1' : column + ' IS NULL';
}
function assetKindCondition(prefix: string, kind?: AssetKind): { sql: string; values: AssetKind[] } {
  if (!kind) return { sql: '1 = 1', values: [] };
  if (!['import', 'generated', 'export'].includes(kind)) throw new InvalidCommandError('Unknown asset kind.');
  return { sql: (prefix ? prefix + '.' : '') + 'kind = ?', values: [kind] };
}



export function listStudioAssets(db: StudioDatabase, studioId: string, input: { includeDeleted?: boolean; deletedOnly?: boolean; targetType?: string; targetId?: string; kind?: AssetKind; limit?: number; offset?: number } = {}): StudioAsset[] {
  ensureStudio(db, studioId);
  const limit = Math.min(500, Math.max(1, Number.isInteger(input.limit) ? Number(input.limit) : 100));
  const offset = Math.max(0, Number.isInteger(input.offset) ? Number(input.offset) : 0);
  const kind = assetKindCondition('a', input.kind);
  if (input.targetType && input.targetId) {
    assertRelationTarget(input.targetType, input.targetId);
    return (db.prepare('SELECT a.id, a.studio_id, a.kind, a.media_type, a.storage_path, a.content_hash, a.byte_size, a.source_json, a.deleted_at FROM assets a WHERE a.studio_id = ? AND EXISTS (SELECT 1 FROM asset_relations r WHERE r.asset_id = a.id AND r.target_type = ? AND r.target_id = ?) AND ' + assetVisibilitySql('a', input) + ' AND ' + kind.sql + ' ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?').all(studioId, input.targetType, input.targetId, ...kind.values, limit, offset) as unknown as StoredAsset[]).map(assetFromRow);
  }
  return (db.prepare('SELECT a.id, a.studio_id, a.kind, a.media_type, a.storage_path, a.content_hash, a.byte_size, a.source_json, a.deleted_at FROM assets a WHERE a.studio_id = ? AND ' + assetVisibilitySql('a', input) + ' AND ' + kind.sql + ' ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?').all(studioId, ...kind.values, limit, offset) as unknown as StoredAsset[]).map(assetFromRow);
}

export function countStudioAssets(db: StudioDatabase, studioId: string, input: { includeDeleted?: boolean; deletedOnly?: boolean; targetType?: string; targetId?: string; kind?: AssetKind } = {}): number {
  ensureStudio(db, studioId);
  const kind = assetKindCondition('a', input.kind);
  if (input.targetType && input.targetId) {
    assertRelationTarget(input.targetType, input.targetId);
    const row = db.prepare('SELECT COUNT(*) AS total FROM assets a WHERE a.studio_id = ? AND EXISTS (SELECT 1 FROM asset_relations r WHERE r.asset_id = a.id AND r.target_type = ? AND r.target_id = ?) AND ' + assetVisibilitySql('a', input) + ' AND ' + kind.sql).get(studioId, input.targetType, input.targetId, ...kind.values) as { total: number };
    return Number(row.total);
  }
  const row = db.prepare('SELECT COUNT(*) AS total FROM assets a WHERE a.studio_id = ? AND ' + assetVisibilitySql('a', input) + ' AND ' + kind.sql).get(studioId, ...kind.values) as { total: number };
  return Number(row.total);
}

export function listSharedStudioAssets(db: StudioDatabase, studioId: string, input: { limit?: number } = {}): StudioAsset[] {
  ensureStudio(db, studioId);
  const limit = Math.min(500, Math.max(1, Number.isInteger(input.limit) ? Number(input.limit) : 100));
  const query = "SELECT a.id, a.studio_id, a.kind, a.media_type, a.storage_path, a.content_hash, a.byte_size, a.source_json, a.deleted_at FROM assets a WHERE a.studio_id = ? AND a.deleted_at IS NULL AND EXISTS (SELECT 1 FROM asset_relations relation WHERE relation.asset_id = a.id AND relation.relation_type = 'shared_across_projects' AND relation.target_type = 'studio' AND relation.target_id = ?) ORDER BY a.created_at DESC, a.id DESC LIMIT ?";
  return (db.prepare(query).all(studioId, studioId, limit) as unknown as StoredAsset[]).map(assetFromRow);
}

export function setStudioAssetShared(db: StudioDatabase, input: { studioId: string; assetId: string; shared: boolean }): { assetId: string; shared: boolean; changed: boolean } {
  ensureStudio(db, input.studioId);
  const asset = getStudioAsset(db, input.studioId, input.assetId);
  if (!asset || asset.deletedAt) throw new StudioNotFoundError('Active Studio asset not found: ' + input.assetId);
  let changed = false;
  withTransaction(db, () => {
    if (input.shared) {
      const result = db.prepare("INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, 'shared_across_projects', 'studio', ?, '{}', ?) ON CONFLICT(asset_id, relation_type, target_type, target_id) DO NOTHING").run(createId('assetrel'), asset.id, input.studioId, nowIso());
      changed = Number(result.changes) > 0;
    } else {
      const result = db.prepare("DELETE FROM asset_relations WHERE asset_id = ? AND relation_type = 'shared_across_projects' AND target_type = 'studio' AND target_id = ?").run(asset.id, input.studioId);
      changed = Number(result.changes) > 0;
    }
    if (changed) appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: asset.id, eventType: input.shared ? 'asset.shared_across_projects' : 'asset.unshared_across_projects', payload: {} });
  });
  return { assetId: asset.id, shared: input.shared, changed };
}

function scopedAssetCondition(scope: AssetScope, input: { projectId?: string; taskId?: string; roundId?: string }): { sql: string; values: string[] } {
  if (scope === 'studio') return { sql: '1 = 1', values: [] };
  if (scope === 'round') {
    const roundId = String(input.roundId || '').trim();
    if (!roundId) throw new InvalidCommandError('Round asset scope requires roundId.');
    return { sql: "EXISTS (SELECT 1 FROM asset_relations relation WHERE relation.asset_id = a.id AND ((relation.target_type = 'creative_round' AND relation.target_id = ?) OR (relation.target_type = 'run_item' AND relation.relation_type = 'output_of' AND EXISTS (SELECT 1 FROM run_items item JOIN generation_runs run ON run.id = item.run_id WHERE item.id = relation.target_id AND run.round_id = ?))))", values: [roundId, roundId] };
  }
  if (scope === 'task') {
    const taskId = String(input.taskId || '').trim();
    if (!taskId) throw new InvalidCommandError('Task asset scope requires taskId.');
    return { sql: "EXISTS (SELECT 1 FROM asset_relations relation WHERE relation.asset_id = a.id AND ((relation.target_type = 'creative_task' AND relation.target_id = ?) OR (relation.target_type = 'creative_round' AND EXISTS (SELECT 1 FROM creative_rounds round WHERE round.id = relation.target_id AND round.task_id = ?)) OR (relation.target_type = 'run_item' AND relation.relation_type = 'output_of' AND EXISTS (SELECT 1 FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id WHERE item.id = relation.target_id AND round.task_id = ?))))", values: [taskId, taskId, taskId] };
  }
  const projectId = String(input.projectId || '').trim();
  if (!projectId) throw new InvalidCommandError('Project asset scope requires projectId.');
  return { sql: "EXISTS (SELECT 1 FROM asset_relations relation WHERE relation.asset_id = a.id AND ((relation.target_type = 'project' AND relation.target_id = ?) OR (relation.target_type = 'creative_task' AND EXISTS (SELECT 1 FROM creative_tasks task WHERE task.id = relation.target_id AND task.project_id = ?)) OR (relation.target_type = 'creative_round' AND EXISTS (SELECT 1 FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id WHERE round.id = relation.target_id AND task.project_id = ?)) OR (relation.target_type = 'run_item' AND relation.relation_type = 'output_of' AND EXISTS (SELECT 1 FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id WHERE item.id = relation.target_id AND task.project_id = ?))))", values: [projectId, projectId, projectId, projectId] };
}

function assertScopedAssetHierarchy(db: StudioDatabase, studioId: string, input: { scope: AssetScope; projectId?: string; taskId?: string; roundId?: string }): void {
  if (input.scope === 'studio') return;
  if (input.scope === 'project') {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND studio_id = ?').get(String(input.projectId || ''), studioId) as { id: string } | undefined;
    if (!project) throw new InvalidCommandError('Project asset scope is not part of this Studio.');
    return;
  }
  if (input.scope === 'task') {
    const task = db.prepare('SELECT task.id, task.project_id FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.id = ? AND project.studio_id = ?').get(String(input.taskId || ''), studioId) as { id: string; project_id: string } | undefined;
    if (!task || (input.projectId && input.projectId !== task.project_id)) throw new InvalidCommandError('Task asset scope is not part of this Studio project.');
    return;
  }
  const round = db.prepare('SELECT round.id, round.task_id, task.project_id FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.id = ? AND project.studio_id = ?').get(String(input.roundId || ''), studioId) as { id: string; task_id: string; project_id: string } | undefined;
  if (!round || (input.taskId && input.taskId !== round.task_id) || (input.projectId && input.projectId !== round.project_id)) throw new InvalidCommandError('Round asset scope is not part of this Studio task.');
}

export function listScopedStudioAssets(db: StudioDatabase, studioId: string, input: { scope: AssetScope; projectId?: string; taskId?: string; roundId?: string; includeDeleted?: boolean; deletedOnly?: boolean; kind?: AssetKind; limit?: number; offset?: number }): StudioAsset[] {
  ensureStudio(db, studioId);
  assertScopedAssetHierarchy(db, studioId, input);
  const limit = Math.min(500, Math.max(1, Number.isInteger(input.limit) ? Number(input.limit) : 100));
  const offset = Math.max(0, Number.isInteger(input.offset) ? Number(input.offset) : 0);
  const condition = scopedAssetCondition(input.scope, input);
  const kind = assetKindCondition('a', input.kind);
  const query = 'SELECT a.id, a.studio_id, a.kind, a.media_type, a.storage_path, a.content_hash, a.byte_size, a.source_json, a.deleted_at FROM assets a WHERE a.studio_id = ? AND ' + assetVisibilitySql('a', input) + ' AND ' + kind.sql + ' AND (' + condition.sql + ') ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?';
  return (db.prepare(query).all(studioId, ...kind.values, ...condition.values, limit, offset) as unknown as StoredAsset[]).map(assetFromRow);
}

export function countScopedStudioAssets(db: StudioDatabase, studioId: string, input: { scope: AssetScope; projectId?: string; taskId?: string; roundId?: string; includeDeleted?: boolean; deletedOnly?: boolean; kind?: AssetKind }): number {
  ensureStudio(db, studioId);
  assertScopedAssetHierarchy(db, studioId, input);
  const condition = scopedAssetCondition(input.scope, input);
  const kind = assetKindCondition('a', input.kind);
  const query = 'SELECT COUNT(*) AS total FROM assets a WHERE a.studio_id = ? AND ' + assetVisibilitySql('a', input) + ' AND ' + kind.sql + ' AND (' + condition.sql + ')';
  const row = db.prepare(query).get(studioId, ...kind.values, ...condition.values) as { total: number };
  return Number(row.total);
}

export function getStudioAsset(db: StudioDatabase, studioId: string, assetId: string): StudioAsset | null {
  const row = db.prepare('SELECT id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, deleted_at FROM assets WHERE studio_id = ? AND id = ?').get(studioId, assetId) as StoredAsset | undefined;
  return row ? assetFromRow(row) : null;
}

export function assetFilePath(paths: StudioPaths, asset: StudioAsset): string {
  return inspectManagedImageFile(paths, asset.storagePath, rootForAsset(asset), { mediaType: asset.mediaType, contentHash: asset.contentHash, byteSize: asset.byteSize }).absolutePath;
}

export function createAssetSnapshot(paths: StudioPaths, asset: StudioAsset): VerifiedManagedFile {
  const sourcePath = resolveManagedMediaPath(paths, asset.storagePath, rootForAsset(asset));
  return createVerifiedSnapshot(sourcePath, { mediaType: asset.mediaType, contentHash: asset.contentHash, byteSize: asset.byteSize, minByteSize: 1, maxByteSize: 100 * 1024 * 1024, requireImage: true }, { snapshotDirectory: ensureCacheDirectory(paths, 'staging') });
}

export function createAssetSnapshotAsync(paths: StudioPaths, asset: StudioAsset): Promise<VerifiedManagedFile> {
  const sourcePath = resolveManagedMediaPath(paths, asset.storagePath, rootForAsset(asset));
  return createVerifiedSnapshotAsync(sourcePath, { mediaType: asset.mediaType, contentHash: asset.contentHash, byteSize: asset.byteSize, minByteSize: 1, maxByteSize: 100 * 1024 * 1024, requireImage: true }, { snapshotDirectory: ensureCacheDirectory(paths, 'staging') });
}

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
  assertNoPendingMediaOperation(db, input.studioId, asset.id);
  const sourcePath = assetFilePath(paths, asset);
  const planned = plannedArchivePath(paths, { assetId: asset.id, bucket: 'trash', mediaType: asset.mediaType });
  const expected = { mediaType: asset.mediaType, contentHash: asset.contentHash, byteSize: asset.byteSize };
  withTransaction(db, () => insertMediaOperation(db, { studioId: input.studioId, assetId: asset.id, operation: 'trash', sourcePath: asset.storagePath, targetPath: planned.storagePath, expected }));
  const operation = db.prepare("SELECT id FROM asset_media_operations WHERE studio_id = ? AND asset_id = ? AND operation = 'trash'").get(input.studioId, asset.id) as { id: string };
  moveManagedMedia(sourcePath, planned.absolutePath);
  markMediaOperationMoved(db, operation.id);
  inspectManagedImageFile(paths, planned.storagePath, 'trash', expected);
  const timestamp = nowIso();
  withTransaction(db, () => {
    db.prepare('UPDATE assets SET storage_path = ?, deleted_at = ?, updated_at = ? WHERE id = ? AND studio_id = ?').run(planned.storagePath, timestamp, timestamp, asset.id, input.studioId);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: asset.id, eventType: 'asset.trashed', payload: {} });
    db.prepare('DELETE FROM asset_media_operations WHERE id = ?').run(operation.id);
  });
  return { ...asset, storagePath: planned.storagePath, deletedAt: timestamp };
}

export function restoreAsset(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; assetId: string }): StudioAsset {
  recoverAssetMediaOperations(db, paths, input.studioId);
  const asset = getStudioAsset(db, input.studioId, input.assetId);
  if (!asset) throw new StudioNotFoundError('Asset not found: ' + input.assetId);
  if (!asset.deletedAt) return asset;
  assertNoPendingMediaOperation(db, input.studioId, asset.id);
  const sourcePath = assetFilePath(paths, asset);
  const bucket = bucketForKind(asset.kind);
  const planned = plannedArchivePath(paths, { assetId: asset.id, bucket, mediaType: asset.mediaType });
  const expected = { mediaType: asset.mediaType, contentHash: asset.contentHash, byteSize: asset.byteSize };
  withTransaction(db, () => insertMediaOperation(db, { studioId: input.studioId, assetId: asset.id, operation: 'restore', sourcePath: asset.storagePath, targetPath: planned.storagePath, expected }));
  const operation = db.prepare("SELECT id FROM asset_media_operations WHERE studio_id = ? AND asset_id = ? AND operation = 'restore'").get(input.studioId, asset.id) as { id: string };
  moveManagedMedia(sourcePath, planned.absolutePath);
  markMediaOperationMoved(db, operation.id);
  inspectManagedImageFile(paths, planned.storagePath, bucket, expected);
  const timestamp = nowIso();
  withTransaction(db, () => {
    db.prepare('UPDATE assets SET storage_path = ?, deleted_at = NULL, updated_at = ? WHERE id = ? AND studio_id = ?').run(planned.storagePath, timestamp, asset.id, input.studioId);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: asset.id, eventType: 'asset.restored', payload: {} });
    db.prepare('DELETE FROM asset_media_operations WHERE id = ?').run(operation.id);
  });
  return { ...asset, storagePath: planned.storagePath, deletedAt: null };
}

export function setReviewDecision(db: StudioDatabase, input: { studioId: string; assetId: string; decision: ReviewDecisionValue; taskId?: string; roundId?: string; feedback?: Record<string, unknown>; emitEvent?: boolean }): void {
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
    if (input.emitEvent !== false) appendStudioEvent(db, { studioId: input.studioId, entityType: 'asset', entityId: asset.id, eventType: 'asset.reviewed', payload: { decision: input.decision } });
  });
}

export function setReviewDecisions(db: StudioDatabase, input: { studioId: string; assetIds: string[]; decision: ReviewDecisionValue; feedback?: Record<string, unknown>; emitEvent?: boolean }): number {
  const assetIds = [...new Set(input.assetIds.map((assetId) => String(assetId || '').trim()).filter(Boolean))];
  if (!assetIds.length || assetIds.length > 500) throw new InvalidCommandError('Batch review requires 1 to 500 assets.');
  if (!['keep', 'review', 'reject', 'derive'].includes(input.decision)) throw new InvalidCommandError('Unsupported review decision.');
  const placeholders = assetIds.map(() => '?').join(',');
  const active = db.prepare('SELECT id FROM assets WHERE studio_id = ? AND deleted_at IS NULL AND id IN (' + placeholders + ')').all(input.studioId, ...assetIds) as Array<{ id: string }>;
  if (active.length !== assetIds.length) throw new StudioNotFoundError('One or more active assets were not found in this Studio.');
  return withTransaction(db, () => {
    const timestamp = nowIso();
    const insert = db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)');
    for (const assetId of assetIds) insert.run(createId('review'), assetId, input.decision, JSON.stringify(input.feedback || {}), timestamp, timestamp);
    if (input.emitEvent !== false) appendStudioEvent(db, { studioId: input.studioId, entityType: 'review', entityId: input.studioId, eventType: 'review.batch_updated', payload: { decision: input.decision, count: assetIds.length } });
    return assetIds.length;
  });
}
