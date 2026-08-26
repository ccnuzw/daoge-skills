import fs from 'node:fs';
import path from 'node:path';
import { assetFilePath, getStudioAsset, StudioAsset } from './assets';
import { createId, nowIso } from '../shared/ids';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { executeIdempotent, InvalidCommandError, StudioNotFoundError } from './studio-commands';
import { StudioPaths } from '../studio/workspace';

export interface Delivery { id: string; projectId: string; name: string; status: 'draft' | 'ready' | 'exported'; manifest: Record<string, unknown>; }

interface StoredDelivery { id: string; project_id: string; name: string; status: Delivery['status']; manifest_json: string; }
interface ProjectRow { id: string; studio_id: string; name: string; }
interface PendingDeliveryExport { idempotency_key: string; delivery_id: string; studio_id: string; directory_path: string; manifest_json: string; files_json: string; }

function parse(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function delivery(row: StoredDelivery): Delivery { return { id: row.id, projectId: row.project_id, name: row.name, status: row.status, manifest: parse(row.manifest_json) }; }
function requireText(value: string, label: string): string { const text = String(value || '').trim(); if (!text) throw new InvalidCommandError(label + ' is required.'); return text; }
function safeSegment(value: string): string { const normalized = String(value || '').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72); return normalized || 'delivery'; }
function extensionFor(asset: StudioAsset): string { if (asset.mediaType === 'image/jpeg') return '.jpg'; if (asset.mediaType === 'image/webp') return '.webp'; if (asset.mediaType === 'image/gif') return '.gif'; return '.png'; }

function redacted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redacted);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(api[_-]?key|authorization|secret|token|base[_-]?url|password)/i.test(key)) result[key] = '[redacted]';
    else result[key] = redacted(item);
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

export function createDelivery(db: StudioDatabase, input: { projectId: string; name: string; assetIds: string[]; includeCreativeRecord?: boolean; idempotencyKey: string }): Delivery {
  const receipt = executeIdempotent(db, input.idempotencyKey, 'deliveries.create', () => {
    const project = assertProject(db, input.projectId);
    const assets = activeAssets(db, project.studio_id, input.assetIds);
    const id = createId('delivery');
    const timestamp = nowIso();
    const manifest = { assetIds: assets.map((asset) => asset.id), includeCreativeRecord: input.includeCreativeRecord === true, createdAt: timestamp };
    db.prepare('INSERT INTO deliveries (id, project_id, name, manifest_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, project.id, requireText(input.name, 'Delivery name'), JSON.stringify(manifest), 'ready', timestamp, timestamp);
    for (const asset of assets) db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(createId('assetrel'), asset.id, 'included_in', 'delivery', id, '{}', timestamp);
    appendStudioEvent(db, { studioId: project.studio_id, entityType: 'delivery', entityId: id, eventType: 'delivery.ready', payload: { projectId: project.id, assetCount: assets.length } });
    return { id, projectId: project.id, name: requireText(input.name, 'Delivery name'), status: 'ready' as const, manifest };
  }, input);
  return receipt.value;
}

export function listDeliveries(db: StudioDatabase, projectId: string): Delivery[] { return (db.prepare('SELECT id, project_id, name, status, manifest_json FROM deliveries WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as unknown as StoredDelivery[]).map(delivery); }

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
    return { id: current.id, projectId: current.project_id, name: current.name, status: 'exported' as const, manifest };
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
  const project = assertProject(db, value.projectId);
  const assetIds = Array.isArray(value.manifest.assetIds) ? value.manifest.assetIds.filter((id): id is string => typeof id === 'string') : [];
  const assets = activeAssets(db, project.studio_id, assetIds);
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
    const deliveryManifest = { ...value.manifest, exportDirectory: path.relative(paths.workspaceRoot, directory).split(path.sep).join('/'), exportedAt, files };
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
