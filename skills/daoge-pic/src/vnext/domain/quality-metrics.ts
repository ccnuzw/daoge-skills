import { StudioDatabase } from '../studio/database';
import { RUN_ITEM_STATUSES, RUN_STATUSES, RunItemStatus, RunStatus } from './states';
import { safeErrorDetail } from '../shared/safe-error';
import { StudioNotFoundError } from './studio-commands';
import { ENTITY_SCOPE_QUERIES } from './studio-scope';

const TERMINAL_ITEM_STATUSES = new Set<RunItemStatus>(['succeeded', 'failed', 'blocked', 'outcome_unknown', 'cancelled']);
const FAILURE_ITEM_STATUSES = new Set<RunItemStatus>(['failed', 'blocked', 'outcome_unknown', 'retry_wait']);
const METRIC_TOKEN = /^[a-z0-9][a-z0-9._:-]{0,95}$/;
const MAX_FAILURE_PATTERNS = 50;

export interface QualityMetricsQuery {
  projectId?: string;
}

export interface FailurePatternMetric {
  key: string;
  code: string;
  kind?: string;
  count: number;
  lastSeenAt: string;
}

export interface QualityMetrics {
  generatedAt: string;
  scope: { studioId: string; projectId?: string };
  runs: {
    total: number;
    byStatus: Record<RunStatus, number>;
  };
  runItems: {
    total: number;
    terminal: number;
    settled: number;
    successful: number;
    failed: number;
    blocked: number;
    retryWait: number;
    unknownOutcome: number;
    cancelled: number;
    successRate: number | null;
    byStatus: Record<RunItemStatus, number>;
  };
  reviews: {
    total: number;
    byDecision: Record<'keep' | 'review' | 'reject' | 'derive', number>;
    keepRate: number | null;
  };
  failurePatterns: FailurePatternMetric[];
}

interface RunStatusRow { status: string; total: number; }
interface RunItemMetricRow { status: string; error_json: string | null; updated_at: string; }
interface ReviewDecisionRow { decision: string; total: number; }

function requireProjectInStudio(db: StudioDatabase, studioId: string, projectId: string): void {
  const row = db.prepare('SELECT id FROM projects WHERE id = ? AND studio_id = ?').get(projectId, studioId) as { id: string } | undefined;
  if (!row) throw new StudioNotFoundError('Project not found: ' + projectId);
}

function projectScope(projectId?: string): { sql: string; values: string[] } {
  return projectId ? { sql: ' AND project.id = ?', values: [projectId] } : { sql: '', values: [] };
}

function emptyRunStatusCounts(): Record<RunStatus, number> {
  return Object.fromEntries(RUN_STATUSES.map((status) => [status, 0])) as Record<RunStatus, number>;
}

function emptyRunItemStatusCounts(): Record<RunItemStatus, number> {
  return Object.fromEntries(RUN_ITEM_STATUSES.map((status) => [status, 0])) as Record<RunItemStatus, number>;
}

function metricToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim().toLowerCase();
  return METRIC_TOKEN.test(token) ? token : undefined;
}

function failurePattern(row: RunItemMetricRow): { key: string; code: string; kind?: string } {
  let detail: ReturnType<typeof safeErrorDetail> = null;
  if (row.error_json) {
    try {
      detail = safeErrorDetail(JSON.parse(row.error_json));
    } catch {
      // Malformed historical errors are counted without exposing their contents.
    }
  }
  const code = metricToken(detail?.code) || 'unclassified';
  const kind = metricToken(detail?.kind);
  return { key: kind ? kind + ':' + code : code, code, ...(kind ? { kind } : {}) };
}

function reviewScope(studioId: string, projectId?: string): { sql: string; values: string[] } {
  if (!projectId) return { sql: 'asset.studio_id = ?', values: [] };
  const values: string[] = [];
  const projectParam = () => { values.push(projectId); return '?'; };
  const studioParam = () => { values.push(studioId); return '?'; };
  const contextTaskMatches = `(json_extract(review.context_json, '$.taskId') IS NULL OR json_extract(review.context_json, '$.taskId') = review.task_id)`;
  const contextRoundMatches = `(json_extract(review.context_json, '$.roundId') IS NULL OR json_extract(review.context_json, '$.roundId') = review.round_id)`;
  const contextScope = `(review.schema_version < 2 OR (json_valid(review.context_json) = 1 AND (json_extract(review.context_json, '$.projectId') IS NULL OR json_extract(review.context_json, '$.projectId') = ${projectParam()}) AND ${contextTaskMatches} AND ${contextRoundMatches}))`;
  const projectRelation = `EXISTS (
    SELECT 1 FROM asset_relations project_relation
    WHERE project_relation.asset_id = review.asset_id
      AND (
        (project_relation.relation_type = 'attached_to' AND project_relation.target_type = 'project' AND project_relation.target_id = ${projectParam()})
        OR (project_relation.relation_type = 'attached_to' AND project_relation.target_type = 'creative_task' AND EXISTS (
          SELECT 1 FROM creative_tasks related_task
          WHERE related_task.id = project_relation.target_id AND related_task.project_id = ${projectParam()}
        ))
        OR (project_relation.relation_type = 'attached_to' AND project_relation.target_type = 'creative_round' AND EXISTS (
          SELECT 1 FROM creative_rounds related_round
          JOIN creative_tasks related_round_task ON related_round_task.id = related_round.task_id
          WHERE related_round.id = project_relation.target_id AND related_round_task.project_id = ${projectParam()}
        ))
        OR (project_relation.relation_type = 'output_of' AND project_relation.target_type = 'run_item' AND EXISTS (
          SELECT 1 FROM run_items related_item
          JOIN generation_runs related_run ON related_run.id = related_item.run_id
          JOIN creative_rounds related_round ON related_round.id = related_run.round_id
          JOIN creative_tasks related_round_task ON related_round_task.id = related_round.task_id
          WHERE related_item.id = project_relation.target_id AND related_round_task.project_id = ${projectParam()}
        ))
        OR (
          project_relation.relation_type = 'shared_across_projects'
          AND project_relation.target_type = 'studio'
          AND project_relation.target_id = ${studioParam()}
          AND review.schema_version = 2
          AND json_valid(review.context_json) = 1
          AND json_extract(review.context_json, '$.projectId') = ${projectParam()}
        )
      )
  )`;
  const directAttribution = `(
    (review.task_id IS NOT NULL OR review.round_id IS NOT NULL)
    AND (review.task_id IS NULL OR EXISTS (
      SELECT 1 FROM creative_tasks direct_task
      WHERE direct_task.id = review.task_id AND direct_task.project_id = ${projectParam()}
    ))
    AND (review.round_id IS NULL OR EXISTS (
      SELECT 1 FROM creative_rounds direct_round
      JOIN creative_tasks direct_round_task ON direct_round_task.id = direct_round.task_id
      WHERE direct_round.id = review.round_id AND direct_round_task.project_id = ${projectParam()}
    ))
    AND (review.task_id IS NULL OR review.round_id IS NULL OR EXISTS (
      SELECT 1 FROM creative_rounds consistent_round
      WHERE consistent_round.id = review.round_id AND consistent_round.task_id = review.task_id
    ))
  )`;
  return {
    sql: `asset.studio_id = ? AND ${contextScope} AND (
      (review.task_id IS NULL AND review.round_id IS NULL AND ${projectRelation})
      OR ${directAttribution}
    )`,
    values
  };
}

export function getQualityMetrics(db: StudioDatabase, studioId: string, input: QualityMetricsQuery = {}): QualityMetrics {
  const projectId = input.projectId?.trim() || undefined;
  if (projectId) requireProjectInStudio(db, studioId, projectId);
  const scope = projectScope(projectId);
  const runRows = db.prepare('SELECT run.status, COUNT(*) AS total ' + ENTITY_SCOPE_QUERIES.generation_run.from + ' WHERE project.studio_id = ?' + scope.sql + ' GROUP BY run.status').all(studioId, ...scope.values) as unknown as RunStatusRow[];
  const runStatusCounts = emptyRunStatusCounts();
  for (const row of runRows) if (RUN_STATUSES.includes(row.status as RunStatus)) runStatusCounts[row.status as RunStatus] = Number(row.total);

  const itemRows = db.prepare('SELECT item.status, item.error_json, item.updated_at ' + ENTITY_SCOPE_QUERIES.run_item.from + ' WHERE project.studio_id = ?' + scope.sql).all(studioId, ...scope.values) as unknown as RunItemMetricRow[];
  const itemStatusCounts = emptyRunItemStatusCounts();
  const patternCounts = new Map<string, FailurePatternMetric>();
  for (const row of itemRows) {
    if (RUN_ITEM_STATUSES.includes(row.status as RunItemStatus)) itemStatusCounts[row.status as RunItemStatus] += 1;
    const status = row.status as RunItemStatus;
    if (!FAILURE_ITEM_STATUSES.has(status) || !row.error_json) continue;
    const pattern = failurePattern(row);
    const existing = patternCounts.get(pattern.key);
    if (existing) {
      existing.count += 1;
      if (row.updated_at > existing.lastSeenAt) existing.lastSeenAt = row.updated_at;
    } else {
      patternCounts.set(pattern.key, { ...pattern, count: 1, lastSeenAt: row.updated_at });
    }
  }

  const review = reviewScope(studioId, projectId);
  const reviewRows = db.prepare('SELECT review.decision, COUNT(*) AS total FROM review_decisions review JOIN assets asset ON asset.id = review.asset_id WHERE ' + review.sql + ' GROUP BY review.decision').all(studioId, ...review.values) as unknown as ReviewDecisionRow[];
  const byDecision = { keep: 0, review: 0, reject: 0, derive: 0 } as QualityMetrics['reviews']['byDecision'];
  for (const row of reviewRows) if (Object.hasOwn(byDecision, row.decision)) byDecision[row.decision as keyof typeof byDecision] = Number(row.total);

  const totalItems = RUN_ITEM_STATUSES.reduce((total, status) => total + itemStatusCounts[status], 0);
  const terminal = [...TERMINAL_ITEM_STATUSES].reduce((total, status) => total + itemStatusCounts[status], 0);
  // A cancelled item is never a verdict on the run: the operator stopped it. Counting it in the denominator
  // made "cancel a batch" look like a quality regression, so the rate is taken over settled items only and the
  // denominator is exposed so a reader can see what it was computed from.
  const settled = terminal - itemStatusCounts.cancelled;
  const totalReviews = Object.values(byDecision).reduce((total, count) => total + count, 0);
  const successful = itemStatusCounts.succeeded;
  return {
    generatedAt: new Date().toISOString(),
    scope: { studioId, ...(projectId ? { projectId } : {}) },
    runs: { total: Object.values(runStatusCounts).reduce((total, count) => total + count, 0), byStatus: runStatusCounts },
    runItems: {
      total: totalItems,
      terminal,
      settled,
      successful,
      failed: itemStatusCounts.failed,
      blocked: itemStatusCounts.blocked,
      retryWait: itemStatusCounts.retry_wait,
      unknownOutcome: itemStatusCounts.outcome_unknown,
      cancelled: itemStatusCounts.cancelled,
      successRate: settled ? successful / settled : null,
      byStatus: itemStatusCounts
    },
    reviews: { total: totalReviews, byDecision, keepRate: totalReviews ? byDecision.keep / totalReviews : null },
    failurePatterns: [...patternCounts.values()].sort((left, right) => right.count - left.count || left.key.localeCompare(right.key)).slice(0, MAX_FAILURE_PATTERNS)
  };
}
