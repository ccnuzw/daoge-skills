import path from 'node:path';
import type { GeneratedAssetPersister, PersistedImageResult } from '../runner/worker';
import { StudioDatabase, withTransaction } from '../studio/database';
import { StudioPaths } from '../studio/workspace';
import { createId } from '../shared/ids';
import { restoreAsset } from '../domain/assets';
import { archiveStagedImageAsync, discardStagedImage, plannedArchivePath, stageImageBytesAsync } from './archive';

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
  deleted_at: string | null;
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
    const staged = await stageImageBytesAsync(this.paths, input.result.bytes, input.result.mediaType);
    const matches = this.db.prepare('SELECT id, media_type, byte_size, content_hash, deleted_at FROM assets WHERE studio_id = ? AND content_hash = ? ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END, created_at').all(this.studioId, staged.contentHash) as unknown as StoredAsset[];
    const active = matches.find((asset) => !asset.deleted_at);
    if (active) {
      discardStagedImage(staged);
      withTransaction(this.db, () => {
        this.linkOutput(active.id, input.runId, input.itemId);
      });
      return { assetId: active.id, mediaType: active.media_type, byteSize: active.byte_size, contentHash: active.content_hash };
    }
    const deleted = matches[0];
    if (deleted) {
      discardStagedImage(staged);
      const restored = restoreAsset(this.db, this.paths, { studioId: this.studioId, assetId: deleted.id });
      withTransaction(this.db, () => {
        this.linkOutput(restored.id, input.runId, input.itemId);
      });
      return { assetId: restored.id, mediaType: restored.mediaType, byteSize: restored.byteSize, contentHash: restored.contentHash };
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
    const archived = await archiveStagedImageAsync(this.paths, staged, { assetId, bucket: 'generated' });
    withTransaction(this.db, () => {
      this.db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(assetId, this.studioId, 'generated', archived.mediaType, archived.storagePath, archived.contentHash, archived.byteSize, JSON.stringify(source), timestamp, timestamp);
      this.linkOutput(assetId, input.runId, input.itemId);
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
