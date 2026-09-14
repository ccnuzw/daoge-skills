import fs from 'node:fs';
import { applyBackupRestore } from '../backup/restore';
import type { BackupManifestStudioIdentityInput } from '../backup/manifest';

interface RestoreHelperInput {
  sourceRoot?: unknown;
  targetRoot?: unknown;
  manifest?: unknown;
  expectedStudio?: unknown;
}

function expectedStudio(value: unknown): BackupManifestStudioIdentityInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('restore expected Studio identity is required.');
  const identity = value as Record<string, unknown>;
  if (typeof identity.studioId !== 'string' || !identity.studioId || typeof identity.runtimeVersion !== 'string' || !identity.runtimeVersion) {
    throw new Error('restore expected Studio identity is invalid.');
  }
  return identity as unknown as BackupManifestStudioIdentityInput;
}

function readInput(): RestoreHelperInput {
  const raw = fs.readFileSync(0, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > 8 * 1024 * 1024) throw new Error('restore input exceeds 8 MiB.');
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('restore input must be a JSON object.');
  return value as RestoreHelperInput;
}

export function main(): void {
  const input = readInput();
  const targetRoot = String(input.targetRoot || '');
  const result = applyBackupRestore({
    sourceRoot: String(input.sourceRoot || ''),
    targetRoot,
    manifest: input.manifest,
    expectedStudio: expectedStudio(input.expectedStudio)
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.applied) process.exitCode = 1;
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : 'Offline restore failed.') + '\n'); process.exitCode = 1; }
}
