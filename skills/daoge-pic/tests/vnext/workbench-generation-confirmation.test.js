const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource } = require('./source-text');

test('Workbench exposes the confirmation gate on the current pending plan view', () => {
  const source = readFrontendSource();
  assert.match(source, /prompts: \(\) => <>.*human-confirmation-gate/s);
  assert.match(source, /selectedRound\?\.status === 'awaiting_confirmation'/);
  assert.match(source, /审阅并确认计划/);
  assert.match(source, /openGenerationConfirmation\(\)/);
});

test('Workbench confirms a plan without preflighting or queueing a generation run', () => {
  const source = readFrontendSource();
  const start = source.indexOf('const confirmGenerationPlan = async () => {');
  const end = source.indexOf('const openArchiveConfirmation =', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const confirmation = source.slice(start, end);
  assert.match(confirmation, /\/confirm'/);
  assert.doesNotMatch(confirmation, /\/preflight|\/api\/runs|user-preflight|user-run/);
  assert.match(source, /confirmLabel="确认计划"/);
  // 工程细节搬进技术详情层（note），人话在上：确认之后会怎样，见 confirmationPlanSummary。
  assert.match(source, /确认本身不会调用生成服务/);
  assert.match(source, /confirmationPlanSummary\(generationConfirmation\.round\)/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /确认不会调用 Provider/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /确认并开始生成/);
});
