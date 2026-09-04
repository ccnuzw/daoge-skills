import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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

interface StoredChallenge extends ConfirmationChallenge {
  challengeHash: string;
}

interface StoredConsent extends ConfirmationConsent {
  challengeHash: string;
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
  return digest(canonicalValue(plan));
}

export function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalValue).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => JSON.stringify(key) + ':' + canonicalValue(record[key])).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

export class ConfirmationGate {
  private readonly challenges = new Map<string, StoredChallenge>();
  private readonly consents = new Map<string, StoredConsent>();
  private readonly issuedTokens = new Map<string, { claims: ConfirmationTokenClaims; expiresAt: number }>();

  constructor(private readonly secret: string = randomBytes(32).toString('base64url'), private readonly now: () => Date = () => new Date()) {
    if (secret.length < 32) throw new Error('Confirmation gate secret must have high entropy.');
  }

  createChallenge(input: { roundId: string; sessionId: string; conversationId: string; planHash: string; expectedVersion: number }): ConfirmationChallenge {
    this.purgeExpired();
    const challenge = 'confirm-' + randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + CHALLENGE_TTL_MS);
    const stored: StoredChallenge = {
      challenge,
      challengeHash: digest(challenge),
      roundId: assertTokenPart(input.roundId, 'roundId'),
      sessionId: assertTokenPart(input.sessionId, 'sessionId'),
      conversationId: assertTokenPart(input.conversationId, 'conversationId'),
      planHash: assertTokenPart(input.planHash, 'planHash'),
      expectedVersion: input.expectedVersion,
      expiresAt: expiresAt.toISOString()
    };
    this.challenges.set(stored.roundId, stored);
    return { challenge: stored.challenge, roundId: stored.roundId, sessionId: stored.sessionId, conversationId: stored.conversationId, planHash: stored.planHash, expectedVersion: stored.expectedVersion, expiresAt: stored.expiresAt };
  }

  getChallenge(roundId: string): ConfirmationChallenge | null {
    this.purgeExpired();
    const challenge = this.challenges.get(roundId);
    if (!challenge) return null;
    return { challenge: challenge.challenge, roundId: challenge.roundId, sessionId: challenge.sessionId, conversationId: challenge.conversationId, planHash: challenge.planHash, expectedVersion: challenge.expectedVersion, expiresAt: challenge.expiresAt };
  }

  confirm(input: { roundId: string; challenge: string; sessionId: string; planHash: string }): ConfirmationConsent {
    this.purgeExpired();
    const stored = this.challenges.get(input.roundId);
    if (!stored || !safeEqual(stored.challengeHash, digest(input.challenge)) || stored.sessionId !== input.sessionId || stored.planHash !== input.planHash) throw new Error('Confirmation challenge is invalid, expired, or no longer matches the plan.');
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
    return token;
  }

  verifyToken(token: string, expected: { roundId: string; preflightId: string; planHash: string; conversationId: string }): boolean {
    this.purgeExpired();
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return false;
    const claims = decodeClaims(parts[1]);
    if (!claims || !safeEqual(parts[2], sign(this.secret, claims))) return false;
    if (claims.roundId !== expected.roundId || claims.preflightId !== expected.preflightId || claims.planHash !== expected.planHash || claims.conversationId !== expected.conversationId) return false;
    const issued = this.issuedTokens.get(digest(token));
    return Boolean(issued && issued.expiresAt > this.now().getTime());
  }

  private purgeExpired(): void {
    const now = this.now().getTime();
    for (const [roundId, challenge] of this.challenges) if (Date.parse(challenge.expiresAt) <= now) this.challenges.delete(roundId);
    for (const [roundId, consent] of this.consents) if (Date.parse(consent.expiresAt) <= now) this.consents.delete(roundId);
    for (const [token, issued] of this.issuedTokens) if (issued.expiresAt <= now) this.issuedTokens.delete(token);
  }
}
