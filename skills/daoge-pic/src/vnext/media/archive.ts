import fs from 'node:fs';
import path from 'node:path';
import { createId, sha256 } from '../shared/ids';
import { AssetBucket, ensureAssetBucket, ensureCacheDirectory, StudioPaths } from '../studio/workspace';

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

export interface StagedImage {
  stagingPath: string;
  mediaType: string;
  contentHash: string;
  byteSize: number;
}

export interface ArchivedImage {
  absolutePath: string;
  storagePath: string;
  mediaType: string;
  contentHash: string;
  byteSize: number;
}

export class MediaValidationError extends Error {}
export class MediaArchiveError extends Error {}

function detectedMediaType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  return null;
}

function assertSafeAssetId(assetId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(assetId)) throw new MediaArchiveError('Asset id may contain only letters, numbers, underscores, and hyphens.');
  return assetId;
}

function safeStoragePath(paths: StudioPaths, filePath: string): string {
  const relative = path.relative(paths.workspaceRoot, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new MediaArchiveError('Archived media must remain inside the Studio workspace.');
  }
  return relative.split(path.sep).join('/');
}

export function validateImageBytes(bytes: Buffer, declaredMediaType?: string): { mediaType: string; contentHash: string; byteSize: number } {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new MediaValidationError('Image data is required.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new MediaValidationError('Image exceeds the 100 MB Studio limit.');
  const mediaType = detectedMediaType(bytes);
  if (!mediaType) throw new MediaValidationError('Only PNG, JPEG, WebP, and GIF images can be imported.');
  if (declaredMediaType && declaredMediaType !== mediaType) {
    throw new MediaValidationError('Declared image type does not match file content.');
  }
  return { mediaType, contentHash: sha256(bytes), byteSize: bytes.length };
}

export function stageImage(paths: StudioPaths, bytes: Buffer, declaredMediaType?: string): StagedImage {
  const validated = validateImageBytes(bytes, declaredMediaType);
  const stagingDir = ensureCacheDirectory(paths, 'staging');
  const stagingPath = path.join(stagingDir, createId('media') + '.part');
  fs.writeFileSync(stagingPath, bytes, { flag: 'wx' });
  return { stagingPath, ...validated };
}

export function plannedArchivePath(paths: StudioPaths, input: { assetId: string; bucket: AssetBucket; mediaType: string }): { absolutePath: string; storagePath: string } {
  const assetId = assertSafeAssetId(input.assetId);
  const extension = MIME_EXTENSIONS[input.mediaType];
  if (!extension) throw new MediaArchiveError('Unsupported archived media type.');
  const absolutePath = path.join(ensureAssetBucket(paths, input.bucket), assetId + '.' + extension);
  return { absolutePath, storagePath: safeStoragePath(paths, absolutePath) };
}

export function archiveStagedImage(paths: StudioPaths, staged: StagedImage, input: { assetId: string; bucket: AssetBucket }): ArchivedImage {
  const assetId = assertSafeAssetId(input.assetId);
  if (!fs.existsSync(staged.stagingPath)) throw new MediaArchiveError('Staged image is missing.');
  const bytes = fs.readFileSync(staged.stagingPath);
  const validated = validateImageBytes(bytes, staged.mediaType);
  if (validated.contentHash !== staged.contentHash || validated.byteSize !== staged.byteSize) {
    throw new MediaArchiveError('Staged image changed after validation.');
  }
  const destination = plannedArchivePath(paths, { assetId, bucket: input.bucket, mediaType: validated.mediaType }).absolutePath;
  if (fs.existsSync(destination)) throw new MediaArchiveError('An asset already exists at the target path.');
  try {
    fs.renameSync(staged.stagingPath, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') throw new MediaArchiveError('Studio staging and asset storage must be on the same filesystem for atomic media writes.');
    throw error;
  }
  return {
    absolutePath: destination,
    storagePath: safeStoragePath(paths, destination),
    mediaType: validated.mediaType,
    contentHash: validated.contentHash,
    byteSize: validated.byteSize
  };
}

export function discardStagedImage(staged: StagedImage): void {
  fs.rmSync(staged.stagingPath, { force: true });
}
