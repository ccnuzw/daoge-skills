import { StudioDatabase } from '../studio/database';

export interface StudioEvent {
  id: number;
  entityType: string;
  entityId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface StoredEvent {
  id: number;
  entity_type: string;
  entity_id: string;
  event_type: string;
  payload_json: string;
  created_at: string;
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export interface StudioEventWindow {
  events: StudioEvent[];
  snapshotRequired: boolean;
}

export function listStudioEventsAfter(db: StudioDatabase, studioId: string, after = 0, limit = 200): StudioEvent[] {
  const normalizedAfter = Number.isInteger(after) && after >= 0 ? after : 0;
  const normalizedLimit = Math.min(500, Math.max(1, Number.isInteger(limit) ? limit : 200));
  const rows = db.prepare('SELECT id, entity_type, entity_id, event_type, payload_json, created_at FROM events WHERE studio_id = ? AND id > ? ORDER BY id LIMIT ?').all(studioId, normalizedAfter, normalizedLimit) as unknown as StoredEvent[];
  return rows.map((row) => ({ id: row.id, entityType: row.entity_type, entityId: row.entity_id, eventType: row.event_type, payload: parsePayload(row.payload_json), createdAt: row.created_at }));
}

export function studioEventWindow(db: StudioDatabase, studioId: string, after = 0, limit = 200): StudioEventWindow {
  const normalizedAfter = Number.isInteger(after) && after >= 0 ? after : 0;
  const earliest = db.prepare('SELECT MIN(id) AS id FROM events WHERE studio_id = ?').get(studioId) as { id: number | null };
  const snapshotRequired = normalizedAfter > 0 && earliest.id !== null && normalizedAfter < earliest.id - 1;
  return { events: snapshotRequired ? [] : listStudioEventsAfter(db, studioId, normalizedAfter, limit), snapshotRequired };
}
