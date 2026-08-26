import { ProviderError } from '../providers/contracts';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
}

export interface RetryDecision {
  retry: boolean;
  retryAt?: string;
  reason: string;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 1500,
  maxDelayMs: 60000,
  jitterRatio: 0.2
};

export function retryDecision(error: ProviderError, attempts: number, now = new Date(), policy: RetryPolicy = DEFAULT_RETRY_POLICY, random = Math.random): RetryDecision {
  if (error.kind !== 'transient' && error.kind !== 'rate_limited') {
    return { retry: false, reason: 'non_retryable_' + error.kind };
  }
  if (attempts >= policy.maxAttempts) {
    return { retry: false, reason: 'retry_limit_reached' };
  }
  const exponentialDelay = Math.min(policy.maxDelayMs, policy.baseDelayMs * Math.pow(2, Math.max(0, attempts - 1)));
  const providerDelay = error.retryAfterMs ? Math.min(policy.maxDelayMs, Math.max(exponentialDelay, error.retryAfterMs)) : exponentialDelay;
  const jitter = providerDelay * policy.jitterRatio * ((random() * 2) - 1);
  const delayMs = Math.max(0, Math.round(providerDelay + jitter));
  return { retry: true, retryAt: new Date(now.getTime() + delayMs).toISOString(), reason: error.kind };
}
