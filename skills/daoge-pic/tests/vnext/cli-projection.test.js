const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCommand,
  commandHelp,
  commandSchemas,
  usage,
  usageFull
} = require('../../dist/vnext/cli/daoge');
const {
  COMMAND_PROJECTIONS,
  projectPlanWrite,
  projectPreflight,
  projectRunReceipt,
  projectRoundStatus,
  projectProviderList,
  projectProjectList,
  projectTaskList,
  projectRoundList,
  projectRoundDetail,
  projectRunItems
} = require('../../dist/vnext/cli/response-projection');

/**
 * 响应投影是 agent 频道的默认形状。
 *
 * 之前 plan / preflight / round-status / run 会把整份计划（prompt + itemPrompts）原样回流：
 * 实测一份 4 张的中位计划，一轮「写计划 → 预检 → 读状态」回流约 67 KB，较大样本单次
 * round-status 就有 109 KB。下面这些断言钉死两件事：正文不回流，令牌类字段不回流；
 * 并且投影**不许长回去**（字节上限是按真实样本的 1/20 留的余量）。
 */

/** 一份贴近真实的计划：prompt 6 KB 起、逐图 2 KB 起，与 daoge-pic-plans 的历史计划卡同量级。 */
function realisticPlan() {
  const prompt = '【版式】画面分左右两部分：' + '左侧自上而下是文字块与两个全身服装视图；'.repeat(120);
  const itemPrompts = Array.from({ length: 4 }, (_, index) => '第 ' + (index + 1) + ' 张：' + '同一场拍摄里换机位拍的三张，人物比例与光影必须完全统一。'.repeat(40));
  return { operation: 'generate', itemCount: 4, prompt, itemPrompts, output: { aspectRatio: '9:16', resolution: '2K' }, riskNotes: '别把道具画进画面。' };
}

const PLAN = realisticPlan();

function planReceipt() {
  return {
    value: { id: 'round_1', taskId: 'task_1', parentRoundId: null, purpose: 'exploration', plan: PLAN, planVersion: 2, status: 'awaiting_confirmation', version: 3 },
    replayed: false
  };
}

function challengeBody() {
  return { challenge: 'ch_claim_token_value', roundId: 'round_1', sessionId: 'session_1', conversationId: 'conv_1', planHash: 'hash_value', expectedVersion: 3, expiresAt: '2026-09-21T01:00:00.000Z' };
}

function preflightReceipt() {
  return {
    value: {
      preview: { id: 'dry_1', roundId: 'round_1', planVersion: 2, providerSnapshot: { providerId: 'openai-images', model: 'gpt-image-2.5' }, planSnapshot: PLAN, itemCount: 4, executionConcurrency: 4, concurrencySource: 'default', usageEstimate: {}, createdAt: '2026-09-21T00:00:00.000Z' },
      preflight: { valid: true, issues: [], normalizedPlan: PLAN },
      confirmToken: 'dgpct1.token.value'
    },
    replayed: false
  };
}

function runRow() {
  return {
    id: 'run_1', roundId: 'round_1', status: 'completed',
    providerSnapshot: { providerId: 'openai-images', model: 'gpt-image-2.5', profileName: '超分2.5' },
    planSnapshot: { operation: 'generate', itemCount: 4, prompt: PLAN.prompt, output: PLAN.output, referenceCount: 0, referenceLabels: [] },
    requestSummary: { operation: 'generate', promptSummary: PLAN.prompt, outputSpec: PLAN.output, referenceCount: 0, referenceLabels: [] },
    executionConcurrency: 4, concurrencySource: 'default', version: 9, planVersion: 2, createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:05:00.000Z'
  };
}

function roundStatusBody() {
  return {
    planStatus: {
      session: { id: 'session_1', conversationId: 'conv_1' },
      context: { project: { id: 'project_1', name: '美女写真' }, task: { id: 'task_1', name: '花园小径' }, round: { id: 'round_1', purpose: 'exploration', planVersion: 2, status: 'active', plan: PLAN } },
      confirmation: { confirmed: true, confirmedAt: '2026-09-21T00:10:00.000Z', expiresAt: '2026-09-21T00:40:00.000Z' },
      pendingConfirmation: null,
      latestRun: runRow()
    },
    runs: [runRow()],
    tally: { succeeded: 4 }
  };
}

test('plan write projection drops the plan body and the confirmation claim token', () => {
  const raw = JSON.stringify(planReceipt()).length;
  const projected = projectPlanWrite(planReceipt(), challengeBody());
  const size = Buffer.byteLength(JSON.stringify(projected), 'utf8');
  assert.equal(projected.roundId, 'round_1');
  assert.equal(projected.planVersion, 2);
  assert.equal(projected.status, 'awaiting_confirmation');
  assert.deepEqual(projected.challenge, { roundId: 'round_1', expectedVersion: 3, expiresAt: '2026-09-21T01:00:00.000Z' });
  const text = JSON.stringify(projected);
  assert.equal(text.includes(PLAN.prompt.slice(0, 40)), false, '计划正文不得回流');
  assert.equal(text.includes('ch_claim_token_value'), false, '确认挑战值不得回流');
  assert.equal(text.includes('hash_value'), false, 'planHash 不得回流');
  assert.equal(text.includes('conv_1'), false, 'conversationId 不得回流');
  assert.ok(size * 20 < raw, '投影必须比原始回执小一个数量级以上：' + size + ' vs ' + raw);
  assert.ok(size < 1024, '投影上限 1 KiB，实际 ' + size);
});

test('preflight projection keeps the confirm token, issues and counts, and drops the plan snapshot', () => {
  const projected = projectPreflight(preflightReceipt());
  assert.deepEqual(projected, {
    preflightId: 'dry_1', roundId: 'round_1', planVersion: 2, itemCount: 4, executionConcurrency: 4, concurrencySource: 'default',
    confirmed: true, confirmToken: 'dgpct1.token.value', issues: []
  });
  const text = JSON.stringify(projected);
  assert.equal(text.includes(PLAN.prompt.slice(0, 40)), false, 'planSnapshot 正文不得回流');
  assert.ok(Buffer.byteLength(text, 'utf8') < 1024);
});

test('preflight projection reports issues and an unready provider without inventing a preflight id', () => {
  const projected = projectPreflight({ value: { preview: null, preflight: { valid: false, issues: [{ code: 'provider_not_ready', message: '当前生成配置未完成，无法开始生图。', field: 'provider' }] } } });
  assert.equal(projected.preflightId, null);
  assert.equal(projected.confirmToken, null);
  assert.equal(projected.confirmed, false);
  assert.deepEqual(projected.issues, [{ code: 'provider_not_ready', field: 'provider', message: '当前生成配置未完成，无法开始生图。' }]);
});

test('run receipt projection drops the prompt but keeps the item count', () => {
  const projected = projectRunReceipt({ value: runRow(), replayed: false });
  assert.equal(projected.runId, 'run_1');
  assert.equal(projected.status, 'completed');
  assert.equal(projected.itemCount, 4);
  assert.equal(projected.planVersion, 2);
  assert.equal(JSON.stringify(projected).includes(PLAN.prompt.slice(0, 40)), false);
  assert.ok(Buffer.byteLength(JSON.stringify(projected), 'utf8') < 512);
});

test('round-status projection carries confirmation window, tally and run history without any plan text', () => {
  const raw = JSON.stringify(roundStatusBody()).length;
  const projected = projectRoundStatus(roundStatusBody());
  const size = Buffer.byteLength(JSON.stringify(projected), 'utf8');
  assert.deepEqual(projected.round, { id: 'round_1', taskId: null, purpose: 'exploration', status: 'active', planVersion: 2 });
  assert.equal(projected.confirmation.confirmed, true);
  assert.equal(projected.challenge, null);
  assert.deepEqual(projected.tally, { succeeded: 4 });
  assert.equal(projected.latestRun.id, 'run_1');
  assert.equal(projected.latestRun.status, 'completed');
  assert.deepEqual(projected.runs.map((run) => run.id), ['run_1']);
  assert.equal(projected.runCount, 1);
  const text = JSON.stringify(projected);
  assert.equal(text.includes(PLAN.prompt.slice(0, 40)), false, '计划正文不得随状态回流');
  assert.equal(text.includes('conv_1'), false);
  assert.ok(size * 20 < raw, '投影必须比原始响应小一个数量级以上：' + size + ' vs ' + raw);
  assert.ok(size < 2048, '投影上限 2 KiB，实际 ' + size);
});

test('round-status projection exposes a pending challenge as a window only', () => {
  const body = roundStatusBody();
  body.planStatus.pendingConfirmation = challengeBody();
  body.planStatus.confirmation = { confirmed: false };
  const projected = projectRoundStatus(body);
  assert.deepEqual(projected.challenge, { roundId: 'round_1', expectedVersion: 3, expiresAt: '2026-09-21T01:00:00.000Z' });
  assert.equal(JSON.stringify(projected).includes('ch_claim_token_value'), false);
});

test('round-status projection falls back to the explicit round when the session has no bound batch', () => {
  const body = {
    planStatus: { session: { id: 'session_1', conversationId: 'conv_1' }, context: null, confirmation: { confirmed: false }, pendingConfirmation: null, latestRun: null },
    runs: [],
    round: { id: 'round_9', taskId: 'task_9', purpose: 'refinement', status: 'active', planVersion: 2, version: 3, plan: PLAN },
    latestRun: runRow(),
    tally: { succeeded: 9, outcome_unknown: 1 }
  };
  const projected = projectRoundStatus(body);
  assert.equal(projected.round.id, 'round_9');
  assert.equal(projected.round.purpose, 'refinement');
  assert.equal(projected.latestRun.id, 'run_1');
  assert.deepEqual(projected.tally, { succeeded: 9, outcome_unknown: 1 });
  assert.equal(JSON.stringify(projected).includes(PLAN.prompt.slice(0, 40)), false);
});

test('provider-list projection never carries the endpoint or the descriptor table unless asked', () => {
  // 形状照真实 /api/providers 抄：4 个 descriptor + 带 lastTest/limits 的 profile 行。
  const descriptors = Array.from({ length: 4 }, (_, index) => ({
    id: 'provider-' + index, displayName: 'Provider ' + index, descriptorVersion: 1, adapterVersion: 'http-image-v1', authScheme: 'bearer',
    modelExamples: ['model-a', 'model-b'],
    operations: { generate: true, edit: true },
    reference: { supported: true, defaultEnabled: true, enableOptionKey: null, maxCount: 8, acceptedMediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
    mask: { supported: true, acceptedMediaTypes: ['image/png'] },
    output: { transport: 'openai-size', aspectRatios: 'integer', resolutions: [], resolutionTransportValues: [], qualities: [], defaultSize: '1024x1024', requiresExplicitSizeForNonSquareAspect: true },
    endpoint: { defaultTrustMode: 'compatible_public', allowedTrustModes: ['official', 'compatible_public', 'local_proxy', 'enterprise_private'], officialHosts: ['api.example.test'], examples: ['https://api.example.test/v1'], help: 'OpenAI Images 或兼容 /v1 images endpoint。' }
  }));
  const profiles = Array.from({ length: 4 }, (_, index) => ({
    id: 'profile_' + index, name: 'profile-' + index, providerId: 'provider-' + index, providerName: 'Provider ' + index, model: 'model-' + index,
    endpointSummary: 'https://cc.example.test', endpointTrustMode: 'compatible_public', endpointPolicyWarnings: [],
    apiKeyConfigured: true, referenceEnabled: true, capabilities: { generate: true, edit: true, referenceImage: true, mask: true },
    descriptorVersion: 1, adapterVersion: 'http-image-v1', secretBackend: 'sqlite-plaintext', limits: {},
    lastTest: { configVersion: 1, testedAt: '2026-09-17T20:35:16.860Z', reachable: true, status: 200, descriptorVersion: 1, adapterVersion: 'http-image-v1', warnings: [] },
    configVersion: 1, active: index === 0, createdAt: '2026-09-11T08:38:58.536Z', updatedAt: '2026-09-15T03:45:29.242Z'
  }));
  const body = {
    descriptors,
    profiles,
    status: { profileId: 'profile_0', profileName: 'profile-0', providerId: 'provider-0', model: 'model-0', configured: true, missing: [], endpoint: 'https://cc.example.test', endpointTrustMode: 'compatible_public', configVersion: 3, capabilities: { generate: true, edit: true, referenceImage: true, mask: true } },
    runtime: { desired: { profileId: 'profile_0', configVersion: 3 }, active: { profileId: 'profile_0' }, concurrency: { limit: 4, active: 0 } },
    recentOutcomes: [{ status: 200, at: '2026-09-21T00:00:00.000Z', reachable: true }]
  };
  const slim = projectProviderList(body);
  assert.equal(slim.active.id, 'profile_0');
  assert.equal(slim.active.configured, true);
  assert.deepEqual(slim.active.capabilities, { generate: true, edit: true, referenceImage: true, mask: true });
  assert.equal(slim.profiles.length, 4);
  assert.equal(slim.profileCount, 4);
  assert.equal(JSON.stringify(slim).includes('cc.example.test'), false, '完整 Base URL 不得进入投影');
  assert.equal(Object.hasOwn(slim, 'descriptors'), false);
  const withDescriptors = projectProviderList(body, { descriptors: true });
  assert.equal(Array.isArray(withDescriptors.descriptors), true);
  assert.equal(withDescriptors.descriptors[0].id, 'provider-0');
  const rawSize = Buffer.byteLength(JSON.stringify(body), 'utf8');
  const slimSize = Buffer.byteLength(JSON.stringify(slim), 'utf8');
  assert.ok(rawSize > 6000, '夹具要与真实 /api/providers 同量级，实际 ' + rawSize);
  assert.ok(slimSize < 1024, '投影上限 1 KiB，实际 ' + slimSize);
  assert.ok(slimSize * 6 < rawSize, '投影要比原始响应小 6 倍以上：' + slimSize + ' vs ' + rawSize);
});

test('project-list projection filters locally by exact name, status and limit', () => {
  const body = { projects: [
    { id: 'project_a', name: '美女写真', status: 'active', description: '长描述'.repeat(50), templateId: null, version: 1 },
    { id: 'project_b', name: '鉴权表复验临时项目', status: 'archived', description: 'x', templateId: null, version: 2 },
    { id: 'project_c', name: '美女写真（旧）', status: 'active', description: 'y', templateId: null, version: 1 }
  ] };
  const all = projectProjectList(body);
  assert.equal(all.projectCount, 3);
  assert.deepEqual(all.projects[0], { id: 'project_a', name: '美女写真', status: 'active' });
  const named = projectProjectList(body, { filters: { name: '美女写真' } });
  assert.deepEqual(named.projects.map((project) => project.id), ['project_a']);
  assert.equal(named.matchedInStudio, 1);
  const archived = projectProjectList(body, { filters: { status: 'archived' } });
  assert.deepEqual(archived.projects.map((project) => project.id), ['project_b']);
  const limited = projectProjectList(body, { filters: { limit: 2 } });
  assert.equal(limited.projects.length, 2);
  assert.equal(limited.matchedInStudio, 3);
  assert.equal(JSON.stringify(all).includes('长描述'), false);
});

test('structure projections drop plans, intents and results while keeping ids and counts', () => {
  const task = projectTaskList({ tasks: [{ id: 'task_1', projectId: 'project_1', name: '花园小径', status: 'active', taskTypeId: null, intent: { huge: 'x'.repeat(20000) }, version: 4 }] });
  assert.deepEqual(task, { tasks: [{ id: 'task_1', name: '花园小径', status: 'active', taskTypeId: null, version: 4 }], taskCount: 1 });
  const rounds = projectRoundList({ rounds: [{ id: 'round_1', taskId: 'task_1', parentRoundId: null, purpose: 'exploration', status: 'active', plan: PLAN, planVersion: 2, version: 5 }] });
  assert.deepEqual(rounds.rounds, [{ id: 'round_1', taskId: 'task_1', parentRoundId: null, purpose: 'exploration', status: 'active', planVersion: 2, version: 5 }]);
  assert.equal(JSON.stringify(rounds).includes(PLAN.prompt.slice(0, 40)), false);
  const detail = projectRoundDetail({ round: { id: 'round_1', taskId: 'task_1', purpose: 'exploration', status: 'active', plan: PLAN, planVersion: 2, version: 5 }, latestRun: runRow(), tally: { succeeded: 3, failed: 1 } });
  assert.equal(detail.round.id, 'round_1');
  assert.deepEqual(detail.tally, { succeeded: 3, failed: 1 });
  assert.equal(detail.latestRun.status, 'completed');
  const items = projectRunItems({
    runId: 'run_1', page: 1, pageSize: 50, total: 2, totalPages: 1, statusCounts: { succeeded: 1, outcome_unknown: 1 },
    items: [
      { id: 'item_1', runId: 'run_1', sequence: 1, status: 'succeeded', attempts: 1, retryAt: null, error: null, result: { assetId: 'asset_1', mediaType: 'image/png' }, updatedAt: 'x', outputAssets: [{ id: 'asset_1', kind: 'generated', mediaType: 'image/png', deletedAt: null, mediaState: 'ready' }] },
      { id: 'item_2', runId: 'run_1', sequence: 2, status: 'outcome_unknown', attempts: 2, retryAt: null, error: { code: 'possibly_billed', message: '结果不明' }, result: null, updatedAt: 'y' }
    ]
  });
  assert.deepEqual(items.items[0].assetIds, ['asset_1']);
  assert.equal(items.items[0].errorCode, null);
  assert.equal(items.items[1].errorCode, 'possibly_billed');
  assert.equal(items.statusCounts.outcome_unknown, 1);
  assert.equal(items.itemCount, 2);
});

test('--full is a universal escape hatch and --descriptors belongs to provider-list only', () => {
  const root = '/tmp/daoge-pic-projection';
  const plan = parseCommand(['plan', '--workspace', root, '--round', 'round_1', '--version', '2', '--plan', '{}', '--full', 'true']);
  assert.equal(plan.full, true);
  assert.equal(parseCommand(['plan', '--workspace', root, '--round', 'round_1', '--version', '2', '--plan', '{}']).full, undefined);
  assert.equal(parseCommand(['round-status', '--workspace', root, '--round', 'round_1', '--session', 'session_1', '--full', 'true']).full, true);
  assert.throws(() => parseCommand(['plan', '--workspace', root, '--round', 'round_1', '--version', '2', '--plan', '{}', '--full', 'maybe']), /--full 只能是 true 或 false/);
  const providers = parseCommand(['provider-list', '--workspace', root, '--descriptors', 'true']);
  assert.equal(providers.descriptors, true);
  assert.throws(() => parseCommand(['status', '--workspace', root, '--descriptors', 'true']), /未知或不适用于/);
});

test('new read verbs parse into the documented endpoints', () => {
  const root = '/tmp/daoge-pic-projection';
  assert.equal(parseCommand(['task-list', '--workspace', root, '--project', 'project_1']).request.pathname, '/api/projects/project_1/tasks');
  assert.equal(parseCommand(['round-list', '--workspace', root, '--task', 'task_1']).request.pathname, '/api/tasks/task_1/rounds');
  assert.equal(parseCommand(['round-detail', '--workspace', root, '--round', 'round_1']).request.pathname, '/api/rounds/round_1');
  const items = parseCommand(['run-items', '--workspace', root, '--run', 'run_1', '--status', 'failed,outcome_unknown', '--page', '2', '--page-size', '25']);
  assert.equal(items.request.pathname, '/api/runs/run_1/items?status=failed&status=outcome_unknown&page=2&pageSize=25');
  assert.equal(parseCommand(['run-items', '--workspace', root, '--run', 'run_1']).request.pathname, '/api/runs/run_1/items');
  assert.equal(parseCommand(['project-list', '--workspace', root, '--name', '美女写真']).filters.name, '美女写真');
  assert.equal(parseCommand(['project-list', '--workspace', root]).filters, undefined);
});

test('every projected command is discoverable, documented and in the command table', () => {
  for (const name of Object.keys(COMMAND_PROJECTIONS)) {
    assert.ok(commandSchemas[name], '投影表里有命令但命令表没有：' + name);
    assert.equal(usage().includes('daoge ' + name + '  # '), true, '速览缺少：' + name);
    assert.equal(usageFull().includes('daoge ' + name + ' '), true, '全签名缺少：' + name);
    assert.match(commandHelp(name), /--full  可选/, name + ' 的帮助里没有 --full 逃生口');
  }
  for (const name of ['plan', 'preflight', 'run', 'round-status', 'provider-list', 'project-list', 'task-list', 'round-list', 'round-detail', 'run-items']) {
    assert.ok(COMMAND_PROJECTIONS[name], '该命令必须有投影：' + name);
  }
  assert.match(commandHelp('provider-list'), /--descriptors <true\|false>/);
  assert.doesNotMatch(commandHelp('run'), /--descriptors/);
});