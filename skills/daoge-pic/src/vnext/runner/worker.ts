import { ImageProvider, ImageRequest, ImageResult, ProviderError } from '../providers/contracts';
import { safeErrorSummary } from '../shared/safe-error';
import { redactProviderText, sanitizeProviderImageResult, sanitizeProviderRequestId } from '../providers/response-sanitizer';
import { ManagedAssetResolver } from '../media/asset-resolver';
import { InvalidCommandError } from '../domain/studio-commands';
import { StudioDatabase } from '../studio/database';
import { providerSnapshot, ResolvedProviderConfig } from '../studio/provider-config';
import { ClaimedRunItem, claimRunItems, getGenerationRun, getGenerationRunItem, markRunItemOutcomeUnknown, promoteDueRetryWaitItems, renewRunItemLease, settleTerminalGenerationRun, transitionRunItem } from './run-commands';
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
  cancelled: number;
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

type ItemProcessingOutcome = 'succeeded' | 'retrying' | 'blocked' | 'unknown' | 'cancelled';
type MonitorEvent = { kind: 'cancel_requested' } | { kind: 'ownership_lost' } | { kind: 'shutdown' };
type OperationOutcome<T> = { kind: 'fulfilled'; value: T } | { kind: 'rejected'; reason: unknown };

function tracked<T>(operation: Promise<T>): Promise<OperationOutcome<T>> {
  return operation.then((value) => ({ kind: 'fulfilled', value }), (reason) => ({ kind: 'rejected', reason }));
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
  private stopping = false;
  private readonly activeShutdowns = new Set<() => void>();

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
  shutdown(): void {
    if (this.stopping) return;
    this.stopping = true;
    for (const shutdown of [...this.activeShutdowns]) shutdown();
  }


  async processOnce(limit = 1): Promise<WorkerProcessResult> {
    if (this.stopping) return { claimed: 0, succeeded: 0, retrying: 0, blocked: 0, unknown: 0, cancelled: 0 };
    const snapshot = providerSnapshot(this.providerConfig);
    const now = this.clock();
    promoteDueRetryWaitItems(this.db, now);
    const claimedItems = claimRunItems(this.db, { workerId: this.workerId, limit, leaseMs: this.leaseMs, now, providerSnapshot: { profileId: snapshot.profileId, configVersion: snapshot.configVersion } });
    const result: WorkerProcessResult = { claimed: claimedItems.length, succeeded: 0, retrying: 0, blocked: 0, unknown: 0, cancelled: 0 };
    const affectedRuns = new Set(claimedItems.map((item) => item.runId));
    // A batch lease is a concurrency budget. Processing it serially can let later items expire while an earlier Provider call is still pending.
    const outcomes = await Promise.allSettled(claimedItems.map((item) => this.processClaimedItem(item)));
    for (const outcome of outcomes) if (outcome.status === 'fulfilled') result[outcome.value] += 1;
    for (const runId of affectedRuns) this.settleRun(runId);
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return result;
  }

  private markUnknown(item: ClaimedRunItem, reason: string): 'unknown' {
    try {
      markRunItemOutcomeUnknown(this.db, { itemId: item.id, requestId: item.requestId, reason, now: this.clock() });
      return 'unknown';
    } catch (error) {
      if (getGenerationRunItem(this.db, item.id)?.status === 'outcome_unknown') return 'unknown';
      throw error;
    }
  }

  private settleCancellation(item: ClaimedRunItem, safeToCancel: boolean): 'cancelled' | 'unknown' {
    const current = getGenerationRunItem(this.db, item.id);
    if (!current) throw new InvalidCommandError('Cancelled run item no longer exists.');
    if (current.status === 'cancelled') return 'cancelled';
    if (current.status === 'outcome_unknown') return 'unknown';
    if (current.status !== 'cancel_requested' || !safeToCancel) return this.markUnknown(item, current.status === 'cancel_requested' ? 'cancelled_request_uncertain' : 'lease_ownership_lost');
    try {
      transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'cancelled' });
      return 'cancelled';
    } catch {
      return this.markUnknown(item, 'lease_ownership_lost');
    }
  }

  private transitionAfterProvider(item: ClaimedRunItem, safeToCancel: boolean, input: Parameters<typeof transitionRunItem>[1]): ItemProcessingOutcome | null {
    try {
      transitionRunItem(this.db, input);
      return null;
    } catch {
      const current = getGenerationRunItem(this.db, item.id);
      if (current?.status === 'cancel_requested') return this.settleCancellation(item, safeToCancel);
      if (current?.status === 'cancelled') return 'cancelled';
      return this.markUnknown(item, 'lease_ownership_lost');
    }
  }

  private async processClaimedItem(item: ClaimedRunItem): Promise<ItemProcessingOutcome> {
    const run = getGenerationRun(this.db, item.runId);
    if (!run) throw new InvalidCommandError('Claimed item belongs to a missing run.');
    const snapshotProfileId = String(run.providerSnapshot.profileId || '');
    const snapshotConfigVersion = Number(run.providerSnapshot.configVersion);
    if (snapshotProfileId !== this.providerConfig.profileId || snapshotConfigVersion !== this.providerConfig.configVersion) {
      transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'blocked', error: { code: 'provider_profile_version_mismatch' } });
      return 'blocked';
    }

    try {
      transitionRunItem(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'requesting' });
    } catch (error) {
      const current = getGenerationRunItem(this.db, item.id);
      if (current?.status === 'cancelled') return 'cancelled';
      if (current?.status === 'cancel_requested') return this.settleCancellation(item, true);
      throw error;
    }
    const controller = new AbortController();
    let request: ImageRequest;
    try {
      const managedAssets = this.assetResolver ? this.assetResolver.resolve({ studioId: item.studioId, referenceAssetIds: item.promptPayload.referenceAssetIds, maskAssetId: item.promptPayload.maskAssetId }) : { referenceAssets: [], maskAsset: undefined };
      request = { requestId: item.requestId, idempotencyKey: 'run-request-' + item.requestId, prompt: promptFromItem(item), output: outputFromItem(item), ...managedAssets };
    } catch {
      const transition = this.transitionAfterProvider(item, true, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'blocked', error: { code: 'managed_asset_resolution_failed' } });
      return transition || 'blocked';
    }

    let monitorEvent: MonitorEvent | null = null;
    let resolveMonitor: (event: MonitorEvent) => void = () => undefined;
    const monitorPromise = new Promise<MonitorEvent>((resolve) => { resolveMonitor = resolve; });
    const finishMonitoring = (event: MonitorEvent): MonitorEvent => {
      if (!monitorEvent) {
        monitorEvent = event;
        controller.abort();
        resolveMonitor(event);
      }
      return monitorEvent || event;
    };
    const observeLease = (): MonitorEvent | null => {
      if (monitorEvent) return monitorEvent;
      try {
        const current = renewRunItemLease(this.db, { itemId: item.id, leaseToken: String(item.leaseToken), leaseMs: this.leaseMs, now: this.clock() });
        return current.status === 'cancel_requested' ? finishMonitoring({ kind: 'cancel_requested' }) : null;
      } catch {
        return finishMonitoring({ kind: 'ownership_lost' });
      }
    };
    const shutdown = (): void => { finishMonitoring({ kind: 'shutdown' }); };
    this.activeShutdowns.add(shutdown);
    const renewTimer = setInterval(observeLease, Math.max(100, Math.min(1000, Math.floor(this.leaseMs / 3))));

    try {
      const initialEvent = observeLease();
      if (initialEvent?.kind === 'cancel_requested') return this.settleCancellation(item, true);
      if (initialEvent?.kind === 'ownership_lost') return this.markUnknown(item, 'lease_ownership_lost');
      if (initialEvent?.kind === 'shutdown') return this.markUnknown(item, 'daemon_shutdown');
      const providerOperation = Promise.resolve().then(async () => {
        const operation = operationFromItem(item);
        if (operation === 'edit') {
          if (!this.provider.edit) throw { code: 'edit_unsupported', message: 'The selected Provider does not implement image editing.', status: 422 };
          return await this.provider.edit(request, { abortSignal: controller.signal });
        }
        return await this.provider.generate(request, { abortSignal: controller.signal });
      });
      const providerOutcome = await Promise.race([tracked(providerOperation), monitorPromise]);
      if (providerOutcome.kind === 'cancel_requested') return this.settleCancellation(item, false);
      if (providerOutcome.kind === 'ownership_lost') return this.markUnknown(item, 'lease_ownership_lost');
      if (providerOutcome.kind === 'shutdown') return this.markUnknown(item, 'daemon_shutdown');
      if (providerOutcome.kind === 'rejected') {
        const event = monitorEvent || observeLease();
        if (event?.kind === 'cancel_requested') return this.settleCancellation(item, false);
        if (event?.kind === 'ownership_lost') return this.markUnknown(item, 'lease_ownership_lost');
        if (event?.kind === 'shutdown') return this.markUnknown(item, 'daemon_shutdown');
        const classified: ProviderError = this.provider.classifyError(providerOutcome.reason);
        const decision = retryDecision(classified, item.attempts, this.clock(), this.policy);
        const summary = safeErrorSummary(redactProviderText(classified.message, this.providerConfig));
        const error = { kind: sanitizeProviderRequestId(classified.kind, this.providerConfig) || 'unknown_outcome', code: sanitizeProviderRequestId(classified.code, this.providerConfig) || 'provider_error', ...(summary ? { summary } : {}) };
        if (decision.retry) {
          const transition = this.transitionAfterProvider(item, false, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'retry_wait', retryAt: decision.retryAt, error });
          return transition || 'retrying';
        }
        if (classified.kind === 'unknown_outcome') {
          const transition = this.transitionAfterProvider(item, false, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'outcome_unknown', error });
          return transition || 'unknown';
        }
        const transition = this.transitionAfterProvider(item, false, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'blocked', error });
        return transition || 'blocked';
      }

      const imageResult = sanitizeProviderImageResult(providerOutcome.value, this.providerConfig);
      let event = monitorEvent || observeLease();
      if (event?.kind === 'cancel_requested') return this.settleCancellation(item, true);
      if (event?.kind === 'ownership_lost') return this.markUnknown(item, 'lease_ownership_lost');
      let transition = this.transitionAfterProvider(item, true, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'receiving' });
      if (transition) return transition;
      event = monitorEvent || observeLease();
      if (event?.kind === 'cancel_requested') return this.settleCancellation(item, true);
      if (event?.kind === 'ownership_lost') return this.markUnknown(item, 'lease_ownership_lost');
      transition = this.transitionAfterProvider(item, true, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'persisting' });
      if (transition) return transition;

      const persistenceOperation = Promise.resolve().then(() => this.assetPersister.persistGeneratedImage({ runId: item.runId, itemId: item.id, result: imageResult }));
      const persistenceOutcome = await tracked(persistenceOperation);
      event = monitorEvent || observeLease();
      if (event?.kind === 'cancel_requested') return this.settleCancellation(item, true);
      if (event?.kind === 'ownership_lost') return this.markUnknown(item, 'lease_ownership_lost');
      if (persistenceOutcome.kind === 'rejected') {
        transition = this.transitionAfterProvider(item, true, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'blocked', error: { code: 'local_persistence_failed' } });
        return transition || 'blocked';
      }
      const persisted = persistenceOutcome.value;
      transition = this.transitionAfterProvider(item, true, { itemId: item.id, leaseToken: String(item.leaseToken), now: this.clock(), status: 'succeeded', result: { assetId: persisted.assetId, mediaType: persisted.mediaType, byteSize: persisted.byteSize, contentHash: persisted.contentHash, externalRequestId: imageResult.externalRequestId || null, revisedPrompt: imageResult.revisedPrompt || null, safeMeta: imageResult.safeMeta || {} } });
      return transition || 'succeeded';
    } finally {
      this.activeShutdowns.delete(shutdown);
      clearInterval(renewTimer);
    }
  }

  settleRun(runId: string): void {
    settleTerminalGenerationRun(this.db, runId, this.clock());
  }
}
