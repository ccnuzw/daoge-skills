import { StudioDatabase } from '../studio/database';
import { assetSearchContentSql } from '../studio/search-content';

/**
 * The image half of the search index (plan 7.8.1).
 *
 * Images are the main character of a Studio, yet `studio_search` held zero of
 * them — a user could not find "the night shot" at all. The index cannot be
 * maintained by a trigger on `assets`, because an image's describing text comes
 * from rows written around it (the producing run item, later reviews, later
 * deliveries). So the asset rows are refreshed by the code that knows when
 * those facts changed; a delete trigger keeps removals honest.
 */

export function assetSearchContent(db: StudioDatabase, studioId: string, assetId: string): string {
  const row = db.prepare('SELECT ' + assetSearchContentSql('asset') + ' AS content FROM assets asset WHERE asset.id = ? AND asset.studio_id = ?').get(assetId, studioId) as { content: string | null } | undefined;
  return String(row?.content || '').trim();
}

/** Recompute one image's index row. An image with nothing to say is not indexed. */
export function refreshAssetSearchIndex(db: StudioDatabase, input: { studioId: string; assetId: string }): void {
  db.prepare("DELETE FROM studio_search WHERE entity_type = 'asset' AND entity_id = ?").run(input.assetId);
  const content = assetSearchContent(db, input.studioId, input.assetId);
  if (!content) return;
  db.prepare("INSERT INTO studio_search (studio_id, entity_type, entity_id, content) VALUES (?, 'asset', ?, ?)").run(input.studioId, input.assetId, content);
}

export function refreshAssetSearchIndexes(db: StudioDatabase, input: { studioId: string; assetIds: readonly string[] }): void {
  for (const assetId of new Set(input.assetIds.filter(Boolean))) refreshAssetSearchIndex(db, { studioId: input.studioId, assetId });
}

export function removeAssetSearchIndex(db: StudioDatabase, assetId: string): void {
  db.prepare("DELETE FROM studio_search WHERE entity_type = 'asset' AND entity_id = ?").run(assetId);
}
