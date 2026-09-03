import { getStudioAsset, StudioAsset } from '../domain/assets';
import { inspectProjectAssetAccess, ProjectAssetAccess, projectAssetReferenceAllowed } from '../domain/asset-access';
import { InvalidCommandError, StudioNotFoundError } from '../domain/studio-commands';
import { ImageRequest, MAX_IMAGE_REQUEST_CACHED_MEDIA_BYTES, MAX_IMAGE_REQUEST_MEDIA_BYTES, MAX_IMAGE_REQUEST_REFERENCE_ASSETS } from '../providers/contracts';
import { StudioDatabase } from '../studio/database';
import { ensureCacheDirectory, StudioPaths } from '../studio/workspace';
import { createVerifiedSnapshotAsync, MediaArchiveError, resolveManagedMediaPath, VerifiedManagedFile } from './archive';

export interface ManagedAssetResolutionInput {
  studioId: string;
  projectId: string;
  referenceAssetIds?: unknown;
  maskAssetId?: unknown;
}

export interface ManagedAssetResolver {
  resolve(input: ManagedAssetResolutionInput): Promise<ResolvedManagedAssets>;
}

export interface ResolvedManagedAssets {
  assets: Pick<ImageRequest, 'referenceAssets' | 'maskAsset'>;
  release(): void;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}

async function readVerifiedBytes(opened: VerifiedManagedFile): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(opened.byteSize);
  let offset = 0;
  for await (const value of opened.createReadStream()) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (offset + chunk.length > bytes.length) throw new MediaArchiveError('Verified managed asset snapshot exceeded its expected byte size.');
    chunk.copy(bytes, offset);
    offset += chunk.length;
  }
  if (offset !== bytes.length) throw new MediaArchiveError('Verified managed asset snapshot ended before its expected byte size.');
  return bytes;
}

type ResolvedAsset = { assetId: string; mediaType: string; bytes: Buffer };
type CachedAsset = { promise: Promise<ResolvedAsset>; byteSize: number; leases: number };

function rootForAsset(asset: StudioAsset): 'imports' | 'generated' | 'exports' {
  return asset.kind === 'import' ? 'imports' : asset.kind === 'generated' ? 'generated' : 'exports';
}

export class StudioAssetResolver implements ManagedAssetResolver {
  private readonly db: StudioDatabase;
  private readonly paths: StudioPaths;
  private readonly cache = new Map<string, CachedAsset>();
  private cachedBytes = 0;

  constructor(options: { db: StudioDatabase; paths: StudioPaths }) { this.db = options.db; this.paths = options.paths; }

  async resolve(input: ManagedAssetResolutionInput): Promise<ResolvedManagedAssets> {
    const projectId = String(input.projectId || '').trim();
    if (!projectId) throw new InvalidCommandError('项目 ID 是解析参考素材所必需的。');
    const referenceIds = ids(input.referenceAssetIds);
    if (referenceIds.length > MAX_IMAGE_REQUEST_REFERENCE_ASSETS) throw new InvalidCommandError('参考素材最多支持 ' + MAX_IMAGE_REQUEST_REFERENCE_ASSETS + ' 张。');
    const maskId = typeof input.maskAssetId === 'string' && input.maskAssetId.trim() ? input.maskAssetId : null;
    const access = inspectProjectAssetAccess(this.db, { studioId: input.studioId, projectId, assetIds: [...referenceIds, ...(maskId ? [maskId] : [])] });
    const referenceRecords = referenceIds.map((assetId) => this.getActiveAsset(input.studioId, assetId, access.get(assetId)));
    const maskRecord = maskId ? this.getActiveAsset(input.studioId, maskId, access.get(maskId)) : undefined;
    if (maskRecord && maskRecord.mediaType !== 'image/png') throw new InvalidCommandError('遮罩必须是已导入或已生成的 PNG 资产。');
    const aggregateBytes = [...referenceRecords, ...(maskRecord ? [maskRecord] : [])].reduce((total, asset) => total + asset.byteSize, 0);
    if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > MAX_IMAGE_REQUEST_MEDIA_BYTES) throw new InvalidCommandError('参考素材和遮罩合计不能超过 ' + (MAX_IMAGE_REQUEST_MEDIA_BYTES / (1024 * 1024)) + ' MiB。');

    const leases: Array<{ asset: ResolvedAsset; release(): void }> = [];
    try {
      for (const asset of referenceRecords) leases.push(await this.acquire(input.studioId, asset));
      const maskLease = maskRecord ? await this.acquire(input.studioId, maskRecord) : undefined;
      if (maskLease) leases.push(maskLease);
      let released = false;
      return {
        assets: { referenceAssets: leases.slice(0, referenceRecords.length).map((lease) => lease.asset), maskAsset: maskLease?.asset },
        release: () => {
          if (released) return;
          released = true;
          for (const lease of leases) lease.release();
        }
      };
    } catch (error) {
      for (const lease of leases) lease.release();
      throw error;
    }
  }

  private getActiveAsset(studioId: string, assetId: string, access: ProjectAssetAccess | undefined): StudioAsset {
    const asset = getStudioAsset(this.db, studioId, assetId);
    if (!asset || asset.deletedAt) throw new StudioNotFoundError('Active managed asset not found: ' + assetId);
    if (!projectAssetReferenceAllowed(access)) throw new InvalidCommandError('参考素材必须属于当前项目或已明确共享到跨项目素材。');
    return asset;
  }

  private async acquire(studioId: string, asset: StudioAsset): Promise<{ asset: ResolvedAsset; release(): void }> {
    const key = studioId + ':' + asset.id;
    let cached = this.cache.get(key);
    if (!cached) {
      if (this.cachedBytes + asset.byteSize > MAX_IMAGE_REQUEST_CACHED_MEDIA_BYTES) throw new InvalidCommandError('当前 Worker 正在使用的参考素材过多，请等待现有生成完成。');
      const created: CachedAsset = { byteSize: asset.byteSize, leases: 0, promise: this.readAsset(asset) };
      cached = created;
      this.cachedBytes += created.byteSize;
      this.cache.set(key, created);
      void created.promise.catch(() => {
        if (this.cache.get(key) === created && created.leases === 0) this.releaseCached(key, created);
      });
    }
    cached.leases += 1;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      cached!.leases -= 1;
      if (cached!.leases === 0 && this.cache.get(key) === cached) this.releaseCached(key, cached!);
    };
    try {
      return { asset: await cached.promise, release };
    } catch (error) {
      release();
      throw error;
    }
  }

  private releaseCached(key: string, cached: CachedAsset): void {
    if (this.cache.get(key) !== cached) return;
    this.cache.delete(key);
    this.cachedBytes -= cached.byteSize;
  }

  private async readAsset(asset: StudioAsset): Promise<ResolvedAsset> {
    const sourcePath = resolveManagedMediaPath(this.paths, asset.storagePath, rootForAsset(asset));
    const opened = await createVerifiedSnapshotAsync(sourcePath, { mediaType: asset.mediaType, contentHash: asset.contentHash, byteSize: asset.byteSize, minByteSize: 1, maxByteSize: 100 * 1024 * 1024, requireImage: true }, { snapshotDirectory: ensureCacheDirectory(this.paths, 'staging') });
    try {
      if (!opened.mediaType) throw new MediaArchiveError('Verified managed asset has no detected media type.');
      return { assetId: asset.id, mediaType: opened.mediaType, bytes: await readVerifiedBytes(opened) };
    } finally {
      opened.close();
    }
  }
}
