const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  STABLE_CLI_COMMANDS,
  STABLE_USER_WORKSPACE_PATHS,
  STABLE_DEBUG_PATHS,
  assertContract,
  HOST_NATIVE_RESULT_FIELDS,
  HOST_NATIVE_REQUEST_MODES,
  HOST_NATIVE_STATUSES,
} = require('../../src/contracts');
const {
  V2_WORKSPACE_PAGE_FILES,
  RETIRED_WORKSPACE_PAGE_REPLACEMENTS,
  RESULT_STATUSES,
  ISSUE_TYPES,
  ASSET_KINDS,
  LIFECYCLE_STATUSES,
  RESOLUTION_STATES,
  ISSUE_ACTION_IDS,
  ISSUE_GROUP_IDS,
} = require('../../src/shared/workspace');
const { refreshWorkspace } = require('../../src/domain/workspace_service');
const { main } = require('../../src/cli/daoge');
const { normalizeHostResult } = require('../../src/providers/host_native');
const { skillRoot, makeTempDir, writeJson, writeTinyPng, readJson } = require('../helpers/workspace_v2_test_utils');

test('public CLI command contract is frozen to daoge.js single entry', async () => {
  assert.deepEqual(STABLE_CLI_COMMANDS, ['prepare', 'execute', 'ingest', 'rerun', 'review']);
  await assert.rejects(() => main(['refresh', '--output-dir', makeTempDir()]), /未知命令：refresh/);
  await assert.rejects(() => main([]), /未知命令：缺少命令/);
  await assert.rejects(() => main(['--task-spec', 'task_spec.json']), /未知命令：缺少命令/);
});

test('stable user paths and debug prompt path are frozen', () => {
  assert.deepEqual(Object.values(V2_WORKSPACE_PAGE_FILES), ['index.html', 'prepare.html', 'results.html', 'issues.html', 'record.html']);
  assert.deepEqual(STABLE_USER_WORKSPACE_PATHS, [
    'workspace/index.html',
    'workspace/prepare.html',
    'workspace/results.html',
    'workspace/issues.html',
    'workspace/record.html',
  ]);
  assert.deepEqual(STABLE_DEBUG_PATHS, ['debug/prompts.generated.json']);
});

test('stable enums reject drift', () => {
  assert.deepEqual(RESULT_STATUSES, ['success', 'failed', 'needs_review', 'skipped']);
  assert.deepEqual(ISSUE_TYPES, ['hard_failure', 'needs_review', 'rerun_candidate', 'ignored', 'resolved']);
  assert.deepEqual(RESOLUTION_STATES, ['open', 'ignored', 'resolved']);
  assert.deepEqual(ISSUE_ACTION_IDS, ['review', 'review_results', 'handle_issue', 'ignore_gap', 'mark_resolved', 'rerun_candidate', 'restore_issue']);
  assert.deepEqual(ISSUE_GROUP_IDS, ['must_handle', 'needs_confirmation', 'worth_rerun', 'can_ignore', 'resolved']);
  assert.equal(ASSET_KINDS.includes('image_result'), true);
  assert.equal(LIFECYCLE_STATUSES.includes('ready_for_selection'), true);
  assert.equal(LIFECYCLE_STATUSES.includes('needs_attention'), true);
});

test('legacy user html names cannot return to workspace output', () => {
  const outputDir = makeTempDir();
  const manifestFile = path.join(outputDir, 'internal', 'raw.json');
  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  Object.keys(RETIRED_WORKSPACE_PAGE_REPLACEMENTS).forEach((name) => {
    fs.writeFileSync(path.join(outputDir, name), name);
    fs.writeFileSync(path.join(outputDir, 'workspace', name), name);
  });
  writeJson(manifestFile, { runtimeMode: 'prepare-only', selectedCount: 0, batchCount: 0 });
  refreshWorkspace({ outputDir, manifestFile });
  Object.keys(RETIRED_WORKSPACE_PAGE_REPLACEMENTS).forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), false, name);
    assert.equal(fs.existsSync(path.join(outputDir, 'workspace', name)), false, name);
  });
  assert.deepEqual(fs.readdirSync(path.join(outputDir, 'workspace')).filter((name) => name.endsWith('.html')).sort(), [
    'index.html',
    'issues.html',
    'prepare.html',
    'record.html',
    'results.html',
  ]);
});

test('host-native results are validated before workspace ingest', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const resultsFile = path.join(tempDir, 'bad_results.json');
  writeJson(resultsFile, [
    { index: '001', title: '旧字段', request_mode: 'prompt-only', status: 'done' },
  ]);
  assert.throws(() => execFileSync(process.execPath, [
    path.join(skillRoot, 'scripts', 'daoge.js'),
    'ingest',
    '--results-file', resultsFile,
    '--output-dir', outputDir,
  ], { cwd: skillRoot, encoding: 'utf8', stdio: 'pipe' }), /request_mode|status 不支持/);
  assert.equal(fs.existsSync(path.join(outputDir, 'workspace', 'index.html')), false);
});

test('host-native result contract freezes fields and status values', () => {
  assert.throws(() => assertContract('hostNativeResults', undefined), /host_native_results 必须是数组/);
  assertContract('hostNativeResults', [
    { index: '001', title: '成功', requestMode: 'prompt-only', status: 'success', output: '/tmp/a.png' },
    { index: '002', title: '复核', requestMode: 'masked-edit', status: 'needs_review', output: '/tmp/b.png' },
    { index: '003', title: '失败', requestMode: 'prompt-only', status: 'failed', error: 'timeout' },
  ]);
  assert.throws(() => assertContract('hostNativeResults', [
    { index: '001', title: '漂移', request_mode: 'prompt-only', status: 'success', output: '/tmp/a.png' },
  ]), /requestMode|request_mode/);
  assert.throws(() => assertContract('hostNativeResults', [
    { index: '001', title: '漂移', requestMode: 'prompt-only', status: 'success', output: '/tmp/a.png', shot_label: '旧镜头名' },
  ]), /不支持字段: shot_label/);
  assert.throws(() => assertContract('hostNativeResults', [
    { index: '001', title: '漂移', requestMode: 'prompt-only', status: 'success', output: '/tmp/a.png', slot_id: 'shot_1' },
  ]), /不支持字段: slot_id/);
  assert.throws(() => assertContract('hostNativeResults', [
    { index: '001', title: '漂移', requestMode: {}, status: 'success', output: '/tmp/a.png' },
  ]), /requestMode 必须是字符串/);
  assert.throws(() => assertContract('hostNativeResults', [
    { index: '001', title: '漂移', requestMode: 'legacy-edit', status: 'success', output: '/tmp/a.png' },
  ]), /requestMode 不支持/);
  assert.throws(() => assertContract('hostNativeResults', [
    { index: '001', title: '漂移', requestMode: 'prompt-only', status: 'success', output: {} },
  ]), /output 必须是字符串/);
  assert.throws(() => normalizeHostResult({
    index: '001',
    title: '漂移',
    requestMode: 'prompt-only',
    status: 'done',
    output: '/tmp/a.png',
  }), /status 不支持: done/);
});

test('host-native schema documentation stays aligned with validator', () => {
  const schema = readJson(path.join(skillRoot, 'references', 'host_native_results.schema.json'));
  assert.deepEqual(schema.required_fields, ['index', 'title', 'requestMode', 'status']);
  assert.deepEqual([...schema.required_fields, ...schema.recommended_fields].sort(), HOST_NATIVE_RESULT_FIELDS.slice().sort());
  assert.deepEqual(schema.status_enum, HOST_NATIVE_STATUSES);
  assert.match(schema.field_notes.requestMode, new RegExp(HOST_NATIVE_REQUEST_MODES.join('.*')));
  assert.match(schema.field_notes.output, /relative to the host_native_results\.json directory/);
  assert.ok(schema.recommended_fields.includes('shotLabel'));
});

test('host-native schema document matches accepted metadata fields', () => {
  const schema = readJson(path.join(skillRoot, 'references', 'host_native_results.schema.json'));
  assert.deepEqual(schema.required_fields, ['index', 'title', 'requestMode', 'status']);
  assert.deepEqual(schema.status_enum, ['success', 'needs_review', 'failed']);
  [
    'output',
    'slotId',
    'shotLabel',
    'scene',
    'composition',
    'textPolicy',
    'error',
    'styleFamily',
    'slotRole',
  ].forEach((field) => {
    assert.equal(schema.recommended_fields.includes(field), true, `${field} missing from recommended_fields`);
    assert.equal(Object.prototype.hasOwnProperty.call(schema.field_notes, field), true, `${field} missing from field_notes`);
  });
  assert.match(schema.field_notes.output, /relative to the host_native_results\.json directory/);
  assert.doesNotMatch(schema.field_notes.output, /repo-relative/);
});

test('example catalog entries point to preparable task specs and no retired workspace entry', () => {
  const catalog = readJson(path.join(skillRoot, 'references', 'examples', 'examples.catalog.json'));
  const retiredText = [
    'workspace_home.html',
    'prepare_workspace.html',
    'result_workspace.html',
    'exception_workspace.html',
    'run_record.html',
    'result_hub.html',
    'daoge_portal.html',
  ];
  const catalogText = JSON.stringify(catalog);
  retiredText.forEach((term) => {
    assert.equal(catalogText.includes(term), false, `retired entry leaked: ${term}`);
  });
  catalog.examples.slice(0, 40).forEach((entry) => {
    const examplePath = path.join(skillRoot, entry.example_file);
    assert.equal(fs.existsSync(examplePath), true, entry.example_file);
    const example = readJson(examplePath);
    assert.equal(typeof example.content_brief, 'string', entry.example_file);
    assert.ok(example.content_brief.trim().length > 0, entry.example_file);
  });
});

test('host-native ingest preserves accepted metadata fields', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const imageFile = path.join(tempDir, 'a.png');
  const resultsFile = path.join(tempDir, 'results.json');
  writeTinyPng(imageFile);
  writeJson(resultsFile, [{
    index: '001',
    title: 'A',
    requestMode: 'prompt-only',
    status: 'success',
    output: imageFile,
    slotId: 'shot_1',
    shotLabel: '开场',
    scene: '室内',
    composition: 'center hero',
    textPolicy: 'clean top area',
    styleFamily: 'editorial',
    slotRole: 'hero',
  }]);
  execFileSync(process.execPath, [
    path.join(skillRoot, 'scripts', 'daoge.js'),
    'ingest',
    '--results-file', resultsFile,
    '--output-dir', outputDir,
  ], { cwd: skillRoot, encoding: 'utf8', stdio: 'pipe' });
  const manifest = readJson(path.join(outputDir, 'internal', 'host_native_execution.json'));
  const result = manifest.batches[0].results[0];
  assert.equal(result.slotId, 'shot_1');
  assert.equal(result.shotLabel, '开场');
  assert.equal(result.scene, '室内');
  assert.equal(result.composition, 'center hero');
  assert.equal(result.textPolicy, 'clean top area');
  assert.equal(result.styleFamily, 'editorial');
  assert.equal(result.slotRole, 'hero');
});

test('success, needs-review, failed, and missing-output states land in correct user paths', () => {
  const outputDir = makeTempDir();
  const imageA = path.join(outputDir, 'source', 'a.png');
  const imageB = path.join(outputDir, 'source', 'b.png');
  writeTinyPng(imageA);
  writeTinyPng(imageB);
  const manifestFile = path.join(outputDir, 'internal', 'raw.json');
  writeJson(manifestFile, {
    runtimeMode: 'host-native-image-tool',
    model: 'host-native',
    selectedCount: 4,
    batchSize: 4,
    batchCount: 1,
    batches: [{
      batchNumber: 1,
      totalBatches: 1,
      success: 1,
      failed: 1,
      skipped: 0,
      results: [
        { index: '001', title: '成功', requestMode: 'prompt-only', status: 'success', output: imageA },
        { index: '002', title: '复核', requestMode: 'prompt-only', status: 'needs_review', output: imageB },
        { index: '003', title: '失败', requestMode: 'prompt-only', status: 'failed', error: 'timeout' },
        { index: '004', title: '缺文件', requestMode: 'prompt-only', status: 'success', output: path.join(outputDir, 'source', 'missing.png') },
      ],
    }],
  });
  refreshWorkspace({ outputDir, manifestFile });
  const library = readJson(path.join(outputDir, 'internal', 'asset_library.json'));
  const byId = (id) => library.assets.find((asset) => asset.id === id);
  assert.match(byId('result_001').path, /^assets\/results\//);
  assert.match(byId('result_002').path, /^assets\/review\//);
  assert.match(byId('result_003').path, /^assets\/issues\//);
  assert.match(byId('result_004').path, /^assets\/issues\//);
  const issues = readJson(path.join(outputDir, 'internal', 'issue_queue.json'));
  assert.equal(issues.summary.blocking, 2);
  assert.equal(issues.summary.attention, 1);
  assert.equal(issues.summary.rerunCandidates, 2);
  assert.equal(issues.items.some((item) => item.reason === 'provider_timeout' && item.rerunnable === true), true);
  assert.equal(issues.items.some((item) => item.reason === 'missing_output' && item.rerunnable === true), true);
});
