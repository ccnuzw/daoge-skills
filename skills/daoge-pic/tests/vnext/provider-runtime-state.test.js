const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

// `scripts/run-tests.js` 会给整个套件设这个；单跑本文件时补上，
// 否则 provider 密钥会落到「系统后端」并因缺少 paths 抛错——那是环境问题，不是本守卫要测的事。
process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND || 'plaintext';

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { requestJson } = require('./local-studio-test-helper');
const { configureProvider } = require('./provider-test-helper');

/**
 * provider 运行时态的守卫（方案 7.11.4 · 开放项 #26 / #28 · 施工单 P1–P4）。
 *
 * 核心判据：**「支持」≠「当前模型能用」，也不该让人打开设置页才知道服务在慢下来。**
 * 四块：
 *   P1 配置即测（保存 / 切换后自动测一次）；
 *   P2 能力徽章读运行时态；
 *   P3 退避 / 限流能浮到状态卡（决策 D2：队列底栏）；
 *   P4 provider 全挂 / 磁盘满给人话 + 下一步。
 */

async function moduleOrFail(relative, label) {
  try {
    return await import('../../web/src/' + relative);
  } catch (error) {
    assert.fail(label + '尚未实现：web/src/' + relative + '（' + error.code + '）');
  }
}

test('P1 配置即测：profile 身份或密钥变了才需要重测', async () => {
  const { profileChangeNeedsTest } = await moduleOrFail('provider-connection-model.mjs', 'provider 连接模型');
  const base = { profileId: 'profile_1', configVersion: 1, providerId: 'openai-images', model: 'gpt-image-2' };
  assert.equal(profileChangeNeedsTest(base, { ...base }), false, '原样不动不需要重测');
  assert.equal(profileChangeNeedsTest(base, { ...base, profileId: 'profile_2' }), true, '切换 profile 要测');
  assert.equal(profileChangeNeedsTest(base, { ...base, model: 'gpt-image-3' }), true, '换模型要测');
  assert.equal(profileChangeNeedsTest(base, { ...base, secretChanged: true }), true, '换密钥要测');
});

test('P2 /api/providers 的运行时带上「当前模型能不能用」', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-provider-runtime-'));
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    configureProvider(initialized, { model: 'gpt-image-2' });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const providers = await requestJson(started, '/api/providers');
    const runtime = providers.body.data.runtime;
    assert.ok(runtime.desired, '配置了 provider，desired 应当存在');
    assert.equal(typeof runtime.desired.modelCapability, 'object', '运行时必须给出当前模型的可用能力（支持 ≠ 可用）');
    assert.notEqual(runtime.desired.modelCapability, null);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('P3 退避 / 限流能翻成一句人话，健康时不打扰', async () => {
  const { providerRuntimeHeadline, providerRuntimeNotice } = await moduleOrFail('provider-runtime-model.mjs', 'provider 运行时模型');
  assert.equal(providerRuntimeNotice({ providerConcurrency: { lastReason: 'healthy' } }), '', '健康时不说废话');
  assert.equal(providerRuntimeNotice(null), '');
  assert.match(providerRuntimeNotice({ providerConcurrency: { lastReason: 'rate_limited', active: 2, max: 8 } }), /放慢|限流/);
  assert.match(providerRuntimeNotice({ providerConcurrency: { lastReason: 'memory_pressure' } }), /内存|放慢/);
  // 常显短句：rail 状态卡那一行只有 ~197px（≈14–15 个汉字），23–24 字的整句会被省略号截掉后半句。
  assert.equal(providerRuntimeHeadline({ providerConcurrency: { lastReason: 'healthy' } }), '', '健康时同样不打扰');
  assert.equal(providerRuntimeHeadline(null), '');
  for (const reason of ['rate_limited', 'memory_pressure', 'memory']) {
    const headline = providerRuntimeHeadline({ providerConcurrency: { lastReason: reason } });
    assert.ok(headline.length > 0 && headline.length <= 14, reason + ' 的常显短句必须存在且 ≤14 字，实际：' + headline);
  }
});

test('P4 provider 全挂 / 磁盘满：说人话 + 下一步，不用术语', async () => {
  const mod = await import('../../web/src/failure-copy-model.mjs');
  if (typeof mod.providerOutageCopy !== 'function') assert.fail('provider 故障文案尚未实现：failure-copy-model.mjs 的 providerOutageCopy');
  const down = mod.providerOutageCopy({ kind: 'all_providers_down' });
  assert.match(down, /生成服务/);
  assert.match(down, /等|稍后|再试/, '要告诉下一步');
  assert.equal(/状态码|错误码|outcome_unknown|结果未知/.test(down), false, '不出现术语或黑话');
  const disk = mod.providerOutageCopy({ kind: 'disk_full' });
  assert.match(disk, /磁盘|空间/);
  assert.match(disk, /清理|腾|空间/, '要告诉下一步');
});

test('P4 整层故障只认事实：有成功/取消就不算全挂，磁盘签名单独归类', async () => {
  const { providerOutageKind } = await import('../../web/src/failure-copy-model.mjs');
  if (typeof providerOutageKind !== 'function') assert.fail('整层故障判定尚未实现：failure-copy-model.mjs 的 providerOutageKind');
  const failed = (summary, status = 'failed') => ({ status, errorSummary: summary });
  // 最近两次都是「服务连不上」→ 全挂
  assert.equal(providerOutageKind({ recentOutcomes: [failed('upstream 503 unavailable'), failed('fetch failed')] }), 'all_providers_down');
  // 只要有一次成功，服务就是活的
  assert.equal(providerOutageKind({ recentOutcomes: [failed('upstream 503 unavailable'), failed('fetch failed', 'completed')] }), null);
  // 取消是用户自己的决定，不算系统故障
  assert.equal(providerOutageKind({ recentOutcomes: [failed('fetch failed'), failed('fetch failed', 'cancelled')] }), null);
  // 磁盘满单独归类（要清空间，不是等一等）
  assert.equal(providerOutageKind({ recentOutcomes: [failed('ENOSPC: no space left on device'), failed('write failed: no space left on device')] }), 'disk_full');
  // 用户自己的问题（审核/参数）不该说成系统全挂
  assert.equal(providerOutageKind({ recentOutcomes: [failed('content policy violation'), failed('invalid size parameter')] }), null);
  // 次数不够就不下结论
  assert.equal(providerOutageKind({ recentOutcomes: [failed('fetch failed')] }), null);
  assert.equal(providerOutageKind({}), null);
});

test('P4 服务端只给事实：最近终态运行带首条错误摘要，且按 Studio 隔离', () => {
  const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
  const { createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation, confirmRoundPlan } = require('../../dist/vnext/domain/studio-commands');
  const { createDryRunPreview, queueGenerationRun, listGenerationRunItems } = require('../../dist/vnext/runner/run-commands');
  const { recentRunOutcomes } = require('../../dist/vnext/domain/provider-outage');
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-outage-'));
  const initialized = initializeStudio({ workspaceRoot });
  try {
    const { config, status } = configureProvider(initialized, { model: 'gpt-image-2', apiKey: 'memory-only-key' });
    const db = openStudioDatabase(initialized.paths, initialized.manifest);
    try {
      const studioId = initialized.manifest.studioId;
      const project = createProject(db, { studioId, name: '故障项目', idempotencyKey: 'outage-project' }).value;
      const task = createTaskDraft(db, { studioId, projectId: project.id, name: '任务', idempotencyKey: 'outage-task' }).value;
      const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'outage-round' }).value;
      const prepared = prepareRoundForConfirmation(db, { studioId, roundId: round.id, plan: { operation: 'generate', itemCount: 1, prompt: 'one image' }, expectedVersion: round.version, idempotencyKey: 'outage-prepare' }).value;
      const confirmed = confirmRoundPlan(db, { studioId, roundId: round.id, expectedVersion: prepared.version, idempotencyKey: 'outage-confirm' }).value;
      const dryRun = createDryRunPreview(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, idempotencyKey: 'outage-dry-run' }).value;
      const run = queueGenerationRun(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, preflightId: dryRun.preview.id, idempotencyKey: 'outage-run' }).value;
      const item = listGenerationRunItems(db, run.id)[0];
      const stamp = new Date().toISOString();
      db.prepare("UPDATE generation_runs SET status = 'failed', updated_at = ? WHERE id = ?").run(stamp, run.id);
      db.prepare("UPDATE run_items SET status = 'failed', error_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ summary: 'upstream 503 unavailable' }), stamp, item.id);
      const own = recentRunOutcomes(db, { studioId });
      assert.equal(own.length >= 1, true);
      assert.equal(own[0].runId, run.id);
      assert.equal(own[0].status, 'failed');
      assert.equal(own[0].errorSummary, 'upstream 503 unavailable', '只给事实：首条错误摘要原样带出');
      assert.deepEqual(recentRunOutcomes(db, { studioId: 'studio_other' }), [], '换了 Studio 什么都读不到');
    } finally {
      closeStudioDatabase(db);
    }
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('P4 首屏级提示真的渲染，且服务端把它接进了 /api/providers', () => {
  const { readSource, readFrontendSource } = require('./source-text');
  const frontend = readFrontendSource();
  assert.match(frontend, /providerOutageKind\(\{ recentOutcomes: provider\?\.recentOutcomes \}\)/, '判定要读服务端事实');
  assert.match(frontend, /className="provider-outage-strip"/, '整层故障要有首屏级提示条');
  assert.match(frontend, /providerOutageCopy\(\{ kind: providerOutage \}\)/, '提示条内容走单一来源文案');
  const server = readSource('src/vnext/api/server.ts');
  assert.match(server, /recentOutcomes: recentRunOutcomes\(this\.db, \{ studioId/, '/api/providers 要带出最近运行事实');
});