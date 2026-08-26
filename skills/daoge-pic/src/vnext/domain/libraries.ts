import { createId, nowIso } from '../shared/ids';
import { StudioDatabase, appendStudioEvent, withTransaction } from '../studio/database';
import { executeIdempotent, InvalidCommandError, StudioNotFoundError } from './studio-commands';

export interface TaskType { id: string; name: string; source: 'official' | 'user'; definition: Record<string, unknown>; }
export interface CreativeKit { id: string; studioId: string; name: string; definition: Record<string, unknown>; assetIds: string[]; }

const OFFICIAL_TASK_TYPES: Array<{ id: string; name: string; definition: Record<string, unknown> }> = [
  { id: 'portrait-kv', name: '人物主视觉', definition: { summary: '头像、人物海报、品牌人物封面。', fields: ['subject', 'wardrobe', 'expression', 'setting', 'composition', 'identity_constraints'] } },
  { id: 'ecommerce-product', name: '电商商品图', definition: { summary: '商品主图、详情页和卖点视觉。', fields: ['product', 'platform', 'selling_points', 'background', 'angle', 'text_safe_area'] } },
  { id: 'brand-packaging', name: '品牌包装图', definition: { summary: '包装概念、瓶盒展示和品牌资产板。', fields: ['brand', 'package_type', 'materials', 'usage_scene', 'brand_constraints'] } },
  { id: 'cinematic-storyboard', name: '电影分镜', definition: { summary: '短片、剧情或广告镜头序列。', fields: ['story', 'shot_list', 'camera_language', 'continuity', 'aspect_ratio'] } },
  { id: 'campaign-poster', name: '品牌海报', definition: { summary: '新品 KV、横幅和竖版封面。', fields: ['campaign', 'headline_safe_area', 'hero_subject', 'cta_area', 'brand_constraints'] } },
  { id: 'ui-mockup-board', name: '界面视觉板', definition: { summary: '产品界面、卡片、设备场景和概念稿。', fields: ['product_flow', 'device', 'information_hierarchy', 'visual_system'] } },
  { id: 'academic-figure-board', name: '学术图板', definition: { summary: '机制图、论文概览和科研海报。', fields: ['topic', 'claims', 'diagram_structure', 'label_policy', 'evidence_constraints'] } },
  { id: 'type-layout-poster', name: '排版海报', definition: { summary: '双语排版、强标题区和编辑视觉。', fields: ['copy', 'language', 'hierarchy', 'safe_area', 'typography_constraints'] } }
];

function object(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function ensureStudio(db: StudioDatabase, studioId: string): void { if (!db.prepare('SELECT 1 FROM studios WHERE id = ?').get(studioId)) throw new StudioNotFoundError('Studio not found: ' + studioId); }
function requireText(value: string, label: string): string { const text = String(value || '').trim(); if (!text) throw new InvalidCommandError(label + ' is required.'); return text; }

export function seedOfficialTaskTypes(db: StudioDatabase): void {
  withTransaction(db, () => {
    const timestamp = nowIso();
    const statement = db.prepare('INSERT INTO task_types (id, name, definition_json, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, definition_json = excluded.definition_json, updated_at = excluded.updated_at');
    for (const type of OFFICIAL_TASK_TYPES) statement.run(type.id, type.name, JSON.stringify(type.definition), 'official', timestamp, timestamp);
  });
}

export function listTaskTypes(db: StudioDatabase): TaskType[] {
  seedOfficialTaskTypes(db);
  return (db.prepare('SELECT id, name, source, definition_json FROM task_types ORDER BY source, name').all() as Array<{ id: string; name: string; source: TaskType['source']; definition_json: string }>).map((row) => ({ id: row.id, name: row.name, source: row.source, definition: object(row.definition_json) }));
}

export function createUserTaskType(db: StudioDatabase, input: { name: string; definition: Record<string, unknown>; idempotencyKey: string }): TaskType {
  const receipt = executeIdempotent(db, input.idempotencyKey, 'task_types.create', () => {
    const id = createId('tasktype');
    const timestamp = nowIso();
    const name = requireText(input.name, 'Task type name');
    db.prepare('INSERT INTO task_types (id, name, definition_json, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, JSON.stringify(input.definition || {}), 'user', timestamp, timestamp);
    return { id, name, source: 'user' as const, definition: input.definition || {} };
  }, input);
  return receipt.value;
}

function listKitAssets(db: StudioDatabase, id: string): string[] { return (db.prepare("SELECT asset_id FROM asset_relations WHERE target_type IN ('style_kit', 'brand_kit') AND target_id = ? ORDER BY created_at").all(id) as Array<{ asset_id: string }>).map((row) => row.asset_id); }
function kitRow(row: { id: string; studio_id: string; name: string; definition_json: string }, db: StudioDatabase): CreativeKit { return { id: row.id, studioId: row.studio_id, name: row.name, definition: object(row.definition_json), assetIds: listKitAssets(db, row.id) }; }

function assertAssetIds(db: StudioDatabase, studioId: string, assetIds: string[]): void {
  for (const assetId of assetIds) {
    const asset = db.prepare('SELECT id FROM assets WHERE id = ? AND studio_id = ? AND deleted_at IS NULL').get(assetId, studioId) as { id: string } | undefined;
    if (!asset) throw new StudioNotFoundError('Active Studio asset not found: ' + assetId);
  }
}

function replaceKitAssets(db: StudioDatabase, kit: 'style_kit' | 'brand_kit', kitId: string, assetIds: string[]): void {
  db.prepare("DELETE FROM asset_relations WHERE target_type = ? AND target_id = ? AND relation_type = 'reference_for'").run(kit, kitId);
  const statement = db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const assetId of [...new Set(assetIds)]) statement.run(createId('assetrel'), assetId, 'reference_for', kit, kitId, '{}', nowIso());
}

function listKits(db: StudioDatabase, studioId: string, table: 'style_kits' | 'brand_kits'): CreativeKit[] {
  ensureStudio(db, studioId);
  return (db.prepare('SELECT id, studio_id, name, definition_json FROM ' + table + ' WHERE studio_id = ? ORDER BY updated_at DESC').all(studioId) as Array<{ id: string; studio_id: string; name: string; definition_json: string }>).map((row) => kitRow(row, db));
}

function createKit(db: StudioDatabase, input: { studioId: string; name: string; definition: Record<string, unknown>; assetIds?: string[]; idempotencyKey: string; table: 'style_kits' | 'brand_kits'; targetType: 'style_kit' | 'brand_kit' }): CreativeKit {
  const receipt = executeIdempotent(db, input.idempotencyKey, input.table + '.create', () => {
    ensureStudio(db, input.studioId);
    const name = requireText(input.name, 'Kit name');
    const assetIds = input.assetIds || [];
    assertAssetIds(db, input.studioId, assetIds);
    const id = createId(input.targetType === 'style_kit' ? 'style' : 'brand');
    const timestamp = nowIso();
    db.prepare('INSERT INTO ' + input.table + ' (id, studio_id, name, definition_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, input.studioId, name, JSON.stringify(input.definition || {}), timestamp, timestamp);
    replaceKitAssets(db, input.targetType, id, assetIds);
    appendStudioEvent(db, { studioId: input.studioId, entityType: input.targetType, entityId: id, eventType: input.targetType + '.created', payload: { name, assetCount: assetIds.length } });
    return { id, studioId: input.studioId, name, definition: input.definition || {}, assetIds };
  }, input);
  return receipt.value;
}

export function listStyleKits(db: StudioDatabase, studioId: string): CreativeKit[] { return listKits(db, studioId, 'style_kits'); }
export function listBrandKits(db: StudioDatabase, studioId: string): CreativeKit[] { return listKits(db, studioId, 'brand_kits'); }
export function createStyleKit(db: StudioDatabase, input: Omit<Parameters<typeof createKit>[1], 'table' | 'targetType'>): CreativeKit { return createKit(db, { ...input, table: 'style_kits', targetType: 'style_kit' }); }
export function createBrandKit(db: StudioDatabase, input: Omit<Parameters<typeof createKit>[1], 'table' | 'targetType'>): CreativeKit { return createKit(db, { ...input, table: 'brand_kits', targetType: 'brand_kit' }); }
