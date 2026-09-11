import fs from 'node:fs';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createId, nowIso } from '../shared/ids';
import { InvalidCommandError, StudioNotFoundError, VersionConflictError } from '../domain/studio-commands';
import { capabilitiesForProvider, configFromProviderEnv, endpointPolicyWarnings, isProviderId, parseProviderEnv, providerSnapshot, ProviderCapabilities, ProviderEndpointTrustMode, ProviderId, ProviderProfileLimits, ResolvedProviderConfig, SafeProviderStatus } from './provider-config';
import { providerDescriptor, providerEndpointPolicyIssues, referenceEnabledForProvider, safeProviderDescriptors, isProviderEndpointTrustMode, PROVIDER_ADAPTER_VERSION, PROVIDER_DESCRIPTOR_VERSION, SafeProviderDescriptor } from '../providers/descriptors';
import { createProviderSecretStore, ProviderSecretBackend, ProviderSecretStore, storeProviderSecret } from './provider-secrets';
import { StudioPaths } from './workspace';

const PROVIDER_SCHEMA_VERSION = 3;
export type ProviderDatabase = DatabaseSyncType;
type DatabaseSyncConstructor = new (path: string) => ProviderDatabase;
export type SecretUpdate = { action: 'keep' } | { action: 'replace'; value: string } | { action: 'clear' };

export interface ProviderTestEvidence {
  configVersion: number;
  testedAt: string;
  reachable: boolean;
  status: number;
  descriptorVersion: number;
  adapterVersion: string;
  warnings: string[];
}

export interface ProviderProfileImpact {
  wasActive: boolean;
  restartRequired: boolean;
  newRunsBlockedUntilRestart: boolean;
  message: string;
}

export interface SafeProviderProfile {
  id: string;
  name: string;
  providerId: ProviderId;
  providerName: string;
  model: string;
  endpointSummary: string | null;
  endpointTrustMode: ProviderEndpointTrustMode;
  endpointPolicyWarnings: string[];
  apiKeyConfigured: boolean;
  referenceEnabled: boolean;
  capabilities: ProviderCapabilities;
  descriptorVersion: number;
  adapterVersion: string;
  secretBackend: ProviderSecretBackend;
  limits: ProviderProfileLimits;
  lastTest: ProviderTestEvidence | null;
  configVersion: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  impact?: ProviderProfileImpact;
}

interface StoredProfile {
  id: string; name: string; provider_id: string; model: string; base_url: string; api_key: string;
  options_json: string; config_version: number; active: number; created_at: string; updated_at: string;
  secret_backend: string; base_url_secret_ref: string; api_key_secret_ref: string; endpoint_trust_mode: string;
  max_run_items: number | null; max_execution_concurrency: number | null; request_timeout_ms: number | null; max_retry_attempts: number | null;
  last_test_config_version: number | null; last_tested_at: string | null; last_test_status: number | null; last_test_reachable: number | null; last_test_descriptor_version: number | null; last_test_adapter_version: string | null; last_test_warning_json: string | null;
}

const PROFILE_COLUMNS = 'id, name, provider_id, model, base_url, api_key, options_json, config_version, active, created_at, updated_at, secret_backend, base_url_secret_ref, api_key_secret_ref, endpoint_trust_mode, max_run_items, max_execution_concurrency, request_timeout_ms, max_retry_attempts, last_test_config_version, last_tested_at, last_test_status, last_test_reachable, last_test_descriptor_version, last_test_adapter_version, last_test_warning_json';

interface PendingSecretCleanup {
  backend: ProviderSecretBackend;
  references: string[];
}

function pendingSecretCleanup(error: unknown): PendingSecretCleanup | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { providerSecretCleanup?: unknown }).providerSecretCleanup;
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { backend?: unknown; references?: unknown };
  const references = Array.isArray(candidate.references) ? candidate.references.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
  const backendValue = String(candidate.backend || '');
  if (!references.length || !['macos-keychain', 'windows-dpapi-file', 'linux-libsecret'].includes(backendValue)) return null;
  return { backend: backendValue as ProviderSecretBackend, references: [...new Set(references)] };
}

function markPendingSecretCleanup(error: unknown, backendValue: ProviderSecretBackend, references: string[]): Error {
  const target = error instanceof Error ? error : new Error(String(error));
  Object.defineProperty(target, 'providerSecretCleanup', { value: { backend: backendValue, references: [...new Set(references)] }, configurable: true });
  return target;
}

function queuePendingSecretCleanup(db: ProviderDatabase, backendValue: ProviderSecretBackend, references: string[]): void {
  if (backendValue === 'sqlite-plaintext' || !references.length) return;
  try {
    const statement = db.prepare('INSERT OR IGNORE INTO provider_secret_cleanup (backend, reference, created_at) VALUES (?, ?, ?)');
    for (const reference of [...new Set(references)]) statement.run(backendValue, reference, nowIso());
  } catch {
    // The original secret remains protected by the system backend; retry on the next database open.
  }
}

function cleanupExternalReferences(db: ProviderDatabase, store: ProviderSecretStore, references: string[]): void {
  const pending: string[] = [];
  for (const reference of [...new Set(references)].filter(Boolean)) {
    try { store.delete(reference); } catch { pending.push(reference); }
  }
  if (pending.length) queuePendingSecretCleanup(db, store.backend, pending);
}

function reconcilePendingSecretCleanup(db: ProviderDatabase, paths: StudioPaths): void {
  const pending = db.prepare('SELECT backend, reference FROM provider_secret_cleanup ORDER BY created_at').all() as Array<{ backend: string; reference: string }>;
  for (const item of pending) {
    if (!['macos-keychain', 'windows-dpapi-file', 'linux-libsecret'].includes(item.backend)) continue;
    try {
      secretStore(paths, item.backend as ProviderSecretBackend).delete(item.reference);
      db.prepare('DELETE FROM provider_secret_cleanup WHERE backend = ? AND reference = ?').run(item.backend, item.reference);
    } catch {
      // Keep the record until the backend is available and the delete succeeds.
    }
  }
}

function databaseConstructor(): DatabaseSyncConstructor {
  return require('node:sqlite').DatabaseSync as DatabaseSyncConstructor;
}

function endpointSummary(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol + '//' + url.host + (url.pathname && url.pathname !== '/' ? '/…' : '');
  } catch { return null; }
}

function options(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function stringArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]')) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}

function secretStore(paths: StudioPaths | undefined, backend?: ProviderSecretBackend): ProviderSecretStore {
  return createProviderSecretStore(paths, backend);
}

function backend(row: StoredProfile): ProviderSecretBackend {
  if (row.secret_backend === 'macos-keychain' || row.secret_backend === 'windows-dpapi-file' || row.secret_backend === 'linux-libsecret') return row.secret_backend;
  return 'sqlite-plaintext';
}

function readSecret(row: StoredProfile, kind: 'base_url' | 'api_key', paths?: StudioPaths): string {
  const selectedBackend = backend(row);
  if (selectedBackend === 'sqlite-plaintext') return kind === 'base_url' ? row.base_url : row.api_key;
  const reference = kind === 'base_url' ? row.base_url_secret_ref : row.api_key_secret_ref;
  if (!reference) return '';
  if (!paths) throw new Error('Provider secret backend requires Studio paths.');
  return secretStore(paths, selectedBackend).read(reference);
}

function deleteStoredSecrets(db: ProviderDatabase, row: StoredProfile, paths?: StudioPaths): void {
  const selectedBackend = backend(row);
  if (selectedBackend === 'sqlite-plaintext') return;
  if (!paths) throw new Error('Provider secret backend requires Studio paths.');
  const references = [row.base_url_secret_ref, row.api_key_secret_ref].filter(Boolean);
  try {
    cleanupExternalReferences(db, secretStore(paths, selectedBackend), references);
  } catch {
    queuePendingSecretCleanup(db, selectedBackend, references);
  }
}

function limitsFromRow(row: StoredProfile): ProviderProfileLimits {
  return {
    ...(Number.isInteger(row.max_run_items) && Number(row.max_run_items) > 0 ? { maxRunItems: Number(row.max_run_items) } : {}),
    ...(Number.isInteger(row.max_execution_concurrency) && Number(row.max_execution_concurrency) > 0 ? { maxExecutionConcurrency: Number(row.max_execution_concurrency) } : {}),
    ...(Number.isInteger(row.request_timeout_ms) && Number(row.request_timeout_ms) > 0 ? { requestTimeoutMs: Number(row.request_timeout_ms) } : {}),
    ...(Number.isInteger(row.max_retry_attempts) && Number(row.max_retry_attempts) > 0 ? { maxRetryAttempts: Number(row.max_retry_attempts) } : {})
  };
}

function lastTestFromRow(row: StoredProfile): ProviderTestEvidence | null {
  if (!Number.isInteger(row.last_test_config_version) || !row.last_tested_at || !Number.isInteger(row.last_test_status) || !Number.isInteger(row.last_test_descriptor_version) || !row.last_test_adapter_version) return null;
  return {
    configVersion: Number(row.last_test_config_version),
    testedAt: row.last_tested_at,
    reachable: row.last_test_reachable === 1,
    status: Number(row.last_test_status),
    descriptorVersion: Number(row.last_test_descriptor_version),
    adapterVersion: String(row.last_test_adapter_version),
    warnings: stringArray(row.last_test_warning_json)
  };
}

function trustMode(row: StoredProfile): ProviderEndpointTrustMode {
  return isProviderEndpointTrustMode(row.endpoint_trust_mode) ? row.endpoint_trust_mode : providerDescriptor(row.provider_id as ProviderId).endpoint.defaultTrustMode;
}

function safeProfile(row: StoredProfile, paths?: StudioPaths): SafeProviderProfile {
  const providerId = row.provider_id as ProviderId;
  const descriptor = providerDescriptor(providerId);
  const profileOptions = options(row.options_json);
  const referenceEnabled = referenceEnabledForProvider(providerId, profileOptions.referenceEnabled === true);
  const baseUrl = readSecret(row, 'base_url', paths);
  const apiKey = readSecret(row, 'api_key', paths);
  const config: ResolvedProviderConfig = { profileId: row.id, profileName: row.name, configVersion: Number(row.config_version), providerId, model: row.model, baseUrl, apiKey, options: profileOptions, referenceEnabled, endpointTrustMode: trustMode(row), limits: limitsFromRow(row), descriptorVersion: PROVIDER_DESCRIPTOR_VERSION, adapterVersion: PROVIDER_ADAPTER_VERSION };
  return {
    id: row.id,
    name: row.name,
    providerId,
    providerName: descriptor.displayName,
    model: row.model,
    endpointSummary: endpointSummary(baseUrl),
    endpointTrustMode: config.endpointTrustMode,
    endpointPolicyWarnings: endpointPolicyWarnings(config),
    apiKeyConfigured: Boolean(apiKey),
    referenceEnabled,
    capabilities: capabilitiesForProvider(config),
    descriptorVersion: PROVIDER_DESCRIPTOR_VERSION,
    adapterVersion: PROVIDER_ADAPTER_VERSION,
    secretBackend: backend(row),
    limits: config.limits,
    lastTest: lastTestFromRow(row),
    configVersion: Number(row.config_version),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function row(db: ProviderDatabase, id: string): StoredProfile {
  const profile = db.prepare('SELECT ' + PROFILE_COLUMNS + ' FROM provider_profiles WHERE id = ?').get(id) as StoredProfile | undefined;
  if (!profile) throw new StudioNotFoundError('Provider Profile not found: ' + id);
  return profile;
}

function normalizedOptions(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidCommandError('Provider options 必须是 JSON 对象。');
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) throw new InvalidCommandError('Provider option 名称无效。');
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean' && item !== null) throw new InvalidCommandError('Provider options 只允许字符串、数字、布尔值或 null。');
    result[key] = item;
  }
  return result;
}

function validateFields(input: { name: unknown; providerId: unknown; model: unknown; baseUrl: unknown; apiKey: unknown; endpointTrustMode?: unknown }, allowIncomplete = false): { name: string; providerId: ProviderId; model: string; baseUrl: string; apiKey: string; endpointTrustMode: ProviderEndpointTrustMode } {
  const name = String(input.name || '').trim();
  const providerId = String(input.providerId || '').trim();
  const model = String(input.model || '').trim();
  const baseUrl = String(input.baseUrl || '').trim();
  const apiKey = String(input.apiKey || '').trim();
  if (!name || name.length > 100) throw new InvalidCommandError('Profile 名称必须为 1 到 100 个字符。');
  if (!isProviderId(providerId)) throw new InvalidCommandError('不支持该 Provider。');
  const endpointTrustMode = input.endpointTrustMode === undefined || input.endpointTrustMode === null || input.endpointTrustMode === ''
    ? providerDescriptor(providerId).endpoint.defaultTrustMode
    : String(input.endpointTrustMode).trim();
  if (!isProviderEndpointTrustMode(endpointTrustMode)) throw new InvalidCommandError('Provider 端点信任模式无效。');
  if (!model || model.length > 200) throw new InvalidCommandError('Provider model 必须为 1 到 200 个字符。');
  if (baseUrl) {
    let parsed: URL;
    try { parsed = new URL(baseUrl); } catch { throw new InvalidCommandError('Provider Base URL 无效。'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new InvalidCommandError('Provider Base URL 必须使用 HTTP(S) 且不能包含凭据。');
    const endpointErrors = providerEndpointPolicyIssues(providerId, baseUrl, endpointTrustMode).filter((issue) => issue.level === 'error');
    if (endpointErrors.length) throw new InvalidCommandError(endpointErrors[0].message);
  } else if (!allowIncomplete) throw new InvalidCommandError('Provider Base URL 不能为空。');
  if (!apiKey && !allowIncomplete) throw new InvalidCommandError('Provider API Key 不能为空。');
  return { name, providerId, model, baseUrl, apiKey, endpointTrustMode };
}

function integerLimit(raw: unknown, name: string, max: number): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new InvalidCommandError(name + ' 必须是 1 到 ' + max + ' 的整数。');
  return value;
}

function normalizedLimits(raw: unknown, current?: ProviderProfileLimits): ProviderProfileLimits {
  if (raw === undefined) return current ? { ...current } : {};
  if (raw === null) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InvalidCommandError('Provider limits 必须是 JSON 对象。');
  const input = raw as Record<string, unknown>;
  return {
    ...(integerLimit(input.maxRunItems, 'maxRunItems', 1000) ? { maxRunItems: integerLimit(input.maxRunItems, 'maxRunItems', 1000) } : {}),
    ...(integerLimit(input.maxExecutionConcurrency, 'maxExecutionConcurrency', 1000) ? { maxExecutionConcurrency: integerLimit(input.maxExecutionConcurrency, 'maxExecutionConcurrency', 1000) } : {}),
    ...(integerLimit(input.requestTimeoutMs, 'requestTimeoutMs', 10 * 60 * 1000) ? { requestTimeoutMs: integerLimit(input.requestTimeoutMs, 'requestTimeoutMs', 10 * 60 * 1000) } : {}),
    ...(integerLimit(input.maxRetryAttempts, 'maxRetryAttempts', 20) ? { maxRetryAttempts: integerLimit(input.maxRetryAttempts, 'maxRetryAttempts', 20) } : {})
  };
}

function uniqueImportedProfileName(db: ProviderDatabase, providerId: ProviderId, importedAt: string): string {
  const base = 'Imported ' + providerId + ' ' + importedAt.slice(0, 10);
  const matches = db.prepare('SELECT name FROM provider_profiles WHERE substr(name, 1, ?) = ?').all(base.length, base) as Array<{ name: string }>;
  const names = new Set(matches.map((profile) => profile.name));
  if (!names.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = base + ' (' + suffix + ')';
    if (!names.has(candidate)) return candidate;
  }
}

function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function mutation<T>(db: ProviderDatabase, key: string, operation: string, request: unknown, action: () => T): T {
  const normalizedKey = String(key || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalizedKey)) throw new InvalidCommandError('Provider 写入需要有效 idempotency-key。');
  const requestHash = hashRequest(request);
  const previous = db.prepare('SELECT operation, request_hash, response_json FROM provider_receipts WHERE idempotency_key = ?').get(normalizedKey) as { operation: string; request_hash: string; response_json: string } | undefined;
  if (previous) {
    if (previous.operation !== operation || previous.request_hash !== requestHash) throw new VersionConflictError('Idempotency key 已用于不同的 Provider 操作。');
    return JSON.parse(previous.response_json) as T;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.prepare('INSERT INTO provider_receipts (idempotency_key, operation, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)').run(normalizedKey, operation, requestHash, JSON.stringify(result), nowIso());
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    const cleanup = pendingSecretCleanup(error);
    if (cleanup) queuePendingSecretCleanup(db, cleanup.backend, cleanup.references);
    throw error;
  }
}

function addColumnIfMissing(db: ProviderDatabase, table: string, name: string, definition: string): void {
  const rows = db.prepare('PRAGMA table_info(' + table + ')').all() as Array<{ name: string }>;
  if (!rows.some((column) => column.name === name)) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + name + ' ' + definition);
}

function ensureProviderSchema(db: ProviderDatabase): void {
  db.exec('CREATE TABLE IF NOT EXISTS provider_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
  const schema = db.prepare('SELECT MAX(version) AS version FROM provider_schema').get() as { version: number | null };
  if (schema.version !== null && Number(schema.version) > PROVIDER_SCHEMA_VERSION) throw new Error('Provider database schema is newer than this DAOGE Pic runtime supports.');
  db.exec("CREATE TABLE IF NOT EXISTS provider_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, provider_id TEXT NOT NULL CHECK (provider_id IN ('openai-images','gemini-image','gemini-openai-compatible','xai-grok-image')), model TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL, options_json TEXT NOT NULL DEFAULT '{}', config_version INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, secret_backend TEXT NOT NULL DEFAULT 'sqlite-plaintext', base_url_secret_ref TEXT NOT NULL DEFAULT '', api_key_secret_ref TEXT NOT NULL DEFAULT '', endpoint_trust_mode TEXT NOT NULL DEFAULT 'compatible_public', max_run_items INTEGER, max_execution_concurrency INTEGER, request_timeout_ms INTEGER, max_retry_attempts INTEGER, last_test_config_version INTEGER, last_tested_at TEXT, last_test_status INTEGER, last_test_reachable INTEGER, last_test_descriptor_version INTEGER, last_test_adapter_version TEXT, last_test_warning_json TEXT NOT NULL DEFAULT '[]'); CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_profiles_one_active ON provider_profiles(active) WHERE active = 1; CREATE TABLE IF NOT EXISTS provider_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS provider_receipts (idempotency_key TEXT PRIMARY KEY, operation TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS provider_secret_cleanup (backend TEXT NOT NULL, reference TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (backend, reference));");
  addColumnIfMissing(db, 'provider_profiles', 'secret_backend', "TEXT NOT NULL DEFAULT 'sqlite-plaintext'");
  addColumnIfMissing(db, 'provider_profiles', 'base_url_secret_ref', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'provider_profiles', 'api_key_secret_ref', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'provider_profiles', 'endpoint_trust_mode', "TEXT NOT NULL DEFAULT 'compatible_public'");
  addColumnIfMissing(db, 'provider_profiles', 'max_run_items', 'INTEGER');
  addColumnIfMissing(db, 'provider_profiles', 'max_execution_concurrency', 'INTEGER');
  addColumnIfMissing(db, 'provider_profiles', 'request_timeout_ms', 'INTEGER');
  addColumnIfMissing(db, 'provider_profiles', 'max_retry_attempts', 'INTEGER');
  addColumnIfMissing(db, 'provider_profiles', 'last_test_config_version', 'INTEGER');
  addColumnIfMissing(db, 'provider_profiles', 'last_tested_at', 'TEXT');
  addColumnIfMissing(db, 'provider_profiles', 'last_test_status', 'INTEGER');
  addColumnIfMissing(db, 'provider_profiles', 'last_test_reachable', 'INTEGER');
  addColumnIfMissing(db, 'provider_profiles', 'last_test_descriptor_version', 'INTEGER');
  addColumnIfMissing(db, 'provider_profiles', 'last_test_adapter_version', 'TEXT');
  addColumnIfMissing(db, 'provider_profiles', 'last_test_warning_json', "TEXT NOT NULL DEFAULT '[]'");
  const current = db.prepare('SELECT MAX(version) AS version FROM provider_schema').get() as { version: number | null };
  if (current.version === null) db.prepare('INSERT INTO provider_schema (version, applied_at) VALUES (?, ?)').run(1, nowIso());
  if (Number(current.version || 0) < PROVIDER_SCHEMA_VERSION) db.prepare('INSERT OR IGNORE INTO provider_schema (version, applied_at) VALUES (?, ?)').run(PROVIDER_SCHEMA_VERSION, nowIso());
}

export function openProviderDatabase(paths: StudioPaths, options: { attachOnly?: boolean } = {}): ProviderDatabase {
  if (options.attachOnly) {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(paths.providerDatabasePath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Provider.db is missing; configure a Provider before starting a generation worker.');
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Provider.db must be a real file and may not be a symbolic link.');
  } else {
    fs.mkdirSync(paths.studioDir, { recursive: true });
    if (fs.existsSync(paths.providerDatabasePath)) {
      const stat = fs.lstatSync(paths.providerDatabasePath);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Provider.db must be a real file and may not be a symbolic link.');
    }
  }
  const db = new (databaseConstructor())(paths.providerDatabasePath);
  if (process.platform !== 'win32') fs.chmodSync(paths.providerDatabasePath, 0o600);
  try {
    db.exec(options.attachOnly
      ? 'PRAGMA secure_delete = ON; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;'
      : 'PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (options.attachOnly) {
      const journal = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: unknown } | undefined;
      if (String(journal?.journal_mode || '').toLowerCase() !== 'delete') throw new Error('Provider database requires DELETE journal mode before a worker can attach.');
      const schema = db.prepare('SELECT MAX(version) AS version FROM provider_schema').get() as { version: number | null };
      if (Number(schema.version) !== PROVIDER_SCHEMA_VERSION) throw new Error('Provider database requires daemon initialization before a worker can attach.');
      return db;
    }
    ensureProviderSchema(db);
    reconcilePendingSecretCleanup(db, paths);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function closeProviderDatabase(db: ProviderDatabase | null | undefined): void { if (db) db.close(); }

function insertProfile(db: ProviderDatabase, input: { id: string; fields: { name: string; providerId: ProviderId; model: string; baseUrl: string; apiKey: string; endpointTrustMode: ProviderEndpointTrustMode }; options: Record<string, unknown>; active: boolean; limits: ProviderProfileLimits; paths?: StudioPaths; secretBackend?: ProviderSecretBackend; timestamp: string }): SafeProviderProfile {
  const store = secretStore(input.paths, input.secretBackend);
  const references: string[] = [];
  try {
    const baseUrlSecret = storeProviderSecret(store, input.id, 'base_url', input.fields.baseUrl);
    if (baseUrlSecret.ref) references.push(baseUrlSecret.ref);
    const apiKeySecret = storeProviderSecret(store, input.id, 'api_key', input.fields.apiKey);
    if (apiKeySecret.ref) references.push(apiKeySecret.ref);
    db.prepare('INSERT INTO provider_profiles (id, name, provider_id, model, base_url, api_key, options_json, config_version, active, created_at, updated_at, secret_backend, base_url_secret_ref, api_key_secret_ref, endpoint_trust_mode, max_run_items, max_execution_concurrency, request_timeout_ms, max_retry_attempts) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(input.id, input.fields.name, input.fields.providerId, input.fields.model, input.fields.baseUrl ? baseUrlSecret.valueForPlaintextColumn : '', input.fields.apiKey ? apiKeySecret.valueForPlaintextColumn : '', JSON.stringify(input.options), input.active ? 1 : 0, input.timestamp, input.timestamp, store.backend, baseUrlSecret.ref, apiKeySecret.ref, input.fields.endpointTrustMode, input.limits.maxRunItems ?? null, input.limits.maxExecutionConcurrency ?? null, input.limits.requestTimeoutMs ?? null, input.limits.maxRetryAttempts ?? null);
    return safeProfile(row(db, input.id), input.paths);
  } catch (error) {
    if (store.backend !== 'sqlite-plaintext') {
      const pending: string[] = [];
      for (const reference of references) {
        try { store.delete(reference); } catch { pending.push(reference); }
      }
      if (pending.length) throw markPendingSecretCleanup(error, store.backend, pending);
    }
    throw error;
  }
}

export function importLegacyProviderEnvOnce(db: ProviderDatabase, paths: StudioPaths): boolean {
  if (db.prepare("SELECT value FROM provider_metadata WHERE key = 'provider_env_import_v1'").get()) return false;
  let imported = false;
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = Number((db.prepare('SELECT COUNT(*) AS total FROM provider_profiles').get() as { total: number }).total);
    if (!existing && fs.existsSync(paths.providerEnvPath)) {
      const stat = fs.lstatSync(paths.providerEnvPath);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('provider.env migration input must be a real file.');
      const config = configFromProviderEnv(parseProviderEnv(fs.readFileSync(paths.providerEnvPath, 'utf8')));
      if (config) {
        const timestamp = nowIso();
        const fields = validateFields({ name: 'Imported ' + config.providerId, providerId: config.providerId, model: config.model, baseUrl: config.baseUrl, apiKey: config.apiKey, endpointTrustMode: config.endpointTrustMode });
        insertProfile(db, { id: createId('profile'), fields, options: config.options, active: true, limits: {}, paths, timestamp });
        imported = true;
      }
    }
    db.prepare("INSERT INTO provider_metadata (key, value, updated_at) VALUES ('provider_env_import_v1', ?, ?)").run(imported ? 'imported' : 'no_config', nowIso());
    db.exec('COMMIT');
    return imported;
  } catch (error) {
    db.exec('ROLLBACK');
    const cleanup = pendingSecretCleanup(error);
    if (cleanup) queuePendingSecretCleanup(db, cleanup.backend, cleanup.references);
    throw error;
  }
}

export function importProviderEnvProfile(db: ProviderDatabase, paths: StudioPaths, idempotencyKey: string): SafeProviderProfile {
  return mutation(db, idempotencyKey, 'provider.import_env', { source: 'daoge-studio/provider.env' }, () => {
    if (!fs.existsSync(paths.providerEnvPath)) throw new StudioNotFoundError('Workspace provider.env import file not found.');
    const stat = fs.lstatSync(paths.providerEnvPath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new InvalidCommandError('provider.env import input must be a real file.');
    const config = configFromProviderEnv(parseProviderEnv(fs.readFileSync(paths.providerEnvPath, 'utf8')));
    if (!config) throw new InvalidCommandError('provider.env does not select a supported IMAGE_PROVIDER.');
    const timestamp = nowIso();
    const name = uniqueImportedProfileName(db, config.providerId, timestamp);
    const fields = validateFields({ name, providerId: config.providerId, model: config.model, baseUrl: config.baseUrl, apiKey: config.apiKey, endpointTrustMode: config.endpointTrustMode });
    const id = createId('profile');
    const active = !(db.prepare('SELECT 1 FROM provider_profiles WHERE active = 1').get());
    return insertProfile(db, { id, fields, options: config.options, active, limits: {}, paths, timestamp });
  });
}

export function listProviderProfiles(db: ProviderDatabase, paths?: StudioPaths): SafeProviderProfile[] {
  return (db.prepare('SELECT ' + PROFILE_COLUMNS + ' FROM provider_profiles ORDER BY active DESC, updated_at DESC, name').all() as unknown as StoredProfile[]).map((profile) => safeProfile(profile, paths));
}

function configFromStoredProfile(profile: StoredProfile, paths?: StudioPaths): ResolvedProviderConfig | null {
  if (!isProviderId(profile.provider_id)) return null;
  const providerId = profile.provider_id;
  const profileOptions = options(profile.options_json);
  return { profileId: profile.id, profileName: profile.name, configVersion: Number(profile.config_version), providerId, model: profile.model, baseUrl: readSecret(profile, 'base_url', paths), apiKey: readSecret(profile, 'api_key', paths), options: profileOptions, referenceEnabled: referenceEnabledForProvider(providerId, profileOptions.referenceEnabled === true), endpointTrustMode: trustMode(profile), limits: limitsFromRow(profile), descriptorVersion: PROVIDER_DESCRIPTOR_VERSION, adapterVersion: PROVIDER_ADAPTER_VERSION };
}

export function resolveProviderProfileConfig(db: ProviderDatabase, id: string, paths?: StudioPaths): ResolvedProviderConfig {
  const config = configFromStoredProfile(row(db, id), paths);
  if (!config) throw new InvalidCommandError('Provider Profile 类型无效。');
  return config;
}

export function resolveActiveProviderConfig(db: ProviderDatabase, paths?: StudioPaths): ResolvedProviderConfig | null {
  const profile = db.prepare('SELECT ' + PROFILE_COLUMNS + ' FROM provider_profiles WHERE active = 1').get() as StoredProfile | undefined;
  return profile ? configFromStoredProfile(profile, paths) : null;
}

export function providerStatus(db: ProviderDatabase, paths?: StudioPaths): SafeProviderStatus {
  const config = resolveActiveProviderConfig(db, paths);
  if (!config) return { profileId: null, profileName: null, configVersion: null, providerId: null, configured: false, missing: ['active_profile'], model: null, endpoint: null, capabilities: null, descriptorVersion: null, adapterVersion: null, endpointTrustMode: null, endpointPolicyWarnings: [], limits: {} };
  const missing = [...(!config.baseUrl ? ['base_url'] : []), ...(!config.apiKey ? ['api_key'] : []), ...(!config.model ? ['model'] : [])];
  const snapshot = providerSnapshot(config);
  return { profileId: config.profileId, profileName: config.profileName, configVersion: config.configVersion, providerId: config.providerId, configured: !missing.length, missing, model: config.model, endpoint: snapshot.endpoint, capabilities: capabilitiesForProvider(config), descriptorVersion: config.descriptorVersion, adapterVersion: config.adapterVersion, endpointTrustMode: config.endpointTrustMode, endpointPolicyWarnings: endpointPolicyWarnings(config), limits: config.limits };
}

export function providerDescriptorSummaries(): SafeProviderDescriptor[] {
  return safeProviderDescriptors();
}

export function createProviderProfile(db: ProviderDatabase, input: { name: unknown; providerId: unknown; model: unknown; baseUrl: unknown; apiKey: unknown; options?: unknown; active?: boolean; endpointTrustMode?: unknown; limits?: unknown; paths?: StudioPaths; idempotencyKey: string }): SafeProviderProfile {
  const fields = validateFields(input);
  const profileOptions = normalizedOptions(input.options);
  const limits = normalizedLimits(input.limits);
  return mutation(db, input.idempotencyKey, 'provider.create', { ...fields, options: profileOptions, active: input.active === true, limits }, () => {
    const id = createId('profile'); const timestamp = nowIso();
    if (input.active === true) db.prepare('UPDATE provider_profiles SET active = 0, updated_at = ? WHERE active = 1').run(timestamp);
    return insertProfile(db, { id, fields, options: profileOptions, active: input.active === true, limits, paths: input.paths, timestamp });
  });
}

function secret(current: string, update: unknown, label: string): string {
  const value = update && typeof update === 'object' && !Array.isArray(update) ? update as Partial<SecretUpdate> & { value?: unknown } : null;
  if (!value || !['keep', 'replace', 'clear'].includes(String(value.action))) throw new InvalidCommandError(label + ' 更新必须明确 keep、replace 或 clear。');
  if (value.action === 'keep') return current;
  if (value.action === 'clear') return '';
  const replacement = String(value.value || '').trim();
  if (!replacement) throw new InvalidCommandError(label + ' replacement 不能为空。');
  return replacement;
}

export function updateProviderProfile(db: ProviderDatabase, id: string, input: { name?: unknown; providerId?: unknown; model?: unknown; baseUrl?: unknown; apiKey?: unknown; options?: unknown; expectedConfigVersion?: unknown; endpointTrustMode?: unknown; limits?: unknown; paths?: StudioPaths; idempotencyKey: string }): SafeProviderProfile {
  let stagedStore: ProviderSecretStore | null = null;
  const stagedReferences: string[] = [];
  let obsoleteReferences: string[] = [];
  try {
    const profile = mutation(db, input.idempotencyKey, 'provider.update', { id, name: input.name, providerId: input.providerId, model: input.model, baseUrl: input.baseUrl, apiKey: input.apiKey, options: input.options, expectedConfigVersion: input.expectedConfigVersion, endpointTrustMode: input.endpointTrustMode, limits: input.limits }, () => {
      const current = row(db, id);
      const currentBaseUrl = readSecret(current, 'base_url', input.paths);
      const currentApiKey = readSecret(current, 'api_key', input.paths);
      const baseUrl = secret(currentBaseUrl, input.baseUrl, 'Base URL');
      const apiKey = secret(currentApiKey, input.apiKey, 'API Key');
      const fields = validateFields({ name: input.name ?? current.name, providerId: input.providerId ?? current.provider_id, model: input.model ?? current.model, baseUrl, apiKey, endpointTrustMode: input.endpointTrustMode ?? trustMode(current) }, true);
      const profileOptions = input.options === undefined ? options(current.options_json) : normalizedOptions(input.options);
      const limits = normalizedLimits(input.limits, limitsFromRow(current));
      const expected = Number(input.expectedConfigVersion);
      if (!Number.isInteger(expected) || expected !== current.config_version) throw new VersionConflictError('Provider Profile configVersion 已变化，请刷新后重试。');
      const store = secretStore(input.paths, backend(current));
      stagedStore = store;
      obsoleteReferences = [current.base_url_secret_ref, current.api_key_secret_ref].filter(Boolean);
      const revision = 'v' + String(current.config_version + 1) + '-' + createId('secret');
      const baseUrlSecret = fields.baseUrl ? storeProviderSecret(store, id, 'base_url', fields.baseUrl, revision) : { backend: store.backend, ref: '', valueForPlaintextColumn: '' };
      const apiKeySecret = fields.apiKey ? storeProviderSecret(store, id, 'api_key', fields.apiKey, revision) : { backend: store.backend, ref: '', valueForPlaintextColumn: '' };
      if (baseUrlSecret.ref) stagedReferences.push(baseUrlSecret.ref);
      if (apiKeySecret.ref) stagedReferences.push(apiKeySecret.ref);
      const timestamp = nowIso();
      const changed = db.prepare('UPDATE provider_profiles SET name = ?, provider_id = ?, model = ?, base_url = ?, api_key = ?, options_json = ?, config_version = config_version + 1, updated_at = ?, secret_backend = ?, base_url_secret_ref = ?, api_key_secret_ref = ?, endpoint_trust_mode = ?, max_run_items = ?, max_execution_concurrency = ?, request_timeout_ms = ?, max_retry_attempts = ?, last_test_config_version = NULL, last_tested_at = NULL, last_test_status = NULL, last_test_reachable = NULL, last_test_descriptor_version = NULL, last_test_adapter_version = NULL, last_test_warning_json = ? WHERE id = ? AND config_version = ?').run(fields.name, fields.providerId, fields.model, baseUrlSecret.valueForPlaintextColumn, apiKeySecret.valueForPlaintextColumn, JSON.stringify(profileOptions), timestamp, store.backend, baseUrlSecret.ref, apiKeySecret.ref, fields.endpointTrustMode, limits.maxRunItems ?? null, limits.maxExecutionConcurrency ?? null, limits.requestTimeoutMs ?? null, limits.maxRetryAttempts ?? null, '[]', id, expected);
      if (Number(changed.changes) !== 1) throw new VersionConflictError('Provider Profile configVersion 已变化，请刷新后重试。');
      const profile = safeProfile(row(db, id), input.paths);
      if (current.active) profile.impact = { wasActive: true, restartRequired: false, newRunsBlockedUntilRestart: false, message: '活动 Provider Profile 已更新；daemon 将自动热加载，已完成的预检需重新预检后再运行。' };
      return profile;
    });
    const committedStore = stagedStore as ProviderSecretStore | null;
    if (committedStore && committedStore.backend !== 'sqlite-plaintext') {
      cleanupExternalReferences(db, committedStore, obsoleteReferences.filter((reference) => !stagedReferences.includes(reference)));
    }
    return profile;
  } catch (error) {
    const rollbackStore = stagedStore as ProviderSecretStore | null;
    if (rollbackStore && rollbackStore.backend !== 'sqlite-plaintext') cleanupExternalReferences(db, rollbackStore, stagedReferences);
    throw error;
  }
}

export function deleteProviderProfile(db: ProviderDatabase, id: string, idempotencyKey: string, input: { force?: boolean; paths?: StudioPaths } = {}): { deletedId: string; activeProfileId: string | null; impact: ProviderProfileImpact } {
  let deleted: { row: StoredProfile; paths?: StudioPaths } | null = null;
  const result = mutation(db, idempotencyKey, 'provider.delete', { id, force: input.force === true }, () => {
    const current = row(db, id);
    const wasActive = current.active === 1;
    if (wasActive && input.force !== true) throw new InvalidCommandError('删除活动 Provider Profile 需要显式确认 force。');
    if (backend(current) !== 'sqlite-plaintext' && !input.paths) throw new Error('Provider secret backend requires Studio paths.');
    deleted = { row: current, paths: input.paths };
    db.prepare('DELETE FROM provider_profiles WHERE id = ?').run(id);
    const active = db.prepare('SELECT id FROM provider_profiles WHERE active = 1').get() as { id: string } | undefined;
    const impact = { wasActive, restartRequired: false, newRunsBlockedUntilRestart: false, message: wasActive ? '活动 Provider Profile 已删除；请激活其他 Profile，daemon 会自动热加载后续新运行配置。' : 'Provider Profile 已删除；历史运行仍保留脱敏快照。' };
    return { deletedId: id, activeProfileId: active?.id || null, impact };
  });
  const cleanup = deleted as { row: StoredProfile; paths?: StudioPaths } | null;
  if (cleanup) deleteStoredSecrets(db, cleanup.row, cleanup.paths);
  return result;
}

export function copyProviderProfile(db: ProviderDatabase, id: string, input: { name?: unknown; paths?: StudioPaths; idempotencyKey: string }): SafeProviderProfile {
  const requestedName = input.name === undefined ? null : String(input.name).trim();
  return mutation(db, input.idempotencyKey, 'provider.copy', { id, name: requestedName }, () => {
    const current = row(db, id);
    const name = requestedName || current.name + ' Copy';
    if (!name || name.length > 100) throw new InvalidCommandError('Profile 名称必须为 1 到 100 个字符。');
    const timestamp = nowIso(); const nextId = createId('profile');
    const fields = validateFields({ name, providerId: current.provider_id, model: current.model, baseUrl: readSecret(current, 'base_url', input.paths), apiKey: readSecret(current, 'api_key', input.paths), endpointTrustMode: trustMode(current) });
    return insertProfile(db, { id: nextId, fields, options: options(current.options_json), active: false, limits: limitsFromRow(current), paths: input.paths, secretBackend: backend(current), timestamp });
  });
}

export function activateProviderProfile(db: ProviderDatabase, id: string, idempotencyKey: string, input: { paths?: StudioPaths } = {}): SafeProviderProfile {
  return mutation(db, idempotencyKey, 'provider.activate', { id }, () => {
    const current = row(db, id);
    const wasActive = current.active === 1;
    const timestamp = nowIso();
    if (!wasActive) {
      db.prepare('UPDATE provider_profiles SET active = 0, updated_at = ? WHERE active = 1 AND id <> ?').run(timestamp, id);
      db.prepare('UPDATE provider_profiles SET active = 1, updated_at = ? WHERE id = ?').run(timestamp, id);
    }
    const profile = safeProfile(row(db, id), input.paths);
    profile.impact = { wasActive, restartRequired: false, newRunsBlockedUntilRestart: false, message: wasActive ? 'Provider Profile 已是当前活动项；daemon 无需重启。' : '活动 Provider Profile 已切换；daemon 将自动热加载，后续预检和新运行使用该 Profile。' };
    return profile;
  });
}


export function resolveProviderProfileForTest(db: ProviderDatabase, id: string, input: { baseUrl?: unknown; apiKey?: unknown; paths?: StudioPaths }): ResolvedProviderConfig {
  const current = resolveProviderProfileConfig(db, id, input.paths);
  const baseUrl = input.baseUrl === undefined ? current.baseUrl : secret(current.baseUrl, input.baseUrl, 'Base URL');
  const apiKey = input.apiKey === undefined ? current.apiKey : secret(current.apiKey, input.apiKey, 'API Key');
  return { ...current, baseUrl, apiKey };
}

export function recordProviderTestEvidence(db: ProviderDatabase, id: string, evidence: { configVersion: number; reachable: boolean; status: number; warnings?: string[] }): ProviderTestEvidence {
  if (!Number.isInteger(evidence.configVersion) || evidence.configVersion < 1) throw new InvalidCommandError('Provider test evidence configVersion 无效。');
  const timestamp = nowIso();
  const warnings = [...new Set((evidence.warnings || []).map(String).filter(Boolean))].slice(0, 10);
  const changed = db.prepare('UPDATE provider_profiles SET last_test_config_version = ?, last_tested_at = ?, last_test_status = ?, last_test_reachable = ?, last_test_descriptor_version = ?, last_test_adapter_version = ?, last_test_warning_json = ? WHERE id = ? AND config_version = ?').run(evidence.configVersion, timestamp, Number(evidence.status) || 0, evidence.reachable ? 1 : 0, PROVIDER_DESCRIPTOR_VERSION, PROVIDER_ADAPTER_VERSION, JSON.stringify(warnings), id, evidence.configVersion);
  if (Number(changed.changes) !== 1) throw new VersionConflictError('Provider 配置已变化；连接测试结果未写入，请刷新后重新测试。');
  return { configVersion: evidence.configVersion, testedAt: timestamp, reachable: evidence.reachable, status: Number(evidence.status) || 0, descriptorVersion: PROVIDER_DESCRIPTOR_VERSION, adapterVersion: PROVIDER_ADAPTER_VERSION, warnings };
}
