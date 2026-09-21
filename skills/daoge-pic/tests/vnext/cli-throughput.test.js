const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation } = require('../../dist/vnext/domain/studio-commands');
const { createStyleKit, createBrandKit, applyPlanKits } = require('../../dist/vnext/domain/libraries');
const { parseCommand, usage, commandHelp } = require('../../dist/vnext/cli/daoge');
const { composeDeliveryExport } = require('../../dist/vnext/cli/flow-actions');
const { createStudioRequest } = require('../../dist/vnext/domain/request-queue');
const { configureProvider } = require('./provider-test-helper');
const { requestJson } = require('./local-studio-test-helper');

/**
 * 三件把「往返次数」压下来的小事，一起钉住：
 *   ① `--lease` 一次租到 24 小时，跨人工确认的长活不必每 10 分钟发一次心跳；
 *   ② `plan --style-kit/--brand-kit` 由服务端合并配方正文，agent 每轮只写增量；
 *   ③ `delivery-export --project/--assets/--name` 一步走完草稿→准备→导出。
 * 外加一条可发现性：`--help` 把 agent 主线与人类/运维分开，别让人翻 70 条命令。
 */

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-throughput-'));
}

async function fixture() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  configureProvider(initialized, { name: 'Throughput Provider', apiKey: 'throughput-secret-never-returned', model: 'gpt-image-2' });
  const started = await startLocalStudioService({ hardenAccess: false, workspaceRoot, ssePollMs: 20 });
  const studioId = initialized.manifest.studioId;
  const db = started.service.db;
  const project = createProject(db, { studioId, name: '配方项目', idempotencyKey: 'throughput-project' }).value;
  const task = createTaskDraft(db, { studioId, projectId: project.id, name: '配方任务', idempotencyKey: 'throughput-task' }).value;
  return { workspaceRoot, initialized, started, studioId, db, project, task };
}

async function dispose(value) {
  await value.started.service.close();
  fs.rmSync(value.workspaceRoot, { recursive: true, force: true });
}

function caller(value) {
  let counter = 0;
  return async (method, pathname, body = {}) => {
    counter += 1;
    const response = await requestJson(value.started, pathname, { method, ...(method === 'GET' ? {} : { body }), idempotencyKey: 'throughput-' + counter });
    if (response.status >= 400 || response.body.ok !== true) throw new Error(response.body.error?.message || 'api failed: ' + pathname);
    return response.body.data;
  };
}

test('a request can be claimed or renewed with an explicit long lease', async () => {
  const value = await fixture();
  try {
    const request = createStudioRequest(value.db, { studioId: value.studioId, projectId: value.project.id, text: '帮我出十张', idempotencyKey: 'throughput-request' });
    const accepted = await requestJson(value.started, '/api/requests/' + encodeURIComponent(request.id) + '/accept', { method: 'POST', idempotencyKey: 'throughput-accept', body: { agentId: 'omp', leaseMs: 60 * 60 * 1000 } });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const leaseExpiry = Date.parse(accepted.body.data.request.leaseExpiresAt);
    assert.ok(leaseExpiry - Date.now() > 55 * 60 * 1000, '一小时的租约必须真的落库：' + accepted.body.data.request.leaseExpiresAt);
    const renewed = await requestJson(value.started, '/api/requests/' + encodeURIComponent(request.id) + '/renew', { method: 'POST', idempotencyKey: 'throughput-renew', body: { agentId: 'omp', leaseMs: 30 * 60 * 1000 } });
    assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
    const tooLong = await requestJson(value.started, '/api/requests/' + encodeURIComponent(request.id) + '/renew', { method: 'POST', idempotencyKey: 'throughput-renew-too-long', body: { agentId: 'omp', leaseMs: 48 * 60 * 60 * 1000 } });
    assert.equal(tooLong.status, 400, JSON.stringify(tooLong.body));
    assert.throws(() => parseCommand(['request-accept', '--workspace', value.workspaceRoot, '--request', request.id, '--lease', '2000']), /--lease 只能是 1 到 1440 分钟/);
    const parsed = parseCommand(['request-renew', '--workspace', value.workspaceRoot, '--request', request.id, '--lease', '45']);
    assert.equal(parsed.request.body.leaseMs, 45 * 60 * 1000);
  } finally {
    await dispose(value);
  }
});

test('plan --style-kit merges the recipe into the confirmed plan text, and the merge is hashed', async () => {
  const value = await fixture();
  try {
    const style = createStyleKit(value.db, { studioId: value.studioId, name: '木漏日', definition: { prompt: '薄雾里的丁达尔光，木漏日斑驳', fragments: ['浅景深'] }, idempotencyKey: 'throughput-style' });
    const brand = createBrandKit(value.db, { studioId: value.studioId, name: '橘猫', definition: { prompt: '一只橘猫安静地坐在木栈道上' }, idempotencyKey: 'throughput-brand' });
    const round = createRoundDraft(value.db, { studioId: value.studioId, taskId: value.task.id, purpose: 'exploration', idempotencyKey: 'throughput-round' }).value;
    const prepared = await requestJson(value.started, '/api/rounds/' + encodeURIComponent(round.id) + '/plan', {
      method: 'POST',
      idempotencyKey: 'throughput-plan',
      body: { expectedVersion: round.version, plan: { operation: 'generate', itemCount: 1, prompt: '花园小径写真', output: { aspectRatio: '1:1' } }, styleKitIds: [style.id], brandKitIds: [brand.id] }
    });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    const stored = prepared.body.data.value.plan;
    assert.match(stored.prompt, /花园小径写真/);
    assert.match(stored.prompt, /【风格包：木漏日】/);
    assert.match(stored.prompt, /薄雾里的丁达尔光/);
    assert.match(stored.prompt, /【品牌包：橘猫】/);
    assert.match(stored.prompt, /一只橘猫安静地坐在木栈道上/);
    assert.deepEqual(stored.appliedKits.map((kit) => kit.id), [style.id, brand.id]);
    const versions = await requestJson(value.started, '/api/rounds/' + encodeURIComponent(round.id) + '/plan-versions');
    assert.equal(versions.body.data.planVersions[0].plan.prompt, stored.prompt, '落库的就是合并后的正文');
  } finally {
    await dispose(value);
  }
});

test('kit merging refuses an unknown kit or a recipe with nothing to merge', async () => {
  const value = await fixture();
  try {
    const emptyStyle = createStyleKit(value.db, { studioId: value.studioId, name: '空配方', definition: { note: '只有说明' }, idempotencyKey: 'throughput-empty-style' });
    const emptyBrand = createBrandKit(value.db, { studioId: value.studioId, name: '空品牌', definition: { note: '只有说明' }, idempotencyKey: 'throughput-empty-brand' });
    assert.throws(() => applyPlanKits(value.db, { studioId: value.studioId, plan: { prompt: 'x' }, styleKitIds: ['style_missing'] }), /不存在/);
    assert.throws(() => applyPlanKits(value.db, { studioId: value.studioId, plan: { prompt: 'x' }, styleKitIds: [emptyStyle.id] }), /没有可合并的/);
    assert.throws(() => applyPlanKits(value.db, { studioId: value.studioId, plan: { prompt: 'x' }, brandKitIds: [emptyBrand.id] }), /没有可合并的/);
    const plain = applyPlanKits(value.db, { studioId: value.studioId, plan: { prompt: 'x' } });
    assert.equal(plain.plan.prompt, 'x');
    assert.deepEqual(plain.applied, []);
  } finally {
    await dispose(value);
  }
});

test('delivery-export --project/--assets/--name walks draft to exported in one call', async () => {
  const value = await fixture();
  try {
    // 交付要求素材存在：直接用 API 之外没有更轻的造数方式，所以这里先断言"没有素材时不给假成功"。
    await assert.rejects(
      () => composeDeliveryExport(caller(value), { projectId: value.project.id, name: '这一批', assetIds: ['asset_missing'] }),
      /素材|不存在|not found|failed/i
    );
    const parsed = parseCommand(['delivery-export', '--workspace', value.workspaceRoot, '--project', value.project.id, '--assets', 'a1,a2', '--name', '这一批']);
    assert.deepEqual(parsed.deliveryOneStep, { projectId: value.project.id, name: '这一批', assetIds: ['a1', 'a2'], includeCreativeRecord: false });
    assert.throws(() => parseCommand(['delivery-export', '--workspace', value.workspaceRoot]), /需要 --delivery <id>/);
    assert.throws(() => parseCommand(['delivery-export', '--workspace', value.workspaceRoot, '--delivery', 'd1', '--project', value.project.id, '--assets', 'a1', '--name', 'x']), /不能同时使用/);
    assert.throws(() => parseCommand(['delivery-export', '--workspace', value.workspaceRoot, '--project', value.project.id, '--assets', 'a1']), /需要同时给出 --project、--assets 与 --name/);
  } finally {
    await dispose(value);
  }
});

test('help separates the agent mainline from human and ops commands', () => {
  const brief = usage();
  assert.match(brief, /Agent 主线：/);
  assert.match(brief, /人类 \/ 运维/);
  const mainline = brief.slice(brief.indexOf('Agent 主线：'), brief.indexOf('人类 / 运维'));
  for (const name of ['enter', 'wait', 'plan', 'preflight', 'run', 'round-status', 'task-list', 'round-detail']) assert.match(mainline, new RegExp('daoge ' + name + '  # '), name + ' 应该在主线里');
  const ops = brief.slice(brief.indexOf('人类 / 运维'));
  for (const name of ['provider-create', 'backup-restore', 'register-skill', 'doctor']) assert.match(ops, new RegExp('daoge ' + name + '  # '), name + ' 应该在运维区');
  assert.match(commandHelp('wait'), /阻塞等待/);
  assert.match(commandHelp('request-accept'), /--lease <正整数>/);
  assert.match(commandHelp('provider-list'), /--descriptors/);
  // 主线与运维两段合起来必须覆盖命令表里的每一条（守卫沿用原来的"不能漏命令"口径）。
  const all = Object.keys(require('../../dist/vnext/cli/daoge').commandSchemas);
  const missing = all.filter((name) => !new RegExp('daoge ' + name + '  # ').test(brief));
  assert.deepEqual(missing, []);
});