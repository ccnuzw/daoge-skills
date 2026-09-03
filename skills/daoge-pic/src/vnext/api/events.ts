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
  snapshotCursor: number;
}

const DEFAULT_EVENT_BATCH_SIZE = 100;
const MAX_EVENT_BATCH_SIZE = 100;

export function listStudioEventsAfter(db: StudioDatabase, studioId: string, after = 0, limit = DEFAULT_EVENT_BATCH_SIZE): StudioEvent[] {
  const normalizedAfter = Number.isInteger(after) && after >= 0 ? after : 0;
  const normalizedLimit = Math.min(MAX_EVENT_BATCH_SIZE, Math.max(1, Number.isInteger(limit) ? limit : DEFAULT_EVENT_BATCH_SIZE));
  const rows = db.prepare('SELECT id, entity_type, entity_id, event_type, payload_json, created_at FROM events WHERE studio_id = ? AND id > ? ORDER BY id LIMIT ?').all(studioId, normalizedAfter, normalizedLimit) as unknown as StoredEvent[];
  return rows.map((row) => ({ id: row.id, entityType: row.entity_type, entityId: row.entity_id, eventType: row.event_type, payload: parsePayload(row.payload_json), createdAt: row.created_at }));
}

export function studioEventWindow(db: StudioDatabase, studioId: string, after = 0, limit = DEFAULT_EVENT_BATCH_SIZE): StudioEventWindow {
  const normalizedAfter = Number.isInteger(after) && after >= 0 ? after : 0;
  const normalizedLimit = Math.min(MAX_EVENT_BATCH_SIZE, Math.max(1, Number.isInteger(limit) ? limit : DEFAULT_EVENT_BATCH_SIZE));
  const rows = db.prepare('WITH bounds AS (SELECT earliest_id, latest_id FROM studio_event_windows WHERE studio_id = ? UNION ALL SELECT NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM studio_event_windows WHERE studio_id = ?)), event_rows AS (SELECT id, entity_type, entity_id, event_type, payload_json, created_at FROM events WHERE studio_id = ? AND id > ? ORDER BY id LIMIT ?) SELECT id, entity_type, entity_id, event_type, payload_json, created_at, earliest_id, latest_id, 1 AS is_event FROM event_rows CROSS JOIN bounds UNION ALL SELECT NULL, NULL, NULL, NULL, NULL, NULL, earliest_id, latest_id, 0 FROM bounds').all(studioId, studioId, studioId, normalizedAfter, normalizedLimit) as unknown as Array<StoredEvent & { earliest_id: number | null; latest_id: number | null; is_event: number }>;
  const metadata = rows[0] || { earliest_id: null, latest_id: null };
  const snapshotRequired = normalizedAfter > 0 && (metadata.latest_id === null || normalizedAfter > metadata.latest_id || (metadata.earliest_id !== null && normalizedAfter < metadata.earliest_id - 1));
  return {
    events: snapshotRequired ? [] : rows.filter((row) => row.is_event === 1).map((row) => ({ id: row.id, entityType: row.entity_type, entityId: row.entity_id, eventType: row.event_type, payload: parsePayload(row.payload_json), createdAt: row.created_at })),
    snapshotRequired,
    snapshotCursor: Number(metadata.latest_id || 0)
  };
}
