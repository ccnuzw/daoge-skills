const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');

/**
 * 请求队列的行为守卫（方案 7.1 / 4.2 / 8.9 / 8.10），施工单 0.3 的第 1–4 条。
 *
 * 队列是「说一句被接单」的地基，也是圈选发起 / 重试走队列 / 全局对话的共同前置，
 * 所以状态机、租约、过期自愈、条目自带流程要求这四件事必须一次做对。
 * 这一组测试是**先写的桩**：模块还不存在，红是预期的。
 */

function requireQueueModule() {
  try {
    return require('../../dist/vnext/domain/request-queue');
  } catch (error) {
    assert.fail('请求队列模块尚未实现：src/vnext/domain/request-queue.ts（' + error.code + '）');
  }
}

function temporaryStudio() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-queue-'));
  const initialized = initializeStudio({ workspaceRoot: root });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  return { root, studioId: initialized.manifest.studioId, db };
}

function dispose(studio) {
  closeStudioDatabase(studio.db);
  fs.rmSync(studio.root, { recursive: true, force: true });
}

test('状态机：只允许 pending→accepted→done|rejected|failed 的迁移，其余一律拒绝', () => {
  const queue = requireQueueModule();
  assert.deepEqual([...queue.REQUEST_STATUSES].sort(), ['accepted', 'done', 'failed', 'pending', 'rejected'].sort());
  assert.equal(queue.canTransitionRequest('pending', 'accepted'), true);
  assert.equal(queue.canTransitionRequest('accepted', 'done'), true);
  assert.equal(queue.canTransitionRequest('accepted', 'rejected'), true);
  assert.equal(queue.canTransitionRequest('accepted', 'failed'), true);
  assert.equal(queue.canTransitionRequest('pending', 'done'), false, '没被接单不可能直接完成');
  assert.equal(queue.canTransitionRequest('done', 'pending'), false, '终态不可回流');
  assert.equal(queue.canTransitionRequest('rejected', 'accepted'), false);
  assert.equal(queue.canTransitionRequest('accepted', 'pending'), false, '回队只能走租约过期，不是自由迁移');
});

test('租约：两个 agent 抢同一单，只有一个领到', () => {
  const queue = requireQueueModule();
  const studio = temporaryStudio();
  try {
    const created = queue.createStudioRequest(studio.db, { studioId: studio.studioId, text: '把夜景调亮', context: { projectId: null, taskId: null, assetIds: [] } });
    assert.equal(created.status, 'pending');
    const now = new Date('2026-09-18T00:00:00.000Z').toISOString();
    const first = queue.claimStudioRequest(studio.db, { studioId: studio.studioId, requestId: created.id, agentId: 'agent-a', leaseMs: 60000, now });
    const second = queue.claimStudioRequest(studio.db, { studioId: studio.studioId, requestId: created.id, agentId: 'agent-b', leaseMs: 60000, now });
    assert.equal(first.claimed, true);
    assert.equal(second.claimed, false, '同一单不能被两个 agent 同时领走');
    assert.equal(first.request.status, 'accepted');
    assert.equal(first.request.lease_token, second.request.lease_token, '第二次失败时看到的仍是原租约，没有覆盖');
  } finally {
    dispose(studio);
  }
});

test('租约过期自愈：accepted 超期回 pending；连续 3 次超时标记 failed', () => {
  const queue = requireQueueModule();
  const studio = temporaryStudio();
  try {
    const created = queue.createStudioRequest(studio.db, { studioId: studio.studioId, text: '再来 4 张', context: { projectId: null, taskId: null, assetIds: [] } });
    const base = Date.parse('2026-09-18T00:00:00.000Z');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const at = new Date(base + attempt * 120000).toISOString();
      const claimed = queue.claimStudioRequest(studio.db, { studioId: studio.studioId, requestId: created.id, agentId: 'agent-a', leaseMs: 60000, now: at });
      assert.equal(claimed.claimed, true, '第 ' + attempt + ' 次领取应当成功');
      const expired = queue.expireStudioRequestLeases(studio.db, new Date(base + attempt * 120000 + 61000).toISOString());
      assert.equal(expired.requeued + expired.failed, 1);
      const row = queue.listStudioRequests(studio.db, { studioId: studio.studioId })[0];
      if (attempt < 3) {
        assert.equal(row.status, 'pending', '超期后回到等待，界面显示「等待接单」');
        assert.equal(row.attempts, attempt);
      } else {
        assert.equal(row.status, 'failed', '连续 3 次超时后标记失败并提示');
      }
    }
  } finally {
    dispose(studio);
  }
});

test('卡在人工确认上的请求：松开租约但保留 accepted，不算 agent 失职', () => {
  const queue = requireQueueModule();
  const studio = temporaryStudio();
  try {
    const { createProject, createTaskDraft, createRoundDraft } = require('../../dist/vnext/domain/studio-commands');
    const studioId = studio.studioId;
    const project = createProject(studio.db, { studioId, name: '确认项目', idempotencyKey: 'q-project' }).value;
    const task = createTaskDraft(studio.db, { studioId, projectId: project.id, name: '确认任务', idempotencyKey: 'q-task' }).value;
    const round = createRoundDraft(studio.db, { studioId, taskId: task.id, purpose: 'variation', idempotencyKey: 'q-round' }).value;

    const created = queue.createStudioRequest(studio.db, { studioId, text: '做三张变种' });
    const base = Date.parse('2026-09-18T00:00:00.000Z');
    const claimed = queue.claimStudioRequest(studio.db, { studioId, requestId: created.id, agentId: 'agent-a', leaseMs: 60000, now: new Date(base).toISOString() });
    assert.equal(claimed.claimed, true);

    // agent 写了计划，把 requestId 记进计划里；批次停在「等人确认」。
    studio.db.prepare('UPDATE creative_rounds SET plan_json = ?, status = ? WHERE id = ?')
      .run(JSON.stringify({ operation: 'generate', itemCount: 3, requestId: created.id }), 'awaiting_confirmation', round.id);

    // 租约到期（人在犹豫，agent 早就不在跑了）。
    const expired = queue.expireStudioRequestLeases(studio.db, new Date(base + 61000).toISOString());
    assert.equal(expired.waitingOnHuman, 1, '这种超期应当被认作「在等人」');
    assert.equal(expired.requeued, 0, '不该回队——球在用户脚下');
    const after = queue.getStudioRequest(studio.db, { studioId, requestId: created.id });
    assert.equal(after.status, 'accepted', '保留 accepted：等用户确认即可继续');
    assert.equal(after.leaseExpiresAt, null, '松开租约，避免被判「被某个死掉的 agent 占着」');
    // 而且不能被第二个 agent 抢走（球不在它那里）。
    const stolen = queue.claimStudioRequest(studio.db, { studioId, requestId: created.id, agentId: 'agent-b', now: new Date(base + 62000).toISOString() });
    assert.equal(stolen.claimed, false, '等人确认时不该被另一个 agent 抢走');
  } finally {
    dispose(studio);
  }
});

test('没卡在人工确认的请求，超期照旧回队（保护机制不削弱）', () => {
  const queue = requireQueueModule();
  const studio = temporaryStudio();
  try {
    const created = queue.createStudioRequest(studio.db, { studioId: studio.studioId, text: '没人管的单' });
    const base = Date.parse('2026-09-18T00:00:00.000Z');
    queue.claimStudioRequest(studio.db, { studioId: studio.studioId, requestId: created.id, agentId: 'agent-a', leaseMs: 60000, now: new Date(base).toISOString() });
    const expired = queue.expireStudioRequestLeases(studio.db, new Date(base + 61000).toISOString());
    assert.equal(expired.requeued, 1, '没有人工确认挡着的超期，仍然回队');
    assert.equal(expired.waitingOnHuman, 0);
  } finally {
    dispose(studio);
  }
});

test('续租（心跳）：长活能一直持有租约；别人的单续不了', () => {
  const queue = requireQueueModule();
  const studio = temporaryStudio();
  try {
    const created = queue.createStudioRequest(studio.db, { studioId: studio.studioId, text: '长活' });
    const base = Date.parse('2026-09-18T00:00:00.000Z');
    queue.claimStudioRequest(studio.db, { studioId: studio.studioId, requestId: created.id, agentId: 'agent-a', leaseMs: 60000, now: new Date(base).toISOString() });
    const renewed = queue.renewStudioRequestLease(studio.db, { studioId: studio.studioId, requestId: created.id, agentId: 'agent-a', leaseMs: 60000, now: new Date(base + 50000).toISOString() });
    assert.equal(renewed.leaseExpiresAt, new Date(base + 110000).toISOString(), '租约被推后');
    // 推后之后，原本会到期的那一刻不再回队。
    const expired = queue.expireStudioRequestLeases(studio.db, new Date(base + 61000).toISOString());
    assert.equal(expired.requeued + expired.failed + expired.waitingOnHuman, 0, '续过租就不该被回收');
    assert.throws(() => queue.renewStudioRequestLease(studio.db, { studioId: studio.studioId, requestId: created.id, agentId: 'agent-b' }), /另一个 agent/, '别人的单不能续租');
  } finally {
    dispose(studio);
  }
});

test('条目自带流程要求：context 是机器可读的规格，不是一句裸话', () => {
  const queue = requireQueueModule();
  const studio = temporaryStudio();
  try {
    const context = queue.buildRequestContext({ projectId: 'prj_1', taskId: 'tsk_1', assetIds: ['ast_1', 'ast_2'], flow: 'daoge-pic-plan' });
    assert.equal(context.projectId, 'prj_1');
    assert.deepEqual(context.assetIds, ['ast_1', 'ast_2']);
    assert.ok(context.flow && typeof context.flow === 'object', 'context 必须带机器可读的流程要求');
    assert.equal(context.flow.skill, 'daoge-pic');
    assert.equal(context.flow.required, true);
    const created = queue.createStudioRequest(studio.db, { studioId: studio.studioId, text: '按这两张再来', context: { flow: 'daoge-pic-plan', assetIds: ['ast_1', 'ast_2'] } });
    const row = queue.listStudioRequests(studio.db, { studioId: studio.studioId }).find((item) => item.id === created.id);
    const stored = JSON.parse(row.contextJson);
    assert.equal(stored.flow.skill, 'daoge-pic', '流程要求必须随条目落库，agent 从队列里读到的就是它');
  } finally {
    dispose(studio);
  }
});

test('花动作走队列：意图 / 运行 / 运行项随条目落库，agent 据此精确执行', () => {
  const queue = requireQueueModule();
  const studio = temporaryStudio();
  try {
    const built = queue.buildRequestContext({ projectId: 'prj_1', roundId: 'rnd_1', intent: 'retry', runId: 'run_1', itemIds: ['itm_1', 'itm_1', 'itm_2'] });
    assert.equal(built.intent, 'retry');
    assert.equal(built.runId, 'run_1');
    assert.deepEqual(built.itemIds, ['itm_1', 'itm_2'], '去重后落库，别把同一项重试两次');

    const created = queue.createStudioRequest(studio.db, { studioId: studio.studioId, text: '重试这批里没成的项（共 2 项）', context: { flow: 'daoge-pic-plan', roundId: 'rnd_1', intent: 'retry', runId: 'run_1', itemIds: ['itm_1', 'itm_2'] } });
    const stored = JSON.parse(queue.getStudioRequest(studio.db, { studioId: studio.studioId, requestId: created.id }).contextJson);
    assert.equal(stored.intent, 'retry');
    assert.equal(stored.runId, 'run_1');
    assert.deepEqual(stored.itemIds, ['itm_1', 'itm_2']);

    // 普通请求不带意图（不许给每条请求都编一个 intent）。
    const plain = JSON.parse(queue.createStudioRequest(studio.db, { studioId: studio.studioId, text: '换一版' }).contextJson);
    assert.equal(plain.intent, null);
    assert.equal(plain.runId, null);
    assert.deepEqual(plain.itemIds, []);
  } finally {
    dispose(studio);
  }
});
