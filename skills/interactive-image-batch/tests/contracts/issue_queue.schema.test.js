const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildIssueQueue } = require('../../scripts/build_issue_queue');
const { makeTempDir, writeJson } = require('../helpers/workspace_v2_test_utils');

test('issue_queue contract exposes supported groups and item fields', () => {
  const outputDir = makeTempDir();
  const executionManifestFile = path.join(outputDir, 'internal', 'execution_manifest.json');
  writeJson(executionManifestFile, {
    counts: { total: 1, success: 0 },
    results: [{ id: 'result_001', status: 'failed', worthRerun: true, rerunReason: '关键镜头失败' }],
  });
  const queue = buildIssueQueue({ outputDir, executionManifestFile });
  assert.equal(queue.schemaVersion, 2);
  assert.equal(Array.isArray(queue.supportedTypes), true);
  assert.equal(Array.isArray(queue.groups), true);
  ['must_handle', 'needs_confirmation', 'worth_rerun', 'can_ignore', 'resolved'].forEach((id) => {
    assert.equal(queue.groups.some((group) => group.id === id), true);
  });
  const item = queue.items[0];
  ['id', 'type', 'severity', 'title', 'impact', 'recommendedAction', 'status', 'relatedAssetIds', 'blocking', 'worthRerun', 'userNextStep'].forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(item, key), true, key);
  });
});
