import { StudioDatabase } from '../studio/database';

export type ProjectAssetAccess = 'project' | 'shared' | 'out_of_scope' | 'missing';

const PROJECT_ASSET_RELATION = `(
  (relation.relation_type = 'attached_to' AND relation.target_type = 'project' AND relation.target_id = ?)
  OR (relation.relation_type = 'attached_to' AND relation.target_type = 'creative_task' AND EXISTS (
    SELECT 1 FROM creative_tasks task
    WHERE task.id = relation.target_id AND task.project_id = ?
  ))
  OR (relation.relation_type = 'attached_to' AND relation.target_type = 'creative_round' AND EXISTS (
    SELECT 1 FROM creative_rounds round
    JOIN creative_tasks task ON task.id = round.task_id
    WHERE round.id = relation.target_id AND task.project_id = ?
  ))
  OR (relation.relation_type = 'output_of' AND relation.target_type = 'run_item' AND EXISTS (
    SELECT 1 FROM run_items item
    JOIN generation_runs run ON run.id = item.run_id
    JOIN creative_rounds round ON round.id = run.round_id
    JOIN creative_tasks task ON task.id = round.task_id
    WHERE item.id = relation.target_id AND task.project_id = ?
  ))
)`;

export function inspectProjectAssetAccess(db: StudioDatabase, input: { studioId: string; projectId: string; assetIds: readonly string[] }): Map<string, ProjectAssetAccess> {
  const ids = [...new Set(input.assetIds.filter((assetId): assetId is string => typeof assetId === 'string' && assetId.trim().length > 0))];
  const result = new Map<string, ProjectAssetAccess>(ids.map((assetId) => [assetId, 'missing']));
  if (!ids.length) return result;
  const placeholders = ids.map(() => '?').join(', ');
  const query = `
    SELECT asset.id,
      CASE
        WHEN asset.deleted_at IS NOT NULL THEN 'missing'
        WHEN EXISTS (
          SELECT 1 FROM asset_relations relation
          WHERE relation.asset_id = asset.id AND ${PROJECT_ASSET_RELATION}
        ) THEN 'project'
        WHEN EXISTS (
          SELECT 1 FROM asset_relations relation
          WHERE relation.asset_id = asset.id
            AND relation.relation_type = 'shared_across_projects'
            AND relation.target_type = 'studio'
            AND relation.target_id = ?
        ) THEN 'shared'
        ELSE 'out_of_scope'
      END AS access
    FROM assets asset
    WHERE asset.studio_id = ? AND asset.id IN (${placeholders})
  `;
  const rows = db.prepare(query).all(input.projectId, input.projectId, input.projectId, input.projectId, input.studioId, input.studioId, ...ids) as Array<{ id: string; access: ProjectAssetAccess }>;
  for (const row of rows) result.set(row.id, row.access);
  return result;
}

export function projectAssetReferenceAllowed(access: ProjectAssetAccess | undefined): boolean {
  return access === 'project' || access === 'shared';
}
