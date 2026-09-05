const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('Workbench confirms a plan without preflighting or queueing a generation run', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../web/src/main.jsx'), 'utf8');
  const start = source.indexOf('const confirmGenerationPlan = async () => {');
  const end = source.indexOf('const openArchiveConfirmation =', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const confirmation = source.slice(start, end);
  assert.match(confirmation, /\/confirm'/);
  assert.doesNotMatch(confirmation, /\/preflight|\/api\/runs|user-preflight|user-run/);
  assert.match(source, /confirmLabel="确认计划"/);
  assert.match(source, /确认不会调用 Provider/);
  assert.doesNotMatch(source, /确认并开始生成/);
});
