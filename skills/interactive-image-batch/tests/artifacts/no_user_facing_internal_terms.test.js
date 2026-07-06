const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { refreshWorkspaceV2 } = require('../../src/domain/workspace_service');
const { USER_FORBIDDEN_TERMS } = require('../../src/shared/workspace');
const { makeTempDir, writeJson } = require('../helpers/workspace_v2_test_utils');
const { buildGeneratedPrompts } = require('../../src/domain/prompt_builder');

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

test('issues page explains failures without internal engineering terms', () => {
  const outputDir = makeTempDir();
  writeJson(path.join(outputDir, 'manifest.json'), {
    runtimeMode: 'local-batch-runner',
    selectedCount: 2,
    success: 1,
    failed: 1,
    batches: [{
      batchNumber: 1,
      results: [
        { index: 1, ok: true, output: 'missing.png' },
        { index: 2, ok: false, error: 'http 500: missing image payload' },
      ],
    }],
  });
  refreshWorkspaceV2({ outputDir, manifestFile: path.join(outputDir, 'manifest.json') });
  const html = fs.readFileSync(path.join(outputDir, 'workspace', 'issues.html'), 'utf8').toLowerCase();
  USER_FORBIDDEN_TERMS.forEach((term) => {
    assert.equal(html.includes(term), false, `found ${term}`);
  });
  assert.match(html, /必须处理/);
  assert.match(html, /可补跑/);
});

test('generated prompt text and user titles do not expose internal engineering terms', () => {
  const prompts = buildGeneratedPrompts({
    taskSpec: {
      content_brief: '生成健身 App dashboard UI mockup，包含训练进度、热量、课程卡片和底部导航',
      total_count: 2,
      width: 1024,
      height: 1536,
    },
  });
  const publicText = prompts.map((item) => [
    item.title,
    item.generation_prompt,
    item.negative_prompt,
    item.scene,
    item.composition,
    item.text_policy,
  ].join('\n')).join('\n').toLowerCase();
  USER_FORBIDDEN_TERMS.forEach((term) => {
    assert.equal(publicText.includes(term), false, `found ${term}`);
  });
});
