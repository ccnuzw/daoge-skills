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
