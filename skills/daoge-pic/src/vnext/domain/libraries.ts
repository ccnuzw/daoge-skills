import { createId, nowIso } from '../shared/ids';
import { StudioDatabase, appendStudioEvent, withTransaction } from '../studio/database';
import { executeIdempotent, InvalidCommandError, StudioNotFoundError } from './studio-commands';

export interface TaskType { id: string; studioId: string | null; name: string; source: 'official' | 'user'; definition: Record<string, unknown>; }
export interface CreativeKit { id: string; studioId: string; name: string; definition: Record<string, unknown>; assetIds: string[]; }

function object(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function ensureStudio(db: StudioDatabase, studioId: string): void { if (!db.prepare('SELECT 1 FROM studios WHERE id = ?').get(studioId)) throw new StudioNotFoundError('Studio not found: ' + studioId); }
function requireText(value: string, label: string): string { const text = String(value || '').trim(); if (!text) throw new InvalidCommandError(label + ' is required.'); return text; }

export function listTaskTypes(db: StudioDatabase, studioId: string): TaskType[] {
  ensureStudio(db, studioId);
  return (db.prepare("SELECT id, studio_id, name, source, definition_json FROM task_types WHERE source = 'official' OR (source = 'user' AND studio_id = ?) ORDER BY source, name").all(studioId) as Array<{ id: string; studio_id: string | null; name: string; source: TaskType['source']; definition_json: string }>).map((row) => ({ id: row.id, studioId: row.studio_id, name: row.name, source: row.source, definition: object(row.definition_json) }));
}

export function createUserTaskType(db: StudioDatabase, input: { studioId: string; name: string; definition: Record<string, unknown>; idempotencyKey: string }): TaskType {
  const receipt = executeIdempotent(db, input.studioId, input.idempotencyKey, 'task_types.create', () => {
    ensureStudio(db, input.studioId);
    const id = createId('tasktype');
    const timestamp = nowIso();
    const name = requireText(input.name, 'Task type name');
    if (db.prepare("SELECT 1 FROM task_types WHERE studio_id = ? AND source = 'user' AND name = ?").get(input.studioId, name)) throw new InvalidCommandError('A user task type with this name already exists in this Studio.');
    db.prepare('INSERT INTO task_types (id, studio_id, name, definition_json, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, input.studioId, name, JSON.stringify(input.definition || {}), 'user', timestamp, timestamp);
    return { id, studioId: input.studioId, name, source: 'user' as const, definition: input.definition || {} };
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
  const rows = db.prepare('SELECT id, studio_id, name, definition_json FROM ' + table + ' WHERE studio_id = ? ORDER BY updated_at DESC').all(studioId) as Array<{ id: string; studio_id: string; name: string; definition_json: string }>;
  if (!rows.length) return [];
  const targetType = table === 'style_kits' ? 'style_kit' : 'brand_kit';
  const relations = db.prepare("SELECT target_id, asset_id FROM asset_relations WHERE target_type = ? AND relation_type = 'reference_for' AND target_id IN (" + rows.map(() => '?').join(',') + ') ORDER BY target_id, created_at').all(targetType, ...rows.map((row) => row.id)) as Array<{ target_id: string; asset_id: string }>;
  const assetsByKit = new Map<string, string[]>();
  for (const relation of relations) { const assets = assetsByKit.get(relation.target_id) || []; assets.push(relation.asset_id); assetsByKit.set(relation.target_id, assets); }
  return rows.map((row) => ({ id: row.id, studioId: row.studio_id, name: row.name, definition: object(row.definition_json), assetIds: assetsByKit.get(row.id) || [] }));
}

function createKit(db: StudioDatabase, input: { studioId: string; name: string; definition: Record<string, unknown>; assetIds?: string[]; idempotencyKey: string; table: 'style_kits' | 'brand_kits'; targetType: 'style_kit' | 'brand_kit' }): CreativeKit {
  const receipt = executeIdempotent(db, input.studioId, input.idempotencyKey, input.table + '.create', () => {
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
