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
  const rows = db.prepare("SELECT selection.asset_id FROM asset_relations selection JOIN assets asset ON asset.id = selection.asset_id WHERE selection.relation_type = 'selected_for' AND selection.target_type = 'project' AND selection.target_id = ? AND asset.studio_id = ? AND (? = 1 OR asset.deleted_at IS NULL) ORDER BY selection.created_at, selection.asset_id").all(input.projectId, input.studioId, input.includeDeleted ? 1 : 0) as Array<{ asset_id: string }>;
  return rows.map((row) => getStudioAsset(db, input.studioId, row.asset_id)).filter((asset): asset is StudioAsset => Boolean(asset));
}

export function setProjectAssetSelected(db: StudioDatabase, input: { studioId: string; projectId: string; assetId: string; selected: boolean }): { projectId: string; assetId: string; selected: boolean; changed: boolean } {
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
    if (changed) appendStudioEvent(db, { studioId: input.studioId, entityType: 'project', entityId: input.projectId, eventType: 'project.selection_updated', payload: { selected: input.selected } });
  });
  return { projectId: input.projectId, assetId: asset.id, selected: input.selected, changed };
}
