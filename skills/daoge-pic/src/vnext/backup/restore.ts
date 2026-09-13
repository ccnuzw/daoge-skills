import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BackupManifestEntry, BackupManifestStudioIdentityInput, BackupManifestValidation, validateBackupManifest } from './manifest';

export type RestoreOperation = {
  path: string;
  category: BackupManifestEntry['category'];
  required: boolean;
  action: 'unchanged' | 'create' | 'replace';
  byteSize: number;
  sha256: string;
  parentDirectoriesMissing: number;
};

export type RestoreDryRunIssueCode =
  | 'source_workspace'
  | 'target_workspace'
  | 'source_manifest'
  | 'target_symbolic_link'
  | 'target_not_file'
  | 'target_unreadable';

export type RestoreDryRunIssue = {
  code: RestoreDryRunIssueCode;
  severity: 'error' | 'warning';
  path?: string;
};

export type RestoreDryRunResult = {
  ready: boolean;
  sourceValid: boolean;
  targetValid: boolean;
  operations: RestoreOperation[];
  issues: RestoreDryRunIssue[];
};

export interface RestoreDryRunInput {
  /** A directory containing a manifest-shaped snapshot; it is never modified. */
  sourceRoot: string;
  /** The existing Studio workspace to which a future restore would be applied; it is never modified. */
  targetRoot: string;
  manifest: unknown;
  studio?: BackupManifestStudioIdentityInput;
  expectedStudio?: BackupManifestStudioIdentityInput;
}

interface FileSnapshot {
  byteSize: number;
  sha256: string;
}

type TargetInspection =
  | { kind: 'missing'; parentDirectoriesMissing: number }
  | { kind: 'file'; snapshot: FileSnapshot; parentDirectoriesMissing: number }
  | { kind: 'symbolic-link' }
  | { kind: 'not-file' }
  | { kind: 'unreadable' };

function safeRoot(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const resolved = path.resolve(value);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(resolved); } catch { return null; }
  return stat.isDirectory() && !stat.isSymbolicLink() ? resolved : null;
}

function safeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return null;
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return null;
  const segments = value.split('/');
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

function readRegularFile(root: string, relativePath: string): FileSnapshot | null {
  const target = path.join(root, ...relativePath.split('/'));
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let fd: number;
  try { fd = fs.openSync(target, fs.constants.O_RDONLY | noFollow); }
  catch { return null; }
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) return null;
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let byteSize = 0;
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
      byteSize += read;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) return null;
    return { byteSize, sha256: hash.digest('hex') };
  } finally { fs.closeSync(fd); }
}

function inspectTarget(root: string, relativePath: string): TargetInspection {
  let current = root;
  let missingParents = 0;
  const segments = relativePath.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat: fs.Stats | null = null;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { kind: 'unreadable' };
      if (index < segments.length - 1) { missingParents += 1; continue; }
      return { kind: 'missing', parentDirectoriesMissing: missingParents };
    }
    if (stat.isSymbolicLink()) return { kind: 'symbolic-link' };
    if (index < segments.length - 1) {
      if (!stat.isDirectory()) return { kind: 'not-file' };
      continue;
    }
    if (!stat.isFile()) return { kind: 'not-file' };
    const snapshot = readRegularFile(root, relativePath);
    if (!snapshot) return { kind: 'unreadable' };
    return { kind: 'file', snapshot, parentDirectoriesMissing: missingParents };
  }
  return { kind: 'unreadable' };
}

function isCategory(value: unknown): value is BackupManifestEntry['category'] {
  return value === 'database' || value === 'metadata' || value === 'media' || value === 'reference';
}

function manifestEntries(manifest: unknown): BackupManifestEntry[] {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest) || !('entries' in manifest) || !Array.isArray(manifest.entries)) return [];
  return manifest.entries.filter((entry): entry is BackupManifestEntry => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (!('path' in entry) || !('category' in entry) || !('required' in entry) || !('byteSize' in entry) || !('sha256' in entry)) return false;
    return safeRelativePath(entry.path) !== null
      && isCategory(entry.category)
      && typeof entry.required === 'boolean'
      && Number.isSafeInteger(entry.byteSize)
      && entry.byteSize >= 0
      && typeof entry.sha256 === 'string'
      && /^[a-f0-9]{64}$/.test(entry.sha256);
  });
}

function sourceIssueForPath(result: BackupManifestValidation, relativePath: string): boolean {
  return result.mismatches.some((issue) => issue.path === relativePath && (issue.severity === 'error' || issue.code === 'missing'));
}

function issueFromTarget(relativePath: string, inspection: TargetInspection): RestoreDryRunIssue | null {
  if (inspection.kind === 'symbolic-link') return { code: 'target_symbolic_link', severity: 'error', path: relativePath };
  if (inspection.kind === 'not-file') return { code: 'target_not_file', severity: 'error', path: relativePath };
  if (inspection.kind === 'unreadable') return { code: 'target_unreadable', severity: 'error', path: relativePath };
  return null;
}

/**
 * Computes a no-write restore plan from an immutable source directory.
 * Source hashes must match the supplied manifest. Existing target files are
 * compared by size and SHA-256; symlinks and non-regular targets fail closed.
 */
export function createRestoreDryRun(input: RestoreDryRunInput): RestoreDryRunResult {
  const issues: RestoreDryRunIssue[] = [];
  const sourceRoot = safeRoot(input.sourceRoot);
  const targetRoot = safeRoot(input.targetRoot);
  if (!sourceRoot) issues.push({ code: 'source_workspace', severity: 'error' });
  if (!targetRoot) issues.push({ code: 'target_workspace', severity: 'error' });

  let sourceValidation: BackupManifestValidation = { valid: false, mismatches: [] };
  if (sourceRoot) sourceValidation = validateBackupManifest({ workspaceRoot: sourceRoot, manifest: input.manifest, studio: input.studio || input.expectedStudio });
  if (sourceRoot && !sourceValidation.valid && sourceValidation.mismatches.length === 0) issues.push({ code: 'source_manifest', severity: 'error' });
  if (sourceValidation.mismatches.some((issue) => issue.severity === 'error' && !issue.path)) issues.push({ code: 'source_manifest', severity: 'error' });

  const operations: RestoreOperation[] = [];
  if (sourceRoot && targetRoot && sourceValidation.valid) {
    for (const entry of manifestEntries(input.manifest)) {
      const relativePath = safeRelativePath(entry.path);
      if (!relativePath || sourceIssueForPath(sourceValidation, relativePath)) continue;
      const inspection = inspectTarget(targetRoot, relativePath);
      if (inspection.kind === 'symbolic-link') {
        issues.push({ code: 'target_symbolic_link', severity: 'error', path: relativePath });
        continue;
      }
      if (inspection.kind === 'not-file') {
        issues.push({ code: 'target_not_file', severity: 'error', path: relativePath });
        continue;
      }
      if (inspection.kind === 'unreadable') {
        issues.push({ code: 'target_unreadable', severity: 'error', path: relativePath });
        continue;
      }
      const action = inspection.kind === 'missing'
        ? 'create'
        : inspection.snapshot.sha256 === entry.sha256 && inspection.snapshot.byteSize === entry.byteSize ? 'unchanged' : 'replace';
      operations.push({ path: relativePath, category: entry.category, required: entry.required, action, byteSize: entry.byteSize, sha256: entry.sha256, parentDirectoriesMissing: inspection.parentDirectoriesMissing });
    }
  }

  const sourceIssues = sourceValidation.mismatches
    .filter((issue) => issue.severity === 'error' || issue.code === 'missing')
    .map((issue): RestoreDryRunIssue => ({ code: 'source_manifest', severity: issue.severity, ...(issue.path ? { path: issue.path } : {}) }));
  const allIssues = [...issues, ...sourceIssues];
  return {
    ready: sourceValidation.valid && Boolean(sourceRoot) && Boolean(targetRoot) && allIssues.every((issue) => issue.severity !== 'error'),
    sourceValid: sourceValidation.valid,
    targetValid: Boolean(targetRoot) && !issues.some((issue) => issue.code.startsWith('target_') && issue.severity === 'error'),
    operations,
    issues: allIssues
  };
}

export const restoreBackupDryRun = createRestoreDryRun;
export const planBackupRestore = createRestoreDryRun;
