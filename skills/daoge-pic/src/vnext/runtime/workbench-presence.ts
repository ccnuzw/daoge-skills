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
}

interface OpenClaim {
  tokenDigest: Buffer;
  expiresAt: number;
}

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export class WorkbenchPresence {
  private readonly now: () => number;
  private readonly claimTtlMs: number;
  private readonly recentPresenceTtlMs: number;
  private claimState: OpenClaim | null = null;
  private activeConnections = 0;
  private lastAuthenticatedAt = 0;

  constructor(options: WorkbenchPresenceOptions = {}) {
    this.now = options.now || Date.now;
    this.claimTtlMs = Math.max(1000, options.claimTtlMs || 10_000);
    this.recentPresenceTtlMs = Math.max(this.claimTtlMs, options.recentPresenceTtlMs || 15_000);
  }

  claim(token: string, force = false): WorkbenchOpenClaimResult {
    if (!/^[A-Za-z0-9_-]{43,}$/.test(token)) throw new Error('Workbench open claim requires a high-entropy base64url token.');
    const now = this.now();
    if (this.claimState && this.claimState.expiresAt <= now) this.claimState = null;
    if (this.claimState) return { claimed: false, reused: true, reason: 'open-claim-active' };
    if (!force && this.activeConnections > 0) return { claimed: false, reused: true, reason: 'active-workbench' };
    if (!force && this.lastAuthenticatedAt > 0 && now - this.lastAuthenticatedAt < this.recentPresenceTtlMs) return { claimed: false, reused: true, reason: 'recent-workbench' };
    this.claimState = { tokenDigest: tokenDigest(token), expiresAt: now + this.claimTtlMs };
    return { claimed: true, reused: false, reason: force ? 'forced-opener-claim' : 'opener-claim' };
  }

  release(token: string): boolean {
    const claim = this.claimState;
    if (!claim) return false;
    const candidate = tokenDigest(token);
    if (candidate.length !== claim.tokenDigest.length || !timingSafeEqual(candidate, claim.tokenDigest)) return false;
    this.claimState = null;
    return true;
  }

  recordAuthenticatedConnection(): void {
    this.lastAuthenticatedAt = this.now();
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
