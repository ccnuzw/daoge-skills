import path from 'node:path';
import type { GeneratedAssetPersister, PersistedImageResult } from '../runner/worker';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { StudioPaths } from '../studio/workspace';
import { createId } from '../shared/ids';
import { archiveStagedImage, discardStagedImage, plannedArchivePath, stageImage } from './archive';

export interface StudioGeneratedAssetPersisterOptions {
  db: StudioDatabase;
  paths: StudioPaths;
  studioId: string;
}

interface StoredAsset {
  id: string;
  media_type: string;
  byte_size: number;
  content_hash: string;
}

export class StudioGeneratedAssetPersister implements GeneratedAssetPersister {
  private readonly db: StudioDatabase;
  private readonly paths: StudioPaths;
  private readonly studioId: string;

  constructor(options: StudioGeneratedAssetPersisterOptions) {
    this.db = options.db;
    this.paths = options.paths;
    this.studioId = options.studioId;
  }

  async persistGeneratedImage(input: { runId: string; itemId: string; result: { bytes: Buffer; mediaType: string; externalRequestId?: string; revisedPrompt?: string; safeMeta?: Record<string, unknown> } }): Promise<PersistedImageResult> {
    const staged = stageImage(this.paths, input.result.bytes, input.result.mediaType);
    const existing = this.db.prepare('SELECT id, media_type, byte_size, content_hash FROM assets WHERE studio_id = ? AND content_hash = ? AND deleted_at IS NULL').get(this.studioId, staged.contentHash) as StoredAsset | undefined;
    if (existing) {
      discardStagedImage(staged);
      withTransaction(this.db, () => {
        this.linkOutput(existing.id, input.runId, input.itemId);
        appendStudioEvent(this.db, { studioId: this.studioId, entityType: 'asset', entityId: existing.id, eventType: 'asset.reused', payload: { runId: input.runId, runItemId: input.itemId } });
      });
      return { assetId: existing.id, mediaType: existing.media_type, byteSize: existing.byte_size, contentHash: existing.content_hash };
    }

    const assetId = createId('asset');
    const planned = plannedArchivePath(this.paths, { assetId, bucket: 'generated', mediaType: staged.mediaType });
    const source = {
      runId: input.runId,
      runItemId: input.itemId,
      externalRequestId: input.result.externalRequestId || null,
      revisedPrompt: input.result.revisedPrompt || null,
      safeMeta: input.result.safeMeta || {}
    };
    const timestamp = new Date().toISOString();
    const stagedPath = path.relative(this.paths.workspaceRoot, staged.stagingPath).split(path.sep).join('/');
    withTransaction(this.db, () => {
      this.db.prepare('INSERT INTO media_commit_journal (asset_id, studio_id, staged_path, final_storage_path, media_type, content_hash, byte_size, source_json, run_id, run_item_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(assetId, this.studioId, stagedPath, planned.storagePath, staged.mediaType, staged.contentHash, staged.byteSize, JSON.stringify(source), input.runId, input.itemId, timestamp);
    });
    let archived: ReturnType<typeof archiveStagedImage>;
    try { archived = archiveStagedImage(this.paths, staged, { assetId, bucket: 'generated' }); }
    catch (error) { throw error; }
    withTransaction(this.db, () => {
      this.db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(assetId, this.studioId, 'generated', archived.mediaType, archived.storagePath, archived.contentHash, archived.byteSize, JSON.stringify(source), timestamp, timestamp);
      this.linkOutput(assetId, input.runId, input.itemId);
      appendStudioEvent(this.db, { studioId: this.studioId, entityType: 'asset', entityId: assetId, eventType: 'asset.generated', payload: { runId: input.runId, runItemId: input.itemId, mediaType: archived.mediaType, byteSize: archived.byteSize } });
      this.db.prepare('DELETE FROM media_commit_journal WHERE asset_id = ?').run(assetId);
    });
    return { assetId, mediaType: archived.mediaType, byteSize: archived.byteSize, contentHash: archived.contentHash };
  }

  private linkOutput(assetId: string, runId: string, itemId: string): void {
    const timestamp = new Date().toISOString();
    this.db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(asset_id, relation_type, target_type, target_id) DO NOTHING').run(
      createId('assetrel'),
      assetId,
      'output_of',
      'run_item',
      itemId,
      JSON.stringify({ runId }),
      timestamp
    );
  }
}
