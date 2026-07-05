const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { refreshWorkspaceV2 } = require('../../src/domain/workspace_service');
const { USER_FORBIDDEN_TERMS } = require('../../src/shared/workspace');
const { makeTempDir, writeJson } = require('../helpers/workspace_v2_test_utils');

test('workspace pages do not expose internal engineering terms', () => {
  const outputDir = makeTempDir();
  writeJson(path.join(outputDir, 'manifest.json'), { runtimeMode: 'prepare-only', selectedCount: 0, batchCount: 0 });
  refreshWorkspaceV2({ outputDir, manifestFile: path.join(outputDir, 'manifest.json') });
  const html = fs.readdirSync(path.join(outputDir, 'workspace'))
    .filter((item) => item.endsWith('.html'))
    .map((item) => fs.readFileSync(path.join(outputDir, 'workspace', item), 'utf8').toLowerCase())
    .join('\n');
  USER_FORBIDDEN_TERMS.forEach((term) => {
    assert.equal(html.includes(term), false, `found ${term}`);
  });
});
