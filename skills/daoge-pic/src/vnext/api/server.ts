import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import http, { IncomingMessage, OutgoingHttpHeaders, Server, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { Readable } from 'node:stream';
import { closeStudioDatabase, openStudioDatabase, StudioDatabase, subscribeStudioEvents, withTransaction } from '../studio/database';
import { ensureCacheDirectory, initializeStudio, InitializeStudioResult } from '../studio/workspace';
import { ProviderCapabilities, ProviderId, providerSnapshot } from '../studio/provider-config';
import { activateProviderProfile, closeProviderDatabase, copyProviderProfile, createProviderProfile, deleteProviderProfile, importLegacyProviderEnvOnce, importProviderEnvProfile, listProviderProfiles, openProviderDatabase, ProviderDatabase, providerStatus, resolveActiveProviderConfig, resolveProviderProfileForTest, updateProviderProfile } from '../studio/provider-store';
import { createImageProvider } from '../providers/http-adapters';
import { probeHttpEndpoint } from '../providers/http-safety';
import { archiveProject, createProject, createRoundDraft, createTaskDraft, confirmRoundPlan, executeIdempotent, executeIdempotentAsync, getRound, getStudioSession, InvalidCommandError, listRoundPlanVersions, openOrAttachStudioSession, prepareRoundForConfirmation, StudioNotFoundError, updateStudioSessionContext, VersionConflictError } from '../domain/studio-commands';
import { cancelGenerationRun, createDryRunPreview, getDryRunPreview, getGenerationRun, listDryRunPreviews, pauseGenerationRun, preflightRound, queueGenerationRun, resolveUnknownRunItems, resumeGenerationRun, retryGenerationRunItems } from '../runner/run-commands';
import { StateTransitionError } from '../domain/states';
import { AssetKind, AssetScope, countScopedStudioAssets, countStudioAssets, createAssetSnapshotAsync, getAssetImpact, getStudioAsset, importStagedStudioAssetAsync, listScopedStudioAssets, listSharedStudioAssets, listStudioAssets, restoreAsset, setReviewDecision, setReviewDecisions, setStudioAssetShared, softDeleteAsset, StudioAsset } from '../domain/assets';
import { getLatestRun, listProjects, listRounds, listRunItemsForQuery, listRuns, listTasks, searchStudio } from '../domain/queries';
import { createBrandKit, createStyleKit, createUserTaskType, listBrandKits, listStyleKits, listTaskTypes } from '../domain/libraries';
import { completeDeliveryStepAsync, createDelivery, DeliveryCompletionPhase, DeliveryCompletionResult, DeliveryExportResult, exportDeliveryAsync, getDelivery, listDeliveries, openDeliveryExportFileAsync, prepareDelivery, returnDeliveryToDraft, updateDeliveryDraft } from '../domain/deliveries';
import { createDeliveryBatch, getDeliveryBatch, listDeliveryBatches, prepareDeliveryBatchVersion, reviseDeliveryBatch } from '../domain/delivery-batches';
import { getAssetProvenance, getRoundCreativeRecord, getTaskCreativeOverview, getTaskStudioOverview, listAssetsWithReviewSummaries } from '../domain/creative-records';
import { listProjectSelectionAssets, setProjectAssetSelected, setProjectAssetsSelected } from '../domain/project-selections';
import { recoverStudioStartupAsync } from '../runner/startup-recovery';
import { studioEventWindow } from './events';
import { discardStagedImage, MediaArchiveError, MediaValidationError, openVerifiedManagedFileAsync, stageImageStream, VerifiedManagedFile } from '../media/archive';
import { thumbnailEtag } from '../media/thumbnails';
import { MediaJobResult, MediaProcessPool, MediaSource, MediaZipEntry } from '../runtime/media-worker-pool';
import { daemonRestartAvailable, requestDaemonRestart } from '../runtime/restart';
import type { ProviderConcurrencySnapshot } from '../runtime/provider-concurrency';
import { assertJsonContentType, assertLocalHost, assertLocalWriteOrigin, authenticateLocalRequest, constantTimeTokenEqual, createLocalCapability, imageUploadMediaType, LocalAccessError, localSessionCookie, localSessionCookieName, LocalAuthentication } from './local-auth';
import { ConfirmationGate, canonicalValue, planHash } from './confirmation-gate';
import { isSupportedProtocolVersion, protocolStatus, SKILL_PROTOCOL_NAME, SUPPORTED_PROTOCOL_RANGE } from '../shared/protocol';
import { WorkbenchPresence } from '../runtime/workbench-presence';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_IMAGE_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_ARCHIVE_IMAGE_COUNT = 100;
const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024;
const MAX_BATCH_IDS = 500;

type JsonBody = Record<string, unknown>;

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
  provider?: { profileId?: unknown; configVersion?: unknown; providerId?: unknown; model?: unknown; endpoint?: unknown } | null;
  providerConcurrency?: ProviderConcurrencySnapshot | null;
}
interface SafeProviderSnapshot {
  profileId: string;
  profileName: string;
  configVersion: number;
  providerId: ProviderId;
  model: string;
  referenceEnabled: boolean;
  endpoint: string | null;
  capabilities: ProviderCapabilities;
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
    this.initialized = initializeStudio({ workspaceRoot: options.workspaceRoot });
    this.db = openStudioDatabase(this.initialized.paths, this.initialized.manifest);
    this.providerDb = openProviderDatabase(this.initialized.paths);
    importLegacyProviderEnvOnce(this.providerDb, this.initialized.paths);
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

  private runtimeStatus(): { desired: SafeProviderSnapshot | null; active: { profileId: string; configVersion: number; providerId: string; model: string; endpoint: string | null } | null; restartRequired: boolean; providerConcurrency: ProviderConcurrencySnapshot | null } {
    const record = readActiveDaemonRuntime(this.initialized.paths.runtimeDir);
    const active = record?.provider && typeof record.provider.profileId === 'string' && Number.isInteger(record.provider.configVersion) && typeof record.provider.providerId === 'string' && typeof record.provider.model === 'string' ? {
      profileId: record.provider.profileId,
      configVersion: Number(record.provider.configVersion),
      providerId: record.provider.providerId,
      model: record.provider.model,
      endpoint: typeof record.provider.endpoint === 'string' ? record.provider.endpoint : null
    } : null;
    const config = resolveActiveProviderConfig(this.providerDb);
    const desired = config ? providerSnapshot(config) : null;
    const desiredIdentity = desired ? { profileId: desired.profileId, configVersion: desired.configVersion, providerId: desired.providerId, model: desired.model, endpoint: desired.endpoint } : null;
    return { desired, active, restartRequired: Boolean(record && JSON.stringify(active) !== JSON.stringify(desiredIdentity)), providerConcurrency: record?.providerConcurrency || null };
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
      if (request.method === 'GET' && parsed.pathname === '/api/studio') return success(response, { studioId: this.initialized.manifest.studioId, schemaVersion: this.initialized.manifest.schemaVersion, protocol: protocolStatus() });
      if (request.method === 'GET' && parsed.pathname === '/api/providers') return success(response, { profiles: listProviderProfiles(this.providerDb), status: providerStatus(this.providerDb), runtime: this.runtimeStatus() });
      if (request.method === 'GET' && parsed.pathname === '/api/projects') return success(response, { projects: listProjects(this.db, this.initialized.manifest.studioId) });
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
      const assetImpactMatch = /^\/api\/assets\/([^/]+)\/impact$/.exec(parsed.pathname);
      if (request.method === 'GET' && assetImpactMatch) return success(response, { impact: getAssetImpact(this.db, this.initialized.manifest.studioId, assetImpactMatch[1]) });
      const assetProvenanceMatch = /^\/api\/assets\/([^/]+)\/provenance$/.exec(parsed.pathname);
      if (request.method === 'GET' && assetProvenanceMatch) return success(response, { provenance: getAssetProvenance(this.db, this.initialized.manifest.studioId, assetProvenanceMatch[1]) });
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
      if (request.method === 'GET' && creativeRecordMatch) return success(response, { record: getRoundCreativeRecord(this.db, this.initialized.manifest.studioId, creativeRecordMatch[1], parsed.searchParams.get('runId') || undefined) });
      const planVersionsMatch = /^\/api\/rounds\/([^/]+)\/plan-versions$/.exec(parsed.pathname);
      if (request.method === 'GET' && planVersionsMatch) return success(response, { planVersions: listRoundPlanVersions(this.db, this.initialized.manifest.studioId, planVersionsMatch[1]) });
      const dryRunsMatch = /^\/api\/rounds\/([^/]+)\/dry-runs$/.exec(parsed.pathname);
      if (request.method === 'GET' && dryRunsMatch) return success(response, { dryRuns: listDryRunPreviews(this.db, this.initialized.manifest.studioId, dryRunsMatch[1]) });
      const runMatch = /^\/api\/rounds\/([^/]+)\/runs$/.exec(parsed.pathname);
      if (request.method === 'GET' && runMatch) return success(response, { runs: listRuns(this.db, this.initialized.manifest.studioId, runMatch[1]) });
      const runItemsMatch = /^\/api\/runs\/([^/]+)\/items$/.exec(parsed.pathname);
      if (request.method === 'GET' && runItemsMatch) return success(response, { items: listRunItemsForQuery(this.db, this.initialized.manifest.studioId, runItemsMatch[1]) });
      const assetFileMatch = /^\/api\/assets\/([^/]+)\/file$/.exec(parsed.pathname);
      if (request.method === 'GET' && assetFileMatch) return await this.assetFile(request, response, assetFileMatch[1], parsed.searchParams.get('download') === '1');
      const assetThumbnailMatch = /^\/api\/assets\/([^/]+)\/thumbnail$/.exec(parsed.pathname);
      if (request.method === 'GET' && assetThumbnailMatch) return await this.assetThumbnail(request, response, assetThumbnailMatch[1]);
      if (request.method === 'GET' && parsed.pathname === '/api/events') return this.events(request, response, parsed);
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
    const key = idempotencyKey(request, body);
    if (pathname === '/api/restart' && request.method === 'POST') {
      if (!daemonRestartAvailable()) throw new InvalidCommandError('当前服务不是受控 daemon，无法从 Workbench 重启。');
      success(response, { restarting: true });
      setImmediate(() => requestDaemonRestart());
      return;
    }
    if (pathname === '/api/providers/import-env' && request.method === 'POST') return success(response, importProviderEnvProfile(this.providerDb, this.initialized.paths, key));
    if (pathname === '/api/providers' && request.method === 'POST') {
      return success(response, createProviderProfile(this.providerDb, { name: body.name, providerId: body.providerId, model: body.model, baseUrl: body.baseUrl, apiKey: body.apiKey, options: body.options, active: body.active === true, idempotencyKey: key }));
    }
    const providerUpdateMatch = /^\/api\/providers\/([^/]+)$/.exec(pathname);
    if (providerUpdateMatch && request.method === 'PUT') return success(response, updateProviderProfile(this.providerDb, providerUpdateMatch[1], { name: body.name, providerId: body.providerId, model: body.model, baseUrl: body.baseUrl, apiKey: body.apiKey, options: body.options, expectedConfigVersion: body.expectedConfigVersion, idempotencyKey: key }));
    const providerCopyMatch = /^\/api\/providers\/([^/]+)\/copy$/.exec(pathname);
    if (providerCopyMatch) return success(response, copyProviderProfile(this.providerDb, providerCopyMatch[1], { name: body.name, idempotencyKey: key }));
    const providerActivateMatch = /^\/api\/providers\/([^/]+)\/activate$/.exec(pathname);
    if (providerActivateMatch) return success(response, activateProviderProfile(this.providerDb, providerActivateMatch[1], key));
    const providerDeleteMatch = /^\/api\/providers\/([^/]+)\/delete$/.exec(pathname);
    if (providerDeleteMatch) return success(response, deleteProviderProfile(this.providerDb, providerDeleteMatch[1], key));
    const providerValidateMatch = /^\/api\/providers\/([^/]+)\/validate$/.exec(pathname);
    if (providerValidateMatch) {
      const config = resolveProviderProfileForTest(this.providerDb, providerValidateMatch[1], { baseUrl: body.baseUrl, apiKey: body.apiKey });
      const validation = createImageProvider(config).validateConfig(config);
      return success(response, { valid: validation.valid, missing: validation.missing });
    }
    const providerTestMatch = /^\/api\/providers\/([^/]+)\/test$/.exec(pathname);
    if (providerTestMatch) {
      const config = resolveProviderProfileForTest(this.providerDb, providerTestMatch[1], { baseUrl: body.baseUrl, apiKey: body.apiKey });
      const validation = createImageProvider(config).validateConfig(config);
      if (!validation.valid) throw new InvalidCommandError('Provider 配置不完整：' + validation.missing.join(', '));
      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
      try {
        const headers: Record<string, string> = { accept: 'application/json' };
        if (config.providerId === 'gemini-image') headers['x-goog-api-key'] = config.apiKey;
        else headers.authorization = 'Bearer ' + config.apiKey;
        const result = await this.providerProbe(config.baseUrl, headers, controller.signal);
        return success(response, { connected: result.reachable, status: result.status });
      } catch {
        throw new InvalidCommandError(timedOut ? 'Provider 连接测试超时。请检查 Base URL 与网络后重试。' : '无法连接 Provider 端点。请检查 Base URL、网络和访问权限后重试。');
      } finally { clearTimeout(timeout); }
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
        if (selected && keepAssetIds.length) setReviewDecisions(this.db, { studioId: this.initialized.manifest.studioId, assetIds: keepAssetIds, decision: 'keep', emitEvent: false });
        return setProjectAssetsSelected(this.db, { studioId: this.initialized.manifest.studioId, projectId, assetIds, selected });
      }), { projectId, assetIds, selected, keepAssetIds });
      return success(response, { ...updated.value, selection: projectSelectionPayload(this.db, this.initialized.manifest.studioId, projectId) });
    }
    if (pathname === '/api/projects') {
      const created = createProject(this.db, { studioId: this.initialized.manifest.studioId, name: text(body.name), description: text(body.description) || undefined, sessionId: text(body.sessionId) || undefined, idempotencyKey: key });
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
      const created = createTaskDraft(this.db, { studioId: this.initialized.manifest.studioId, projectId: text(body.projectId), name: text(body.name), taskTypeId: text(body.taskTypeId) || undefined, intent: record(body.intent), sessionId: text(body.sessionId) || undefined, idempotencyKey: key });
      return success(response, created);
    }
    if (pathname === '/api/rounds') {
      this.assertTaskInStudio(text(body.taskId));
      if (text(body.parentRoundId)) this.assertRoundInStudio(text(body.parentRoundId));
      if (text(body.sessionId)) this.assertSessionInStudio(text(body.sessionId));
      const created = createRoundDraft(this.db, { studioId: this.initialized.manifest.studioId, taskId: text(body.taskId), purpose: text(body.purpose) as 'exploration' | 'refinement' | 'variation' | 'edit' | 'fill', parentRoundId: text(body.parentRoundId) || undefined, plan: record(body.plan), sessionId: text(body.sessionId) || undefined, idempotencyKey: key });
      return success(response, created);
    }
    const prepareMatch = /^\/api\/rounds\/([^/]+)\/prepare$/.exec(pathname);
    if (prepareMatch) {
      this.assertRoundInStudio(prepareMatch[1]);
      const prepared = prepareRoundForConfirmation(this.db, { studioId: this.initialized.manifest.studioId, roundId: prepareMatch[1], plan: record(body.plan), expectedVersion: numberValue(body.expectedVersion), idempotencyKey: key });
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
      this.assertRoundInStudio(preflightMatch[1]);
      this.assertConfirmedRoundSession(preflightMatch[1], text(body.sessionId));
      const config = resolveActiveProviderConfig(this.providerDb);
      const status = providerStatus(this.providerDb);
      if (!config) return success(response, { preview: null, preflight: preflightRound(this.db, { studioId: this.initialized.manifest.studioId, roundId: preflightMatch[1], providerStatus: status }) });
      const receipt = createDryRunPreview(this.db, { studioId: this.initialized.manifest.studioId, roundId: preflightMatch[1], providerConfig: config, providerStatus: status, executionConcurrency: body.executionConcurrency, concurrencySource: body.concurrencySource, idempotencyKey: key });
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
      const config = resolveActiveProviderConfig(this.providerDb);
      if (!config) throw new InvalidCommandError('当前工作区没有可用的图片生成配置。');
      const runtime = this.runtimeStatus();
      if (runtime.restartRequired) throw new InvalidCommandError('Provider 配置已变更，必须先重启 Studio 后再提交生成。');
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
        const queued = queueGenerationRun(this.db, { studioId: this.initialized.manifest.studioId, roundId, providerConfig: config, providerStatus: providerStatus(this.providerDb), preflightId, idempotencyKey: key });
        return success(response, queued);
      } catch (error) {
        if (!reservation.replayed) this.confirmationGate.releaseToken(token, key);
        throw error;
      }
    }
    const pauseMatch = /^\/api\/runs\/([^/]+)\/pause$/.exec(pathname);
    if (pauseMatch) { this.assertRunInStudio(pauseMatch[1]); return success(response, pauseGenerationRun(this.db, { studioId: this.initialized.manifest.studioId, runId: pauseMatch[1], idempotencyKey: key })); }
    const resolveUnknownMatch = /^\/api\/runs\/([^/]+)\/outcomes\/resolve$/.exec(pathname);
    if (resolveUnknownMatch) { const itemIds = boundedIds(body.itemIds, 'itemIds') || []; this.assertRunInStudio(resolveUnknownMatch[1]); for (const itemId of itemIds) this.assertRunItemInStudio(itemId); return success(response, resolveUnknownRunItems(this.db, { studioId: this.initialized.manifest.studioId, runId: resolveUnknownMatch[1], itemIds, idempotencyKey: key })); }
    const retryMatch = /^\/api\/runs\/([^/]+)\/retry$/.exec(pathname);
    if (retryMatch) { const itemIds = boundedIds(body.itemIds, 'itemIds', { optional: true }); this.assertRunInStudio(retryMatch[1]); for (const itemId of itemIds || []) this.assertRunItemInStudio(itemId); return success(response, retryGenerationRunItems(this.db, { studioId: this.initialized.manifest.studioId, runId: retryMatch[1], itemIds, idempotencyKey: key })); }
    const resumeMatch = /^\/api\/runs\/([^/]+)\/resume$/.exec(pathname);
    if (resumeMatch) {
      this.assertRunInStudio(resumeMatch[1]);
      if (authentication !== 'cookie') throw new LocalAccessError(403, 'forbidden', '运行恢复必须由已授权 Workbench 中的真实用户完成。');
      const sessionId = text(body.sessionId);
      this.assertResumeSession(resumeMatch[1], sessionId);
      const config = resolveActiveProviderConfig(this.providerDb);
      const run = getGenerationRun(this.db, resumeMatch[1]);
      const runProfileId = typeof run?.providerSnapshot.profileId === 'string' ? run.providerSnapshot.profileId : '';
      const runConfigVersion = Number(run?.providerSnapshot.configVersion);
      if (!config || runProfileId !== config.profileId || runConfigVersion !== config.configVersion) throw new InvalidCommandError('Provider 配置已变化，旧运行不能静默切换；请恢复原 Profile 或创建新轮次。');
      return success(response, resumeGenerationRun(this.db, { studioId: this.initialized.manifest.studioId, runId: resumeMatch[1], sessionId, idempotencyKey: key }));
    }
    const cancelMatch = /^\/api\/runs\/([^/]+)\/cancel$/.exec(pathname);
    if (cancelMatch) { this.assertRunInStudio(cancelMatch[1]); return success(response, cancelGenerationRun(this.db, { studioId: this.initialized.manifest.studioId, runId: cancelMatch[1], idempotencyKey: key })); }
    const reviewMatch = /^\/api\/assets\/([^/]+)\/review$/.exec(pathname);
    if (reviewMatch) {
      this.assertAssetInStudio(reviewMatch[1]);
      if (text(body.taskId)) this.assertTaskInStudio(text(body.taskId));
      if (text(body.roundId)) this.assertRoundInStudio(text(body.roundId));
      const reviewed = executeIdempotent(this.db, this.initialized.manifest.studioId, key, 'assets.review', () => {
        const decision = text(body.decision) as 'keep' | 'review' | 'reject' | 'derive';
        setReviewDecision(this.db, { studioId: this.initialized.manifest.studioId, assetId: reviewMatch[1], decision, taskId: text(body.taskId) || undefined, roundId: text(body.roundId) || undefined, feedback: record(body.feedback) });
        return { assetId: reviewMatch[1], decision };
      }, { assetId: reviewMatch[1], decision: text(body.decision), taskId: text(body.taskId) || undefined, roundId: text(body.roundId) || undefined, feedback: record(body.feedback) });
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
        source: { channel: 'workbench_upload', idempotencyKey: key },
        archiveStagedImage: (stagedImage, archiveInput) => this.mediaWorkerPool.run<Extract<MediaJobResult, { type: 'archive-staged' }>>({ type: 'archive-staged', staged: stagedImage, assetId: archiveInput.assetId, bucket: archiveInput.bucket })
      }), { contentHash: staged.contentHash, mediaType: staged.mediaType, targetType, targetId, originalFilename });
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
    const projectAssets = listScopedStudioAssets(this.db, this.initialized.manifest.studioId, { scope: 'project', projectId, limit: 500 });
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
