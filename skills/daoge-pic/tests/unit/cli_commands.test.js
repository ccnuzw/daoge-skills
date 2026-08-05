const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../../src/cli/daoge');

test('unknown command message includes catalog without changing stable command contract', async () => {
  await assert.rejects(() => main(['unknown-command']), /catalog/);
});
