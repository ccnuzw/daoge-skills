import fs from 'node:fs';
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
  providerEnvPath: string;
  runtimeDir: string;
  runsDir: string;
  cacheDir: string;
  evidenceDir: string;
  assetRoot: string;
  deliveriesRoot: string;
}

export interface InitializeStudioOptions {
  workspaceRoot: string;
  providerTemplatePath: string;
  writeGitignore?: boolean;
}

export interface InitializeStudioResult {
  paths: StudioPaths;
  manifest: StudioManifest;
  createdManifest: boolean;
  createdProviderEnv: boolean;
}

function ensureDirectory(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeAtomically(filePath: string, content: string): void {
  const tempPath = filePath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tempPath, content, 'utf8');
  fs.renameSync(tempPath, filePath);
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
    manifestPath: path.join(studioDir, 'studio.json'),
    providerEnvPath: path.join(studioDir, 'provider.env'),
    runtimeDir: path.join(studioDir, 'runtime'),
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
  return parsed;
}

export function ensureGitignore(paths: StudioPaths): void {
  const gitignorePath = path.join(paths.workspaceRoot, '.gitignore');
  const entry = 'daoge-studio/provider.env';
  const current = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  const entries = current.split(/\r?\n/).map((line) => line.trim());
  if (entries.includes(entry)) return;
  const next = current && !current.endsWith('\n') ? current + '\n' + entry + '\n' : current + entry + '\n';
  writeAtomically(gitignorePath, next);
}

export function initializeStudio(options: InitializeStudioOptions): InitializeStudioResult {
  const paths = studioPaths(options.workspaceRoot);
  ensureDirectory(paths.workspaceRoot);
  ensureDirectory(paths.studioDir);

  let manifest = readStudioManifest(paths);
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

  let createdProviderEnv = false;
  if (!fs.existsSync(paths.providerEnvPath)) {
    if (!fs.existsSync(options.providerTemplatePath)) {
      throw new Error('DAOGE Pic is missing the bundled provider.env.example template.');
    }
    fs.copyFileSync(options.providerTemplatePath, paths.providerEnvPath, fs.constants.COPYFILE_EXCL);
    createdProviderEnv = true;
  }

  if (options.writeGitignore !== false) ensureGitignore(paths);
  return { paths, manifest, createdManifest, createdProviderEnv };
}

export function ensureAssetBucket(paths: StudioPaths, bucket: AssetBucket): string {
  if (!ASSET_BUCKETS.includes(bucket)) throw new Error('Unsupported asset bucket: ' + bucket);
  const directory = path.join(paths.assetRoot, bucket);
  ensureDirectory(directory);
  return directory;
}

export function ensureRuntimeDirectory(paths: StudioPaths): string {
  ensureDirectory(paths.runtimeDir);
  return paths.runtimeDir;
}

export function ensureRunDirectory(paths: StudioPaths, runId: string): string {
  if (!runId || !runId.trim()) throw new Error('A run id is required.');
  const directory = path.join(paths.runsDir, runId);
  ensureDirectory(directory);
  return directory;
}

export function ensureCacheDirectory(paths: StudioPaths, name: 'thumbs' | 'previews' | 'staging'): string {
  const directory = path.join(paths.cacheDir, name);
  ensureDirectory(directory);
  return directory;
}

export function ensureDeliveriesDirectory(paths: StudioPaths): string {
  ensureDirectory(paths.deliveriesRoot);
  return paths.deliveriesRoot;
}
