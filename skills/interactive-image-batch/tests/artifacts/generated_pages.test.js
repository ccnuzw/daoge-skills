const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { refreshWorkspaceV2 } = require('../../scripts/refresh_workspace_v2');
const { makeTempDir, writeJson } = require('../helpers/workspace_v2_test_utils');

test('generated workspace pages are the five v2 pages', () => {
  const outputDir = makeTempDir();
  writeJson(path.join(outputDir, 'manifest.json'), { runtimeMode: 'prepare-only', selectedCount: 0, batchCount: 0 });
  refreshWorkspaceV2({ outputDir, manifestFile: path.join(outputDir, 'manifest.json') });
  const pages = fs.readdirSync(path.join(outputDir, 'workspace')).filter((item) => item.endsWith('.html')).sort();
  assert.deepEqual(pages, ['index.html', 'issues.html', 'prepare.html', 'record.html', 'results.html']);
});

test('assets directory has full user lifecycle folders and export report', () => {
  const outputDir = makeTempDir();
  writeJson(path.join(outputDir, 'manifest.json'), { runtimeMode: 'prepare-only', selectedCount: 0, batchCount: 0 });
  refreshWorkspaceV2({ outputDir, manifestFile: path.join(outputDir, 'manifest.json') });
  ['inputs', 'references', 'masks', 'results', 'review', 'issues', 'selected', 'exports', 'archive'].forEach((dir) => {
    assert.equal(fs.existsSync(path.join(outputDir, 'assets', dir)), true, `missing assets/${dir}`);
  });
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'exports', 'report.html')), true);
});

test('workspace pages do not link debug compatibility files as primary entries', () => {
  const outputDir = makeTempDir();
  writeJson(path.join(outputDir, 'manifest.json'), { runtimeMode: 'prepare-only', selectedCount: 0, batchCount: 0 });
  refreshWorkspaceV2({ outputDir, manifestFile: path.join(outputDir, 'manifest.json') });
  const html = fs.readdirSync(path.join(outputDir, 'workspace'))
    .filter((item) => item.endsWith('.html'))
    .map((item) => fs.readFileSync(path.join(outputDir, 'workspace', item), 'utf8'))
    .join('\n');
  assert.doesNotMatch(html, /debug\/compat/);
  assert.doesNotMatch(html, /\.json["']/);
});
