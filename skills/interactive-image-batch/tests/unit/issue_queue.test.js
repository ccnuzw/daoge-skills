const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildIssueQueue } = require('../../scripts/build_issue_queue');
const { makeTempDir, writeJson } = require('../helpers/workspace_v2_test_utils');

function queueFor(results, counts = {}) {
  const outputDir = makeTempDir();
  const executionPath = path.join(outputDir, 'internal', 'execution_manifest.json');
  writeJson(executionPath, {
    counts: { total: results.length, success: results.filter((item) => item.status === 'success').length, ...counts },
    results,
  });
  return buildIssueQueue({ outputDir, executionManifestFile: executionPath });
}

test('issue queue keeps failed item non-rerunnable when no reason exists', () => {
  const queue = queueFor([
    { id: 'result_001', status: 'success' },
    { id: 'result_002', status: 'failed' },
  ], { total: 2, success: 1 });
  assert.equal(queue.items.some((item) => item.type === 'hard_failure'), true);
  assert.equal(queue.items.some((item) => item.type === 'rerun_candidate'), false);
  assert.equal(queue.summary.blocking, 1);
  assert.equal(queue.summary.rerunCandidates, 0);
});

test('issue queue adds rerun candidate only when rerun has a user reason', () => {
  const queue = queueFor([
    { id: 'result_001', status: 'failed', worthRerun: true, rerunReason: '关键镜头失败' },
  ], { total: 1, success: 0 });
  const rerun = queue.items.find((item) => item.type === 'rerun_candidate');
  assert.equal(Boolean(rerun), true);
  assert.equal(rerun.worthRerun, true);
  assert.match(rerun.impact, /关键镜头失败/);
});

test('issue queue treats needs-review-only as non-blocking confirmation', () => {
  const queue = queueFor([
    { id: 'result_001', status: 'needs_review' },
  ]);
  assert.equal(queue.summary.blocking, 0);
  assert.equal(queue.items[0].type, 'needs_review');
  assert.equal(queue.items[0].blocking, false);
});

test('issue queue supports ignored, resolved and empty states', () => {
  const outputDir = makeTempDir();
  const queue = buildIssueQueue({
    outputDir,
    extraItems: [
      { type: 'ignored', title: '可以忽略', status: 'ignored' },
      { type: 'resolved', title: '已经解决', status: 'resolved' },
    ],
  });
  assert.deepEqual(queue.supportedTypes, ['hard_failure', 'needs_review', 'rerun_candidate', 'ignored', 'resolved']);
  assert.equal(queue.summary.blocking, 0);
  assert.equal(queue.summary.ignored, 1);
  assert.equal(queue.summary.resolved, 1);
  assert.equal(queue.groups.some((group) => group.id === 'resolved'), true);
});

test('issue queue exposes action loop for blocking review rerun ignored and resolved', () => {
  const outputDir = makeTempDir();
  const executionPath = path.join(outputDir, 'internal', 'execution_manifest.json');
  writeJson(executionPath, {
    counts: { total: 3, success: 1 },
    results: [
      { id: 'result_001', status: 'failed', worthRerun: true, rerunReason: '关键镜头失败' },
      { id: 'result_002', status: 'needs_review' },
      { id: 'result_003', status: 'success' },
    ],
  });
  const queue = buildIssueQueue({
    outputDir,
    executionManifestFile: executionPath,
    extraItems: [
      { id: 'ignored_001', type: 'ignored', title: '不用处理', status: 'ignored' },
      { id: 'resolved_001', type: 'resolved', title: '已经处理', status: 'resolved' },
    ],
  });
  ['必须处理', '建议确认', '值得补跑', '已忽略', '已处理'].forEach((title) => {
    assert.equal(queue.groups.some((group) => group.title === title), true, title);
  });
  ['hard_failure', 'needs_review', 'rerun_candidate', 'ignored', 'resolved'].forEach((type) => {
    const item = queue.items.find((entry) => entry.type === type);
    assert.equal(Boolean(item), true, type);
    assert.equal(Boolean(item.userImpact), true);
    assert.equal(Array.isArray(item.availableActions), true);
    assert.equal(item.availableActions.length > 0, true);
    assert.equal(Boolean(item.resolutionState), true);
  });
  assert.equal(queue.items.find((item) => item.type === 'rerun_candidate').availableActions.some((action) => action.id === 'rerun_candidate'), true);
  assert.equal(queue.items.find((item) => item.type === 'ignored').resolutionState, 'ignored');
  assert.equal(queue.items.find((item) => item.type === 'resolved').resolutionState, 'resolved');
});
