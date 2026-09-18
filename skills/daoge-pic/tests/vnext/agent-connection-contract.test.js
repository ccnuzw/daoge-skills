const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { SKILL_ROOT, readSource, readFrontendSource } = require('./source-text');

/**
 * agent 连接管理的连接层守卫（方案 4.6 / 7.11.3 / 施工单 0.3 的第 8、9 条）。
 *
 * 只到连接层，不碰能力层：
 *   - 侦查 / 显示 / 配置三块；
 *   - 「在场 ≠ 胜任」：agent 要申报 skill 清单与版本；
 *   - **Studio 的输入框必须足够自由**（绝不能做成「从下拉里选模板」）。
 *
 * 先写桩：现在前端零 agent 文件、后端只有登记没有探测，红是预期的。
 */

function requirePresenceModule() {
  try {
    return require('../../dist/vnext/domain/agent-presence');
  } catch (error) {
    assert.fail('agent 在场模块尚未实现：src/vnext/domain/agent-presence.ts（' + error.code + '）');
  }
}

function temporaryStudio() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-agents-'));
  const initialized = initializeStudio({ workspaceRoot: root });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  return { root, studioId: initialized.manifest.studioId, db };
}

test('登记要带身份申报：agent 启动时申报 skill 清单与版本', () => {
  const presence = requirePresenceModule();
  const studio = temporaryStudio();
  try {
    const now = new Date('2026-09-18T00:00:00.000Z').toISOString();
    presence.registerStudioAgent(studio.db, {
      studioId: studio.studioId,
      cliName: 'codex',
      cliVersion: '1.2.3',
      skills: [{ name: 'daoge-pic', version: '6.0.0' }],
      now
    });
    const agents = presence.listStudioAgents(studio.db, { studioId: studio.studioId, now });
    assert.equal(agents.length, 1);
    // 领域对象按项目惯例用 camelCase（与 getStudioRequest / getCanvasLayout 一致）。
    assert.equal(agents[0].cliName, 'codex');
    assert.equal(agents[0].skillName, 'daoge-pic', '状态卡要能显示「daoge-pic · 已装载」');
    assert.equal(agents[0].skillVersion, '6.0.0');
  } finally {
    closeStudioDatabase(studio.db);
    fs.rmSync(studio.root, { recursive: true, force: true });
  }
});

test('一个 CLI 只占一行：先不带技能登记、再带技能登记，不会留下幽灵行', () => {
  const presence = requirePresenceModule();
  const studio = temporaryStudio();
  try {
    const now = new Date('2026-09-18T00:00:00.000Z').toISOString();
    // 第一次：只报「我在」，没有技能申报。
    presence.registerStudioAgent(studio.db, { studioId: studio.studioId, cliName: 'opencode', now });
    // 第二次：同一个 CLI，这次申报了 daoge-pic。
    presence.registerStudioAgent(studio.db, { studioId: studio.studioId, cliName: 'opencode', skills: [{ name: 'daoge-pic', version: '6.0.0' }], now });
    const agents = presence.listStudioAgents(studio.db, { studioId: studio.studioId });
    assert.equal(agents.length, 1, '同一个 CLI 只能占一行（唯一键是 studio+cli，不带 skill）');
    assert.equal(agents[0].skillName, 'daoge-pic', '带技能的登记要覆盖到同一行上');
    assert.equal(presence.agentPresence(studio.db, { studioId: studio.studioId, now }).equipped, true);

    // 心跳不带技能时，不能把先前的申报抹掉（否则状态卡会来回跳）。
    presence.registerStudioAgent(studio.db, { studioId: studio.studioId, cliName: 'opencode', now });
    const afterHeartbeat = presence.listStudioAgents(studio.db, { studioId: studio.studioId });
    assert.equal(afterHeartbeat.length, 1, '心跳仍是同一行');
    assert.equal(afterHeartbeat[0].skillName, 'daoge-pic', '心跳不该撤回技能申报');
    assert.equal(presence.agentPresence(studio.db, { studioId: studio.studioId, now }).equipped, true);
  } finally {
    closeStudioDatabase(studio.db);
    fs.rmSync(studio.root, { recursive: true, force: true });
  }
});

test('在场 = 最后活动时间在阈值内（过期即离线，不是「有记录就算在场」）', () => {
  const presence = requirePresenceModule();
  const studio = temporaryStudio();
  try {
    const base = Date.parse('2026-09-18T00:00:00.000Z');
    presence.registerStudioAgent(studio.db, { studioId: studio.studioId, cliName: 'claude', cliVersion: '0.9.0', skills: [], now: new Date(base).toISOString() });
    const fresh = presence.agentPresence(studio.db, { studioId: studio.studioId, now: new Date(base + 30000).toISOString(), offlineAfterMs: 120000 });
    assert.equal(fresh.present, true);
    const stale = presence.agentPresence(studio.db, { studioId: studio.studioId, now: new Date(base + 300000).toISOString(), offlineAfterMs: 120000 });
    assert.equal(stale.present, false, '超过阈值就不算在场，界面要提示唤起 agent');
  } finally {
    closeStudioDatabase(studio.db);
    fs.rmSync(studio.root, { recursive: true, force: true });
  }
});

test('后端暴露 agent 在场端点，前端有系统面板状态卡（不是一级入口）', () => {
  assert.match(readSource('src/vnext/api/server.ts'), /'\/api\/agents'/, '必须有 GET /api/agents 供状态卡读取');
  const frontend = readFrontendSource();
  assert.match(frontend, /agent-presence-model\.mjs/, '前端必须有 agent 在场模型（纯逻辑、可单测）');
  assert.match(frontend, /\/api\/agents/, '检测结果必须真的显示出来，而不是查完丢掉');
  assert.ok(fs.existsSync(path.join(SKILL_ROOT, 'web/src/agent-presence-model.mjs')), 'web/src/agent-presence-model.mjs 必须存在');
});

test('「在场 ≠ 胜任」：没申报 daoge-pic 时输入框旁要有提示', () => {
  const frontend = readFrontendSource();
  assert.match(frontend, /未申报|未装载|不在场|没有.*daoge-pic|daoge-pic.*未/i, '未申报时要明确提示，而不是让请求石沉大海');
});

test('输入框足够自由：是自由文本请求入口，不是「从下拉里选模板」', () => {
  const frontend = readFrontendSource();
  assert.match(frontend, /request-queue-model\.mjs/, '请求入口必须有队列模型');
  assert.match(frontend, /\/api\/requests/, '说出的那句话要真的进入队列');
  const main = readSource('web/src/main.jsx');
  assert.doesNotMatch(main, /请求模板|从模板选择请求|request-template-select/, '绝不能把输入框做成模板下拉（方案 4.6 硬要求）');
});

test('在场阈值放宽到 15 分钟：空闲 5 分钟仍算在场（另有一套 2 分钟的单等太久催促）', () => {
  const presence = requirePresenceModule();
  const studio = temporaryStudio();
  try {
    const base = Date.parse('2026-09-18T00:00:00.000Z');
    presence.registerStudioAgent(studio.db, { studioId: studio.studioId, cliName: 'opencode', skills: [{ name: 'daoge-pic', version: '6.0.0' }], now: new Date(base).toISOString() });
    const idleFiveMinutes = presence.agentPresence(studio.db, { studioId: studio.studioId, now: new Date(base + 5 * 60 * 1000).toISOString() });
    assert.equal(idleFiveMinutes.present, true, '空闲 5 分钟仍应在场（两个问题不该共用一条时间线）');
    assert.equal(idleFiveMinutes.equipped, true);
    const idleSixteenMinutes = presence.agentPresence(studio.db, { studioId: studio.studioId, now: new Date(base + 16 * 60 * 1000).toISOString() });
    assert.equal(idleSixteenMinutes.present, false, '超过 15 分钟才算离开');
  } finally {
    closeStudioDatabase(studio.db);
    fs.rmSync(studio.root, { recursive: true, force: true });
  }
});

test('不在场时也要说出最后活动时间，而不是只丢一句「不在场」', async () => {
  const { agentPresencePresentation } = await import('../../web/src/agent-presence-model.mjs');
  const base = Date.parse('2026-09-18T00:00:00.000Z');
  // 曾经在线、现在过期：要说「最近一次活动在 N 分钟前」。
  const stale = agentPresencePresentation({ present: false, lastSeenAt: new Date(base - 20 * 60 * 1000).toISOString(), agents: [], skills: [] }, { now: base });
  assert.match(stale.detail, /最近一次活动在 20 分钟前/);
  // 文案别叠字（踩过「38 分钟前前」）。
  assert.doesNotMatch(stale.detail, /前前/, '不许出现「…分钟前前」这种叠字');
  // 从没在线过：不能编一个时间。
  const never = agentPresencePresentation({ present: false, lastSeenAt: null, agents: [], skills: [] }, { now: base });
  assert.doesNotMatch(never.detail, /分钟/, '从没登记过时不该编时间');
});

test('离线也要报最后活动时间——后端不许把它过滤掉（前端再算也算不出来）', async () => {
  const presence = requirePresenceModule();
  const studio = temporaryStudio();
  try {
    const base = Date.parse('2026-09-18T00:00:00.000Z');
    presence.registerStudioAgent(studio.db, { studioId: studio.studioId, cliName: 'opencode', skills: [{ name: 'daoge-pic', version: '6.0.0' }], now: new Date(base).toISOString() });
    const offline = presence.agentPresence(studio.db, { studioId: studio.studioId, now: new Date(base + 40 * 60 * 1000).toISOString() });
    assert.equal(offline.present, false, '40 分钟没动静 = 不在场');
    assert.equal(offline.agents.length, 0, '在场列表里不该有它');
    assert.equal(offline.lastSeenAt, new Date(base).toISOString(), '但「最后活动时间」必须还在——界面靠它说「N 分钟前还在」');
  } finally {
    closeStudioDatabase(studio.db);
    fs.rmSync(studio.root, { recursive: true, force: true });
  }
});

test('持有/续租请求租约 = 明确在场：续报不该把在场卡留在过去', () => {
  const presence = requirePresenceModule();
  const studio = temporaryStudio();
  try {
    const base = Date.parse('2026-09-18T00:00:00.000Z');
    presence.registerStudioAgent(studio.db, { studioId: studio.studioId, cliName: 'opencode', skills: [{ name: 'daoge-pic', version: '6.0.0' }], now: new Date(base).toISOString() });
    // 沉默 40 分钟 → 按阈值已不在场。
    const stale = presence.agentPresence(studio.db, { studioId: studio.studioId, now: new Date(base + 40 * 60 * 1000).toISOString() });
    assert.equal(stale.present, false);
    // 续报一次（等价于它在续租请求租约）→ 立刻回到在场。
    presence.touchStudioAgent(studio.db, { studioId: studio.studioId, cliName: 'opencode' });
    const fresh = presence.agentPresence(studio.db, { studioId: studio.studioId });
    assert.equal(fresh.present, true, '刚说过话就该是在场');
    assert.equal(fresh.equipped, true, '续报不许抹掉技能申报');
  } finally {
    closeStudioDatabase(studio.db);
    fs.rmSync(studio.root, { recursive: true, force: true });
  }
});

test('续报只更新时间，不凭空建档（在场必须先登记）', () => {
  const presence = requirePresenceModule();
  const studio = temporaryStudio();
  try {
    presence.touchStudioAgent(studio.db, { studioId: studio.studioId, cliName: 'never-registered' });
    assert.equal(presence.listStudioAgents(studio.db, { studioId: studio.studioId }).length, 0, '没登记过的不该被续报凭空创建');
  } finally {
    closeStudioDatabase(studio.db);
    fs.rmSync(studio.root, { recursive: true, force: true });
  }
});

test('HTTP：agent 登记后面在场卡能看到「已装载」，过期后变「不在场」', async () => {
  const { startLocalStudioService } = require('../../dist/vnext/api/server');
  const { requestJson } = require('./local-studio-test-helper');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-agent-api-'));
  let started;
  try {
    initializeStudio({ workspaceRoot: root });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot: root });
    const before = await requestJson(started, '/api/agents');
    assert.equal(before.body.data.present, false, '没人登记时必须在场为假');
    assert.equal(before.body.data.equipped, false);

    const registered = await requestJson(started, '/api/agents/register', { method: 'POST', idempotencyKey: 'agent-register-1', body: { cliName: 'codex', cliVersion: '1.0.0', skills: [{ name: 'daoge-pic', version: '6.0.0' }] } });
    assert.equal(registered.status, 200, JSON.stringify(registered.body));
    assert.equal(registered.body.data.presence.present, true);
    assert.equal(registered.body.data.presence.equipped, true, '申报了 daoge-pic 才算胜任');

    // 重复登记是心跳，不新增行。
    await requestJson(started, '/api/agents/register', { method: 'POST', idempotencyKey: 'agent-register-2', body: { cliName: 'codex', cliVersion: '1.0.0', skills: [{ name: 'daoge-pic', version: '6.0.0' }] } });
    const after = await requestJson(started, '/api/agents');
    assert.equal(after.body.data.agents.length, 1, '同一个 (Studio, CLI, skill) 只占一行');

    // 过期即离线：有记录不等于在场。
    started.service.db.prepare('UPDATE studio_agents SET last_seen_at = ?').run('2020-01-01T00:00:00.000Z');
    const stale = await requestJson(started, '/api/agents');
    assert.equal(stale.body.data.present, false, '超过阈值就不算在场');
  } finally {
    if (started) await started.service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
