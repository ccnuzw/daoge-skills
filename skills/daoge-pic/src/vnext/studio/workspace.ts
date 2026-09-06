import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createId, nowIso } from '../shared/ids';
import { encodedPowerShellArguments, windowsPowerShellExecutable } from '../shared/windows';

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
  powershellPath?: string;
  run?: (command: string, args: readonly string[], options: { timeout: number; maxBuffer: number }) => unknown;
}

export interface InitializeStudioOptions {
  workspaceRoot: string;
  writeGitignore?: boolean;
  hardenAccess?: boolean;
  sensitiveAccess?: SensitiveAccessDependencies;
}

export interface AttachStudioResult {
  paths: StudioPaths;
  manifest: StudioManifest;
  createdManifest: false;
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

export interface SensitivePathEntry { targetPath: string; directory: boolean; }

function runWindowsAclScript(script: string, dependencies: SensitiveAccessDependencies): void {
  const run = dependencies.run || ((command: string, commandArgs: readonly string[], options: { timeout: number; maxBuffer: number }): string => {
    return execFileSync(command, commandArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...options });
  });
  try {
    const output = run(dependencies.powershellPath || windowsPowerShellExecutable(), encodedPowerShellArguments(script), { timeout: 10000, maxBuffer: 1024 * 1024 });
    if (typeof output === 'string' && output.trim()) {
      const parsed = JSON.parse(output.trim()) as { expected?: unknown; results?: unknown };
      const expected = Array.isArray(parsed.expected) ? parsed.expected.map(String).sort() : [];
      const results = Array.isArray(parsed.results) ? parsed.results as Array<{ protected?: unknown; rules?: unknown }> : [];
      if (expected.length !== 3 || !results.length || results.some((result) => {
        const rules = Array.isArray(result.rules) ? result.rules as Array<{ sid?: unknown; inherited?: unknown; allow?: unknown; fullControl?: unknown }> : [];
        const actual = rules.map((rule) => String(rule.sid || '')).sort();
        return result.protected !== true || rules.length !== 3 || actual.join('|') !== expected.join('|') || rules.some((rule) => rule.inherited !== false || rule.allow !== true || rule.fullControl !== true);
      })) throw new Error('Sensitive Studio ACL verification failed.');
    }
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { signal?: string; killed?: boolean };
    if (failure.code === 'ETIMEDOUT' || failure.killed || failure.signal === 'SIGTERM') throw new Error('windows_acl_timeout: Windows ACL update exceeded 10 seconds. Use a writable local NTFS directory and retry.');
    if (failure.code === 'ENOENT') throw new Error('windows_powershell_missing: System Windows PowerShell is required to secure Studio data.');
    throw new Error('windows_acl_denied: Cannot secure sensitive Studio path with Windows ACLs. Use a writable local NTFS directory and retry.');
  }
}

function windowsAclScript(entries: readonly SensitivePathEntry[]): string {
  const targetJson = Buffer.from(JSON.stringify(entries.map((entry) => ({ encoded: Buffer.from(entry.targetPath, 'utf8').toString('base64'), directory: entry.directory }))), 'utf8').toString('base64');
  return [
    "$ErrorActionPreference = 'Stop'",
    "$targets = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('" + targetJson + "')) | ConvertFrom-Json",
    '$directoryInheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit',
    '$noInheritance = [System.Security.AccessControl.InheritanceFlags]::None',
    '$propagation = [System.Security.AccessControl.PropagationFlags]::None',
    '$rights = [System.Security.AccessControl.FileSystemRights]::FullControl',
    '$allow = [System.Security.AccessControl.AccessControlType]::Allow',
    "$identities = @([System.Security.Principal.WindowsIdentity]::GetCurrent().User, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))",
    '$expected = @($identities | ForEach-Object { $_.Value } | Sort-Object)',
    '$results = @()',
    "foreach ($item in $targets) { $target = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String([string]$item.encoded)); $acl = Get-Acl -LiteralPath $target; $acl.SetAccessRuleProtection($true, $false); @($acl.Access) | ForEach-Object { [void]$acl.RemoveAccessRuleSpecific($_) }; $inheritance = if ([bool]$item.directory) { $directoryInheritance } else { $noInheritance }; foreach ($identity in $identities) { $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, $rights, $inheritance, $propagation, $allow); [void]$acl.AddAccessRule($rule) }; Set-Acl -LiteralPath $target -AclObject $acl; $verify = Get-Acl -LiteralPath $target; $ruleData = @($verify.Access | ForEach-Object { [PSCustomObject]@{ sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; inherited = [bool]$_.IsInherited; allow = $_.AccessControlType -eq $allow; fullControl = ($_.FileSystemRights -band $rights) -eq $rights } }); $results += [PSCustomObject]@{ protected = [bool]$verify.AreAccessRulesProtected; rules = $ruleData } }",
    '[PSCustomObject]@{ expected = @($expected); results = @($results) } | ConvertTo-Json -Compress -Depth 6'
  ].join('; ');
}

export function enforceSensitiveAccessBatch(entries: readonly SensitivePathEntry[], dependencies: SensitiveAccessDependencies = {}): void {
  if (!entries.length) return;
  const platform = dependencies.platform || process.platform;
  if (platform !== 'win32') {
    for (const entry of entries) fs.chmodSync(entry.targetPath, entry.directory ? 0o700 : 0o600);
    return;
  }
  runWindowsAclScript(windowsAclScript(entries), dependencies);
}

export function enforceSensitiveAccess(targetPath: string, directory: boolean, dependencies: SensitiveAccessDependencies = {}): void {
  enforceSensitiveAccessBatch([{ targetPath, directory }], dependencies);
}

export function hardenStudioAccess(paths: StudioPaths, dependencies: SensitiveAccessDependencies = {}): void {
  const sensitive: SensitivePathEntry[] = [];
  for (const [targetPath, directory] of [
    [paths.studioDir, true],
    [paths.runtimeDir, true],
    [paths.manifestPath, false],
    [paths.databasePath, false],
    [paths.databasePath + '-wal', false],
    [paths.databasePath + '-shm', false],
    [paths.providerDatabasePath, false],
    [paths.providerEnvPath, false],
    [paths.daemonLockDatabasePath, false],
    [paths.daemonLockDatabasePath + '-journal', false],
    [paths.daemonOwnerRecordPath, false]
  ] as const) {
    if (fs.existsSync(targetPath)) sensitive.push({ targetPath, directory });
  }
  enforceSensitiveAccessBatch(sensitive, dependencies);
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

export function sameWorkspaceRoot(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
  const canonical = (value: string): string => {
    const absolute = path.resolve(value);
    try { return fs.realpathSync.native(absolute); }
    catch { return absolute; }
  };
  const leftCanonical = canonical(left);
  const rightCanonical = canonical(right);
  return platform === 'win32'
    ? leftCanonical.toLowerCase() === rightCanonical.toLowerCase()
    : leftCanonical === rightCanonical;
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
  if (!sameWorkspaceRoot(parsed.workspaceRoot, paths.workspaceRoot)) {
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
  ensureWorkspaceDirectory(paths, paths.studioDir);
  ensureWorkspaceDirectory(paths, paths.runtimeDir);

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

  if (options.hardenAccess === true) hardenStudioAccess(paths, options.sensitiveAccess);
  if (options.writeGitignore !== false) ensureGitignore(paths);
  return { paths, manifest, createdManifest };
}

export function attachStudio(workspaceRoot: string): AttachStudioResult {
  const paths = studioPaths(workspaceRoot);
  if (!assertWorkspacePath(paths, paths.workspaceRoot, { requireDirectory: true })) throw new Error('Studio workspace root does not exist.');
  if (!assertWorkspacePath(paths, paths.studioDir, { requireDirectory: true })) throw new Error('Studio is not initialized for this workspace.');
  if (!assertWorkspacePath(paths, paths.manifestPath)) throw new Error('Studio manifest is missing.');
  const manifest = readStudioManifest(paths);
  if (!manifest) throw new Error('Studio manifest is missing.');
  if (!assertWorkspacePath(paths, paths.databasePath)) throw new Error('Studio database is missing.');
  return { paths, manifest, createdManifest: false };
}

export function ensureAssetBucket(paths: StudioPaths, bucket: AssetBucket): string {
  if (!ASSET_BUCKETS.includes(bucket)) throw new Error('Unsupported asset bucket: ' + bucket);
  const directory = path.join(paths.assetRoot, bucket);
  ensureWorkspaceDirectory(paths, directory);
  return directory;
}

export function ensureRuntimeDirectory(paths: StudioPaths): string {
  ensureWorkspaceDirectory(paths, paths.runtimeDir);
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
