const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const {
  makeTempDir,
  readJson,
  runScript,
  writeEnv,
  assertWorkspacePagesExist,
  skillRoot,
} = require('../helpers/workspace_v2_test_utils');
const { USER_FORBIDDEN_TERMS } = require('../../src/shared/workspace');

const RETIRED_PATHS = [
  'workspace_home.html',
  'prepare_workspace.html',
  'result_workspace.html',
  'exception_workspace.html',
  'run_record.html',
  'result_hub.html',
  'daoge_portal.html',
];

function readWorkspaceHtml(outputDir) {
  return fs.readdirSync(path.join(outputDir, 'workspace'))
    .filter((name) => name.endsWith('.html'))
    .map((name) => fs.readFileSync(path.join(outputDir, 'workspace', name), 'utf8'))
    .join('\n');
}

function assertUserWorkspaceClean(outputDir) {
  const html = readWorkspaceHtml(outputDir);
  RETIRED_PATHS.forEach((legacyPath) => {
    assert.equal(html.includes(legacyPath), false, `旧路径泄露到用户页面: ${legacyPath}`);
  });
  ['internal/', 'debug/', 'internal\\', 'debug\\'].forEach((internalPath) => {
    assert.equal(html.includes(internalPath), false, `内部路径泄露到用户页面: ${internalPath}`);
  });
  const lowerHtml = html.toLowerCase();
  USER_FORBIDDEN_TERMS.forEach((term) => {
    const normalizedTerm = String(term).toLowerCase();
    assert.equal(lowerHtml.includes(normalizedTerm), false, `内部术语泄露到用户页面: ${term}`);
  });
}

function assertIndexHasNextStep(outputDir) {
  const index = fs.readFileSync(path.join(outputDir, 'workspace', 'index.html'), 'utf8');
  const state = readJson(path.join(outputDir, 'internal', 'workspace_state.json'));
  assert.match(index, /下一句可以说/);
  assert.ok(state.primaryAction?.label, 'workspace_state 缺少主动作');
  assert.ok(state.primaryAction?.targetPage || state.primaryAction?.href, 'workspace_state 缺少下一步页面');
}

function assetCount(outputDir, relativeDir) {
  const dir = path.join(outputDir, relativeDir);
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const visit = (currentDir) => {
    fs.readdirSync(currentDir, { withFileTypes: true }).forEach((entry) => {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        return;
      }
      if (entry.isFile()) count += 1;
    });
  };
  visit(dir);
  return count;
}

function assertPngFile(filePath) {
  const signature = fs.readFileSync(filePath).subarray(0, 8);
  assert.deepEqual(Array.from(signature), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function startMockImageProvider() {
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pS3FoAAAAAASUVORK5CYII=';
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.includes('/images/generations')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      requestCount += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: [{ b64_json: tinyPng, revised_prompt: 'mock revised prompt' }],
        model: 'gpt-image-2',
        request_body_seen: Boolean(body),
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        get requestCount() { return requestCount; },
        close: () => new Promise((done) => {
          server.closeAllConnections?.();
          server.close(done);
        }),
      });
    });
  });
}

function runScriptAsync(scriptName, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(skillRoot, 'scripts', scriptName), ...args], {
      cwd: skillRoot,
      encoding: 'utf8',
      ...options,
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

test('README leads a new user to the first run command and workbench entry', () => {
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  assert.match(readme, /node scripts\/daoge\.js prepare --task-spec task_spec\.json --output-dir out/);
  assert.match(readme, /node scripts\/daoge\.js execute --output-dir out --env-file \.env/);
  assert.match(readme, /node scripts\/daoge\.js ingest --results-file host_native_results\.json --output-dir out/);
  assert.match(readme, /node scripts\/daoge\.js open --output-dir out/);
  assert.match(readme, /普通用户只需要记住一个命令入口/);
  assert.match(readme, /out\/workspace\/index\.html`：兼容静态页面/);
  assert.match(readme, /如果宿主侧另有交接包，可以额外传/);
});

test('user path: prepare -> execute dry-run -> workspace index', () => {
  const tempDir = makeTempDir('daoge-user-dry-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);

  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'tests', 'fixtures', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
  ]);
  runScript('daoge.js', ['execute',
    '--output-dir', outputDir,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--batch-size', '1',
    '--concurrency', '1',
  ]);

  assertWorkspacePagesExist(assert, outputDir);
  assertIndexHasNextStep(outputDir);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug', 'prompts.generated.json')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'workspace', 'record.html')), true);
  assert.equal(assetCount(outputDir, 'assets/issues'), 0);
  assertUserWorkspaceClean(outputDir);
});

test('user path: prepare -> real provider small sample -> workspace results', async () => {
  const provider = await startMockImageProvider();
  const tempDir = makeTempDir('daoge-user-provider-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  fs.writeFileSync(envFile, [
    `OPENAI_BASE_URL=${provider.baseUrl}`,
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
  ].join('\n'));

  try {
    runScript('daoge.js', ['prepare',
      '--task-spec', path.join(skillRoot, 'tests', 'fixtures', 'task_spec.provider_small.json'),
      '--output-dir', outputDir,
      '--batch-size', '1',
    ]);
    await runScriptAsync('daoge.js', ['execute',
      '--output-dir', outputDir,
      '--env-file', envFile,
      '--batch-size', '1',
      '--concurrency', '1',
      '--width', '32',
      '--height', '32',
    ]);
  } finally {
    await provider.close();
  }

  assertWorkspacePagesExist(assert, outputDir);
  assertIndexHasNextStep(outputDir);
  const manifest = readJson(path.join(outputDir, 'internal', 'local_execution_raw.json'));
  assert.equal(manifest.dryRun, false);
  assert.equal(manifest.success, 1);
  assert.equal(provider.requestCount, 1);
  assert.equal(assetCount(outputDir, 'assets/results') >= 1, true);
  assertPngFile(path.join(outputDir, 'assets', 'results', fs.readdirSync(path.join(outputDir, 'assets', 'results'))[0]));
  assert.equal(assetCount(outputDir, 'assets/exports') >= 1, true);
  assert.match(fs.readFileSync(path.join(outputDir, 'workspace', 'results.html'), 'utf8'), /可筛选结果|交付候选/);
  assertUserWorkspaceClean(outputDir);
});

test('user path with reference task spec keeps reference assets usable', () => {
  const tempDir = makeTempDir('daoge-user-reference-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);

  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'tests', 'fixtures', 'task_spec.with_reference.json'),
    '--output-dir', outputDir,
    '--batch-size', '1',
  ]);
  runScript('daoge.js', ['execute',
    '--output-dir', outputDir,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--batch-size', '1',
    '--concurrency', '1',
  ]);

  const library = readJson(path.join(outputDir, 'internal', 'asset_library.json'));
  const referenceAsset = library.assets.find((asset) => asset.kind === 'reference' && asset.path.startsWith('assets/references/'));
  assert.ok(referenceAsset, '参考素材没有进入 assets/references');
  assertPngFile(path.join(outputDir, referenceAsset.path));
  const issues = readJson(path.join(outputDir, 'internal', 'issue_queue.json'));
  assert.equal(issues.summary.blocking, 0);
  assertUserWorkspaceClean(outputDir);
});

test('user path: prepare -> host native results -> ingest -> workspace index', () => {
  const tempDir = makeTempDir('daoge-user-host-');
  const outputDir = path.join(tempDir, 'out');

  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'tests', 'fixtures', 'task_spec.minimal.json'),
    '--output-dir', outputDir,
    '--batch-size', '1',
  ]);
  runScript('daoge.js', ['ingest',
    '--prompt-pack-file', path.join(skillRoot, 'tests', 'fixtures', 'host_native_prompt_pack.json'),
    '--results-file', path.join(skillRoot, 'tests', 'fixtures', 'host_native_results.mixed.json'),
    '--output-dir', outputDir,
  ]);

  assertWorkspacePagesExist(assert, outputDir);
  assertIndexHasNextStep(outputDir);
  assert.equal(assetCount(outputDir, 'assets/results') >= 1, true);
  assert.equal(assetCount(outputDir, 'assets/review') >= 1, true);
  assertPngFile(path.join(outputDir, 'assets', 'results', fs.readdirSync(path.join(outputDir, 'assets', 'results'))[0]));
  assertPngFile(path.join(outputDir, 'assets', 'review', fs.readdirSync(path.join(outputDir, 'assets', 'review'))[0]));
  assert.equal(assetCount(outputDir, 'assets/issues') >= 1, true);
  const issues = readJson(path.join(outputDir, 'internal', 'issue_queue.json'));
  assert.equal(issues.summary.blocking >= 1, true);
  assert.match(fs.readFileSync(path.join(outputDir, 'workspace', 'issues.html'), 'utf8'), /必须处理|建议确认|补跑/);
  assert.match(fs.readFileSync(path.join(outputDir, 'workspace', 'record.html'), 'utf8'), /这轮做了什么/);
  assertUserWorkspaceClean(outputDir);
});

test('missing material user path lands on issues with an actionable next step', () => {
  const tempDir = makeTempDir('daoge-user-missing-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);

  runScript('daoge.js', ['prepare',
    '--task-spec', path.join(skillRoot, 'tests', 'fixtures', 'task_spec.missing_material.json'),
    '--output-dir', outputDir,
    '--batch-size', '1',
  ]);
  runScript('daoge.js', ['execute',
    '--output-dir', outputDir,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--batch-size', '1',
    '--concurrency', '1',
  ]);

  const state = readJson(path.join(outputDir, 'internal', 'workspace_state.json'));
  const issues = readJson(path.join(outputDir, 'internal', 'issue_queue.json'));
  assert.equal(state.stage.id, 'issues');
  assert.equal(state.primaryAction.targetPage, 'issues.html');
  assert.equal(issues.summary.blocking >= 1, true);
  assert.match(fs.readFileSync(path.join(outputDir, 'workspace', 'issues.html'), 'utf8'), /先处理|必须处理|素材/);
  assertUserWorkspaceClean(outputDir);
});
