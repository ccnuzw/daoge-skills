import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import http, { IncomingMessage, OutgoingHttpHeaders, Server, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { Readable } from 'node:stream';
import { closeStudioDatabase, openStudioDatabase, StudioDatabase, STUDIO_SCHEMA_VERSION, studioSchemaVersion, subscribeStudioEvents, withTransaction } from '../studio/database';
import { hardenStudioAccess, ensureCacheDirectory, initializeStudio, InitializeStudioResult } from '../studio/workspace';
import { isProviderId, providerSnapshot, ResolvedProviderConfig } from '../studio/provider-config';
import { activateProviderProfile, closeProviderDatabase, copyProviderProfile, createProviderProfile, deleteProviderProfile, importLegacyProviderEnvOnce, importProviderEnvProfile, listProviderProfiles, openProviderDatabase, ProviderDatabase, providerDescriptorSummaries, providerStatus, recordProviderTestEvidence, resolveActiveProviderConfig, resolveProviderProfileConfig, resolveProviderProfileForTest, updateProviderProfile } from '../studio/provider-store';
import { isProviderEndpointTrustMode, providerDescriptor, PROVIDER_ADAPTER_VERSION, PROVIDER_DESCRIPTOR_VERSION, referenceEnabledForProvider } from '../providers/descriptors';
import { createImageProvider, requestEndpointFor } from '../providers/http-adapters';
import type { ImageProvider } from '../providers/contracts';
import { probeHttpEndpoint } from '../providers/http-safety';
import { archiveProject, createProject, createRoundDraft, createTaskDraft, confirmRoundPlan, executeIdempotent, executeIdempotentAsync, getRound, getStudioSession, getTask, InvalidCommandError, listRoundPlanVersions, openOrAttachStudioSession, prepareRoundForConfirmation, StudioNotFoundError, updateRoundDraftContext, updateStudioSessionContext, VersionConflictError } from '../domain/studio-commands';
import { cancelGenerationRun, createDryRunPreview, getDryRunPreview, getGenerationRun, listDryRunPreviews, pauseGenerationRun, preflightRound, queueGenerationRun, resolveUnknownRunItems, resumeGenerationRun, retryGenerationRunItems } from '../runner/run-commands';
import { StateTransitionError } from '../domain/states';
import { AssetKind, AssetScope, countScopedStudioAssets, countStudioAssets, createAssetSnapshotAsync, getAssetImpact, getStudioAsset, importStagedStudioAssetAsync, listScopedStudioAssets, listScopedStudioAssetsByIds, listSharedStudioAssets, listStudioAssets, restoreAsset, setReviewDecision, setReviewDecisions, setStudioAssetShared, softDeleteAsset, StudioAsset } from '../domain/assets';
import { inspectProjectAssetAccess, projectAssetReferenceAllowed } from '../domain/asset-access';
import { getQualityMetrics } from '../domain/quality-metrics';
import { createBrandKit, createStyleKit, createUserTaskType, listBrandKits, listStyleKits, listTaskTypes } from '../domain/libraries';
import { getLatestRun, listProjects, listRounds, listRunItemsForQuery, listRuns, listTasks, searchStudio } from '../domain/queries';
import { listProjectTemplates } from '../domain/project-templates';
import { archiveConfirmedTemplate, getConfirmedTemplate, listConfirmedTemplates, rollbackConfirmedTemplate, saveConfirmedTemplate, type ConfirmedTemplateType, type SaveConfirmedTemplateInput } from '../domain/confirmed-templates';
import { configureBudget, getBudgetPolicy } from '../usage/budget';
import { listUsageLedger, summarizeUsage, type UsageAttribution, type UsageEstimate } from '../usage/ledger';
import { completeDeliveryStepAsync, createDelivery, DeliveryCompletionPhase, DeliveryCompletionResult, DeliveryExportResult, exportDeliveryAsync, getDelivery, listDeliveries, openDeliveryExportFileAsync, prepareDelivery, returnDeliveryToDraft, updateDeliveryDraft } from '../domain/deliveries';
import { createDeliveryBatch, getDeliveryBatch, listDeliveryBatches, prepareDeliveryBatchVersion, reviseDeliveryBatch } from '../domain/delivery-batches';
import { getAssetProvenance, getRoundCreativeRecord, getTaskCreativeOverview, getTaskStudioOverview, listAssetsWithReviewSummaries } from '../domain/creative-records';
import { getPersistedStudioProvenance } from '../provenance/studio';
import { listProjectSelectionAssets, setProjectAssetSelected, setProjectAssetsSelected } from '../domain/project-selections';
import { getCanvasLayout, saveCanvasLayout, CanvasLayoutScopeType } from '../domain/canvas-layouts';
import { recoverStudioStartupAsync } from '../runner/startup-recovery';
import { studioEventWindow } from './events';
import { discardStagedImage, MediaArchiveError, MediaValidationError, openVerifiedManagedFileAsync, stageImageStream, VerifiedManagedFile } from '../media/archive';
import { StudioGeneratedAssetPersister } from '../media/generated-assets';
import { reconcileExternalRunItem } from '../runner/external-reconciliation';
import { thumbnailEtag } from '../media/thumbnails';
import { MediaJobResult, MediaProcessPool, MediaSource, MediaZipEntry } from '../runtime/media-worker-pool';
import { daemonRestartAvailable, daemonShutdownAvailable, requestDaemonRestart, requestDaemonShutdown } from '../runtime/restart';
import type { ProviderConcurrencySnapshot } from '../runtime/provider-concurrency';
import type { ProcessPoolHealth } from '../runtime/worker-pool';
import { assertJsonContentType, assertLocalHost, assertLocalWriteOrigin, authenticateLocalRequest, constantTimeTokenEqual, createLocalCapability, imageUploadMediaType, LocalAccessError, localSessionCookie, localSessionCookieName, LocalAuthentication } from './local-auth';
import { ConfirmationGate, canonicalValue, planHash } from './confirmation-gate';
import { isSupportedProtocolVersion, protocolStatus, RUNTIME_VERSION, SKILL_PROTOCOL_NAME, SUPPORTED_PROTOCOL_RANGE } from '../shared/protocol';
import { WorkbenchPresence } from '../runtime/workbench-presence';
import { createBackupManifest, snapshotBackupFile, type BackupManifest, type BackupManifestEntryInput } from '../backup/manifest';
import { createRestoreDryRun } from '../backup/restore';
import { buildUpgradeRollbackPoint, evaluateUpgradeCompatibility } from '../backup/upgrade';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_IMAGE_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_IMAGE_COUNT = 100;
const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;
const MAX_BATCH_IDS = 500;
/** Upper bound for one backup manifest request. Media hashing no longer holds the write lock, so this only bounds response time. */
const MAX_BACKUP_MANIFEST_ASSETS = 5000;
/** Page size for asset enumeration; `listStudioAssets` clamps every page to this many rows. */
const ASSET_PAGE_SIZE = 500;

type JsonBody = Record<string, unknown>;

function workspaceRelativePath(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new InvalidCommandError('当前 Studio 路径无法安全纳入 backup manifest。');
  return relative.split(path.sep).join('/');
}

function backupReceiptRequest(body: JsonBody, rootFields: readonly string[] = []): JsonBody {
  const safe = { ...body };
  for (const field of rootFields) {
    if (typeof safe[field] === 'string') safe[field] = createHash('sha256').update(safe[field] as string, 'utf8').digest('hex');
  }
  return safe;
}

function backupError(message: string): InvalidCommandError {
  return new InvalidCommandError(message);
}

function safeControlledAssetPath(root: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw backupError('当前 Studio 没有可安全生成 backup manifest。');
  const absolute = path.resolve(root, value);
  const relative = workspaceRelativePath(root, absolute);
  if (!relative.startsWith('daoge-assets/')) throw backupError('当前 Studio 没有可安全生成 backup manifest。');
  return relative;
}
interface BackupDeliveryExportFile {
  path: string;
  contentHash: string;
  byteSize: number;
}

function assertBackupNoSymlinkHierarchy(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw backupError('Backup manifest 交付路径无法安全管理。');
  let current = root;
  const rootStat = (() => {
    try { return fs.lstatSync(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw backupError('Backup manifest 交付路径缺失。');
      throw backupError('Backup manifest 无法读取交付路径。');
    }
  })();
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw backupError('Backup manifest 交付路径不安全。');
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw backupError('Backup manifest 已导出交付文件缺失。');
      throw backupError('Backup manifest 无法读取已导出交付文件。');
    }
    if (stat.isSymbolicLink()) throw backupError('Backup manifest 拒绝包含符号链接交付文件。');
  }
}

function safeDeliveryExportDirectory(paths: InitializeStudioResult['paths'], value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.includes('\\') || path.isAbsolute(value)) throw backupError('Backup manifest 已导出交付目录无效。');
  const segments = value.split('/');
  if (segments.length < 2 || segments[0] !== 'daoge-deliveries' || segments.some((segment) => !segment || segment === '.' || segment === '..')) throw backupError('Backup manifest 已导出交付目录无效。');
  const directory = path.resolve(paths.workspaceRoot, ...segments);
  const deliveriesRoot = path.resolve(paths.deliveriesRoot);
  const withinRoot = path.relative(deliveriesRoot, directory);
  if (!withinRoot || withinRoot === '..' || withinRoot.startsWith('..' + path.sep) || path.isAbsolute(withinRoot)) throw backupError('Backup manifest 已导出交付目录超出受管目录。');
  const relative = workspaceRelativePath(paths.workspaceRoot, directory);
  if (relative !== segments.join('/')) throw backupError('Backup manifest 已导出交付目录无效。');
  assertBackupNoSymlinkHierarchy(paths.workspaceRoot, directory);
  let stat: fs.Stats;
  try { stat = fs.lstatSync(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw backupError('Backup manifest 已导出交付目录缺失。');
    throw backupError('Backup manifest 无法读取已导出交付目录。');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw backupError('Backup manifest 已导出交付目录无效。');
  return relative;
}

function safeDeliveryExportFileName(value: unknown): string {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || Buffer.byteLength(value, 'utf8') > 255) throw backupError('Backup manifest 已导出交付文件名无效。');
  return value;
}

function exportedDeliveryBackupEntries(db: StudioDatabase, paths: InitializeStudioResult['paths'], studioId: string, seenPaths: Set<string>): { entries: BackupManifestEntryInput[]; identities: BackupDeliveryExportFile[] } {
  const rows = db.prepare("SELECT delivery.id, delivery.manifest_json FROM deliveries delivery JOIN projects project ON project.id = delivery.project_id WHERE project.studio_id = ? AND delivery.status = 'exported' ORDER BY delivery.id").all(studioId) as Array<{ id: string; manifest_json: string }>;
  const entries: BackupManifestEntryInput[] = [];
  const identities: BackupDeliveryExportFile[] = [];
  for (const row of rows) {
    let manifest: Record<string, unknown>;
    try {
      const parsed = JSON.parse(row.manifest_json) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
      manifest = parsed as Record<string, unknown>;
    } catch {
      throw backupError('Backup manifest 已导出交付清单无效。');
    }
    const directory = safeDeliveryExportDirectory(paths, manifest.exportDirectory);
    // `exportFiles` is the current frozen-file shape. Deliveries exported by earlier runtimes recorded the same
    // evidence as `files`, keyed `file` instead of `name` and without a byte size. Both are accepted because the
    // content hash -- the actual integrity anchor -- is present in each; otherwise one legacy delivery would make
    // every backup manifest request fail for the whole Studio.
    const frozenFiles = Array.isArray(manifest.exportFiles) ? manifest.exportFiles : Array.isArray(manifest.files) ? manifest.files : null;
    if (!frozenFiles || !frozenFiles.length) throw backupError('Backup manifest 已导出交付冻结文件清单无效。');
    const names = new Set<string>();
    for (const item of frozenFiles) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw backupError('Backup manifest 已导出交付冻结文件身份无效。');
      const file = item as Record<string, unknown>;
      const name = safeDeliveryExportFileName(file.name === undefined ? file.file : file.name);
      if (names.has(name)) throw backupError('Backup manifest 已导出交付冻结文件重复。');
      names.add(name);
      const contentHash = typeof file.contentHash === 'string' ? file.contentHash : '';
      const recordedSize = file.byteSize;
      if (!/^[a-f0-9]{64}$/.test(contentHash)) throw backupError('Backup manifest 已导出交付冻结文件身份无效。');
      if (recordedSize !== undefined && (!Number.isSafeInteger(recordedSize) || Number(recordedSize) < 0)) throw backupError('Backup manifest 已导出交付冻结文件身份无效。');
      const relativePath = directory + '/' + name;
      if (seenPaths.has(relativePath)) throw backupError('Backup manifest 已导出交付路径重复。');
      seenPaths.add(relativePath);
      const absolutePath = path.join(paths.workspaceRoot, ...relativePath.split('/'));
      assertBackupNoSymlinkHierarchy(paths.workspaceRoot, absolutePath);
      let stat: fs.Stats;
      try { stat = fs.lstatSync(absolutePath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw backupError('Backup manifest 已导出交付文件缺失。');
        throw backupError('Backup manifest 无法读取已导出交付文件。');
      }
      if (stat.isSymbolicLink() || !stat.isFile()) throw backupError('Backup manifest 拒绝包含非普通交付文件。');
      // A recorded size is authoritative; a legacy record has none, so the file on disk defines the expectation
      // while the frozen content hash still has to match what is actually hashed.
      const byteSize = recordedSize === undefined ? stat.size : Number(recordedSize);
      entries.push({ path: relativePath, category: 'media', required: true });
      identities.push({ path: relativePath, contentHash, byteSize });
    }
  }
  return { entries, identities };
}

function assertDeliveryBackupIdentities(manifest: BackupManifest, identities: readonly BackupDeliveryExportFile[]): void {
  const actual = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  for (const expected of identities) {
    const entry = actual.get(expected.path);
    if (!entry || entry.required !== true || entry.byteSize !== expected.byteSize || entry.sha256 !== expected.contentHash) throw backupError('Backup manifest 已导出交付文件身份与冻结记录不一致。');
  }
}

function assertBackupWalEmpty(databasePath: string): void {
  const walPath = databasePath + '-wal';
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(walPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw backupError('Backup manifest 无法确认 studio.db WAL 状态；为避免返回不完整数据库已拒绝。');
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size !== 0) throw backupError('Backup manifest 拒绝返回：studio.db WAL 未清空。');
}

function checkpointBackupDatabase(db: StudioDatabase, databasePath: string): void {
  try {
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy?: unknown; log?: unknown } | undefined;
    const busy = Number(checkpoint?.busy);
    const log = Number(checkpoint?.log);
    if (!checkpoint || !Number.isInteger(busy) || !Number.isInteger(log) || busy !== 0 || log !== 0) throw backupError('Backup manifest 无法完成 studio.db WAL checkpoint；为避免返回不完整数据库已拒绝。');
  } catch (error) {
    if (error instanceof InvalidCommandError) throw error;
    throw backupError('Backup manifest 无法完成 studio.db WAL checkpoint；为避免返回不完整数据库已拒绝。');
  }
  assertBackupWalEmpty(databasePath);
}

function withBackupManifestLock<T>(db: StudioDatabase, databasePath: string, inventory: () => T): T {
  checkpointBackupDatabase(db, databasePath);
  try {
    db.exec('BEGIN IMMEDIATE');
  } catch {
    throw backupError('Backup manifest 无法锁定 studio.db；为避免返回不完整数据库已拒绝。');
  }
  try {
    // A writer may have committed between the checkpoint and BEGIN IMMEDIATE. Recheck
    // while the write lock is held so the database file cannot be paired with a WAL.
    assertBackupWalEmpty(databasePath);
    const result = inventory();
    try {
      db.exec('COMMIT');
    } catch {
      try { db.exec('ROLLBACK'); } catch { /* best effort: the response remains fail-closed */ }
      throw backupError('Backup manifest 无法提交一致性锁；已拒绝返回。');
    }
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* best effort: the response remains fail-closed */ }
    if (error instanceof InvalidCommandError) throw error;
    throw backupError('Backup manifest inventory 无法安全读取；已拒绝返回。');
  }
}
/**
 * Hashes one workspace file for a manifest entry outside any database lock. An absent file stays absent so
 * `createBackupManifest` keeps applying the entry's own required/optional rule.
 */
function observedBackupEntry(workspaceRoot: string, relativePath: string): { snapshot?: { byteSize: number; sha256: string } } {
  const snapshot = snapshotBackupFile(workspaceRoot, relativePath);
  return snapshot ? { snapshot } : {};
}

function normalizeBackupInputError(operation: string, error: unknown): never {
  if (error instanceof InvalidCommandError) throw error;
  throw backupError(operation + ' 输入无法安全处理。');
}


function boundedIds(value: unknown, label: string, options: { optional?: boolean; max?: number } = {}): string[] | undefined {
  if (value === undefined && options.optional) return undefined;
  if (!Array.isArray(value)) throw new InvalidCommandError(label + ' 必须是字符串数组。');
  const max = options.max || MAX_BATCH_IDS;
  if (value.length > max) throw new InvalidCommandError(label + ' 不能超过 ' + max + ' 项。');
  const ids = value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  if (ids.length !== value.length) throw new InvalidCommandError(label + ' 只能包含非空字符串。');
  return [...new Set(ids)];
}

export interface StudioServiceOptions {
  workspaceRoot: string;
  hardenAccess?: boolean;
  initialized?: InitializeStudioResult;
  sessionToken?: string;
  ssePollMs?: number;
  workbenchDir?: string;
  capability?: string;
  workbenchPresence?: WorkbenchPresence;
  providerProbe?: typeof probeHttpEndpoint;
  mediaWorkerPool?: MediaProcessPool;
}

export interface StartedStudioService {
  url: string;
  service: LocalStudioService;
  access: {
    bearerToken: string;
    workbenchUrl: string;
    cookieName: string;
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function success(response: ServerResponse, body: unknown): void {
  json(response, 200, { ok: true, data: body });
}

function idempotencyKey(request: IncomingMessage, body: JsonBody): string {
  const explicit = headerValue(request, 'idempotency-key') || text(body.idempotencyKey);
  const operationName = headerValue(request, 'x-daoge-operation-name');
  if (explicit && operationName) throw new InvalidCommandError('idempotency-key 与 operation-name 不能同时使用。');
  if (explicit) return explicit;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(operationName)) throw new InvalidCommandError('写入操作需要 idempotency-key 或安全的 operation-name。');
  return 'operation:' + createHash('sha256').update(request.method || 'POST').update('\0').update(request.url || '/').update('\0').update(operationName).update('\0').update(canonicalValue(body)).digest('hex');
}

async function readBody(request: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new InvalidCommandError('请求内容超过 1 MB 限制。');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('not object');
    return parsed as JsonBody;
  } catch {
    throw new InvalidCommandError('请求必须是 JSON 对象。');
  }
}

function headerValue(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function decodedHeaderText(request: IncomingMessage, name: string, label: string): string {
  const value = headerValue(request, name);
  if (!value) return '';
  try { return decodeURIComponent(value).trim(); }
  catch { throw new InvalidCommandError(label + ' 不是合法的 URI 编码文本。'); }
}

function importMaterialUsage(value: unknown): string | undefined {
  const usage = text(value);
  if (!usage) return undefined;
  if (!DERIVED_REFERENCE_USAGES.has(usage)) throw new InvalidCommandError('不支持该素材用途。');
  return usage;
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function assertProtocolCompatibility(request: IncomingMessage, requireHeader = false): void {
  const protocol = headerValue(request, 'x-daoge-skill-protocol');
  if (!protocol) {
    if (requireHeader) throw new InvalidCommandError('Skill 请求必须声明 daoge-pic-skill-protocol 版本。');
    return;
  }
  const prefix = SKILL_PROTOCOL_NAME + '/';
  const version = protocol.startsWith(prefix) ? protocol.slice(prefix.length) : '';
  if (!isSupportedProtocolVersion(version)) throw new InvalidCommandError('Skill 协议不兼容；daemon 支持 ' + SUPPORTED_PROTOCOL_RANGE + '。');
}

function numberValue(value: unknown): number {
  return Number(value);
}

function imageExtension(mediaType: string): string { return mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : mediaType === 'image/gif' ? 'gif' : 'png'; }
function archiveTimestamp(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function archiveFilename(label: string, timestamp = archiveTimestamp()): string {
  const safeLabel = String(label || '').normalize('NFKC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[.\- ]+|[.\- ]+$/g, '').slice(0, 100) || 'daoge-pic';
  return safeLabel + '-' + timestamp + '.zip';
}

function archiveContentDisposition(filename: string, fallback: string): string {
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  return 'attachment; filename="' + fallback + '"; filename*=UTF-8\'\'' + encoded;
}


function assetScope(value: string | null): AssetScope | null {
  if (!value) return null;
  if (value === 'round' || value === 'task' || value === 'project' || value === 'studio') return value;
  throw new InvalidCommandError('Unknown asset scope.');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new InvalidCommandError(label + ' 必须是非负安全整数。');
  return value;
}

function assertAllowedBodyKeys(body: JsonBody, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(body)) if (!allowedSet.has(key)) throw new InvalidCommandError(label + ' 请求体包含不支持的字段：' + key + '。');
}

function optionalQueryText(parsed: URL, name: string): string | undefined {
  const value = text(parsed.searchParams.get(name));
  return value || undefined;
}

function usageAttributionFromQuery(studioId: string, parsed: URL): UsageAttribution {
  return {
    studioId,
    profileId: optionalQueryText(parsed, 'profileId'),
    projectId: optionalQueryText(parsed, 'projectId'),
    taskId: optionalQueryText(parsed, 'taskId'),
    roundId: optionalQueryText(parsed, 'roundId'),
    runId: optionalQueryText(parsed, 'runId'),
    runItemId: optionalQueryText(parsed, 'runItemId')
  };
}

function usageLimitFromQuery(parsed: URL): number | undefined {
  const value = optionalQueryText(parsed, 'limit');
  return value === undefined ? undefined : numberValue(value);
}

function draftProviderConfig(input: Record<string, unknown>): ResolvedProviderConfig {
  const providerId = text(input.providerId);
  if (!isProviderId(providerId)) throw new InvalidCommandError('Provider 类型无效。');
  const descriptor = providerDescriptor(providerId);
  const endpointTrustMode = text(input.endpointTrustMode) || descriptor.endpoint.defaultTrustMode;
  if (!isProviderEndpointTrustMode(endpointTrustMode)) throw new InvalidCommandError('Provider 端点信任模式无效。');
  const options = record(input.options);
  return {
    profileId: 'draft-profile',
    profileName: 'Draft Provider Profile',
    configVersion: 0,
    providerId,
    model: text(input.model) || descriptor.modelExamples[0] || 'model-list-probe',
    baseUrl: text(input.baseUrl),
    apiKey: text(input.apiKey),
    options,
    referenceEnabled: referenceEnabledForProvider(providerId, options.referenceEnabled === true),
    endpointTrustMode,
    limits: {},
    descriptorVersion: PROVIDER_DESCRIPTOR_VERSION,
    adapterVersion: PROVIDER_ADAPTER_VERSION
  };
}

function providerModelConfigFromProfile(current: ResolvedProviderConfig, input: Record<string, unknown>): ResolvedProviderConfig {
  const providerIdInput = text(input.providerId);
  const providerId = providerIdInput ? providerIdInput : current.providerId;
  if (!isProviderId(providerId)) throw new InvalidCommandError('Provider 类型无效。');
  const descriptor = providerDescriptor(providerId);
  const endpointTrustModeInput = text(input.endpointTrustMode);
  const endpointTrustMode = endpointTrustModeInput || (providerId === current.providerId ? current.endpointTrustMode : descriptor.endpoint.defaultTrustMode);
  if (!isProviderEndpointTrustMode(endpointTrustMode)) throw new InvalidCommandError('Provider 端点信任模式无效。');
  const options = input.options === undefined ? current.options : record(input.options);
  return {
    ...current,
    providerId,
    model: text(input.model) || (providerId === current.providerId ? current.model : descriptor.modelExamples[0]) || descriptor.modelExamples[0] || 'model-list-probe',
    baseUrl: input.baseUrl === undefined ? current.baseUrl : text(input.baseUrl),
    apiKey: input.apiKey === undefined ? current.apiKey : text(input.apiKey),
    options,
    referenceEnabled: referenceEnabledForProvider(providerId, options.referenceEnabled === true),
    endpointTrustMode,
    descriptorVersion: PROVIDER_DESCRIPTOR_VERSION,
    adapterVersion: PROVIDER_ADAPTER_VERSION
  };
}

async function listProviderModelsForConfig(config: ResolvedProviderConfig): Promise<{ models: unknown[] }> {
  const provider = createImageProvider(config);
  if (!provider.listModels) throw new InvalidCommandError('该 Provider adapter 不支持模型列表。');
  const validation = provider.validateConfig(config);
  if (!validation.valid) throw new InvalidCommandError('Provider 配置无效：' + [...validation.missing, ...(validation.errors || [])].join(', '));
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
  try {
    return { models: await provider.listModels({ abortSignal: controller.signal }) };
  } catch (error) {
    const classified = provider.classifyError(error);
    if (timedOut || classified.kind === 'transient' || classified.kind === 'rate_limited') throw new InvalidCommandError('暂时无法读取 Provider 模型列表。请检查网络、限流状态后重试。');
    if (classified.kind === 'permission') throw new InvalidCommandError('读取 Provider 模型列表未通过鉴权。请检查 API Key 权限。');
    throw new InvalidCommandError('无法读取 Provider 模型列表。请检查 Base URL 与 Provider 类型。');
  } finally { clearTimeout(timeout); }
}

const DERIVED_REFERENCE_USAGES = new Set(['subject', 'style', 'composition', 'color', 'brand', 'mask', 'negative']);
const DERIVED_PURPOSES = new Set(['variation', 'refinement', 'edit', 'fill']);

function boundedTextList(value: unknown, label: string, max = 16): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new InvalidCommandError(label + ' 必须是字符串数组。');
  if (value.length > max) throw new InvalidCommandError(label + ' 不能超过 ' + max + ' 项。');
  const values = value.map((item) => text(item)).filter(Boolean);
  return [...new Set(values)];
}

function derivedReferenceUsage(value: unknown, fallback: string): string {
  const usage = text(value);
  if (DERIVED_REFERENCE_USAGES.has(usage)) return usage;
  return DERIVED_REFERENCE_USAGES.has(fallback) ? fallback : 'subject';
}

function derivedDefaultReferenceUsage(purpose: string): string {
  if (purpose === 'fill') return 'composition';
  return 'subject';
}

function compactJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === '') continue;
    if (Array.isArray(item) && item.length === 0) continue;
    if (typeof item === 'object' && !Array.isArray(item) && Object.keys(item as Record<string, unknown>).length === 0) continue;
    result[key] = item;
  }
  return result;
}

function derivedReferenceMaterials(body: JsonBody, sourceAssetIds: string[], defaultUsage: string): Array<Record<string, unknown>> {
  const materials = new Map<string, Record<string, unknown>>();
  const explicit = Array.isArray(body.referenceMaterials) ? body.referenceMaterials : [];
  if (explicit.length > MAX_BATCH_IDS) throw new InvalidCommandError('referenceMaterials 不能超过 ' + MAX_BATCH_IDS + ' 项。');
  for (const item of explicit) {
    const material = record(item);
    const assetId = text(material.assetId);
    if (!assetId) throw new InvalidCommandError('referenceMaterials 只能包含带 assetId 的对象。');
    materials.set(assetId, compactJsonRecord({ assetId, usage: derivedReferenceUsage(material.usage, defaultUsage), note: text(material.note) }));
  }
  for (const assetId of sourceAssetIds) if (!materials.has(assetId)) materials.set(assetId, { assetId, usage: defaultUsage });
  return [...materials.values()];
}

function derivedPrimaryAssetId(body: JsonBody, sourceAssetIds: string[]): string {
  const primaryAssetId = text(body.primaryAssetId);
  if (!primaryAssetId) return sourceAssetIds[0] || '';
  if (!sourceAssetIds.includes(primaryAssetId)) throw new InvalidCommandError('primaryAssetId 必须来自 sourceAssetIds。');
  return primaryAssetId;
}

function derivedParentAssetIds(body: JsonBody, sourceAssetIds: string[]): string[] {
  if (body.parentAssetIds === undefined) return sourceAssetIds;
  if (!Array.isArray(body.parentAssetIds)) throw new InvalidCommandError('parentAssetIds 必须是字符串数组。');
  if (body.parentAssetIds.length > MAX_BATCH_IDS) throw new InvalidCommandError('parentAssetIds 不能超过 ' + MAX_BATCH_IDS + ' 项。');
  const parentAssetIds = [...new Set(body.parentAssetIds.map((item) => text(item)).filter(Boolean))];
  for (const assetId of parentAssetIds) if (!sourceAssetIds.includes(assetId)) throw new InvalidCommandError('parentAssetIds 必须来自 sourceAssetIds。');
  return parentAssetIds.length ? parentAssetIds : sourceAssetIds;
}

function derivedReferenceUsageCounts(materials: Array<Record<string, unknown>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const material of materials) {
    const usage = text(material.usage) || 'subject';
    counts[usage] = (counts[usage] || 0) + 1;
  }
  return counts;
}

function derivedReferenceArrangement(body: JsonBody, materials: Array<Record<string, unknown>>, sourceAssetIds: string[]): Record<string, unknown> {
  const nested = record(body.referenceArrangement);
  const primaryAssetId = derivedPrimaryAssetId(body, sourceAssetIds);
  return compactJsonRecord({
    mode: text(body.referenceArrangementMode || nested.mode),
    label: text(body.referenceArrangementLabel || nested.label),
    primaryAssetId,
    usageCounts: derivedReferenceUsageCounts(materials),
    total: materials.length
  });
}

function derivedFeedbackToNextRound(body: JsonBody, sourceAssetIds: string[]): Record<string, unknown> | undefined {
  const feedback = record(body.feedbackToNextRound);
  if (!Object.keys(feedback).length) return undefined;
  const assetIds = boundedTextList(feedback.assetIds, 'feedbackToNextRound.assetIds', MAX_BATCH_IDS);
  for (const assetId of assetIds) if (!sourceAssetIds.includes(assetId)) throw new InvalidCommandError('feedbackToNextRound.assetIds 必须来自 sourceAssetIds。');
  return compactJsonRecord({
    source: text(feedback.source),
    assetIds,
    reasonIds: boundedTextList(feedback.reasonIds, 'feedbackToNextRound.reasonIds'),
    reasons: boundedTextList(feedback.reasons, 'feedbackToNextRound.reasons'),
    note: text(feedback.note)
  });
}

function derivedRoundPlan(body: JsonBody, purpose: string, sourceAssetIds: string[]): Record<string, unknown> {
  const defaultUsage = derivedDefaultReferenceUsage(purpose);
  const materials = derivedReferenceMaterials(body, sourceAssetIds, defaultUsage);
  const parentAssetIds = derivedParentAssetIds(body, sourceAssetIds);
  const itemCount = Number(body.targetCount ?? body.itemCount);
  const aspectRatio = text(body.aspectRatio || record(body.output).aspectRatio);
  const referenceArrangement = derivedReferenceArrangement(body, materials, sourceAssetIds);
  const derivation = compactJsonRecord({
    action: text(body.action) || purpose,
    actionLabel: text(body.actionLabel),
    sourceAssetIds,
    primaryAssetId: referenceArrangement.primaryAssetId,
    referenceArrangement,
    parentAssetIds,
    variationAxes: boundedTextList(body.variationAxes, 'variationAxes'),
    keepConstraints: boundedTextList(body.keepConstraints, 'keepConstraints'),
    refinementGoals: boundedTextList(body.refinementGoals, 'refinementGoals'),
    feedbackToNextRound: derivedFeedbackToNextRound(body, sourceAssetIds),
    editIntent: text(body.editIntent || body.instruction),
    fillDirection: text(body.fillDirection),
    note: text(body.note)
  });
  const referenceAssetIds = materials.filter((item) => item.usage !== 'mask').map((item) => text(item.assetId)).filter(Boolean);
  const maskAssetId = materials.find((item) => item.usage === 'mask')?.assetId;
  return compactJsonRecord({
    createdFrom: 'workbench',
    draftKind: 'studio-derived-round-context',
    parentAssetIds,
    derivation,
    referenceMaterials: materials,
    referenceAssetIds,
    maskAssetId: text(maskAssetId),
    itemCount: Number.isInteger(itemCount) && itemCount > 0 ? itemCount : undefined,
    output: aspectRatio ? { aspectRatio } : undefined,
    note: 'Studio 基于图片创建的下一轮上下文草稿；生成前仍需 Agent 形成可确认计划。'
  });
}

function publicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicValue);
  if (!value || typeof value !== 'object') return value;
  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) if (!/(api[_-]?key|authorization|secret|token|base[_-]?url|endpoint|password|external.*request|storage.*path|content.*hash)/i.test(key)) safe[key] = publicValue(item);
  return safe;
}

function publicAsset(asset: StudioAsset & { review?: unknown; display?: unknown }): Record<string, unknown> {
  const result: Record<string, unknown> = { id: asset.id, kind: asset.kind, mediaType: asset.mediaType, byteSize: asset.byteSize, deletedAt: asset.deletedAt, source: publicValue(asset.source) };
  if (asset.review !== undefined) result.review = publicValue(asset.review);
  if (asset.display !== undefined) result.display = publicValue(asset.display);
  return result;
}
function assetMediaSource(asset: StudioAsset): Extract<MediaSource, { kind: 'asset' }> {
  const bucket = asset.deletedAt ? 'trash' : asset.kind === 'import' ? 'imports' : asset.kind === 'generated' ? 'generated' : 'exports';
  return { kind: 'asset', storagePath: asset.storagePath, bucket, contentHash: asset.contentHash, byteSize: asset.byteSize, mediaType: asset.mediaType };
}

function publicDeliveryExport(value: DeliveryExportResult): Record<string, unknown> {
  const frozen = Array.isArray(value.delivery.manifest.files) ? value.delivery.manifest.files : [];
  const sequences = new Set<number>();
  const files: Array<{ sequence: number; file: string; downloadUrl: string }> = [];
  for (const item of frozen) {
    const entry = record(item);
    const sequence = Number(entry.sequence);
    if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequences.has(sequence) || typeof entry.file !== 'string' || typeof entry.mediaType !== 'string' || !/^image\/(png|jpeg|webp|gif)$/.test(entry.mediaType)) continue;
    sequences.add(sequence);
    files.push({ sequence, file: entry.file, downloadUrl: '/api/deliveries/' + encodeURIComponent(value.delivery.id) + '/files/' + sequence + '?download=1' });
  }
  return { delivery: value.delivery, files };
}

function publicDeliveryCompletion(value: DeliveryCompletionResult): Record<string, unknown> {
  const exported = value.stage === 'exported' ? publicDeliveryExport({ delivery: value.delivery, directory: '', files: value.files }) : null;
  return { operationId: value.operationId, stage: value.stage, nextAction: value.nextAction, delivery: value.delivery, files: exported?.files || [] };
}

function etagMatches(request: IncomingMessage, etag: string): boolean {
  const candidates = headerValue(request, 'if-none-match').split(',').map((value) => value.trim());
  const normalized = (value: string): string => value.replace(/^W\//, '');
  return candidates.includes('*') || candidates.some((candidate) => normalized(candidate) === normalized(etag));
}

function notModified(request: IncomingMessage, response: ServerResponse, etag: string, cacheControl: string): boolean {
  if (!etagMatches(request, etag)) return false;
  response.writeHead(304, { etag, 'cache-control': cacheControl, 'x-content-type-options': 'nosniff' });
  response.end();
  return true;
}

function requestedRange(request: IncomingMessage, byteSize: number, etag: string): { start: number; end: number } | null | 'invalid' {
  const value = headerValue(request, 'range');
  if (!value) return null;
  if (value.includes(',')) return null;
  const ifRange = headerValue(request, 'if-range');
  if (ifRange && ifRange !== etag) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || byteSize <= 0) return 'invalid';
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, byteSize - suffix);
    end = byteSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : byteSize - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= byteSize || end < start) return 'invalid';
    end = Math.min(end, byteSize - 1);
  }
  return { start, end };
}

export function streamVerifiedFileResponse(request: IncomingMessage, response: ServerResponse, opened: VerifiedManagedFile, headers: OutgoingHttpHeaders, etag: string, onClosed?: () => void): void {
  const range = requestedRange(request, opened.byteSize, etag);
  if (range === 'invalid') {
    opened.close();
    onClosed?.();
    response.end();
    return;
  }
  let source: Readable;
  try {
    source = opened.createReadStream(undefined, range || undefined);
  } catch (error) {
    opened.close();
    onClosed?.();
    throw error;
  }
  let handleClosed = false;
  const closeHandle = (): void => {
    if (handleClosed) return;
    handleClosed = true;
    response.removeListener('close', abort);
    opened.close();
    onClosed?.();
  };
  const abort = (): void => {
    if (!source.destroyed) source.destroy();
  };
  const fail = (error: Error): void => {
    if (!response.destroyed) response.destroy(error);
  };
  source.once('end', () => setImmediate(closeHandle));
  source.once('close', closeHandle);
  source.once('error', fail);
  response.once('close', abort);
  try {
    const length = range ? range.end - range.start + 1 : opened.byteSize;
    response.writeHead(range ? 206 : 200, { ...headers, etag, 'accept-ranges': 'bytes', 'content-length': length, ...(range ? { 'content-range': 'bytes ' + range.start + '-' + range.end + '/' + opened.byteSize } : {}) });
    source.pipe(response);
  } catch (error) {
    response.removeListener('close', abort);
    source.destroy();
    closeHandle();
    throw error;
  }
}

interface ActiveDaemonRuntime {
  startedAt?: unknown;
  provider?: { profileId?: unknown; configVersion?: unknown; providerId?: unknown; model?: unknown } | null;
  providerConcurrency?: ProviderConcurrencySnapshot | null;
  workerPool?: { health?: ProcessPoolHealth } | null;
  mediaWorkerPool?: { health?: ProcessPoolHealth } | null;
}

function readActiveDaemonRuntime(runtimeDir: string): ActiveDaemonRuntime | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'daemon.json'), 'utf8')) as ActiveDaemonRuntime;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function projectSelectionPayload(db: StudioDatabase, studioId: string, projectId: string): Record<string, unknown> {
  const assets = listProjectSelectionAssets(db, { studioId, projectId });
  return { projectId, assets: listAssetsWithReviewSummaries(db, assets, projectId).map(publicAsset) };
}

export class LocalStudioService {
  readonly initialized: InitializeStudioResult;
  readonly db: StudioDatabase;
  readonly providerDb: ProviderDatabase;
  readonly mediaWorkerPool: MediaProcessPool;
  private readonly pollMs: number;
  private readonly workbenchDir: string;
  private readonly capability: string;
  private readonly sessionToken: string;
  private readonly cookieName: string;
  private readonly workbenchPresence: WorkbenchPresence;
  private readonly providerProbe: typeof probeHttpEndpoint;
  private readonly confirmationGate: ConfirmationGate;
  private readonly ownsMediaWorkerPool: boolean;
  private readonly activeEventStreams = new Set<() => void>();
  private readonly activeRequests = new Set<Promise<void>>();
  private origin = '';
  private server: Server | null = null;
  private closePromise: Promise<void> | null = null;
  private acceptingRequests = true;

  constructor(options: StudioServiceOptions) {
    if (options.capability && !/^[A-Za-z0-9_-]{43,}$/.test(options.capability)) throw new Error('Studio capability must be a high-entropy base64url token.');
    if (options.sessionToken && !/^[A-Za-z0-9_-]{43,}$/.test(options.sessionToken)) throw new Error('Studio session token must be a high-entropy base64url token.');
    this.initialized = options.initialized || initializeStudio({ workspaceRoot: options.workspaceRoot, hardenAccess: false });
    const db = openStudioDatabase(this.initialized.paths, this.initialized.manifest);
    let providerDb: ProviderDatabase | null = null;
    try {
      providerDb = openProviderDatabase(this.initialized.paths);
      if (options.hardenAccess !== false) hardenStudioAccess(this.initialized.paths);
      importLegacyProviderEnvOnce(providerDb, this.initialized.paths);
    } catch (error) {
      closeProviderDatabase(providerDb);
      closeStudioDatabase(db);
      throw error;
    }
    this.db = db;
    this.providerDb = providerDb;
    this.mediaWorkerPool = options.mediaWorkerPool || new MediaProcessPool(this.initialized.paths.workspaceRoot, 1);
    this.ownsMediaWorkerPool = !options.mediaWorkerPool;
    this.pollMs = Math.min(30000, Math.max(100, options.ssePollMs || 15000));
    this.workbenchDir = options.workbenchDir ? path.resolve(options.workbenchDir) : path.resolve(__dirname, '../../workbench');
    this.capability = options.capability || createLocalCapability();
    this.sessionToken = options.sessionToken || createLocalCapability();
    this.cookieName = localSessionCookieName(this.initialized.manifest.studioId, this.capability);
    this.workbenchPresence = options.workbenchPresence || new WorkbenchPresence();
    this.providerProbe = options.providerProbe || probeHttpEndpoint;
    this.confirmationGate = new ConfirmationGate();
  }

  async listen(port = 0, host = '127.0.0.1'): Promise<StartedStudioService> {
    if (this.server) throw new Error('Studio service is already listening.');
    if (host !== '127.0.0.1' && host !== '::1') throw new Error('Studio service must listen on a loopback address.');
    this.acceptingRequests = true;
    const server = http.createServer((request, response) => {
      if (!this.acceptingRequests) { response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify({ ok: false, error: { code: 'shutting_down', message: 'Studio 本地服务正在关闭。' } })); return; }
      const operation = this.handle(request, response);
      this.activeRequests.add(operation);
      void operation.then(() => this.activeRequests.delete(operation), () => this.activeRequests.delete(operation));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => { server.removeListener('listening', onListening); reject(error); };
        const onListening = (): void => { server.removeListener('error', onError); resolve(); };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
    } catch (error) {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    }
    const address = server.address();
    if (!address || typeof address === 'string') {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw new Error('Studio service did not expose a TCP address.');
    }
    const hostname = host === '::1' ? '[::1]' : host;
    const url = 'http://' + hostname + ':' + address.port;
    this.origin = url;
    this.server = server;
    return {
      url,
      service: this,
      access: {
        bearerToken: this.capability,
        workbenchUrl: url + '/#capability=' + encodeURIComponent(this.capability),
        cookieName: this.cookieName
      }
    };
  }

  private assertProviderProfileHasNoUnfinishedRuns(profileId: string, action: string): void {
    const run = this.db.prepare("SELECT id FROM generation_runs WHERE provider_profile_id = ? AND status NOT IN ('completed', 'failed', 'cancelled') LIMIT 1").get(profileId) as { id: string } | undefined;
    if (run) throw new InvalidCommandError('该 Provider Profile 仍有未完成运行；请先完成、取消或恢复运行后再' + action + '。');
  }
  private assertProviderProfileInWorkspace(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new InvalidCommandError('profileId 必须是字符串。');
    const profileId = value.trim();
    if (!profileId) return null;
    if (profileId.length > 256) throw new InvalidCommandError('profileId 过长。');
    if (!this.providerDb.prepare('SELECT id FROM provider_profiles WHERE id = ?').get(profileId)) throw new StudioNotFoundError('Provider Profile 不属于当前 workspace。');
    return profileId;
  }

  private runtimeStatus() {
    const record = readActiveDaemonRuntime(this.initialized.paths.runtimeDir);
    const activeIdentity = record?.provider && typeof record.provider.profileId === 'string' && Number.isInteger(record.provider.configVersion) && typeof record.provider.providerId === 'string' && typeof record.provider.model === 'string' ? {
      profileId: record.provider.profileId,
      configVersion: Number(record.provider.configVersion),
      providerId: record.provider.providerId,
      model: record.provider.model,
    } : null;
    const config = resolveActiveProviderConfig(this.providerDb, this.initialized.paths);
    const desired = config ? providerSnapshot(config) : null;
    const desiredIdentity = desired ? { profileId: desired.profileId, configVersion: desired.configVersion, providerId: desired.providerId, model: desired.model } : null;
    const reconfigurationPending = Boolean(record && JSON.stringify(activeIdentity) !== JSON.stringify(desiredIdentity));
    const daemon = {
      mode: record ? 'daemon' : 'standalone',
      startedAt: typeof record?.startedAt === 'string' ? record.startedAt : null,
      workerPool: record?.workerPool?.health || null,
      mediaWorkerPool: record?.mediaWorkerPool?.health || this.mediaWorkerPool.healthSnapshot()
    };
    const safeDesired = desired ? {
      profileId: desired.profileId,
      profileName: desired.profileName,
      configVersion: desired.configVersion,
      providerId: desired.providerId,
      model: desired.model,
      referenceEnabled: desired.referenceEnabled,
      endpointTrustMode: desired.endpointTrustMode,
      limits: desired.limits,
      descriptorVersion: desired.descriptorVersion,
      adapterVersion: desired.adapterVersion,
      capabilities: desired.capabilities
    } : null;
    const safeActive = activeIdentity ? {
      profileId: activeIdentity.profileId,
      configVersion: activeIdentity.configVersion,
      providerId: activeIdentity.providerId,
      model: activeIdentity.model
    } : null;
    return {
      desired: safeDesired,
      active: safeActive,
      restartRequired: false,
      reconfigurationPending,
      providerConcurrency: record?.providerConcurrency || null,
      workerPool: daemon.workerPool,
      mediaWorkerPool: daemon.mediaWorkerPool,
      daemon
    };
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      this.acceptingRequests = false;
      for (const teardown of [...this.activeEventStreams]) teardown();
      const server = this.server;
      this.server = null;
      const requestDrain = Promise.allSettled([...this.activeRequests]);
      let serverClosed: Promise<void> = Promise.resolve();
      if (server) {
        serverClosed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        server.closeAllConnections();
        await Promise.race([serverClosed, new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
      }
      await requestDrain;
      if (this.ownsMediaWorkerPool) await this.mediaWorkerPool.close();
      closeStudioDatabase(this.db);
      closeProviderDatabase(this.providerDb);
    })();
    return this.closePromise;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const parsed = new URL(request.url || '/', this.origin || 'http://127.0.0.1');
      assertLocalHost(request, new URL(this.origin).host);
      assertProtocolCompatibility(request);
      if (request.method === 'GET' && !parsed.pathname.startsWith('/api/')) return this.workbench(response, parsed.pathname);
      if (request.method === 'GET' && parsed.pathname === '/api/health') return success(response, { service: 'daoge-pic-vnext', studioId: this.initialized.manifest.studioId });
      if (parsed.pathname === '/api/auth/bootstrap') {
        if (request.method !== 'POST') return json(response, 404, { ok: false, error: { code: 'not_found', message: '未找到请求的 Studio API。' } });
        assertLocalWriteOrigin(request, this.origin, 'cookie');
        assertJsonContentType(request);
        const body = await readBody(request);
        if (!constantTimeTokenEqual(text(body.capability), this.capability)) throw new LocalAccessError(401, 'unauthorized', '本地 Studio capability 无效。');
        response.setHeader('set-cookie', localSessionCookie(this.cookieName, this.sessionToken));
        this.workbenchPresence.recordAuthenticatedConnection();
        return success(response, { authenticated: true });
      }
      const authentication = authenticateLocalRequest(request, this.capability, this.cookieName, this.sessionToken);
      if (!authentication) throw new LocalAccessError(401, 'unauthorized', '需要有效的本地 Studio 授权。');
      assertProtocolCompatibility(request, authentication === 'bearer');
      if (request.method === 'POST' || request.method === 'PUT') assertLocalWriteOrigin(request, this.origin, authentication);
      if (authentication === 'cookie') this.workbenchPresence.recordAuthenticatedConnection();
      if (request.method === 'POST' && (parsed.pathname === '/api/workbench/open-claim' || parsed.pathname === '/api/workbench/open-claim/release')) {
        assertJsonContentType(request);
        const body = await readBody(request);
        const claimToken = text(body.claimToken);
        if (!/^[A-Za-z0-9_-]{43,}$/.test(claimToken)) throw new InvalidCommandError('Workbench open claim requires a high-entropy token.');
        if (parsed.pathname.endsWith('/release')) return success(response, { released: this.workbenchPresence.release(claimToken) });
        return success(response, this.workbenchPresence.claim(claimToken, body.force === true));
      }
      if (request.method === 'GET' && parsed.pathname === '/api/studio') {
        const runtime = this.runtimeStatus().daemon;
        return success(response, { studioId: this.initialized.manifest.studioId, schemaVersion: this.initialized.manifest.schemaVersion, protocol: protocolStatus(), runtime });
      }
      if (request.method === 'GET' && parsed.pathname === '/api/providers') return success(response, { descriptors: providerDescriptorSummaries(), profiles: listProviderProfiles(this.providerDb, this.initialized.paths), status: providerStatus(this.providerDb, this.initialized.paths), runtime: this.runtimeStatus() });
      if (request.method === 'GET' && parsed.pathname === '/api/projects') return success(response, { projects: listProjects(this.db, this.initialized.manifest.studioId) });
      if (request.method === 'GET' && parsed.pathname === '/api/backup/manifest') {
        const studioId = this.initialized.manifest.studioId;
        const workspaceRoot = this.initialized.paths.workspaceRoot;
        try {
          // Phase 1 -- inventory the workspace and hash every media and delivery file with no lock held.
          // A real Studio holds gigabytes of content; hashing it inside BEGIN IMMEDIATE would block every
          // other writer for tens of seconds, which is why this used to be capped at a few hundred assets.
          const assetCount = countStudioAssets(this.db, studioId, { includeDeleted: true });
          if (assetCount > MAX_BACKUP_MANIFEST_ASSETS) throw new InvalidCommandError('当前 Studio 素材数量 ' + assetCount + ' 超过 backup manifest 上限 ' + MAX_BACKUP_MANIFEST_ASSETS + '；请先归档或清理素材后重试。');
          const databasePath = workspaceRelativePath(workspaceRoot, this.initialized.paths.databasePath);
          const metadataPath = workspaceRelativePath(workspaceRoot, this.initialized.paths.manifestPath);
          const seenPaths = new Set<string>([databasePath, metadataPath]);
          const entries: BackupManifestEntryInput[] = [
            { path: metadataPath, category: 'metadata', ...observedBackupEntry(workspaceRoot, metadataPath) }
          ];
          // `listStudioAssets` clamps each page to 500 rows internally, so a single call would silently truncate
          // a larger Studio and present an incomplete manifest as a complete one. Page until the cap instead.
          for (let offset = 0; offset < MAX_BACKUP_MANIFEST_ASSETS; offset += ASSET_PAGE_SIZE) {
            const page = listStudioAssets(this.db, studioId, { includeDeleted: true, limit: ASSET_PAGE_SIZE, offset });
            if (!page.length) break;
            for (const asset of page) {
              const relativePath = safeControlledAssetPath(workspaceRoot, asset.storagePath);
              if (seenPaths.has(relativePath)) throw backupError('Backup manifest 路径重复。');
              seenPaths.add(relativePath);
              entries.push({ path: relativePath, category: 'media', ...observedBackupEntry(workspaceRoot, relativePath) });
            }
            if (page.length < ASSET_PAGE_SIZE) break;
          }
          const deliveries = exportedDeliveryBackupEntries(this.db, this.initialized.paths, studioId, seenPaths);
          for (const entry of deliveries.entries) entries.push({ ...entry, ...observedBackupEntry(workspaceRoot, String(entry.path)) });

          // Phase 2 -- hold the write lock only long enough to checkpoint, prove no WAL is pending, and hash
          // studio.db against that exact state. Everything above is already observed.
          const manifest = withBackupManifestLock(this.db, this.initialized.paths.databasePath, () => {
            const result = createBackupManifest({
              workspaceRoot,
              studio: { studioId, protocolName: SKILL_PROTOCOL_NAME, protocolVersion: protocolStatus().version, runtimeVersion: RUNTIME_VERSION },
              entries: [{ path: databasePath, category: 'database', ...observedBackupEntry(workspaceRoot, databasePath) }, ...entries]
            });
            return result;
          });
          assertDeliveryBackupIdentities(manifest, deliveries.identities);
          return success(response, { manifest });
        } catch (error) {
          normalizeBackupInputError('Backup manifest', error);
        }
      }
      if (request.method === 'GET' && parsed.pathname === '/api/quality-metrics') return success(response, { metrics: getQualityMetrics(this.db, this.initialized.manifest.studioId) });
      const projectQualityMetricsMatch = /^\/api\/projects\/([^/]+)\/quality-metrics$/.exec(parsed.pathname);
      if (request.method === 'GET' && projectQualityMetricsMatch) {
        this.assertProjectInStudio(projectQualityMetricsMatch[1]);
        return success(response, { metrics: getQualityMetrics(this.db, this.initialized.manifest.studioId, { projectId: projectQualityMetricsMatch[1] }) });
      }
      if (request.method === 'GET' && parsed.pathname === '/api/project-templates') return success(response, { templates: listProjectTemplates() });
      if (request.method === 'GET' && parsed.pathname === '/api/confirmed-templates') {
        if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Confirmed templates require Skill/CLI authentication.');
        const includeArchivedValue = parsed.searchParams.get('includeArchived');
        let includeArchived: boolean | undefined;
        if (includeArchivedValue !== null) {
          if (includeArchivedValue === 'true' || includeArchivedValue === '1') includeArchived = true;
          else if (includeArchivedValue === 'false' || includeArchivedValue === '0') includeArchived = false;
          else throw new InvalidCommandError('includeArchived must be true, false, 1, or 0.');
        }
        const templates = listConfirmedTemplates(this.db, {
          studioId: this.initialized.manifest.studioId,
          templateType: (parsed.searchParams.get('templateType') ?? undefined) as ConfirmedTemplateType | undefined,
          templateId: parsed.searchParams.get('templateId') ?? undefined,
          includeArchived
        });
        return success(response, { templates: templates.map(publicValue) });
      }
      const confirmedTemplateDetailMatch = /^\/api\/confirmed-templates\/([^/]+)$/.exec(parsed.pathname);
      if (request.method === 'GET' && confirmedTemplateDetailMatch) {
        if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Confirmed templates require Skill/CLI authentication.');
        const versionValue = parsed.searchParams.get('version');
        const template = getConfirmedTemplate(this.db, {
          studioId: this.initialized.manifest.studioId,
          templateId: confirmedTemplateDetailMatch[1],
          version: versionValue === null ? undefined : numberValue(versionValue)
        });
        if (!template) throw new StudioNotFoundError('Confirmed template is not available in this Studio.');
        return success(response, { template: publicValue(template) });
      }
      if (request.method === 'GET' && parsed.pathname === '/api/usage') {
        const attribution = usageAttributionFromQuery(this.initialized.manifest.studioId, parsed);
        attribution.profileId = this.assertProviderProfileInWorkspace(attribution.profileId);
        const events = listUsageLedger(this.db, { ...attribution, limit: usageLimitFromQuery(parsed) });
        const summary = summarizeUsage(this.db, attribution);
        return success(response, { events: events.map(publicValue), summary: publicValue(summary) });
      }
      if (request.method === 'GET' && parsed.pathname === '/api/usage/summary') {
        const attribution = usageAttributionFromQuery(this.initialized.manifest.studioId, parsed);
        attribution.profileId = this.assertProviderProfileInWorkspace(attribution.profileId);
        return success(response, { summary: publicValue(summarizeUsage(this.db, attribution)) });
      }
      if (request.method === 'GET' && parsed.pathname === '/api/budget') {
        const requestedProfileId = this.assertProviderProfileInWorkspace(optionalQueryText(parsed, 'profileId'));
        const studioId = this.initialized.manifest.studioId;
        const profilePolicy = getBudgetPolicy(this.db, { studioId, profileId: requestedProfileId });
        const policy = profilePolicy || (requestedProfileId ? getBudgetPolicy(this.db, { studioId, profileId: null }) : null);
        const usage = summarizeUsage(this.db, { studioId, profileId: policy ? policy.profileId : requestedProfileId });
        return success(response, { policy: publicValue(policy), usage: publicValue(usage) });
      }
      if (request.method === 'GET' && parsed.pathname === '/api/search') { const query = parsed.searchParams.get('q') || ''; if (query.length > 256) throw new InvalidCommandError('Search query exceeds the 256 character limit.'); return success(response, { results: searchStudio(this.db, this.initialized.manifest.studioId, query, parsed.searchParams.has('limit') ? numberValue(parsed.searchParams.get('limit')) : 25) }); }
      if (request.method === 'GET' && parsed.pathname === '/api/task-types') return success(response, { taskTypes: listTaskTypes(this.db, this.initialized.manifest.studioId).map(publicValue) });
      if (request.method === 'GET' && parsed.pathname === '/api/style-kits') return success(response, { styleKits: listStyleKits(this.db, this.initialized.manifest.studioId).map(publicValue) });
      if (request.method === 'GET' && parsed.pathname === '/api/brand-kits') return success(response, { brandKits: listBrandKits(this.db, this.initialized.manifest.studioId).map(publicValue) });
      if (request.method === 'GET' && parsed.pathname === '/api/shared-assets') return success(response, { assets: listSharedStudioAssets(this.db, this.initialized.manifest.studioId).map(publicAsset) });
      const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(parsed.pathname);
      if (request.method === 'GET' && sessionMatch) return success(response, { session: getStudioSession(this.db, { studioId: this.initialized.manifest.studioId, sessionId: sessionMatch[1] }) });
      const sessionPlanMatch = /^\/api\/sessions\/([^/]+)\/plan-status$/.exec(parsed.pathname);
      if (request.method === 'GET' && sessionPlanMatch) {
        const session = getStudioSession(this.db, { studioId: this.initialized.manifest.studioId, sessionId: sessionPlanMatch[1] });
        const round = session.activeRoundId ? this.db.prepare('SELECT round.id, round.purpose, round.plan_json, round.plan_version, round.status, task.id AS task_id, task.name AS task_name, project.id AS project_id, project.name AS project_name FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.id = ? AND project.studio_id = ?').get(session.activeRoundId, this.initialized.manifest.studioId) as { id: string; purpose: string; plan_json: string; plan_version: number; status: string; task_id: string; task_name: string; project_id: string; project_name: string } | undefined : undefined;
         const latestRun = round ? getLatestRun(this.db, this.initialized.manifest.studioId, round.id) : null;
        const consent = round ? this.confirmationGate.consentFor(round.id) : null;
        const pendingConfirmation = round ? this.confirmationGate.getChallenge(round.id) : null;
        return success(response, { session: { id: session.id, conversationId: session.conversationId }, context: round ? { project: { id: round.project_id, name: round.project_name }, task: { id: round.task_id, name: round.task_name }, round: { id: round.id, purpose: round.purpose, planVersion: round.plan_version, status: round.status, plan: publicValue(JSON.parse(round.plan_json)) } } : null, confirmation: consent ? { confirmed: true, confirmedAt: consent.confirmedAt, expiresAt: consent.expiresAt } : { confirmed: false }, pendingConfirmation: pendingConfirmation ? { challenge: pendingConfirmation.challenge, sessionId: pendingConfirmation.sessionId, expectedVersion: pendingConfirmation.expectedVersion, expiresAt: pendingConfirmation.expiresAt } : null, latestRun });
      }
      if (request.method === 'GET' && parsed.pathname === '/api/assets/by-id') {
        const assetIds = [...new Set(parsed.searchParams.getAll('assetId').map((value) => value.trim()).filter(Boolean))];
        if (assetIds.length > MAX_BATCH_IDS) throw new InvalidCommandError('assetId 不能超过 ' + MAX_BATCH_IDS + ' 项。');
        const projectId = parsed.searchParams.get('projectId') || '';
        if (!projectId) throw new InvalidCommandError('Asset lookup requires projectId.');
        this.assertProjectInStudio(projectId);
        const access = inspectProjectAssetAccess(this.db, { studioId: this.initialized.manifest.studioId, projectId, assetIds });
        const ordered = assetIds.map((assetId) => projectAssetReferenceAllowed(access.get(assetId)) ? getStudioAsset(this.db, this.initialized.manifest.studioId, assetId) : null).filter((asset): asset is StudioAsset => Boolean(asset));
        return success(response, { assets: listAssetsWithReviewSummaries(this.db, ordered, projectId).map(publicAsset) });
      }
      if (request.method === 'GET' && parsed.pathname === '/api/assets') {
        const scope = assetScope(parsed.searchParams.get('scope'));
        const deletedFilter = parsed.searchParams.get('deleted');
        const rawKind = parsed.searchParams.get('kind');
        if (rawKind && rawKind !== 'import' && rawKind !== 'generated' && rawKind !== 'export') throw new InvalidCommandError('Unknown asset kind.');
        const input = { includeDeleted: deletedFilter === 'true', deletedOnly: deletedFilter === 'only', projectId: parsed.searchParams.get('projectId') || undefined, taskId: parsed.searchParams.get('taskId') || undefined, roundId: parsed.searchParams.get('roundId') || undefined, kind: (rawKind || undefined) as AssetKind | undefined, limit: parsed.searchParams.has('limit') ? numberValue(parsed.searchParams.get('limit')) : undefined, offset: parsed.searchParams.has('offset') ? numberValue(parsed.searchParams.get('offset')) : undefined };
        if (scope) {
          const scopedInput = { ...input, scope };
          return success(response, { assets: listAssetsWithReviewSummaries(this.db, listScopedStudioAssets(this.db, this.initialized.manifest.studioId, scopedInput), input.projectId).map(publicAsset), total: countScopedStudioAssets(this.db, this.initialized.manifest.studioId, scopedInput), scope });
        }
        const unscopedInput = { ...input, targetType: parsed.searchParams.get('targetType') || undefined, targetId: parsed.searchParams.get('targetId') || undefined };
        return success(response, { assets: listAssetsWithReviewSummaries(this.db, listStudioAssets(this.db, this.initialized.manifest.studioId, unscopedInput), input.projectId).map(publicAsset), total: countStudioAssets(this.db, this.initialized.manifest.studioId, unscopedInput) });
      }
      const projectSelectionMatch = /^\/api\/projects\/([^/]+)\/selection$/.exec(parsed.pathname);
      if (request.method === 'GET' && projectSelectionMatch) return success(response, { selection: projectSelectionPayload(this.db, this.initialized.manifest.studioId, projectSelectionMatch[1]) });
      const canvasLayoutMatch = /^\/api\/projects\/([^/]+)\/canvas-layout$/.exec(parsed.pathname);
      if (request.method === 'GET' && canvasLayoutMatch) {
        this.assertProjectInStudio(canvasLayoutMatch[1]);
        const scopeType = (parsed.searchParams.get('scopeType') || 'project') as CanvasLayoutScopeType;
        const scopeId = parsed.searchParams.get('scopeId') || canvasLayoutMatch[1];
        return success(response, { layout: getCanvasLayout(this.db, { studioId: this.initialized.manifest.studioId, projectId: canvasLayoutMatch[1], scopeType, scopeId }) });
      }
      const assetImpactMatch = /^\/api\/assets\/([^/]+)\/impact$/.exec(parsed.pathname);
      if (request.method === 'GET' && assetImpactMatch) return success(response, { impact: getAssetImpact(this.db, this.initialized.manifest.studioId, assetImpactMatch[1]) });
      const assetProvenanceMatch = /^\/api\/assets\/([^/]+)\/provenance$/.exec(parsed.pathname);
      if (request.method === 'GET' && assetProvenanceMatch) return success(response, { provenance: getAssetProvenance(this.db, this.initialized.manifest.studioId, assetProvenanceMatch[1]) });
      const persistedProvenanceMatch = /^\/api\/provenance\/([^/]+)$/.exec(parsed.pathname);
      if (request.method === 'GET' && persistedProvenanceMatch) return success(response, { provenance: getPersistedStudioProvenance(this.db, this.initialized.manifest.studioId, persistedProvenanceMatch[1]) });
      const projectArchiveMatch = /^\/api\/projects\/([^/]+)\/assets\/archive$/.exec(parsed.pathname);
      if (request.method === 'GET' && projectArchiveMatch) { const assetIds = parsed.searchParams.getAll('assetId'); if (assetIds.length > MAX_BATCH_IDS) throw new InvalidCommandError('assetId 不能超过 ' + MAX_BATCH_IDS + ' 项。'); return await this.projectAssetArchive(request, response, projectArchiveMatch[1], assetIds); }
      const deliveryArchiveMatch = /^\/api\/deliveries\/([^/]+)\/archive$/.exec(parsed.pathname);
      if (request.method === 'GET' && deliveryArchiveMatch) { const sequences = parsed.searchParams.getAll('sequence'); if (sequences.length > MAX_BATCH_IDS) throw new InvalidCommandError('sequence 不能超过 ' + MAX_BATCH_IDS + ' 项。'); return await this.deliveryArchive(request, response, deliveryArchiveMatch[1], sequences); }
      const deliveryFileMatch = /^\/api\/deliveries\/([^/]+)\/files\/(\d+)$/.exec(parsed.pathname);
      if (request.method === 'GET' && deliveryFileMatch) return await this.deliveryFile(request, response, deliveryFileMatch[1], Number(deliveryFileMatch[2]), parsed.searchParams.get('download') === '1', parsed.searchParams.get('variant') === 'thumbnail');
      const deliveryDetailMatch = /^\/api\/deliveries\/([^/]+)$/.exec(parsed.pathname);
      if (request.method === 'GET' && deliveryDetailMatch) { this.assertDeliveryInStudio(deliveryDetailMatch[1]); return success(response, { delivery: getDelivery(this.db, this.initialized.manifest.studioId, deliveryDetailMatch[1]) }); }
      const batchDetailMatch = /^\/api\/delivery-batches\/([^/]+)$/.exec(parsed.pathname);
      if (request.method === 'GET' && batchDetailMatch) return success(response, { batch: getDeliveryBatch(this.db, this.initialized.manifest.studioId, batchDetailMatch[1]) });
      const deliveryMatch = /^\/api\/projects\/([^/]+)\/deliveries$/.exec(parsed.pathname);
      if (request.method === 'GET' && deliveryMatch) { this.assertProjectInStudio(deliveryMatch[1]); return success(response, { deliveries: listDeliveries(this.db, deliveryMatch[1]) }); }
      const batchMatch = /^\/api\/projects\/([^/]+)\/delivery-batches$/.exec(parsed.pathname);
      if (request.method === 'GET' && batchMatch) return success(response, { batches: listDeliveryBatches(this.db, this.initialized.manifest.studioId, batchMatch[1]) });
      const taskMatch = /^\/api\/projects\/([^/]+)\/tasks$/.exec(parsed.pathname);
      if (request.method === 'GET' && taskMatch) return success(response, { tasks: listTasks(this.db, this.initialized.manifest.studioId, taskMatch[1]) });
      const taskStudioOverviewMatch = /^\/api\/tasks\/([^/]+)\/studio-overview$/.exec(parsed.pathname);
      if (request.method === 'GET' && taskStudioOverviewMatch) return success(response, { overview: getTaskStudioOverview(this.db, this.initialized.manifest.studioId, taskStudioOverviewMatch[1], parsed.searchParams.getAll('round')) });
      const taskOverviewMatch = /^\/api\/tasks\/([^/]+)\/overview$/.exec(parsed.pathname);
      if (request.method === 'GET' && taskOverviewMatch) return success(response, { overview: getTaskCreativeOverview(this.db, this.initialized.manifest.studioId, taskOverviewMatch[1]) });
      const roundMatch = /^\/api\/tasks\/([^/]+)\/rounds$/.exec(parsed.pathname);
      if (request.method === 'GET' && roundMatch) return success(response, { rounds: listRounds(this.db, this.initialized.manifest.studioId, roundMatch[1]) });
      const creativeRecordMatch = /^\/api\/rounds\/([^/]+)\/creative-record$/.exec(parsed.pathname);
      if (request.method === 'GET' && creativeRecordMatch) {
        const includeItemsValue = parsed.searchParams.get('includeItems');
        if (includeItemsValue !== null && !['0', '1'].includes(includeItemsValue)) throw new InvalidCommandError('includeItems 只支持 0 或 1。');
        return success(response, { record: getRoundCreativeRecord(this.db, this.initialized.manifest.studioId, creativeRecordMatch[1], parsed.searchParams.get('runId') || undefined, includeItemsValue !== '0') });
      }
      const planVersionsMatch = /^\/api\/rounds\/([^/]+)\/plan-versions$/.exec(parsed.pathname);
      if (request.method === 'GET' && planVersionsMatch) return success(response, { planVersions: listRoundPlanVersions(this.db, this.initialized.manifest.studioId, planVersionsMatch[1]) });
      const dryRunsMatch = /^\/api\/rounds\/([^/]+)\/dry-runs$/.exec(parsed.pathname);
      if (request.method === 'GET' && dryRunsMatch) return success(response, { dryRuns: listDryRunPreviews(this.db, this.initialized.manifest.studioId, dryRunsMatch[1]) });
      const runMatch = /^\/api\/rounds\/([^/]+)\/runs$/.exec(parsed.pathname);
      if (request.method === 'GET' && runMatch) return success(response, { runs: listRuns(this.db, this.initialized.manifest.studioId, runMatch[1]) });
      const runItemsMatch = /^\/api\/runs\/([^/]+)\/items$/.exec(parsed.pathname);
      if (request.method === 'GET' && runItemsMatch) {
        const sort = parsed.searchParams.get('sort');
        if (sort && sort !== 'sequence') throw new InvalidCommandError('运行项只支持按序号排序。');
        return success(response, listRunItemsForQuery(this.db, this.initialized.manifest.studioId, runItemsMatch[1], {
          page: parsed.searchParams.get('page') || undefined,
          pageSize: parsed.searchParams.get('pageSize') || undefined,
          statuses: parsed.searchParams.getAll('status'),
          sequence: parsed.searchParams.get('sequence') || undefined
        }));
      }
      const assetFileMatch = /^\/api\/assets\/([^/]+)\/file$/.exec(parsed.pathname);
      if (request.method === 'GET' && assetFileMatch) return await this.assetFile(request, response, assetFileMatch[1], parsed.searchParams.get('download') === '1');
      const assetThumbnailMatch = /^\/api\/assets\/([^/]+)\/thumbnail$/.exec(parsed.pathname);
      if (request.method === 'GET' && assetThumbnailMatch) return await this.assetThumbnail(request, response, assetThumbnailMatch[1]);
      if (request.method === 'GET' && parsed.pathname === '/api/events') return this.events(request, response, parsed);
      if (request.method === 'POST' && (parsed.pathname === '/api/confirmed-templates' || /^\/api\/confirmed-templates\/[^/]+\/(?:archive|rollback)$/.test(parsed.pathname)) && authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Confirmed template writes require Skill/CLI authentication.');
      if (request.method === 'POST' && parsed.pathname === '/api/budget' && authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Budget writes require Skill/CLI authentication.');
      if (request.method !== 'POST' && request.method !== 'PUT') return json(response, 404, { ok: false, error: { code: 'not_found', message: '未找到请求的 Studio API。' } });
      if (request.method === 'POST' && parsed.pathname === '/api/assets/import') return await this.importAsset(request, response);
      assertJsonContentType(request);
      const body = await readBody(request);
      return await this.write(request, response, parsed.pathname, body, authentication);
    } catch (error) {
      this.sendError(response, error);
    }
  }

  private async write(request: IncomingMessage, response: ServerResponse, pathname: string, body: JsonBody, authentication: LocalAuthentication): Promise<void> {
    const confirmedTemplateMutation = pathname === '/api/confirmed-templates' || /^\/api\/confirmed-templates\/[^/]+\/(?:archive|rollback)$/.test(pathname);
    if (confirmedTemplateMutation && authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Confirmed template writes require Skill/CLI authentication.');
    const key = idempotencyKey(request, body);
    const putAllowed = /^\/api\/providers\/[^/]+$/.test(pathname) || /^\/api\/deliveries\/[^/]+\/items$/.test(pathname) || /^\/api\/rounds\/[^/]+\/draft-context$/.test(pathname);
    if (request.method === 'PUT' && !putAllowed) return json(response, 404, { ok: false, error: { code: 'not_found', message: '未找到请求的 Studio API。' } });
    if (pathname === '/api/backup/restore-dry-run' && request.method === 'POST') {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Backup restore dry-run requires Skill/CLI authentication.');
      assertAllowedBodyKeys(body, ['sourceRoot', 'manifest', 'expectedStudio'], 'Backup restore dry-run');
      const expectedStudio = body.expectedStudio === undefined ? {
        studioId: this.initialized.manifest.studioId,
        protocolName: SKILL_PROTOCOL_NAME,
        protocolVersion: protocolStatus().version,
        runtimeVersion: RUNTIME_VERSION
      } : body.expectedStudio;
      try {
        const receipt = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'backup.restore_dry_run', () => createRestoreDryRun({
          sourceRoot: text(body.sourceRoot),
          targetRoot: this.initialized.paths.workspaceRoot,
          manifest: body.manifest,
          expectedStudio: expectedStudio as never
        }), backupReceiptRequest(body, ['sourceRoot']));
        return success(response, { value: receipt.value, replayed: receipt.replayed });
      } catch (error) {
        normalizeBackupInputError('Backup restore dry-run', error);
      }
    }
    if (pathname === '/api/backup/upgrade-assess' && request.method === 'POST') {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Backup upgrade assessment requires Skill/CLI authentication.');
      assertAllowedBodyKeys(body, ['targetRuntimeVersion', 'targetSchemaVersion', 'targetProtocolVersion', 'rollbackPoint'], 'Backup upgrade assessment');
      // The caller declares only the target. Every "what can this runtime do" fact below is read from this
      // daemon, so a caller can no longer certify its own upgrade by claiming a wider supported range.
      const runtimeFacts = {
        currentRuntimeVersion: RUNTIME_VERSION,
        // The daemon migrated this database on open, so the ledger is never empty here; fall back to the
        // schema this runtime guarantees rather than letting a null reach the assessment.
        currentSchemaVersion: studioSchemaVersion(this.db) ?? STUDIO_SCHEMA_VERSION,
        supportedSchemaVersion: STUDIO_SCHEMA_VERSION,
        supportedProtocolRange: SUPPORTED_PROTOCOL_RANGE
      };
      try {
        const receipt = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'backup.upgrade_assess', () => evaluateUpgradeCompatibility({
          ...runtimeFacts,
          targetRuntimeVersion: text(body.targetRuntimeVersion),
          targetSchemaVersion: numberValue(body.targetSchemaVersion),
          targetProtocolVersion: text(body.targetProtocolVersion),
          rollbackPoint: body.rollbackPoint === undefined ? undefined : body.rollbackPoint as never
        }), backupReceiptRequest(body));
        return success(response, { value: receipt.value, replayed: receipt.replayed, runtimeFacts });
      } catch (error) {
        normalizeBackupInputError('Backup upgrade assessment', error);
      }
    }
    if (pathname === '/api/backup/rollback-point' && request.method === 'POST') {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Backup rollback point requires Skill/CLI authentication.');
      assertAllowedBodyKeys(body, ['manifest', 'runtimeVersion', 'schemaVersion', 'createdAt'], 'Backup rollback point');
      try {
        const receipt = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'backup.rollback_point', () => buildUpgradeRollbackPoint({
          manifest: body.manifest as never,
          runtimeVersion: text(body.runtimeVersion),
          schemaVersion: numberValue(body.schemaVersion),
          createdAt: body.createdAt === undefined ? undefined : text(body.createdAt)
        }), backupReceiptRequest(body));
        return success(response, { value: receipt.value, replayed: receipt.replayed });
      } catch (error) {
        normalizeBackupInputError('Backup rollback point', error);
      }
    }
    if (pathname === '/api/budget' && request.method === 'POST') {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Budget writes require Skill/CLI authentication.');
      assertAllowedBodyKeys(body, ['profileId', 'limitCostMinor', 'costUnit'], 'Budget');
      const input = {
        studioId: this.initialized.manifest.studioId,
        profileId: this.assertProviderProfileInWorkspace(body.profileId),
        limitCostMinor: nonNegativeSafeInteger(body.limitCostMinor, 'limitCostMinor'),
        costUnit: body.costUnit as string
      };
      const receipt = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'budget.configure', () => configureBudget(this.db, input), input);
      return success(response, { value: publicValue(receipt.value), replayed: receipt.replayed });
    }
    if (pathname === '/api/confirmed-templates' && request.method === 'POST') {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Confirmed template writes require Skill/CLI authentication.');
      const input: SaveConfirmedTemplateInput = {
        studioId: this.initialized.manifest.studioId,
        templateType: text(body.templateType) as ConfirmedTemplateType,
        name: text(body.name),
        definition: body.definition,
        roundId: body.roundId === undefined ? undefined : text(body.roundId),
        sourceRoundId: body.sourceRoundId === undefined ? undefined : text(body.sourceRoundId),
        templateId: body.templateId === undefined ? undefined : text(body.templateId),
        provenance: body.provenance as SaveConfirmedTemplateInput['provenance'],
        planVersion: body.planVersion === undefined ? undefined : numberValue(body.planVersion),
        sourcePlanVersion: body.sourcePlanVersion === undefined ? undefined : numberValue(body.sourcePlanVersion)
      };
      const receipt = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'confirmed_templates.save', () => saveConfirmedTemplate(this.db, input), input);
      return success(response, { value: publicValue(receipt.value), replayed: receipt.replayed });
    }
    const confirmedTemplateArchiveMatch = /^\/api\/confirmed-templates\/([^/]+)\/archive$/.exec(pathname);
    if (confirmedTemplateArchiveMatch && request.method === 'POST') {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Confirmed template writes require Skill/CLI authentication.');
      const input = { studioId: this.initialized.manifest.studioId, templateId: confirmedTemplateArchiveMatch[1] };
      const receipt = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'confirmed_templates.archive', () => archiveConfirmedTemplate(this.db, input), input);
      return success(response, { value: publicValue(receipt.value), replayed: receipt.replayed });
    }
    const confirmedTemplateRollbackMatch = /^\/api\/confirmed-templates\/([^/]+)\/rollback$/.exec(pathname);
    if (confirmedTemplateRollbackMatch && request.method === 'POST') {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', 'Confirmed template writes require Skill/CLI authentication.');
      const input = { studioId: this.initialized.manifest.studioId, templateId: confirmedTemplateRollbackMatch[1], version: numberValue(body.version) };
      const receipt = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'confirmed_templates.rollback', () => rollbackConfirmedTemplate(this.db, input), input);
      return success(response, { value: publicValue(receipt.value), replayed: receipt.replayed });
    }
    if (pathname === '/api/restart' && request.method === 'POST') {
      if (!daemonRestartAvailable()) throw new InvalidCommandError('当前服务不是受控 daemon，无法从 Workbench 重启。');
      success(response, { restarting: true });
      setImmediate(() => requestDaemonRestart());
      return;
    }
    if (pathname === '/api/shutdown' && request.method === 'POST') {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', '只有当前 Skill/CLI 可以关闭 Studio daemon。');
      if (!daemonShutdownAvailable()) throw new InvalidCommandError('当前服务不是受控 daemon，无法关闭。');
      success(response, { shuttingDown: true });
      setImmediate(() => requestDaemonShutdown());
      return;
    }
    if (pathname === '/api/providers' && request.method === 'POST') {
      return success(response, createProviderProfile(this.providerDb, { name: body.name, providerId: body.providerId, model: body.model, baseUrl: body.baseUrl, apiKey: body.apiKey, options: body.options, active: body.active === true, endpointTrustMode: body.endpointTrustMode, limits: body.limits, paths: this.initialized.paths, idempotencyKey: key }));
    }
    if (pathname === '/api/provider-models' && request.method === 'POST') {
      const profileId = text(body.profileId);
      const config = profileId ? providerModelConfigFromProfile(resolveProviderProfileForTest(this.providerDb, profileId, { paths: this.initialized.paths }), body) : draftProviderConfig(body);
      return success(response, await listProviderModelsForConfig(config));
    }
    const providerUpdateMatch = /^\/api\/providers\/([^/]+)$/.exec(pathname);
    if (providerUpdateMatch && request.method === 'PUT') {
      this.assertProviderProfileHasNoUnfinishedRuns(providerUpdateMatch[1], '修改');
      return success(response, updateProviderProfile(this.providerDb, providerUpdateMatch[1], { name: body.name, providerId: body.providerId, model: body.model, baseUrl: body.baseUrl, apiKey: body.apiKey, options: body.options, expectedConfigVersion: body.expectedConfigVersion, endpointTrustMode: body.endpointTrustMode, limits: body.limits, paths: this.initialized.paths, idempotencyKey: key }));
    }
    const providerCopyMatch = /^\/api\/providers\/([^/]+)\/copy$/.exec(pathname);
    if (providerCopyMatch && request.method === 'POST') return success(response, copyProviderProfile(this.providerDb, providerCopyMatch[1], { name: body.name, paths: this.initialized.paths, idempotencyKey: key }));
    const providerActivateMatch = /^\/api\/providers\/([^/]+)\/activate$/.exec(pathname);
    if (providerActivateMatch && request.method === 'POST') return success(response, activateProviderProfile(this.providerDb, providerActivateMatch[1], key, { paths: this.initialized.paths }));
    const providerDeleteMatch = /^\/api\/providers\/([^/]+)\/delete$/.exec(pathname);
    if (providerDeleteMatch && request.method === 'POST') {
      this.assertProviderProfileHasNoUnfinishedRuns(providerDeleteMatch[1], '删除');
      return success(response, deleteProviderProfile(this.providerDb, providerDeleteMatch[1], key, { force: body.force === true, paths: this.initialized.paths }));
    }
    const providerValidateMatch = /^\/api\/providers\/([^/]+)\/validate$/.exec(pathname);
    if (providerValidateMatch && request.method === 'POST') {
      const config = resolveProviderProfileForTest(this.providerDb, providerValidateMatch[1], { baseUrl: body.baseUrl, apiKey: body.apiKey, paths: this.initialized.paths });
      const validation = createImageProvider(config).validateConfig(config);
      return success(response, { valid: validation.valid, missing: validation.missing, descriptorVersion: config.descriptorVersion, adapterVersion: config.adapterVersion, warnings: config.baseUrl ? config.baseUrl.startsWith('http://') ? ['该 Provider endpoint 使用 HTTP；请确认这是受控测试或代理。'] : [] : [] });
    }
    const providerTestMatch = /^\/api\/providers\/([^/]+)\/test$/.exec(pathname);
    if (providerTestMatch && request.method === 'POST') {
      const config = resolveProviderProfileForTest(this.providerDb, providerTestMatch[1], { baseUrl: body.baseUrl, apiKey: body.apiKey, paths: this.initialized.paths });
      const validation = createImageProvider(config).validateConfig(config);
      if (!validation.valid) throw new InvalidCommandError('Provider 配置无效：' + [...validation.missing, ...(validation.errors || [])].join(', '));
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
      let probeResult: { reachable: boolean; status: number };
      try {
        const headers: Record<string, string> = { accept: 'application/json' };
        if (config.providerId === 'gemini-image') headers['x-goog-api-key'] = config.apiKey;
        else headers.authorization = 'Bearer ' + config.apiKey;
        const probeTarget = requestEndpointFor(config);
        if (!probeTarget) throw new InvalidCommandError('无法构造 Provider 生成端点，请检查 Base URL、Provider 类型和模型。');
        const privateAddressPolicy = config.endpointTrustMode === 'local_proxy' || config.endpointTrustMode === 'enterprise_private' ? config.endpointTrustMode : undefined;
        probeResult = await this.providerProbe(probeTarget, headers, controller.signal, privateAddressPolicy !== undefined, privateAddressPolicy);
      } catch {
        throw new InvalidCommandError(timedOut ? 'Provider 连接测试超时。请检查 Base URL 与网络后重试。' : '无法连接 Provider 端点。请检查 Base URL、网络和访问权限后重试。');
      } finally { clearTimeout(timeout); }
      const evidence = recordProviderTestEvidence(this.providerDb, providerTestMatch[1], { configVersion: config.configVersion, reachable: probeResult.reachable, status: probeResult.status, warnings: config.baseUrl.startsWith('http://') ? ['该 Provider endpoint 使用 HTTP；请确认这是受控测试或代理。'] : [] });
      return success(response, { connected: probeResult.reachable, status: probeResult.status, evidence });
    }
    const providerModelsMatch = /^\/api\/providers\/([^/]+)\/models$/.exec(pathname);
    if (providerModelsMatch && request.method === 'POST') {
      const current = resolveProviderProfileForTest(this.providerDb, providerModelsMatch[1], { paths: this.initialized.paths });
      return success(response, await listProviderModelsForConfig(providerModelConfigFromProfile(current, body)));
    }
    if (pathname === '/api/sessions/open') {
      const conversationId = text(body.conversationId);
      const session = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'sessions.open', () => openOrAttachStudioSession(this.db, { studioId: this.initialized.manifest.studioId, conversationId }), { conversationId });
      return success(response, session.value);
    }
    const sessionContextMatch = /^\/api\/sessions\/([^/]+)\/context$/.exec(pathname);
    if (sessionContextMatch) {
      this.assertSessionInStudio(sessionContextMatch[1]);
      if (text(body.projectId)) this.assertProjectInStudio(text(body.projectId));
      if (text(body.taskId)) this.assertTaskInStudio(text(body.taskId));
      if (text(body.roundId)) this.assertRoundInStudio(text(body.roundId));
      const context = { studioId: this.initialized.manifest.studioId, sessionId: sessionContextMatch[1], projectId: text(body.projectId) || undefined, taskId: text(body.taskId) || undefined, roundId: text(body.roundId) || undefined, expectedVersion: body.expectedVersion };
      return success(response, executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'sessions.context', () => updateStudioSessionContext(this.db, context), context).value);
    }
    const archiveProjectMatch = /^\/api\/projects\/([^/]+)\/archive$/.exec(pathname);
    if (archiveProjectMatch) { this.assertProjectInStudio(archiveProjectMatch[1]); return success(response, archiveProject(this.db, { studioId: this.initialized.manifest.studioId, projectId: archiveProjectMatch[1], idempotencyKey: key })); }
    const projectSelectionMatch = /^\/api\/projects\/([^/]+)\/selection\/assets\/([^/]+)$/.exec(pathname);
    if (projectSelectionMatch && request.method === 'POST') {
      const projectId = projectSelectionMatch[1];
      const assetId = projectSelectionMatch[2];
      this.assertProjectInStudio(projectId);
      this.assertAssetInStudio(assetId);
      const selected = body.selected === true;
      executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'projects.selection_asset', () => setProjectAssetSelected(this.db, { studioId: this.initialized.manifest.studioId, projectId, assetId, selected }), { projectId, assetId, selected });
      return success(response, { selection: projectSelectionPayload(this.db, this.initialized.manifest.studioId, projectId) });
    }
    const projectSelectionBatchMatch = /^\/api\/projects\/([^/]+)\/selection\/batch$/.exec(pathname);
    if (projectSelectionBatchMatch && request.method === 'POST') {
      const projectId = projectSelectionBatchMatch[1];
      this.assertProjectInStudio(projectId);
      const assetIds = boundedIds(body.assetIds, 'assetIds') || [];
      const selected = body.selected === true;
      const keepAssetIds = (boundedIds(body.keepAssetIds, 'keepAssetIds', { optional: true }) || []).filter((assetId) => assetIds.includes(assetId));
      const updated = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'projects.selection_batch', () => withTransaction(this.db, () => {
        if (selected && keepAssetIds.length) setReviewDecisions(this.db, { studioId: this.initialized.manifest.studioId, assetIds: keepAssetIds, decision: 'keep', context: { source: 'batch', projectId }, emitEvent: false });
        return setProjectAssetsSelected(this.db, { studioId: this.initialized.manifest.studioId, projectId, assetIds, selected });
      }), { projectId, assetIds, selected, keepAssetIds });
      return success(response, { ...updated.value, selection: projectSelectionPayload(this.db, this.initialized.manifest.studioId, projectId) });
    }
    const canvasLayoutMatch = /^\/api\/projects\/([^/]+)\/canvas-layout$/.exec(pathname);
    if (canvasLayoutMatch && request.method === 'POST') {
      const projectId = canvasLayoutMatch[1];
      this.assertProjectInStudio(projectId);
      const scopeType = (text(body.scopeType) || 'project') as CanvasLayoutScopeType;
      const scopeId = text(body.scopeId) || projectId;
      const saved = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'canvas.layout', () => saveCanvasLayout(this.db, { studioId: this.initialized.manifest.studioId, projectId, scopeType, scopeId, viewport: record(body.viewport) as never, settings: record(body.settings), nodes: Array.isArray(body.nodes) ? body.nodes as never : [], groups: Array.isArray(body.groups) ? body.groups as never : [], links: Array.isArray(body.links) ? body.links as never : [] }), { projectId, scopeType, scopeId, viewport: record(body.viewport), settings: record(body.settings), nodes: Array.isArray(body.nodes) ? body.nodes : [], groups: Array.isArray(body.groups) ? body.groups : [], links: Array.isArray(body.links) ? body.links : [] });
      return success(response, { layout: saved.value });
    }
    if (pathname === '/api/projects') {
      const created = createProject(this.db, { studioId: this.initialized.manifest.studioId, name: text(body.name), description: text(body.description) || undefined, templateId: text(body.templateId) || undefined, templateVersion: body.templateVersion === undefined ? undefined : numberValue(body.templateVersion), sessionId: text(body.sessionId) || undefined, idempotencyKey: key });
      return success(response, created);
    }
    if (pathname === '/api/delivery-batches' && request.method === 'POST') {
      const deliveryIds = boundedIds(body.deliveryIds, 'deliveryIds') || [];
      this.assertProjectInStudio(text(body.projectId));
      for (const deliveryId of deliveryIds) this.assertDeliveryInStudio(deliveryId);
      return success(response, createDeliveryBatch(this.db, { studioId: this.initialized.manifest.studioId, projectId: text(body.projectId), name: text(body.name), deliveryIds, idempotencyKey: key }));
    }
    const batchRevisionMatch = /^\/api\/delivery-batches\/([^/]+)\/revisions$/.exec(pathname);
    if (batchRevisionMatch && request.method === 'POST') {
      const deliveryIds = boundedIds(body.deliveryIds, 'deliveryIds') || [];
      this.assertDeliveryBatchInStudio(batchRevisionMatch[1]);
      for (const deliveryId of deliveryIds) this.assertDeliveryInStudio(deliveryId);
      return success(response, reviseDeliveryBatch(this.db, { studioId: this.initialized.manifest.studioId, batchId: batchRevisionMatch[1], deliveryIds, idempotencyKey: key }));
    }
    const batchReadyMatch = /^\/api\/delivery-batch-versions\/([^/]+)\/ready$/.exec(pathname);
    if (batchReadyMatch && request.method === 'POST') { this.assertDeliveryBatchVersionInStudio(batchReadyMatch[1]); return success(response, prepareDeliveryBatchVersion(this.db, { studioId: this.initialized.manifest.studioId, versionId: batchReadyMatch[1], idempotencyKey: key })); }
    if (pathname === '/api/deliveries/complete' && request.method === 'POST') {
      const assetIds = boundedIds(body.assetIds, 'assetIds') || [];
      const projectId = text(body.projectId);
      const phase = text(body.phase) as DeliveryCompletionPhase;
      this.assertProjectInStudio(projectId);
      for (const assetId of assetIds) this.assertAssetInStudio(assetId);
      return success(response, publicDeliveryCompletion(await completeDeliveryStepAsync(this.db, this.initialized.paths, { studioId: this.initialized.manifest.studioId, operationId: key, phase, projectId, name: text(body.name), assetIds, includeCreativeRecord: body.includeCreativeRecord === true })));
    }
    if (pathname === '/api/deliveries' && request.method === 'POST') { const assetIds = boundedIds(body.assetIds, 'assetIds') || []; this.assertProjectInStudio(text(body.projectId)); for (const assetId of assetIds) this.assertAssetInStudio(assetId); return success(response, createDelivery(this.db, { studioId: this.initialized.manifest.studioId, projectId: text(body.projectId), name: text(body.name), assetIds, includeCreativeRecord: body.includeCreativeRecord === true, idempotencyKey: key })); }
    const deliveryItemsMatch = /^\/api\/deliveries\/([^/]+)\/items$/.exec(pathname);
    if (deliveryItemsMatch && request.method === 'PUT') { const assetIds = boundedIds(body.assetIds, 'assetIds') || []; this.assertDeliveryInStudio(deliveryItemsMatch[1]); for (const assetId of assetIds) this.assertAssetInStudio(assetId); return success(response, updateDeliveryDraft(this.db, { studioId: this.initialized.manifest.studioId, deliveryId: deliveryItemsMatch[1], assetIds, includeCreativeRecord: typeof body.includeCreativeRecord === 'boolean' ? body.includeCreativeRecord : undefined, idempotencyKey: key })); }
    const readyDeliveryMatch = /^\/api\/deliveries\/([^/]+)\/ready$/.exec(pathname);
    if (readyDeliveryMatch && request.method === 'POST') { this.assertDeliveryInStudio(readyDeliveryMatch[1]); return success(response, prepareDelivery(this.db, { studioId: this.initialized.manifest.studioId, deliveryId: readyDeliveryMatch[1], idempotencyKey: key })); }
    const returnToDraftMatch = /^\/api\/deliveries\/([^/]+)\/draft$/.exec(pathname);
    if (returnToDraftMatch && request.method === 'POST') { this.assertDeliveryInStudio(returnToDraftMatch[1]); return success(response, returnDeliveryToDraft(this.db, { studioId: this.initialized.manifest.studioId, deliveryId: returnToDraftMatch[1], idempotencyKey: key })); }
    const exportDeliveryMatch = /^\/api\/deliveries\/([^/]+)\/export$/.exec(pathname);
    if (exportDeliveryMatch && request.method === 'POST') { this.assertDeliveryInStudio(exportDeliveryMatch[1]); return success(response, publicDeliveryExport(await exportDeliveryAsync(this.db, this.initialized.paths, { studioId: this.initialized.manifest.studioId, deliveryId: exportDeliveryMatch[1], idempotencyKey: key }))); }
    if (pathname === '/api/task-types') return success(response, publicValue(createUserTaskType(this.db, { studioId: this.initialized.manifest.studioId, name: text(body.name), definition: record(body.definition), idempotencyKey: key })));
    if (pathname === '/api/style-kits') { const assetIds = boundedIds(body.assetIds, 'assetIds', { optional: true }) || []; for (const assetId of assetIds) this.assertAssetInStudio(assetId); return success(response, publicValue(createStyleKit(this.db, { studioId: this.initialized.manifest.studioId, name: text(body.name), definition: record(body.definition), assetIds, idempotencyKey: key }))); }
    if (pathname === '/api/brand-kits') { const assetIds = boundedIds(body.assetIds, 'assetIds', { optional: true }) || []; for (const assetId of assetIds) this.assertAssetInStudio(assetId); return success(response, publicValue(createBrandKit(this.db, { studioId: this.initialized.manifest.studioId, name: text(body.name), definition: record(body.definition), assetIds, idempotencyKey: key }))); }
    if (pathname === '/api/tasks') {
      this.assertProjectInStudio(text(body.projectId));
      if (text(body.sessionId)) this.assertSessionInStudio(text(body.sessionId));
      const created = createTaskDraft(this.db, { studioId: this.initialized.manifest.studioId, projectId: text(body.projectId), name: text(body.name), taskTypeId: text(body.taskTypeId) || undefined, styleKitId: text(body.styleKitId) || undefined, brandKitId: text(body.brandKitId) || undefined, intent: record(body.intent), sessionId: text(body.sessionId) || undefined, idempotencyKey: key });
      return success(response, created);
    }
    if (pathname === '/api/rounds/derived' && request.method === 'POST') {
      const taskId = text(body.taskId);
      const purpose = text(body.purpose);
      if (!DERIVED_PURPOSES.has(purpose)) throw new InvalidCommandError('图片驱动轮次只支持变体、精修、局部编辑或补图。');
      this.assertTaskInStudio(taskId);
      const task = getTask(this.db, this.initialized.manifest.studioId, taskId);
      if (!task) throw new InvalidCommandError('任务不存在或不属于当前 Studio。');
      if (text(body.parentRoundId)) this.assertRoundInStudio(text(body.parentRoundId));
      if (text(body.sessionId)) this.assertSessionInStudio(text(body.sessionId));
      const sourceAssetIds = boundedIds(body.sourceAssetIds, 'sourceAssetIds', { max: 32 }) || [];
      if (!sourceAssetIds.length) throw new InvalidCommandError('至少选择一张图片作为下一轮参考。');
      for (const assetId of sourceAssetIds) this.assertAssetInStudio(assetId);
      const access = inspectProjectAssetAccess(this.db, { studioId: this.initialized.manifest.studioId, projectId: task.projectId, assetIds: sourceAssetIds });
      for (const assetId of sourceAssetIds) if (!projectAssetReferenceAllowed(access.get(assetId))) throw new InvalidCommandError('图片驱动轮次素材必须来自当前项目或已明确共享素材。');
      const created = createRoundDraft(this.db, { studioId: this.initialized.manifest.studioId, taskId, purpose: purpose as 'variation' | 'refinement' | 'edit' | 'fill', parentRoundId: text(body.parentRoundId) || undefined, plan: derivedRoundPlan(body, purpose, sourceAssetIds), sessionId: text(body.sessionId) || undefined, idempotencyKey: key });
      return success(response, created);
    }
    if (pathname === '/api/rounds') {
      this.assertTaskInStudio(text(body.taskId));
      if (text(body.parentRoundId)) this.assertRoundInStudio(text(body.parentRoundId));
      if (text(body.sessionId)) this.assertSessionInStudio(text(body.sessionId));
      const created = createRoundDraft(this.db, { studioId: this.initialized.manifest.studioId, taskId: text(body.taskId), purpose: text(body.purpose) as 'exploration' | 'refinement' | 'variation' | 'edit' | 'fill', parentRoundId: text(body.parentRoundId) || undefined, plan: record(body.plan), sessionId: text(body.sessionId) || undefined, idempotencyKey: key });
      return success(response, created);
    }
    const draftContextMatch = /^\/api\/rounds\/([^/]+)\/draft-context$/.exec(pathname);
    if (draftContextMatch && request.method === 'PUT') {
      this.assertRoundInStudio(draftContextMatch[1]);
      const updated = updateRoundDraftContext(this.db, { studioId: this.initialized.manifest.studioId, roundId: draftContextMatch[1], plan: record(body.plan), expectedVersion: numberValue(body.expectedVersion), idempotencyKey: key });
      return success(response, updated);
    }
    const planMatch = /^\/api\/rounds\/([^/]+)\/plan$/.exec(pathname);
    if (planMatch && request.method === 'POST') {
      this.assertRoundInStudio(planMatch[1]);
      const prepared = prepareRoundForConfirmation(this.db, { studioId: this.initialized.manifest.studioId, roundId: planMatch[1], plan: record(body.plan), expectedVersion: numberValue(body.expectedVersion), idempotencyKey: key });
      return success(response, prepared);
    }
    const challengeMatch = /^\/api\/rounds\/([^/]+)\/confirmation-challenge$/.exec(pathname);
    if (challengeMatch) {
      this.assertRoundInStudio(challengeMatch[1]);
      const session = getStudioSession(this.db, { studioId: this.initialized.manifest.studioId, sessionId: text(body.sessionId) });
      if (session.activeRoundId !== challengeMatch[1]) throw new InvalidCommandError('确认挑战必须绑定当前会话的活动轮次。');
      const round = getRound(this.db, this.initialized.manifest.studioId, challengeMatch[1]);
      const [currentPlan] = listRoundPlanVersions(this.db, this.initialized.manifest.studioId, challengeMatch[1]);
      const planStateAllowed = Boolean(round && currentPlan && currentPlan.planVersion === round.planVersion && ((round.status === 'awaiting_confirmation' && currentPlan.state === 'awaiting_confirmation') || (round.status === 'active' && currentPlan.state === 'confirmed')));
      if (!round || !currentPlan || !planStateAllowed) throw new InvalidCommandError('当前轮次没有可确认的计划。');
      return success(response, this.confirmationGate.createChallenge({ roundId: round.id, sessionId: session.id, conversationId: session.conversationId, planHash: planHash(currentPlan.plan), expectedVersion: round.version }));
    }
    const confirmMatch = /^\/api\/rounds\/([^/]+)\/confirm$/.exec(pathname);
    if (confirmMatch) {
      this.assertRoundInStudio(confirmMatch[1]);
      if (authentication !== 'cookie') throw new LocalAccessError(403, 'forbidden', '创作确认必须由已授权 Workbench 中的真实用户完成。');
      const roundId = confirmMatch[1];
      const sessionId = text(body.sessionId);
      const expectedVersion = numberValue(body.expectedVersion);
      const challengeValue = text(body.challenge);
      const internalPlanKey = 'confirm-plan-' + createHash('sha256').update(key).digest('hex');
      const confirmed = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'rounds.confirm_user', () => {
        const challenge = this.confirmationGate.getChallenge(roundId);
        if (!challenge || challenge.sessionId !== sessionId) throw new InvalidCommandError('确认会话必须与待处理确认挑战绑定的会话一致。');
        const session = getStudioSession(this.db, { studioId: this.initialized.manifest.studioId, sessionId });
        if (session.conversationId !== challenge.conversationId || !this.confirmationGate.validateChallenge({ roundId, challenge: challengeValue, sessionId, planHash: challenge.planHash })) throw new InvalidCommandError('确认挑战无效、已过期或与当前计划不一致。');
        const currentRound = getRound(this.db, this.initialized.manifest.studioId, roundId);
        const [currentPlan] = listRoundPlanVersions(this.db, this.initialized.manifest.studioId, roundId);
        if (!currentRound || !currentPlan || currentRound.version !== challenge.expectedVersion || currentPlan.planVersion !== currentRound.planVersion || challenge.planHash !== planHash(currentPlan.plan) || currentRound.version !== expectedVersion) throw new InvalidCommandError('确认挑战无效、已过期或与当前计划不一致。');
        if (currentRound.status === 'awaiting_confirmation') return confirmRoundPlan(this.db, { studioId: this.initialized.manifest.studioId, roundId, expectedVersion, idempotencyKey: internalPlanKey }).value;
        if (currentRound.status === 'active' && currentPlan.state === 'confirmed') return currentRound;
        throw new InvalidCommandError('当前轮次没有可确认的计划。');
      }, { roundId, sessionId, expectedVersion, challenge: challengeValue });
      let consent = this.confirmationGate.consentFor(roundId, sessionId);
      if (!consent) {
        const challenge = this.confirmationGate.getChallenge(roundId);
        if (!challenge) throw new InvalidCommandError('确认状态已失效，请重新发起确认挑战。');
        try {
          consent = this.confirmationGate.confirm({ roundId, challenge: challengeValue, sessionId, planHash: challenge.planHash });
        } catch {
          throw new InvalidCommandError('确认挑战无效、已过期或与当前计划不一致。');
        }
      }
      return success(response, { ...confirmed, confirmation: consent });
    }
    const preflightMatch = /^\/api\/rounds\/([^/]+)\/preflight$/.exec(pathname);
    if (preflightMatch) {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', '预检必须由当前智能体会话在用户确认后提交。');
      assertAllowedBodyKeys(body, ['sessionId', 'executionConcurrency', 'concurrencySource', 'usageEstimate'], 'Preflight');
      this.assertRoundInStudio(preflightMatch[1]);
      this.assertConfirmedRoundSession(preflightMatch[1], text(body.sessionId));
      const usageEstimate = body.usageEstimate === undefined ? undefined : body.usageEstimate as UsageEstimate;
      const config = resolveActiveProviderConfig(this.providerDb, this.initialized.paths);
      const status = providerStatus(this.providerDb, this.initialized.paths);
      if (!config) return success(response, { preview: null, preflight: preflightRound(this.db, { studioId: this.initialized.manifest.studioId, roundId: preflightMatch[1], providerStatus: status, usageEstimate }) });
      const receipt = createDryRunPreview(this.db, { studioId: this.initialized.manifest.studioId, roundId: preflightMatch[1], providerConfig: config, providerStatus: status, executionConcurrency: body.executionConcurrency, concurrencySource: body.concurrencySource, usageEstimate, idempotencyKey: key });
      if (!receipt.value.preview) return success(response, receipt);
      const session = getStudioSession(this.db, { studioId: this.initialized.manifest.studioId, sessionId: text(body.sessionId) });
      const consent = this.confirmationGate.consentFor(preflightMatch[1], session.id);
      if (!consent) throw new InvalidCommandError('预检前必须在 Workbench 完成与当前计划匹配的用户确认。');
      const frozenPlanHash = planHash(receipt.value.preview.planSnapshot);
      const confirmToken = this.confirmationGate.issueToken({ roundId: preflightMatch[1], preflightId: receipt.value.preview.id, planHash: frozenPlanHash, conversationId: consent.conversationId });
      return success(response, { ...receipt, value: { ...receipt.value, confirmToken } });
    }
    if (pathname === '/api/runs') {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', '生成运行必须由当前智能体会话在用户确认后提交。');
      const roundId = text(body.roundId);
       const preflightId = text(body.preflightId);
       this.assertRoundInStudio(roundId);
       if (preflightId) this.assertDryRunInStudio(preflightId);
      if (body.requestedConcurrency !== undefined || body.executionConcurrency !== undefined || body.concurrencySource !== undefined) throw new InvalidCommandError('并发必须在预检时确定；请重新预检。');
      const config = resolveActiveProviderConfig(this.providerDb, this.initialized.paths);
      if (!config) throw new InvalidCommandError('当前工作区没有可用的图片生成配置。');
       const preview = preflightId ? getDryRunPreview(this.db, this.initialized.manifest.studioId, roundId, preflightId) : null;
      if (!preview) throw new InvalidCommandError('预检证据不存在或不属于当前轮次。');
      const consent = this.confirmationGate.consentFor(roundId);
      if (!consent) throw new InvalidCommandError('运行需要当前会话的用户确认。');
      const tokenValid = this.confirmationGate.verifyToken(text(body.confirmToken), { roundId, preflightId, planHash: planHash(preview.planSnapshot), conversationId: consent.conversationId });
      if (!tokenValid) throw new InvalidCommandError('运行需要 daemon 签发且与计划、预检和会话绑定的 confirm_token。');
      const token = text(body.confirmToken);
      const tokenClaims = { roundId, preflightId, planHash: planHash(preview.planSnapshot), conversationId: consent.conversationId };
      let reservation: { replayed: boolean };
      try {
        reservation = this.confirmationGate.reserveToken(token, tokenClaims, key);
      } catch {
        throw new InvalidCommandError('confirm_token 已经授权过其他运行操作，不能使用不同的幂等键重放。');
      }
      try {
        const queued = queueGenerationRun(this.db, { studioId: this.initialized.manifest.studioId, roundId, providerConfig: config, providerStatus: providerStatus(this.providerDb, this.initialized.paths), preflightId, idempotencyKey: key });
        return success(response, queued);
      } catch (error) {
        if (!reservation.replayed) this.confirmationGate.releaseToken(token, key);
        throw error;
      }
    }
    const externalReconciliationMatch = /^\/api\/runs\/([^/]+)\/items\/([^/]+)\/reconcile$/.exec(pathname);
    if (externalReconciliationMatch && request.method === 'POST') {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', '外部请求对账必须由当前 Skill/CLI 显式发起。');
      const runId = externalReconciliationMatch[1];
      const itemId = externalReconciliationMatch[2];
      this.assertRunInStudio(runId);
      this.assertRunItemInStudio(itemId);
      this.assertRunItemBelongsToRunInStudio(runId, itemId);
      const providerConfig = this.resolveRunProviderConfig(runId);
      let provider: ImageProvider | null = null;
      if (providerConfig) {
        try {
          provider = createImageProvider(providerConfig);
        } catch {
          provider = null;
        }
      }
      const result = await reconcileExternalRunItem({
        db: this.db,
        studioId: this.initialized.manifest.studioId,
        runId,
        itemId,
        idempotencyKey: key,
        provider,
        providerConfig,
        assetPersister: new StudioGeneratedAssetPersister({ db: this.db, paths: this.initialized.paths, studioId: this.initialized.manifest.studioId })
      });
      return success(response, result);
    }
    const pauseMatch = /^\/api\/runs\/([^/]+)\/pause$/.exec(pathname);
    if (pauseMatch) { if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', '运行控制必须由当前 Skill/CLI 发起。'); this.assertRunInStudio(pauseMatch[1]); return success(response, pauseGenerationRun(this.db, { studioId: this.initialized.manifest.studioId, runId: pauseMatch[1], idempotencyKey: key })); }
    const resolveUnknownMatch = /^\/api\/runs\/([^/]+)\/outcomes\/resolve$/.exec(pathname);
    if (resolveUnknownMatch) { if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', '运行控制必须由当前 Skill/CLI 发起。'); const itemIds = boundedIds(body.itemIds, 'itemIds') || []; this.assertRunInStudio(resolveUnknownMatch[1]); for (const itemId of itemIds) this.assertRunItemInStudio(itemId); return success(response, resolveUnknownRunItems(this.db, { studioId: this.initialized.manifest.studioId, runId: resolveUnknownMatch[1], itemIds, idempotencyKey: key })); }
    const retryMatch = /^\/api\/runs\/([^/]+)\/retry$/.exec(pathname);
    if (retryMatch) {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', '运行控制必须由当前 Skill/CLI 发起。');
      assertAllowedBodyKeys(body, ['itemIds', 'timeoutMs'], 'Run retry');
      const itemIds = boundedIds(body.itemIds, 'itemIds', { optional: true });
      const timeoutMs = body.timeoutMs === undefined ? undefined : numberValue(body.timeoutMs);
      this.assertRunInStudio(retryMatch[1]);
      for (const itemId of itemIds || []) this.assertRunItemInStudio(itemId);
      return success(response, retryGenerationRunItems(this.db, { studioId: this.initialized.manifest.studioId, runId: retryMatch[1], itemIds, timeoutMs, idempotencyKey: key }));
    }
    const resumeMatch = /^\/api\/runs\/([^/]+)\/resume$/.exec(pathname);
    if (resumeMatch) {
      if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', '运行恢复必须由当前 Skill/CLI 在用户重新确认后提交。');
      this.assertRunInStudio(resumeMatch[1]);
      const sessionId = text(body.sessionId);
      this.assertResumeSession(resumeMatch[1], sessionId);
      const config = resolveActiveProviderConfig(this.providerDb, this.initialized.paths);
      const run = getGenerationRun(this.db, resumeMatch[1]);
      const runProfileId = typeof run?.providerSnapshot.profileId === 'string' ? run.providerSnapshot.profileId : '';
      const runConfigVersion = Number(run?.providerSnapshot.configVersion);
      if (!config || runProfileId !== config.profileId || runConfigVersion !== config.configVersion) throw new InvalidCommandError('Provider 配置已变化，旧运行不能静默切换；请恢复原 Profile 或创建新轮次。');
      return success(response, resumeGenerationRun(this.db, { studioId: this.initialized.manifest.studioId, runId: resumeMatch[1], sessionId, idempotencyKey: key }));
    }
    const cancelMatch = /^\/api\/runs\/([^/]+)\/cancel$/.exec(pathname);
    if (cancelMatch) { if (authentication !== 'bearer') throw new LocalAccessError(403, 'forbidden', '运行控制必须由当前 Skill/CLI 发起。'); this.assertRunInStudio(cancelMatch[1]); return success(response, cancelGenerationRun(this.db, { studioId: this.initialized.manifest.studioId, runId: cancelMatch[1], idempotencyKey: key })); }
    const reviewMatch = /^\/api\/assets\/([^/]+)\/review$/.exec(pathname);
    if (reviewMatch && request.method === 'POST') {
      assertAllowedBodyKeys(body, ['decision', 'taskId', 'roundId', 'context', 'feedback'], 'Review');
      this.assertAssetInStudio(reviewMatch[1]);
      if (text(body.taskId)) this.assertTaskInStudio(text(body.taskId));
      if (text(body.roundId)) this.assertRoundInStudio(text(body.roundId));
      const reviewed = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'assets.review', () => {
        const decision = text(body.decision) as 'keep' | 'review' | 'reject' | 'derive';
        setReviewDecision(this.db, { studioId: this.initialized.manifest.studioId, assetId: reviewMatch[1], decision, taskId: text(body.taskId) || undefined, roundId: text(body.roundId) || undefined, context: body.context, feedback: body.feedback });
        return { assetId: reviewMatch[1], decision };
      }, { assetId: reviewMatch[1], decision: text(body.decision), taskId: text(body.taskId) || undefined, roundId: text(body.roundId) || undefined, context: body.context, feedback: body.feedback });
      return success(response, reviewed.value);
    }
    const sharedAssetMatch = /^\/api\/assets\/([^/]+)\/shared$/.exec(pathname);
    if (sharedAssetMatch && request.method === 'POST') { this.assertAssetInStudio(sharedAssetMatch[1]); return success(response, executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'assets.share', () => setStudioAssetShared(this.db, { studioId: this.initialized.manifest.studioId, assetId: sharedAssetMatch[1], shared: body.shared === true }), { assetId: sharedAssetMatch[1], shared: body.shared === true }).value); }
    const trashMatch = /^\/api\/assets\/([^/]+)\/trash$/.exec(pathname);
    if (trashMatch) { this.assertAssetInStudio(trashMatch[1]); return success(response, publicAsset(executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'assets.trash', () => softDeleteAsset(this.db, this.initialized.paths, { studioId: this.initialized.manifest.studioId, assetId: trashMatch[1] }), { assetId: trashMatch[1] }).value)); }
    const restoreMatch = /^\/api\/assets\/([^/]+)\/restore$/.exec(pathname);
    if (restoreMatch) { this.assertAssetInStudio(restoreMatch[1]); return success(response, publicAsset(executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'assets.restore', () => restoreAsset(this.db, this.initialized.paths, { studioId: this.initialized.manifest.studioId, assetId: restoreMatch[1] }), { assetId: restoreMatch[1] }).value)); }
    return json(response, 404, { ok: false, error: { code: 'not_found', message: '未找到请求的 Studio API。' } });
  }

  private workbench(response: ServerResponse, pathname: string): void {
    const candidate = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(this.workbenchDir, candidate);
    if (!filePath.startsWith(this.workbenchDir + path.sep) && filePath !== path.join(this.workbenchDir, 'index.html')) {
      throw new InvalidCommandError('无效的 Workbench 资源路径。');
    }
    const resolved = fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : path.join(this.workbenchDir, 'index.html');
    if (!fs.existsSync(resolved)) throw new StudioNotFoundError('未找到已构建的 Workbench。');
    const extension = path.extname(resolved).toLowerCase();
    const mediaTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json; charset=utf-8' };
    response.writeHead(200, { 'content-type': mediaTypes[extension] || 'application/octet-stream', 'cache-control': extension === '.html' ? 'no-cache' : 'public, max-age=3600', 'x-content-type-options': 'nosniff' });
    fs.createReadStream(resolved).on('error', () => response.destroy()).pipe(response);
  }

  private assertProjectInStudio(projectId: string): void {
    const project = this.db.prepare('SELECT 1 FROM projects WHERE id = ? AND studio_id = ?').get(projectId, this.initialized.manifest.studioId);
    if (!project) throw new StudioNotFoundError('Project not found in this Studio: ' + projectId);
  }

  private assertScopedId(id: string, label: string, sql: string): void {
    if (!this.db.prepare(sql).get(id, this.initialized.manifest.studioId)) throw new StudioNotFoundError(label + ' not found in this Studio: ' + id);
  }

  private assertSessionInStudio(sessionId: string): void { this.assertScopedId(sessionId, 'Studio session', 'SELECT 1 FROM studio_sessions WHERE id = ? AND studio_id = ?'); }
  private assertTaskInStudio(taskId: string): void { this.assertScopedId(taskId, 'Creative task', 'SELECT 1 FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.id = ? AND project.studio_id = ?'); }
  private assertDryRunInStudio(previewId: string): void { this.assertScopedId(previewId, 'Dry-run preview', 'SELECT 1 FROM dry_run_previews preview JOIN creative_rounds round ON round.id = preview.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE preview.id = ? AND project.studio_id = ?'); }
  private assertRoundInStudio(roundId: string): void { this.assertScopedId(roundId, 'Creative round', 'SELECT 1 FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.id = ? AND project.studio_id = ?'); }
  private assertRunInStudio(runId: string): void { this.assertScopedId(runId, 'Generation run', 'SELECT 1 FROM generation_runs run JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE run.id = ? AND project.studio_id = ?'); }
  private assertRunItemInStudio(itemId: string): void { this.assertScopedId(itemId, 'Generation run item', 'SELECT 1 FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE item.id = ? AND project.studio_id = ?'); }
  private assertRunItemBelongsToRunInStudio(runId: string, itemId: string): void {
    const row = this.db.prepare('SELECT item.id FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE item.id = ? AND item.run_id = ? AND project.studio_id = ?').get(itemId, runId, this.initialized.manifest.studioId);
    if (!row) throw new StudioNotFoundError('Generation run item not found in this run: ' + itemId);
  }
  private resolveRunProviderConfig(runId: string): ResolvedProviderConfig | null {
    const row = this.db.prepare('SELECT run.provider_profile_id, run.provider_config_version FROM generation_runs run JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE run.id = ? AND project.studio_id = ?').get(runId, this.initialized.manifest.studioId) as { provider_profile_id: string | null; provider_config_version: number | null } | undefined;
    if (!row || typeof row.provider_profile_id !== 'string' || !row.provider_profile_id.trim() || !Number.isSafeInteger(Number(row.provider_config_version)) || Number(row.provider_config_version) < 1) return null;
    try {
      return resolveProviderProfileConfig(this.providerDb, row.provider_profile_id, this.initialized.paths);
    } catch {
      return null;
    }
  }

  private assertAssetInStudio(assetId: string): void { this.assertScopedId(assetId, 'Asset', 'SELECT 1 FROM assets WHERE id = ? AND studio_id = ?'); }
  private assertDeliveryBatchInStudio(batchId: string): void { this.assertScopedId(batchId, 'Delivery batch', 'SELECT 1 FROM delivery_batches batch JOIN projects project ON project.id = batch.project_id WHERE batch.id = ? AND project.studio_id = ?'); }
  private assertDeliveryBatchVersionInStudio(versionId: string): void { this.assertScopedId(versionId, 'Delivery batch version', 'SELECT 1 FROM delivery_batch_versions version JOIN delivery_batches batch ON batch.id = version.batch_id JOIN projects project ON project.id = batch.project_id WHERE version.id = ? AND project.studio_id = ?'); }

  private assertDeliveryInStudio(deliveryId: string): void {
    this.assertScopedId(deliveryId, 'Delivery', 'SELECT 1 FROM deliveries delivery JOIN projects project ON project.id = delivery.project_id WHERE delivery.id = ? AND project.studio_id = ?');
  }
  private assertConfirmedRoundSession(roundId: string, sessionId: string): void {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) throw new InvalidCommandError('预检需要明确的 Studio Session。');
    const session = getStudioSession(this.db, { studioId: this.initialized.manifest.studioId, sessionId: normalizedSessionId });
    if (session.activeRoundId !== roundId) throw new InvalidCommandError('预检必须绑定当前会话的活动轮次。');
    const round = getRound(this.db, this.initialized.manifest.studioId, roundId);
    const [currentPlan] = listRoundPlanVersions(this.db, this.initialized.manifest.studioId, roundId);
    if (!round || round.status !== 'active' || !currentPlan || currentPlan.planVersion !== round.planVersion || currentPlan.state !== 'confirmed') throw new InvalidCommandError('预检前必须先确认当前创作计划。');
    const consent = this.confirmationGate.consentFor(roundId, normalizedSessionId);
    if (!consent || consent.conversationId !== session.conversationId || consent.planHash !== planHash(currentPlan.plan)) throw new InvalidCommandError('预检前必须在 Workbench 完成与当前计划匹配的用户确认。');
  }

  private assertResumeSession(runId: string, sessionId: string): void {
    const normalizedSessionId = text(sessionId);
    if (!normalizedSessionId) throw new InvalidCommandError('恢复运行需要明确的 Studio Session。');
    const run = this.db.prepare('SELECT run.round_id FROM generation_runs run JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE run.id = ? AND project.studio_id = ?').get(runId, this.initialized.manifest.studioId) as { round_id: string } | undefined;
    if (!run) throw new StudioNotFoundError('Generation run not found: ' + runId);
    const session = getStudioSession(this.db, { studioId: this.initialized.manifest.studioId, sessionId: normalizedSessionId });
    if (session.activeRoundId !== run.round_id) throw new InvalidCommandError('恢复运行必须绑定所属创作轮次的当前 Studio Session。');
    const round = getRound(this.db, this.initialized.manifest.studioId, run.round_id);
    const [currentPlan] = listRoundPlanVersions(this.db, this.initialized.manifest.studioId, run.round_id);
    const consent = this.confirmationGate.consentFor(run.round_id, normalizedSessionId);
    if (!round || round.status !== 'active' || !currentPlan || currentPlan.planVersion !== round.planVersion || currentPlan.state !== 'confirmed' || !consent || consent.conversationId !== session.conversationId || consent.planHash !== planHash(currentPlan.plan)) throw new InvalidCommandError('恢复运行前必须在 Workbench 重新确认当前创作计划。');
  }

  private assertImportTarget(targetType?: string, targetId?: string): void {
    if (Boolean(targetType) !== Boolean(targetId)) throw new InvalidCommandError('导入关系必须同时提供目标类型和目标 ID。');
    if (!targetType || !targetId) return;
    const queries: Record<string, string> = {
      project: 'SELECT 1 FROM projects WHERE id = ? AND studio_id = ?',
      creative_task: 'SELECT 1 FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.id = ? AND project.studio_id = ?',
      creative_round: 'SELECT 1 FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.id = ? AND project.studio_id = ?',
      run_item: 'SELECT 1 FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE item.id = ? AND project.studio_id = ?',
      style_kit: 'SELECT 1 FROM style_kits WHERE id = ? AND studio_id = ?',
      brand_kit: 'SELECT 1 FROM brand_kits WHERE id = ? AND studio_id = ?',
      delivery: 'SELECT delivery.id FROM deliveries delivery JOIN projects project ON project.id = delivery.project_id WHERE delivery.id = ? AND project.studio_id = ?'
    };
    const query = queries[targetType];
    if (!query) throw new InvalidCommandError('不支持该导入关系目标。');
    if (!this.db.prepare(query).get(targetId, this.initialized.manifest.studioId)) throw new StudioNotFoundError('未找到当前 Studio 中的导入关系目标。');
  }
  private async importAsset(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const key = headerValue(request, 'idempotency-key');
    if (!key) throw new InvalidCommandError('导入图片需要 idempotency-key。');
    const mediaType = imageUploadMediaType(request);
    const targetType = headerValue(request, 'x-daoge-target-type') || undefined;
    const targetId = headerValue(request, 'x-daoge-target-id') || undefined;
    const originalFilename = headerValue(request, 'x-daoge-filename') || undefined;
    const materialNeed = decodedHeaderText(request, 'x-daoge-material-need', '素材需求');
    if (materialNeed.length > 120) throw new InvalidCommandError('素材需求不能超过 120 个字符。');
    const materialUsage = importMaterialUsage(headerValue(request, 'x-daoge-material-usage'));
    this.assertImportTarget(targetType, targetId);
    const staged = await stageImageStream(this.initialized.paths, request, mediaType, { deferValidation: true });
    try {
      const receipt = await executeIdempotentAsync(this.db, this.initialized.manifest.studioId, key, 'assets.import', () => importStagedStudioAssetAsync(this.db, this.initialized.paths, {
        studioId: this.initialized.manifest.studioId,
        staged,
        declaredMediaType: mediaType,
        originalFilename,
        targetType,
        targetId,
        source: compactJsonRecord({ channel: 'workbench_upload', idempotencyKey: key, materialNeed, materialUsage }),
        archiveStagedImage: (stagedImage, archiveInput) => this.mediaWorkerPool.run<Extract<MediaJobResult, { type: 'archive-staged' }>>({ type: 'archive-staged', staged: stagedImage, assetId: archiveInput.assetId, bucket: archiveInput.bucket })
      }), { contentHash: staged.contentHash, mediaType: staged.mediaType, targetType, targetId, originalFilename, materialNeed, materialUsage });
      success(response, publicAsset(receipt.value));
    } finally {
      discardStagedImage(staged);
    }
  }

  private async writeImageArchive(request: IncomingMessage, response: ServerResponse, filename: string, fallback: string, entries: MediaZipEntry[]): Promise<void> {
    if (!entries.length) throw new InvalidCommandError('请至少选择一张图片进行打包下载。');
    if (entries.length > MAX_ARCHIVE_IMAGE_COUNT) throw new InvalidCommandError('单次打包最多支持 ' + MAX_ARCHIVE_IMAGE_COUNT + ' 张图片。');
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    response.once('close', abort);
    let archivePath = '';
    try {
      const result = await this.mediaWorkerPool.run<Extract<MediaJobResult, { type: 'zip' }>>({ type: 'zip', entries, maxEntries: MAX_ARCHIVE_IMAGE_COUNT, maxAggregateBytes: MAX_ARCHIVE_BYTES, maxEntryBytes: MAX_IMAGE_UPLOAD_BYTES }, controller.signal);
      archivePath = result.path;
      const opened = await openVerifiedManagedFileAsync(archivePath, { contentHash: result.contentHash, byteSize: result.byteSize, minByteSize: 1, maxByteSize: MAX_ARCHIVE_BYTES + MAX_ARCHIVE_IMAGE_COUNT * 1024 + 64 * 1024 });
      response.removeListener('close', abort);
      streamVerifiedFileResponse(request, response, opened, { 'content-type': 'application/zip', 'content-disposition': archiveContentDisposition(filename, fallback), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }, '"daoge-zip-' + result.contentHash + '"', () => { fs.rmSync(archivePath, { force: true }); });
    } catch (error) {
      response.removeListener('close', abort);
      if (archivePath) fs.rmSync(archivePath, { force: true });
      if (!response.destroyed && !response.headersSent) throw error;
      if (!response.destroyed) response.destroy(error instanceof Error ? error : undefined);
    }
  }

  private async projectAssetArchive(request: IncomingMessage, response: ServerResponse, projectId: string, requestedAssetIds: string[]): Promise<void> {
    this.assertProjectInStudio(projectId);
    const project = this.db.prepare('SELECT name FROM projects WHERE id = ? AND studio_id = ?').get(projectId, this.initialized.manifest.studioId) as { name: string } | undefined;
    if (!project) throw new StudioNotFoundError('项目不存在：' + projectId);
    const assetIds = [...new Set(requestedAssetIds.map((value) => value.trim()).filter(Boolean))];
    const projectAssets = listScopedStudioAssetsByIds(this.db, this.initialized.manifest.studioId, { scope: 'project', projectId, assetIds });
    const available = new Map(projectAssets.map((asset) => [asset.id, asset]));
    const assets = assetIds.map((assetId) => {
      const asset = available.get(assetId);
      if (!asset) throw new StudioNotFoundError('项目中未找到要打包的图片。');
      return asset;
    });
    const entries: MediaZipEntry[] = assets.map((asset, index) => ({ name: 'image-' + String(index + 1).padStart(3, '0') + '.' + imageExtension(asset.mediaType), source: assetMediaSource(asset) }));
    const timestamp = archiveTimestamp();
    await this.writeImageArchive(request, response, archiveFilename(project.name + '-项目资产', timestamp), 'daoge-pic-project-assets-' + timestamp + '.zip', entries);
  }
  private async deliveryArchive(request: IncomingMessage, response: ServerResponse, deliveryId: string, requestedSequences: string[]): Promise<void> {
    this.assertDeliveryInStudio(deliveryId);
    const delivery = this.db.prepare('SELECT delivery.id, delivery.name, delivery.status, delivery.manifest_json, project.name AS project_name FROM deliveries delivery JOIN projects project ON project.id = delivery.project_id WHERE delivery.id = ? AND project.studio_id = ?').get(deliveryId, this.initialized.manifest.studioId) as { id: string; name: string; status: string; manifest_json: string; project_name: string } | undefined;
    if (!delivery || delivery.status !== 'exported') throw new StudioNotFoundError('已完成交付不存在：' + deliveryId);
    let manifest: Record<string, unknown>;
    try { manifest = record(JSON.parse(delivery.manifest_json)); } catch { throw new InvalidCommandError('交付文件记录无效。'); }
    const relativeDirectory = typeof manifest.exportDirectory === 'string' ? manifest.exportDirectory : '';
    const files = Array.isArray(manifest.files) ? manifest.files.map(record) : [];
    const sequences = requestedSequences.length ? [...new Set(requestedSequences.map((value) => {
      const sequence = Number(value);
      if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new InvalidCommandError('交付图片选择无效。');
      return sequence;
    }))] : [];
    const selected = sequences.length ? files.filter((item) => sequences.includes(Number(item.sequence))) : files;
    if (!selected.length) throw new StudioNotFoundError('未找到要打包的交付图片。');
    const entries: MediaZipEntry[] = selected.map((item, index) => {
      const file = typeof item.file === 'string' ? item.file : '';
      const mediaType = typeof item.mediaType === 'string' ? item.mediaType : '';
      const contentHash = typeof item.contentHash === 'string' ? item.contentHash : '';
      const byteSize = Number.isSafeInteger(item.byteSize) ? Number(item.byteSize) : -1;
      if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(mediaType) || !/^[a-f0-9]{64}$/.test(contentHash) || byteSize < 0) throw new InvalidCommandError('交付图片的冻结文件身份无效。');
      return { name: 'image-' + String(index + 1).padStart(3, '0') + '.' + imageExtension(mediaType), source: { kind: 'delivery', directoryPath: relativeDirectory, name: file, contentHash, byteSize, mediaType } };
    });
    const timestamp = archiveTimestamp();
    await this.writeImageArchive(request, response, archiveFilename(delivery.project_name + '-' + delivery.name + '-交付图片', timestamp), 'daoge-pic-delivery-' + timestamp + '.zip', entries);
  }
  private deliveryFileIdentity(deliveryId: string, sequence: number): { relativeDirectory: string; file: string; mediaType: string; contentHash: string; byteSize: number } {
    const delivery = this.db.prepare('SELECT delivery.id, delivery.status, delivery.manifest_json FROM deliveries delivery JOIN projects project ON project.id = delivery.project_id WHERE delivery.id = ? AND project.studio_id = ?').get(deliveryId, this.initialized.manifest.studioId) as { id: string; status: string; manifest_json: string } | undefined;
    if (!delivery || delivery.status !== 'exported') throw new StudioNotFoundError('Exported delivery not found: ' + deliveryId);
    let manifest: Record<string, unknown>;
    try { manifest = record(JSON.parse(delivery.manifest_json)); } catch { throw new InvalidCommandError('Delivery export manifest is invalid.'); }
    const relativeDirectory = typeof manifest.exportDirectory === 'string' ? manifest.exportDirectory : '';
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    const entry = files.find((item) => record(item).sequence === sequence && typeof record(item).file === 'string') as Record<string, unknown> | undefined;
    const file = entry && typeof entry.file === 'string' ? entry.file : '';
    const mediaType = entry && typeof entry.mediaType === 'string' ? entry.mediaType : '';
    const contentHash = entry && typeof entry.contentHash === 'string' ? entry.contentHash : '';
    const byteSize = entry && Number.isSafeInteger(entry.byteSize) ? Number(entry.byteSize) : -1;
    if (!file) throw new StudioNotFoundError('Exported delivery file not found.');
    if (!/^image\/(png|jpeg|webp|gif)$/.test(mediaType) || !/^[a-f0-9]{64}$/.test(contentHash) || byteSize < 0) throw new InvalidCommandError('Delivery export file identity is invalid.');
    return { relativeDirectory, file, mediaType, contentHash, byteSize };
  }

  private async deliveryFile(request: IncomingMessage, response: ServerResponse, deliveryId: string, sequence: number, download = false, thumbnail = false): Promise<void> {
    const identity = this.deliveryFileIdentity(deliveryId, sequence);
    const cacheControl = 'private, max-age=31536000, immutable';
    const etag = thumbnail ? thumbnailEtag(identity.contentHash) : '"daoge-image-' + identity.contentHash + '"';
    if (notModified(request, response, etag, cacheControl)) return;
    const source: MediaSource = { kind: 'delivery', directoryPath: identity.relativeDirectory, name: identity.file, contentHash: identity.contentHash, byteSize: identity.byteSize, mediaType: identity.mediaType };
    if (thumbnail) {
      const result = await this.mediaWorkerPool.run<Extract<MediaJobResult, { type: 'thumbnail' }>>({ type: 'thumbnail', contentHash: identity.contentHash, source });
      const opened = await openVerifiedManagedFileAsync(result.path, { mediaType: 'image/webp', minByteSize: 1, maxByteSize: 2 * 1024 * 1024, requireImage: true });
      streamVerifiedFileResponse(request, response, opened, { 'content-type': 'image/webp', 'cache-control': cacheControl, 'x-content-type-options': 'nosniff' }, etag);
      return;
    }
    const opened = await openDeliveryExportFileAsync(this.initialized.paths, { directoryPath: identity.relativeDirectory, name: identity.file, contentHash: identity.contentHash, byteSize: identity.byteSize, mediaType: identity.mediaType });
    const extension = imageExtension(identity.mediaType);
    streamVerifiedFileResponse(request, response, opened, { 'content-type': identity.mediaType, 'cache-control': cacheControl, 'x-content-type-options': 'nosniff', ...(download ? { 'content-disposition': 'attachment; filename="daoge-pic-delivery-image.' + extension + '"' } : {}) }, etag);
  }

  private async assetFile(request: IncomingMessage, response: ServerResponse, assetId: string, download = false): Promise<void> {
    const asset = getStudioAsset(this.db, this.initialized.manifest.studioId, assetId);
    if (!asset || asset.deletedAt) throw new StudioNotFoundError('Asset not found: ' + assetId);
    const cacheControl = 'private, max-age=31536000, immutable';
    const etag = '"daoge-image-' + asset.contentHash + '"';
    if (notModified(request, response, etag, cacheControl)) return;
    const snapshot = await createAssetSnapshotAsync(this.initialized.paths, asset);
    const extension = imageExtension(asset.mediaType);
    streamVerifiedFileResponse(request, response, snapshot, { 'content-type': asset.mediaType, 'cache-control': cacheControl, 'x-content-type-options': 'nosniff', ...(download ? { 'content-disposition': 'attachment; filename="daoge-pic-image.' + extension + '"' } : {}) }, etag);
  }

  private async assetThumbnail(request: IncomingMessage, response: ServerResponse, assetId: string): Promise<void> {
    const asset = getStudioAsset(this.db, this.initialized.manifest.studioId, assetId);
    if (!asset || asset.deletedAt) throw new StudioNotFoundError('Asset not found: ' + assetId);
    const cacheControl = 'private, max-age=31536000, immutable';
    const etag = thumbnailEtag(asset.contentHash);
    if (notModified(request, response, etag, cacheControl)) return;
    const result = await this.mediaWorkerPool.run<Extract<MediaJobResult, { type: 'thumbnail' }>>({ type: 'thumbnail', contentHash: asset.contentHash, source: assetMediaSource(asset) });
    const opened = await openVerifiedManagedFileAsync(result.path, { mediaType: 'image/webp', minByteSize: 1, maxByteSize: 2 * 1024 * 1024, requireImage: true });
    streamVerifiedFileResponse(request, response, opened, { 'content-type': 'image/webp', 'cache-control': cacheControl, 'x-content-type-options': 'nosniff' }, etag);
  }

  private events(request: IncomingMessage, response: ServerResponse, parsed: URL): void {
    const headerCursor = headerValue(request, 'last-event-id');
    const after = Number(parsed.searchParams.get('after') || headerCursor || '0');
    const acceptsSse = String(request.headers.accept || '').includes('text/event-stream');
    const window = () => studioEventWindow(this.db, this.initialized.manifest.studioId, after);
    if (!acceptsSse) return success(response, window());
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    });
    response.flushHeaders();
    let cursor = Number.isInteger(after) && after >= 0 ? after : 0;
    let timer: NodeJS.Timeout | null = null;
    let sending = false;
    let blocked = false;
    let closed = false;
    let lastSendAt = 0;
    const detachPresence = this.workbenchPresence.attachActiveConnection();
    let detachEvents = (): void => undefined;
    const teardown = (): void => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      response.removeListener('drain', resume);
      detachEvents();
      this.activeEventStreams.delete(teardown);
      detachPresence();
    };
    const schedule = (delay = this.pollMs): void => {
      if (!closed && !blocked && !timer) timer = setTimeout(() => { timer = null; void send(); }, delay);
    };
    const wake = (): void => {
      if (closed || blocked) return;
      if (timer) clearTimeout(timer);
      timer = null;
      schedule(Math.max(0, 180 - (Date.now() - lastSendAt)));
    };
    const resume = (): void => {
      blocked = false;
      schedule();
    };
    const write = (frame: string): boolean => {
      if (closed || response.destroyed || response.writableEnded) { teardown(); return false; }
      if (!response.write(frame)) {
        blocked = true;
        response.once('drain', resume);
        return false;
      }
      return true;
    };
    const send = (): void => {
      if (closed || blocked || sending) return;
      sending = true;
      try {
        const result = studioEventWindow(this.db, this.initialized.manifest.studioId, cursor);
        lastSendAt = Date.now();
        if (result.snapshotRequired) {
          write('id: ' + result.snapshotCursor + '\n' + 'event: snapshot-required\n' + 'data: ' + JSON.stringify({ after: cursor, cursor: result.snapshotCursor }) + '\n\n');
          teardown();
          if (!response.destroyed && !response.writableEnded) response.end();
          return;
        }
        for (const event of result.events) {
          cursor = event.id;
          if (!write('id: ' + event.id + '\n' + 'event: studio-event\n' + 'data: ' + JSON.stringify(event) + '\n\n')) break;
        }
        if (result.events.length >= 100) schedule(180);
      } catch {
        teardown();
        if (!response.destroyed && !response.writableEnded) response.end();
      } finally {
        sending = false;
        schedule();
      }
    };
    detachEvents = subscribeStudioEvents(this.initialized.manifest.studioId, wake);
    this.activeEventStreams.add(teardown);
    request.once('aborted', teardown);
    request.once('close', teardown);
    response.once('close', teardown);
    response.once('error', teardown);
    send();
  }

  private sendError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof LocalAccessError) return json(response, error.status, { ok: false, error: { code: error.code, message: error.message } });
    if (error instanceof StateTransitionError) return json(response, 409, { ok: false, error: { code: 'invalid_state_transition', message: error.message, details: { entity: error.entity, from: error.from, to: error.to } } });
    if (error instanceof VersionConflictError) return json(response, 409, { ok: false, error: { code: 'version_conflict', message: error.message } });
    if (error instanceof StudioNotFoundError) return json(response, 404, { ok: false, error: { code: 'not_found', message: error.message } });
    if (error instanceof MediaValidationError) return json(response, 422, { ok: false, error: { code: 'media_validation_failed', message: error.message } });
    if (error instanceof MediaArchiveError) return json(response, 500, { ok: false, error: { code: 'internal_error', message: 'Studio 本地服务发生未预期错误。' } });
    if (error instanceof InvalidCommandError) return json(response, 400, { ok: false, error: { code: 'invalid_command', message: error.message } });
    return json(response, 500, { ok: false, error: { code: 'internal_error', message: 'Studio 本地服务发生未预期错误。' } });
  }
}

export async function startLocalStudioService(options: StudioServiceOptions, port = 0): Promise<StartedStudioService> {
  const service = new LocalStudioService(options);
  try {
    await recoverStudioStartupAsync(service.db, service.initialized.paths, service.initialized.manifest.studioId, new Date(), { mediaWorkerPool: service.mediaWorkerPool });
    return await service.listen(port);
  } catch (error) {
    await service.close();
    throw error;
  }
}
