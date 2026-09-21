const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCommand, commandHelp, usage } = require('../../dist/vnext/cli/daoge');
const { waitForRoundRun } = require('../../dist/vnext/cli/wait-run');

/**
 * `daoge wait`：agent 提交运行后唯一需要的等待动词。
 *
 * 之前没有它，agent 只能一轮一轮地轮询 `round-status` —— 每次轮询都是一次完整的模型回合。
 * 这里钉死它的三条底线：终态判定只认可信来源（round detail 的 latestRun.status + tally）、
 * 超时绝不谎报终态、事件只是唤醒信号不是事实源。
 */

/** round detail 的形状：权威状态在 latestRun，逐状态张数在顶层 tally。 */
function roundState(status, tally) {
  return {
    round: { id: 'round_1', taskId: 'task_1', purpose: 'exploration', status: 'active', planVersion: 1, version: 2 },
    latestRun: { id: 'run_1', roundId: 'round_1', status, planVersion: 1, executionConcurrency: 4, updatedAt: '2026-09-21T00:00:00.000Z' },
    tally: { ...tally }
  };
}

function clock() {
  let current = 0;
  return { now: () => current, sleep: async (milliseconds) => { current += milliseconds; } };
}

/** 按脚本逐次返回 round detail；脚本用尽后一直回最后一项。 */
function scriptedApi(states, events = []) {
  let index = 0;
  return {
    calls: { rounds: 0, events: 0 },
    async readRound() {
      this.calls.rounds += 1;
      const next = states[Math.min(index, states.length - 1)];
      index += 1;
      return next;
    },
    async readEvents() {
      this.calls.events += 1;
      return events.shift() || { events: [], snapshotCursor: 1, snapshotRequired: false };
    }
  };
}

test('wait returns the terminal summary as soon as the run settles', async () => {
  const api = scriptedApi([roundState('completed', { succeeded: 4 })]);
  const result = await waitForRoundRun({ roundId: 'round_1', timeoutMs: 60000, intervalMs: 1000, until: 'terminal' }, api, clock());
  assert.equal(result.runId, 'run_1');
  assert.equal(result.status, 'completed');
  assert.equal(result.succeeded, 4);
  assert.equal(result.total, 4);
  assert.equal(result.timedOut, false);
  assert.equal(result.polls, 1);
  assert.equal(api.calls.events, 0, '已经终态就不必再读事件窗口');
});

test('wait keeps polling through non-terminal states instead of guessing', async () => {
  const api = scriptedApi([
    { latestRun: null, tally: null },
    roundState('queued', {}),
    roundState('running', { succeeded: 1, pending: 3 }),
    roundState('partial', { succeeded: 2, failed: 1, cancelled: 1 })
  ]);
  const result = await waitForRoundRun({ roundId: 'round_1', timeoutMs: 60000, intervalMs: 1000, until: 'terminal' }, api, clock());
  assert.equal(result.status, 'partial');
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.total, 4);
  assert.equal(result.timedOut, false);
  assert.equal(result.polls, 4);
});

test('wait stops at the first successful image when asked for first-success', async () => {
  const api = scriptedApi([roundState('running', { succeeded: 1, pending: 3 })]);
  const result = await waitForRoundRun({ roundId: 'round_1', timeoutMs: 60000, intervalMs: 1000, until: 'first-success' }, api, clock());
  assert.equal(result.status, 'running');
  assert.equal(result.succeeded, 1);
  assert.equal(result.timedOut, false);
});

test('wait reports the真实 status on timeout instead of inventing a terminal one', async () => {
  const api = scriptedApi([roundState('running', { succeeded: 1, pending: 9 })]);
  const result = await waitForRoundRun({ roundId: 'round_1', timeoutMs: 5000, intervalMs: 1000, until: 'terminal' }, api, clock());
  assert.equal(result.status, 'running');
  assert.equal(result.timedOut, true);
  assert.equal(result.succeeded, 1);
  assert.equal(result.total, 10);
  assert.ok(result.elapsedMs >= 5000, '超时判定必须走满时间窗，实际 ' + result.elapsedMs);
});

test('a relevant event wakes the wait up immediately instead of sleeping out the interval', async () => {
  const api = scriptedApi(
    [roundState('running', { pending: 2 }), roundState('completed', { succeeded: 2 })],
    [{ events: [{ id: 7, eventType: 'run_item.succeeded', entityId: 'run_1', payload: { runId: 'run_1', sequence: 1 } }], snapshotCursor: 7 }]
  );
  const result = await waitForRoundRun({ roundId: 'round_1', timeoutMs: 60000, intervalMs: 60000, until: 'terminal' }, api, clock());
  assert.equal(result.status, 'completed');
  assert.equal(result.wakeups, 1);
  assert.equal(result.timedOut, false);
  assert.equal(result.elapsedMs, 0, '事件唤醒后应立刻重读权威状态，而不是先睡满一个间隔');
});

test('unrelated events do not count as progress for this run', async () => {
  const api = scriptedApi(
    [roundState('running', { pending: 1 }), roundState('completed', { succeeded: 1 })],
    [{ events: [{ id: 9, eventType: 'run.completed', entityId: 'run_other', payload: { runId: 'run_other' } }], snapshotCursor: 9 }]
  );
  const result = await waitForRoundRun({ roundId: 'round_1', timeoutMs: 60000, intervalMs: 1000, until: 'terminal' }, api, clock());
  assert.equal(result.wakeups, 0);
  assert.equal(result.status, 'completed');
  assert.ok(result.elapsedMs >= 1000, '无关事件之后应当按正常间隔继续等，实际 ' + result.elapsedMs);
});

test('paused and resume_pending are not terminal: the wait keeps looking', async () => {
  const api = scriptedApi([
    roundState('paused', { succeeded: 1, pending: 1 }),
    roundState('resume_pending', { succeeded: 1, pending: 1 }),
    roundState('cancelled', { succeeded: 1, cancelled: 1 })
  ]);
  const result = await waitForRoundRun({ roundId: 'round_1', timeoutMs: 60000, intervalMs: 1000, until: 'terminal' }, api, clock());
  assert.equal(result.status, 'cancelled');
  assert.equal(result.polls, 3);
});

test('a round with no run at all reports no-run rather than a fake success', async () => {
  const api = scriptedApi([{ latestRun: null, tally: null }]);
  const result = await waitForRoundRun({ roundId: 'round_1', timeoutMs: 0, intervalMs: 1000, until: 'terminal' }, api, clock());
  assert.equal(result.runId, null);
  assert.equal(result.status, 'no-run');
  assert.equal(result.timedOut, true);
  assert.equal(result.tally, null);
});

test('wait parses with documented defaults and rejects unknown --until values', () => {
  const root = '/tmp/daoge-pic-wait';
  const parsed = parseCommand(['wait', '--workspace', root, '--round', 'round_1']);
  assert.deepEqual(parsed.wait, { roundId: 'round_1', timeoutMs: 300000, intervalMs: 2000, until: 'terminal' });
  const explicit = parseCommand(['wait', '--workspace', root, '--round', 'round_1', '--timeout', '0', '--interval', '5', '--until', 'first-success']);
  assert.deepEqual(explicit.wait, { roundId: 'round_1', timeoutMs: 0, intervalMs: 5000, until: 'first-success' });
  assert.throws(() => parseCommand(['wait', '--workspace', root, '--round', 'round_1', '--until', 'eventually']), /--until 只能是 terminal 或 first-success/);
  assert.throws(() => parseCommand(['wait', '--workspace', root, '--round', 'round_1', '--interval', '0']), /--interval 必须是正整数/);
  assert.throws(() => parseCommand(['wait', '--workspace', root]), /需要 --round/);
  assert.match(usage(), /daoge wait  # /);
  assert.match(commandHelp('wait'), /--timeout <非负整数>/);
  assert.match(commandHelp('wait'), /--until <文本>/);
});