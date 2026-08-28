import fs from 'node:fs';
import path from 'node:path';
import { assetFilePath, getStudioAsset, StudioAsset } from './assets';
import { createId, nowIso } from '../shared/ids';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { executeIdempotent, InvalidCommandError, StudioNotFoundError } from './studio-commands';
import { StudioPaths } from '../studio/workspace';

export interface DeliveryAssetSnapshot { assetId: string; sequence: number; source: Record<string, unknown>; review: Record<string, unknown>; asset: { id: string; kind: string; mediaType: string; deletedAt: string | null } | null; }
export interface Delivery { id: string; projectId: string; name: string; status: 'draft' | 'ready' | 'exported'; manifest: Record<string, unknown>; items?: DeliveryAssetSnapshot[]; }

interface StoredDelivery { id: string; project_id: string; name: string; status: Delivery['status']; manifest_json: string; }
interface ProjectRow { id: string; studio_id: string; name: string; }
interface PendingDeliveryExport { idempotency_key: string; delivery_id: string; studio_id: string; directory_path: string; manifest_json: string; files_json: string; }

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

function assertProject(db: StudioDatabase, projectId: string): ProjectRow {
  const row = db.prepare('SELECT id, studio_id, name FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
  if (!row) throw new StudioNotFoundError('Project not found: ' + projectId);
  return row;
}

function activeAssets(db: StudioDatabase, studioId: string, assetIds: string[]): StudioAsset[] {
  const ids = [...new Set(assetIds)];
  if (!ids.length) throw new InvalidCommandError('A delivery requires at least one active asset.');
  return ids.map((id) => {
    const asset = getStudioAsset(db, studioId, id);
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
  const items = assets.map((asset, index) => deliveryItemSnapshot(db, project, asset, index + 1));
  db.prepare("DELETE FROM asset_relations WHERE relation_type = 'included_in' AND target_type = 'delivery' AND target_id = ?").run(deliveryId);
  db.prepare('DELETE FROM delivery_assets WHERE delivery_id = ?').run(deliveryId);
  for (const item of items) {
    db.prepare('INSERT INTO delivery_assets (delivery_id, asset_id, sequence, source_snapshot_json, review_snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(deliveryId, item.assetId, item.sequence, JSON.stringify(item.source), JSON.stringify(item.review), timestamp);
    db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(createId('assetrel'), item.assetId, 'included_in', 'delivery', deliveryId, '{}', timestamp);
  }
  return items;
}

export function createDelivery(db: StudioDatabase, input: { projectId: string; name: string; assetIds: string[]; includeCreativeRecord?: boolean; idempotencyKey: string }): Delivery {
  const receipt = executeIdempotent(db, input.idempotencyKey, 'deliveries.create', () => {
    const project = assertProject(db, input.projectId);
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

function storedDelivery(db: StudioDatabase, deliveryId: string): StoredDelivery {
  const value = db.prepare('SELECT id, project_id, name, status, manifest_json FROM deliveries WHERE id = ?').get(deliveryId) as StoredDelivery | undefined;
  if (!value) throw new StudioNotFoundError('Delivery not found: ' + deliveryId);
  return value;
}

function deliveryItems(db: StudioDatabase, deliveryId: string): DeliveryAssetSnapshot[] {
  const rows = db.prepare('SELECT item.asset_id, item.sequence, item.source_snapshot_json, item.review_snapshot_json, asset.kind, asset.media_type, asset.deleted_at FROM delivery_assets item LEFT JOIN assets asset ON asset.id = item.asset_id WHERE item.delivery_id = ? ORDER BY item.sequence').all(deliveryId) as Array<{ asset_id: string; sequence: number; source_snapshot_json: string; review_snapshot_json: string; kind: string | null; media_type: string | null; deleted_at: string | null }>;
  return rows.map((item) => ({ assetId: item.asset_id, sequence: item.sequence, source: redacted(parse(item.source_snapshot_json)) as Record<string, unknown>, review: redacted(parse(item.review_snapshot_json)) as Record<string, unknown>, asset: item.kind && item.media_type ? { id: item.asset_id, kind: item.kind, mediaType: item.media_type, deletedAt: item.deleted_at } : null }));
}

export function getDelivery(db: StudioDatabase, deliveryId: string): Delivery {
  const value = delivery(storedDelivery(db, deliveryId));
  return { ...value, items: deliveryItems(db, value.id) };
}

export function listDeliveries(db: StudioDatabase, projectId: string): Delivery[] { return (db.prepare('SELECT id, project_id, name, status, manifest_json FROM deliveries WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as unknown as StoredDelivery[]).map((row) => ({ ...delivery(row), items: deliveryItems(db, row.id) })); }

export function updateDeliveryDraft(db: StudioDatabase, input: { deliveryId: string; assetIds: string[]; includeCreativeRecord?: boolean; idempotencyKey: string }): Delivery {
  const receipt = executeIdempotent(db, input.idempotencyKey, 'deliveries.update', () => {
    const current = storedDelivery(db, input.deliveryId);
    if (current.status !== 'draft') throw new InvalidCommandError('Only a draft delivery can be edited.');
    const project = assertProject(db, current.project_id);
    const timestamp = nowIso();
    const currentManifest = parse(current.manifest_json);
    const manifest = { ...currentManifest, assetIds: [...new Set(input.assetIds)], includeCreativeRecord: input.includeCreativeRecord === true, updatedAt: timestamp };
    const items = replaceDeliveryAssets(db, project, current.id, input.assetIds, timestamp);
    db.prepare('UPDATE deliveries SET manifest_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(manifest), timestamp, current.id);
    appendStudioEvent(db, { studioId: project.studio_id, entityType: 'delivery', entityId: current.id, eventType: 'delivery.draft_updated', payload: { assetCount: items.length } });
    return { id: current.id, projectId: current.project_id, name: current.name, status: 'draft' as const, manifest, items };
  }, input);
  return receipt.value;
}

export function prepareDelivery(db: StudioDatabase, input: { deliveryId: string; idempotencyKey: string }): Delivery {
  const receipt = executeIdempotent(db, input.idempotencyKey, 'deliveries.ready', () => {
    const current = storedDelivery(db, input.deliveryId);
    if (current.status !== 'draft') throw new InvalidCommandError('Only a draft delivery can be prepared.');
    const project = assertProject(db, current.project_id);
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

export function returnDeliveryToDraft(db: StudioDatabase, input: { deliveryId: string; idempotencyKey: string }): Delivery {
  const receipt = executeIdempotent(db, input.idempotencyKey, 'deliveries.return_to_draft', () => {
    const current = storedDelivery(db, input.deliveryId);
    if (current.status !== 'ready') throw new InvalidCommandError('Only a prepared delivery can return to draft.');
    const project = assertProject(db, current.project_id);
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



function exportedFiles(value: string): string[] { try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed.filter((file) => typeof file === 'string') as string[] : []; } catch { return []; } }

function finalizeJournaledExport(db: StudioDatabase, pending: PendingDeliveryExport, input: { deliveryId: string; idempotencyKey: string }): Delivery {
  const current = db.prepare('SELECT id, project_id, name, status, manifest_json FROM deliveries WHERE id = ?').get(pending.delivery_id) as StoredDelivery | undefined;
  if (!current) throw new StudioNotFoundError('Delivery not found: ' + pending.delivery_id);
  const project = assertProject(db, current.project_id);
  const manifest = parse(pending.manifest_json);
  return executeIdempotent(db, input.idempotencyKey, 'deliveries.export', () => {
    db.prepare('UPDATE deliveries SET status = ?, manifest_json = ?, updated_at = ? WHERE id = ?').run('exported', JSON.stringify(manifest), nowIso(), current.id);
    appendStudioEvent(db, { studioId: project.studio_id, entityType: 'delivery', entityId: current.id, eventType: 'delivery.exported', payload: { assetCount: Array.isArray(manifest.files) ? manifest.files.length : 0 } });
    db.prepare('DELETE FROM delivery_export_journal WHERE idempotency_key = ?').run(pending.idempotency_key);
    return { id: current.id, projectId: current.project_id, name: current.name, status: 'exported' as const, manifest: redacted(manifest) as Record<string, unknown> };
  }, input).value;
}

export function exportDelivery(db: StudioDatabase, paths: StudioPaths, input: { deliveryId: string; idempotencyKey: string }): { delivery: Delivery; directory: string; files: string[] } {
  const replay = db.prepare('SELECT command_name, response_json FROM command_receipts WHERE idempotency_key = ?').get(input.idempotencyKey) as { command_name: string; response_json: string } | undefined;
  if (replay?.command_name === 'deliveries.export') {
    const deliveryValue = JSON.parse(replay.response_json) as Delivery;
    const relative = typeof deliveryValue.manifest.exportDirectory === 'string' ? deliveryValue.manifest.exportDirectory : '';
    const directory = path.resolve(paths.workspaceRoot, relative);
    return { delivery: deliveryValue, directory, files: fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [] };
  }
  const pending = db.prepare('SELECT idempotency_key, delivery_id, studio_id, directory_path, manifest_json, files_json FROM delivery_export_journal WHERE idempotency_key = ?').get(input.idempotencyKey) as PendingDeliveryExport | undefined;
  if (pending && pending.delivery_id === input.deliveryId) {
    const directory = path.resolve(paths.workspaceRoot, pending.directory_path);
    if (fs.existsSync(directory)) return { delivery: finalizeJournaledExport(db, pending, input), directory, files: exportedFiles(pending.files_json) };
  }
  const current = db.prepare('SELECT id, project_id, name, status, manifest_json FROM deliveries WHERE id = ?').get(input.deliveryId) as StoredDelivery | undefined;
  if (!current) throw new StudioNotFoundError('Delivery not found: ' + input.deliveryId);
  const value = delivery(current);
  if (value.status !== 'ready') throw new InvalidCommandError('Only a prepared delivery can be exported.');
  const project = assertProject(db, value.projectId);
  const frozenItems = deliveryItems(db, value.id);
  const assets = activeAssets(db, project.studio_id, frozenItems.map((item) => item.assetId));
  const directory = path.join(paths.deliveriesRoot, safeSegment(project.name), safeSegment(value.name) + '-' + value.id.slice(-8));
  const temporary = directory + '.tmp-' + process.pid;
  const backup = directory + '.previous-' + process.pid;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.rmSync(backup, { recursive: true, force: true });
  fs.mkdirSync(temporary, { recursive: true });
  const files: Array<{ sequence: number; file: string; mediaType: string; contentHash: string }> = [];
  const includeCreativeRecord = value.manifest.includeCreativeRecord === true;
  try {
    for (const [index, asset] of assets.entries()) {
      const sequence = index + 1;
      const file = String(sequence).padStart(3, '0') + extensionFor(asset);
      fs.copyFileSync(assetFilePath(paths, asset), path.join(temporary, file));
      files.push({ sequence, file, mediaType: asset.mediaType, contentHash: asset.contentHash });
    }
    const record = includeCreativeRecord ? creativeRecord(db, project, value, assets) : null;
    const exportedAt = nowIso();
    const manifest = { deliveryId: value.id, projectId: project.id, projectName: project.name, deliveryName: value.name, exportedAt, files };
    const deliveryManifest = { ...value.manifest, frozenItems: frozenItems.map((item) => ({ assetId: item.assetId, sequence: item.sequence, source: item.source, review: item.review })), exportDirectory: path.relative(paths.workspaceRoot, directory).split(path.sep).join('/'), exportedAt, files };
    const contactSheet = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + value.name + '</title><style>body{margin:32px;background:#f4f4ed;color:#202720;font-family:sans-serif}h1{font-size:22px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.item{background:#fff;border:1px solid #d7dbd2;padding:8px}.item img{display:block;width:100%;aspect-ratio:1;object-fit:contain;background:#eef0e9}.item span{display:block;margin-top:7px;font-size:11px;color:#596257}</style><h1>' + value.name.replace(/</g, '&lt;') + '</h1><div class="grid">' + files.map((file) => '<div class="item"><img src="' + file.file + '" alt=""><span>素材 ' + file.sequence + '</span></div>').join('') + '</div>';
    fs.writeFileSync(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    if (record) fs.writeFileSync(path.join(temporary, 'creative-record.json'), JSON.stringify(record, null, 2) + '\n');
    fs.writeFileSync(path.join(temporary, 'contact-sheet.html'), contactSheet + '\n');
    const outputFiles = files.map((file) => file.file).concat(['manifest.json', ...(includeCreativeRecord ? ['creative-record.json'] : []), 'contact-sheet.html']);
    withTransaction(db, () => {
      db.prepare('INSERT INTO delivery_export_journal (idempotency_key, delivery_id, studio_id, directory_path, manifest_json, files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO UPDATE SET delivery_id = excluded.delivery_id, studio_id = excluded.studio_id, directory_path = excluded.directory_path, manifest_json = excluded.manifest_json, files_json = excluded.files_json, created_at = excluded.created_at').run(input.idempotencyKey, value.id, project.studio_id, deliveryManifest.exportDirectory as string, JSON.stringify(deliveryManifest), JSON.stringify(outputFiles), nowIso());
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
  const pendingExport = db.prepare('SELECT idempotency_key, delivery_id, studio_id, directory_path, manifest_json, files_json FROM delivery_export_journal WHERE idempotency_key = ?').get(input.idempotencyKey) as unknown as PendingDeliveryExport;
  const committed = finalizeJournaledExport(db, pendingExport, input);
  return { delivery: committed, directory, files: exportedFiles(pendingExport.files_json) };
}
