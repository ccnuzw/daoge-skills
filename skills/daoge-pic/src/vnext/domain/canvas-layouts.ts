import { createId, nowIso } from '../shared/ids';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { inspectProjectAssetAccess, projectAssetReferenceAllowed } from './asset-access';
import { InvalidCommandError, StudioNotFoundError } from './studio-commands';

export type CanvasLayoutScopeType = 'project' | 'task' | 'round';
export type CanvasLayoutEntityType = 'project' | 'task' | 'round' | 'plan' | 'run' | 'run_item' | 'asset' | 'shared_asset' | 'delivery' | 'group' | 'task_type' | 'style_kit' | 'brand_kit';
export type CanvasGroupType = 'task' | 'round' | 'run' | 'delivery' | 'custom';
export type CanvasLinkType = 'reference' | 'style' | 'alternative' | 'rejected' | 'todo' | 'context' | 'custom';

export interface CanvasViewport { x: number; y: number; k: number; }
export interface CanvasNodeLayoutInput { entityType: CanvasLayoutEntityType; entityId: string; x: number; y: number; width: number; height: number; collapsed?: boolean; groupId?: string | null; }
export interface CanvasGroupLayoutInput { id?: string; title: string; groupType?: CanvasGroupType; x: number; y: number; width: number; height: number; metadata?: Record<string, unknown>; }
export interface CanvasLinkLayoutInput { id?: string; sourceType: CanvasLayoutEntityType; sourceId: string; targetType: CanvasLayoutEntityType; targetId: string; linkType?: CanvasLinkType; label?: string; metadata?: Record<string, unknown>; }
export interface CanvasLayoutInput { studioId: string; projectId: string; scopeType?: CanvasLayoutScopeType; scopeId?: string; viewport?: CanvasViewport; settings?: Record<string, unknown>; nodes?: CanvasNodeLayoutInput[]; groups?: CanvasGroupLayoutInput[]; links?: CanvasLinkLayoutInput[]; }
export interface CanvasNodeLayout extends CanvasNodeLayoutInput { id: string; collapsed: boolean; groupId: string | null; }
export interface CanvasGroupLayout extends Required<Omit<CanvasGroupLayoutInput, 'id' | 'groupType' | 'metadata'>> { id: string; groupType: CanvasGroupType; metadata: Record<string, unknown>; }
export interface CanvasLinkLayout extends Required<Omit<CanvasLinkLayoutInput, 'id' | 'linkType' | 'label' | 'metadata'>> { id: string; linkType: CanvasLinkType; label: string; metadata: Record<string, unknown>; }
export interface CanvasLayout { id: string | null; studioId: string; projectId: string; scopeType: CanvasLayoutScopeType; scopeId: string; viewport: CanvasViewport; settings: Record<string, unknown>; version: number; nodes: CanvasNodeLayout[]; groups: CanvasGroupLayout[]; links: CanvasLinkLayout[]; }

type LayoutRow = { id: string; studio_id: string; project_id: string; scope_type: CanvasLayoutScopeType; scope_id: string; viewport_json: string; settings_json: string; version: number; };
type NodeRow = { id: string; entity_type: CanvasLayoutEntityType; entity_id: string; x: number; y: number; width: number; height: number; collapsed: number; group_id: string | null; };
type GroupRow = { id: string; title: string; group_type: CanvasGroupType; x: number; y: number; width: number; height: number; metadata_json: string; };
type LinkRow = { id: string; source_type: CanvasLayoutEntityType; source_id: string; target_type: CanvasLayoutEntityType; target_id: string; link_type: CanvasLinkType; label: string; metadata_json: string; };

const ENTITY_TYPES: Record<CanvasLayoutEntityType, true> = { project: true, task: true, round: true, plan: true, run: true, run_item: true, asset: true, shared_asset: true, delivery: true, group: true, task_type: true, style_kit: true, brand_kit: true };
const GROUP_TYPES: Record<CanvasGroupType, true> = { task: true, round: true, run: true, delivery: true, custom: true };
const LINK_TYPES: Record<CanvasLinkType, true> = { reference: true, style: true, alternative: true, rejected: true, todo: true, context: true, custom: true };
const LINK_LABELS: Record<CanvasLinkType, string> = { reference: '参考自', style: '风格继承', alternative: '备选方案', rejected: '客户否决', todo: '待重做', context: '计划上下文', custom: '标注关系' };
const SCOPE_TYPES: Record<CanvasLayoutScopeType, true> = { project: true, task: true, round: true };
const MAX_NODE_LAYOUTS = 1000;
const MAX_GROUP_LAYOUTS = 200;
const MAX_LINK_LAYOUTS = 500;
const MAX_JSON_BYTES = 64 * 1024;
const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, k: 1 };

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => safeValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/(api[_-]?key|authorization|secret|token|base[_-]?url|endpoint|password|external.*request|storage.*path|content.*hash)/i.test(key)) continue;
    result[key.slice(0, 80)] = safeValue(item, depth + 1);
  }
  return result;
}

function safeRecord(value: unknown): Record<string, unknown> {
  const safe = safeValue(value);
  if (!safe || typeof safe !== 'object' || Array.isArray(safe)) return {};
  const json = JSON.stringify(safe);
  if (Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) throw new InvalidCommandError('画布布局设置过大。');
  return safe as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  const text = String(value || '').trim();
  if (!text) throw new InvalidCommandError(label + ' is required.');
  if (text.length > 160) throw new InvalidCommandError(label + ' is too long.');
  return text;
}

function finiteNumber(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new InvalidCommandError(label + ' must be a finite number.');
  return number;
}

function boundedNumber(value: unknown, label: string, min: number, max: number): number {
  const number = finiteNumber(value, label);
  if (number < min || number > max) throw new InvalidCommandError(label + ' is outside the supported range.');
  return number;
}

function normalizeViewport(value: unknown): CanvasViewport {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : DEFAULT_VIEWPORT;
  return { x: boundedNumber(source.x ?? 0, 'viewport.x', -1000000, 1000000), y: boundedNumber(source.y ?? 0, 'viewport.y', -1000000, 1000000), k: boundedNumber(source.k ?? 1, 'viewport.k', 0.05, 5) };
}

function assertProjectInStudio(db: StudioDatabase, studioId: string, projectId: string): void {
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ? AND studio_id = ?').get(projectId, studioId)) throw new StudioNotFoundError('Project not found: ' + projectId);
}

function assertScopeInProject(db: StudioDatabase, studioId: string, projectId: string, scopeType: CanvasLayoutScopeType, scopeId: string): void {
  assertProjectInStudio(db, studioId, projectId);
  if (scopeType === 'project') {
    if (scopeId !== projectId) throw new InvalidCommandError('项目画布布局必须绑定当前项目。');
    return;
  }
  if (scopeType === 'task') {
    if (!db.prepare('SELECT 1 FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.id = ? AND task.project_id = ? AND project.studio_id = ?').get(scopeId, projectId, studioId)) throw new StudioNotFoundError('Creative task not found: ' + scopeId);
    return;
  }
  if (!db.prepare('SELECT 1 FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.id = ? AND project.id = ? AND project.studio_id = ?').get(scopeId, projectId, studioId)) throw new StudioNotFoundError('Creative round not found: ' + scopeId);
}

function assetIsSharedAcrossStudio(db: StudioDatabase, studioId: string, assetId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM assets asset JOIN asset_relations relation ON relation.asset_id = asset.id WHERE asset.id = ? AND asset.studio_id = ? AND asset.deleted_at IS NULL AND relation.relation_type = 'shared_across_projects' AND relation.target_type = 'studio' AND relation.target_id = ?").get(assetId, studioId, studioId));
}

function normalizeScope(db: StudioDatabase, input: CanvasLayoutInput): { scopeType: CanvasLayoutScopeType; scopeId: string } {
  const scopeType = String(input.scopeType || 'project') as CanvasLayoutScopeType;
  if (!SCOPE_TYPES[scopeType]) throw new InvalidCommandError('Unsupported canvas layout scope.');
  const scopeId = requiredText(input.scopeId || input.projectId, 'Canvas layout scope id');
  assertScopeInProject(db, input.studioId, input.projectId, scopeType, scopeId);
  return { scopeType, scopeId };
}

function assertEntityBelongsToProject(db: StudioDatabase, studioId: string, projectId: string, entityType: CanvasLayoutEntityType, entityId: string): void {
  if (entityType === 'group') return;
  if (entityType === 'project') {
    if (entityId !== projectId) throw new InvalidCommandError('Project layout node must reference the current project.');
    return;
  }
  if (entityType === 'task') {
    if (!db.prepare('SELECT 1 FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.id = ? AND task.project_id = ? AND project.studio_id = ?').get(entityId, projectId, studioId)) throw new StudioNotFoundError('Creative task not found: ' + entityId);
    return;
  }
  if (entityType === 'round' || entityType === 'plan') {
    if (!db.prepare('SELECT 1 FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.id = ? AND project.id = ? AND project.studio_id = ?').get(entityId, projectId, studioId)) throw new StudioNotFoundError('Creative round not found: ' + entityId);
    return;
  }
  if (entityType === 'run') {
    if (!db.prepare('SELECT 1 FROM generation_runs run JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE run.id = ? AND project.id = ? AND project.studio_id = ?').get(entityId, projectId, studioId)) throw new StudioNotFoundError('Generation run not found: ' + entityId);
    return;
  }
  if (entityType === 'run_item') {
    if (!db.prepare('SELECT 1 FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE item.id = ? AND project.id = ? AND project.studio_id = ?').get(entityId, projectId, studioId)) throw new StudioNotFoundError('Generation run item not found: ' + entityId);
    return;
  }
  if (entityType === 'asset' || entityType === 'shared_asset') {
    const access = inspectProjectAssetAccess(db, { studioId, projectId, assetIds: [entityId] }).get(entityId);
    if (!projectAssetReferenceAllowed(access)) throw new StudioNotFoundError('Canvas asset is not available to this project: ' + entityId);
    if (entityType === 'shared_asset' && !assetIsSharedAcrossStudio(db, studioId, entityId)) throw new InvalidCommandError('Canvas shared asset must reference an explicitly shared asset.');
    return;
  }
  if (entityType === 'delivery') {
    if (!db.prepare('SELECT 1 FROM deliveries delivery JOIN projects project ON project.id = delivery.project_id WHERE delivery.id = ? AND project.id = ? AND project.studio_id = ?').get(entityId, projectId, studioId)) throw new StudioNotFoundError('Delivery not found: ' + entityId);
    return;
  }
  if (entityType === 'task_type') {
    if (!db.prepare("SELECT 1 FROM task_types WHERE id = ? AND (source = 'official' OR studio_id = ?)").get(entityId, studioId)) throw new StudioNotFoundError('Task type not found: ' + entityId);
    return;
  }
  if (entityType === 'style_kit') {
    if (!db.prepare('SELECT 1 FROM style_kits WHERE id = ? AND studio_id = ?').get(entityId, studioId)) throw new StudioNotFoundError('Style kit not found: ' + entityId);
    return;
  }
  if (entityType === 'brand_kit') {
    if (!db.prepare('SELECT 1 FROM brand_kits WHERE id = ? AND studio_id = ?').get(entityId, studioId)) throw new StudioNotFoundError('Brand kit not found: ' + entityId);
  }
}

function normalizeNode(db: StudioDatabase, studioId: string, projectId: string, value: unknown): CanvasNodeLayoutInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidCommandError('画布节点布局必须是对象。');
  const source = value as Record<string, unknown>;
  const entityType = String(source.entityType || '') as CanvasLayoutEntityType;
  if (!ENTITY_TYPES[entityType]) throw new InvalidCommandError('Unsupported canvas layout node type.');
  const entityId = requiredText(source.entityId, 'Canvas layout node entity id');
  assertEntityBelongsToProject(db, studioId, projectId, entityType, entityId);
  return {
    entityType,
    entityId,
    x: boundedNumber(source.x, 'node.x', -1000000, 1000000),
    y: boundedNumber(source.y, 'node.y', -1000000, 1000000),
    width: boundedNumber(source.width, 'node.width', 40, 4000),
    height: boundedNumber(source.height, 'node.height', 40, 4000),
    collapsed: source.collapsed === true,
    groupId: typeof source.groupId === 'string' && source.groupId.trim() ? source.groupId.trim().slice(0, 160) : null
  };
}

function normalizeGroup(value: unknown): CanvasGroupLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidCommandError('画布分组布局必须是对象。');
  const source = value as Record<string, unknown>;
  const groupType = String(source.groupType || 'custom') as CanvasGroupType;
  if (!GROUP_TYPES[groupType]) throw new InvalidCommandError('Unsupported canvas group type.');
  return {
    id: requiredText(source.id, 'Canvas group id'),
    title: requiredText(source.title || '分组', 'Canvas group title'),
    groupType,
    x: boundedNumber(source.x, 'group.x', -1000000, 1000000),
    y: boundedNumber(source.y, 'group.y', -1000000, 1000000),
    width: boundedNumber(source.width, 'group.width', 80, 4000),
    height: boundedNumber(source.height, 'group.height', 80, 4000),
    metadata: safeRecord(source.metadata)
  };
}

function assertLinkEndpointBelongsToLayout(db: StudioDatabase, studioId: string, projectId: string, groupIds: ReadonlySet<string>, entityType: CanvasLayoutEntityType, entityId: string): void {
  if (entityType === 'group') {
    if (!groupIds.has(entityId)) throw new InvalidCommandError('Canvas link group endpoint must reference a group in this layout.');
    return;
  }
  assertEntityBelongsToProject(db, studioId, projectId, entityType, entityId);
}

function normalizeLink(db: StudioDatabase, studioId: string, projectId: string, groupIds: ReadonlySet<string>, value: unknown): CanvasLinkLayoutInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidCommandError('画布软连线必须是对象。');
  const source = value as Record<string, unknown>;
  const sourceType = String(source.sourceType || '') as CanvasLayoutEntityType;
  const targetType = String(source.targetType || '') as CanvasLayoutEntityType;
  if (!ENTITY_TYPES[sourceType] || !ENTITY_TYPES[targetType]) throw new InvalidCommandError('Unsupported canvas link endpoint type.');
  const sourceId = requiredText(source.sourceId, 'Canvas link source id');
  const targetId = requiredText(source.targetId, 'Canvas link target id');
  if (sourceType === targetType && sourceId === targetId) throw new InvalidCommandError('画布软连线不能连接同一节点。');
  assertLinkEndpointBelongsToLayout(db, studioId, projectId, groupIds, sourceType, sourceId);
  assertLinkEndpointBelongsToLayout(db, studioId, projectId, groupIds, targetType, targetId);
  const linkType = String(source.linkType || 'custom') as CanvasLinkType;
  if (!LINK_TYPES[linkType]) throw new InvalidCommandError('Unsupported canvas link type.');
  return {
    id: typeof source.id === 'string' && source.id.trim() ? source.id.trim().slice(0, 160) : undefined,
    sourceType,
    sourceId,
    targetType,
    targetId,
    linkType,
    label: requiredText(source.label || LINK_LABELS[linkType], 'Canvas link label'),
    metadata: safeRecord(source.metadata)
  };
}

function layoutFromRow(row: LayoutRow, nodes: NodeRow[], groups: GroupRow[], links: LinkRow[]): CanvasLayout {
  return {
    id: row.id,
    studioId: row.studio_id,
    projectId: row.project_id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    viewport: normalizeViewport(parseRecord(row.viewport_json)),
    settings: parseRecord(row.settings_json),
    version: row.version,
    nodes: nodes.map((node) => ({ id: node.id, entityType: node.entity_type, entityId: node.entity_id, x: Number(node.x), y: Number(node.y), width: Number(node.width), height: Number(node.height), collapsed: node.collapsed === 1, groupId: node.group_id })),
    groups: groups.map((group) => ({ id: group.id, title: group.title, groupType: group.group_type, x: Number(group.x), y: Number(group.y), width: Number(group.width), height: Number(group.height), metadata: parseRecord(group.metadata_json) })),
    links: links.map((link) => ({ id: link.id, sourceType: link.source_type, sourceId: link.source_id, targetType: link.target_type, targetId: link.target_id, linkType: link.link_type, label: link.label, metadata: parseRecord(link.metadata_json) }))
  };
}

export function getCanvasLayout(db: StudioDatabase, input: CanvasLayoutInput): CanvasLayout {
  const projectId = requiredText(input.projectId, 'Project id');
  const scope = normalizeScope(db, { ...input, projectId });
  const row = db.prepare('SELECT id, studio_id, project_id, scope_type, scope_id, viewport_json, settings_json, version FROM canvas_layouts WHERE studio_id = ? AND project_id = ? AND scope_type = ? AND scope_id = ?').get(input.studioId, projectId, scope.scopeType, scope.scopeId) as LayoutRow | undefined;
  if (!row) return { id: null, studioId: input.studioId, projectId, scopeType: scope.scopeType, scopeId: scope.scopeId, viewport: DEFAULT_VIEWPORT, settings: {}, version: 0, nodes: [], groups: [], links: [] };
  const nodes = db.prepare('SELECT id, entity_type, entity_id, x, y, width, height, collapsed, group_id FROM canvas_node_layouts WHERE layout_id = ? ORDER BY id').all(row.id) as unknown as NodeRow[];
  const groups = db.prepare('SELECT id, title, group_type, x, y, width, height, metadata_json FROM canvas_groups WHERE layout_id = ? ORDER BY created_at, id').all(row.id) as unknown as GroupRow[];
  const links = db.prepare('SELECT id, source_type, source_id, target_type, target_id, link_type, label, metadata_json FROM canvas_links WHERE layout_id = ? ORDER BY created_at, id').all(row.id) as unknown as LinkRow[];
  return layoutFromRow(row, nodes, groups, links);
}

export function saveCanvasLayout(db: StudioDatabase, input: CanvasLayoutInput): CanvasLayout {
  const projectId = requiredText(input.projectId, 'Project id');
  const scope = normalizeScope(db, { ...input, projectId });
  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).slice(0, MAX_NODE_LAYOUTS + 1);
  const groups = (Array.isArray(input.groups) ? input.groups : []).slice(0, MAX_GROUP_LAYOUTS + 1);
  const links = (Array.isArray(input.links) ? input.links : []).slice(0, MAX_LINK_LAYOUTS + 1);
  if (nodes.length > MAX_NODE_LAYOUTS) throw new InvalidCommandError('画布节点布局不能超过 ' + MAX_NODE_LAYOUTS + ' 个。');
  if (groups.length > MAX_GROUP_LAYOUTS) throw new InvalidCommandError('画布分组不能超过 ' + MAX_GROUP_LAYOUTS + ' 个。');
  if (links.length > MAX_LINK_LAYOUTS) throw new InvalidCommandError('画布软连线不能超过 ' + MAX_LINK_LAYOUTS + ' 条。');
  const normalizedGroups = groups.map(normalizeGroup);
  const groupIds = new Set(normalizedGroups.map((group) => group.id));
  const normalizedNodes = nodes.map((node) => normalizeNode(db, input.studioId, projectId, node)).map((node) => node.groupId && !groupIds.has(node.groupId) ? { ...node, groupId: null } : node);
  const normalizedLinks = links.map((link) => normalizeLink(db, input.studioId, projectId, groupIds, link));
  const viewport = normalizeViewport(input.viewport);
  const settings = safeRecord(input.settings || {});
  const timestamp = nowIso();
  const layoutId = withTransaction(db, () => {
    const existing = db.prepare('SELECT id FROM canvas_layouts WHERE studio_id = ? AND project_id = ? AND scope_type = ? AND scope_id = ?').get(input.studioId, projectId, scope.scopeType, scope.scopeId) as { id: string } | undefined;
    const id = existing?.id || createId('canvaslayout');
    if (existing) db.prepare('UPDATE canvas_layouts SET viewport_json = ?, settings_json = ?, version = version + 1, updated_at = ? WHERE id = ?').run(JSON.stringify(viewport), JSON.stringify(settings), timestamp, id);
    else db.prepare('INSERT INTO canvas_layouts (id, studio_id, project_id, scope_type, scope_id, viewport_json, settings_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)').run(id, input.studioId, projectId, scope.scopeType, scope.scopeId, JSON.stringify(viewport), JSON.stringify(settings), timestamp, timestamp);
    db.prepare('DELETE FROM canvas_links WHERE layout_id = ?').run(id);
    db.prepare('DELETE FROM canvas_node_layouts WHERE layout_id = ?').run(id);
    db.prepare('DELETE FROM canvas_groups WHERE layout_id = ?').run(id);
    const insertNode = db.prepare('INSERT INTO canvas_node_layouts (id, layout_id, entity_type, entity_id, x, y, width, height, collapsed, group_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const node of normalizedNodes) insertNode.run(createId('canvasnode'), id, node.entityType, node.entityId, node.x, node.y, node.width, node.height, node.collapsed ? 1 : 0, node.groupId || null, timestamp);
    const insertGroup = db.prepare('INSERT INTO canvas_groups (id, layout_id, title, group_type, x, y, width, height, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const group of normalizedGroups) insertGroup.run(group.id, id, group.title, group.groupType || 'custom', group.x, group.y, group.width, group.height, JSON.stringify(group.metadata || {}), timestamp, timestamp);
    const insertLink = db.prepare('INSERT INTO canvas_links (id, layout_id, source_type, source_id, target_type, target_id, link_type, label, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const link of normalizedLinks) insertLink.run(link.id || createId('canvaslink'), id, link.sourceType, link.sourceId, link.targetType, link.targetId, link.linkType || 'custom', link.label || LINK_LABELS[link.linkType || 'custom'], JSON.stringify(link.metadata || {}), timestamp, timestamp);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'canvas_layout', entityId: id, eventType: 'canvas.layout_updated', payload: { projectId, scopeType: scope.scopeType, scopeId: scope.scopeId, nodeCount: normalizedNodes.length, groupCount: normalizedGroups.length, linkCount: normalizedLinks.length } });
    return id;
  });
  const saved = getCanvasLayout(db, { studioId: input.studioId, projectId, scopeType: scope.scopeType, scopeId: scope.scopeId });
  return saved.id === layoutId ? saved : getCanvasLayout(db, { studioId: input.studioId, projectId, scopeType: scope.scopeType, scopeId: scope.scopeId });
}
