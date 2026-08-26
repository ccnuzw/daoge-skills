import fs from 'node:fs';
import { assetFilePath, getStudioAsset } from '../domain/assets';
import { InvalidCommandError, StudioNotFoundError } from '../domain/studio-commands';
import { ImageRequest } from '../providers/contracts';
import { StudioDatabase } from '../studio/database';
import { StudioPaths } from '../studio/workspace';

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
    const filePath = assetFilePath(this.paths, asset);
    if (!fs.existsSync(filePath)) throw new StudioNotFoundError('Managed asset media is missing: ' + assetId);
    const bytes = fs.readFileSync(filePath);
    if (!bytes.length) throw new InvalidCommandError('Managed asset is empty: ' + assetId);
    return { assetId: asset.id, mediaType: asset.mediaType, bytes };
  }
}
