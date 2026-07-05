const test = require('node:test');
const assert = require('node:assert/strict');
const { decideStage, decideAction } = require('../../scripts/build_workspace_state_v2');
const { buildUserJourneyDecision } = require('../../scripts/build_user_journey_decision');

test('state decision chooses prepare action when run plan is ready', () => {
  const runPlan = { readiness: { canRun: true } };
  const stage = decideStage(runPlan, {}, {}, {});
  const action = decideAction(stage, runPlan, {}, {}, {});
  assert.equal(stage.id, 'prepare');
  assert.equal(action.label, '确认开跑');
  assert.equal(action.reply, '继续，开始执行');
});

test('state decision routes blocking issues to issues page', () => {
  const stage = decideStage({}, { results: [{ id: 'result_001', status: 'failed' }] }, { summary: { blocking: 1 } }, {});
  const action = decideAction(stage, {}, {}, { summary: { blocking: 1 } }, {});
  assert.equal(stage.id, 'issues');
  assert.equal(action.targetPage, 'issues.html');
});

test('state decision routes executed results without blocking issues to results page', () => {
  const stage = decideStage({}, { results: [{ id: 'result_001', status: 'needs_review' }] }, { summary: { blocking: 0, attention: 1 } }, {});
  const action = decideAction(stage, {}, { counts: { needsReview: 1 } }, { summary: { blocking: 0 } }, {});
  assert.equal(stage.id, 'results');
  assert.equal(action.targetPage, 'results.html');
});

test('state decision can route explicit record phase to record page', () => {
  const stage = decideStage({}, { phase: 'record', results: [{ id: 'result_001', status: 'success' }] }, { summary: { blocking: 0 } }, {});
  const action = decideAction(stage, {}, {}, { summary: { blocking: 0 } }, {});
  assert.equal(stage.id, 'record');
  assert.equal(action.targetPage, 'record.html');
});

test('user journey decision exposes stable action and next-step contract', () => {
  const journey = buildUserJourneyDecision(
    { readiness: { canRun: true } },
    { results: [{ id: 'result_001', status: 'success' }], counts: { total: 1, success: 1 } },
    { summary: { blocking: 0, attention: 0, rerunCandidates: 0 }, items: [] },
    { assets: [] }
  );
  ['stage', 'primaryAction', 'secondaryActions', 'replySuggestions', 'decision', 'nextBestStep'].forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(journey, key), true, key);
  });
  assert.equal(journey.primaryAction.id, 'review_results');
  assert.equal(journey.nextBestStep.actionId, journey.primaryAction.id);
  assert.equal(typeof journey.decision.whyNow, 'string');
  assert.equal(Array.isArray(journey.secondaryActions), true);
});
