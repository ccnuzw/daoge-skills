/**
 * `daoge wait`：把「等出图」从 N 个模型回合压成 1 次调用。
 *
 * 之前 agent 提交 `run` 之后只能自己轮询 `round-status`，而每次轮询都是一次完整的模型回合
 * （整段上下文重读）；实测一次 3 分钟的出图会变成十几次调用、几百 KB 回显。daemon 侧本来
 * 就有事件流（`/api/events`，Bearer 可读），缺的只是**一个会阻塞到终态的动词**。
 *
 * 做法：以事件窗口的 cursor 为「有没有动静」，以 round detail 的 `latestRun.status` + `tally`
 * 为**权威状态**（事件只是唤醒信号，不是事实源 —— 它可能丢批、也可能被裁掉）。两条腿：
 *   1. 每个 tick 读一次事件窗口（`?after=<cursor>`），有本运行的新事件才去读 round detail；
 *   2. 无论有没有事件，每个 `interval` 都读一次 round detail 兜底，避免"事件漏了就一直等"。
 *
 * 终态集合与 `domain/states.ts` 对齐：`completed` / `failed` / `cancelled` / `partial`。
 * `paused` / `resume_pending` 这些**不是**终态：它们还会被推进，所以继续等，由 `timeout` 收口。
 */

type JsonObject = Record<string, unknown>;

export type WaitUntil = 'terminal' | 'first-success';

export interface WaitInput {
  roundId: string;
  /** 最长等待毫秒数；到点返回 `timedOut: true` 与当时的真实状态，绝不谎报终态。 */
  timeoutMs: number;
  /** 两次权威读取之间的间隔毫秒数。 */
  intervalMs: number;
  until: WaitUntil;
}

export interface WaitApi {
  /** 权威状态：`GET /api/rounds/<id>`（latestRun + tally）。 */
  readRound(roundId: string): Promise<unknown>;
  /** 唤醒信号：`GET /api/events?after=<cursor>`。 */
  readEvents(after: number): Promise<unknown>;
}

export interface WaitOptions {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled', 'partial'];

/** 类型守卫：只有普通对象才算对象。 */
function asObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function statusCount(value: unknown, status: string): number {
  const counts = asObject(value) ? value : {};
  const total = counts[status];
  return Number.isInteger(total) ? Number(total) : 0;
}

/** 事件窗口里与本运行有关的条目：`run.*` 与 `run_item.*`，且 entityId 或 payload.runId 命中。 */
function touchesRun(value: unknown, runId: string): boolean {
  return Array.isArray(value) && value.some((item) => {
    const event = asObject(item) ? item : {};
    const type = typeof event.eventType === 'string' ? event.eventType : '';
    if (!type.startsWith('run.') && !type.startsWith('run_item.')) return false;
    const payload = asObject(event.payload) ? event.payload : {};
    return event.entityId === runId || payload.runId === runId;
  });
}

/**
 * 等到终态、等到首张成功，或等到超时。
 *
 * 返回的永远是**事实**：`status` 来自 daemon 的 `latestRun.status`，`succeeded`/`total` 来自
 * `tally`；超时也一样回真实状态并附 `timedOut: true`，让调用方自己决定是继续等、重试还是收工。
 */
export async function waitForRoundRun(input: WaitInput, api: WaitApi, options: WaitOptions = {}): Promise<JsonObject> {
  const now = options.now || Date.now;
  const sleep = options.sleep || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  const deadline = startedAt + input.timeoutMs;
  let cursor = 0;
  let polls = 0;
  let wakeups = 0;

  const summarize = (roundValue: unknown, timedOut: boolean): JsonObject => {
    const round = asObject(roundValue) ? roundValue : {};
    const latestRun = asObject(round.latestRun) ? round.latestRun : {};
    const tally = asObject(round.tally) ? round.tally : {};
    const succeeded = statusCount(tally, 'succeeded');
    const total = Object.values(tally).reduce<number>((sum, item) => sum + (Number.isInteger(item) ? Number(item) : 0), 0);
    return {
      runId: typeof latestRun.id === 'string' ? latestRun.id : null,
      status: typeof latestRun.status === 'string' ? latestRun.status : 'no-run',
      succeeded,
      failed: statusCount(tally, 'failed'),
      outcomeUnknown: statusCount(tally, 'outcome_unknown'),
      total,
      tally: Object.keys(tally).length ? tally : null,
      elapsedMs: now() - startedAt,
      polls,
      wakeups,
      timedOut,
      cursor
    };
  };

  for (;;) {
    polls += 1;
    const roundValue = await api.readRound(input.roundId);
    const summary = summarize(roundValue, false);
    const status = String(summary.status);
    if (TERMINAL_RUN_STATUSES.includes(status)) return summary;
    if (input.until === 'first-success' && Number(summary.succeeded) > 0) return summary;
    if (now() >= deadline) return summarize(roundValue, true);

    // 先看事件：窗口里有本运行的新事件，就立刻再读一次权威状态（而不是干等到下一个 tick）。
    const windowValue = await api.readEvents(cursor);
    const window = asObject(windowValue) ? windowValue : {};
    const nextCursor = Number.isInteger(window.snapshotCursor) ? Number(window.snapshotCursor) : cursor;
    if (touchesRun(window.events, String(summary.runId))) {
      wakeups += 1;
      cursor = nextCursor;
      continue;
    }
    cursor = nextCursor;
    const remaining = deadline - now();
    if (remaining <= 0) return summarize(roundValue, true);
    await sleep(Math.min(input.intervalMs, remaining));
  }
}

/** `--until` 的取值校验放在 CLI 侧，这里只做常量表，避免两处漂移。 */
export const WAIT_UNTIL_CHOICES: readonly WaitUntil[] = ['terminal', 'first-success'];

export { TERMINAL_RUN_STATUSES };