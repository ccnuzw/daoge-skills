import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createAssetSnapshot, createAssetSnapshotAsync, getStudioAsset, StudioAsset } from './assets';
import { createId, nowIso, sha256 } from '../shared/ids';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { executeIdempotent, InvalidCommandError, StudioNotFoundError } from './studio-commands';
import { ensureCacheDirectory, StudioPaths } from '../studio/workspace';
import { createVerifiedSnapshot, createVerifiedSnapshotAsync, openVerifiedManagedFile, openVerifiedManagedFileAsync, VerifiedManagedFile } from '../media/archive';

export interface DeliveryAssetSnapshot { assetId: string; sequence: number; source: Record<string, unknown>; review: Record<string, unknown>; asset: { id: string; kind: string; mediaType: string; deletedAt: string | null } | null; }
export interface Delivery { id: string; projectId: string; name: string; status: 'draft' | 'ready' | 'exported'; manifest: Record<string, unknown>; items?: DeliveryAssetSnapshot[]; }
export interface DeliveryExportResult { delivery: Delivery; directory: string; files: string[]; }
export type DeliveryCompletionPhase = 'draft' | 'prepare' | 'export';
export interface DeliveryCompletionResult { operationId: string; stage: Delivery['status']; nextAction: 'prepare' | 'export' | null; delivery: Delivery; files: string[]; }

interface StoredDelivery { id: string; project_id: string; name: string; status: Delivery['status']; manifest_json: string; }
interface ProjectRow { id: string; studio_id: string; name: string; }
interface PendingDeliveryExport { idempotency_key: string; delivery_id: string; studio_id: string; directory_path: string; manifest_json: string; files_json: string; }
interface ExportedFileSnapshot { name: string; contentHash: string; byteSize: number; }
const MAX_DELIVERY_EXPORT_BYTES = 1024 * 1024 * 1024;


function parse(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function delivery(row: StoredDelivery): Delivery { return { id: row.id, projectId: row.project_id, name: row.name, status: row.status, manifest: redacted(parse(row.manifest_json)) as Record<string, unknown> }; }
function requireText(value: string, label: string): string { const text = String(value || '').trim(); if (!text) throw new InvalidCommandError(label + ' is required.'); return text; }
function safeSegment(value: string): string { const normalized = String(value || '').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72); return normalized || 'delivery'; }
function extensionFor(asset: StudioAsset): string { if (asset.mediaType === 'image/jpeg') return '.jpg'; if (asset.mediaType === 'image/webp') return '.webp'; if (asset.mediaType === 'image/gif') return '.gif'; return '.png'; }

function redacted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redacted);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!/(api[_-]?key|authorization|secret|token|base[_-]?url|endpoint|password|external.*request|storage.*path|content.*hash)/i.test(key)) result[key] = redacted(item);
  }
  return result;
}

function assertProject(db: StudioDatabase, studioId: string, projectId: string): ProjectRow {
  const row = db.prepare('SELECT id, studio_id, name FROM projects WHERE id = ? AND studio_id = ?').get(projectId, studioId) as ProjectRow | undefined;
  if (!row) throw new StudioNotFoundError('Project not found: ' + projectId);
  return row;
}

function activeAssets(db: StudioDatabase, studioId: string, assetIds: string[]): StudioAsset[] {
  const ids = [...new Set(assetIds)];
  if (!ids.length) throw new InvalidCommandError('A delivery requires at least one active asset.');
  const rows = db.prepare('SELECT id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, deleted_at FROM assets WHERE studio_id = ? AND id IN (' + ids.map(() => '?').join(',') + ')').all(studioId, ...ids) as Array<{ id: string; studio_id: string; kind: StudioAsset['kind']; media_type: string; storage_path: string; content_hash: string; byte_size: number; source_json: string; deleted_at: string | null }>;
  const assets = new Map(rows.map((row) => [row.id, { id: row.id, studioId: row.studio_id, kind: row.kind, mediaType: row.media_type, storagePath: row.storage_path, contentHash: row.content_hash, byteSize: row.byte_size, source: parse(row.source_json), deletedAt: row.deleted_at }]));
  return ids.map((id) => {
    const asset = assets.get(id);
    if (!asset || asset.deletedAt) throw new StudioNotFoundError('Active Studio asset not found: ' + id);
    return asset;
  });
}

interface ReviewSnapshotRow { id: string; decision: string; feedback_json: string; task_id: string | null; round_id: string | null; created_at: string; }

function projectOwnsAsset(db: StudioDatabase, projectId: string, assetId: string): boolean {
  const row = db.prepare("SELECT 1 FROM asset_relations relation WHERE relation.asset_id = ? AND ((relation.target_type = 'project' AND relation.target_id = ?) OR (relation.target_type = 'creative_task' AND EXISTS (SELECT 1 FROM creative_tasks task WHERE task.id = relation.target_id AND task.project_id = ?)) OR (relation.target_type = 'creative_round' AND EXISTS (SELECT 1 FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id WHERE round.id = relation.target_id AND task.project_id = ?)) OR (relation.target_type = 'run_item' AND relation.relation_type = 'output_of' AND EXISTS (SELECT 1 FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id WHERE item.id = relation.target_id AND task.project_id = ?))) LIMIT 1").get(assetId, projectId, projectId, projectId, projectId) as { 1: number } | undefined;
  return Boolean(row);
}

function latestProjectReview(db: StudioDatabase, projectId: string, assetId: string): ReviewSnapshotRow | null {
  const row = db.prepare("SELECT review.id, review.decision, review.feedback_json, review.task_id, review.round_id, review.created_at FROM review_decisions review LEFT JOIN creative_tasks task ON task.id = review.task_id LEFT JOIN creative_rounds round ON round.id = review.round_id LEFT JOIN creative_tasks round_task ON round_task.id = round.task_id WHERE review.asset_id = ? AND ((review.task_id IS NULL AND review.round_id IS NULL) OR task.project_id = ? OR round_task.project_id = ?) ORDER BY review.created_at DESC, review.rowid DESC LIMIT 1").get(assetId, projectId, projectId) as ReviewSnapshotRow | undefined;
  return row || null;
}

function deliveryItemSnapshot(db: StudioDatabase, project: ProjectRow, asset: StudioAsset, sequence: number): DeliveryAssetSnapshot {
  if (!projectOwnsAsset(db, project.id, asset.id)) throw new InvalidCommandError('Delivery asset does not belong to the selected project: ' + asset.id);
  const review = latestProjectReview(db, project.id, asset.id);
  if (!review || review.decision !== 'keep') throw new InvalidCommandError('Delivery asset requires a current keep review: ' + asset.id);
  return { assetId: asset.id, sequence, source: redacted(asset.source) as Record<string, unknown>, review: { id: review.id, decision: review.decision, feedback: redacted(parse(review.feedback_json)), taskId: review.task_id, roundId: review.round_id, createdAt: review.created_at }, asset: { id: asset.id, kind: asset.kind, mediaType: asset.mediaType, deletedAt: asset.deletedAt } };
}

function replaceDeliveryAssets(db: StudioDatabase, project: ProjectRow, deliveryId: string, assetIds: string[], timestamp: string): DeliveryAssetSnapshot[] {
  const assets = activeAssets(db, project.studio_id, assetIds);
  const ids = assets.map((asset) => asset.id);
  const placeholders = ids.map(() => '?').join(',');
  const ownedRows = db.prepare("SELECT DISTINCT relation.asset_id FROM asset_relations relation WHERE relation.asset_id IN (" + placeholders + ") AND ((relation.target_type = 'project' AND relation.target_id = ?) OR (relation.target_type = 'creative_task' AND EXISTS (SELECT 1 FROM creative_tasks task WHERE task.id = relation.target_id AND task.project_id = ?)) OR (relation.target_type = 'creative_round' AND EXISTS (SELECT 1 FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id WHERE round.id = relation.target_id AND task.project_id = ?)) OR (relation.target_type = 'run_item' AND relation.relation_type = 'output_of' AND EXISTS (SELECT 1 FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id WHERE item.id = relation.target_id AND task.project_id = ?)))").all(...ids, project.id, project.id, project.id, project.id) as Array<{ asset_id: string }>;
  const owned = new Set(ownedRows.map((row) => row.asset_id));
  const reviewRows = db.prepare("WITH ranked_reviews AS (SELECT review.asset_id, review.id, review.decision, review.feedback_json, review.task_id, review.round_id, review.created_at, ROW_NUMBER() OVER (PARTITION BY review.asset_id ORDER BY review.created_at DESC, review.rowid DESC) AS position FROM review_decisions review LEFT JOIN creative_tasks task ON task.id = review.task_id LEFT JOIN creative_rounds round ON round.id = review.round_id LEFT JOIN creative_tasks round_task ON round_task.id = round.task_id WHERE review.asset_id IN (" + placeholders + ") AND ((review.task_id IS NULL AND review.round_id IS NULL) OR task.project_id = ? OR round_task.project_id = ?)) SELECT asset_id, id, decision, feedback_json, task_id, round_id, created_at FROM ranked_reviews WHERE position = 1").all(...ids, project.id, project.id) as unknown as Array<ReviewSnapshotRow & { asset_id: string }>;
  const reviews = new Map(reviewRows.map((row) => [row.asset_id, row]));
  const items = assets.map((asset, index) => {
    if (!owned.has(asset.id)) throw new InvalidCommandError('Delivery asset does not belong to the selected project: ' + asset.id);
    const review = reviews.get(asset.id);
    if (!review || review.decision !== 'keep') throw new InvalidCommandError('Delivery asset requires a current keep review: ' + asset.id);
    return { assetId: asset.id, sequence: index + 1, source: redacted(asset.source) as Record<string, unknown>, review: { id: review.id, decision: review.decision, feedback: redacted(parse(review.feedback_json)), taskId: review.task_id, roundId: review.round_id, createdAt: review.created_at }, asset: { id: asset.id, kind: asset.kind, mediaType: asset.mediaType, deletedAt: asset.deletedAt } };
  });
  db.prepare("DELETE FROM asset_relations WHERE relation_type = 'included_in' AND target_type = 'delivery' AND target_id = ?").run(deliveryId);
  db.prepare('DELETE FROM delivery_assets WHERE delivery_id = ?').run(deliveryId);
  const insertItem = db.prepare('INSERT INTO delivery_assets (delivery_id, asset_id, sequence, source_snapshot_json, review_snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const linkAsset = db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const item of items) {
    insertItem.run(deliveryId, item.assetId, item.sequence, JSON.stringify(item.source), JSON.stringify(item.review), timestamp);
    linkAsset.run(createId('assetrel'), item.assetId, 'included_in', 'delivery', deliveryId, '{}', timestamp);
  }
  return items;
}

export function createDelivery(db: StudioDatabase, input: { studioId: string; projectId: string; name: string; assetIds: string[]; includeCreativeRecord?: boolean; idempotencyKey: string }): Delivery {
  const receipt = executeIdempotent(db, input.studioId, input.idempotencyKey, 'deliveries.create', () => {
    const project = assertProject(db, input.studioId, input.projectId);
    const id = createId('delivery');
    const timestamp = nowIso();
    const name = requireText(input.name, 'Delivery name');
    const manifest = { assetIds: [...new Set(input.assetIds)], includeCreativeRecord: input.includeCreativeRecord === true, createdAt: timestamp };
    db.prepare('INSERT INTO deliveries (id, project_id, name, manifest_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, project.id, name, JSON.stringify(manifest), 'draft', timestamp, timestamp);
    const items = replaceDeliveryAssets(db, project, id, input.assetIds, timestamp);
    appendStudioEvent(db, { studioId: project.studio_id, entityType: 'delivery', entityId: id, eventType: 'delivery.drafted', payload: { projectId: project.id, assetCount: items.length } });
    return { id, projectId: project.id, name, status: 'draft' as const, manifest, items };
  }, input);
  return receipt.value;
}

function storedDelivery(db: StudioDatabase, studioId: string, deliveryId: string): StoredDelivery {
  const value = db.prepare('SELECT delivery.id, delivery.project_id, delivery.name, delivery.status, delivery.manifest_json FROM deliveries delivery JOIN projects project ON project.id = delivery.project_id WHERE delivery.id = ? AND project.studio_id = ?').get(deliveryId, studioId) as StoredDelivery | undefined;
  if (!value) throw new StudioNotFoundError('Delivery not found: ' + deliveryId);
  return value;
}

function deliveryItemsByDelivery(db: StudioDatabase, deliveryIds: string[]): Map<string, DeliveryAssetSnapshot[]> {
  const items = new Map<string, DeliveryAssetSnapshot[]>();
  if (!deliveryIds.length) return items;
  const placeholders = deliveryIds.map(() => '?').join(',');
  const rows = db.prepare('SELECT item.delivery_id, item.asset_id, item.sequence, item.source_snapshot_json, item.review_snapshot_json, asset.kind, asset.media_type, asset.deleted_at FROM delivery_assets item LEFT JOIN assets asset ON asset.id = item.asset_id WHERE item.delivery_id IN (' + placeholders + ') ORDER BY item.delivery_id, item.sequence').all(...deliveryIds) as Array<{ delivery_id: string; asset_id: string; sequence: number; source_snapshot_json: string; review_snapshot_json: string; kind: string | null; media_type: string | null; deleted_at: string | null }>;
  for (const row of rows) {
    const current = items.get(row.delivery_id) || [];
    current.push({ assetId: row.asset_id, sequence: row.sequence, source: redacted(parse(row.source_snapshot_json)) as Record<string, unknown>, review: redacted(parse(row.review_snapshot_json)) as Record<string, unknown>, asset: row.kind && row.media_type ? { id: row.asset_id, kind: row.kind, mediaType: row.media_type, deletedAt: row.deleted_at } : null });
    items.set(row.delivery_id, current);
  }
  return items;
}

function deliveryItems(db: StudioDatabase, deliveryId: string): DeliveryAssetSnapshot[] {
  return deliveryItemsByDelivery(db, [deliveryId]).get(deliveryId) || [];
}

export function getDelivery(db: StudioDatabase, studioId: string, deliveryId: string): Delivery {
  const value = delivery(storedDelivery(db, studioId, deliveryId));
  return { ...value, items: deliveryItems(db, value.id) };
}

export function listDeliveries(db: StudioDatabase, projectId: string): Delivery[] {
  const rows = db.prepare('SELECT id, project_id, name, status, manifest_json FROM deliveries WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as unknown as StoredDelivery[];
  const items = deliveryItemsByDelivery(db, rows.map((row) => row.id));
  return rows.map((row) => ({ ...delivery(row), items: items.get(row.id) || [] }));
}

export function updateDeliveryDraft(db: StudioDatabase, input: { studioId: string; deliveryId: string; assetIds: string[]; includeCreativeRecord?: boolean; idempotencyKey: string }): Delivery {
  const receipt = executeIdempotent(db, input.studioId, input.idempotencyKey, 'deliveries.update', () => {
    const current = storedDelivery(db, input.studioId, input.deliveryId);
    if (current.status !== 'draft') throw new InvalidCommandError('Only a draft delivery can be edited.');
    const project = assertProject(db, input.studioId, current.project_id);
    const timestamp = nowIso();
    const currentManifest = parse(current.manifest_json);
    const manifest = { ...currentManifest, assetIds: [...new Set(input.assetIds)], includeCreativeRecord: typeof input.includeCreativeRecord === 'boolean' ? input.includeCreativeRecord : currentManifest.includeCreativeRecord === true, updatedAt: timestamp };
    const items = replaceDeliveryAssets(db, project, current.id, input.assetIds, timestamp);
    db.prepare('UPDATE deliveries SET manifest_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(manifest), timestamp, current.id);
    appendStudioEvent(db, { studioId: project.studio_id, entityType: 'delivery', entityId: current.id, eventType: 'delivery.draft_updated', payload: { assetCount: items.length } });
    return { id: current.id, projectId: current.project_id, name: current.name, status: 'draft' as const, manifest, items };
  }, input);
  return receipt.value;
}

export function prepareDelivery(db: StudioDatabase, input: { studioId: string; deliveryId: string; idempotencyKey: string }): Delivery {
  const receipt = executeIdempotent(db, input.studioId, input.idempotencyKey, 'deliveries.ready', () => {
    const current = storedDelivery(db, input.studioId, input.deliveryId);
    if (current.status !== 'draft') throw new InvalidCommandError('Only a draft delivery can be prepared.');
    const project = assertProject(db, input.studioId, current.project_id);
    const ids = (db.prepare('SELECT asset_id FROM delivery_assets WHERE delivery_id = ? ORDER BY sequence').all(current.id) as Array<{ asset_id: string }>).map((item) => item.asset_id);
    const timestamp = nowIso();
    const items = replaceDeliveryAssets(db, project, current.id, ids, timestamp);
    const manifest = { ...parse(current.manifest_json), preparedAt: timestamp };
    db.prepare('UPDATE deliveries SET status = ?, manifest_json = ?, updated_at = ? WHERE id = ?').run('ready', JSON.stringify(manifest), timestamp, current.id);
    appendStudioEvent(db, { studioId: project.studio_id, entityType: 'delivery', entityId: current.id, eventType: 'delivery.ready', payload: { assetCount: items.length } });
    return { id: current.id, projectId: current.project_id, name: current.name, status: 'ready' as const, manifest, items };
  }, input);
  return receipt.value;
}

export function returnDeliveryToDraft(db: StudioDatabase, input: { studioId: string; deliveryId: string; idempotencyKey: string }): Delivery {
  const receipt = executeIdempotent(db, input.studioId, input.idempotencyKey, 'deliveries.return_to_draft', () => {
    const current = storedDelivery(db, input.studioId, input.deliveryId);
    if (current.status !== 'ready') throw new InvalidCommandError('Only a prepared delivery can return to draft.');
    const project = assertProject(db, input.studioId, current.project_id);
    const timestamp = nowIso();
    db.prepare('UPDATE deliveries SET status = ?, updated_at = ? WHERE id = ?').run('draft', timestamp, current.id);
    appendStudioEvent(db, { studioId: project.studio_id, entityType: 'delivery', entityId: current.id, eventType: 'delivery.returned_to_draft', payload: {} });
    return { ...delivery(current), status: 'draft' as const, items: deliveryItems(db, current.id) };
  }, input);
  return receipt.value;
}

function creativeRecord(db: StudioDatabase, project: ProjectRow, deliveryValue: Delivery, assets: StudioAsset[]): Record<string, unknown> {
  const tasks = db.prepare('SELECT id, name, status, intent_json FROM creative_tasks WHERE project_id = ? ORDER BY created_at').all(project.id) as Array<{ id: string; name: string; status: string; intent_json: string }>;
  const rounds = db.prepare('SELECT cr.id, cr.task_id, cr.purpose, cr.status, cr.plan_version, cr.plan_json FROM creative_rounds cr JOIN creative_tasks t ON t.id = cr.task_id WHERE t.project_id = ? ORDER BY cr.created_at').all(project.id) as Array<{ id: string; task_id: string; purpose: string; status: string; plan_version: number; plan_json: string }>;
  const runs = db.prepare('SELECT r.id, r.round_id, r.status, r.provider_snapshot_json, r.plan_snapshot_json, r.created_at, r.updated_at FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id WHERE t.project_id = ? ORDER BY r.created_at').all(project.id) as Array<{ id: string; round_id: string; status: string; provider_snapshot_json: string; plan_snapshot_json: string; created_at: string; updated_at: string }>;
  const reviews = db.prepare('SELECT rd.asset_id, rd.decision, rd.feedback_json, rd.updated_at FROM review_decisions rd JOIN assets a ON a.id = rd.asset_id WHERE a.studio_id = ? AND rd.asset_id IN (' + assets.map(() => '?').join(',') + ') ORDER BY rd.updated_at').all(project.studio_id, ...assets.map((asset) => asset.id)) as Array<{ asset_id: string; decision: string; feedback_json: string; updated_at: string }>;
  return redacted({
    generatedAt: nowIso(),
    project: { id: project.id, name: project.name },
    delivery: deliveryValue,
    tasks: tasks.map((task) => ({ ...task, intent: parse(task.intent_json), intent_json: undefined })),
    rounds: rounds.map((round) => ({ ...round, plan: parse(round.plan_json), plan_json: undefined })),
    runs: runs.map((run) => ({ ...run, provider: parse(run.provider_snapshot_json), plan: parse(run.plan_snapshot_json), provider_snapshot_json: undefined, plan_snapshot_json: undefined })),
    assets: assets.map((asset) => ({ id: asset.id, kind: asset.kind, mediaType: asset.mediaType, contentHash: asset.contentHash, byteSize: asset.byteSize, source: asset.source })),
    reviews: reviews.map((review) => ({ ...review, feedback: parse(review.feedback_json), feedback_json: undefined }))
  }) as Record<string, unknown>;
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function simpleExportName(value: string): boolean {
  return Boolean(value) && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= 255;
}

function assertNoSymlinkHierarchy(root: string, target: string): void {
  const relative = path.relative(root, target);
  const parts = relative ? relative.split(path.sep) : [];
  let current = root;
  for (let index = -1; index < parts.length; index += 1) {
    if (index >= 0) current = path.join(current, parts[index]);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new InvalidCommandError('Delivery export path is unsafe.');
    if (index < parts.length - 1 && !stat.isDirectory()) throw new InvalidCommandError('Delivery export parent path is invalid.');
  }
}

function resolveDeliveryDirectory(paths: StudioPaths, storedPath: string, mustExist: boolean): string {
  if (!storedPath || storedPath.includes('\0') || storedPath.includes('\\') || path.isAbsolute(storedPath)) throw new InvalidCommandError('Delivery export path is invalid.');
  const segments = storedPath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new InvalidCommandError('Delivery export path is invalid.');
  const directory = path.resolve(paths.workspaceRoot, ...segments);
  const root = path.resolve(paths.deliveriesRoot);
  const relative = path.relative(root, directory);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new InvalidCommandError('Delivery export path is outside the managed delivery root.');
  assertNoSymlinkHierarchy(root, directory);
  if (mustExist) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new InvalidCommandError('Delivery export directory is invalid.');
  }
  return directory;
}

function inspectRegularFile(filePath: string): { contentHash: string; byteSize: number } {
  const opened = openVerifiedManagedFile(filePath);
  try {
    return { contentHash: opened.contentHash, byteSize: opened.byteSize };
  } finally {
    opened.close();
  }
}

function copyVerifiedFileToNewPath(source: VerifiedManagedFile, targetPath: string): void {
  let targetDescriptor: number | undefined;
  try {
    targetDescriptor = fs.openSync(targetPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < source.byteSize) {
      const read = fs.readSync(source.descriptor, chunk, 0, Math.min(chunk.length, source.byteSize - offset), offset);
      if (!read) throw new InvalidCommandError('Verified delivery source ended before its frozen byte size.');
      let written = 0;
      while (written < read) {
        const count = fs.writeSync(targetDescriptor, chunk, written, read - written, offset + written);
        if (!count) throw new InvalidCommandError('Delivery export file could not be written completely.');
        written += count;
      }
      offset += read;
    }
    if (fs.fstatSync(targetDescriptor).size !== source.byteSize) throw new InvalidCommandError('Delivery export file size does not match its verified snapshot.');
    fs.fsyncSync(targetDescriptor);
    fs.closeSync(targetDescriptor);
    targetDescriptor = undefined;
  } catch (error) {
    if (targetDescriptor !== undefined) fs.closeSync(targetDescriptor);
    fs.rmSync(targetPath, { force: true });
    throw error;
  }
}

async function inspectRegularFileAsync(filePath: string): Promise<{ contentHash: string; byteSize: number }> {
  const opened = await openVerifiedManagedFileAsync(filePath);
  try {
    return { contentHash: opened.contentHash, byteSize: opened.byteSize };
  } finally {
    opened.close();
  }
}

async function copyVerifiedFileToNewPathAsync(source: VerifiedManagedFile, targetPath: string): Promise<void> {
  let target: fs.promises.FileHandle | undefined;
  try {
    target = await fsp.open(targetPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    const input = fs.createReadStream(source.absolutePath, { fd: source.descriptor, autoClose: false, start: 0, end: source.byteSize - 1 });
    const output = fs.createWriteStream(targetPath, { fd: target.fd, autoClose: false });
    await pipeline(input, output);
    const stat = await target.stat();
    if (stat.size !== source.byteSize) throw new InvalidCommandError('Delivery export file size does not match its verified snapshot.');
    await target.sync();
    await target.close();
    target = undefined;
  } catch (error) {
    if (target) await target.close().catch(() => undefined);
    await fsp.rm(targetPath, { force: true });
    throw error;
  }
}

function exportedFiles(value: string): ExportedFileSnapshot[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const files: ExportedFileSnapshot[] = [];
    const names = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      if (typeof record.name !== 'string' || !simpleExportName(record.name) || names.has(record.name) || typeof record.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(record.contentHash) || !Number.isSafeInteger(record.byteSize) || Number(record.byteSize) < 0) return null;
      names.add(record.name);
      files.push({ name: record.name, contentHash: record.contentHash, byteSize: Number(record.byteSize) });
    }
    return files.length ? files : null;
  } catch { return null; }
}

function snapshotFiles(directory: string, names: string[]): ExportedFileSnapshot[] {
  return names.map((name) => {
    if (!simpleExportName(name)) throw new InvalidCommandError('Delivery export file name is invalid.');
    return { name, ...inspectRegularFile(path.join(directory, name)) };
  });
}

async function snapshotFilesAsync(directory: string, names: string[]): Promise<ExportedFileSnapshot[]> {
  return await Promise.all(names.map(async (name) => {
    if (!simpleExportName(name)) throw new InvalidCommandError('Delivery export file name is invalid.');
    return { name, ...await inspectRegularFileAsync(path.join(directory, name)) };
  }));
}

function validateExactExportDirectory(paths: StudioPaths, pending: PendingDeliveryExport): { directory: string; files: ExportedFileSnapshot[] } {
  const expected = exportedFiles(pending.files_json);
  if (!expected) throw new InvalidCommandError('Delivery export journal file identity is invalid.');
  const directory = resolveDeliveryDirectory(paths, pending.directory_path, true);
  const actualNames = fs.readdirSync(directory).sort();
  const expectedNames = expected.map((file) => file.name).sort();
  if (actualNames.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) throw new InvalidCommandError('Delivery export directory does not match its frozen file set.');
  for (const file of expected) {
    const filePath = path.join(directory, file.name);
    assertNoSymlinkHierarchy(directory, filePath);
    const actual = inspectRegularFile(filePath);
    if (actual.contentHash !== file.contentHash || actual.byteSize !== file.byteSize) throw new InvalidCommandError('Delivery export file identity does not match its journal.');
  }
  return { directory, files: expected };
}

async function validateExactExportDirectoryAsync(paths: StudioPaths, pending: PendingDeliveryExport): Promise<{ directory: string; files: ExportedFileSnapshot[] }> {
  const expected = exportedFiles(pending.files_json);
  if (!expected) throw new InvalidCommandError('Delivery export journal file identity is invalid.');
  const directory = resolveDeliveryDirectory(paths, pending.directory_path, true);
  const actualNames = (await fsp.readdir(directory)).sort();
  const expectedNames = expected.map((file) => file.name).sort();
  if (actualNames.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) throw new InvalidCommandError('Delivery export directory does not match its frozen file set.');
  await Promise.all(expected.map(async (file) => {
    const filePath = path.join(directory, file.name);
    assertNoSymlinkHierarchy(directory, filePath);
    const actual = await inspectRegularFileAsync(filePath);
    if (actual.contentHash !== file.contentHash || actual.byteSize !== file.byteSize) throw new InvalidCommandError('Delivery export file identity does not match its journal.');
  }));
  return { directory, files: expected };
}

export function openDeliveryExportFile(paths: StudioPaths, input: { directoryPath: string; name: string; contentHash: string; byteSize: number; mediaType?: string }): VerifiedManagedFile {
  if (!simpleExportName(input.name)) throw new InvalidCommandError('Delivery export file name is invalid.');
  if (!/^[a-f0-9]{64}$/.test(input.contentHash) || !Number.isSafeInteger(input.byteSize) || input.byteSize < 0) throw new InvalidCommandError('Delivery export file identity is invalid.');
  try {
    const directory = resolveDeliveryDirectory(paths, input.directoryPath, true);
    const filePath = path.join(directory, input.name);
    assertNoSymlinkHierarchy(directory, filePath);
    return createVerifiedSnapshot(filePath, { contentHash: input.contentHash, byteSize: input.byteSize, mediaType: input.mediaType, requireImage: Boolean(input.mediaType), maxByteSize: MAX_DELIVERY_EXPORT_BYTES }, { snapshotDirectory: ensureCacheDirectory(paths, 'staging') });
  } catch (error) {
    if (error instanceof InvalidCommandError || error instanceof StudioNotFoundError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StudioNotFoundError('Exported delivery file is missing.');
    throw new InvalidCommandError('Delivery export file is unavailable or does not match its frozen identity.');
  }
}

export async function openDeliveryExportFileAsync(paths: StudioPaths, input: { directoryPath: string; name: string; contentHash: string; byteSize: number; mediaType?: string }): Promise<VerifiedManagedFile> {
  if (!simpleExportName(input.name)) throw new InvalidCommandError('Delivery export file name is invalid.');
  if (!/^[a-f0-9]{64}$/.test(input.contentHash) || !Number.isSafeInteger(input.byteSize) || input.byteSize < 0) throw new InvalidCommandError('Delivery export file identity is invalid.');
  try {
    const directory = resolveDeliveryDirectory(paths, input.directoryPath, true);
    const filePath = path.join(directory, input.name);
    assertNoSymlinkHierarchy(directory, filePath);
    return await createVerifiedSnapshotAsync(filePath, { contentHash: input.contentHash, byteSize: input.byteSize, mediaType: input.mediaType, requireImage: Boolean(input.mediaType), maxByteSize: MAX_DELIVERY_EXPORT_BYTES }, { snapshotDirectory: ensureCacheDirectory(paths, 'staging') });
  } catch (error) {
    if (error instanceof InvalidCommandError || error instanceof StudioNotFoundError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StudioNotFoundError('Exported delivery file is missing.');
    throw new InvalidCommandError('Delivery export file is unavailable or does not match its frozen identity.');
  }
}

function recordExportRecoveryRejection(db: StudioDatabase, pending: PendingDeliveryExport): void {
  if (db.prepare("SELECT id FROM events WHERE studio_id = ? AND entity_type = 'delivery' AND entity_id = ? AND event_type = 'delivery.export_recovery_rejected' LIMIT 1").get(pending.studio_id, pending.delivery_id)) return;
  withTransaction(db, () => appendStudioEvent(db, { studioId: pending.studio_id, entityType: 'delivery', entityId: pending.delivery_id, eventType: 'delivery.export_recovery_rejected', payload: {} }));
}

function quarantineInvalidExport(paths: StudioPaths, pending: PendingDeliveryExport): void {
  let directory: string;
  try { directory = resolveDeliveryDirectory(paths, pending.directory_path, true); }
  catch { return; }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const target = path.join(paths.deliveriesRoot, '.quarantine-' + createId('delivery-export'));
    if (fs.existsSync(target)) continue;
    fs.renameSync(directory, target);
    return;
  }
  throw new InvalidCommandError('Unable to quarantine an invalid delivery export safely.');
}

function finalizeJournaledExport(db: StudioDatabase, paths: StudioPaths, pending: PendingDeliveryExport, input: { studioId: string; deliveryId: string; idempotencyKey: string }): Delivery {
  if (pending.studio_id !== input.studioId || pending.delivery_id !== input.deliveryId) throw new StudioNotFoundError('Delivery not found: ' + input.deliveryId);
  validateExactExportDirectory(paths, pending);
  const current = storedDelivery(db, input.studioId, pending.delivery_id);
  const manifest = parse(pending.manifest_json);
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'deliveries.export', () => {
    db.prepare('UPDATE deliveries SET status = ?, manifest_json = ?, updated_at = ? WHERE id = ?').run('exported', JSON.stringify(manifest), nowIso(), current.id);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'delivery', entityId: current.id, eventType: 'delivery.exported', payload: { assetCount: Array.isArray(manifest.files) ? manifest.files.length : 0 } });
    db.prepare('DELETE FROM delivery_export_journal WHERE studio_id = ? AND idempotency_key = ?').run(input.studioId, pending.idempotency_key);
    return { id: current.id, projectId: current.project_id, name: current.name, status: 'exported' as const, manifest: redacted(manifest) as Record<string, unknown> };
  }, input).value;
}

async function finalizeJournaledExportAsync(db: StudioDatabase, paths: StudioPaths, pending: PendingDeliveryExport, input: { studioId: string; deliveryId: string; idempotencyKey: string }): Promise<Delivery> {
  if (pending.studio_id !== input.studioId || pending.delivery_id !== input.deliveryId) throw new StudioNotFoundError('Delivery not found: ' + input.deliveryId);
  await validateExactExportDirectoryAsync(paths, pending);
  const current = storedDelivery(db, input.studioId, pending.delivery_id);
  const manifest = parse(pending.manifest_json);
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'deliveries.export', () => {
    db.prepare('UPDATE deliveries SET status = ?, manifest_json = ?, updated_at = ? WHERE id = ?').run('exported', JSON.stringify(manifest), nowIso(), current.id);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'delivery', entityId: current.id, eventType: 'delivery.exported', payload: { assetCount: Array.isArray(manifest.files) ? manifest.files.length : 0 } });
    db.prepare('DELETE FROM delivery_export_journal WHERE studio_id = ? AND idempotency_key = ?').run(input.studioId, pending.idempotency_key);
    return { id: current.id, projectId: current.project_id, name: current.name, status: 'exported' as const, manifest: redacted(manifest) as Record<string, unknown> };
  }, input).value;
}

export function exportDelivery(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; deliveryId: string; idempotencyKey: string }): DeliveryExportResult {
  const replay = db.prepare('SELECT command_name, response_json FROM command_receipts WHERE studio_id = ? AND idempotency_key = ?').get(input.studioId, input.idempotencyKey) as { command_name: string; response_json: string } | undefined;
  if (replay?.command_name === 'deliveries.export') {
    const deliveryValue = JSON.parse(replay.response_json) as Delivery;
    if (deliveryValue.id !== input.deliveryId) throw new InvalidCommandError('Idempotency key belongs to a different delivery export.');
    const current = storedDelivery(db, input.studioId, input.deliveryId);
    if (current.status !== 'exported') throw new InvalidCommandError('Replayed delivery export is not committed.');
    const rawManifest = parse(current.manifest_json);
    const relative = typeof rawManifest.exportDirectory === 'string' ? rawManifest.exportDirectory : '';
    if (!Array.isArray(rawManifest.exportFiles)) throw new InvalidCommandError('Replayed delivery export has no frozen file identity set.');
    const verified = validateExactExportDirectory(paths, { idempotency_key: input.idempotencyKey, delivery_id: input.deliveryId, studio_id: input.studioId, directory_path: relative, manifest_json: current.manifest_json, files_json: JSON.stringify(rawManifest.exportFiles) });
    return { delivery: deliveryValue, directory: verified.directory, files: verified.files.map((file) => file.name) };
  }
  const pending = db.prepare('SELECT idempotency_key, delivery_id, studio_id, directory_path, manifest_json, files_json FROM delivery_export_journal WHERE idempotency_key = ? AND studio_id = ?').get(input.idempotencyKey, input.studioId) as PendingDeliveryExport | undefined;
  if (pending && pending.delivery_id !== input.deliveryId) throw new InvalidCommandError('Idempotency key belongs to a different delivery export.');
  if (pending && pending.delivery_id === input.deliveryId) {
    try {
      const verified = validateExactExportDirectory(paths, pending);
      return { delivery: finalizeJournaledExport(db, paths, pending, input), directory: verified.directory, files: verified.files.map((file) => file.name) };
    } catch {
      recordExportRecoveryRejection(db, pending);
      quarantineInvalidExport(paths, pending);
      db.prepare('DELETE FROM delivery_export_journal WHERE studio_id = ? AND idempotency_key = ? AND delivery_id = ?').run(input.studioId, input.idempotencyKey, input.deliveryId);
    }
  }
  const current = storedDelivery(db, input.studioId, input.deliveryId);
  const value = delivery(current);
  if (value.status !== 'ready') throw new InvalidCommandError('Only a prepared delivery can be exported.');
  const project = assertProject(db, input.studioId, value.projectId);
  const frozenItems = deliveryItems(db, value.id);
  const assets = frozenItems.map((item) => {
    const asset = getStudioAsset(db, project.studio_id, item.assetId);
    if (!asset) throw new StudioNotFoundError('Delivery asset not found: ' + item.assetId);
    return asset;
  });
  const aggregateAssetBytes = assets.reduce((total, asset) => total + asset.byteSize, 0);
  if (!Number.isSafeInteger(aggregateAssetBytes) || aggregateAssetBytes > MAX_DELIVERY_EXPORT_BYTES) throw new InvalidCommandError('Delivery export exceeds its aggregate byte limit.');
  const directory = path.join(paths.deliveriesRoot, safeSegment(project.name), safeSegment(value.name) + '-' + value.id.slice(-8));
  const directoryPath = path.relative(paths.workspaceRoot, directory).split(path.sep).join('/');
  resolveDeliveryDirectory(paths, directoryPath, false);
  const temporary = directory + '.tmp-' + process.pid;
  const backup = directory + '.previous-' + process.pid;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  fs.mkdirSync(temporary, { recursive: true });
  assertNoSymlinkHierarchy(paths.deliveriesRoot, temporary);
  const files: Array<{ sequence: number; file: string; mediaType: string; contentHash: string; byteSize: number }> = [];
  const includeCreativeRecord = value.manifest.includeCreativeRecord === true;
  try {
    for (const [index, asset] of assets.entries()) {
      const sequence = index + 1;
      const file = String(sequence).padStart(3, '0') + extensionFor(asset);
      const snapshot = createAssetSnapshot(paths, asset);
      try {
        const targetPath = path.join(temporary, file);
        copyVerifiedFileToNewPath(snapshot, targetPath);
        const copied = inspectRegularFile(targetPath);
        if (copied.contentHash !== snapshot.contentHash || copied.byteSize !== snapshot.byteSize || !snapshot.mediaType) throw new InvalidCommandError('Delivery export copy does not match its verified source snapshot.');
        files.push({ sequence, file, mediaType: snapshot.mediaType, contentHash: copied.contentHash, byteSize: copied.byteSize });
      } finally {
        snapshot.close();
      }
    }
    const record = includeCreativeRecord ? creativeRecord(db, project, value, assets) : null;
    const exportedAt = nowIso();
    const manifest = { deliveryId: value.id, projectId: project.id, projectName: project.name, deliveryName: value.name, exportedAt, files };
    const safeName = escapeHtmlText(value.name);
    const contactSheet = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + safeName + '</title><style>body{margin:32px;background:#f4f4ed;color:#202720;font-family:sans-serif}h1{font-size:22px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.item{background:#fff;border:1px solid #d7dbd2;padding:8px}.item img{display:block;width:100%;aspect-ratio:1;object-fit:contain;background:#eef0e9}.item span{display:block;margin-top:7px;font-size:11px;color:#596257}</style><h1>' + safeName + '</h1><div class="grid">' + files.map((file) => '<div class="item"><img src="' + file.file + '" alt=""><span>素材 ' + file.sequence + '</span></div>').join('') + '</div>';
    fs.writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    if (record) fs.writeFileSync(path.join(temporary, 'creative-record.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    fs.writeFileSync(path.join(temporary, 'contact-sheet.html'), contactSheet + '\n', { flag: 'wx' });
    const outputNames = files.map((file) => file.file).concat(['manifest.json', ...(includeCreativeRecord ? ['creative-record.json'] : []), 'contact-sheet.html']);
    const expectedFiles = snapshotFiles(temporary, outputNames);
    const deliveryManifest = { ...value.manifest, frozenItems: frozenItems.map((item) => ({ assetId: item.assetId, sequence: item.sequence, source: item.source, review: item.review })), exportDirectory: directoryPath, exportedAt, files, exportFiles: expectedFiles };
    withTransaction(db, () => {
      const inserted = db.prepare('INSERT INTO delivery_export_journal (studio_id, idempotency_key, delivery_id, directory_path, manifest_json, files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(studio_id, idempotency_key) DO NOTHING').run(project.studio_id, input.idempotencyKey, value.id, directoryPath, JSON.stringify(deliveryManifest), JSON.stringify(expectedFiles), nowIso());
      if (Number(inserted.changes) !== 1) {
        const existing = db.prepare('SELECT delivery_id FROM delivery_export_journal WHERE studio_id = ? AND idempotency_key = ?').get(project.studio_id, input.idempotencyKey) as { delivery_id: string } | undefined;
        if (existing?.delivery_id !== value.id) throw new InvalidCommandError('Idempotency key belongs to a different delivery export.');
        throw new InvalidCommandError('Delivery export is already in progress for this idempotency key.');
      }
    });
    if (fs.existsSync(directory)) fs.renameSync(directory, backup);
    try {
      fs.renameSync(temporary, directory);
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      if (!fs.existsSync(directory) && fs.existsSync(backup)) fs.renameSync(backup, directory);
      throw error;
    }
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  const pendingExport = db.prepare('SELECT idempotency_key, delivery_id, studio_id, directory_path, manifest_json, files_json FROM delivery_export_journal WHERE idempotency_key = ? AND studio_id = ?').get(input.idempotencyKey, input.studioId) as unknown as PendingDeliveryExport;
  const committed = finalizeJournaledExport(db, paths, pendingExport, input);
  const frozenFiles = exportedFiles(pendingExport.files_json);
  return { delivery: committed, directory, files: frozenFiles ? frozenFiles.map((file) => file.name) : [] };
}

const asyncDeliveryExports = new WeakMap<object, Map<string, Promise<DeliveryExportResult>>>();

export async function exportDeliveryAsync(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; deliveryId: string; idempotencyKey: string }): Promise<DeliveryExportResult> {
  const key = input.studioId + ':' + input.idempotencyKey;
  const operations = asyncDeliveryExports.get(db as unknown as object) || new Map<string, Promise<DeliveryExportResult>>();
  asyncDeliveryExports.set(db as unknown as object, operations);
  const pendingOperation = operations.get(key);
  if (pendingOperation) {
    await pendingOperation;
    return await exportDeliveryAsync(db, paths, input);
  }
  const run = exportDeliveryAsyncUnlocked(db, paths, input);
  operations.set(key, run);
  try {
    return await run;
  } finally {
    if (operations.get(key) === run) operations.delete(key);
  }
}

async function exportDeliveryAsyncUnlocked(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; deliveryId: string; idempotencyKey: string }): Promise<DeliveryExportResult> {
  const replay = db.prepare('SELECT command_name, response_json FROM command_receipts WHERE studio_id = ? AND idempotency_key = ?').get(input.studioId, input.idempotencyKey) as { command_name: string; response_json: string } | undefined;
  if (replay?.command_name === 'deliveries.export') {
    const deliveryValue = JSON.parse(replay.response_json) as Delivery;
    if (deliveryValue.id !== input.deliveryId) throw new InvalidCommandError('Idempotency key belongs to a different delivery export.');
    const current = storedDelivery(db, input.studioId, input.deliveryId);
    if (current.status !== 'exported') throw new InvalidCommandError('Replayed delivery export is not committed.');
    const rawManifest = parse(current.manifest_json);
    const relative = typeof rawManifest.exportDirectory === 'string' ? rawManifest.exportDirectory : '';
    if (!Array.isArray(rawManifest.exportFiles)) throw new InvalidCommandError('Replayed delivery export has no frozen file identity set.');
    const verified = await validateExactExportDirectoryAsync(paths, { idempotency_key: input.idempotencyKey, delivery_id: input.deliveryId, studio_id: input.studioId, directory_path: relative, manifest_json: current.manifest_json, files_json: JSON.stringify(rawManifest.exportFiles) });
    return { delivery: deliveryValue, directory: verified.directory, files: verified.files.map((file) => file.name) };
  }
  const pending = db.prepare('SELECT idempotency_key, delivery_id, studio_id, directory_path, manifest_json, files_json FROM delivery_export_journal WHERE idempotency_key = ? AND studio_id = ?').get(input.idempotencyKey, input.studioId) as PendingDeliveryExport | undefined;
  if (pending && pending.delivery_id !== input.deliveryId) throw new InvalidCommandError('Idempotency key belongs to a different delivery export.');
  if (pending && pending.delivery_id === input.deliveryId) {
    try {
      const verified = await validateExactExportDirectoryAsync(paths, pending);
      return { delivery: await finalizeJournaledExportAsync(db, paths, pending, input), directory: verified.directory, files: verified.files.map((file) => file.name) };
    } catch {
      recordExportRecoveryRejection(db, pending);
      quarantineInvalidExport(paths, pending);
      db.prepare('DELETE FROM delivery_export_journal WHERE studio_id = ? AND idempotency_key = ? AND delivery_id = ?').run(input.studioId, input.idempotencyKey, input.deliveryId);
    }
  }
  const current = storedDelivery(db, input.studioId, input.deliveryId);
  const value = delivery(current);
  if (value.status !== 'ready') throw new InvalidCommandError('Only a prepared delivery can be exported.');
  const project = assertProject(db, input.studioId, value.projectId);
  const frozenItems = deliveryItems(db, value.id);
  const assets = frozenItems.map((item) => {
    const asset = getStudioAsset(db, project.studio_id, item.assetId);
    if (!asset) throw new StudioNotFoundError('Delivery asset not found: ' + item.assetId);
    return asset;
  });
  const aggregateAssetBytes = assets.reduce((total, asset) => total + asset.byteSize, 0);
  if (!Number.isSafeInteger(aggregateAssetBytes) || aggregateAssetBytes > MAX_DELIVERY_EXPORT_BYTES) throw new InvalidCommandError('Delivery export exceeds its aggregate byte limit.');
  const directory = path.join(paths.deliveriesRoot, safeSegment(project.name), safeSegment(value.name) + '-' + value.id.slice(-8));
  const directoryPath = path.relative(paths.workspaceRoot, directory).split(path.sep).join('/');
  resolveDeliveryDirectory(paths, directoryPath, false);
  const temporary = directory + '.tmp-' + process.pid;
  const backup = directory + '.previous-' + process.pid;
  await fsp.rm(temporary, { recursive: true, force: true });
  await fsp.rm(backup, { recursive: true, force: true });
  await fsp.mkdir(temporary, { recursive: true });
  assertNoSymlinkHierarchy(paths.deliveriesRoot, temporary);
  const files: Array<{ sequence: number; file: string; mediaType: string; contentHash: string; byteSize: number }> = [];
  const includeCreativeRecord = value.manifest.includeCreativeRecord === true;
  try {
    for (const [index, asset] of assets.entries()) {
      const sequence = index + 1;
      const file = String(sequence).padStart(3, '0') + extensionFor(asset);
      const snapshot = await createAssetSnapshotAsync(paths, asset);
      try {
        const targetPath = path.join(temporary, file);
        await copyVerifiedFileToNewPathAsync(snapshot, targetPath);
        const copied = await inspectRegularFileAsync(targetPath);
        if (copied.contentHash !== snapshot.contentHash || copied.byteSize !== snapshot.byteSize || !snapshot.mediaType) throw new InvalidCommandError('Delivery export copy does not match its verified source snapshot.');
        files.push({ sequence, file, mediaType: snapshot.mediaType, contentHash: copied.contentHash, byteSize: copied.byteSize });
      } finally {
        snapshot.close();
      }
    }
    const record = includeCreativeRecord ? creativeRecord(db, project, value, assets) : null;
    const exportedAt = nowIso();
    const manifest = { deliveryId: value.id, projectId: project.id, projectName: project.name, deliveryName: value.name, exportedAt, files };
    const safeName = escapeHtmlText(value.name);
    const contactSheet = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + safeName + '</title><style>body{margin:32px;background:#f4f4ed;color:#202720;font-family:sans-serif}h1{font-size:22px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.item{background:#fff;border:1px solid #d7dbd2;padding:8px}.item img{display:block;width:100%;aspect-ratio:1;object-fit:contain;background:#eef0e9}.item span{display:block;margin-top:7px;font-size:11px;color:#596257}</style><h1>' + safeName + '</h1><div class="grid">' + files.map((file) => '<div class="item"><img src="' + file.file + '" alt=""><span>素材 ' + file.sequence + '</span></div>').join('') + '</div>';
    await fsp.writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    if (record) await fsp.writeFile(path.join(temporary, 'creative-record.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
    await fsp.writeFile(path.join(temporary, 'contact-sheet.html'), contactSheet + '\n', { flag: 'wx' });
    const outputNames = files.map((file) => file.file).concat(['manifest.json', ...(includeCreativeRecord ? ['creative-record.json'] : []), 'contact-sheet.html']);
    const expectedFiles = await snapshotFilesAsync(temporary, outputNames);
    const deliveryManifest = { ...value.manifest, frozenItems: frozenItems.map((item) => ({ assetId: item.assetId, sequence: item.sequence, source: item.source, review: item.review })), exportDirectory: directoryPath, exportedAt, files, exportFiles: expectedFiles };
    withTransaction(db, () => {
      const inserted = db.prepare('INSERT INTO delivery_export_journal (studio_id, idempotency_key, delivery_id, directory_path, manifest_json, files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(studio_id, idempotency_key) DO NOTHING').run(project.studio_id, input.idempotencyKey, value.id, directoryPath, JSON.stringify(deliveryManifest), JSON.stringify(expectedFiles), nowIso());
      if (Number(inserted.changes) !== 1) {
        const existing = db.prepare('SELECT delivery_id FROM delivery_export_journal WHERE studio_id = ? AND idempotency_key = ?').get(project.studio_id, input.idempotencyKey) as { delivery_id: string } | undefined;
        if (existing?.delivery_id !== value.id) throw new InvalidCommandError('Idempotency key belongs to a different delivery export.');
        throw new InvalidCommandError('Delivery export is already in progress for this idempotency key.');
      }
    });
    try {
      await fsp.lstat(directory);
      await fsp.rename(directory, backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await fsp.rename(temporary, directory);
      await fsp.rm(backup, { recursive: true, force: true });
    } catch (error) {
      try {
        await fsp.lstat(directory);
      } catch (missing) {
        if ((missing as NodeJS.ErrnoException).code === 'ENOENT') {
          try { await fsp.lstat(backup); await fsp.rename(backup, directory); } catch {}
        }
      }
      throw error;
    }
  } catch (error) {
    await fsp.rm(temporary, { recursive: true, force: true });
    throw error;
  }
  const pendingExport = db.prepare('SELECT idempotency_key, delivery_id, studio_id, directory_path, manifest_json, files_json FROM delivery_export_journal WHERE idempotency_key = ? AND studio_id = ?').get(input.idempotencyKey, input.studioId) as unknown as PendingDeliveryExport;
  const committed = await finalizeJournaledExportAsync(db, paths, pendingExport, input);
  const frozenFiles = exportedFiles(pendingExport.files_json);
  return { delivery: committed, directory, files: frozenFiles ? frozenFiles.map((file) => file.name) : [] };
}

function deliveryCompletionKey(operationId: string, phase: DeliveryCompletionPhase): string {
  return 'delivery-complete-' + sha256(requireText(operationId, 'Delivery completion operation id')).slice(0, 32) + '-' + phase;
}

export function completeDeliveryStep(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; operationId: string; phase: DeliveryCompletionPhase; projectId: string; name: string; assetIds: string[]; includeCreativeRecord?: boolean }): DeliveryCompletionResult {
  if (!['draft', 'prepare', 'export'].includes(input.phase)) throw new InvalidCommandError('Unknown delivery completion phase.');
  const draft = createDelivery(db, {
    studioId: input.studioId,
    projectId: input.projectId,
    name: input.name,
    assetIds: input.assetIds,
    includeCreativeRecord: input.includeCreativeRecord,
    idempotencyKey: deliveryCompletionKey(input.operationId, 'draft')
  });
  if (input.phase === 'draft') return { operationId: input.operationId, stage: draft.status, nextAction: 'prepare', delivery: draft, files: [] };
  let current = getDelivery(db, input.studioId, draft.id);
  if (current.status === 'draft') current = prepareDelivery(db, { studioId: input.studioId, deliveryId: current.id, idempotencyKey: deliveryCompletionKey(input.operationId, 'prepare') });
  if (input.phase === 'prepare') return { operationId: input.operationId, stage: current.status, nextAction: current.status === 'ready' ? 'export' : null, delivery: current, files: [] };
  if (current.status === 'exported') return { operationId: input.operationId, stage: 'exported', nextAction: null, delivery: current, files: [] };
  const exported = exportDelivery(db, paths, { studioId: input.studioId, deliveryId: current.id, idempotencyKey: deliveryCompletionKey(input.operationId, 'export') });
  return { operationId: input.operationId, stage: 'exported', nextAction: null, delivery: exported.delivery, files: exported.files };
}

export async function completeDeliveryStepAsync(db: StudioDatabase, paths: StudioPaths, input: { studioId: string; operationId: string; phase: DeliveryCompletionPhase; projectId: string; name: string; assetIds: string[]; includeCreativeRecord?: boolean }): Promise<DeliveryCompletionResult> {
  if (!['draft', 'prepare', 'export'].includes(input.phase)) throw new InvalidCommandError('Unknown delivery completion phase.');
  const draft = createDelivery(db, {
    studioId: input.studioId,
    projectId: input.projectId,
    name: input.name,
    assetIds: input.assetIds,
    includeCreativeRecord: input.includeCreativeRecord,
    idempotencyKey: deliveryCompletionKey(input.operationId, 'draft')
  });
  if (input.phase === 'draft') return { operationId: input.operationId, stage: draft.status, nextAction: 'prepare', delivery: draft, files: [] };
  let current = getDelivery(db, input.studioId, draft.id);
  if (current.status === 'draft') current = prepareDelivery(db, { studioId: input.studioId, deliveryId: current.id, idempotencyKey: deliveryCompletionKey(input.operationId, 'prepare') });
  if (input.phase === 'prepare') return { operationId: input.operationId, stage: current.status, nextAction: current.status === 'ready' ? 'export' : null, delivery: current, files: [] };
  if (current.status === 'exported') return { operationId: input.operationId, stage: 'exported', nextAction: null, delivery: current, files: [] };
  const exported = await exportDeliveryAsync(db, paths, { studioId: input.studioId, deliveryId: current.id, idempotencyKey: deliveryCompletionKey(input.operationId, 'export') });
  return { operationId: input.operationId, stage: 'exported', nextAction: null, delivery: exported.delivery, files: exported.files };
}
