import { StudioDatabase } from '../studio/database';

/**
 * One place that knows how to ask "does this entity belong to this Studio?".
 *
 * Before this module the same JOIN chain — `… JOIN creative_tasks task ON task.id = round.task_id
 * JOIN projects project ON project.id = task.project_id WHERE … AND project.studio_id = ?` — was written out
 * about twenty times across nine files, plus three more copies of the "entity type -> SQL" table itself
 * (the `assertXxxInStudio` family in `server.ts`, the `queries` map in `assertImportTarget`, and
 * `relationBelongsToStudio` in `domain/assets.ts`).
 *
 * That matters more than the usual duplication argument: **every one of those copies has to remember the
 * `studio_id` predicate by hand.** Drop it in one place and a caller reads another Studio's rows — a silent
 * cross-tenant leak rather than a loud error. Deriving the predicate from a table makes the omission
 * impossible instead of merely unlikely.
 *
 * Scope of this module: **Studio** ownership only. Filtering by `project_id` (asset relations, canvas
 * layouts) is a different question and deliberately stays where it is.
 */

export type ScopedEntityType =
  | 'project'
  | 'creative_task'
  | 'creative_round'
  | 'generation_run'
  | 'run_item'
  | 'dry_run_preview'
  | 'asset'
  | 'delivery'
  | 'delivery_batch'
  | 'delivery_batch_version'
  | 'style_kit'
  | 'brand_kit'
  | 'studio_session';

export interface EntityScopeQuery {
  /** Human-facing entity name, used to build "not found in this Studio" messages. */
  label: string;
  /** The entity's own table with its alias, e.g. `creative_rounds round`. */
  table: string;
  /** JOINs from that table up to `projects project`. Empty for tables carrying `studio_id` themselves. */
  joins: string;
  /** `FROM <table> <joins>`, without `WHERE`. */
  from: string;
  /**
   * `WHERE` conditions binding the entity id first and the Studio id second.
   * Callers appending their own conditions must add them **after** these two parameters.
   */
  where: string;
}

/**
 * Assembles a query for a caller that needs to join *extra* tables onto the scope chain — for example
 * listing every plan version of a round. `joinExtra` is appended after the entity table, before the
 * scope JOINs, so the Studio predicate still lands on `project`.
 */
export function joinInStudioSql(type: ScopedEntityType, extra: string): string {
  const scope = ENTITY_SCOPE_QUERIES[type];
  return ['FROM', scope.table, extra, scope.joins].filter(Boolean).join(' ');
}

const ROUND_CHAIN = 'JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id';
const RUN_CHAIN = 'JOIN creative_rounds round ON round.id = run.round_id ' + ROUND_CHAIN;
const ITEM_CHAIN = 'JOIN generation_runs run ON run.id = item.run_id ' + RUN_CHAIN;

function scope(label: string, table: string, joins: string, idColumn: string, studioColumn: string): EntityScopeQuery {
  return { label, table, joins, from: 'FROM ' + table + (joins ? ' ' + joins : ''), where: idColumn + ' = ? AND ' + studioColumn + ' = ?' };
}

export const ENTITY_SCOPE_QUERIES: Record<ScopedEntityType, EntityScopeQuery> = {
  project: scope('Project', 'projects project', '', 'project.id', 'project.studio_id'),
  creative_task: scope('Creative task', 'creative_tasks task', 'JOIN projects project ON project.id = task.project_id', 'task.id', 'project.studio_id'),
  creative_round: scope('Creative round', 'creative_rounds round', ROUND_CHAIN, 'round.id', 'project.studio_id'),
  generation_run: scope('Generation run', 'generation_runs run', RUN_CHAIN, 'run.id', 'project.studio_id'),
  run_item: scope('Generation run item', 'run_items item', ITEM_CHAIN, 'item.id', 'project.studio_id'),
  dry_run_preview: scope('Dry-run preview', 'dry_run_previews preview', 'JOIN creative_rounds round ON round.id = preview.round_id ' + ROUND_CHAIN, 'preview.id', 'project.studio_id'),
  // These four carry `studio_id` directly, but they still get an alias so the `where` clause reads the same
  // as every joined entity does.
  asset: scope('Asset', 'assets asset', '', 'asset.id', 'asset.studio_id'),
  style_kit: scope('Style kit', 'style_kits style_kit', '', 'style_kit.id', 'style_kit.studio_id'),
  brand_kit: scope('Brand kit', 'brand_kits brand_kit', '', 'brand_kit.id', 'brand_kit.studio_id'),
  studio_session: scope('Studio session', 'studio_sessions studio_session', '', 'studio_session.id', 'studio_session.studio_id'),
  delivery: scope('Delivery', 'deliveries delivery', 'JOIN projects project ON project.id = delivery.project_id', 'delivery.id', 'project.studio_id'),
  delivery_batch: scope('Delivery batch', 'delivery_batches batch', 'JOIN projects project ON project.id = batch.project_id', 'batch.id', 'project.studio_id'),
  delivery_batch_version: scope('Delivery batch version', 'delivery_batch_versions version', 'JOIN delivery_batches batch ON batch.id = version.batch_id JOIN projects project ON project.id = batch.project_id', 'version.id', 'project.studio_id')
};

export const SCOPED_ENTITY_TYPES = Object.keys(ENTITY_SCOPE_QUERIES) as ScopedEntityType[];

/** `SELECT 1 …` existence query. Binds (entityId, studioId). */
export function existsInStudioSql(type: ScopedEntityType): string {
  const scope = ENTITY_SCOPE_QUERIES[type];
  return 'SELECT 1 ' + scope.from + ' WHERE ' + scope.where;
}

/**
 * `SELECT <columns> …` for callers that need rows rather than a yes/no answer.
 * Binds (entityId, studioId); extra conditions go after both.
 */
export function selectInStudioSql(type: ScopedEntityType, columns: string): string {
  const scope = ENTITY_SCOPE_QUERIES[type];
  return 'SELECT ' + columns + ' ' + scope.from + ' WHERE ' + scope.where;
}

/** True when `id` exists and belongs to `studioId`. */
export function isInStudio(db: StudioDatabase, type: ScopedEntityType, id: string, studioId: string): boolean {
  return Boolean(db.prepare(existsInStudioSql(type)).get(id, studioId));
}

/** Default refusal message for an entity that is missing or belongs to another Studio. */
export function notInStudioMessage(type: ScopedEntityType, id: string): string {
  return ENTITY_SCOPE_QUERIES[type].label + ' not found in this Studio: ' + id;
}
