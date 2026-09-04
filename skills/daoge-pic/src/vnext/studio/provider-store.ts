import fs from 'node:fs';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createId, nowIso } from '../shared/ids';
import { InvalidCommandError, StudioNotFoundError, VersionConflictError } from '../domain/studio-commands';
import { capabilitiesForProvider, configFromProviderEnv, isProviderId, parseProviderEnv, providerSnapshot, ProviderId, ResolvedProviderConfig, SafeProviderStatus } from './provider-config';
import { enforceSensitiveAccess, StudioPaths } from './workspace';
const PROVIDER_SCHEMA_VERSION = 1;
export type ProviderDatabase = DatabaseSyncType;
type DatabaseSyncConstructor = new (path: string) => ProviderDatabase;
export type SecretUpdate = { action: 'keep' } | { action: 'replace'; value: string } | { action: 'clear' };

export interface SafeProviderProfile {
  id: string;
  name: string;
  providerId: ProviderId;
  model: string;
  endpointSummary: string | null;
  apiKeyConfigured: boolean;
  referenceEnabled: boolean;
  configVersion: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StoredProfile {
  id: string; name: string; provider_id: string; model: string; base_url: string; api_key: string;
  options_json: string; config_version: number; active: number; created_at: string; updated_at: string;
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

function safeProfile(row: StoredProfile): SafeProviderProfile {
  const profileOptions = options(row.options_json);
  return {
    id: row.id,
    name: row.name,
    providerId: row.provider_id as ProviderId,
    model: row.model,
    endpointSummary: endpointSummary(row.base_url),
    apiKeyConfigured: Boolean(row.api_key),
    referenceEnabled: profileOptions.referenceEnabled === true,
    configVersion: Number(row.config_version),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function row(db: ProviderDatabase, id: string): StoredProfile {
  const profile = db.prepare('SELECT id, name, provider_id, model, base_url, api_key, options_json, config_version, active, created_at, updated_at FROM provider_profiles WHERE id = ?').get(id) as StoredProfile | undefined;
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

function validateFields(input: { name: unknown; providerId: unknown; model: unknown; baseUrl: unknown; apiKey: unknown }, allowIncomplete = false): { name: string; providerId: ProviderId; model: string; baseUrl: string; apiKey: string } {
  const name = String(input.name || '').trim();
  const providerId = String(input.providerId || '').trim();
  const model = String(input.model || '').trim();
  const baseUrl = String(input.baseUrl || '').trim();
  const apiKey = String(input.apiKey || '').trim();
  if (!name || name.length > 100) throw new InvalidCommandError('Profile 名称必须为 1 到 100 个字符。');
  if (!isProviderId(providerId)) throw new InvalidCommandError('不支持该 Provider。');
  if (!model || model.length > 200) throw new InvalidCommandError('Provider model 必须为 1 到 200 个字符。');
  if (baseUrl) {
    let parsed: URL;
    try { parsed = new URL(baseUrl); } catch { throw new InvalidCommandError('Provider Base URL 无效。'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new InvalidCommandError('Provider Base URL 必须使用 HTTP(S) 且不能包含凭据。');
  } else if (!allowIncomplete) throw new InvalidCommandError('Provider Base URL 不能为空。');
  if (!apiKey && !allowIncomplete) throw new InvalidCommandError('Provider API Key 不能为空。');
  return { name, providerId, model, baseUrl, apiKey };
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
    throw error;
  }
}

export function openProviderDatabase(paths: StudioPaths): ProviderDatabase {
  fs.mkdirSync(paths.studioDir, { recursive: true });
  if (fs.existsSync(paths.providerDatabasePath)) {
    const stat = fs.lstatSync(paths.providerDatabasePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Provider.db must be a real file and may not be a symbolic link.');
  }
  const db = new (databaseConstructor())(paths.providerDatabasePath);
  try {
    enforceSensitiveAccess(paths.providerDatabasePath, false);
    db.exec("PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS provider_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS provider_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, provider_id TEXT NOT NULL CHECK (provider_id IN ('openai-images','gemini-image','gemini-openai-compatible','xai-grok-image')), model TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL, options_json TEXT NOT NULL DEFAULT '{}', config_version INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_profiles_one_active ON provider_profiles(active) WHERE active = 1; CREATE TABLE IF NOT EXISTS provider_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS provider_receipts (idempotency_key TEXT PRIMARY KEY, operation TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL); INSERT OR IGNORE INTO provider_schema (version, applied_at) VALUES (1, datetime('now')); ");
    const schema = db.prepare('SELECT MAX(version) AS version FROM provider_schema').get() as { version: number | null };
    if (schema.version !== null && Number(schema.version) > PROVIDER_SCHEMA_VERSION) throw new Error('Provider database schema is newer than this DAOGE Pic runtime supports.');
    if (schema.version === null) db.prepare('INSERT INTO provider_schema (version, applied_at) VALUES (?, ?)').run(PROVIDER_SCHEMA_VERSION, nowIso());
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function closeProviderDatabase(db: ProviderDatabase | null | undefined): void { if (db) db.close(); }

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
        db.prepare('INSERT INTO provider_profiles (id, name, provider_id, model, base_url, api_key, options_json, config_version, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)').run(createId('profile'), 'Imported ' + config.providerId, config.providerId, config.model, config.baseUrl, config.apiKey, JSON.stringify({ referenceEnabled: config.referenceEnabled }), timestamp, timestamp);
        imported = true;
      }
    }
    db.prepare("INSERT INTO provider_metadata (key, value, updated_at) VALUES ('provider_env_import_v1', ?, ?)").run(imported ? 'imported' : 'no_config', nowIso());
    db.exec('COMMIT');
    return imported;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
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
    const fields = validateFields({ name, providerId: config.providerId, model: config.model, baseUrl: config.baseUrl, apiKey: config.apiKey });
    const id = createId('profile');
    const active = !(db.prepare('SELECT 1 FROM provider_profiles WHERE active = 1').get());
    db.prepare('INSERT INTO provider_profiles (id, name, provider_id, model, base_url, api_key, options_json, config_version, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)').run(id, fields.name, fields.providerId, fields.model, fields.baseUrl, fields.apiKey, JSON.stringify(config.options), active ? 1 : 0, timestamp, timestamp);
    return safeProfile(row(db, id));
  });
}

export function listProviderProfiles(db: ProviderDatabase): SafeProviderProfile[] {
  return (db.prepare('SELECT id, name, provider_id, model, base_url, api_key, options_json, config_version, active, created_at, updated_at FROM provider_profiles ORDER BY active DESC, updated_at DESC, name').all() as unknown as StoredProfile[]).map(safeProfile);
}

export function resolveActiveProviderConfig(db: ProviderDatabase): ResolvedProviderConfig | null {
  const profile = db.prepare('SELECT id, name, provider_id, model, base_url, api_key, options_json, config_version, active, created_at, updated_at FROM provider_profiles WHERE active = 1').get() as StoredProfile | undefined;
  if (!profile || !isProviderId(profile.provider_id)) return null;
  const profileOptions = options(profile.options_json);
  return { profileId: profile.id, profileName: profile.name, configVersion: Number(profile.config_version), providerId: profile.provider_id, model: profile.model, baseUrl: profile.base_url, apiKey: profile.api_key, options: profileOptions, referenceEnabled: profileOptions.referenceEnabled === true };
}

export function providerStatus(db: ProviderDatabase): SafeProviderStatus {
  const config = resolveActiveProviderConfig(db);
  if (!config) return { profileId: null, profileName: null, configVersion: null, providerId: null, configured: false, missing: ['active_profile'], model: null, endpoint: null, capabilities: null };
  const missing = [...(!config.baseUrl ? ['base_url'] : []), ...(!config.apiKey ? ['api_key'] : []), ...(!config.model ? ['model'] : [])];
  const snapshot = providerSnapshot(config);
  return { profileId: config.profileId, profileName: config.profileName, configVersion: config.configVersion, providerId: config.providerId, configured: !missing.length, missing, model: config.model, endpoint: snapshot.endpoint, capabilities: capabilitiesForProvider(config) };
}

export function createProviderProfile(db: ProviderDatabase, input: { name: unknown; providerId: unknown; model: unknown; baseUrl: unknown; apiKey: unknown; options?: unknown; active?: boolean; idempotencyKey: string }): SafeProviderProfile {
  const fields = validateFields(input);
  const profileOptions = normalizedOptions(input.options);
  return mutation(db, input.idempotencyKey, 'provider.create', { ...fields, options: profileOptions, active: input.active === true }, () => {
    const id = createId('profile'); const timestamp = nowIso();
    if (input.active === true) db.prepare('UPDATE provider_profiles SET active = 0, config_version = config_version + 1, updated_at = ? WHERE active = 1').run(timestamp);
    db.prepare('INSERT INTO provider_profiles (id, name, provider_id, model, base_url, api_key, options_json, config_version, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)').run(id, fields.name, fields.providerId, fields.model, fields.baseUrl, fields.apiKey, JSON.stringify(profileOptions), input.active === true ? 1 : 0, timestamp, timestamp);
    return safeProfile(row(db, id));
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

export function updateProviderProfile(db: ProviderDatabase, id: string, input: { name?: unknown; providerId?: unknown; model?: unknown; baseUrl?: unknown; apiKey?: unknown; options?: unknown; expectedConfigVersion?: unknown; idempotencyKey: string }): SafeProviderProfile {
  return mutation(db, input.idempotencyKey, 'provider.update', { id, name: input.name, providerId: input.providerId, model: input.model, baseUrl: input.baseUrl, apiKey: input.apiKey, options: input.options, expectedConfigVersion: input.expectedConfigVersion }, () => {
    const current = row(db, id);
    const baseUrl = secret(current.base_url, input.baseUrl, 'Base URL');
    const apiKey = secret(current.api_key, input.apiKey, 'API Key');
    const fields = validateFields({ name: input.name ?? current.name, providerId: input.providerId ?? current.provider_id, model: input.model ?? current.model, baseUrl, apiKey }, true);
    const profileOptions = input.options === undefined ? options(current.options_json) : normalizedOptions(input.options);
    const expected = Number(input.expectedConfigVersion);
    if (!Number.isInteger(expected) || expected !== current.config_version) throw new VersionConflictError('Provider Profile configVersion 已变化，请刷新后重试。');
    const timestamp = nowIso();
    const changed = db.prepare('UPDATE provider_profiles SET name = ?, provider_id = ?, model = ?, base_url = ?, api_key = ?, options_json = ?, config_version = config_version + 1, updated_at = ? WHERE id = ? AND config_version = ?').run(fields.name, fields.providerId, fields.model, fields.baseUrl, fields.apiKey, JSON.stringify(profileOptions), timestamp, id, expected);
    if (Number(changed.changes) !== 1) throw new VersionConflictError('Provider Profile configVersion 已变化，请刷新后重试。');
    return safeProfile(row(db, id));
  });
}

export function copyProviderProfile(db: ProviderDatabase, id: string, input: { name?: unknown; idempotencyKey: string }): SafeProviderProfile {
  const current = row(db, id);
  const name = String(input.name || current.name + ' Copy').trim();
  if (!name || name.length > 100) throw new InvalidCommandError('Profile 名称必须为 1 到 100 个字符。');
  return mutation(db, input.idempotencyKey, 'provider.copy', { id, name }, () => {
    const timestamp = nowIso(); const nextId = createId('profile');
    db.prepare('INSERT INTO provider_profiles (id, name, provider_id, model, base_url, api_key, options_json, config_version, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)').run(nextId, name, current.provider_id, current.model, current.base_url, current.api_key, current.options_json, timestamp, timestamp);
    return safeProfile(row(db, nextId));
  });
}

export function activateProviderProfile(db: ProviderDatabase, id: string, idempotencyKey: string): SafeProviderProfile {
  row(db, id);
  return mutation(db, idempotencyKey, 'provider.activate', { id }, () => {
    const timestamp = nowIso();
    db.prepare('UPDATE provider_profiles SET active = 0, config_version = config_version + 1, updated_at = ? WHERE active = 1 AND id <> ?').run(timestamp, id);
    db.prepare('UPDATE provider_profiles SET active = 1, config_version = config_version + CASE WHEN active = 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?').run(timestamp, id);
    return safeProfile(row(db, id));
  });
}

export function deleteProviderProfile(db: ProviderDatabase, id: string, idempotencyKey: string): { deletedId: string; activeProfileId: string | null } {
  return mutation(db, idempotencyKey, 'provider.delete', { id }, () => {
    row(db, id);
    db.prepare('DELETE FROM provider_profiles WHERE id = ?').run(id);
    const active = db.prepare('SELECT id FROM provider_profiles WHERE active = 1').get() as { id: string } | undefined;
    return { deletedId: id, activeProfileId: active?.id || null };
  });
}

export function resolveProviderProfileForTest(db: ProviderDatabase, id: string, input: { baseUrl?: unknown; apiKey?: unknown }): ResolvedProviderConfig {
  const current = row(db, id);
  const baseUrl = input.baseUrl === undefined ? current.base_url : secret(current.base_url, input.baseUrl, 'Base URL');
  const apiKey = input.apiKey === undefined ? current.api_key : secret(current.api_key, input.apiKey, 'API Key');
  const profileOptions = options(current.options_json);
  return { profileId: current.id, profileName: current.name, configVersion: current.config_version, providerId: current.provider_id as ProviderId, model: current.model, baseUrl, apiKey, options: profileOptions, referenceEnabled: profileOptions.referenceEnabled === true };
}
