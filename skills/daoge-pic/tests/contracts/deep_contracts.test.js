const test = require('node:test');
const assert = require('node:assert/strict');
const { assertContract } = require('../../src/contracts');

function action() {
  return {
    id: 'confirm_run',
    label: '确认开跑',
    intent: 'confirm_execution',
    href: 'results.html',
    targetPage: 'results.html',
    reply: '继续',
    reason: '准备完成',
    enabled: true,
    disabledReason: null,
    riskLevel: 'medium',
  };
}

test('contracts reject bad primitive type', () => {
  assert.throws(() => assertContract('executionManifest', {
    schemaVersion: 2,
    phase: 'execute',
    execution: { mode: 'local-batch-runner', provider: 'gpt-image-2', paused: false, pauseReason: null, dryRun: false },
    counts: { total: '1', success: 1, failed: 0, needsReview: 0, skipped: 0 },
    results: [],
  }), /counts\.total/);
});

test('contracts reject bad enum', () => {
  assert.throws(() => assertContract('assetLibrary', {
    schemaVersion: 2,
    directories: {},
    groups: [],
    assets: [{
      id: 'asset_001',
      kind: 'bad_kind',
      userTitle: '结果',
      userStatus: '可筛选',
      userPurpose: '筛选',
      userAction: '查看',
      lifecycleStatus: 'ready_for_selection',
      sourceReason: '生成成功',
      path: 'assets/results/001.png',
      group: '所有生成结果',
      usage: { canSelect: true, needsReview: false, hasIssue: false, canExport: true },
      relationships: {},
      source: { stage: 'execute' },
    }],
  }), /kind 不支持/);
});

test('contracts reject bad array item shape', () => {
  assert.throws(() => assertContract('issueQueue', {
    schemaVersion: 2,
    supportedTypes: ['hard_failure'],
    summary: {},
    groups: [{ id: 'must_handle', title: '必须处理', itemIds: 'issue_001' }],
    items: [],
  }), /itemIds 必须是数组/);
});

test('contracts reject missing action field', () => {
  const primaryAction = action();
  delete primaryAction.reply;
  assert.throws(() => assertContract('workspaceState', {
    schemaVersion: 2,
    task: { id: 'portrait', title: '人物', summary: '人物主视觉' },
    stage: { id: 'prepare', name: '开跑前确认', status: 'ready' },
    primaryAction,
    secondaryActions: [],
    nextBestStep: { actionId: 'confirm_run', page: 'results.html', reply: '继续', reason: '准备完成' },
    replySuggestions: ['继续'],
  }), /primaryAction 缺少字段: reply/);
});
