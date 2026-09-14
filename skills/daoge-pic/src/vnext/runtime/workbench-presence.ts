import { createHash, timingSafeEqual } from 'node:crypto';

export type WorkbenchOpenReason = 'opener-claim' | 'forced-opener-claim' | 'active-workbench' | 'recent-workbench' | 'open-claim-active';

export interface WorkbenchOpenClaimResult {
  claimed: boolean;
  reused: boolean;
  reason: WorkbenchOpenReason;
}

export interface WorkbenchPresenceOptions {
  now?: () => number;
  claimTtlMs?: number;
  recentPresenceTtlMs?: number;
  persistence?: WorkbenchPresencePersistence;
}

interface OpenClaim {
  tokenDigest: Buffer;
  expiresAt: number;
}

/** Survives a daemon restart so the next `open` still reports an existing Workbench instead of opening another tab. */
export interface WorkbenchPresenceState {
  claimDigestHex: string | null;
  claimExpiresAt: number;
  lastAuthenticatedAt: number;
}

export interface WorkbenchPresencePersistence {
  load(): WorkbenchPresenceState | null;
  save(state: WorkbenchPresenceState): void;
}

/** `recordAuthenticatedConnection` runs per authenticated request, so its write is throttled to keep it off the hot path. */
const PRESENCE_PERSIST_THROTTLE_MS = 2000;

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export class WorkbenchPresence {
  private readonly now: () => number;
  private readonly claimTtlMs: number;
  private readonly recentPresenceTtlMs: number;
  private readonly persistence: WorkbenchPresencePersistence | null = null;
  private claimState: OpenClaim | null = null;
  private activeConnections = 0;
  private lastAuthenticatedAt = 0;
  private lastPersistedAt = 0;

  constructor(options: WorkbenchPresenceOptions = {}) {
    this.now = options.now || Date.now;
    this.claimTtlMs = Math.max(1000, options.claimTtlMs || 10_000);
    this.recentPresenceTtlMs = Math.max(this.claimTtlMs, options.recentPresenceTtlMs || 15_000);
    this.persistence = options.persistence || null;
    if (!this.persistence) return;
    let state: WorkbenchPresenceState | null = null;
    try { state = this.persistence.load(); } catch { state = null; }
    if (!state) return;
    if (state.claimDigestHex && state.claimExpiresAt > this.now()) {
      const tokenDigestValue = Buffer.from(state.claimDigestHex, 'hex');
      if (tokenDigestValue.length === 32) this.claimState = { tokenDigest: tokenDigestValue, expiresAt: state.claimExpiresAt };
    }
    this.lastAuthenticatedAt = state.lastAuthenticatedAt > 0 ? state.lastAuthenticatedAt : 0;
  }

  private persist(force = false): void {
    if (!this.persistence) return;
    const now = this.now();
    if (!force && this.lastPersistedAt !== 0 && now - this.lastPersistedAt < PRESENCE_PERSIST_THROTTLE_MS) return;
    this.lastPersistedAt = now;
    try {
      this.persistence.save({
        claimDigestHex: this.claimState ? this.claimState.tokenDigest.toString('hex') : null,
        claimExpiresAt: this.claimState ? this.claimState.expiresAt : 0,
        lastAuthenticatedAt: this.lastAuthenticatedAt
      });
    } catch { /* presence is advisory; a failed write must not break the request */ }
  }

  claim(token: string, force = false): WorkbenchOpenClaimResult {
    if (!/^[A-Za-z0-9_-]{43,}$/.test(token)) throw new Error('Workbench open claim requires a high-entropy base64url token.');
    const now = this.now();
    if (this.claimState && this.claimState.expiresAt <= now) this.claimState = null;
    if (this.claimState) return { claimed: false, reused: true, reason: 'open-claim-active' };
    if (!force && this.activeConnections > 0) return { claimed: false, reused: true, reason: 'active-workbench' };
    if (!force && this.lastAuthenticatedAt > 0 && now - this.lastAuthenticatedAt < this.recentPresenceTtlMs) return { claimed: false, reused: true, reason: 'recent-workbench' };
    this.claimState = { tokenDigest: tokenDigest(token), expiresAt: now + this.claimTtlMs };
    this.persist(true);
    return { claimed: true, reused: false, reason: force ? 'forced-opener-claim' : 'opener-claim' };
  }

  release(token: string): boolean {
    const claim = this.claimState;
    if (!claim) return false;
    const candidate = tokenDigest(token);
    if (candidate.length !== claim.tokenDigest.length || !timingSafeEqual(candidate, claim.tokenDigest)) return false;
    this.claimState = null;
    this.persist(true);
    return true;
  }

  recordAuthenticatedConnection(): void {
    this.lastAuthenticatedAt = this.now();
    this.persist();
  }

  attachActiveConnection(): () => void {
    this.activeConnections += 1;
    this.recordAuthenticatedConnection();
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      this.activeConnections = Math.max(0, this.activeConnections - 1);
      this.recordAuthenticatedConnection();
    };
  }
}
