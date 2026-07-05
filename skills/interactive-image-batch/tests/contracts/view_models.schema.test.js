const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildViewModels } = require('../../scripts/build_view_models');
const { makeTempDir, writeJson } = require('../helpers/workspace_v2_test_utils');

test('view models are generated for five pages and each has one primaryAction', () => {
  const outputDir = makeTempDir();
  const primaryAction = { label: '确认开跑', reply: '继续，开始执行', targetPage: 'results.html', reason: '准备项已经齐全' };
  writeJson(path.join(outputDir, 'internal', 'workspace_state.json'), {
    task: { id: 'portrait', title: '人物主视觉', summary: '生成人物主视觉' },
    stage: { id: 'prepare', name: '开跑前确认', status: 'ready' },
    decision: { headline: '可以开跑', summary: '', blockingItems: [], attentionItems: [] },
    primaryAction,
    replySuggestions: [primaryAction.reply, '先让我看提示词'],
    counts: {},
  });
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), { readiness: { canRun: true }, promptPlan: {} });
  writeJson(path.join(outputDir, 'internal', 'issue_queue.json'), { summary: {}, groups: [], items: [] });
  writeJson(path.join(outputDir, 'internal', 'asset_library.json'), { assets: [] });
  const models = buildViewModels({ outputDir });
  ['index', 'prepare', 'results', 'issues', 'record'].forEach((id) => {
    assert.equal(models[id].primaryAction.label, primaryAction.label);
    assert.equal(Object.prototype.hasOwnProperty.call(models[id], 'primaryAction'), true);
  });
});
