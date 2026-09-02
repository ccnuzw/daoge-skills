const test = require('node:test');
const assert = require('node:assert/strict');

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

test('Workbench identity is stable on reload and isolated between tabs', async () => {
  const { workbenchConversationId, WORKBENCH_CONVERSATION_KEY } = await import('../../web/src/workbench-session.mjs');
  const firstTab = memoryStorage();
  const secondTab = memoryStorage();
  const first = workbenchConversationId(firstTab, () => 'first-tab');
  assert.equal(workbenchConversationId(firstTab, () => 'must-not-replace'), first);
  const second = workbenchConversationId(secondTab, () => 'second-tab');
  assert.notEqual(second, first);
  assert.equal(firstTab.getItem(WORKBENCH_CONVERSATION_KEY), 'workbench-first-tab');
  assert.equal(secondTab.getItem(WORKBENCH_CONVERSATION_KEY), 'workbench-second-tab');
});
