import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { createId } from '../shared/ids';
import { ensureCacheDirectory, StudioPaths } from '../studio/workspace';
import { MediaArchiveError, openVerifiedManagedFileAsync, VerifiedManagedFile } from './archive';

const THUMBNAIL_VERSION = 1;
const THUMBNAIL_EDGE = 512;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 64 * 1024 * 1024;
const pending = new Map<string, Promise<void>>();

export function resolveImageThumbnailPath(paths: StudioPaths, contentHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new MediaArchiveError('Thumbnail source identity is invalid.');
  return path.join(ensureCacheDirectory(paths, 'thumbs'), 'v' + THUMBNAIL_VERSION + '-' + contentHash + '.webp');
}

async function existingThumbnail(filePath: string): Promise<VerifiedManagedFile | null> {
  try {
    const identity = await fsp.lstat(filePath);
    if (!identity.isFile() || identity.isSymbolicLink()) throw new MediaArchiveError('Thumbnail cache entry must be a regular file.');
    return await openVerifiedManagedFileAsync(filePath, { mediaType: 'image/webp', minByteSize: 1, maxByteSize: MAX_THUMBNAIL_BYTES, requireImage: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof MediaArchiveError) {
      const identity = await fsp.lstat(filePath);
      if (identity.isSymbolicLink() || !identity.isFile()) throw error;
      await fsp.rm(filePath, { force: true });
      return null;
    }
    throw error;
  }
}

async function generateThumbnail(filePath: string, sourceFactory: () => Promise<VerifiedManagedFile>): Promise<void> {
  const source = await sourceFactory();
  const temporary = path.join(path.dirname(filePath), createId('thumb') + '.part');
  try {
    const transformer = sharp({ animated: false, failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, effort: 4 })
      .timeout({ seconds: 15 });
    const completed = transformer.toFile(temporary);
    const [, result] = await Promise.all([pipeline(source.createReadStream(), transformer), completed]);
    if (!result.size || result.size > MAX_THUMBNAIL_BYTES) throw new MediaArchiveError('Generated thumbnail exceeds its byte limit.');
    await fsp.chmod(temporary, 0o600);
    const verified = await openVerifiedManagedFileAsync(temporary, { mediaType: 'image/webp', minByteSize: 1, maxByteSize: MAX_THUMBNAIL_BYTES, requireImage: true });
    verified.close();
    await fsp.rename(temporary, filePath);
  } finally {
    source.close();
    await fsp.rm(temporary, { force: true });
  }
}

export async function openImageThumbnail(paths: StudioPaths, contentHash: string, sourceFactory: () => Promise<VerifiedManagedFile>): Promise<VerifiedManagedFile> {
  const filePath = resolveImageThumbnailPath(paths, contentHash);
  const cached = await existingThumbnail(filePath);
  if (cached) return cached;
  let operation = pending.get(filePath);
  if (!operation) {
    operation = generateThumbnail(filePath, sourceFactory).finally(() => pending.delete(filePath));
    pending.set(filePath, operation);
  }
  await operation;
  const generated = await existingThumbnail(filePath);
  if (!generated) throw new MediaArchiveError('Generated thumbnail is unavailable.');
  return generated;
}

export function thumbnailEtag(contentHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new MediaArchiveError('Thumbnail source identity is invalid.');
  return '"daoge-thumb-v' + THUMBNAIL_VERSION + '-' + contentHash + '"';
}
