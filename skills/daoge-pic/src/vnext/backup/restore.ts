import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BackupManifestEntry, BackupManifestStudioIdentityInput, BackupManifestValidation, validateBackupManifest } from './manifest';
import { acquireDaemonLock, DaemonLockBusyError, type DaemonLockHandle } from '../runtime/daemon-lock';
import { STUDIO_SCHEMA_VERSION } from '../studio/database';

/**
 * Restore is plan-only by default. Applying a restore is an offline transaction:
 * a real SQLite daemon coordination lock is held for the whole operation, the
 * database sidecar family is quarantined as one unit, and a durable journal is
 * fsynced before the first rename. A journal left by SIGKILL is repaired on the
 * next daemon/CLI invocation before SQLite is opened.
 */

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
  | 'target_unreadable'
  | 'category_path';

export type RestoreDryRunIssue = { code: RestoreDryRunIssueCode; severity: 'error' | 'warning'; path?: string };
export type RestoreDryRunResult = { ready: boolean; sourceValid: boolean; targetValid: boolean; operations: RestoreOperation[]; issues: RestoreDryRunIssue[] };

export interface RestoreDryRunInput {
  sourceRoot: string;
  targetRoot: string;
  manifest: unknown;
  studio?: BackupManifestStudioIdentityInput;
  expectedStudio?: BackupManifestStudioIdentityInput;
}

type FileSnapshot = { byteSize: number; sha256: string };
type TargetInspection =
  | { kind: 'missing'; parentDirectoriesMissing: number }
  | { kind: 'file'; snapshot: FileSnapshot; parentDirectoriesMissing: number }
  | { kind: 'symbolic-link' }
  | { kind: 'not-file' }
  | { kind: 'unreadable' };

function errno(error: unknown): string | undefined { return error instanceof Error && 'code' in error ? String(error.code) : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function assertNoSymlinkAncestors(resolved: string): void {
  const absolute = path.resolve(resolved);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const rest = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const segment of rest) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); } catch (error) { if (errno(error) === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw new Error('Workspace paths may not contain symbolic links.');
  }
}

function safeRoot(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const resolved = path.resolve(value);
  let canonical: string;
  let stat: fs.Stats;
  try {
    const requested = fs.lstatSync(resolved);
    if (!requested.isDirectory() || requested.isSymbolicLink()) return null;
    canonical = fs.realpathSync(resolved);
    assertNoSymlinkAncestors(canonical);
    stat = fs.lstatSync(canonical);
  } catch { return null; }
  return stat.isDirectory() && !stat.isSymbolicLink() ? canonical : null;
}

function safeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\\0')) return null;
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return null;
  const segments = value.split('/');
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

function readRegularFile(root: string, relativePath: string): FileSnapshot | null {
  const target = path.join(root, ...relativePath.split('/'));
  try { assertNoSymlinkAncestors(target); } catch { return null; }
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  let fd: number;
  try { fd = fs.openSync(target, fs.constants.O_RDONLY | noFollow); } catch { return null; }
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile()) return null;
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let byteSize = 0;
    for (;;) { const count = fs.readSync(fd, buffer, 0, buffer.length, null); if (!count) break; hash.update(buffer.subarray(0, count)); byteSize += count; }
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
    try { stat = fs.lstatSync(current); } catch (error) {
      if (errno(error) !== 'ENOENT') return { kind: 'unreadable' };
      missingParents += index < segments.length - 1 ? 1 : 0;
      return { kind: 'missing', parentDirectoriesMissing: missingParents };
    }
    if (stat.isSymbolicLink()) return { kind: 'symbolic-link' };
    if (index < segments.length - 1) { if (!stat.isDirectory()) return { kind: 'not-file' }; continue; }
    if (!stat.isFile()) return { kind: 'not-file' };
    const snapshot = readRegularFile(root, relativePath);
    return snapshot ? { kind: 'file', snapshot, parentDirectoriesMissing: missingParents } : { kind: 'unreadable' };
  }
  return { kind: 'unreadable' };
}

function isCategory(value: unknown): value is BackupManifestEntry['category'] { return value === 'database' || value === 'metadata' || value === 'media' || value === 'reference'; }

/** Restore accepts only the controlled backup inventory prefixes. */
function categoryPathAllowed(category: BackupManifestEntry['category'], relativePath: string): boolean {
  if (category === 'database') return relativePath === 'daoge-studio/studio.db';
  if (category === 'metadata') return relativePath === 'metadata/studio.json' || relativePath.startsWith('metadata/') || relativePath === 'daoge-studio/studio.json';
  if (category === 'media') return relativePath.startsWith('media/') || relativePath.startsWith('daoge-assets/') || relativePath.startsWith('daoge-deliveries/');
  return relativePath.startsWith('reference/') || relativePath.startsWith('metadata/') || relativePath.startsWith('daoge-studio/');
}

function manifestEntries(manifest: unknown): BackupManifestEntry[] {
  if (!isRecord(manifest) || !Array.isArray(manifest.entries)) return [];
  return manifest.entries.filter((entry): entry is BackupManifestEntry => {
    if (!isRecord(entry) || !('path' in entry) || !('category' in entry) || !('required' in entry) || !('byteSize' in entry) || !('sha256' in entry)) return false;
    return safeRelativePath(entry.path) !== null && isCategory(entry.category) && categoryPathAllowed(entry.category, String(entry.path))
      && typeof entry.required === 'boolean' && Number.isSafeInteger(entry.byteSize) && Number(entry.byteSize) >= 0
      && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256);
  });
}

function sourceIssueForPath(result: BackupManifestValidation, relativePath: string): boolean { return result.mismatches.some((issue) => issue.path === relativePath && (issue.severity === 'error' || issue.code === 'missing')); }
function issueFromTarget(relativePath: string, inspection: TargetInspection): RestoreDryRunIssue | null {
  if (inspection.kind === 'symbolic-link') return { code: 'target_symbolic_link', severity: 'error', path: relativePath };
  if (inspection.kind === 'not-file') return { code: 'target_not_file', severity: 'error', path: relativePath };
  if (inspection.kind === 'unreadable') return { code: 'target_unreadable', severity: 'error', path: relativePath };
  return null;
}

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
  for (const entry of manifestEntries(input.manifest)) {
    const relativePath = safeRelativePath(entry.path);
    if (!relativePath || !categoryPathAllowed(entry.category, relativePath)) { issues.push({ code: 'category_path', severity: 'error', path: relativePath || undefined }); continue; }
    if (sourceRoot && targetRoot && sourceValidation.valid && !sourceIssueForPath(sourceValidation, relativePath)) {
      const inspection = inspectTarget(targetRoot, relativePath);
      const targetIssue = issueFromTarget(relativePath, inspection);
      if (targetIssue) { issues.push(targetIssue); continue; }
      let action: RestoreOperation['action'];
      let parentDirectoriesMissing: number;
      if (inspection.kind === 'missing') {
        action = 'create';
        parentDirectoriesMissing = inspection.parentDirectoriesMissing;
      } else if (inspection.kind === 'file') {
        action = inspection.snapshot.sha256 === entry.sha256 && inspection.snapshot.byteSize === entry.byteSize ? 'unchanged' : 'replace';
        parentDirectoriesMissing = inspection.parentDirectoriesMissing;
      } else {
        continue;
      }
      operations.push({ path: relativePath, category: entry.category, required: entry.required, action, byteSize: entry.byteSize, sha256: entry.sha256, parentDirectoriesMissing });
    }
  }
  const sourceIssues = sourceValidation.mismatches.filter((issue) => issue.severity === 'error' || issue.code === 'missing').map((issue): RestoreDryRunIssue => ({ code: 'source_manifest', severity: issue.severity, ...(issue.path ? { path: issue.path } : {}) }));
  const allIssues = [...issues, ...sourceIssues];
  return { ready: sourceValidation.valid && Boolean(sourceRoot) && Boolean(targetRoot) && allIssues.every((issue) => issue.severity !== 'error'), sourceValid: sourceValidation.valid, targetValid: Boolean(targetRoot) && !issues.some((issue) => issue.code.startsWith('target_') && issue.severity === 'error'), operations, issues: allIssues };
}

export const restoreBackupDryRun = createRestoreDryRun;
export const planBackupRestore = createRestoreDryRun;

export type RestoreApplyErrorCode = 'not_ready' | 'target_locked' | 'staging_failed' | 'verification_failed' | 'swap_failed' | 'rollback_failed' | 'recovery_failed';
export type RestoreFailurePoint = 'after_staging' | 'during_swap' | 'after_original_move' | 'during_rollback';
export interface RestoreApplyInput extends RestoreDryRunInput { failAt?: RestoreFailurePoint; failAtOperation?: number; coordinationLock?: DaemonLockHandle; lockWaitMs?: number; }
export interface RestoreApplyResult { applied: boolean; dryRun: RestoreDryRunResult; created: number; replaced: number; unchanged: number; rolledBack: boolean; restoredPaths: string[]; error?: { code: RestoreApplyErrorCode; message: string; path?: string }; }

export class RestoreApplyFailure extends Error {
  readonly code: RestoreApplyErrorCode;
  readonly path?: string;
  readonly status: number;
  constructor(code: RestoreApplyErrorCode, message: string, path?: string) {
    super(message); this.name = 'RestoreApplyFailure'; this.code = code; this.path = path;
    this.status = code === 'verification_failed' || code === 'not_ready' ? 400 : code === 'target_locked' ? 409 : 500;
  }
}

interface JournalEntry { relativePath: string; stagedPath: string; originalPath: string; backupIntent: boolean; originalRenamed: boolean; newInstalled: boolean; hadOriginal: boolean; }
interface RestoreJournal { version: 1; state: 'prepared' | 'pending' | 'rollback_failed' | 'applied'; targetRoot: string; stagingRoot: string; journalPath: string; createdDirectories: string[]; entries: JournalEntry[]; }

function absoluteFor(root: string, relativePath: string): string { return path.join(root, ...relativePath.split('/')); }
function restoreRuntimeDir(targetRoot: string): string { return path.join(targetRoot, 'daoge-studio', 'runtime'); }
function daemonLockPaths(targetRoot: string): { databasePath: string; ownerRecordPath: string } { const dir = restoreRuntimeDir(targetRoot); return { databasePath: path.join(dir, 'daemon-lock.sqlite'), ownerRecordPath: path.join(dir, 'daemon.lock') }; }
function fsyncDirectory(directory: string): void { try { const fd = fs.openSync(directory, fs.constants.O_RDONLY); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch { /* filesystem may not expose directory fsync */ } }
function fsyncPath(filePath: string): void { const fd = fs.openSync(filePath, fs.constants.O_RDONLY); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function writeDurableJson(filePath: string, value: unknown): void {
  const temporary = filePath + '.tmp-' + process.pid + '-' + Math.random().toString(16).slice(2);
  let fd: number | null = null;
  try { fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(value) + '\n', 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = null; fs.renameSync(temporary, filePath); fsyncDirectory(path.dirname(filePath)); }
  finally { if (fd !== null) try { fs.closeSync(fd); } catch {} try { fs.rmSync(temporary, { force: true }); } catch {} }
}
function readJournal(filePath: string): RestoreJournal | null { try { const stat = fs.lstatSync(filePath); if (stat.isSymbolicLink() || !stat.isFile()) return null; const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RestoreJournal; return value && value.version === 1 && typeof value.targetRoot === 'string' && typeof value.stagingRoot === 'string' && Array.isArray(value.entries) ? value : null; } catch { return null; } }

function ensureSafeParentDirectories(root: string, relativePath: string, created: string[]): string {
  const segments = relativePath.split('/'); segments.pop();
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat: fs.Stats | null = null;
    try { stat = fs.lstatSync(current); } catch (error) { if (errno(error) !== 'ENOENT') throw error; fs.mkdirSync(current); created.push(path.relative(root, current).split(path.sep).join('/')); stat = fs.lstatSync(current); }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Restore parent path is not a safe directory.');
  }
  return current;
}
function assertSafeExistingPath(root: string, relativePath: string): fs.Stats | null {
  let current = root;
  let lastStat: fs.Stats | null = null;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); } catch (error) { if (errno(error) === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink()) throw new Error('Restore refuses symbolic-link path components.');
    if (current !== absoluteFor(root, relativePath) && !stat.isDirectory()) throw new Error('Restore parent path is not a directory.');
    lastStat = stat;
  }
  return lastStat;
}
function replaceFile(from: string, to: string): void {
  try { fs.renameSync(from, to); return; } catch (error) { const code = errno(error); if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error; }
  fs.rmSync(to, { force: true }); fs.renameSync(from, to);
}
function copyAndHash(source: string, destination: string): FileSnapshot | null {
  let input: number; try { input = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); } catch { return null; }
  let output: number | null = null;
  try {
    if (!fs.fstatSync(input).isFile()) return null;
    output = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    const hash = createHash('sha256'); const buffer = Buffer.allocUnsafe(64 * 1024); let byteSize = 0;
    for (;;) { const count = fs.readSync(input, buffer, 0, buffer.length, null); if (!count) break; let written = 0; while (written < count) written += fs.writeSync(output, buffer, written, count - written); hash.update(buffer.subarray(0, count)); byteSize += count; }
    fs.fsyncSync(output); return { byteSize, sha256: hash.digest('hex') };
  } finally { fs.closeSync(input); if (output !== null) fs.closeSync(output); }
}

function checkpointDatabase(databasePath: string): void {
  if (!fs.existsSync(databasePath)) return;
  let db: any = null;
  try {
    const DatabaseSync = require('node:sqlite').DatabaseSync as new (path: string) => any;
    db = new DatabaseSync(databasePath); db.exec('PRAGMA busy_timeout = 100; PRAGMA synchronous = FULL;');
    const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy?: unknown; log?: unknown } | undefined;
    if (!result || Number(result.busy) !== 0 || Number(result.log) !== 0) throw new Error('SQLite checkpoint is busy.');
  } finally { if (db) db.close(); }
  for (const suffix of ['-wal', '-shm', '-journal']) { const sidecar = databasePath + suffix; try { const stat = fs.lstatSync(sidecar); if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== 0) throw new Error('SQLite sidecar is not empty after checkpoint.'); } catch (error) { if (errno(error) !== 'ENOENT') throw error; } }
}

function verifyDatabaseFile(databasePath: string): void {
  let db: any = null;
  try {
    const DatabaseSync = require('node:sqlite').DatabaseSync as new (path: string) => any;
    db = new DatabaseSync(databasePath); db.exec('PRAGMA foreign_keys = ON;');
    const integrity = db.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>;
    if (!integrity.length || integrity.some((row) => Object.values(row)[0] !== 'ok')) throw new Error('SQLite integrity_check failed.');
    const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
    const studios = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'studios'").get();
    if (!table || !studios) throw new Error('Studio schema tables are missing.');
    const version = Number((db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version?: unknown }).version);
    if (!Number.isInteger(version) || version !== STUDIO_SCHEMA_VERSION) throw new Error('Studio schema version is not supported.');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite foreign-key integrity_check failed.');
  } finally { if (db) db.close(); }
}

function makeJournal(targetRoot: string, stagingRoot: string, entries: JournalEntry[], createdDirectories: string[]): RestoreJournal {
  const id = path.basename(stagingRoot).slice('.daoge-restore-'.length);
  return { version: 1, state: 'prepared', targetRoot, stagingRoot, journalPath: path.join(targetRoot, '.daoge-restore-' + id + '.journal.json'), createdDirectories, entries };
}
function persistJournal(journal: RestoreJournal): void { writeDurableJson(journal.journalPath, journal); }
function cleanupEmptyDirectories(targetRoot: string, directories: readonly string[]): void {
  for (const relative of [...directories].sort((a, b) => b.length - a.length)) {
    const absolute = absoluteFor(targetRoot, relative);
    try { const stat = fs.lstatSync(absolute); if (stat.isDirectory() && !stat.isSymbolicLink() && fs.readdirSync(absolute).length === 0) fs.rmdirSync(absolute); } catch { /* rollback reports only when data restoration fails */ }
  }
}
function cleanupJournalArtifacts(journal: RestoreJournal): void { fs.rmSync(journal.stagingRoot, { recursive: true, force: true }); fs.rmSync(journal.journalPath, { force: true }); fsyncDirectory(journal.targetRoot); }

function rollbackJournal(journal: RestoreJournal, failAtOperation?: number): boolean {
  let complete = true;
  for (const [index, entry] of [...journal.entries].reverse().entries()) {
    const target = absoluteFor(journal.targetRoot, entry.relativePath);
    try {
      if (index === failAtOperation) throw new Error('Injected rollback failure.');
      const targetExists = fs.existsSync(target);
      const originalExists = fs.existsSync(entry.originalPath);
      if (entry.hadOriginal) {
        // The durable intent may precede originalRenamed by one fs operation.
        // Presence of the backup is authoritative for whether replacement occurred.
        if (originalExists) {
          if (targetExists) fs.rmSync(target, { force: true });
          replaceFile(entry.originalPath, target);
        } else if ((entry as JournalEntry & { backupIntent?: boolean }).backupIntent && !targetExists) {
          complete = false;
        }
      } else if (targetExists) fs.rmSync(target, { force: true });
    } catch { complete = false; }
  }
  if (complete) { cleanupEmptyDirectories(journal.targetRoot, journal.createdDirectories); cleanupJournalArtifacts(journal); }
  return complete;
}

/** Repairs all durable restore journals in a workspace. Throws only when the repair itself cannot complete. */
export function recoverPendingBackupRestore(targetRoot: string): { recovered: number } {
  const root = safeRoot(targetRoot);
  if (!root) throw new RestoreApplyFailure('recovery_failed', 'Restore recovery target workspace is not safe.');
  let recovered = 0;
  let names: string[];
  try { names = fs.readdirSync(root).filter((name) => /^\.daoge-restore-[A-Za-z0-9_-]+\.journal\.json$/.test(name)); } catch (error) { throw new RestoreApplyFailure('recovery_failed', 'Unable to inspect pending restore journals.'); }
  for (const name of names) {
    const journalPath = path.join(root, name); const journal = readJournal(journalPath);
    if (!journal || safeRoot(journal.targetRoot) !== root || fs.realpathSync.native(path.dirname(journal.journalPath)) !== root || path.basename(journal.journalPath) !== name) throw new RestoreApplyFailure('recovery_failed', 'Pending restore journal is invalid.');
    if (journal.state === 'applied') { try { cleanupJournalArtifacts(journal); recovered += 1; } catch { throw new RestoreApplyFailure('recovery_failed', 'Unable to clean an applied restore journal.'); } continue; }
    if (!rollbackJournal(journal)) throw new RestoreApplyFailure('recovery_failed', 'Unable to roll back a pending restore; staging and originals were retained.');
    recovered += 1;
  }
  return { recovered };
}

function waitForRestoreLock(targetRoot: string, waitMs: number): { lock: DaemonLockHandle | null; error: unknown } {
  const paths = daemonLockPaths(targetRoot);
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    try { return { lock: acquireDaemonLock(paths), error: null }; }
    catch (error) {
      if (!(error instanceof DaemonLockBusyError) || Date.now() >= deadline) return { lock: null, error };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(50, deadline - Date.now()));
    }
  }
}

function errorResult(dryRun: RestoreDryRunResult, code: RestoreApplyErrorCode, message: string, pathValue?: string): RestoreApplyResult { return { applied: false, dryRun, created: 0, replaced: 0, unchanged: 0, rolledBack: false, restoredPaths: [], error: { code, message, ...(pathValue ? { path: pathValue } : {}) } }; }

export function applyBackupRestore(input: RestoreApplyInput): RestoreApplyResult {
  const dryRun = createRestoreDryRun(input);
  if (!dryRun.ready) return errorResult(dryRun, 'not_ready', 'Restore plan is not ready; resolve the reported issues first.');
  const sourceRoot = safeRoot(input.sourceRoot); const targetRoot = safeRoot(input.targetRoot);
  if (!sourceRoot || !targetRoot) return errorResult(dryRun, 'not_ready', 'Restore requires existing safe source and target workspaces.');
  let lock = input.coordinationLock; let ownsLock = false;
  if (!lock) {
    try { fs.mkdirSync(restoreRuntimeDir(targetRoot), { recursive: true }); }
    catch { return errorResult(dryRun, 'staging_failed', 'Unable to prepare the private restore coordination directory.'); }
    const acquired = waitForRestoreLock(targetRoot, input.lockWaitMs ?? 0);
    if (!acquired.lock) {
      return acquired.error instanceof DaemonLockBusyError
        ? errorResult(dryRun, 'target_locked', 'Studio daemon coordination lock is held by another process.')
        : errorResult(dryRun, 'staging_failed', 'Unable to acquire the Studio restore coordination lock.');
    }
    lock = acquired.lock;
    ownsLock = true;
  }
  try { recoverPendingBackupRestore(targetRoot); }
  catch (error) {
    const failure = error instanceof RestoreApplyFailure ? error : new RestoreApplyFailure('recovery_failed', 'Pending restore recovery failed.');
    if (ownsLock) try { lock.release(); } catch {}
    return errorResult(dryRun, failure.code, failure.message);
  }
  const writes = dryRun.operations.filter((operation) => operation.action !== 'unchanged');
  const counts = { created: dryRun.operations.filter((operation) => operation.action === 'create').length, replaced: dryRun.operations.filter((operation) => operation.action === 'replace').length, unchanged: dryRun.operations.filter((operation) => operation.action === 'unchanged').length };
  const stagingRoot = path.join(targetRoot, '.daoge-restore-' + createHash('sha256').update(String(Date.now())).update(String(Math.random())).digest('hex').slice(0, 20));
  const staged: Array<{ operation: RestoreOperation; stagedPath: string }> = [];
  let journal: RestoreJournal | null = null;
  try {
    fs.mkdirSync(stagingRoot, { recursive: false }); fsyncDirectory(targetRoot);
    const databaseOperation = writes.find((operation) => operation.category === 'database' && operation.path === 'daoge-studio/studio.db');
    if (databaseOperation) { try { checkpointDatabase(absoluteFor(targetRoot, databaseOperation.path)); } catch (error) { throw new RestoreApplyFailure('staging_failed', 'Unable to checkpoint target SQLite database before restore.'); } }
    for (let index = 0; index < writes.length; index += 1) {
      const operation = writes[index]; const sourcePath = absoluteFor(sourceRoot, operation.path); const stagedPath = path.join(stagingRoot, 'file-' + index);
      try { assertSafeExistingPath(sourceRoot, operation.path); } catch { throw new RestoreApplyFailure('staging_failed', 'Restore source path is unsafe.', operation.path); }
      const snapshot = copyAndHash(sourcePath, stagedPath);
      if (!snapshot) throw new RestoreApplyFailure('staging_failed', 'Restore source could not be staged.', operation.path);
      if (snapshot.byteSize !== operation.byteSize || snapshot.sha256 !== operation.sha256) throw new RestoreApplyFailure('verification_failed', 'Restore source did not match its manifest hash.', operation.path);
      if (operation.category === 'database') { try { verifyDatabaseFile(stagedPath); } catch { throw new RestoreApplyFailure('verification_failed', 'Restored SQLite database failed integrity/schema validation.', operation.path); } }
      staged.push({ operation, stagedPath });
    }
    if (input.failAt === 'after_staging') throw new RestoreApplyFailure('staging_failed', 'Injected failure after staging.');

    const createdDirectories: string[] = []; const journalEntries: JournalEntry[] = [];
    for (const { operation, stagedPath } of staged) {
      const target = absoluteFor(targetRoot, operation.path); const originalPath = path.join(stagingRoot, 'original-' + journalEntries.length);
      const existing = assertSafeExistingPath(targetRoot, operation.path); const hadOriginal = Boolean(existing);
      journalEntries.push({ relativePath: operation.path, stagedPath, originalPath, backupIntent: false, originalRenamed: false, newInstalled: false, hadOriginal });
    }
    // The database sidecars are part of the same quarantine unit even though a
    // manifest intentionally records only the checkpointed studio.db member.
    const sidecarPaths = ['daoge-studio/studio.db-wal', 'daoge-studio/studio.db-shm', 'daoge-studio/studio.db-journal'];
    for (const sidecar of sidecarPaths) {
      if (!writes.some((operation) => operation.path === sidecar)) { const target = absoluteFor(targetRoot, sidecar); const existing = assertSafeExistingPath(targetRoot, sidecar); if (existing) journalEntries.push({ relativePath: sidecar, stagedPath: '', originalPath: path.join(stagingRoot, 'original-sidecar-' + journalEntries.length), backupIntent: false, originalRenamed: false, newInstalled: false, hadOriginal: true }); }
    }
    journal = makeJournal(targetRoot, stagingRoot, journalEntries, createdDirectories); persistJournal(journal);

    for (let index = 0; index < staged.length; index += 1) {
      if (input.failAt === 'during_swap' && index === (input.failAtOperation ?? 0)) throw new RestoreApplyFailure('swap_failed', 'Injected failure during restore swap.', staged[index].operation.path);
      const { operation, stagedPath } = staged[index]; const entry = journal.entries.find((item) => item.relativePath === operation.path)!; const target = absoluteFor(targetRoot, operation.path);
      try {
        const existing = assertSafeExistingPath(targetRoot, operation.path);
        if (existing) {
          // Persist the backup intent before rename so SIGKILL cannot erase the fact
          // that this entry may have left the target without its original.
          entry.backupIntent = true; journal.state = 'pending'; persistJournal(journal);
          fs.renameSync(target, entry.originalPath); fsyncDirectory(path.dirname(target));
          entry.originalRenamed = true; persistJournal(journal);
          if ((input.failAt === 'after_original_move' || input.failAt === 'during_rollback') && index === (input.failAtOperation ?? 0)) throw new Error('Injected failure after original move.');
        }
        ensureSafeParentDirectories(targetRoot, operation.path, createdDirectories); fs.renameSync(stagedPath, target); fsyncDirectory(path.dirname(target)); entry.newInstalled = true; journal.state = 'pending'; journal.createdDirectories = createdDirectories; persistJournal(journal);
      } catch (error) { throw new RestoreApplyFailure('swap_failed', 'Restore swap failed: ' + String(error instanceof Error ? error.message : error), operation.path); }
    }
    // Quarantine sidecars after the primary file swaps, still under the same journal.
    for (const entry of journal.entries.filter((item) => item.stagedPath === '' && item.hadOriginal)) {
      try { if (assertSafeExistingPath(targetRoot, entry.relativePath)) { entry.backupIntent = true; journal.state = 'pending'; persistJournal(journal); fs.renameSync(absoluteFor(targetRoot, entry.relativePath), entry.originalPath); entry.originalRenamed = true; persistJournal(journal); } } catch { throw new RestoreApplyFailure('swap_failed', 'Unable to quarantine SQLite sidecar.', entry.relativePath); }
    }
    journal.state = 'pending'; persistJournal(journal);
    for (const operation of writes) { const snapshot = readRegularFile(targetRoot, operation.path); if (!snapshot || snapshot.byteSize !== operation.byteSize || snapshot.sha256 !== operation.sha256) throw new RestoreApplyFailure('verification_failed', 'Restored file failed post-swap verification.', operation.path); }
    if (databaseOperation) { try { verifyDatabaseFile(absoluteFor(targetRoot, databaseOperation.path)); } catch { throw new RestoreApplyFailure('verification_failed', 'Restored SQLite database failed post-swap integrity/schema validation.', databaseOperation.path); } }
    journal.state = 'applied'; persistJournal(journal);
    for (const entry of journal.entries) if (entry.originalRenamed) fs.rmSync(entry.originalPath, { force: true });
    cleanupJournalArtifacts(journal);
    const result: RestoreApplyResult = { applied: true, dryRun, ...counts, rolledBack: false, restoredPaths: writes.map((operation) => operation.path) };
    if (ownsLock) lock.release(); return result;
  } catch (error) {
    const failure = error instanceof RestoreApplyFailure ? error : new RestoreApplyFailure('swap_failed', String(error instanceof Error ? error.message : error));
    let rolledBack = false;
    if (journal) { rolledBack = rollbackJournal(journal, input.failAt === 'during_rollback' ? input.failAtOperation ?? 0 : undefined); if (!rolledBack) { journal.state = 'rollback_failed'; try { persistJournal(journal); } catch {} } }
    const result = errorResult(dryRun, rolledBack ? failure.code : journal ? 'rollback_failed' : failure.code, rolledBack ? failure.message : 'Restore failed and rollback also failed; staging, originals, and journal were retained.', failure.path);
    result.rolledBack = rolledBack;
    return result;
  } finally {
    if (!journal) { try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch {} }
    if (ownsLock && lock) { try { lock.release(); } catch {} }
  }
}

export const restoreBackup = applyBackupRestore;
