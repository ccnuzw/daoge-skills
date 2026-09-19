import { StudioDatabase } from '../studio/database';
import { joinInStudioSql } from './studio-scope';

/**
 * 生成服务整层故障的**事实**（方案 4.10 · 开放项 #26 / #28 · 施工单 P4）。
 *
 * 分工刻意做成「服务端给事实、前端做分类」：
 *   - 这里只回答「最近几次终态运行是什么结局、其中第一条错误摘要是什么」；
 *   - **怎么归类**（系统的问题 / 我的问题 / 磁盘满）留在前端的单一来源
 *     （`failure-copy-model.mjs`），避免同一套关键词在两个进程里各写一遍然后慢慢漂移。
 *
 * 判据用「最近的终态运行」而不是「全部历史」：服务挂了之后**最近的连续失败**才是要提示的事，
 * 昨天的旧失败不该让今天的界面一直挂着警告。
 */

export const PROVIDER_OUTAGE_RUN_STATUSES = ['completed', 'failed', 'partial', 'cancelled'] as const;

export interface RecentRunOutcome {
  runId: string;
  roundId: string;
  status: string;
  updatedAt: string;
  /** 该运行里第一条非空错误摘要（只截断，不解释）。 */
  errorSummary: string;
}

function errorSummaryOf(value: string): string {
  try {
    const parsed = JSON.parse(value) as { summary?: unknown; message?: unknown };
    const summary = typeof parsed?.summary === 'string' ? parsed.summary : typeof parsed?.message === 'string' ? parsed.message : '';
    return summary.slice(0, 300);
  } catch { return ''; }
}

/** 本 Studio 最近的若干次终态运行（带首条错误摘要）。走 studio-scope 拼链，不手写 JOIN。 */
export function recentRunOutcomes(db: StudioDatabase, input: { studioId: string; limit?: number }): RecentRunOutcome[] {
  const limit = Math.min(10, Math.max(1, Number.isInteger(input.limit) ? Number(input.limit) : 5));
  const runs = db.prepare(
    'SELECT run.id, run.round_id, run.status, run.updated_at ' + joinInStudioSql('generation_run', '')
    + ' WHERE project.studio_id = ? AND run.status IN (' + PROVIDER_OUTAGE_RUN_STATUSES.map(() => '?').join(',') + ')'
    + ' ORDER BY run.updated_at DESC, run.id DESC LIMIT ?'
  ).all(input.studioId, ...PROVIDER_OUTAGE_RUN_STATUSES, limit) as Array<{ id: string; round_id: string; status: string; updated_at: string }>;
  if (!runs.length) return [];
  const placeholders = runs.map(() => '?').join(',');
  const rows = db.prepare('SELECT run_id, error_json FROM run_items WHERE run_id IN (' + placeholders + ') AND error_json IS NOT NULL').all(...runs.map((run) => run.id)) as Array<{ run_id: string; error_json: string }>;
  const summaryByRun = new Map<string, string>();
  for (const row of rows) {
    if (summaryByRun.has(row.run_id)) continue;
    const summary = errorSummaryOf(row.error_json);
    if (summary) summaryByRun.set(row.run_id, summary);
  }
  return runs.map((run) => ({ runId: run.id, roundId: run.round_id, status: run.status, updatedAt: run.updated_at, errorSummary: summaryByRun.get(run.id) || '' }));
}