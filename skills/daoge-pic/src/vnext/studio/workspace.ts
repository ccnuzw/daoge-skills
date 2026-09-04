import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createId, nowIso } from '../shared/ids';

export const STUDIO_MANIFEST_VERSION = 1;
export const ASSET_BUCKETS = ['imports', 'generated', 'exports', 'trash'] as const;
export type AssetBucket = typeof ASSET_BUCKETS[number];

export interface StudioManifest {
  schemaVersion: number;
  studioId: string;
  workspaceRoot: string;
  createdAt: string;
}

export interface StudioPaths {
  workspaceRoot: string;
  studioDir: string;
  databasePath: string;
  manifestPath: string;
  providerDatabasePath: string;
  providerEnvPath: string;
  runtimeDir: string;
  daemonLockDatabasePath: string;
  daemonOwnerRecordPath: string;
  runsDir: string;
  cacheDir: string;
  evidenceDir: string;
  assetRoot: string;
  deliveriesRoot: string;
}

export interface SensitiveAccessDependencies {
  platform?: NodeJS.Platform;
  username?: string;
  run?: (command: string, args: readonly string[]) => void;
}

export interface InitializeStudioOptions {
  workspaceRoot: string;
  writeGitignore?: boolean;
  sensitiveAccess?: SensitiveAccessDependencies;
}

export interface InitializeStudioResult {
  paths: StudioPaths;
  manifest: StudioManifest;
  createdManifest: boolean;
}

function workspaceRelativePath(paths: StudioPaths, targetPath: string): string[] {
  const workspaceRoot = path.resolve(paths.workspaceRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(workspaceRoot, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Studio workspace path is outside the workspace root.');
  return relative ? relative.split(path.sep) : [];
}

function lstatOrNull(targetPath: string): fs.Stats | null {
  try { return fs.lstatSync(targetPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Verifies every existing component without following a link out of the workspace. */
export function assertWorkspacePath(paths: StudioPaths, targetPath: string, options: { requireDirectory?: boolean } = {}): boolean {
  const segments = workspaceRelativePath(paths, targetPath);
  let current = paths.workspaceRoot;
  const root = lstatOrNull(current);
  if (!root) return false;
  if (root.isSymbolicLink() || !root.isDirectory()) throw new Error('Studio workspace paths may not contain symbolic links or non-directory components.');
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const stat = lstatOrNull(current);
    if (!stat) return false;
    if (stat.isSymbolicLink()) throw new Error('Studio workspace paths may not contain symbolic links.');
    if (index < segments.length - 1 && !stat.isDirectory()) throw new Error('Studio workspace path has a non-directory parent component.');
    if (index === segments.length - 1 && options.requireDirectory && !stat.isDirectory()) throw new Error('Studio workspace path must be a directory.');
  }
  return true;
}

function ensureWorkspaceDirectory(paths: StudioPaths, directory: string): void {
  const segments = workspaceRelativePath(paths, directory);
  let current = paths.workspaceRoot;
  let stat = lstatOrNull(current);
  if (!stat) {
    fs.mkdirSync(current, { recursive: true });
    stat = fs.lstatSync(current);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Studio workspace paths may not contain symbolic links or non-directory components.');
  for (const segment of segments) {
    current = path.join(current, segment);
    stat = lstatOrNull(current);
    if (!stat) {
      try { fs.mkdirSync(current); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      stat = fs.lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Studio workspace paths may not contain symbolic links or non-directory components.');
  }
}

export function enforceSensitiveAccess(targetPath: string, directory: boolean, dependencies: SensitiveAccessDependencies = {}): void {
  const platform = dependencies.platform || process.platform;
  if (platform !== 'win32') {
    fs.chmodSync(targetPath, directory ? 0o700 : 0o600);
    return;
  }
  const username = String(dependencies.username || os.userInfo().username).trim();
  if (!username) throw new Error('Cannot secure sensitive Studio path: the current Windows user is unknown.');
  const suffix = directory ? '(OI)(CI)F' : 'F';
  const aclCommands: readonly (readonly string[])[] = [
    [targetPath, '/reset'],
    [targetPath, '/inheritance:r'],
    [targetPath, '/grant:r', username + ':' + suffix, '*S-1-5-18:' + suffix, '*S-1-5-32-544:' + suffix]
  ];
  try {
    const run = dependencies.run || ((command: string, commandArgs: readonly string[]): void => { execFileSync(command, commandArgs, { stdio: 'ignore', windowsHide: true }); });
    for (const args of aclCommands) run('icacls', args);
  } catch {
    throw new Error('Cannot secure sensitive Studio path with Windows ACLs: ' + path.basename(targetPath));
  }
}

function ensurePrivateDirectory(paths: StudioPaths, dir: string, dependencies: SensitiveAccessDependencies = {}): void {
  ensureWorkspaceDirectory(paths, dir);
  const info = fs.lstatSync(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Sensitive Studio path must be a real directory: ' + path.basename(dir));
  enforceSensitiveAccess(dir, true, dependencies);
}

function ensurePrivateFile(filePath: string, dependencies: SensitiveAccessDependencies = {}): void {
  const info = fs.lstatSync(filePath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('provider.env must be a real file.');
  enforceSensitiveAccess(filePath, false, dependencies);
}


function writeAtomically(filePath: string, content: string): void {
  const tempPath = filePath + '.tmp-' + process.pid + '-' + createId('write');
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, filePath);
    try {
      const directory = fs.openSync(path.dirname(filePath), fs.constants.O_RDONLY);
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } catch { /* Some filesystems do not expose directory fsync. */ }
  } finally {
    if (descriptor !== null) try { fs.closeSync(descriptor); } catch {}
    try { fs.rmSync(tempPath, { force: true }); } catch {}
  }
}

export function resolveWorkspaceRoot(workspaceRoot: string): string {
  if (!workspaceRoot || !workspaceRoot.trim()) {
    throw new Error('Studio initialization requires a stable workspace root.');
  }
  return path.resolve(workspaceRoot);
}

export function studioPaths(workspaceRoot: string): StudioPaths {
  const root = resolveWorkspaceRoot(workspaceRoot);
  const studioDir = path.join(root, 'daoge-studio');
  return {
    workspaceRoot: root,
    studioDir,
    databasePath: path.join(studioDir, 'studio.db'),
    providerDatabasePath: path.join(studioDir, 'Provider.db'),
    manifestPath: path.join(studioDir, 'studio.json'),
    providerEnvPath: path.join(studioDir, 'provider.env'),
    runtimeDir: path.join(studioDir, 'runtime'),
    daemonLockDatabasePath: path.join(studioDir, 'runtime', 'daemon-lock.sqlite'),
    daemonOwnerRecordPath: path.join(studioDir, 'runtime', 'daemon.lock'),
    runsDir: path.join(studioDir, 'runs'),
    cacheDir: path.join(studioDir, 'cache'),
    evidenceDir: path.join(studioDir, 'evidence'),
    assetRoot: path.join(root, 'daoge-assets'),
    deliveriesRoot: path.join(root, 'daoge-deliveries')
  };
}

export function readStudioManifest(paths: StudioPaths): StudioManifest | null {
  if (!fs.existsSync(paths.manifestPath)) return null;
  const parsed = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8')) as StudioManifest;
  if (parsed.schemaVersion !== STUDIO_MANIFEST_VERSION || !parsed.studioId || !parsed.workspaceRoot) {
    throw new Error('The existing studio.json is not a valid DAOGE Pic vNext Studio manifest.');
  }
  if (path.resolve(parsed.workspaceRoot) !== paths.workspaceRoot) {
    throw new Error('The existing studio.json workspaceRoot does not match the requested workspace root.');
  }
  return parsed;
}

export function ensureGitignore(paths: StudioPaths): void {
  const gitignorePath = path.join(paths.workspaceRoot, '.gitignore');
  const required = ['daoge-studio/Provider.db', 'daoge-studio/Provider.db-*', 'daoge-studio/provider.env', 'daoge-studio/runtime/'];
  const current = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  const entries = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = required.filter((entry) => !entries.has(entry));
  if (!missing.length) return;
  const prefix = current && !current.endsWith('\n') ? current + '\n' : current;
  writeAtomically(gitignorePath, prefix + missing.join('\n') + '\n');
}

export function initializeStudio(options: InitializeStudioOptions): InitializeStudioResult {
  const paths = studioPaths(options.workspaceRoot);
  assertWorkspacePath(paths, paths.providerDatabasePath);
  if (fs.existsSync(paths.providerEnvPath)) assertWorkspacePath(paths, paths.providerEnvPath);
  const existingManifest = readStudioManifest(paths);
  ensureWorkspaceDirectory(paths, paths.workspaceRoot);
  ensurePrivateDirectory(paths, paths.studioDir, options.sensitiveAccess);
  ensurePrivateDirectory(paths, paths.runtimeDir, options.sensitiveAccess);

  let manifest = existingManifest;
  let createdManifest = false;
  if (!manifest) {
    manifest = {
      schemaVersion: STUDIO_MANIFEST_VERSION,
      studioId: createId('studio'),
      workspaceRoot: paths.workspaceRoot,
      createdAt: nowIso()
    };
    writeAtomically(paths.manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    createdManifest = true;
  }

  if (fs.existsSync(paths.providerEnvPath)) ensurePrivateFile(paths.providerEnvPath, options.sensitiveAccess);
  if (options.writeGitignore !== false) ensureGitignore(paths);
  return { paths, manifest, createdManifest };
}

export function ensureAssetBucket(paths: StudioPaths, bucket: AssetBucket): string {
  if (!ASSET_BUCKETS.includes(bucket)) throw new Error('Unsupported asset bucket: ' + bucket);
  const directory = path.join(paths.assetRoot, bucket);
  ensureWorkspaceDirectory(paths, directory);
  return directory;
}

export function ensureRuntimeDirectory(paths: StudioPaths): string {
  ensurePrivateDirectory(paths, paths.runtimeDir);
  return paths.runtimeDir;
}

export function ensureRunDirectory(paths: StudioPaths, runId: string): string {
  if (!runId || !runId.trim()) throw new Error('A run id is required.');
  const directory = path.join(paths.runsDir, runId);
  ensureWorkspaceDirectory(paths, directory);
  return directory;
}

export function ensureCacheDirectory(paths: StudioPaths, name: 'thumbs' | 'previews' | 'staging'): string {
  const directory = path.join(paths.cacheDir, name);
  ensureWorkspaceDirectory(paths, directory);
  return directory;
}

export function ensureDeliveriesDirectory(paths: StudioPaths): string {
  ensureWorkspaceDirectory(paths, paths.deliveriesRoot);
  return paths.deliveriesRoot;
}
