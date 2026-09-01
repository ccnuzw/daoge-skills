import fs from 'node:fs';
import { createAssetSnapshot, getStudioAsset } from '../domain/assets';
import { InvalidCommandError, StudioNotFoundError } from '../domain/studio-commands';
import { ImageRequest } from '../providers/contracts';
import { StudioDatabase } from '../studio/database';
import { StudioPaths } from '../studio/workspace';
import { MediaArchiveError, VerifiedManagedFile } from './archive';

export interface ManagedAssetResolutionInput {
  studioId: string;
  referenceAssetIds?: unknown;
  maskAssetId?: unknown;
}

export interface ManagedAssetResolver {
  resolve(input: ManagedAssetResolutionInput): Pick<ImageRequest, 'referenceAssets' | 'maskAsset'>;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}

function readVerifiedBytes(opened: VerifiedManagedFile): Buffer {
  const bytes = Buffer.allocUnsafe(opened.byteSize);
  let offset = 0;
  while (offset < bytes.length) {
    const read = fs.readSync(opened.descriptor, bytes, offset, bytes.length - offset, offset);
    if (!read) throw new MediaArchiveError('Verified managed asset snapshot ended before its expected byte size.');
    offset += read;
  }
  return bytes;
}

export class StudioAssetResolver implements ManagedAssetResolver {
  private readonly db: StudioDatabase;
  private readonly paths: StudioPaths;

  constructor(options: { db: StudioDatabase; paths: StudioPaths }) { this.db = options.db; this.paths = options.paths; }

  resolve(input: ManagedAssetResolutionInput): Pick<ImageRequest, 'referenceAssets' | 'maskAsset'> {
    const referenceAssets = ids(input.referenceAssetIds).map((assetId) => this.readAsset(input.studioId, assetId));
    const maskId = typeof input.maskAssetId === 'string' && input.maskAssetId.trim() ? input.maskAssetId : null;
    const maskAsset = maskId ? this.readAsset(input.studioId, maskId) : undefined;
    if (maskAsset && maskAsset.mediaType !== 'image/png') throw new InvalidCommandError('遮罩必须是已导入或已生成的 PNG 资产。');
    return { referenceAssets, maskAsset };
  }

  private readAsset(studioId: string, assetId: string): { assetId: string; mediaType: string; bytes: Buffer } {
    const asset = getStudioAsset(this.db, studioId, assetId);
    if (!asset || asset.deletedAt) throw new StudioNotFoundError('Active managed asset not found: ' + assetId);
    const opened = createAssetSnapshot(this.paths, asset);
    try {
      if (!opened.mediaType) throw new MediaArchiveError('Verified managed asset has no detected media type.');
      return { assetId: asset.id, mediaType: opened.mediaType, bytes: readVerifiedBytes(opened) };
    } finally {
      opened.close();
    }
  }
}
