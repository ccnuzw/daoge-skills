const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildViewModels, issueGroups } = require('../../src/domain/view_models');
const { makeTempDir, writeJson } = require('../helpers/workspace_v2_test_utils');

test('view models are generated for five pages and each has one primaryAction', () => {
  const outputDir = makeTempDir();
  const primaryAction = {
    id: 'confirm_run',
    label: '确认开跑',
    intent: 'confirm_execution',
    href: 'results.html',
    targetPage: 'results.html',
    reply: '继续，开始执行',
    reason: '准备项已经齐全',
    enabled: true,
    disabledReason: null,
    riskLevel: 'medium',
  };
  const secondaryActions = [{
    id: 'open_record',
    label: '看记录',
    intent: 'review_record',
    href: 'record.html',
    targetPage: 'record.html',
    reply: '打开任务记录',
    reason: '查看本轮记录',
    enabled: true,
    disabledReason: null,
    riskLevel: 'low',
  }];
  writeJson(path.join(outputDir, 'internal', 'workspace_state.json'), {
    task: { id: 'portrait', title: '人物主视觉', summary: '生成人物主视觉' },
    stage: { id: 'prepare', name: '开跑前确认', status: 'ready' },
    decision: { headline: '可以开跑', summary: '', whyNow: '准备项齐全', blockingItems: [], attentionItems: [] },
    nextBestStep: { actionId: primaryAction.id, page: 'results.html', reply: primaryAction.reply, reason: '准备项齐全' },
    primaryAction,
    secondaryActions,
    replySuggestions: [primaryAction.reply, '先让我看提示词'],
    counts: {},
  });
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), { readiness: { canRun: true }, promptPlan: {} });
  writeJson(path.join(outputDir, 'internal', 'issue_queue.json'), { summary: {}, groups: [], items: [] });
  writeJson(path.join(outputDir, 'internal', 'asset_library.json'), {
    assets: [
      {
        id: 'selected_001',
        kind: 'selected_result',
        userTitle: '推荐候选',
        userStatus: '建议优先筛选',
        path: 'assets/selected/001.png',
        group: '已选结果',
        usage: { canSelect: true },
      },
      {
        id: 'selected_placeholder',
        kind: 'selection_placeholder',
        userTitle: '用户已选占位',
        userStatus: '等待选择',
        path: 'assets/selected/README.json',
        group: '已选结果',
        usage: { canExport: false },
      },
    ],
  });
  const models = buildViewModels({ outputDir });
  ['index', 'prepare', 'results', 'issues', 'record'].forEach((id) => {
    assert.equal(models[id].primaryAction.label, primaryAction.label);
    assert.equal(Array.isArray(models[id].secondaryActions), true);
    assert.equal(models[id].nextBestStep.actionId, primaryAction.id);
    assert.equal(Object.prototype.hasOwnProperty.call(models[id], 'primaryAction'), true);
  });
  assert.equal(Object.prototype.hasOwnProperty.call(models.results.assets, 'selected'), true);
  assert.deepEqual(models.results.assets.selected.map((asset) => asset.id), ['selected_001']);
  assert.equal(Object.prototype.hasOwnProperty.call(models.results.assets, 'exports'), true);
  assert.equal(Array.isArray(models.issues.issueGroups), true);
});

test('issueGroups resolves grouped items without repeated Array.find scans', () => {
  const items = [
    { id: 'issue_001', title: '问题 1', impact: '影响 1', status: 'open' },
    { id: 'issue_002', title: '问题 2', impact: '影响 2', status: 'open' },
  ];
  items.find = () => {
    throw new Error('Array.find should not be used');
  };
  const groups = issueGroups({
    groups: [{ id: 'must_handle', title: '必须处理', itemIds: ['issue_002', 'missing', 'issue_001'] }],
    items,
  });
  assert.deepEqual(groups[0].items.map((item) => item.id), ['issue_002', 'issue_001']);
});
