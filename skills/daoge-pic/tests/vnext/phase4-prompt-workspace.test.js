const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('PromptWorkspace clears the selected version comparison when its round changes', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/prompt-workspace.jsx'), 'utf8');
  assert.match(source, /useEffect\(\(\) => \{ setComparison\(\[\]\); \}, \[round\?\.id\]\)/);
});
