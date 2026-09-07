import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { encodedPowerShellArguments, windowsPowerShellExecutable } from '../shared/windows';

export type ProcessArgumentsQuery = (pid: number) => readonly string[] | null;

export interface ProcessQueryDependencies {
  platform?: NodeJS.Platform;
  readFile?: (filePath: string) => Buffer;
  execFile?: (command: string, args: readonly string[], options: { timeout: number; maxBuffer: number }) => string;
  powershellPath?: string;
}

function parsePosixCommandLine(commandLine: string): string[] | null {
  const args: string[] = [];
  let value = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let started = false;
  for (const character of commandLine.trim()) {
    if (escaped) { value += character; escaped = false; started = true; continue; }
    if (character === '\\' && quote !== "'") { escaped = true; started = true; continue; }
    if (quote) {
      if (character === quote) quote = null;
      else value += character;
      started = true;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; started = true; continue; }
    if (/\s/.test(character)) {
      if (started) { args.push(value); value = ''; started = false; }
      continue;
    }
    value += character;
    started = true;
  }
  if (escaped || quote) return null;
  if (started) args.push(value);
  return args.length ? args : null;
}

function parseWindowsCommandLine(commandLine: string): string[] | null {
  const args: string[] = [];
  let index = 0;
  while (index < commandLine.length) {
    while (index < commandLine.length && /\s/.test(commandLine[index])) index += 1;
    if (index >= commandLine.length) break;
    let value = '';
    let quoted = false;
    while (index < commandLine.length) {
      let slashes = 0;
      while (commandLine[index] === '\\') { slashes += 1; index += 1; }
      if (commandLine[index] === '"') {
        value += '\\'.repeat(Math.floor(slashes / 2));
        if (slashes % 2) value += '"';
        else quoted = !quoted;
        index += 1;
        continue;
      }
      value += '\\'.repeat(slashes);
      if (index >= commandLine.length || (!quoted && /\s/.test(commandLine[index]))) break;
      value += commandLine[index];
      index += 1;
    }
    args.push(value);
    while (index < commandLine.length && /\s/.test(commandLine[index])) index += 1;
  }
  return args.length ? args : null;
}

export function queryProcessArguments(pid: number, dependencies: ProcessQueryDependencies = {}): readonly string[] | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const platform = dependencies.platform || process.platform;
  const readFile = dependencies.readFile || ((filePath: string): Buffer => fs.readFileSync(filePath));
  const execFile = dependencies.execFile || ((command: string, args: readonly string[], options: { timeout: number; maxBuffer: number }): string => execFileSync(command, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], ...options }));
  try {
    if (platform === 'linux') {
      const fields = readFile('/proc/' + pid + '/cmdline').toString('utf8').split('\0').filter(Boolean);
      return fields.length ? fields : null;
    }
    if (platform === 'darwin') return parsePosixCommandLine(execFile('ps', ['-p', String(pid), '-ww', '-o', 'command='], { timeout: 5000, maxBuffer: 1024 * 1024 }));
    if (platform === 'win32') {
      const script = [
        "$ErrorActionPreference = 'Stop'",
        "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Management')",
        "$searcher = [System.Management.ManagementObjectSearcher]::new('SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + pid + "')",
        '$searcher.Options.Timeout = [TimeSpan]::FromSeconds(5)',
        '$matches = @($searcher.Get())',
        '$searcher.Dispose()',
        "if ($matches.Count -ne 1 -or $null -eq $matches[0]['CommandLine']) { exit 3 }",
        "$commandLine = [string]$matches[0]['CommandLine']",
        '[System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($commandLine))'
      ].join('; ');
      const output = execFile(dependencies.powershellPath || windowsPowerShellExecutable(), encodedPowerShellArguments(script), { timeout: 20000, maxBuffer: 1024 * 1024 }).trim();
      const commandLine = Buffer.from(output, 'base64').toString('utf8');
      return commandLine ? parseWindowsCommandLine(commandLine) : null;
    }
    return null;
  } catch {
    return null;
  }
}

function sameCanonicalPath(actual: string, expected: string): boolean {
  const resolved = (value: string): string => {
    const absolute = path.resolve(value);
    let canonical = absolute;
    try { canonical = fs.realpathSync(absolute); } catch { /* missing paths retain their absolute identity */ }
    return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  };
  return resolved(actual) === resolved(expected);
}

export function matchesDaemonProcess(arguments_: readonly string[], daemonEntry: string, workspaceRoot: string): boolean {
  const entryIndex = arguments_.findIndex((argument) => sameCanonicalPath(argument, daemonEntry));
  const workspaceFlagIndex = arguments_.indexOf('--workspace');
  return entryIndex >= 0
    && workspaceFlagIndex >= 0
    && workspaceFlagIndex + 1 < arguments_.length
    && sameCanonicalPath(arguments_[workspaceFlagIndex + 1], workspaceRoot);
}
