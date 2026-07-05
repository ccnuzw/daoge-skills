const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { refreshWorkspaceV2 } = require('../../src/domain/workspace_service');
const { renderWorkspacePage } = require('../../src/renderers/workspace_page');
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

test('workspace pages do not link debug files as primary entries', () => {
  const outputDir = makeTempDir();
  writeJson(path.join(outputDir, 'manifest.json'), { runtimeMode: 'prepare-only', selectedCount: 0, batchCount: 0 });
  refreshWorkspaceV2({ outputDir, manifestFile: path.join(outputDir, 'manifest.json') });
  const html = fs.readdirSync(path.join(outputDir, 'workspace'))
    .filter((item) => item.endsWith('.html'))
    .map((item) => fs.readFileSync(path.join(outputDir, 'workspace', item), 'utf8'))
    .join('\n');
  assert.doesNotMatch(html, /debug\//);
  assert.doesNotMatch(html, /\.json["']/);
});

test('legacy workspace pages are not kept in user path', () => {
  const outputDir = makeTempDir();
  writeJson(path.join(outputDir, 'manifest.json'), { runtimeMode: 'prepare-only', selectedCount: 0, batchCount: 0 });
  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  ['workspace_home.html', 'prepare_workspace.html', 'result_workspace.html', 'exception_workspace.html', 'run_record.html'].forEach((name) => {
    fs.writeFileSync(path.join(outputDir, name), name);
    fs.writeFileSync(path.join(outputDir, 'workspace', name), name);
  });
  refreshWorkspaceV2({ outputDir, manifestFile: path.join(outputDir, 'manifest.json') });
  ['workspace_home.html', 'prepare_workspace.html', 'result_workspace.html', 'exception_workspace.html', 'run_record.html'].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), false, name);
    assert.equal(fs.existsSync(path.join(outputDir, 'workspace', name)), false, name);
  });
  assert.equal(fs.existsSync(path.join(outputDir, 'debug', 'compat', 'manifest.json')), false);
});

test('disabled primary action renders as non-clickable with disabled reason', () => {
  const html = renderWorkspacePage({
    pageId: 'index',
    title: '任务首页',
    task: { title: '人物主视觉', summary: '生成人物主视觉' },
    stage: { name: '开跑前确认' },
    decision: { headline: '先补准备' },
    primaryAction: {
      id: 'fix_prepare',
      label: '先补准备',
      href: 'prepare.html',
      targetPage: 'prepare.html',
      reply: '先补齐准备项',
      reason: '还有准备项',
      enabled: false,
      disabledReason: '缺少任务说明',
    },
    secondaryActions: [],
    replySuggestions: ['先补齐准备项'],
    nav: [],
    sections: [],
  });
  assert.match(html, /缺少任务说明/);
  assert.doesNotMatch(html, /<a class="primary-action" href="prepare\.html">/);
  assert.match(html, /<span class="primary-action disabled">/);
});
