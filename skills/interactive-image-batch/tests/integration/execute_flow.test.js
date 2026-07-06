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

test('execute inherits runtime defaults from prepared task spec', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  const taskSpecFile = path.join(tempDir, 'task_spec.json');
  writeEnv(envFile);
  fs.writeFileSync(taskSpecFile, `${JSON.stringify({
    content_brief: '方图商业海报',
    output_mode: 'single square poster',
    style_requirements: ['clean product composition'],
    source_files: [],
    total_count: 2,
    batch_size: 1,
    concurrency: 1,
    retry_count: 0,
    timeout_seconds: 120,
    width: 512,
    height: 512,
    variation_requirements: ['two simple variations'],
    text_policy: 'no readable text',
    preview_count: 2,
    require_confirmation: false,
  }, null, 2)}\n`);
  runScript('daoge.js', ['prepare',
    '--task-spec', taskSpecFile,
    '--output-dir', outputDir,
  ]);
  runScript('daoge.js', ['execute',
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
  ]);
  const manifest = readJson(path.join(outputDir, 'internal', 'local_execution_raw.json'));
  assert.equal(manifest.defaultSize, '512x512');
  assert.equal(manifest.batchSize, 1);
  assert.equal(manifest.batchCount, 2);
});
