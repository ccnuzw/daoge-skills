export interface SafeErrorDetail { kind?: string; code?: string; summary?: string; }

export function safeErrorSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const summary = value
    .replace(/^http\s+\d{3}:\s*/i, '')
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/\b(?:sk|pk|rk)-[a-z0-9_-]{8,}\b/gi, '[redacted-secret]')
    .replace(/\b(?:bearer|authorization|api[_ -]?key)\s*[:=]?\s*[^\s,;]+/gi, '[redacted-secret]')
    .replace(/\s+/g, ' ')
    .trim();
  return summary ? summary.slice(0, 320) : undefined;
}

export function safeErrorDetail(value: unknown): SafeErrorDetail | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === 'string' ? record.kind : undefined;
  const code = typeof record.code === 'string' ? record.code : undefined;
  const summary = safeErrorSummary(record.summary);
  return kind || code || summary ? { ...(kind ? { kind } : {}), ...(code ? { code } : {}), ...(summary ? { summary } : {}) } : null;
}
