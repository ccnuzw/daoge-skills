import fs from 'node:fs';
import path from 'node:path';
import http, { IncomingMessage, Server, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { closeStudioDatabase, openStudioDatabase, StudioDatabase } from '../studio/database';
import { initializeStudio, InitializeStudioResult } from '../studio/workspace';
import { loadProviderConfig, providerStatus } from '../studio/provider-config';
import { archiveProject, createProject, createRoundDraft, createTaskDraft, confirmRoundPlan, executeIdempotent, InvalidCommandError, listRoundPlanVersions, openOrAttachStudioSession, prepareRoundForConfirmation, StudioNotFoundError, updateStudioSessionContext, VersionConflictError } from '../domain/studio-commands';
import { cancelGenerationRun, createDryRunPreview, listDryRunPreviews, markRunsResumePending, pauseGenerationRun, preflightRound, queueGenerationRun, reconcileTerminalRuns, recoverExpiredLeases, resolveUnknownRunItems, resumeGenerationRun, retryGenerationRunItems } from '../runner/run-commands';
import { assetFilePath, getAssetImpact, getStudioAsset, importStudioAsset, listStudioAssets, recoverAssetMediaOperations, restoreAsset, setReviewDecision, softDeleteAsset } from '../domain/assets';
import { listProjects, listRounds, listRunItemsForQuery, listRuns, listTasks, searchStudio } from '../domain/queries';
import { createBrandKit, createStyleKit, createUserTaskType, listBrandKits, listStyleKits, listTaskTypes } from '../domain/libraries';
import { createDelivery, exportDelivery, listDeliveries } from '../domain/deliveries';
import { reconcileManagedMedia, recoverGeneratedMediaCommits } from '../media/reconcile';
import { studioEventWindow } from './events';
import { sha256 } from '../shared/ids';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_IMAGE_UPLOAD_BYTES = 100 * 1024 * 1024;

type JsonBody = Record<string, unknown>;

export interface StudioServiceOptions {
  workspaceRoot: string;
  providerTemplatePath: string;
  ssePollMs?: number;
  workbenchDir?: string;
}

export interface StartedStudioService {
  url: string;
  service: LocalStudioService;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function success(response: ServerResponse, body: unknown): void {
  json(response, 200, { ok: true, data: body });
}

function idempotencyKey(request: IncomingMessage, body: JsonBody): string {
  const header = request.headers['idempotency-key'];
  const candidate = Array.isArray(header) ? header[0] : header;
  const key = String(candidate || body.idempotencyKey || '').trim();
  if (!key) throw new InvalidCommandError('写入操作需要 idempotency-key。');
  return key;
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

async function readBinaryBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_IMAGE_UPLOAD_BYTES) throw new InvalidCommandError('图片超过 100 MB Studio 限制。');
    chunks.push(buffer);
  }
  if (!chunks.length) throw new InvalidCommandError('需要上传图片内容。');
  return Buffer.concat(chunks);
}

function headerValue(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function numberValue(value: unknown): number {
  return Number(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export class LocalStudioService {
  readonly initialized: InitializeStudioResult;
  readonly db: StudioDatabase;
  private readonly pollMs: number;
  private readonly workbenchDir: string;
  private server: Server | null = null;

  constructor(options: StudioServiceOptions) {
    this.initialized = initializeStudio({ workspaceRoot: options.workspaceRoot, providerTemplatePath: options.providerTemplatePath });
    this.db = openStudioDatabase(this.initialized.paths, this.initialized.manifest);
    recoverGeneratedMediaCommits(this.db, this.initialized.paths, this.initialized.manifest.studioId);
    recoverAssetMediaOperations(this.db, this.initialized.paths, this.initialized.manifest.studioId);
    reconcileManagedMedia(this.db, this.initialized.paths, this.initialized.manifest.studioId);
    recoverExpiredLeases(this.db);
    reconcileTerminalRuns(this.db);
    markRunsResumePending(this.db);
    this.pollMs = Math.min(5000, Math.max(100, options.ssePollMs || 400));
    this.workbenchDir = options.workbenchDir ? path.resolve(options.workbenchDir) : path.resolve(__dirname, '../../workbench');
  }

  async listen(port = 0, host = '127.0.0.1'): Promise<StartedStudioService> {
    if (this.server) throw new Error('Studio service is already listening.');
    this.server = http.createServer((request, response) => { void this.handle(request, response); });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(port, host, () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Studio service did not expose a TCP address.');
    return { url: 'http://' + host + ':' + address.port, service: this };
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    closeStudioDatabase(this.db);
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const parsed = new URL(request.url || '/', 'http://localhost');
      if (request.method === 'GET' && !parsed.pathname.startsWith('/api/')) return this.workbench(response, parsed.pathname);
      if (request.method === 'GET' && parsed.pathname === '/api/health') return success(response, { service: 'daoge-pic-vnext', studioId: this.initialized.manifest.studioId });
      if (request.method === 'GET' && parsed.pathname === '/api/studio') return success(response, { studioId: this.initialized.manifest.studioId, schemaVersion: this.initialized.manifest.schemaVersion });
      if (request.method === 'GET' && parsed.pathname === '/api/provider/status') return success(response, providerStatus(this.initialized.paths));
      if (request.method === 'GET' && parsed.pathname === '/api/provider/details') return success(response, { ...providerStatus(this.initialized.paths), providerEnvPath: 'daoge-studio/provider.env' });
      if (request.method === 'GET' && parsed.pathname === '/api/projects') return success(response, { projects: listProjects(this.db, this.initialized.manifest.studioId) });
      if (request.method === 'GET' && parsed.pathname === '/api/search') return success(response, { results: searchStudio(this.db, this.initialized.manifest.studioId, parsed.searchParams.get('q') || '') });
      if (request.method === 'GET' && parsed.pathname === '/api/task-types') return success(response, { taskTypes: listTaskTypes(this.db) });
      if (request.method === 'GET' && parsed.pathname === '/api/style-kits') return success(response, { styleKits: listStyleKits(this.db, this.initialized.manifest.studioId) });
      if (request.method === 'GET' && parsed.pathname === '/api/brand-kits') return success(response, { brandKits: listBrandKits(this.db, this.initialized.manifest.studioId) });
      if (request.method === 'GET' && parsed.pathname === '/api/assets') return success(response, { assets: listStudioAssets(this.db, this.initialized.manifest.studioId, { includeDeleted: parsed.searchParams.get('deleted') === 'true', targetType: parsed.searchParams.get('targetType') || undefined, targetId: parsed.searchParams.get('targetId') || undefined }) });
      const assetImpactMatch = /^\/api\/assets\/([^/]+)\/impact$/.exec(parsed.pathname);
      if (request.method === 'GET' && assetImpactMatch) return success(response, { impact: getAssetImpact(this.db, this.initialized.manifest.studioId, assetImpactMatch[1]) });
      const deliveryMatch = /^\/api\/projects\/([^/]+)\/deliveries$/.exec(parsed.pathname);
      if (request.method === 'GET' && deliveryMatch) return success(response, { deliveries: listDeliveries(this.db, deliveryMatch[1]) });
      const taskMatch = /^\/api\/projects\/([^/]+)\/tasks$/.exec(parsed.pathname);
      if (request.method === 'GET' && taskMatch) return success(response, { tasks: listTasks(this.db, taskMatch[1]) });
      const roundMatch = /^\/api\/tasks\/([^/]+)\/rounds$/.exec(parsed.pathname);
      if (request.method === 'GET' && roundMatch) return success(response, { rounds: listRounds(this.db, roundMatch[1]) });
      const planVersionsMatch = /^\/api\/rounds\/([^/]+)\/plan-versions$/.exec(parsed.pathname);
      if (request.method === 'GET' && planVersionsMatch) return success(response, { planVersions: listRoundPlanVersions(this.db, planVersionsMatch[1]) });
      const dryRunsMatch = /^\/api\/rounds\/([^/]+)\/dry-runs$/.exec(parsed.pathname);
      if (request.method === 'GET' && dryRunsMatch) return success(response, { dryRuns: listDryRunPreviews(this.db, dryRunsMatch[1]) });
      const runMatch = /^\/api\/rounds\/([^/]+)\/runs$/.exec(parsed.pathname);
      if (request.method === 'GET' && runMatch) return success(response, { runs: listRuns(this.db, runMatch[1]) });
      const runItemsMatch = /^\/api\/runs\/([^/]+)\/items$/.exec(parsed.pathname);
      if (request.method === 'GET' && runItemsMatch) return success(response, { items: listRunItemsForQuery(this.db, runItemsMatch[1]) });
      const assetFileMatch = /^\/api\/assets\/([^/]+)\/file$/.exec(parsed.pathname);
      if (request.method === 'GET' && assetFileMatch) return this.assetFile(response, assetFileMatch[1]);
      if (request.method === 'GET' && parsed.pathname === '/api/events') return this.events(request, response, parsed);
      if (request.method === 'POST' && parsed.pathname === '/api/assets/import') return await this.importAsset(request, response);
      if (request.method !== 'POST') return json(response, 404, { ok: false, error: { code: 'not_found', message: '未找到请求的 Studio API。' } });
      const body = await readBody(request);
      return this.write(request, response, parsed.pathname, body);
    } catch (error) {
      this.sendError(response, error);
    }
  }

  private write(request: IncomingMessage, response: ServerResponse, pathname: string, body: JsonBody): void {
    const key = idempotencyKey(request, body);
    if (pathname === '/api/sessions/open') {
      const session = openOrAttachStudioSession(this.db, { studioId: this.initialized.manifest.studioId, conversationId: text(body.conversationId) });
      return success(response, session);
    }
    const sessionContextMatch = /^\/api\/sessions\/([^/]+)\/context$/.exec(pathname);
    if (sessionContextMatch) return success(response, executeIdempotent(this.db, key, 'sessions.context', () => updateStudioSessionContext(this.db, { studioId: this.initialized.manifest.studioId, sessionId: sessionContextMatch[1], projectId: text(body.projectId) || undefined, taskId: text(body.taskId) || undefined, roundId: text(body.roundId) || undefined }), { sessionId: sessionContextMatch[1], projectId: text(body.projectId) || undefined, taskId: text(body.taskId) || undefined, roundId: text(body.roundId) || undefined }).value);
    const archiveProjectMatch = /^\/api\/projects\/([^/]+)\/archive$/.exec(pathname);
    if (archiveProjectMatch) return success(response, archiveProject(this.db, { projectId: archiveProjectMatch[1], idempotencyKey: key }));
    if (pathname === '/api/projects') {
      const created = createProject(this.db, { studioId: this.initialized.manifest.studioId, name: text(body.name), description: text(body.description) || undefined, sessionId: text(body.sessionId) || undefined, idempotencyKey: key });
      return success(response, created);
    }
    if (pathname === '/api/deliveries') return success(response, createDelivery(this.db, { projectId: text(body.projectId), name: text(body.name), assetIds: Array.isArray(body.assetIds) ? body.assetIds.filter((item): item is string => typeof item === 'string') : [], includeCreativeRecord: body.includeCreativeRecord === true, idempotencyKey: key }));
    const exportDeliveryMatch = /^\/api\/deliveries\/([^/]+)\/export$/.exec(pathname);
    if (exportDeliveryMatch) return success(response, exportDelivery(this.db, this.initialized.paths, { deliveryId: exportDeliveryMatch[1], idempotencyKey: key }));
    if (pathname === '/api/task-types') return success(response, createUserTaskType(this.db, { name: text(body.name), definition: record(body.definition), idempotencyKey: key }));
    if (pathname === '/api/style-kits') return success(response, createStyleKit(this.db, { studioId: this.initialized.manifest.studioId, name: text(body.name), definition: record(body.definition), assetIds: Array.isArray(body.assetIds) ? body.assetIds.filter((item): item is string => typeof item === 'string') : [], idempotencyKey: key }));
    if (pathname === '/api/brand-kits') return success(response, createBrandKit(this.db, { studioId: this.initialized.manifest.studioId, name: text(body.name), definition: record(body.definition), assetIds: Array.isArray(body.assetIds) ? body.assetIds.filter((item): item is string => typeof item === 'string') : [], idempotencyKey: key }));
    if (pathname === '/api/tasks') {
      const created = createTaskDraft(this.db, { projectId: text(body.projectId), name: text(body.name), taskTypeId: text(body.taskTypeId) || undefined, intent: record(body.intent), sessionId: text(body.sessionId) || undefined, idempotencyKey: key });
      return success(response, created);
    }
    if (pathname === '/api/rounds') {
      const created = createRoundDraft(this.db, { taskId: text(body.taskId), purpose: text(body.purpose) as 'exploration' | 'refinement' | 'variation' | 'edit' | 'fill', parentRoundId: text(body.parentRoundId) || undefined, plan: record(body.plan), sessionId: text(body.sessionId) || undefined, idempotencyKey: key });
      return success(response, created);
    }
    const prepareMatch = /^\/api\/rounds\/([^/]+)\/prepare$/.exec(pathname);
    if (prepareMatch) {
      const prepared = prepareRoundForConfirmation(this.db, { roundId: prepareMatch[1], plan: record(body.plan), expectedVersion: numberValue(body.expectedVersion), idempotencyKey: key });
      return success(response, prepared);
    }
    const confirmMatch = /^\/api\/rounds\/([^/]+)\/confirm$/.exec(pathname);
    if (confirmMatch) {
      const confirmed = confirmRoundPlan(this.db, { roundId: confirmMatch[1], expectedVersion: numberValue(body.expectedVersion), idempotencyKey: key });
      return success(response, confirmed);
    }
    const preflightMatch = /^\/api\/rounds\/([^/]+)\/preflight$/.exec(pathname);
    if (preflightMatch) {
      const config = loadProviderConfig(this.initialized.paths);
      if (!config) return success(response, { preview: null, preflight: preflightRound(this.db, { roundId: preflightMatch[1], providerStatus: providerStatus(this.initialized.paths) }) });
      return success(response, createDryRunPreview(this.db, { roundId: preflightMatch[1], providerConfig: config, providerStatus: providerStatus(this.initialized.paths), idempotencyKey: key }));
    }
    if (pathname === '/api/runs') {
      const config = loadProviderConfig(this.initialized.paths);
      if (!config) throw new InvalidCommandError('当前工作区没有可用的图片生成配置。');
      const queued = queueGenerationRun(this.db, { roundId: text(body.roundId), providerConfig: config, providerStatus: providerStatus(this.initialized.paths), preflightId: text(body.preflightId) || undefined, idempotencyKey: key });
      return success(response, queued);
    }
    const pauseMatch = /^\/api\/runs\/([^/]+)\/pause$/.exec(pathname);
    if (pauseMatch) return success(response, pauseGenerationRun(this.db, { runId: pauseMatch[1], idempotencyKey: key }));
    const resolveUnknownMatch = /^\/api\/runs\/([^/]+)\/outcomes\/resolve$/.exec(pathname);
    if (resolveUnknownMatch) return success(response, resolveUnknownRunItems(this.db, { runId: resolveUnknownMatch[1], itemIds: Array.isArray(body.itemIds) ? body.itemIds.filter((item): item is string => typeof item === 'string') : [], idempotencyKey: key }));
    const retryMatch = /^\/api\/runs\/([^/]+)\/retry$/.exec(pathname);
    if (retryMatch) return success(response, retryGenerationRunItems(this.db, { runId: retryMatch[1], itemIds: Array.isArray(body.itemIds) ? body.itemIds.filter((item): item is string => typeof item === 'string') : undefined, idempotencyKey: key }));
    const resumeMatch = /^\/api\/runs\/([^/]+)\/resume$/.exec(pathname);
    if (resumeMatch) return success(response, resumeGenerationRun(this.db, { runId: resumeMatch[1], sessionId: text(body.sessionId) || undefined, idempotencyKey: key }));
    const cancelMatch = /^\/api\/runs\/([^/]+)\/cancel$/.exec(pathname);
    if (cancelMatch) return success(response, cancelGenerationRun(this.db, { runId: cancelMatch[1], idempotencyKey: key }));
    const reviewMatch = /^\/api\/assets\/([^/]+)\/review$/.exec(pathname);
    if (reviewMatch) {
      const reviewed = executeIdempotent(this.db, key, 'assets.review', () => {
        const decision = text(body.decision) as 'keep' | 'review' | 'reject' | 'derive';
        setReviewDecision(this.db, { studioId: this.initialized.manifest.studioId, assetId: reviewMatch[1], decision, taskId: text(body.taskId) || undefined, roundId: text(body.roundId) || undefined, feedback: record(body.feedback) });
        return { assetId: reviewMatch[1], decision };
      }, { assetId: reviewMatch[1], decision: text(body.decision), taskId: text(body.taskId) || undefined, roundId: text(body.roundId) || undefined, feedback: record(body.feedback) });
      return success(response, reviewed.value);
    }
    const trashMatch = /^\/api\/assets\/([^/]+)\/trash$/.exec(pathname);
    if (trashMatch) return success(response, executeIdempotent(this.db, key, 'assets.trash', () => softDeleteAsset(this.db, this.initialized.paths, { studioId: this.initialized.manifest.studioId, assetId: trashMatch[1] }), { assetId: trashMatch[1] }).value);
    const restoreMatch = /^\/api\/assets\/([^/]+)\/restore$/.exec(pathname);
    if (restoreMatch) return success(response, executeIdempotent(this.db, key, 'assets.restore', () => restoreAsset(this.db, this.initialized.paths, { studioId: this.initialized.manifest.studioId, assetId: restoreMatch[1] }), { assetId: restoreMatch[1] }).value);
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

  private async importAsset(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const key = headerValue(request, 'idempotency-key');
    if (!key) throw new InvalidCommandError('导入图片需要 idempotency-key。');
    const mediaType = headerValue(request, 'content-type').split(';')[0];
    const targetType = headerValue(request, 'x-daoge-target-type') || undefined;
    const targetId = headerValue(request, 'x-daoge-target-id') || undefined;
    const originalFilename = headerValue(request, 'x-daoge-filename') || undefined;
    const bytes = await readBinaryBody(request);
    const receipt = executeIdempotent(this.db, key, 'assets.import', () => importStudioAsset(this.db, this.initialized.paths, {
      studioId: this.initialized.manifest.studioId,
      bytes,
      mediaType: mediaType || undefined,
      originalFilename,
      targetType,
      targetId,
      source: { channel: 'workbench_upload', idempotencyKey: key }
    }), { contentHash: sha256(bytes), mediaType, targetType, targetId, originalFilename });
    success(response, receipt.value);
  }

  private assetFile(response: ServerResponse, assetId: string): void {
    const asset = getStudioAsset(this.db, this.initialized.manifest.studioId, assetId);
    if (!asset || asset.deletedAt) throw new StudioNotFoundError('Asset not found: ' + assetId);
    const filePath = assetFilePath(this.initialized.paths, asset);
    if (!fs.existsSync(filePath)) throw new StudioNotFoundError('Asset media is missing: ' + assetId);
    response.writeHead(200, { 'content-type': asset.mediaType, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' });
    fs.createReadStream(filePath).on('error', () => response.destroy()).pipe(response);
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
    const send = () => {
      const result = studioEventWindow(this.db, this.initialized.manifest.studioId, cursor);
      if (result.snapshotRequired) {
        response.write('event: snapshot-required\n');
        response.write('data: ' + JSON.stringify({ after: cursor }) + '\n\n');
        return;
      }
      for (const event of result.events) {
        cursor = event.id;
        response.write('id: ' + event.id + '\n');
        response.write('event: studio-event\n');
        response.write('data: ' + JSON.stringify(event) + '\n\n');
      }
    };
    send();
    const timer = setInterval(send, this.pollMs);
    request.on('close', () => clearInterval(timer));
  }

  private sendError(response: ServerResponse, error: unknown): void {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof VersionConflictError) return json(response, 409, { ok: false, error: { code: 'version_conflict', message: error.message } });
    if (error instanceof StudioNotFoundError) return json(response, 404, { ok: false, error: { code: 'not_found', message: error.message } });
    if (error instanceof InvalidCommandError) return json(response, 400, { ok: false, error: { code: 'invalid_command', message: error.message } });
    return json(response, 500, { ok: false, error: { code: 'internal_error', message: 'Studio 本地服务发生未预期错误。' } });
  }
}

export async function startLocalStudioService(options: StudioServiceOptions, port = 0): Promise<StartedStudioService> {
  const service = new LocalStudioService(options);
  try {
    return await service.listen(port);
  } catch (error) {
    await service.close();
    throw error;
  }
}
