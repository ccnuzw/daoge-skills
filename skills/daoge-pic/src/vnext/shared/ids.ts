import { createHash, randomUUID } from 'node:crypto';

export function createId(prefix: string): string {
  return prefix + '_' + randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}
