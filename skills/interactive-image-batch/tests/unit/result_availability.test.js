const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  ASSET_KINDS,
  ISSUE_ACTION_IDS,
  ISSUE_TYPES,
  LIFECYCLE_STATUSES,
  RESOLUTION_STATES,
  classifyResultAvailability,
  validateEnumValue,
} = require('../../src/shared/workspace');
const { makeTempDir, writeTinyPng } = require('../helpers/workspace_v2_test_utils');

test('result availability classifies success, missing, failed and review from file state', () => {
  const outputDir = makeTempDir();
  const image = path.join(outputDir, 'source.png');
  writeTinyPng(image);

  const success = classifyResultAvailability(outputDir, { status: 'success', sourceOutput: image });
  assert.equal(success.available, true);
  assert.equal(success.canSelect, true);
  assert.equal(success.missingOutput, false);

  const missing = classifyResultAvailability(outputDir, { status: 'success', output: 'missing.png' });
  assert.equal(missing.available, false);
  assert.equal(missing.missingOutput, true);
  assert.equal(missing.hasIssue, true);
  assert.equal(missing.canRerun, true);

  const failed = classifyResultAvailability(outputDir, { status: 'failed', error: 'timeout' });
  assert.equal(failed.failed, true);
  assert.equal(failed.hasIssue, true);
  assert.equal(failed.missingOutput, false);

  const review = classifyResultAvailability(outputDir, { status: 'needs_review', sourceOutput: image });
  assert.equal(review.needsReview, true);
  assert.equal(review.canExport, true);
  assert.equal(review.canSelect, false);
});

test('workspace v2 enums reject unsupported drift strings', () => {
  assert.deepEqual(ISSUE_TYPES, ['hard_failure', 'needs_review', 'rerun_candidate', 'ignored', 'resolved']);
  assert.equal(ASSET_KINDS.includes('selected_result'), true);
  assert.equal(LIFECYCLE_STATUSES.includes('needs_attention'), true);
  assert.deepEqual(RESOLUTION_STATES, ['open', 'ignored', 'resolved']);
  assert.equal(ISSUE_ACTION_IDS.includes('rerun_candidate'), true);
  assert.throws(
    () => validateEnumValue('asset.kind', 'selected-image', ASSET_KINDS),
    /asset\.kind 不支持/
  );
});
