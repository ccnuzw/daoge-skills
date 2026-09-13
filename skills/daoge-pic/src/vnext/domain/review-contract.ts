import { InvalidCommandError } from './studio-commands';

export const REVIEW_SCHEMA_VERSION = 2 as const;
export const REVIEW_DECISIONS = ['keep', 'review', 'reject', 'derive'] as const;
export type ReviewDecisionValue = typeof REVIEW_DECISIONS[number];
export const REVIEW_CONTEXT_SOURCES = ['manual', 'batch', 'agent', 'imported'] as const;
export type ReviewContextSource = typeof REVIEW_CONTEXT_SOURCES[number];
export const REVIEW_CONFIDENCE_VALUES = ['low', 'medium', 'high'] as const;
export type ReviewConfidence = typeof REVIEW_CONFIDENCE_VALUES[number];
export const REVIEW_CRITERION_OUTCOMES = ['pass', 'fail', 'not_applicable', 'unknown'] as const;
export type ReviewCriterionOutcome = typeof REVIEW_CRITERION_OUTCOMES[number];

export interface ReviewCriterion {
  id: string;
  outcome: ReviewCriterionOutcome;
  label?: string;
  note?: string;
}

export interface ReviewAnnotationContext {
  schemaVersion: typeof REVIEW_SCHEMA_VERSION;
  source: ReviewContextSource;
  reviewerId?: string;
  projectId?: string;
  taskId?: string;
  roundId?: string;
  runId?: string;
  runItemId?: string;
  confidence?: ReviewConfidence;
  rationale?: string;
  tags: string[];
  criteria: ReviewCriterion[];
}

const CONTEXT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTEXT_TAG_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const FEEDBACK_KEY_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,79}$/u;
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|cookie|credential|endpoint|external.*request|password|provider|prompt|request|response|secret|storage.*path|token|url)/i;
const UNSAFE_TEXT_PATTERN = /\b[a-z][a-z0-9+.-]{1,31}:\/\/|\bwww\.[^\s<>"']+|(?:^|[\s(])(?:~\/|\.{1,2}\/|\/[^\s<>"']+|\\\\[^\s<>"']+|[A-Za-z]:[\\/])|\b(?:bearer|api[_ -]?key|secret|token|sk-[A-Za-z0-9_-]{8,})\b/i;
const REVIEW_CONTEXT_KEYS = new Set(['schemaVersion', 'source', 'reviewerId', 'projectId', 'taskId', 'roundId', 'runId', 'runItemId', 'confidence', 'rationale', 'tags', 'criteria']);
const REVIEW_CRITERION_KEYS = new Set(['id', 'outcome', 'label', 'note']);
const MAX_RATIONALE_LENGTH = 1000;
const MAX_CRITERIA = 32;
const MAX_TAGS = 16;
const MAX_FEEDBACK_DEPTH = 6;
const MAX_FEEDBACK_ENTRIES = 128;
const MAX_FEEDBACK_BYTES = 16 * 1024;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function contextRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidCommandError('Review context 必须是对象。');
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new InvalidCommandError(label + ' 必须是字符串。');
  const text = value.trim();
  if (text.length > maxLength) throw new InvalidCommandError(label + ' 超过长度限制。');
  if (UNSAFE_TEXT_PATTERN.test(text)) throw new InvalidCommandError(label + ' 不能包含 URL、路径或凭据。');
  return text || undefined;
}

function contextId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !CONTEXT_ID_PATTERN.test(value.trim())) throw new InvalidCommandError(label + ' 不是合法的上下文标识。');
  return value.trim();
}

function contextEnum<T extends readonly string[]>(value: unknown, values: T, label: string): T[number] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !values.includes(value as T[number])) throw new InvalidCommandError(label + ' 不是支持的枚举值。');
  return value as T[number];
}

function normalizeCriteria(value: unknown): ReviewCriterion[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_CRITERIA) throw new InvalidCommandError('Review criteria 必须是最多 32 项的数组。');
  return value.map((item, index) => {
    const input = record(item);
    for (const key of Object.keys(input)) if (!REVIEW_CRITERION_KEYS.has(key)) throw new InvalidCommandError('Review criterion #' + (index + 1) + ' 包含不支持的字段。');
    const id = contextId(input.id, 'Review criterion #' + (index + 1) + ' id');
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(id)) throw new InvalidCommandError('Review criterion #' + (index + 1) + ' 需要合法 id。');
    const outcome = contextEnum(input.outcome, REVIEW_CRITERION_OUTCOMES, 'Review criterion #' + (index + 1) + ' outcome');
    if (!outcome) throw new InvalidCommandError('Review criterion #' + (index + 1) + ' 需要 outcome。');
    const label = boundedText(input.label, 'Review criterion #' + (index + 1) + ' label', 160);
    const note = boundedText(input.note, 'Review criterion #' + (index + 1) + ' note', 500);
    return { id, outcome, ...(label ? { label } : {}), ...(note ? { note } : {}) };
  });
}

function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TAGS) throw new InvalidCommandError('Review tags 必须是最多 16 项的数组。');
  const tags = value.map((item) => typeof item === 'string' ? item.trim().toLowerCase() : '');
  if (tags.some((tag) => !CONTEXT_TAG_PATTERN.test(tag))) throw new InvalidCommandError('Review tags 只能包含安全标识。');
  return [...new Set(tags)];
}

function normalizeFeedbackValue(value: unknown, label: string, depth: number): unknown {
  if (depth > MAX_FEEDBACK_DEPTH) throw new InvalidCommandError('Review feedback 嵌套层级过深。');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.length > 1000) throw new InvalidCommandError(label + ' 超过长度限制。');
    if (UNSAFE_TEXT_PATTERN.test(text)) throw new InvalidCommandError(label + ' 不能包含 URL、路径或凭据。');
    return text;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InvalidCommandError(label + ' 必须是有限数值。');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_FEEDBACK_ENTRIES) throw new InvalidCommandError(label + ' 项数超过限制。');
    return value.map((item, index) => normalizeFeedbackValue(item, label + '[' + index + ']', depth + 1));
  }
  if (!value || typeof value !== 'object') throw new InvalidCommandError(label + ' 只支持 JSON 标量、数组或对象。');
  const result: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_FEEDBACK_ENTRIES) throw new InvalidCommandError(label + ' 字段数超过限制。');
  for (const [key, item] of entries) {
    if (!FEEDBACK_KEY_PATTERN.test(key) || SENSITIVE_KEY_PATTERN.test(key)) throw new InvalidCommandError(label + ' 包含不安全字段名。');
    result[key] = normalizeFeedbackValue(item, label + '.' + key, depth + 1);
  }
  return result;
}

/** Validates legacy feedback without persisting URLs, paths, credentials, or raw request material. */
export function normalizeReviewFeedback(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidCommandError('Review feedback 必须是对象。');
  const normalized = normalizeFeedbackValue(value, 'Review feedback', 0) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_FEEDBACK_BYTES) throw new InvalidCommandError('Review feedback 过大。');
  return normalized;
}

export function normalizeReviewContext(value: unknown, defaults: Partial<ReviewAnnotationContext> = {}): ReviewAnnotationContext {
  const input = contextRecord(value);
  for (const key of Object.keys(input)) if (!REVIEW_CONTEXT_KEYS.has(key)) throw new InvalidCommandError('Review context 包含不支持的字段。');
  if (input.schemaVersion !== undefined && input.schemaVersion !== REVIEW_SCHEMA_VERSION) throw new InvalidCommandError('Review context schemaVersion 不受支持。');
  const source = contextEnum(input.source ?? defaults.source, REVIEW_CONTEXT_SOURCES, 'Review context source') || 'manual';
  const reviewerId = contextId(input.reviewerId ?? defaults.reviewerId, 'Review context reviewerId');
  const projectId = contextId(input.projectId ?? defaults.projectId, 'Review context projectId');
  const taskId = contextId(input.taskId ?? defaults.taskId, 'Review context taskId');
  const roundId = contextId(input.roundId ?? defaults.roundId, 'Review context roundId');
  const runId = contextId(input.runId ?? defaults.runId, 'Review context runId');
  const runItemId = contextId(input.runItemId ?? defaults.runItemId, 'Review context runItemId');
  const confidence = contextEnum(input.confidence ?? defaults.confidence, REVIEW_CONFIDENCE_VALUES, 'Review context confidence');
  const rationale = boundedText(input.rationale ?? defaults.rationale, 'Review context rationale', MAX_RATIONALE_LENGTH);
  const tags = normalizeTags(input.tags ?? defaults.tags);
  const criteria = normalizeCriteria(input.criteria ?? defaults.criteria);
  return { schemaVersion: REVIEW_SCHEMA_VERSION, source, ...(reviewerId ? { reviewerId } : {}), ...(projectId ? { projectId } : {}), ...(taskId ? { taskId } : {}), ...(roundId ? { roundId } : {}), ...(runId ? { runId } : {}), ...(runItemId ? { runItemId } : {}), ...(confidence ? { confidence } : {}), ...(rationale ? { rationale } : {}), tags, criteria };
}

export function parseReviewContext(value: string | null | undefined): ReviewAnnotationContext | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    const input = record(parsed);
    if (input.schemaVersion !== REVIEW_SCHEMA_VERSION) return null;
    return normalizeReviewContext(input);
  } catch {
    return null;
  }
}

