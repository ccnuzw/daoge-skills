const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildWorkspaceState } = require('../../scripts/build_workspace_state_v2');
const { makeTempDir, writeJson } = require('../helpers/workspace_v2_test_utils');

test('workspace_state contract has one primaryAction and replySuggestions', () => {
  const outputDir = makeTempDir();
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), {
    task: { id: 'portrait', title: '人物主视觉', summary: '生成人物主视觉' },
    readiness: { canRun: true },
  });
  writeJson(path.join(outputDir, 'internal', 'execution_manifest.json'), { counts: {}, results: [] });
  writeJson(path.join(outputDir, 'internal', 'issue_queue.json'), { summary: {}, items: [] });
  writeJson(path.join(outputDir, 'internal', 'asset_library.json'), { assets: [] });
  const state = buildWorkspaceState({ outputDir });
  assert.equal(state.schemaVersion, 2);
  ['id', 'label', 'intent', 'href', 'targetPage', 'reply', 'reason', 'enabled', 'disabledReason', 'riskLevel'].forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(state.primaryAction, key), true, key);
  });
  assert.equal(typeof state.primaryAction.label, 'string');
  assert.equal(typeof state.primaryAction.enabled, 'boolean');
  assert.equal(Array.isArray(state.secondaryActions), true);
  state.secondaryActions.forEach((action) => {
    ['id', 'label', 'intent', 'href', 'targetPage', 'reply', 'reason', 'enabled', 'disabledReason', 'riskLevel'].forEach((key) => {
      assert.equal(Object.prototype.hasOwnProperty.call(action, key), true, key);
    });
  });
  assert.equal(Array.isArray(state.replySuggestions), true);
  assert.equal(state.replySuggestions[0], state.primaryAction.reply);
  assert.equal(typeof state.decision.whyNow, 'string');
  assert.equal(state.nextBestStep.actionId, state.primaryAction.id);
});
