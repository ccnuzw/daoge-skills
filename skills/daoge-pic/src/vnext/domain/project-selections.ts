import { StudioDatabase, appendStudioEvent, withTransaction } from '../studio/database';
import { StudioAsset, getStudioAsset } from './assets';
import { InvalidCommandError, StudioNotFoundError } from './studio-commands';
import { createId, nowIso } from '../shared/ids';

function requireProject(db: StudioDatabase, studioId: string, projectId: string): void {
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND studio_id = ?').get(projectId, studioId) as { id: string } | undefined;
  if (!project) throw new StudioNotFoundError('Project not found: ' + projectId);
}

function projectOwnsAsset(db: StudioDatabase, projectId: string, assetId: string): boolean {
  const row = db.prepare("SELECT 1 FROM asset_relations relation WHERE relation.asset_id = ? AND ((relation.target_type = 'project' AND relation.target_id = ? AND relation.relation_type != 'selected_for') OR (relation.target_type = 'creative_task' AND EXISTS (SELECT 1 FROM creative_tasks task WHERE task.id = relation.target_id AND task.project_id = ?)) OR (relation.target_type = 'creative_round' AND EXISTS (SELECT 1 FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id WHERE round.id = relation.target_id AND task.project_id = ?)) OR (relation.target_type = 'run_item' AND relation.relation_type = 'output_of' AND EXISTS (SELECT 1 FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id WHERE item.id = relation.target_id AND task.project_id = ?))) LIMIT 1").get(assetId, projectId, projectId, projectId, projectId) as { 1: number } | undefined;
  return Boolean(row);
}

export function listProjectSelectionAssets(db: StudioDatabase, input: { studioId: string; projectId: string; includeDeleted?: boolean }): StudioAsset[] {
  requireProject(db, input.studioId, input.projectId);
  const rows = db.prepare("SELECT asset.id, asset.studio_id, asset.kind, asset.media_type, asset.storage_path, asset.content_hash, asset.byte_size, asset.source_json, asset.deleted_at FROM asset_relations selection JOIN assets asset ON asset.id = selection.asset_id WHERE selection.relation_type = 'selected_for' AND selection.target_type = 'project' AND selection.target_id = ? AND asset.studio_id = ? AND (? = 1 OR asset.deleted_at IS NULL) ORDER BY selection.created_at, selection.asset_id").all(input.projectId, input.studioId, input.includeDeleted ? 1 : 0) as Array<{ id: string; studio_id: string; kind: StudioAsset['kind']; media_type: string; storage_path: string; content_hash: string; byte_size: number; source_json: string; deleted_at: string | null }>;
  return rows.map((row) => ({ id: row.id, studioId: row.studio_id, kind: row.kind, mediaType: row.media_type, storagePath: row.storage_path, contentHash: row.content_hash, byteSize: row.byte_size, source: JSON.parse(row.source_json || '{}') as Record<string, unknown>, deletedAt: row.deleted_at }));
}

export function setProjectAssetSelected(db: StudioDatabase, input: { studioId: string; projectId: string; assetId: string; selected: boolean; emitEvent?: boolean }): { projectId: string; assetId: string; selected: boolean; changed: boolean } {
  requireProject(db, input.studioId, input.projectId);
  const asset = getStudioAsset(db, input.studioId, input.assetId);
  if (!asset || asset.deletedAt) throw new StudioNotFoundError('Active Studio asset not found: ' + input.assetId);
  if (input.selected && !projectOwnsAsset(db, input.projectId, asset.id)) throw new InvalidCommandError('Selection asset does not belong to the selected project.');
  let changed = false;
  withTransaction(db, () => {
    if (input.selected) {
      const result = db.prepare("INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, 'selected_for', 'project', ?, '{}', ?) ON CONFLICT(asset_id, relation_type, target_type, target_id) DO NOTHING").run(createId('assetrel'), asset.id, input.projectId, nowIso());
      changed = Number(result.changes) > 0;
    } else {
      const result = db.prepare("DELETE FROM asset_relations WHERE asset_id = ? AND relation_type = 'selected_for' AND target_type = 'project' AND target_id = ?").run(asset.id, input.projectId);
      changed = Number(result.changes) > 0;
    }
    if (changed && input.emitEvent !== false) appendStudioEvent(db, { studioId: input.studioId, entityType: 'project', entityId: input.projectId, eventType: 'project.selection_updated', payload: { selected: input.selected } });
  });
  return { projectId: input.projectId, assetId: asset.id, selected: input.selected, changed };
}

export function setProjectAssetsSelected(db: StudioDatabase, input: { studioId: string; projectId: string; assetIds: string[]; selected: boolean }): { projectId: string; assetIds: string[]; selected: boolean; changed: number } {
  const assetIds = [...new Set(input.assetIds.map((assetId) => String(assetId || '').trim()).filter(Boolean))];
  if (!assetIds.length || assetIds.length > 500) throw new InvalidCommandError('Batch selection requires 1 to 500 assets.');
  return withTransaction(db, () => {
    requireProject(db, input.studioId, input.projectId);
    const placeholders = assetIds.map(() => '?').join(',');
    const active = db.prepare('SELECT id FROM assets WHERE studio_id = ? AND deleted_at IS NULL AND id IN (' + placeholders + ')').all(input.studioId, ...assetIds) as Array<{ id: string }>;
    if (active.length !== assetIds.length) throw new StudioNotFoundError('One or more active assets were not found in this Studio.');
    if (input.selected) {
      const owned = db.prepare("SELECT DISTINCT relation.asset_id FROM asset_relations relation WHERE relation.asset_id IN (" + placeholders + ") AND ((relation.target_type = 'project' AND relation.target_id = ? AND relation.relation_type != 'selected_for') OR (relation.target_type = 'creative_task' AND EXISTS (SELECT 1 FROM creative_tasks task WHERE task.id = relation.target_id AND task.project_id = ?)) OR (relation.target_type = 'creative_round' AND EXISTS (SELECT 1 FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id WHERE round.id = relation.target_id AND task.project_id = ?)) OR (relation.target_type = 'run_item' AND relation.relation_type = 'output_of' AND EXISTS (SELECT 1 FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id WHERE item.id = relation.target_id AND task.project_id = ?)))").all(...assetIds, input.projectId, input.projectId, input.projectId, input.projectId) as Array<{ asset_id: string }>;
      if (owned.length !== assetIds.length) throw new InvalidCommandError('One or more selection assets do not belong to the selected project.');
    }
    let changed = 0;
    const timestamp = nowIso();
    const insert = db.prepare("INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, 'selected_for', 'project', ?, '{}', ?) ON CONFLICT(asset_id, relation_type, target_type, target_id) DO NOTHING");
    const remove = db.prepare("DELETE FROM asset_relations WHERE asset_id = ? AND relation_type = 'selected_for' AND target_type = 'project' AND target_id = ?");
    for (const assetId of assetIds) {
      const result = input.selected ? insert.run(createId('assetrel'), assetId, input.projectId, timestamp) : remove.run(assetId, input.projectId);
      changed += Number(result.changes);
    }
    if (changed) appendStudioEvent(db, { studioId: input.studioId, entityType: 'project', entityId: input.projectId, eventType: 'project.selection_updated', payload: { selected: input.selected, count: changed } });
    return { projectId: input.projectId, assetIds, selected: input.selected, changed };
  });
}
