const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource } = require('./source-text');

test('PromptWorkspace clears the selected version comparison when its round changes', () => {
  const source = readFrontendSource();
  assert.match(source, /useEffect\(\(\) => \{ setComparison\(\[\]\); \}, \[round\?\.id\]\)/);
});
