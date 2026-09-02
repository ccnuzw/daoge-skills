import { ImageResult } from './contracts';

export interface ProviderSensitiveValues {
  apiKey: string;
  baseUrl: string;
}

export function redactProviderText(value: unknown, sensitive: ProviderSensitiveValues): string {
  let redacted = String(value || '');
  if (sensitive.apiKey) redacted = redacted.split(sensitive.apiKey).join('[redacted-provider-secret]');
  if (sensitive.baseUrl) redacted = redacted.split(sensitive.baseUrl).join('[redacted-provider-url]');
  return containsSensitiveValue(redacted, sensitive) ? '' : redacted;
}

function containsSensitiveValue(value: string, sensitive: ProviderSensitiveValues): boolean {
  return Boolean((sensitive.apiKey && value.includes(sensitive.apiKey)) || (sensitive.baseUrl && value.includes(sensitive.baseUrl)));
}

export function sanitizeProviderRequestId(value: unknown, sensitive: ProviderSensitiveValues): string | undefined {
  if (typeof value !== 'string') return undefined;
  const redacted = redactProviderText(value.trim(), sensitive);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(redacted) ? redacted : undefined;
}

type SanitizedProviderValue = string | number | boolean | null | undefined | SanitizedProviderValue[] | Record<string, unknown>;

function sanitizeProviderValue(value: unknown, sensitive: ProviderSensitiveValues, ancestors: WeakSet<object>): SanitizedProviderValue {
  if (typeof value === 'string') return redactProviderText(value, sensitive);
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return null;
  if (Buffer.isBuffer(value)) return '[removed-provider-binary-metadata]';
  if (ancestors.has(value)) return '[removed-circular-provider-metadata]';
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => sanitizeProviderValue(item, sensitive, ancestors));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return '[removed-unsupported-provider-metadata]';
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (containsSensitiveValue(key, sensitive)) continue;
      if (/request[_-]?id/i.test(key)) {
        const requestId = sanitizeProviderRequestId(item, sensitive);
        if (requestId) sanitized[key] = requestId;
        continue;
      }
      sanitized[key] = sanitizeProviderValue(item, sensitive, ancestors);
    }
    return sanitized;
  } finally {
    ancestors.delete(value);
  }
}


export function sanitizeProviderMetadata(value: Readonly<Record<string, unknown>> | undefined, sensitive: ProviderSensitiveValues): Record<string, unknown> {
  if (!value) return {};
  const sanitized = sanitizeProviderValue(value, sensitive, new WeakSet<object>());
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== 'object') return {};
  return sanitized;
}

export function sanitizeProviderImageResult(result: ImageResult, sensitive: ProviderSensitiveValues): ImageResult {
  const externalRequestId = sanitizeProviderRequestId(result.externalRequestId, sensitive);
  const revisedPrompt = typeof result.revisedPrompt === 'string' ? redactProviderText(result.revisedPrompt, sensitive) : undefined;
  return {
    bytes: result.bytes,
    mediaType: result.mediaType,
    ...(externalRequestId ? { externalRequestId } : {}),
    ...(revisedPrompt !== undefined ? { revisedPrompt } : {}),
    safeMeta: sanitizeProviderMetadata(result.safeMeta, sensitive)
  };
}
