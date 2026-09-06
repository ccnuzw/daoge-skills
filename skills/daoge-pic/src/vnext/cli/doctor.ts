import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { RUNTIME_VERSION } from '../shared/protocol';
import { encodedPowerShellArguments, windowsPowerShellExecutable } from '../shared/windows';
import { enforceSensitiveAccessBatch } from '../studio/workspace';

export type DoctorCheckStatus = 'pass' | 'warning' | 'fail';
export interface DoctorCheck { code: string; status: DoctorCheckStatus; summary: string; remediation?: string; }
export interface DoctorReport {
  ok: boolean;
  runtimeVersion: string;
  platform: NodeJS.Platform;
  architecture: string;
  nodeVersion: string;
  workspaceRoot: string;
  checks: DoctorCheck[];
}

interface WindowsVolumeInfo { driveType: number; fileSystem: string; browserProgId: string | null; }
export interface WorkspaceInspectionDependencies {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  powershellPath?: string;
  execFile?: (command: string, args: readonly string[], options: { timeout: number; maxBuffer: number }) => string;
}

function normalizedPath(value: string, platform: NodeJS.Platform): string {
  const resolved = platform === 'win32' ? path.win32.resolve(value) : path.resolve(value);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInside(candidate: string, parent: string, platform: NodeJS.Platform): boolean {
  const child = normalizedPath(candidate, platform);
  const root = normalizedPath(parent, platform).replace(/[\\/]+$/, '');
  return child === root || child.startsWith(root + (platform === 'win32' ? '\\' : path.sep));
}

function existingAncestor(targetPath: string): string {
  let candidate = path.resolve(targetPath);
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) throw new Error('workspace_parent_missing: No existing workspace ancestor is available.');
    candidate = parent;
  }
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('workspace_reparse_point: Workspace ancestors must be real directories.');
  return candidate;
}

function assertNoExistingReparsePoint(targetPath: string, platform: NodeJS.Platform): void {
  const absolute = path.resolve(targetPath);
  const ancestor = existingAncestor(absolute);
  if (platform === 'win32') {
    let parentCheck = ancestor;
    while (true) {
      const stat = fs.lstatSync(parentCheck);
      if (stat.isSymbolicLink()) throw new Error('workspace_reparse_point: Workspace paths may not contain a symlink or junction.');
      const parent = path.dirname(parentCheck);
      if (parent === parentCheck) break;
      parentCheck = parent;
    }
  }
  let current = ancestor;
  const relative = path.relative(ancestor, absolute);
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('workspace_reparse_point: Workspace paths may not contain a symlink or junction.');
    if (!stat.isDirectory()) throw new Error('workspace_not_directory: Workspace path components must be directories.');
  }
}

export function inspectWindowsVolume(workspaceRoot: string, dependencies: WorkspaceInspectionDependencies = {}): WindowsVolumeInfo {
  const platform = dependencies.platform || process.platform;
  if (platform !== 'win32') throw new Error('windows_volume_unavailable: Windows volume inspection only runs on Windows.');
  const root = path.win32.resolve(workspaceRoot);
  if (root.startsWith('\\\\')) throw new Error('workspace_unc_unsupported: UNC and network-share workspaces are not supported.');
  const encodedRoot = Buffer.from(root, 'utf8').toString('base64');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    "$target = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('" + encodedRoot + "'))",
    "$device = [System.IO.Path]::GetPathRoot($target).TrimEnd('\\')",
    "$escaped = $device.Replace(\"'\", \"''\")",
    "$disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter (\"DeviceID = '\" + $escaped + \"'\") -OperationTimeoutSec 3",
    'if ($null -eq $disk) { throw \"Workspace volume was not found.\" }',
    "$browser = (Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice' -Name ProgId -ErrorAction SilentlyContinue).ProgId",
    '[PSCustomObject]@{ driveType = [int]$disk.DriveType; fileSystem = [string]$disk.FileSystem; browserProgId = if ($browser) { [string]$browser } else { $null } } | ConvertTo-Json -Compress'
  ].join('; ');
  const run = dependencies.execFile || ((command: string, args: readonly string[], options: { timeout: number; maxBuffer: number }): string => execFileSync(command, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], ...options }));
  let output: string;
  try {
    output = run(dependencies.powershellPath || windowsPowerShellExecutable(dependencies.environment), encodedPowerShellArguments(script), { timeout: 5000, maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error('windows_volume_probe_failed: PowerShell/CIM could not inspect the workspace volume.');
  }
  const parsed = JSON.parse(output.trim()) as Partial<WindowsVolumeInfo>;
  if (!Number.isInteger(parsed.driveType) || typeof parsed.fileSystem !== 'string') throw new Error('windows_volume_probe_invalid: PowerShell/CIM returned invalid volume metadata.');
  return { driveType: Number(parsed.driveType), fileSystem: parsed.fileSystem, browserProgId: typeof parsed.browserProgId === 'string' && parsed.browserProgId ? parsed.browserProgId : null };
}

export function inspectWorkspaceSupport(workspaceRoot: string, dependencies: WorkspaceInspectionDependencies = {}): DoctorCheck[] {
  const platform = dependencies.platform || process.platform;
  const environment = dependencies.environment || process.env;
  const root = platform === 'win32' ? path.win32.resolve(workspaceRoot) : path.resolve(workspaceRoot);
  const checks: DoctorCheck[] = [];
  try {
    if (platform === process.platform) assertNoExistingReparsePoint(root, platform);
    checks.push({ code: 'workspace_real_path', status: 'pass', summary: '工作区路径不包含已有 symlink/junction。' });
  } catch (error) {
    checks.push({ code: 'workspace_real_path', status: 'fail', summary: error instanceof Error ? error.message : '工作区路径无效。', remediation: '选择当前用户拥有的真实本地目录。' });
  }
  if (platform === 'win32') {
    const disallowedRoots = [environment.OneDrive, environment.OneDriveCommercial, environment.OneDriveConsumer, environment.ProgramFiles, environment.SystemRoot, environment.WINDIR].filter((value): value is string => Boolean(value));
    if (disallowedRoots.some((candidate) => isInside(root, candidate, 'win32'))) checks.push({ code: 'workspace_managed_root', status: 'fail', summary: '工作区位于同步盘或系统受管目录。', remediation: '迁移到当前用户拥有的本地 NTFS 源码目录。' });
    else checks.push({ code: 'workspace_managed_root', status: 'pass', summary: '工作区不在已知同步盘或系统目录中。' });
    try {
      const volume = inspectWindowsVolume(root, dependencies);
      checks.push({ code: 'workspace_fixed_drive', status: volume.driveType === 3 ? 'pass' : 'fail', summary: volume.driveType === 3 ? '工作区位于本地固定磁盘。' : '工作区不在本地固定磁盘。', remediation: volume.driveType === 3 ? undefined : '使用本地固定磁盘上的工作区。' });
      checks.push({ code: 'workspace_ntfs', status: volume.fileSystem.toUpperCase() === 'NTFS' ? 'pass' : 'fail', summary: '文件系统：' + volume.fileSystem, remediation: volume.fileSystem.toUpperCase() === 'NTFS' ? undefined : '迁移到 NTFS 文件系统。' });
      checks.push({ code: 'browser_association', status: volume.browserProgId ? 'pass' : 'warning', summary: volume.browserProgId ? '已配置默认 HTTP 浏览器。' : '未确认默认 HTTP 浏览器关联。', remediation: volume.browserProgId ? undefined : '在 Windows 默认应用中设置 HTTP/HTTPS 浏览器。' });
    } catch (error) {
      checks.push({ code: 'windows_volume', status: 'fail', summary: error instanceof Error ? error.message : 'Windows volume probe failed.', remediation: '确认系统 Windows PowerShell、CIM/WMI 服务和当前用户权限可用。' });
    }
    if (root.length > 200) checks.push({ code: 'workspace_path_length', status: 'warning', summary: '工作区路径较长，交付目录可能接近旧 Win32 路径限制。', remediation: '尽量选择更短的工作区路径。' });
    else checks.push({ code: 'workspace_path_length', status: 'pass', summary: '工作区路径长度安全。' });
  }
  return checks;
}

export function assertWorkspaceSupported(workspaceRoot: string, dependencies: WorkspaceInspectionDependencies = {}): void {
  const failed = inspectWorkspaceSupport(workspaceRoot, dependencies).filter((check) => check.status === 'fail');
  if (failed.length) throw new Error(failed.map((check) => check.summary).join(' '));
}

function probeAtomicRename(probeRoot: string): void {
  const source = path.join(probeRoot, 'atomic-source');
  const destination = path.join(probeRoot, 'atomic-destination');
  fs.writeFileSync(source, 'daoge-doctor', { flag: 'wx' });
  fs.renameSync(source, destination);
  if (fs.readFileSync(destination, 'utf8') !== 'daoge-doctor') throw new Error('Atomic rename verification failed.');
}

function probeSqliteLock(probeRoot: string): void {
  const DatabaseSync = require('node:sqlite').DatabaseSync as new (databasePath: string) => DatabaseSyncType;
  const databasePath = path.join(probeRoot, 'doctor.sqlite');
  const owner = new DatabaseSync(databasePath);
  const contender = new DatabaseSync(databasePath);
  let blocked = false;
  try {
    owner.exec('PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 50; CREATE TABLE probe (value TEXT); BEGIN EXCLUSIVE; INSERT INTO probe VALUES (\'owner\');');
    contender.exec('PRAGMA busy_timeout = 50;');
    try { contender.exec("INSERT INTO probe VALUES ('contender')"); }
    catch { blocked = true; }
    if (!blocked) throw new Error('SQLite exclusive lock did not block a competing writer.');
    owner.exec('ROLLBACK');
  } finally {
    try { owner.close(); } catch {}
    try { contender.close(); } catch {}
  }
}

export function doctorWorkspace(workspaceRoot: string, dependencies: WorkspaceInspectionDependencies = {}): DoctorReport {
  const platform = dependencies.platform || process.platform;
  const root = platform === 'win32' ? path.win32.resolve(workspaceRoot) : path.resolve(workspaceRoot);
  const checks = inspectWorkspaceSupport(root, dependencies);
  checks.unshift({ code: 'node_runtime', status: 'pass', summary: 'Node.js ' + process.versions.node + ' 满足运行时要求。' });
  checks.push({ code: 'runtime_architecture', status: ['x64', 'arm64'].includes(process.arch) ? 'pass' : 'warning', summary: '运行架构：' + process.arch });
  if (!checks.some((check) => check.status === 'fail')) {
    const probeParent = platform === process.platform ? existingAncestor(root) : os.tmpdir();
    const probeRoot = path.join(probeParent, '.daoge-doctor-' + process.pid + '-' + randomBytes(6).toString('hex'));
    try {
      fs.mkdirSync(probeRoot, { mode: 0o700 });
      probeAtomicRename(probeRoot);
      checks.push({ code: 'atomic_rename', status: 'pass', summary: '创建、写入和原子 rename 正常。' });
      probeSqliteLock(probeRoot);
      checks.push({ code: 'sqlite_locking', status: 'pass', summary: 'SQLite 打开和排他锁正常。' });
      if (platform === process.platform) {
        enforceSensitiveAccessBatch([{ targetPath: probeRoot, directory: true }]);
        checks.push({ code: 'private_acl', status: 'pass', summary: platform === 'win32' ? 'Windows 私有 DACL 应用与复核正常。' : '私有文件权限应用正常。' });
      }
      const sharp = require('sharp') as { versions?: { vips?: string } };
      if (!sharp.versions?.vips) throw new Error('sharp did not expose a libvips runtime.');
      checks.push({ code: 'sharp_runtime', status: 'pass', summary: 'sharp/libvips 原生运行时可加载。' });
    } catch (error) {
      checks.push({ code: 'workspace_runtime_probe', status: 'fail', summary: error instanceof Error ? error.message : '工作区运行探测失败。', remediation: '检查目录权限、安全软件和本机 Node.js 安装。' });
    } finally {
      try { fs.rmSync(probeRoot, { recursive: true, force: true }); } catch {}
    }
  }
  return { ok: !checks.some((check) => check.status === 'fail'), runtimeVersion: RUNTIME_VERSION, platform, architecture: process.arch, nodeVersion: process.versions.node, workspaceRoot: root, checks };
}


export function redactDoctorReport(report: DoctorReport): DoctorReport {
  const sensitive = [report.workspaceRoot, os.homedir(), os.tmpdir()].filter(Boolean).sort((left, right) => right.length - left.length);
  const sanitize = (value: string): string => sensitive.reduce((current, candidate) => current.split(candidate).join('[redacted-path]'), value);
  return {
    ...report,
    workspaceRoot: '[redacted-workspace]',
    checks: report.checks.map((check) => ({ ...check, summary: sanitize(check.summary), ...(check.remediation ? { remediation: sanitize(check.remediation) } : {}) }))
  };
}
export function formatDoctorReport(report: DoctorReport): string {
  const marker: Record<DoctorCheckStatus, string> = { pass: '[通过]', warning: '[警告]', fail: '[失败]' };
  const lines = ['DAOGE Pic ' + report.runtimeVersion + ' 工作区诊断', '工作区：' + report.workspaceRoot];
  for (const check of report.checks) {
    lines.push(marker[check.status] + ' ' + check.code + '：' + check.summary);
    if (check.remediation) lines.push('  处理：' + check.remediation);
  }
  lines.push(report.ok ? '诊断通过：未调用图片 Provider。' : '诊断失败：修复失败项后再初始化 Studio；未调用图片 Provider。');
  return lines.join('\n');
}
