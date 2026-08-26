import { ImageProvider, ImageRequest, ImageResult, ProviderError } from '../providers/contracts';
import { ManagedAssetResolver } from '../media/asset-resolver';
import { InvalidCommandError } from '../domain/studio-commands';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { providerSnapshot, ResolvedProviderConfig } from '../studio/provider-config';
import { ClaimedRunItem, claimRunItems, getGenerationRun, listGenerationRunItems, renewRunItemLease, transitionRunItem } from './run-commands';
import { retryDecision, RetryPolicy, DEFAULT_RETRY_POLICY } from './retry-policy';

export interface PersistedImageResult {
  assetId: string;
  mediaType: string;
  byteSize: number;
  contentHash: string;
}

export interface GeneratedAssetPersister {
  persistGeneratedImage(input: { runId: string; itemId: string; result: ImageResult }): Promise<PersistedImageResult>;
}

export interface WorkerOptions {
  db: StudioDatabase;
  workerId: string;
  provider: ImageProvider;
  providerConfig: ResolvedProviderConfig;
  assetPersister: GeneratedAssetPersister;
  assetResolver?: ManagedAssetResolver;
  leaseMs?: number;
  retryPolicy?: RetryPolicy;
  now?: () => Date;
}

export interface WorkerProcessResult {
  claimed: number;
  succeeded: number;
  retrying: number;
  blocked: number;
  unknown: number;
}

function promptFromItem(item: ClaimedRunItem): string {
  const prompt = item.promptPayload.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) throw new InvalidCommandError('Run item prompt payload is invalid.');
  return prompt.trim();
}

function outputFromItem(item: ClaimedRunItem): Record<string, unknown> {
  const output = item.promptPayload.output;
  return output && typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : {};
}

function operationFromItem(item: ClaimedRunItem): 'generate' | 'edit' {
  return item.promptPayload.operation === 'edit' ? 'edit' : 'generate';
}

export class GenerationWorker {
  private readonly db: StudioDatabase;
  private readonly workerId: string;
  private readonly provider: ImageProvider;
  private readonly providerConfig: ResolvedProviderConfig;
  private readonly assetPersister: GeneratedAssetPersister;
  private readonly assetResolver?: ManagedAssetResolver;
  private readonly leaseMs: number;
  private readonly policy: RetryPolicy;
  private readonly clock: () => Date;

  constructor(options: WorkerOptions) {
    this.db = options.db;
    this.workerId = options.workerId;
    this.provider = options.provider;
    this.providerConfig = options.providerConfig;
    this.assetPersister = options.assetPersister;
    this.assetResolver = options.assetResolver;
    this.leaseMs = options.leaseMs || 30000;
    this.policy = options.retryPolicy || DEFAULT_RETRY_POLICY;
    this.clock = options.now || (() => new Date());
    if (this.provider.id !== this.providerConfig.providerId) {
      throw new InvalidCommandError('A worker can only process the Provider configuration it was started with.');
    }
  }

  async processOnce(limit = 1): Promise<WorkerProcessResult> {
    const snapshot = providerSnapshot(this.providerConfig);
    const claimedItems = claimRunItems(this.db, { workerId: this.workerId, limit, leaseMs: this.leaseMs, now: this.clock(), providerSnapshot: { providerId: snapshot.providerId, model: snapshot.model, endpoint: snapshot.endpoint } });
    const result: WorkerProcessResult = { claimed: claimedItems.length, succeeded: 0, retrying: 0, blocked: 0, unknown: 0 };
    const affectedRuns = new Set<string>();
    for (const item of claimedItems) {
      const outcome = await this.processClaimedItem(item);
      result[outcome] += 1;
      affectedRuns.add(item.runId);
    }
    for (const runId of affectedRuns) this.settleRun(runId);
    return result;
  }

  private async processClaimedItem(item: ClaimedRunItem): Promise<'succeeded' | 'retrying' | 'blocked' | 'unknown'> {
    const run = getGenerationRun(this.db, item.runId);
    if (!run) throw new InvalidCommandError('Claimed item belongs to a missing run.');
    const snapshotProvider = String(run.providerSnapshot.providerId || '');
    if (snapshotProvider !== this.provider.id) {
      transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'blocked', error: { code: 'provider_worker_mismatch' } });
      return 'blocked';
    }

    transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'requesting' });
    const controller = new AbortController();
    let request: ImageRequest;
    try {
      const managedAssets = this.assetResolver ? this.assetResolver.resolve({ studioId: item.studioId, referenceAssetIds: item.promptPayload.referenceAssetIds, maskAssetId: item.promptPayload.maskAssetId }) : { referenceAssets: [], maskAsset: undefined };
      request = { requestId: item.requestId, idempotencyKey: 'run-request-' + item.requestId, prompt: promptFromItem(item), output: outputFromItem(item), ...managedAssets };
    } catch {
      transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'blocked', error: { code: 'managed_asset_resolution_failed' } });
      return 'blocked';
    }
    const renewTimer = setInterval(() => {
      try { renewRunItemLease(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), leaseMs: this.leaseMs, now: this.clock() }); }
      catch { controller.abort(); }
    }, Math.max(1000, Math.floor(this.leaseMs / 3)));
    let imageResult: ImageResult;
    try {
      const operation = operationFromItem(item);
      if (operation === 'edit') {
        if (!this.provider.edit) throw { code: 'edit_unsupported', message: 'The selected Provider does not implement image editing.', status: 422 };
        imageResult = await this.provider.edit(request, { abortSignal: controller.signal });
      } else imageResult = await this.provider.generate(request, { abortSignal: controller.signal });
    } catch (error) {
      clearInterval(renewTimer);
      const classified = this.provider.classifyError(error) as ProviderError;
      const decision = retryDecision(classified, item.attempts, this.clock(), this.policy);
      if (decision.retry) {
        transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'retry_wait', retryAt: decision.retryAt, error: { kind: classified.kind, code: classified.code } });
        return 'retrying';
      }
      if (classified.kind === 'unknown_outcome') {
        transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'outcome_unknown', error: { kind: classified.kind, code: classified.code } });
        return 'unknown';
      }
      transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'blocked', error: { kind: classified.kind, code: classified.code } });
      return 'blocked';
    }
    try {
      transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'receiving' });
      transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'persisting' });
      const persisted = await this.assetPersister.persistGeneratedImage({ runId: item.runId, itemId: item.id, result: imageResult });
      transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'succeeded', result: { assetId: persisted.assetId, mediaType: persisted.mediaType, byteSize: persisted.byteSize, contentHash: persisted.contentHash, externalRequestId: imageResult.externalRequestId || null, revisedPrompt: imageResult.revisedPrompt || null, safeMeta: imageResult.safeMeta || {} } });
      return 'succeeded';
    } catch {
      transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'blocked', error: { code: 'local_persistence_failed' } });
      return 'blocked';
    } finally { clearInterval(renewTimer); }
  }

  settleRun(runId: string): void {
    const run = getGenerationRun(this.db, runId);
    if (!run || run.status === 'cancelled' || run.status === 'completed' || run.status === 'failed') return;
    const items = listGenerationRunItems(this.db, runId);
    if (!items.length) return;
    const active = items.some((item) => ['pending', 'leased', 'requesting', 'receiving', 'persisting', 'retry_wait', 'cancel_requested'].includes(item.status));
    if (active) return;
    const timestamp = this.clock().toISOString();
    const studio = this.db.prepare('SELECT p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(runId) as { studio_id: string } | undefined;
    if (run.status === 'pausing') {
      withTransaction(this.db, () => {
        this.db.prepare('UPDATE generation_runs SET status = ?, version = version + 1, updated_at = ? WHERE id = ?').run('paused', timestamp, runId);
        if (studio) appendStudioEvent(this.db, { studioId: studio.studio_id, entityType: 'generation_run', entityId: runId, eventType: 'run.paused', payload: { settledByWorker: true } });
      });
      return;
    }
    const successful = items.filter((item) => item.status === 'succeeded').length;
    const nextStatus = successful === items.length ? 'completed' : successful > 0 ? 'partial' : 'failed';
    if (nextStatus === run.status) return;
    withTransaction(this.db, () => {
      this.db.prepare('UPDATE generation_runs SET status = ?, completed_at = ?, version = version + 1, updated_at = ? WHERE id = ?').run(nextStatus, timestamp, timestamp, runId);
      if (studio) appendStudioEvent(this.db, { studioId: studio.studio_id, entityType: 'generation_run', entityId: runId, eventType: 'run.' + nextStatus, payload: { succeeded: successful, total: items.length } });
    });
  }
}
