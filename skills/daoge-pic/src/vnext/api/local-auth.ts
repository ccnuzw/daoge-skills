import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { IncomingMessage } from 'node:http';

export type LocalAuthentication = 'bearer' | 'cookie';

export class LocalAccessError extends Error {
  constructor(readonly status: 401 | 403 | 415, readonly code: 'unauthorized' | 'forbidden' | 'unsupported_media_type', message: string) {
    super(message);
  }
}

export function createLocalCapability(): string {
  return randomBytes(32).toString('base64url');
}

export function constantTimeTokenEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function localSessionCookieName(studioId: string, capability: string): string {
  const suffix = createHash('sha256').update(studioId).update('\0').update(capability).digest('hex').slice(0, 20);
  return 'daoge_pic_session_' + suffix;
}

function headerValue(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function cookieValue(request: IncomingMessage, name: string): string {
  for (const part of headerValue(request, 'cookie').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return '';
}

export function authenticateLocalRequest(request: IncomingMessage, capability: string, cookieName: string, sessionToken: string): LocalAuthentication | null {
  const authorization = headerValue(request, 'authorization');
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization);
  if (match && constantTimeTokenEqual(match[1], capability)) return 'bearer';
  const cookie = cookieValue(request, cookieName);
  if (cookie && constantTimeTokenEqual(cookie, sessionToken)) return 'cookie';
  return null;
}

export function assertLocalHost(request: IncomingMessage, expectedAuthority: string): void {
  if (headerValue(request, 'host').toLowerCase() !== expectedAuthority.toLowerCase()) {
    throw new LocalAccessError(403, 'forbidden', '请求 Host 不属于当前本地 Studio。');
  }
}

export function assertLocalWriteOrigin(request: IncomingMessage, expectedOrigin: string, authentication: LocalAuthentication | null): void {
  const origin = headerValue(request, 'origin');
  if ((authentication === 'cookie' && origin !== expectedOrigin) || (origin && origin !== expectedOrigin)) {
    throw new LocalAccessError(403, 'forbidden', '写入请求必须来自当前本地 Studio。');
  }
}

export function assertJsonContentType(request: IncomingMessage): void {
  if (headerValue(request, 'content-type').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new LocalAccessError(415, 'unsupported_media_type', '该写入接口只接受 application/json。');
  }
}

export function imageUploadMediaType(request: IncomingMessage): string {
  const mediaType = headerValue(request, 'content-type').split(';', 1)[0].trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) {
    throw new LocalAccessError(415, 'unsupported_media_type', '导入接口只接受 PNG、JPEG、WebP 或 GIF 图片。');
  }
  return mediaType;
}

export function localSessionCookie(cookieName: string, sessionToken: string): string {
  return cookieName + '=' + sessionToken + '; Path=/; HttpOnly; SameSite=Strict';
}
