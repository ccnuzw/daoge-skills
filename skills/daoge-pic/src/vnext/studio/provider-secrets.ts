import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { StudioPaths } from './workspace';
import { hardenStudioAccess } from './workspace';

export type ProviderSecretBackend = 'sqlite-plaintext' | 'macos-keychain' | 'windows-dpapi-file' | 'linux-libsecret';
export type ProviderSecretKind = 'base_url' | 'api_key';

export interface StoredSecretLocation {
  backend: ProviderSecretBackend;
  ref: string;
  valueForPlaintextColumn: string;
}

export interface ProviderSecretStore {
  readonly backend: ProviderSecretBackend;
  store(reference: string, value: string): string;
  read(reference: string): string;
  delete(reference: string): void;
}

class PlaintextSecretStore implements ProviderSecretStore {
  readonly backend = 'sqlite-plaintext' as const;
  store(_reference: string, value: string): string { return value; }
  read(reference: string): string { return reference; }
  delete(_reference: string): void { /* plaintext is deleted by the Provider.db row update */ }
}

/**
 * Every OS secret-store invocation is bounded. Without this a backend that
 * decides to prompt interactively (macOS `security` does exactly that when
 * `-w` is given no value) would hang the daemon forever instead of failing.
 */
const SECRET_COMMAND_TIMEOUT_MS = 15_000;

function commandExists(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true, timeout: 5_000 });
  return result.error === undefined || result.status === 0 || result.status === 1;
}

class MacOsKeychainSecretStore implements ProviderSecretStore {
  readonly backend = 'macos-keychain' as const;
  private readonly service: string;
  constructor(private readonly paths: StudioPaths) {
    const workspaceHash = createHash('sha256').update(paths.workspaceRoot).digest('hex').slice(0, 24);
    this.service = 'daoge-pic-provider-' + workspaceHash;
  }
  store(reference: string, value: string): string {
    // `security` documents trailing `-w` as a TTY prompt, not a pipe read.
    // Run it through macOS `script`, which supplies a pseudo-terminal, and feed
    // the password to that PTY over stdin. The secret never enters argv.
    execFileSync('/usr/bin/script', ['-q', '/dev/null', '/usr/bin/security', 'add-generic-password', '-U', '-s', this.service, '-a', reference, '-w'], { input: value + '\n' + value + '\n', stdio: ['pipe', 'ignore', 'ignore'], timeout: SECRET_COMMAND_TIMEOUT_MS });
    return reference;
  }
  read(reference: string): string {
    return execFileSync('security', ['find-generic-password', '-s', this.service, '-a', reference, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: SECRET_COMMAND_TIMEOUT_MS }).trimEnd();
  }
  delete(reference: string): void {
    const result = spawnSync('security', ['delete-generic-password', '-s', this.service, '-a', reference], { stdio: 'ignore', timeout: SECRET_COMMAND_TIMEOUT_MS });
    if (result.status !== 0 && result.status !== 44) throw result.error || new Error('Keychain secret delete failed.');
  }
}

function powershellExecutable(): string {
  return process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
}

class WindowsDpapiFileSecretStore implements ProviderSecretStore {
  readonly backend = 'windows-dpapi-file' as const;
  private readonly directory: string;
  constructor(private readonly paths: StudioPaths) {
    this.directory = path.join(paths.studioDir, 'provider-secrets');
  }
  private file(reference: string): string {
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(reference)) throw new Error('Invalid Provider secret reference.');
    return path.join(this.directory, createHash('sha256').update(reference).digest('hex') + '.dpapi');
  }
  store(reference: string, value: string): string {
    fs.mkdirSync(this.directory, { recursive: true });
    if (process.platform !== 'win32') fs.chmodSync(this.directory, 0o700);
    hardenStudioAccess(this.paths);
    const script = "$ErrorActionPreference='Stop';$raw=[Console]::In.ReadToEnd();$bytes=[Text.Encoding]::UTF8.GetBytes($raw);$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($protected)";
    const encrypted = execFileSync(powershellExecutable(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { input: value, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024, timeout: SECRET_COMMAND_TIMEOUT_MS }).trim();
    fs.writeFileSync(this.file(reference), encrypted, { mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(this.file(reference), 0o600);
    return reference;
  }
  read(reference: string): string {
    const encrypted = fs.readFileSync(this.file(reference), 'utf8');
    const script = "$ErrorActionPreference='Stop';$raw=[Console]::In.ReadToEnd().Trim();$protected=[Convert]::FromBase64String($raw);$bytes=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Text.Encoding]::UTF8.GetString($bytes)";
    return execFileSync(powershellExecutable(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { input: encrypted, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024, timeout: SECRET_COMMAND_TIMEOUT_MS });
  }
  delete(reference: string): void { fs.rmSync(this.file(reference), { force: true }); }
}

class LinuxLibsecretStore implements ProviderSecretStore {
  readonly backend = 'linux-libsecret' as const;
  constructor(private readonly paths: StudioPaths) {}
  store(reference: string, value: string): string {
    execFileSync('secret-tool', ['store', '--label=DAOGE Pic Provider Secret', 'application', 'daoge-pic', 'workspace', this.paths.workspaceRoot, 'reference', reference], { input: value, stdio: ['pipe', 'ignore', 'ignore'], timeout: SECRET_COMMAND_TIMEOUT_MS });
    return reference;
  }
  read(reference: string): string {
    return execFileSync('secret-tool', ['lookup', 'application', 'daoge-pic', 'workspace', this.paths.workspaceRoot, 'reference', reference], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: SECRET_COMMAND_TIMEOUT_MS }).trimEnd();
  }
  delete(reference: string): void {
    const result = spawnSync('secret-tool', ['clear', 'application', 'daoge-pic', 'workspace', this.paths.workspaceRoot, 'reference', reference], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], timeout: SECRET_COMMAND_TIMEOUT_MS });
    // `secret-tool clear` exits non-zero both when clearing fails and when no
    // matching item exists. Only the latter is safe to treat as success; every
    // other error must throw so provider-store can retain a cleanup ledger row.
    if (result.error || result.signal) throw new Error('Provider secret delete failed.');
    if (result.status === 0) return;
    const stderr = typeof result.stderr === 'string' ? result.stderr : String(result.stderr || '');
    const diagnostic = stderr.trim();
    const notFound = result.status === 1 && /^(?:secret-tool:\s*)?no matching items? found\.?$/i.test(diagnostic);
    if (notFound) return;
    throw new Error('Provider secret delete failed.');
  }
}

/**
 * Plaintext storage is available only as an explicit opt-in. The default is
 * OS-protected storage and fails closed if that backend is unavailable.
 */
type RequestedSecretBackend = 'plaintext' | 'system';

export function providerSecretBackendPolicy(): RequestedSecretBackend {
  const value = String(process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND || '').trim().toLowerCase();
  if (value === 'plaintext' || value === 'sqlite-plaintext' || value === 'sqlite') return 'plaintext';
  return 'system';
}

function systemSecretStoreFor(paths: StudioPaths, backend?: ProviderSecretBackend): ProviderSecretStore {
  if (backend === 'macos-keychain' || (!backend && process.platform === 'darwin')) return new MacOsKeychainSecretStore(paths);
  if (backend === 'windows-dpapi-file' || (!backend && process.platform === 'win32')) return new WindowsDpapiFileSecretStore(paths);
  if (backend === 'linux-libsecret' || (!backend && process.platform === 'linux' && commandExists('secret-tool'))) return new LinuxLibsecretStore(paths);
  throw new Error('Requested Provider secret backend is unavailable on this system.');
}

export function createProviderSecretStore(paths?: StudioPaths, backend?: ProviderSecretBackend): ProviderSecretStore {
  if (backend === 'sqlite-plaintext' || (!backend && providerSecretBackendPolicy() === 'plaintext')) return new PlaintextSecretStore();
  if (!paths) throw new Error('Provider system secret backend requires Studio paths.');
  return systemSecretStoreFor(paths, backend);
}

export function providerSecretReference(profileId: string, kind: ProviderSecretKind, revision?: string): string {
  return profileId + ':' + kind + (revision ? ':' + revision : '');
}

export function storeProviderSecret(store: ProviderSecretStore, profileId: string, kind: ProviderSecretKind, value: string, revision?: string): StoredSecretLocation {
  const reference = providerSecretReference(profileId, kind, revision);
  const stored = store.store(reference, value);
  return { backend: store.backend, ref: store.backend === 'sqlite-plaintext' ? '' : stored, valueForPlaintextColumn: store.backend === 'sqlite-plaintext' ? value : '' };
}
