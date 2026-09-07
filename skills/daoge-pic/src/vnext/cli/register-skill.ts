import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createId } from '../shared/ids';

export type SkillRegistrationScope = 'project' | 'user';

export interface RegisterSkillOptions {
  scope: SkillRegistrationScope;
  workspaceRoot?: string;
  sourceRoot?: string;
  homeRoot?: string;
  platform?: NodeJS.Platform;
}

export interface SkillRegistrationResult {
  scope: SkillRegistrationScope;
  source: string;
  destination: string;
  linkType: 'junction' | 'dir';
}


function ensureRealDirectoryTree(rootPath: string, destinationParent: string): void {
  const root = path.resolve(rootPath);
  const rootStat = lstatOrNull(root);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Skill registration root must be an existing real directory.');
  const relative = path.relative(root, destinationParent);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Skill registration destination escapes its root.');
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = lstatOrNull(current);
    if (!stat) fs.mkdirSync(current);
    else if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Skill registration parents must be real directories: ' + current);
  }
}
function lstatOrNull(targetPath: string): fs.Stats | null {
  try { return fs.lstatSync(targetPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function installedSkillRoot(): string {
  return path.resolve(__dirname, '../../..');
}

export function registerSkill(options: RegisterSkillOptions): SkillRegistrationResult {
  const scope = options.scope;
  if (scope !== 'project' && scope !== 'user') throw new Error('Skill registration scope must be project or user.');
  const source = path.resolve(options.sourceRoot || installedSkillRoot());
  const packagePath = path.join(source, 'package.json');
  const skillPath = path.join(source, 'SKILL.md');
  if (!fs.existsSync(skillPath) || !fs.existsSync(packagePath)) throw new Error('Installed daoge-pic package is incomplete; SKILL.md or package.json is missing.');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { name?: unknown };
  if (packageJson.name !== 'daoge-pic') throw new Error('Skill registration source is not the daoge-pic package.');

  let destination: string;
  let registrationRoot: string;
  if (scope === 'project') {
    const workspaceRoot = String(options.workspaceRoot || '').trim();
    if (!workspaceRoot) throw new Error('Project Skill registration requires --workspace.');
    registrationRoot = path.resolve(workspaceRoot);
    destination = path.join(registrationRoot, '.agents', 'skills', 'daoge-pic');
  } else {
    registrationRoot = path.resolve(options.homeRoot || os.homedir());
    destination = path.join(registrationRoot, '.codex', 'skills', 'daoge-pic');
  }
  if (lstatOrNull(destination)) throw new Error('Skill destination already exists: ' + destination);

  const parent = path.dirname(destination);
  ensureRealDirectoryTree(registrationRoot, parent);
  const temporary = path.join(parent, '.daoge-pic-register-' + createId(String(process.pid)));
  const linkType = (options.platform || process.platform) === 'win32' ? 'junction' : 'dir';
  try {
    fs.symlinkSync(source, temporary, linkType);
    if (fs.realpathSync(temporary) !== fs.realpathSync(source)) throw new Error('Created Skill registration does not resolve to the installed package.');
    fs.renameSync(temporary, destination);
  } finally {
    try { if (lstatOrNull(temporary)) fs.unlinkSync(temporary); } catch { /* preserve registration failure */ }
  }
  return { scope, source, destination, linkType };
}
