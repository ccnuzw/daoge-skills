import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** The on-disk shape of a backup manifest is intentionally independent of the Studio manifest. */
export const BACKUP_MANIFEST_SCHEMA_VERSION = 1;
export const BACKUP_MANIFEST_VERSION = BACKUP_MANIFEST_SCHEMA_VERSION;
export const BACKUP_MANIFEST_CATEGORIES = ['database', 'metadata', 'media', 'reference'] as const;

export type BackupManifestCategory = typeof BACKUP_MANIFEST_CATEGORIES[number];
export type BackupManifestRequirement = 'required' | 'optional';

export interface BackupManifestProtocolIdentity {
  name: string;
  version: string;
}

export interface BackupManifestStudioIdentity {
  studioId: string;
  protocol: BackupManifestProtocolIdentity;
  runtimeVersion: string;
}

/** Input accepts the protocolStatus-style flat fields as well as the persisted nested shape. */
export interface BackupManifestStudioIdentityInput {
  studioId: string;
  protocol?: Partial<BackupManifestProtocolIdentity>;
  protocolName?: string;
  protocolVersion?: string;
  name?: string;
  version?: string;
  runtimeVersion: string;
}

export interface BackupManifestEntry {
  path: string;
  category: BackupManifestCategory;
  required: boolean;
  byteSize: number;
  sha256: string;
}

export interface BackupManifest {
  schemaVersion: typeof BACKUP_MANIFEST_SCHEMA_VERSION;
  studio: BackupManifestStudioIdentity;
  entries: BackupManifestEntry[];
}

export interface BackupManifestEntryInput {
  /** `relativePath` is accepted to make accidental absolute-path use conspicuous at call sites. */
  relativePath?: string;
  path?: string;
  category: BackupManifestCategory;
  required?: boolean;
  /**
   * A caller that already hashed this file may supply the observation instead of making this module read it
   * again. The daemon uses it to keep multi-gigabyte media hashing outside its database write lock while the
   * database file itself is still hashed under that lock.
   */
  snapshot?: { byteSize: number; sha256: string };
}

type CategoryFileInput = string | Omit<BackupManifestEntryInput, 'category'>;

type CategoryFileList = readonly CategoryFileInput[];

export interface CreateBackupManifestInput {
  workspaceRoot: string;
  studio: BackupManifestStudioIdentityInput;
  entries?: readonly BackupManifestEntryInput[];
  /** `files` is an explicit alias for `entries`; both are merged if supplied. */
  files?: readonly BackupManifestEntryInput[];
  /** Category lists are useful to callers that already have a controlled backup policy. */
  filesByCategory?: Partial<Record<BackupManifestCategory, CategoryFileList>>;
}

export interface BackupManifestMismatch {
  code: BackupManifestMismatchCode;
  /** `kind` is retained as a readable discriminator for UI consumers. */
  kind: BackupManifestMismatchCode;
  severity: 'error' | 'warning';
  path?: string;
  field?: string;
  expected?: string | number | boolean;
  actual?: string | number | boolean;
}

export type BackupManifestMismatchCode =
  | 'workspace'
  | 'manifest-version'
  | 'studio-identity'
  | 'entries'
  | 'entry'
  | 'path'
  | 'sensitive-path'
  | 'duplicate-path'
  | 'ordering'
  | 'missing'
  | 'not-file'
  | 'symbolic-link'
  | 'unreadable'
  | 'size'
  | 'hash';

export interface BackupManifestValidation {
  valid: boolean;
  mismatches: BackupManifestMismatch[];
}

export interface ValidateBackupManifestInput {
  workspaceRoot: string;
  manifest: unknown;
  /** When supplied, the manifest's Studio identity is checked against this value. */
  studio?: BackupManifestStudioIdentityInput;
  expectedStudio?: BackupManifestStudioIdentityInput;
}

export type BackupManifestErrorCode =
  | 'invalid-root'
  | 'missing-root'
  | 'outside-root'
  | 'invalid-path'
  | 'sensitive-path'
  | 'symbolic-link'
  | 'not-directory'
  | 'not-file'
  | 'missing-file'
  | 'unreadable-file'
  | 'unstable-file'
  | 'invalid-identity'
  | 'invalid-entry';

export class BackupManifestError extends Error {
  readonly code: BackupManifestErrorCode;

  constructor(code: BackupManifestErrorCode, message: string) {
    super(message);
    this.name = 'BackupManifestError';
    this.code = code;
  }
}

interface FileSnapshot {
  byteSize: number;
  sha256: string;
}

interface RelativePathResult {
  path: string | null;
  issue?: 'invalid' | 'absolute' | 'traversal';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeIdentityText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new BackupManifestError('invalid-identity', `Backup manifest ${label} is invalid.`);
  const text = value.trim();
  if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/.test(text) || /https?:\/\//i.test(text)) {
    throw new BackupManifestError('invalid-identity', `Backup manifest ${label} is invalid.`);
  }
  if (/(?:api[_ -]?key|authorization|bearer|credential|password|secret|token)/i.test(text)) {
    throw new BackupManifestError('invalid-identity', `Backup manifest ${label} is invalid.`);
  }
  return text;
}

function semanticVersion(value: unknown, label: string): string {
  const version = safeIdentityText(value, label);
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) {
    throw new BackupManifestError('invalid-identity', `Backup manifest ${label} is invalid.`);
  }
  return version;
}

function normalizeStudioIdentity(input: BackupManifestStudioIdentityInput | BackupManifestStudioIdentity): BackupManifestStudioIdentity {
  if (!isRecord(input)) throw new BackupManifestError('invalid-identity', 'Backup manifest Studio identity is invalid.');
  const protocol = isRecord(input.protocol) ? input.protocol : {};
  const protocolName = protocol.name ?? input.protocolName ?? input.name;
  const protocolVersion = protocol.version ?? input.protocolVersion ?? input.version;
  return {
    studioId: safeIdentityText(input.studioId, 'studio identity'),
    protocol: {
      name: safeIdentityText(protocolName, 'protocol name'),
      version: semanticVersion(protocolVersion, 'protocol version')
    },
    runtimeVersion: semanticVersion(input.runtimeVersion, 'runtime version')
  };
}

function normalizeRelativePath(value: unknown): RelativePathResult {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) return { path: null, issue: 'invalid' };
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return { path: null, issue: 'absolute' };
  const segments = value.split('/');
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) return { path: null, issue: 'traversal' };
  return { path: segments.join('/') };
}

function assertRelativePath(value: unknown): string {
  const result = normalizeRelativePath(value);
  if (result.path) return result.path;
  if (result.issue === 'absolute') throw new BackupManifestError('outside-root', 'Backup manifest paths must be relative to the workspace root.');
  if (result.issue === 'traversal') throw new BackupManifestError('outside-root', 'Backup manifest paths may not traverse parent directories.');
  throw new BackupManifestError('invalid-path', 'Backup manifest path is invalid.');
}

function isSensitivePath(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  const segments = lower.split('/');
  const basename = segments[segments.length - 1] || '';
  if (lower.startsWith('daoge-studio/runtime/')) return true;
  if (/^provider\.db(?:[-_.]|$)/.test(basename)) return true;
  if (/^provider\.env(?:[-_.]|$)/.test(basename)) return true;
  if (basename === '.env' || basename.startsWith('.env.')) return true;
  if (/(?:api[_-]?key|authorization|bearer|password|secret|token)\s*[:=]/.test(lower)) return true;
  return segments.some((segment) => /(?:^|[-_.])(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|secrets|password|credential|credentials|authorization|auth|bearer|runtime-token|runtime_token)(?:[-_.]|$)/.test(segment));
}

function assertSafeRelativePath(value: unknown): string {
  const relativePath = assertRelativePath(value);
  if (isSensitivePath(relativePath)) throw new BackupManifestError('sensitive-path', 'Sensitive files may not be included in a backup manifest.');
  return relativePath;
}

function lstatOrNull(targetPath: string): fs.Stats | null {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function prepareWorkspaceRoot(workspaceRoot: unknown): string {
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) throw new BackupManifestError('invalid-root', 'A workspace root is required for a backup manifest.');
  const root = path.resolve(workspaceRoot);
  const stat = lstatOrNull(root);
  if (!stat) throw new BackupManifestError('missing-root', 'The backup workspace root does not exist.');
  if (stat.isSymbolicLink()) throw new BackupManifestError('symbolic-link', 'Backup workspace paths may not contain symbolic links.');
  if (!stat.isDirectory()) throw new BackupManifestError('not-directory', 'The backup workspace root must be a directory.');
  return root;
}

/** Validates a caller-supplied observation so an entry can skip the read without weakening the manifest shape. */
function suppliedSnapshot(value: unknown): FileSnapshot | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new BackupManifestError('invalid-entry', 'Backup manifest entry snapshot is invalid.');
  const byteSize = value.byteSize;
  const sha256 = value.sha256;
  if (typeof byteSize !== 'number' || !Number.isSafeInteger(byteSize) || byteSize < 0) throw new BackupManifestError('invalid-entry', 'Backup manifest entry snapshot size is invalid.');
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new BackupManifestError('invalid-entry', 'Backup manifest entry snapshot hash is invalid.');
  return { byteSize, sha256 };
}

/**
 * Observes one regular file the same way manifest creation does, so a caller can hash large media outside a
 * database lock and then hand the observation to `createBackupManifest`. Returns null when the file is absent.
 */
export function snapshotBackupFile(workspaceRoot: string, relativePath: string): { byteSize: number; sha256: string } | null {
  const snapshot = snapshotFile(prepareWorkspaceRoot(workspaceRoot), assertSafeRelativePath(relativePath));
  return snapshot ? { byteSize: snapshot.byteSize, sha256: snapshot.sha256 } : null;
}

/** Reads only regular files after checking every parent component with lstat. */
function snapshotFile(root: string, relativePath: string): FileSnapshot | null {
  let current = root;
  const segments = relativePath.split('/');
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stat = lstatOrNull(current);
    if (!stat) return null;
    if (stat.isSymbolicLink()) throw new BackupManifestError('symbolic-link', 'Backup workspace paths may not contain symbolic links.');
    if (index < segments.length - 1 && !stat.isDirectory()) throw new BackupManifestError('not-directory', 'Backup manifest parent path is not a directory.');
    if (index === segments.length - 1 && !stat.isFile()) throw new BackupManifestError('not-file', 'Backup manifest entries must refer to regular files.');
  }

  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let fd: number;
  try {
    fd = fs.openSync(current, fs.constants.O_RDONLY | noFollow);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    if (code === 'ELOOP') throw new BackupManifestError('symbolic-link', 'Backup workspace paths may not contain symbolic links.');
    throw new BackupManifestError('unreadable-file', 'Backup manifest file could not be read.');
  }

  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw new BackupManifestError('not-file', 'Backup manifest entries must refer to regular files.');
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let byteSize = 0;
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      byteSize += bytesRead;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new BackupManifestError('unstable-file', 'Backup manifest file changed while being read.');
    return { byteSize, sha256: hash.digest('hex') };
  } catch (error) {
    if (error instanceof BackupManifestError) throw error;
    throw new BackupManifestError('unreadable-file', 'Backup manifest file could not be read.');
  } finally {
    fs.closeSync(fd);
  }
}

function category(value: unknown): value is BackupManifestCategory {
  return typeof value === 'string' && (BACKUP_MANIFEST_CATEGORIES as readonly string[]).includes(value);
}

function entryPathInput(value: { path?: unknown; relativePath?: unknown }): unknown {
  if (value.path !== undefined && value.relativePath !== undefined && value.path !== value.relativePath) {
    throw new BackupManifestError('invalid-entry', 'Backup manifest entry has conflicting paths.');
  }
  return value.relativePath !== undefined ? value.relativePath : value.path;
}

function flattenCreateEntries(input: CreateBackupManifestInput): BackupManifestEntryInput[] {
  const entries: BackupManifestEntryInput[] = [];
  for (const source of [...(input.entries || []), ...(input.files || [])]) entries.push(source);
  for (const categoryName of BACKUP_MANIFEST_CATEGORIES) {
    const files = input.filesByCategory?.[categoryName] || [];
    for (const source of files) {
      if (typeof source === 'string') entries.push({ path: source, category: categoryName });
      else entries.push({ ...source, category: categoryName });
    }
  }
  return entries;
}

function createArguments(first: CreateBackupManifestInput | string, second?: BackupManifestStudioIdentityInput, third?: readonly BackupManifestEntryInput[]): { root: string; studio: BackupManifestStudioIdentityInput; entries: BackupManifestEntryInput[] } {
  if (typeof first === 'string') {
    if (!second) throw new BackupManifestError('invalid-identity', 'Backup manifest Studio identity is required.');
    return { root: first, studio: second, entries: [...(third || [])] };
  }
  if (!isRecord(first) || !isRecord(first.studio)) throw new BackupManifestError('invalid-identity', 'Backup manifest Studio identity is required.');
  return { root: first.workspaceRoot, studio: first.studio as BackupManifestStudioIdentityInput, entries: flattenCreateEntries(first as CreateBackupManifestInput) };
}

/** Creates a local-only manifest; it never copies files or records timestamps. */
export function createBackupManifest(input: CreateBackupManifestInput): BackupManifest;
export function createBackupManifest(workspaceRoot: string, studio: BackupManifestStudioIdentityInput, entries: readonly BackupManifestEntryInput[]): BackupManifest;
export function createBackupManifest(first: CreateBackupManifestInput | string, second?: BackupManifestStudioIdentityInput, third?: readonly BackupManifestEntryInput[]): BackupManifest {
  const args = createArguments(first, second, third);
  const root = prepareWorkspaceRoot(args.root);
  const studio = normalizeStudioIdentity(args.studio);
  const seen = new Set<string>();
  const output: BackupManifestEntry[] = [];

  for (const source of args.entries) {
    if (!isRecord(source) || !category(source.category)) throw new BackupManifestError('invalid-entry', 'Backup manifest entries require a supported category.');
    if (source.required !== undefined && typeof source.required !== 'boolean') throw new BackupManifestError('invalid-entry', 'Backup manifest entry requirement is invalid.');
    const required = source.required !== false;
    const relativePath = assertSafeRelativePath(entryPathInput(source));
    if (seen.has(relativePath)) throw new BackupManifestError('invalid-entry', 'Backup manifest entries may not contain duplicate paths.');
    seen.add(relativePath);
    const supplied = suppliedSnapshot(source.snapshot);
    const snapshot = supplied || snapshotFile(root, relativePath);
    if (!snapshot) {
      if (!required) continue;
      throw new BackupManifestError('missing-file', 'A required backup manifest file does not exist.');
    }
    output.push({ path: relativePath, category: source.category, required, byteSize: snapshot.byteSize, sha256: snapshot.sha256 });
  }

  output.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION, studio, entries: output };
}

function safeDiagnosticPath(value: unknown): string | undefined {
  const result = normalizeRelativePath(value);
  return result.path || undefined;
}

function mismatch(code: BackupManifestMismatchCode, options: Partial<Omit<BackupManifestMismatch, 'code' | 'kind'>> = {}): BackupManifestMismatch {
  return { code, kind: code, severity: 'error', ...options };
}

function safeDiagnosticValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value) && !/https?:\/\//i.test(value) && !/(?:api[_ -]?key|authorization|bearer|credential|password|secret|token)/i.test(value)) return value;
  return undefined;
}

function mapSnapshotError(error: unknown, relativePath: string, required: boolean): BackupManifestMismatch {
  const code = error instanceof BackupManifestError ? error.code : undefined;
  if (code === 'symbolic-link') return mismatch('symbolic-link', { path: relativePath });
  if (code === 'not-file' || code === 'not-directory') return mismatch('not-file', { path: relativePath });
  const result = mismatch('unreadable', { path: relativePath });
  if (!required) result.severity = 'warning';
  return result;
}

function manifestEntry(value: unknown): { entry: BackupManifestEntry; path?: string; mismatches: BackupManifestMismatch[] } {
  const errors: BackupManifestMismatch[] = [];
  if (!isRecord(value)) return { entry: {} as BackupManifestEntry, mismatches: [mismatch('entry')] };
  const rawPath = value.path;
  const parsedPath = normalizeRelativePath(rawPath);
  const relativePath = parsedPath.path || safeDiagnosticPath(rawPath);
  if (!parsedPath.path) errors.push(mismatch(parsedPath.issue === 'absolute' || parsedPath.issue === 'traversal' ? 'path' : 'entry', { path: relativePath }));
  else if (parsedPath.path !== rawPath) errors.push(mismatch('path', { path: parsedPath.path }));
  if (parsedPath.path && isSensitivePath(parsedPath.path)) errors.push(mismatch('sensitive-path', { path: parsedPath.path }));
  if (!category(value.category)) errors.push(mismatch('entry', { path: relativePath, field: 'category' }));
  if (typeof value.required !== 'boolean') errors.push(mismatch('entry', { path: relativePath, field: 'required' }));
  if (typeof value.byteSize !== 'number' || !Number.isSafeInteger(value.byteSize) || value.byteSize < 0) errors.push(mismatch('entry', { path: relativePath, field: 'byteSize' }));
  if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) errors.push(mismatch('entry', { path: relativePath, field: 'sha256' }));
  return { entry: value as unknown as BackupManifestEntry, path: parsedPath.path || undefined, mismatches: errors };
}

function identityMismatch(field: string, expectedValue: string, actualValue: unknown): BackupManifestMismatch {
  return mismatch('studio-identity', { field, expected: expectedValue, actual: safeDiagnosticValue(actualValue) });
}

function validateManifestArguments(first: ValidateBackupManifestInput | string, second?: unknown, third?: BackupManifestStudioIdentityInput): { root: unknown; manifest: unknown; studio?: BackupManifestStudioIdentityInput } {
  if (typeof first === 'string') return { root: first, manifest: second, studio: third };
  if (!isRecord(first)) return { root: undefined, manifest: undefined };
  return { root: first.workspaceRoot, manifest: first.manifest, studio: (first.studio || first.expectedStudio) as BackupManifestStudioIdentityInput | undefined };
}

/** Re-reads each listed file and returns safe, relative-path-only mismatch details. */
export function validateBackupManifest(input: ValidateBackupManifestInput): BackupManifestValidation;
export function validateBackupManifest(workspaceRoot: string, manifest: unknown, studio?: BackupManifestStudioIdentityInput): BackupManifestValidation;
export function validateBackupManifest(first: ValidateBackupManifestInput | string, second?: unknown, third?: BackupManifestStudioIdentityInput): BackupManifestValidation {
  const args = validateManifestArguments(first, second, third);
  const mismatches: BackupManifestMismatch[] = [];
  let root: string | null = null;
  try {
    root = prepareWorkspaceRoot(args.root);
  } catch {
    mismatches.push(mismatch('workspace'));
  }

  if (!isRecord(args.manifest)) return { valid: false, mismatches: [...mismatches, mismatch('manifest-version')] };
  if (args.manifest.schemaVersion !== BACKUP_MANIFEST_SCHEMA_VERSION) {
    mismatches.push(mismatch('manifest-version', { field: 'schemaVersion', expected: BACKUP_MANIFEST_SCHEMA_VERSION, actual: safeDiagnosticValue(args.manifest.schemaVersion) }));
  }

  let actualStudio: BackupManifestStudioIdentity | null = null;
  try {
    actualStudio = normalizeStudioIdentity(args.manifest.studio as BackupManifestStudioIdentity);
  } catch {
    mismatches.push(mismatch('studio-identity'));
  }
  if (args.studio) {
    try {
      const expected = normalizeStudioIdentity(args.studio);
      if (actualStudio) {
        if (actualStudio.studioId !== expected.studioId) mismatches.push(identityMismatch('studioId', expected.studioId, actualStudio.studioId));
        if (actualStudio.protocol.name !== expected.protocol.name) mismatches.push(identityMismatch('protocol.name', expected.protocol.name, actualStudio.protocol.name));
        if (actualStudio.protocol.version !== expected.protocol.version) mismatches.push(identityMismatch('protocol.version', expected.protocol.version, actualStudio.protocol.version));
        if (actualStudio.runtimeVersion !== expected.runtimeVersion) mismatches.push(identityMismatch('runtimeVersion', expected.runtimeVersion, actualStudio.runtimeVersion));
      }
    } catch {
      mismatches.push(mismatch('studio-identity'));
    }
  }

  if (!Array.isArray(args.manifest.entries)) {
    mismatches.push(mismatch('entries'));
    return { valid: false, mismatches };
  }

  const seen = new Set<string>();
  let previousPath: string | undefined;
  for (const value of args.manifest.entries) {
    const parsed = manifestEntry(value);
    mismatches.push(...parsed.mismatches);
    if (!parsed.path) continue;
    const relativePath = parsed.path;
    if (seen.has(relativePath)) mismatches.push(mismatch('duplicate-path', { path: relativePath }));
    seen.add(relativePath);
    if (previousPath !== undefined && relativePath < previousPath) mismatches.push(mismatch('ordering', { path: relativePath }));
    previousPath = relativePath;
    if (isSensitivePath(relativePath) || parsed.mismatches.some((item) => item.code === 'entry' || item.code === 'path')) continue;
    if (!root) continue;
    const required = (value as Record<string, unknown>).required === true;
    let snapshot: FileSnapshot | null;
    try {
      snapshot = snapshotFile(root, relativePath);
    } catch (error) {
      mismatches.push(mapSnapshotError(error, relativePath, required));
      continue;
    }
    if (!snapshot) {
      const missing = mismatch('missing', { path: relativePath });
      missing.severity = required ? 'error' : 'warning';
      mismatches.push(missing);
      continue;
    }
    const entry = parsed.entry;
    if (snapshot.byteSize !== entry.byteSize) mismatches.push(mismatch('size', { path: relativePath, expected: entry.byteSize, actual: snapshot.byteSize }));
    if (snapshot.sha256 !== entry.sha256) mismatches.push(mismatch('hash', { path: relativePath, expected: entry.sha256, actual: snapshot.sha256 }));
  }

  return { valid: mismatches.every((item) => item.severity !== 'error'), mismatches };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new BackupManifestError('invalid-entry', 'Backup manifest contains a non-finite value.');
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new BackupManifestError('invalid-entry', 'Backup manifest contains a non-JSON value.');
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalValue(value[key]);
  return output;
}

function serializableManifest(manifest: BackupManifest): Record<string, unknown> {
  if (!isRecord(manifest) || manifest.schemaVersion !== BACKUP_MANIFEST_SCHEMA_VERSION) throw new BackupManifestError('invalid-entry', 'Backup manifest version is invalid.');
  const studio = normalizeStudioIdentity(manifest.studio);
  if (!Array.isArray(manifest.entries)) throw new BackupManifestError('invalid-entry', 'Backup manifest entries are invalid.');
  const entries: BackupManifestEntry[] = [];
  const seen = new Set<string>();
  for (const value of manifest.entries) {
    if (!isRecord(value)) throw new BackupManifestError('invalid-entry', 'Backup manifest entry is invalid.');
    const relativePath = assertSafeRelativePath(value.path);
    if (relativePath !== value.path || seen.has(relativePath) || !category(value.category) || typeof value.required !== 'boolean' || typeof value.byteSize !== 'number' || !Number.isSafeInteger(value.byteSize) || value.byteSize < 0 || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new BackupManifestError('invalid-entry', 'Backup manifest entry is invalid.');
    seen.add(relativePath);
    entries.push({ path: relativePath, category: value.category, required: value.required, byteSize: value.byteSize, sha256: value.sha256 });
  }
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION, studio, entries };
}

/** Canonical JSON with sorted object keys and path-sorted entries. */
export function serializeBackupManifest(manifest: BackupManifest): string {
  return JSON.stringify(canonicalValue(serializableManifest(manifest)));
}

export function backupManifestChecksum(manifest: BackupManifest): string {
  return createHash('sha256').update(serializeBackupManifest(manifest), 'utf8').digest('hex');
}

/** Named aliases for callers that describe the operation as verification or hashing. */
export const verifyBackupManifest = validateBackupManifest;
export const checksumBackupManifest = backupManifestChecksum;
