const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  skillRoot,
  makeTempDir,
  runScript,
  assertWorkspacePagesExist,
} = require('../helpers/workspace_v2_test_utils');

test('prepare flow generates v2 workspace, assets and internal contracts', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'tests', 'fixtures', 'task_spec.minimal.json'),
    '--strategy-file', path.join(skillRoot, 'tests', 'fixtures', 'prompt_strategy.minimal.json'),
    '--prompts-file', path.join(skillRoot, 'tests', 'fixtures', 'prompts.minimal.json'),
    '--output-dir', outputDir,
    '--batch-size', '1',
  ]);
  assertWorkspacePagesExist(assert, outputDir);
  ['run_plan.json', 'execution_manifest.json', 'issue_queue.json', 'asset_library.json', 'workspace_state.json'].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, 'internal', name)), true, `missing ${name}`);
  });
  assert.equal(fs.existsSync(path.join(outputDir, 'workspace_home.html')), false);
  assert.match(fs.readFileSync(path.join(outputDir, 'README.md'), 'utf8'), /workspace\/index\.html/);
});

test('prepare flow can generate prompts from task spec without prompts file', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'tests', 'fixtures', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  assertWorkspacePagesExist(assert, outputDir);
  const prompts = JSON.parse(fs.readFileSync(path.join(outputDir, 'debug', 'prompts.generated.json'), 'utf8'));
  assert.equal(prompts.length, 2);
  assert.equal(typeof prompts[0].generation_prompt, 'string');
  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'internal', 'prepare_manifest.json'), 'utf8'));
  assert.equal(manifest.promptSourceMode, 'generated-from-task-spec');
});
