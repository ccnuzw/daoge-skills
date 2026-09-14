import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { canonicalJsonHash } from '../shared/canonical-json';

export interface ConfirmationChallenge {
  challenge: string;
  roundId: string;
  sessionId: string;
  conversationId: string;
  planHash: string;
  expectedVersion: number;
  expiresAt: string;
}

export interface ConfirmationConsent {
  roundId: string;
  sessionId: string;
  conversationId: string;
  planHash: string;
  confirmedAt: string;
  expiresAt: string;
}

export interface ConfirmationTokenClaims {
  version: 1;
  roundId: string;
  preflightId: string;
  planHash: string;
  conversationId: string;
}

export interface StoredChallenge extends ConfirmationChallenge {
  challengeHash: string;
}

export interface StoredConsent extends ConfirmationConsent {
  challengeHash: string;
}

export interface IssuedToken {
  claims: ConfirmationTokenClaims;
  expiresAt: number;
  operationKey?: string;
}

/** Everything the gate must keep across a daemon restart so an answered challenge is not thrown away. */
export interface ConfirmationGateState {
  challenges: StoredChallenge[];
  consents: StoredConsent[];
  issuedTokens: Array<{ key: string; token: IssuedToken }>;
}

export interface ConfirmationGatePersistence {
  load(): ConfirmationGateState | null;
  save(state: ConfirmationGateState): void;
}

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const CONSENT_TTL_MS = 30 * 60 * 1000;
const TOKEN_PREFIX = 'dgpct1';

function assertTokenPart(value: string, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(label + ' is required.');
  return normalized;
}

function canonicalClaims(claims: ConfirmationTokenClaims): string {
  return [claims.planHash, claims.preflightId, claims.conversationId].join('\0');
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sign(secret: string, claims: ConfirmationTokenClaims): string {
  return createHmac('sha256', secret).update(canonicalClaims(claims)).digest('base64url');
}

function safeEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash('sha256').update(actual).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function encodeClaims(claims: ConfirmationTokenClaims): string {
  return Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
}

function decodeClaims(value: string): ConfirmationTokenClaims | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<ConfirmationTokenClaims>;
    if (parsed.version !== 1 || typeof parsed.roundId !== 'string' || typeof parsed.preflightId !== 'string' || typeof parsed.planHash !== 'string' || typeof parsed.conversationId !== 'string') return null;
    return { version: 1, roundId: parsed.roundId, preflightId: parsed.preflightId, planHash: parsed.planHash, conversationId: parsed.conversationId };
  } catch {
    return null;
  }
}

export function planHash(plan: unknown): string {
  return canonicalJsonHash(plan);
}

export class ConfirmationGate {
  private readonly challenges = new Map<string, StoredChallenge>();
  private readonly consents = new Map<string, StoredConsent>();
  private readonly issuedTokens = new Map<string, IssuedToken>();
  private readonly secret: string;
  private readonly now: () => Date;
  private readonly persistence: ConfirmationGatePersistence | null;

  constructor(secret?: string, now?: () => Date, persistence?: ConfirmationGatePersistence) {
    if (secret !== undefined && secret.length < 32) throw new Error('Confirmation gate secret must have high entropy.');
    this.secret = secret !== undefined ? secret : randomBytes(32).toString('base64url');
    this.now = now || (() => new Date());
    this.persistence = persistence || null;
    this.restore();
  }

  /** Restores only well-formed, unexpired entries; anything else is dropped rather than trusted. */
  private restore(): void {
    if (!this.persistence) return;
    let state: ConfirmationGateState | null = null;
    try { state = this.persistence.load(); } catch { state = null; }
    if (!state) return;
    for (const challenge of state.challenges || []) {
      if (!challenge || typeof challenge.roundId !== 'string' || typeof challenge.challenge !== 'string' || typeof challenge.challengeHash !== 'string') continue;
      if (typeof challenge.sessionId !== 'string' || typeof challenge.conversationId !== 'string' || typeof challenge.planHash !== 'string') continue;
      if (!Number.isInteger(challenge.expectedVersion) || typeof challenge.expiresAt !== 'string') continue;
      this.challenges.set(challenge.roundId, challenge);
    }
    for (const consent of state.consents || []) {
      if (!consent || typeof consent.roundId !== 'string' || typeof consent.sessionId !== 'string') continue;
      if (typeof consent.conversationId !== 'string' || typeof consent.planHash !== 'string') continue;
      if (typeof consent.confirmedAt !== 'string' || typeof consent.expiresAt !== 'string') continue;
      this.consents.set(consent.roundId, consent);
    }
    for (const entry of state.issuedTokens || []) {
      if (!entry || typeof entry.key !== 'string' || !entry.token || typeof entry.token !== 'object') continue;
      const issued = entry.token as IssuedToken;
      if (!issued.claims || !Number.isFinite(issued.expiresAt)) continue;
      this.issuedTokens.set(entry.key, { claims: issued.claims, expiresAt: issued.expiresAt, ...(issued.operationKey ? { operationKey: issued.operationKey } : {}) });
    }
    this.purgeExpired();
  }

  private persist(): void {
    if (!this.persistence) return;
    try {
      this.persistence.save({
        challenges: [...this.challenges.values()],
        consents: [...this.consents.values()],
        issuedTokens: [...this.issuedTokens.entries()].map(([key, token]) => ({ key, token }))
      });
    } catch { /* the gate stays authoritative in memory; a failed write must not break the request */ }
  }

  createChallenge(input: { roundId: string; sessionId: string; conversationId: string; planHash: string; expectedVersion: number }): ConfirmationChallenge {
    this.purgeExpired();
    const roundId = assertTokenPart(input.roundId, 'roundId');
    const sessionId = assertTokenPart(input.sessionId, 'sessionId');
    const conversationId = assertTokenPart(input.conversationId, 'conversationId');
    const normalizedPlanHash = assertTokenPart(input.planHash, 'planHash');
    const existing = this.challenges.get(roundId);
    if (existing && existing.sessionId === sessionId && existing.conversationId === conversationId && existing.planHash === normalizedPlanHash && existing.expectedVersion === input.expectedVersion) {
      return { challenge: existing.challenge, roundId: existing.roundId, sessionId: existing.sessionId, conversationId: existing.conversationId, planHash: existing.planHash, expectedVersion: existing.expectedVersion, expiresAt: existing.expiresAt };
    }
    const challenge = 'confirm-' + randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + CHALLENGE_TTL_MS);
    const stored: StoredChallenge = {
      challenge,
      challengeHash: digest(challenge),
      roundId,
      sessionId,
      conversationId,
      planHash: normalizedPlanHash,
      expectedVersion: input.expectedVersion,
      expiresAt: expiresAt.toISOString()
    };
    this.challenges.set(stored.roundId, stored);
    this.persist();
    return { challenge: stored.challenge, roundId: stored.roundId, sessionId: stored.sessionId, conversationId: stored.conversationId, planHash: stored.planHash, expectedVersion: stored.expectedVersion, expiresAt: stored.expiresAt };
  }

  getChallenge(roundId: string): ConfirmationChallenge | null {
    this.purgeExpired();
    const challenge = this.challenges.get(roundId);
    if (!challenge) return null;
    return { challenge: challenge.challenge, roundId: challenge.roundId, sessionId: challenge.sessionId, conversationId: challenge.conversationId, planHash: challenge.planHash, expectedVersion: challenge.expectedVersion, expiresAt: challenge.expiresAt };
  }
  validateChallenge(input: { roundId: string; challenge: string; sessionId: string; planHash: string }): boolean {
    this.purgeExpired();
    const stored = this.challenges.get(input.roundId);
    return Boolean(stored && safeEqual(stored.challengeHash, digest(input.challenge)) && stored.sessionId === input.sessionId && stored.planHash === input.planHash);
  }

  confirm(input: { roundId: string; challenge: string; sessionId: string; planHash: string }): ConfirmationConsent {
    this.purgeExpired();
    const stored = this.challenges.get(input.roundId);
    if (!this.validateChallenge(input) || !stored) throw new Error('Confirmation challenge is invalid, expired, or no longer matches the plan.');
    const confirmedAt = this.now();
    const consent: StoredConsent = {
      roundId: stored.roundId,
      sessionId: stored.sessionId,
      conversationId: stored.conversationId,
      planHash: stored.planHash,
      confirmedAt: confirmedAt.toISOString(),
      expiresAt: new Date(confirmedAt.getTime() + CONSENT_TTL_MS).toISOString(),
      challengeHash: stored.challengeHash
    };
    this.consents.set(consent.roundId, consent);
    this.challenges.delete(consent.roundId);
    this.persist();
    return { roundId: consent.roundId, sessionId: consent.sessionId, conversationId: consent.conversationId, planHash: consent.planHash, confirmedAt: consent.confirmedAt, expiresAt: consent.expiresAt };
  }

  consentFor(roundId: string, sessionId?: string): ConfirmationConsent | null {
    this.purgeExpired();
    const consent = this.consents.get(roundId);
    if (!consent || (sessionId && consent.sessionId !== sessionId)) return null;
    return { roundId: consent.roundId, sessionId: consent.sessionId, conversationId: consent.conversationId, planHash: consent.planHash, confirmedAt: consent.confirmedAt, expiresAt: consent.expiresAt };
  }

  issueToken(input: { roundId: string; preflightId: string; planHash: string; conversationId: string }): string {
    this.purgeExpired();
    const consent = this.consents.get(input.roundId);
    if (!consent || consent.conversationId !== input.conversationId) throw new Error('A fresh user confirmation is required before execution.');
    const claims: ConfirmationTokenClaims = { version: 1, roundId: assertTokenPart(input.roundId, 'roundId'), preflightId: assertTokenPart(input.preflightId, 'preflightId'), planHash: assertTokenPart(input.planHash, 'planHash'), conversationId: assertTokenPart(input.conversationId, 'conversationId') };
    const token = TOKEN_PREFIX + '.' + encodeClaims(claims) + '.' + sign(this.secret, claims);
    this.issuedTokens.set(digest(token), { claims, expiresAt: Date.parse(consent.expiresAt) });
    this.persist();
    return token;
  }

  verifyToken(token: string, expected: { roundId: string; preflightId: string; planHash: string; conversationId: string }): boolean {
    this.purgeExpired();
    return Boolean(this.issuedToken(token, expected));
  }

  reserveToken(token: string, expected: { roundId: string; preflightId: string; planHash: string; conversationId: string }, operationKey: string): { replayed: boolean } {
    this.purgeExpired();
    const issued = this.issuedToken(token, expected);
    if (!issued) throw new Error('The confirmation token is invalid, expired, or already reserved by another operation.');
    const normalizedOperationKey = assertTokenPart(operationKey, 'operationKey');
    if (issued.operationKey) {
      if (issued.operationKey === normalizedOperationKey) return { replayed: true };
      throw new Error('The confirmation token has already authorized another execution operation.');
    }
    issued.operationKey = normalizedOperationKey;
    this.persist();
    return { replayed: false };
  }

  releaseToken(token: string, operationKey: string): void {
    const issued = this.issuedTokens.get(digest(String(token || '')));
    if (issued?.operationKey === operationKey) { issued.operationKey = undefined; this.persist(); }
  }

  private issuedToken(token: string, expected: { roundId: string; preflightId: string; planHash: string; conversationId: string }): IssuedToken | null {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
    const claims = decodeClaims(parts[1]);
    if (!claims || !safeEqual(parts[2], sign(this.secret, claims))) return null;
    if (claims.roundId !== expected.roundId || claims.preflightId !== expected.preflightId || claims.planHash !== expected.planHash || claims.conversationId !== expected.conversationId) return null;
    const issued = this.issuedTokens.get(digest(token));
    return issued && issued.expiresAt > this.now().getTime() ? issued : null;
  }

  private purgeExpired(): void {
    const now = this.now().getTime();
    for (const [roundId, challenge] of this.challenges) if (Date.parse(challenge.expiresAt) <= now) this.challenges.delete(roundId);
    for (const [roundId, consent] of this.consents) if (Date.parse(consent.expiresAt) <= now) this.consents.delete(roundId);
    for (const [token, issued] of this.issuedTokens) if (issued.expiresAt <= now) this.issuedTokens.delete(token);
  }
}
