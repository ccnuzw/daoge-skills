import { createHash } from 'node:crypto';

/**
 * Single source of truth for deterministic JSON in DAOGE Pic.
 *
 * Canonical JSON is used for three things that must agree with each other:
 * plan/feedback digests, idempotency keys and provenance bodies. Every one of
 * those is an anchor — if two call sites canonicalise the same value
 * differently, the anchors silently stop matching. Before this module existed
 * the repository carried five local copies with subtly different rules (some
 * sorted keys, some did not; some dropped `undefined`, some turned it into
 * `null`), so identical content could hash differently depending on which
 * module happened to be reached first.
 *
 * Rules, applied everywhere:
 *   - object keys are sorted;
 *   - object members whose value is `undefined` are dropped;
 *   - `undefined` in any other position serialises as `null` (matching `JSON.stringify`);
 *   - `NaN` / `Infinity` serialise as `null` unless `strict` is set.
 */

export type CanonicalJsonInvalidReason = 'non-finite-number' | 'non-json-value';

export class CanonicalJsonError extends Error {
  readonly reason: CanonicalJsonInvalidReason;

  constructor(reason: CanonicalJsonInvalidReason) {
    super(reason === 'non-finite-number' ? 'Canonical JSON contains a non-finite number.' : 'Canonical JSON contains a value JSON cannot represent.');
    this.name = 'CanonicalJsonError';
    this.reason = reason;
  }
}

export interface CanonicalJsonOptions {
  /**
   * Reject values that JSON cannot represent instead of normalising them away.
   * Backup manifests use this: silently dropping an unexpected `undefined`
   * would make a manifest validate against content that was never written.
   */
  readonly strict?: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Returns a structurally canonical copy: object keys sorted, non-JSON values
 * either removed or (in `strict` mode) rejected. `Object.fromEntries` is used
 * deliberately — a `__proto__` key is defined as an own property rather than
 * mutating the prototype.
 */
export function canonicalJsonValue(value: unknown, options: CanonicalJsonOptions = {}): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalJsonValue(item, options));
  if (!isPlainRecord(value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      if (options.strict) throw new CanonicalJsonError('non-finite-number');
      return null;
    }
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
      if (options.strict) throw new CanonicalJsonError('non-json-value');
      return undefined;
    }
    return value;
  }
  const entries: Array<[string, unknown]> = [];
  for (const key of Object.keys(value).sort()) {
    const normalized = canonicalJsonValue(value[key], options);
    if (normalized === undefined) continue;
    entries.push([key, normalized]);
  }
  return Object.fromEntries(entries);
}

/**
 * Serialises a canonical value without rebuilding it through an object.
 *
 * Object.fromEntries/JSON.stringify cannot preserve lexicographic ordering for
 * integer-looking keys: JavaScript's property enumeration rules always move
 * those keys ahead and sort them numerically. Building the object text directly
 * keeps the explicit lexical order required by the canonical contract.
 */
function stringifyCanonicalValue(value: unknown, options: CanonicalJsonOptions): string {
  const normalized = canonicalJsonValue(value, options);
  if (normalized === undefined) return 'null';
  if (Array.isArray(normalized)) return '[' + normalized.map((item) => stringifyCanonicalValue(item, options)).join(',') + ']';
  if (isPlainRecord(normalized)) {
    const members: string[] = [];
    for (const key of Object.keys(normalized).sort()) {
      const member = canonicalJsonValue(normalized[key], options);
      if (member === undefined) continue;
      members.push(JSON.stringify(key) + ':' + stringifyCanonicalValue(member, options));
    }
    return '{' + members.join(',') + '}';
  }
  return JSON.stringify(normalized) ?? 'null';
}

/** Canonical JSON string. A bare `undefined` canonicalises to `null`. */
export function canonicalJson(value: unknown, options: CanonicalJsonOptions = {}): string {
  return stringifyCanonicalValue(value, options);
}

/** SHA-256 (hex) over {@link canonicalJson}. */
export function canonicalJsonHash(value: unknown, options: CanonicalJsonOptions = {}): string {
  return createHash('sha256').update(canonicalJson(value, options), 'utf8').digest('hex');
}
