const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  skillRoot,
  makeTempDir,
  readJson,
  runScript,
  writeEnv,
  assertWorkspacePagesExist,
} = require('../helpers/workspace_v2_test_utils');

test('execute dry-run emits clean workspace and internal contracts', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);
  runScript('daoge.js', ['execute',
    '--prompts-file', path.join(skillRoot, 'tests', 'fixtures', 'prompts.minimal.json'),
    '--task-spec', path.join(skillRoot, 'tests', 'fixtures', 'task_spec.minimal.json'),
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
  ]);
  assertWorkspacePagesExist(assert, outputDir);
  ['run_plan.json', 'execution_manifest.json', 'issue_queue.json', 'asset_library.json', 'workspace_state.json'].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, 'internal', name)), true, `missing ${name}`);
  });
  const pages = fs.readdirSync(path.join(outputDir, 'workspace')).filter((name) => name.endsWith('.html')).sort();
  assert.deepEqual(pages, ['index.html', 'issues.html', 'prepare.html', 'record.html', 'results.html']);
  assert.equal(fs.existsSync(path.join(outputDir, 'manifest.json')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'workspace_home.html')), false);
  const manifest = readJson(path.join(outputDir, 'internal', 'local_execution_raw.json'));
  assert.equal(manifest.dryRun, true);
  assert.equal(manifest.skipped, 2);
});

test('execute after simple prepare finds generated prompts and task spec automatically', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);
  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'tests', 'fixtures', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  runScript('daoge.js', ['execute',
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
  ]);
  const manifest = readJson(path.join(outputDir, 'internal', 'local_execution_raw.json'));
  assert.equal(manifest.promptSourceOriginal, path.join(outputDir, 'debug', 'prompts.generated.json'));
  assert.equal(manifest.skipped, 2);
});
