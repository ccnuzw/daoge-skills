import path from 'node:path';

export function windowsPowerShellExecutable(environment: NodeJS.ProcessEnv = process.env): string {
  const configuredRoot = String(environment.SystemRoot || environment.WINDIR || '').trim();
  const windowsRoot = path.win32.isAbsolute(configuredRoot) ? configuredRoot : 'C:\\Windows';
  return path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function encodedPowerShellArguments(script: string): readonly string[] {
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function portablePathSegment(value: string, fallback = 'item', maxCodePoints = 48): string {
  const cleaned = String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '');
  let segment = [...cleaned].slice(0, Math.max(1, maxCodePoints)).join('').replace(/[. ]+$/g, '');
  if (!segment || segment === '.' || segment === '..') segment = fallback;
  if (WINDOWS_RESERVED_SEGMENT.test(segment)) segment = '_' + segment;
  return segment;
}
