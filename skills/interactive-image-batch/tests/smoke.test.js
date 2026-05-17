const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const http = require('http');

const skillRoot = path.resolve(__dirname, '..');
const scriptsDir = path.join(skillRoot, 'scripts');
const fixturesDir = path.join(__dirname, 'fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runNode(scriptName, args, options = {}) {
  return execFileSync(process.execPath, [path.join(scriptsDir, scriptName), ...args], {
    cwd: path.resolve(skillRoot, '..', '..'),
    encoding: 'utf8',
    ...options,
  });
}

function runNodeAsync(scriptName, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(scriptsDir, scriptName), ...args], {
      cwd: path.resolve(skillRoot, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`child exited with code ${code}: ${stderr || stdout}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

async function withMockImageServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function writeMockEnv(envFile, baseUrl) {
  fs.writeFileSync(envFile, [
    `OPENAI_BASE_URL=${baseUrl}/v1`,
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
    'OPENAI_RESPONSES_MODEL=gpt-5.4',
  ].join('\n'));
}

function tinyPngBase64() {
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pS3FoAAAAAASUVORK5CYII=';
}

test('run_batch dry-run produces expected artifacts', () => {
  const tempDir = makeTempDir('interactive-image-batch-runner-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.writeFileSync(envFile, [
    'OPENAI_BASE_URL=https://example.com/v1',
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
  ].join('\n'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

  const stdout = runNode('run_batch.js', [
    '--prompts-file', promptsFile,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
  ]);

  assert.match(stdout, /\[dry-run\]/);
  [
    'README.md',
    'manifest.json',
    'batch_plan.json',
    'stage_plan.json',
    'job_state.json',
    'checkpoint.json',
    'selection_board.md',
    'operations_report.json',
    'contact_sheet_index.md',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), true, `missing ${name}`);
  });

  const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.dryRun, true);
  assert.equal(manifest.selectedCount, 2);
  assert.equal(manifest.batchCount, 2);
});

test('daoge_prepare_run preflight pipeline succeeds on minimal fixture', () => {
  const tempDir = makeTempDir('interactive-image-batch-prepare-');
  const outputDir = path.join(tempDir, 'out');
  const taskSpec = path.join(tempDir, 'task_spec.json');
  const strategyFile = path.join(tempDir, 'prompt_strategy.json');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');

  fs.writeFileSync(taskSpec, readFixture('task_spec.minimal.json'));
  fs.writeFileSync(strategyFile, readFixture('prompt_strategy.minimal.json'));
  fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

  runNode('daoge_prepare_run.js', [
    '--task-spec', taskSpec,
    '--strategy-file', strategyFile,
    '--prompts-file', promptsFile,
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--preview-count', '2',
  ]);

  [
    'task_spec.normalized.json',
    'prompt_strategy.normalized.json',
    'prompt_strategy.enriched.json',
    'prompt_slots.json',
    'prompt_draft_bundle.json',
    'prompt_validation_report.json',
    'prompt_preview.md',
    'batch_plan.json',
    'daoge_run_summary.md',
    'daoge_mode_detection.json',
    'daoge_preflight_dashboard.md',
  ].forEach((name) => {
    assert.equal(fs.existsSync(path.join(outputDir, name)), true, `missing ${name}`);
  });

  const validation = JSON.parse(fs.readFileSync(path.join(outputDir, 'prompt_validation_report.json'), 'utf8'));
  assert.equal(validation.ok, true);

  const modeDetection = JSON.parse(fs.readFileSync(path.join(outputDir, 'daoge_mode_detection.json'), 'utf8'));
  assert.equal(modeDetection.detected_mode, 'prepare-only');
  assert.equal(modeDetection.detected_template.id, 'campaign-poster');

  const preflight = fs.readFileSync(path.join(outputDir, 'daoge_preflight_dashboard.md'), 'utf8');
  assert.match(preflight, /绿灯|可以直接开跑/i);
});

test('run_batch executes prompt-only against mock images provider', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        assert.equal(payload.model, 'gpt-image-2');
        assert.equal(payload.size, '1440x2560');
        assert.equal(payload.output_format, 'png');
        assert.match(payload.prompt, /Photoreal/i);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          created: Date.now(),
          data: [{ b64_json: tinyPngBase64(), revised_prompt: 'mock revised prompt' }],
          model: 'gpt-image-2',
          size: '1440x2560',
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-exec-images-');
    const outputDir = path.join(tempDir, 'out');
    const envFile = path.join(tempDir, '.env');
    const promptsFile = path.join(tempDir, 'prompts.generated.json');

    writeMockEnv(envFile, baseUrl);
    fs.writeFileSync(promptsFile, readFixture('prompts.minimal.json'));

    const { stdout } = await runNodeAsync('run_batch.js', [
      '--prompts-file', promptsFile,
      '--env-file', envFile,
      '--output-dir', outputDir,
      '--batch-size', '1',
      '--concurrency', '1',
      '--contact-sheet', 'false',
    ]);

    assert.match(stdout, /\[done\]/);

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.success, 2);
    assert.equal(manifest.failed, 0);

    const success = JSON.parse(fs.readFileSync(path.join(outputDir, 'success.json'), 'utf8'));
    assert.equal(success.length, 2);
    success.forEach((item) => {
      assert.equal(fs.existsSync(item.output), true);
      assert.equal(item.responseModel, 'gpt-image-2');
    });
  });
});

test('run_batch executes reference-assisted against mock edits provider', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/edits') {
      req.on('data', () => {});
      req.on('end', () => {
        const contentType = req.headers['content-type'] || '';
        assert.match(String(contentType), /multipart\/form-data/i);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          created: Date.now(),
          data: [{ b64_json: tinyPngBase64(), revised_prompt: 'mock edit revised prompt' }],
          model: 'gpt-image-2',
          size: '1440x2560',
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-exec-edits-');
    const outputDir = path.join(tempDir, 'out');
    const envFile = path.join(tempDir, '.env');
    const promptsFile = path.join(tempDir, 'prompts.generated.json');
    const refImage = path.join(tempDir, 'ref.png');

    writeMockEnv(envFile, baseUrl);
    fs.writeFileSync(refImage, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(promptsFile, JSON.stringify([
      {
        index: 1,
        slug: 'reference-assisted-test',
        title: 'Reference Assisted Test',
        style_family: 'hero-fashion',
        scene: 'studio backdrop',
        wardrobe: 'tailored black suit',
        lighting: 'soft premium studio light',
        mood: 'controlled luxury',
        composition: 'full-body vertical poster',
        text_policy: 'leave top and bottom clean for later typography',
        reference_mode: 'reference-assisted',
        reference_images: [refImage],
        generation_prompt: 'Photoreal reference-assisted campaign poster with premium studio lighting.',
      },
    ], null, 2));

    const { stdout } = await runNodeAsync('run_batch.js', [
      '--prompts-file', promptsFile,
      '--env-file', envFile,
      '--output-dir', outputDir,
      '--batch-size', '1',
      '--concurrency', '1',
      '--contact-sheet', 'false',
    ]);

    assert.match(stdout, /\[done\]/);

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.success, 1);
    assert.equal(manifest.failed, 0);

    const success = JSON.parse(fs.readFileSync(path.join(outputDir, 'success.json'), 'utf8'));
    assert.equal(success.length, 1);
    assert.equal(success[0].requestMode, 'reference-assisted');
    assert.equal(fs.existsSync(success[0].output), true);
  });
});

test('run_batch executes masked-edit against mock edits provider', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/edits') {
      req.on('data', () => {});
      req.on('end', () => {
        const contentType = req.headers['content-type'] || '';
        assert.match(String(contentType), /multipart\/form-data/i);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          created: Date.now(),
          data: [{ b64_json: tinyPngBase64(), revised_prompt: 'mock masked edit revised prompt' }],
          model: 'gpt-image-2',
          size: '1440x2560',
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-exec-masked-');
    const outputDir = path.join(tempDir, 'out');
    const envFile = path.join(tempDir, '.env');
    const promptsFile = path.join(tempDir, 'prompts.generated.json');
    const refImage = path.join(tempDir, 'ref.png');
    const maskImage = path.join(tempDir, 'mask.png');

    writeMockEnv(envFile, baseUrl);
    fs.writeFileSync(refImage, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(maskImage, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(promptsFile, JSON.stringify([
      {
        index: 1,
        slug: 'masked-edit-test',
        title: 'Masked Edit Test',
        style_family: 'hero-fashion',
        scene: 'studio backdrop',
        wardrobe: 'tailored black suit',
        lighting: 'soft premium studio light',
        mood: 'controlled luxury',
        composition: 'full-body vertical poster',
        text_policy: 'leave top and bottom clean for later typography',
        reference_mode: 'masked-edit',
        reference_images: [refImage],
        mask_image: maskImage,
        generation_prompt: 'Photoreal masked local edit for a premium campaign poster.',
      },
    ], null, 2));

    const { stdout } = await runNodeAsync('run_batch.js', [
      '--prompts-file', promptsFile,
      '--env-file', envFile,
      '--output-dir', outputDir,
      '--batch-size', '1',
      '--concurrency', '1',
      '--contact-sheet', 'false',
    ]);

    assert.match(stdout, /\[done\]/);

    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.success, 1);
    assert.equal(manifest.failed, 0);

    const success = JSON.parse(fs.readFileSync(path.join(outputDir, 'success.json'), 'utf8'));
    assert.equal(success.length, 1);
    assert.equal(success[0].requestMode, 'masked-edit');
    assert.equal(fs.existsSync(success[0].output), true);
    assert.equal(path.resolve(success[0].maskImage), path.resolve(maskImage));
  });
});

test('run_batch preserves storyboard slot metadata in execution outputs', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        assert.match(payload.prompt, /storyboard/i);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          created: Date.now(),
          data: [{ b64_json: tinyPngBase64(), revised_prompt: 'mock storyboard revised prompt' }],
          model: 'gpt-image-2',
          size: '1440x2560',
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-storyboard-');
    const outputDir = path.join(tempDir, 'out');
    const envFile = path.join(tempDir, '.env');
    const promptsFile = path.join(tempDir, 'prompts.generated.json');

    writeMockEnv(envFile, baseUrl);
    fs.writeFileSync(promptsFile, JSON.stringify([
      {
        index: 1,
        slug: 'storyboard-shot-1',
        title: 'Storyboard Shot 1',
        board_id: 'board_alpha',
        slot_id: 'shot_001',
        slot_role: 'hero',
        shot_id: 'shot_001',
        shot_label: 'Opening Hero',
        layout_region_id: 'region_a',
        timecode: '00:00-00:03',
        camera_move: 'slow push-in',
        continuity_notes: ['keep same wardrobe and hair silhouette'],
        generation_prompt: 'Storyboard hero shot, premium opening frame, controlled cinematic poster language.',
      },
    ], null, 2));

    const { stdout } = await runNodeAsync('run_batch.js', [
      '--prompts-file', promptsFile,
      '--env-file', envFile,
      '--output-dir', outputDir,
      '--batch-size', '1',
      '--concurrency', '1',
      '--contact-sheet', 'false',
    ]);

    assert.match(stdout, /\[done\]/);

    const success = JSON.parse(fs.readFileSync(path.join(outputDir, 'success.json'), 'utf8'));
    assert.equal(success.length, 1);
    assert.equal(success[0].boardId, 'board_alpha');
    assert.equal(success[0].slotId, 'shot_001');
    assert.equal(success[0].slotRole, 'hero');
    assert.equal(success[0].shotId, 'shot_001');
    assert.equal(success[0].shotLabel, 'Opening Hero');
    assert.equal(success[0].layoutRegionId, 'region_a');
    assert.equal(success[0].timecode, '00:00-00:03');
    assert.equal(success[0].cameraMove, 'slow push-in');
    assert.deepEqual(success[0].continuityNotes, ['keep same wardrobe and hair silhouette']);
  });
});
