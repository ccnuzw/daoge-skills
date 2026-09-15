import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { ImageProvider, ImageResult } from '../providers/contracts';
import { sanitizeProviderImageResult, sanitizeProviderMetadata, sanitizeProviderRequestId } from '../providers/response-sanitizer';
import { providerSnapshot, ResolvedProviderConfig } from '../studio/provider-config';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { executeIdempotentAsync } from '../domain/studio-commands';
import { assertRunItemTransition, assertRunTransition, RunItemStatus, RunStatus } from '../domain/states';
import { cleanupProviderResult } from '../media/generated-assets';
import type { GeneratedAssetPersister, PersistedImageResult } from './worker';
import { recordRunItemUsage } from './run-commands';
import { canonicalJson } from '../shared/canonical-json';
import type { SafeErrorDetail } from '../shared/safe-error';
import { joinInStudioSql, selectInStudioSql } from '../domain/studio-scope';

const IMAGE_MEDIA_TYPES: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/webp': true,
  'image/gif': true
};
const RECONCILABLE_RUN_STATUSES: Record<string, true> = {
  queued: true,
  running: true,
  pausing: true,
  paused: true,
  interrupted: true,
  resume_pending: true,
  partial: true,
  failed: true
};
const MAX_RUN_ID_LENGTH = 256;
const MAX_ITEM_ID_LENGTH = 256;
const MAX_EXTERNAL_REQUEST_ID_LENGTH = 128;
const MAX_ASSET_ID_LENGTH = 128;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

type ExternalReconciliationStatus = 'succeeded' | 'outcome_unknown';

export interface ExternalReconciliationOptions {
  db: StudioDatabase;
  studioId: string;
  runId: string;
  itemId: string;
  idempotencyKey: string;
  provider: ImageProvider | null;
  providerConfig: ResolvedProviderConfig | null;
  assetPersister: GeneratedAssetPersister;
  abortSignal?: AbortSignal;
  now?: () => Date;
}

export interface ExternalReconciliationResult {
  runId: string;
  itemId: string;
  status: ExternalReconciliationStatus;
  reason: SafeErrorDetail | null;
  assetId?: string;
}

interface ReconciliationCandidate {
  runId: string;
  itemId: string;
  sequence: number;
  runStatus: RunStatus;
  itemStatus: RunItemStatus;
  requestId: string;
  externalRequestId: string | null;
  leaseToken: string | null;
  leaseWorkerId: string | null;
  leaseExpiresAt: string | null;
  providerSnapshotJson: string;
  providerProfileId: string | null;
  providerConfigVersion: number | null;
  errorJson: string | null;
  resultJson: string | null;
}

interface ReconciliationCompletion {
  status: 'succeeded' | 'state_changed' | 'scope_mismatch';
  assetId?: string;
}

const activeReconciliations = new WeakMap<object, Map<string, Promise<ExternalReconciliationResult>>>();

function safeReason(kind: string, code: string): SafeErrorDetail {
  return { kind, code };
}

function unknownResult(runId: string, itemId: string, reason: SafeErrorDetail): ExternalReconciliationResult {
  return { runId, itemId, status: 'outcome_unknown', reason };
}

function successResult(runId: string, itemId: string, assetId?: string): ExternalReconciliationResult {
  return { runId, itemId, status: 'succeeded', reason: null, ...(assetId ? { assetId } : {}) };
}

function boundedId(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || !SAFE_ID_PATTERN.test(normalized)) return null;
  return normalized;
}

function parseObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}


function loadCandidate(db: StudioDatabase, studioId: string, runId: string, itemId: string): ReconciliationCandidate | null {
  const row = db.prepare(selectInStudioSql('run_item', 'run.id AS run_id, run.status AS run_status, run.provider_snapshot_json, run.provider_profile_id, run.provider_config_version, item.id AS item_id, item.sequence, item.status AS item_status, item.request_id, item.external_request_id, item.lease_token, item.lease_worker_id, item.lease_expires_at, item.error_json, item.result_json') + ' AND item.run_id = ?').get(itemId, studioId, runId) as {
    run_id: string;
    run_status: RunStatus;
    provider_snapshot_json: string;
    provider_profile_id: string | null;
    provider_config_version: number | null;
    item_id: string;
    sequence: number;
    item_status: RunItemStatus;
    request_id: string;
    external_request_id: string | null;
    lease_token: string | null;
    lease_worker_id: string | null;
    lease_expires_at: string | null;
    error_json: string | null;
    result_json: string | null;
  } | undefined;
  if (!row) return null;
  return {
    runId: row.run_id,
    itemId: row.item_id,
    sequence: Number(row.sequence),
    runStatus: row.run_status,
    itemStatus: row.item_status,
    requestId: row.request_id,
    externalRequestId: row.external_request_id,
    leaseToken: row.lease_token,
    leaseWorkerId: row.lease_worker_id,
    leaseExpiresAt: row.lease_expires_at,
    providerSnapshotJson: row.provider_snapshot_json,
    providerProfileId: row.provider_profile_id,
    providerConfigVersion: row.provider_config_version === null ? null : Number(row.provider_config_version),
    errorJson: row.error_json,
    resultJson: row.result_json
  };
}

function storedAssetId(resultJson: string | null): string | undefined {
  const result = parseObject(resultJson);
  const assetId = boundedId(result?.assetId, MAX_ASSET_ID_LENGTH);
  return assetId || undefined;
}

function providerSnapshotMatches(candidate: ReconciliationCandidate, config: ResolvedProviderConfig): boolean {
  try {
    if (!boundedId(config.profileId, MAX_RUN_ID_LENGTH) || !Number.isSafeInteger(config.configVersion) || config.configVersion < 1) return false;
    if (candidate.providerProfileId !== config.profileId || candidate.providerConfigVersion !== config.configVersion) return false;
    const stored = parseObject(candidate.providerSnapshotJson);
    if (!stored) return false;
    return canonicalJson(stored) === canonicalJson(providerSnapshot(config));
  } catch {
    return false;
  }
}

function providerConfigurationReady(provider: ImageProvider | null, config: ResolvedProviderConfig | null): boolean {
  try {
    if (!provider || !config || typeof config !== 'object') return false;
    if (provider.id !== config.providerId) return false;
    if (typeof config.profileId !== 'string' || !config.profileId.trim() || typeof config.baseUrl !== 'string' || !config.baseUrl.trim() || typeof config.apiKey !== 'string' || !config.apiKey.trim() || typeof config.model !== 'string' || !config.model.trim() || !Number.isSafeInteger(config.configVersion) || config.configVersion < 1) return false;
    const validation = provider.validateConfig(config);
    return validation.valid === true;
  } catch {
    return false;
  }
}

function providerSupportsReconciliation(provider: ImageProvider | null, config: ResolvedProviderConfig | null): boolean {
  try {
    return Boolean(provider && config && typeof provider.reconcile === 'function' && provider.capabilities(config).reconciliation === true);
  } catch {
    return false;
  }
}

function persistedAssetMatchesScope(db: StudioDatabase, input: { studioId: string; runId: string; itemId: string; persisted: PersistedImageResult }): boolean {
  const row = db.prepare("SELECT asset.id, relation.metadata_json " + joinInStudioSql('asset', 'JOIN asset_relations relation ON relation.asset_id = asset.id') + " WHERE asset.id = ? AND asset.studio_id = ? AND asset.deleted_at IS NULL AND asset.media_type = ? AND asset.byte_size = ? AND asset.content_hash = ? AND relation.relation_type = 'output_of' AND relation.target_type = 'run_item' AND relation.target_id = ? LIMIT 1").get(input.persisted.assetId, input.studioId, input.persisted.mediaType, input.persisted.byteSize, input.persisted.contentHash, input.itemId) as { id: string; metadata_json: string } | undefined;
  if (!row) return false;
  const metadata = parseObject(row.metadata_json);
  return metadata?.runId === input.runId;
}


function validExternalRequestId(value: unknown, config: ResolvedProviderConfig): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_EXTERNAL_REQUEST_ID_LENGTH) return null;
  const sanitized = sanitizeProviderRequestId(value, { apiKey: config.apiKey, baseUrl: config.baseUrl });
  return sanitized && sanitized === value ? sanitized : null;
}

function timestamp(now: (() => Date) | undefined): string {
  try {
    const value = now?.();
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  } catch {
    // Use a fresh timestamp when an injected clock is invalid.
  }
  return new Date().toISOString();
}

function recordUnknownReason(db: StudioDatabase, input: { studioId: string; runId: string; itemId: string; externalRequestId: string | null; sequence: number; reason: SafeErrorDetail; now?: () => Date }): void {
  try {
    withTransaction(db, () => {
      const current = loadCandidate(db, input.studioId, input.runId, input.itemId);
      if (!current || current.itemStatus !== 'outcome_unknown' || current.externalRequestId !== input.externalRequestId) return;
      const serialized = JSON.stringify(input.reason);
      if (current.errorJson === serialized) return;
      const changed = db.prepare('UPDATE run_items SET error_json = ?, updated_at = ? WHERE id = ? AND run_id = ? AND status = \'outcome_unknown\'').run(serialized, timestamp(input.now), input.itemId, input.runId);
      if (Number(changed.changes) === 1) appendStudioEvent(db, { studioId: input.studioId, entityType: 'run_item', entityId: input.itemId, eventType: 'run_item.external_reconciliation', payload: { runId: input.runId, sequence: input.sequence, status: 'outcome_unknown', reason: input.reason.code || 'reconciliation_pending' } });
    });
  } catch {
    // A reason update is advisory; never turn a safe unresolved result into an unsafe error.
  }
}

function safeMetadata(value: Record<string, unknown> | undefined, config: ResolvedProviderConfig, externalRequestId: string, mediaType: string): Record<string, unknown> {
  const sanitized = sanitizeProviderMetadata(value, { apiKey: config.apiKey, baseUrl: config.baseUrl });
  const result: Record<string, unknown> = {};
  const responseModel = sanitized.responseModel;
  if (typeof responseModel === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(responseModel) && !responseModel.includes('://')) result.responseModel = responseModel;
  const outputFormat = sanitized.outputFormat;
  if (typeof outputFormat === 'string' && Object.hasOwn(IMAGE_MEDIA_TYPES, outputFormat)) result.outputFormat = outputFormat;
  const requestPath = sanitized.requestPath;
  if (typeof requestPath === 'string' && /^\/[A-Za-z0-9._:/-]{1,255}$/.test(requestPath) && !requestPath.includes('://')) result.requestPath = requestPath;
  const responseStatus = sanitized.responseStatus;
  if (Number.isSafeInteger(responseStatus) && Number(responseStatus) >= 100 && Number(responseStatus) <= 599) result.responseStatus = Number(responseStatus);
  const managedReferenceCount = sanitized.managedReferenceCount;
  if (Number.isSafeInteger(managedReferenceCount) && Number(managedReferenceCount) >= 0 && Number(managedReferenceCount) <= 8) result.managedReferenceCount = Number(managedReferenceCount);
  if (typeof sanitized.usedMask === 'boolean') result.usedMask = sanitized.usedMask;
  const providerRequestId = sanitized.providerRequestId;
  if (providerRequestId === externalRequestId) result.providerRequestId = externalRequestId;
  const usage = sanitized.usage;
  if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
    const numericUsage: Record<string, number> = {};
    for (const [key, item] of Object.entries(usage as Record<string, unknown>)) {
      if (/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(key) && typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= Number.MAX_SAFE_INTEGER) numericUsage[key] = item;
    }
    if (Object.keys(numericUsage).length) result.usage = numericUsage;
  }
  if (mediaType && !result.outputFormat) result.outputFormat = mediaType;
  return result;
}

function safeProviderFilePath(value: unknown): string | null {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return null;
  const directory = path.dirname(value);
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('daoge-pic-provider-') || path.basename(value) !== 'result.part') return null;
  try {
    const directoryStat = fs.lstatSync(directory);
    const fileStat = fs.lstatSync(value);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || !fileStat.isFile() || fileStat.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  return value;
}
async function cleanupReconciledProviderResult(result: ImageResult): Promise<void> {
  const filePath = safeProviderFilePath(result.filePath);
  if (!filePath) return;
  await cleanupProviderResult({ ...result, filePath });
}

function sanitizedImageResult(result: ImageResult, config: ResolvedProviderConfig, externalRequestId: string): ImageResult | null {
  try {
    const reportedExternalRequestId = result.externalRequestId;
    if (reportedExternalRequestId !== undefined && sanitizeProviderRequestId(reportedExternalRequestId, { apiKey: config.apiKey, baseUrl: config.baseUrl }) !== externalRequestId) return null;
    const sanitized = sanitizeProviderImageResult(result, { apiKey: config.apiKey, baseUrl: config.baseUrl });
    const hasBytes = Buffer.isBuffer(sanitized.bytes);
    const safeFilePath = safeProviderFilePath(sanitized.filePath);
    const hasFile = safeFilePath !== null;
    if (hasBytes === hasFile || (hasBytes && sanitized.bytes && (sanitized.bytes.length === 0 || sanitized.bytes.length > MAX_IMAGE_BYTES)) || (!hasBytes && !hasFile) || !Object.hasOwn(IMAGE_MEDIA_TYPES, sanitized.mediaType)) return null;
    if (hasFile && sanitized.byteSize !== undefined && (!Number.isSafeInteger(sanitized.byteSize) || sanitized.byteSize < 1 || sanitized.byteSize > MAX_IMAGE_BYTES)) return null;
    return {
      ...(hasBytes ? { bytes: sanitized.bytes } : {}),
      ...(hasFile ? { filePath: safeFilePath, ...(Number.isSafeInteger(sanitized.byteSize) ? { byteSize: sanitized.byteSize } : {}) } : {}),
      mediaType: sanitized.mediaType,
      externalRequestId,
      safeMeta: safeMetadata(sanitized.safeMeta, config, externalRequestId, sanitized.mediaType)
    };
  } catch {
    return null;
  }
}

function normalizedPersistedResult(value: PersistedImageResult): PersistedImageResult | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as PersistedImageResult;
  const assetId = boundedId(result.assetId, MAX_ASSET_ID_LENGTH);
  if (!assetId || !Object.hasOwn(IMAGE_MEDIA_TYPES, result.mediaType) || !Number.isSafeInteger(result.byteSize) || result.byteSize < 1 || result.byteSize > MAX_IMAGE_BYTES || typeof result.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(result.contentHash)) return null;
  return { assetId, mediaType: result.mediaType, byteSize: result.byteSize, contentHash: result.contentHash };
}

function settleReconciledRunInTransaction(db: StudioDatabase, input: { studioId: string; runId: string; now?: () => Date }): void {
  const run = db.prepare(selectInStudioSql('generation_run', 'run.id, run.status, run.version')).get(input.runId, input.studioId) as { id: string; status: RunStatus; version: number } | undefined;
  if (!run || !Object.hasOwn(RECONCILABLE_RUN_STATUSES, run.status)) return;
  const items = db.prepare('SELECT status FROM run_items WHERE run_id = ? ORDER BY sequence').all(input.runId) as Array<{ status: RunItemStatus }>;
  if (!items.length || items.some((item) => item.status !== 'succeeded')) return;
  const nextStatus: RunStatus = run.status === 'pausing' ? 'paused' : 'completed';
  try {
    assertRunTransition(run.status, nextStatus);
  } catch {
    return;
  }
  const settledAt = timestamp(input.now);
  const changed = nextStatus === 'paused'
    ? db.prepare('UPDATE generation_runs SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = ? AND version = ?').run(nextStatus, settledAt, run.id, run.status, run.version)
    : db.prepare('UPDATE generation_runs SET status = ?, completed_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = ? AND version = ?').run(nextStatus, settledAt, settledAt, run.id, run.status, run.version);
  if (Number(changed.changes) === 1) appendStudioEvent(db, { studioId: input.studioId, entityType: 'generation_run', entityId: run.id, eventType: 'run.' + nextStatus, payload: { succeeded: items.length, total: items.length, reconciled: true } });
}

function completeReconciledItem(db: StudioDatabase, input: { studioId: string; runId: string; itemId: string; externalRequestId: string; providerConfig: ResolvedProviderConfig; persisted: PersistedImageResult; result: Record<string, unknown>; now?: () => Date }): ReconciliationCompletion {
  return withTransaction(db, () => {
    const current = loadCandidate(db, input.studioId, input.runId, input.itemId);
    if (!current) return { status: 'scope_mismatch' };
    if (current.itemStatus === 'succeeded') return { status: 'succeeded', assetId: storedAssetId(current.resultJson) };
    if (current.itemStatus !== 'outcome_unknown' || current.externalRequestId !== input.externalRequestId || current.leaseToken !== null || current.leaseWorkerId !== null || current.leaseExpiresAt !== null) return { status: 'state_changed' };
    if (!Object.hasOwn(RECONCILABLE_RUN_STATUSES, current.runStatus) || !providerSnapshotMatches(current, input.providerConfig)) return { status: 'state_changed' };
    if (!persistedAssetMatchesScope(db, { studioId: input.studioId, runId: input.runId, itemId: input.itemId, persisted: input.persisted })) return { status: 'scope_mismatch' };
    assertRunItemTransition(current.itemStatus, 'succeeded');
    const resultJson = JSON.stringify(input.result);
    const changed = db.prepare('UPDATE run_items SET status = \'succeeded\', retry_at = NULL, error_json = NULL, result_json = ?, updated_at = ? WHERE id = ? AND run_id = ? AND status = \'outcome_unknown\' AND external_request_id = ? AND lease_token IS NULL AND lease_worker_id IS NULL AND lease_expires_at IS NULL').run(resultJson, timestamp(input.now), input.itemId, input.runId, input.externalRequestId);
    if (Number(changed.changes) !== 1) {
      const raced = loadCandidate(db, input.studioId, input.runId, input.itemId);
      return raced?.itemStatus === 'succeeded' ? { status: 'succeeded', assetId: storedAssetId(raced.resultJson) } : { status: 'state_changed' };
    }
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'run_item', entityId: input.itemId, eventType: 'run_item.succeeded', payload: { runId: input.runId, sequence: current.sequence, reconciled: true } });
    settleReconciledRunInTransaction(db, { studioId: input.studioId, runId: input.runId, now: input.now });
    return { status: 'succeeded', assetId: String(input.result.assetId) };
  });
}

async function reconcileExternalRunItemUnlocked(options: ExternalReconciliationOptions): Promise<ExternalReconciliationResult> {
  const studioId = boundedId(options.studioId, MAX_RUN_ID_LENGTH) || '';
  const runId = boundedId(options.runId, MAX_RUN_ID_LENGTH) || '';
  const itemId = boundedId(options.itemId, MAX_ITEM_ID_LENGTH) || '';
  if (!studioId || !runId || !itemId) return unknownResult(runId, itemId, safeReason('invalid_request', 'reconciliation_identity_invalid'));
  const candidate = loadCandidate(options.db, studioId, runId, itemId);
  if (!candidate) return unknownResult(runId, itemId, safeReason('scope', 'run_item_scope_mismatch'));
  if (candidate.itemStatus === 'succeeded') return successResult(runId, itemId, storedAssetId(candidate.resultJson));
  if (candidate.itemStatus !== 'outcome_unknown') return unknownResult(runId, itemId, safeReason('invalid_state', 'run_item_not_outcome_unknown'));
  recordRunItemUsage(options.db, { studioId, runItemId: itemId, requestId: candidate.requestId, billingState: 'possibly_billed' });
  const stayUnknown = (reason: SafeErrorDetail): ExternalReconciliationResult => {
    recordUnknownReason(options.db, { studioId, runId, itemId, externalRequestId: candidate.externalRequestId, sequence: candidate.sequence, reason, now: options.now });
    return unknownResult(runId, itemId, reason);
  };
  const provider = options.provider;
  const providerConfig = options.providerConfig;
  if (!provider || !providerConfig || !providerConfigurationReady(provider, providerConfig)) return stayUnknown(safeReason('invalid_config', 'provider_configuration_invalid'));
  const externalRequestId = validExternalRequestId(candidate.externalRequestId, providerConfig);
  if (!externalRequestId) return stayUnknown(safeReason('invalid_request', 'external_request_id_invalid_or_missing'));
  if (candidate.leaseToken !== null || candidate.leaseWorkerId !== null || candidate.leaseExpiresAt !== null) return stayUnknown(safeReason('invalid_state', 'run_item_lease_mismatch'));
  if (!Object.hasOwn(RECONCILABLE_RUN_STATUSES, candidate.runStatus)) return stayUnknown(safeReason('invalid_state', 'generation_run_state_not_reconcilable'));
  if (!providerSnapshotMatches(candidate, providerConfig)) return stayUnknown(safeReason('invalid_config', 'provider_snapshot_mismatch'));
  if (!providerSupportsReconciliation(provider, providerConfig)) return stayUnknown(safeReason('unsupported', 'provider_reconciliation_unsupported'));

  let providerResult: ImageResult | null = null;
  try {
    const reconcile = provider.reconcile;
    if (typeof reconcile !== 'function') return stayUnknown(safeReason('unsupported', 'provider_reconciliation_unsupported'));
    providerResult = await reconcile.call(provider, externalRequestId, { abortSignal: options.abortSignal || new AbortController().signal });
    if (providerResult === null) return stayUnknown(safeReason('unknown_outcome', 'provider_result_pending'));
    const safeResult = sanitizedImageResult(providerResult, providerConfig, externalRequestId);
    if (!safeResult) return stayUnknown(safeReason('invalid_response', 'provider_reconcile_result_invalid'));
    let persisted: PersistedImageResult | null = null;
    try {
      persisted = normalizedPersistedResult(await options.assetPersister.persistGeneratedImage({ runId, itemId, result: safeResult }));
    } catch {
      persisted = null;
    }
    if (!persisted) return stayUnknown(safeReason('persistence', 'local_persistence_failed'));
    if (!persistedAssetMatchesScope(options.db, { studioId, runId, itemId, persisted })) return stayUnknown(safeReason('persistence', 'persisted_asset_scope_mismatch'));
    const result = {
      assetId: persisted.assetId,
      mediaType: persisted.mediaType,
      byteSize: persisted.byteSize,
      contentHash: persisted.contentHash,
      externalRequestId,
      safeMeta: safeResult.safeMeta || {}
    };
    let completion: ReconciliationCompletion;
    try {
      completion = completeReconciledItem(options.db, { studioId, runId, itemId, externalRequestId, providerConfig, persisted, result, now: options.now });
    } catch {
      return stayUnknown(safeReason('persistence', 'reconciliation_commit_failed'));
    }
    if (completion.status === 'scope_mismatch') return unknownResult(runId, itemId, safeReason('scope', 'run_item_scope_mismatch'));
    if (completion.status !== 'succeeded') return stayUnknown(safeReason('invalid_state', 'run_item_changed_during_reconciliation'));
    return successResult(runId, itemId, completion.assetId || persisted.assetId);
  } catch {
    return stayUnknown(safeReason('unknown_outcome', 'provider_reconcile_failed'));
  } finally {
    if (providerResult) await cleanupReconciledProviderResult(providerResult).catch(() => undefined);
  }
}

export async function reconcileExternalRunItem(options: ExternalReconciliationOptions): Promise<ExternalReconciliationResult> {
  const studioId = boundedId(options.studioId, MAX_RUN_ID_LENGTH) || '';
  const runId = boundedId(options.runId, MAX_RUN_ID_LENGTH) || '';
  const itemId = boundedId(options.itemId, MAX_ITEM_ID_LENGTH) || '';
  const idempotencyKey = boundedId(options.idempotencyKey, MAX_RUN_ID_LENGTH) || '';
  if (!studioId || !runId || !itemId || !idempotencyKey) return unknownResult(runId, itemId, safeReason('invalid_request', 'reconciliation_identity_invalid'));
  try {
    if (!options.db.prepare('SELECT id FROM studios WHERE id = ?').get(studioId)) return unknownResult(runId, itemId, safeReason('scope', 'studio_scope_mismatch'));
  } catch {
    return unknownResult(runId, itemId, safeReason('scope', 'studio_scope_mismatch'));
  }
  const key = JSON.stringify([studioId, runId, itemId]);
  const operations = activeReconciliations.get(options.db as unknown as object) || new Map<string, Promise<ExternalReconciliationResult>>();
  activeReconciliations.set(options.db as unknown as object, operations);
  const pending = operations.get(key);
  if (pending) await pending;
  const operation = executeIdempotentAsync(options.db, studioId, idempotencyKey, 'runs.reconcile_external', () => reconcileExternalRunItemUnlocked({ ...options, studioId, runId, itemId, idempotencyKey }), { runId, itemId }).then((receipt) => receipt.value);
  operations.set(key, operation);
  try {
    return await operation;
  } finally {
    if (operations.get(key) === operation) operations.delete(key);
  }
}
