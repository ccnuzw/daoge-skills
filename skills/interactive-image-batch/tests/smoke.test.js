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

function writeStoryboardFixtures(tempDir) {
  const taskSpec = path.join(tempDir, 'task_spec.storyboard.json');
  const layoutManifest = path.join(tempDir, 'layout_manifest.storyboard.json');
  const contentManifest = path.join(tempDir, 'content_manifest.storyboard.json');
  const renderConfig = path.join(tempDir, 'render_config.storyboard.json');
  fs.writeFileSync(taskSpec, readFixture('storyboard_task_spec.minimal.json'));
  fs.writeFileSync(layoutManifest, readFixture('layout_manifest.storyboard.json'));
  fs.writeFileSync(contentManifest, readFixture('content_manifest.storyboard.json'));
  fs.writeFileSync(renderConfig, readFixture('render_config.storyboard.json'));
  return { taskSpec, layoutManifest, contentManifest, renderConfig };
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

test('import_reference_assets organizes files and generates storyboard bindings', () => {
  const tempDir = makeTempDir('interactive-image-batch-import-assets-');
  const outputDir = path.join(tempDir, 'out');
  const { taskSpec } = writeStoryboardFixtures(tempDir);
  const refImage = path.join(tempDir, 'desktop-upload-ref.png');
  const maskImage = path.join(tempDir, 'desktop-upload-mask.png');

  fs.writeFileSync(refImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(maskImage, Buffer.from(tinyPngBase64(), 'base64'));

  runNode('import_reference_assets.js', [
    '--task-spec', taskSpec,
    '--output-dir', outputDir,
    '--references', refImage,
    '--masks', maskImage,
    '--slot-order', 'shot_1,shot_2',
  ]);

  const bindings = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_bindings.imported.json'), 'utf8'));
  const updatedTaskSpec = JSON.parse(fs.readFileSync(path.join(outputDir, 'task_spec.with_imported_assets.json'), 'utf8'));

  assert.equal(bindings.reference_assets.length, 2);
  assert.equal(bindings.slot_assignments.length, 2);
  assert.equal(bindings.slot_assignments[0].slot_id, 'shot_1');
  assert.equal(bindings.slot_assignments[0].reference_mode, 'reference-assisted');
  assert.equal(bindings.slot_assignments[0].asset_ids.length, 1);
  assert.equal(bindings.slot_assignments[1].slot_id, 'shot_2');
  assert.equal(bindings.slot_assignments[1].reference_mode, 'masked-edit');
  assert.equal(bindings.slot_assignments[1].mask_asset_ids.length, 1);
  assert.equal(fs.existsSync(path.join(outputDir, bindings.reference_assets[0].path)), true);
  assert.equal(fs.existsSync(path.join(outputDir, bindings.reference_assets[1].path)), true);
  assert.equal(path.resolve(updatedTaskSpec.storyboard_plan.reference_bindings), path.resolve(path.join(outputDir, 'reference_bindings.imported.json')));
});

test('import_reference_assets can infer mask and slot from filenames by rules', () => {
  const tempDir = makeTempDir('interactive-image-batch-import-rules-');
  const outputDir = path.join(tempDir, 'out');
  const { taskSpec } = writeStoryboardFixtures(tempDir);
  const refImage = path.join(tempDir, 'shot_1-product-reference.png');
  const maskImage = path.join(tempDir, 'shot_2-local-mask.png');

  fs.writeFileSync(refImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(maskImage, Buffer.from(tinyPngBase64(), 'base64'));

  runNode('import_reference_assets.js', [
    '--task-spec', taskSpec,
    '--output-dir', outputDir,
    '--references', `${refImage},${maskImage}`,
  ]);

  const analysis = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_asset_analysis.json'), 'utf8'));
  const bindings = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_bindings.imported.json'), 'utf8'));

  assert.equal(analysis.ruleAssignments.length, 2);
  assert.equal(analysis.ruleAssignments[0].inference.strategy, 'rules');
  assert.equal(analysis.ruleAssignments[0].inferred_slot_id, 'shot_1');
  assert.equal(analysis.ruleAssignments[1].inferred_type, 'mask');
  assert.equal(analysis.ruleAssignments[1].inferred_slot_id, 'shot_2');
  assert.equal(bindings.slot_assignments.length, 2);
  assert.equal(bindings.slot_assignments[1].reference_mode, 'masked-edit');
});

test('import_reference_assets can parse natural language binding instructions', () => {
  const tempDir = makeTempDir('interactive-image-batch-import-nl-');
  const outputDir = path.join(tempDir, 'out');
  const { taskSpec } = writeStoryboardFixtures(tempDir);
  const firstImage = path.join(tempDir, 'desktop_upload_01.png');
  const secondImage = path.join(tempDir, 'desktop_upload_02.png');
  const thirdImage = path.join(tempDir, 'desktop_upload_03.png');

  fs.writeFileSync(firstImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(secondImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(thirdImage, Buffer.from(tinyPngBase64(), 'base64'));

  runNode('import_reference_assets.js', [
    '--task-spec', taskSpec,
    '--output-dir', outputDir,
    '--references', `${firstImage},${secondImage},${thirdImage}`,
    '--slot-order', 'shot_1,shot_2',
    '--binding-text', '前两张按上传顺序对应 shot_1、shot_2，最后一张是 shot_2 的遮罩图',
  ]);

  const analysis = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_asset_analysis.json'), 'utf8'));
  const bindings = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_bindings.imported.json'), 'utf8'));

  assert.deepEqual(analysis.naturalLanguageBindings.slotOrder, ['shot_1', 'shot_2']);
  assert.equal(analysis.naturalLanguageBindings.maskIndexes[0], 2);
  assert.equal(bindings.slot_assignments.length, 2);
  assert.equal(bindings.slot_assignments[0].slot_id, 'shot_1');
  assert.equal(bindings.slot_assignments[0].reference_mode, 'reference-assisted');
  assert.equal(bindings.slot_assignments[1].slot_id, 'shot_2');
  assert.equal(bindings.slot_assignments[1].reference_mode, 'masked-edit');
});

test('daoge_prepare_run can import storyboard assets before preflight', () => {
  const tempDir = makeTempDir('interactive-image-batch-prepare-import-');
  const outputDir = path.join(tempDir, 'out');
  const { taskSpec } = writeStoryboardFixtures(tempDir);
  const strategyFile = path.join(tempDir, 'prompt_strategy.json');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');
  const assetsManifest = path.join(tempDir, 'assets_manifest.json');
  const refImage = path.join(tempDir, 'desktop-upload-ref.png');
  const maskImage = path.join(tempDir, 'desktop-upload-mask.png');

  fs.writeFileSync(strategyFile, readFixture('prompt_strategy.minimal.json'));
  fs.writeFileSync(promptsFile, JSON.stringify([
    {
      index: 1,
      slug: 'storyboard-shot-1',
      slot_id: 'shot_1',
      generation_prompt: 'Storyboard shot one prompt.'
    },
    {
      index: 2,
      slug: 'storyboard-shot-2',
      slot_id: 'shot_2',
      generation_prompt: 'Storyboard shot two prompt.'
    }
  ], null, 2));
  fs.writeFileSync(refImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(maskImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(assetsManifest, JSON.stringify({
    reference_assets: [
      { path: refImage, slot_id: 'shot_1', label: '桌面上传参考图' }
    ],
    mask_assets: [
      { path: maskImage, slot_id: 'shot_2', label: '桌面上传遮罩图', notes: '只改右下角' }
    ]
  }, null, 2));

  runNode('daoge_prepare_run.js', [
    '--task-spec', taskSpec,
    '--strategy-file', strategyFile,
    '--prompts-file', promptsFile,
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--preview-count', '2',
    '--import-reference-assets', 'true',
    '--assets-manifest', assetsManifest,
  ]);

  const importedBindings = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_bindings.imported.json'), 'utf8'));
  const storyboardValidation = JSON.parse(fs.readFileSync(path.join(outputDir, 'storyboard_bundle.validation.json'), 'utf8'));

  assert.equal(importedBindings.reference_assets.length, 2);
  assert.equal(storyboardValidation.ok, true);
  assert.equal(storyboardValidation.generation_slots.length, 2);
  assert.equal(storyboardValidation.generation_slots[0].reference_mode, 'reference-assisted');
  assert.equal(storyboardValidation.generation_slots[1].reference_mode, 'masked-edit');
});

test('import_reference_assets can apply vision recommendations when enabled', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/responses') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        assert.equal(payload.model, 'gpt-5.4');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    recommendations: [
                      {
                        asset_path: payload.input[0].content.find((item) => item.type === 'input_text' && /asset_path=/.test(item.text)).text.match(/asset_path=(.+)/)[1].trim(),
                        recommended_slot_id: 'shot_2',
                        recommended_type: 'mask',
                        confidence: 0.93,
                        reason: 'transparent local edit area in lower-right corner',
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-import-vision-');
    const outputDir = path.join(tempDir, 'out');
    const { taskSpec } = writeStoryboardFixtures(tempDir);
    const envFile = path.join(tempDir, '.env');
    const visualAsset = path.join(tempDir, 'desktop-visual.png');

    fs.writeFileSync(visualAsset, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(envFile, [
      `OPENAI_BASE_URL=${baseUrl}/v1`,
      'OPENAI_API_KEY=test-key',
      'OPENAI_RESPONSES_MODEL=gpt-5.4',
    ].join('\n'));

    await runNodeAsync('import_reference_assets.js', [
      '--task-spec', taskSpec,
      '--output-dir', outputDir,
      '--references', visualAsset,
      '--enable-vision-analysis', 'true',
      '--env-file', envFile,
    ]);

    const analysis = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_asset_analysis.json'), 'utf8'));
    const bindings = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_bindings.imported.json'), 'utf8'));
    assert.equal(analysis.visionAnalysis.enabled, true);
    assert.equal(analysis.ruleAssignments[0].vision_recommendation.slot_id, 'shot_2');
    assert.equal(analysis.ruleAssignments[0].vision_recommendation.type, 'mask');
    assert.equal(bindings.slot_assignments[0].slot_id, 'shot_2');
    assert.equal(bindings.slot_assignments[0].reference_mode, 'masked-edit');
  });
});

test('daoge_prepare_run can pass natural language binding instructions into asset import', () => {
  const tempDir = makeTempDir('interactive-image-batch-prepare-nl-');
  const outputDir = path.join(tempDir, 'out');
  const { taskSpec } = writeStoryboardFixtures(tempDir);
  const strategyFile = path.join(tempDir, 'prompt_strategy.json');
  const promptsFile = path.join(tempDir, 'prompts.generated.json');
  const firstImage = path.join(tempDir, 'desktop_upload_01.png');
  const secondImage = path.join(tempDir, 'desktop_upload_02.png');

  fs.writeFileSync(strategyFile, readFixture('prompt_strategy.minimal.json'));
  fs.writeFileSync(promptsFile, JSON.stringify([
    {
      index: 1,
      slug: 'storyboard-shot-1',
      slot_id: 'shot_1',
      generation_prompt: 'Storyboard shot one prompt.'
    },
    {
      index: 2,
      slug: 'storyboard-shot-2',
      slot_id: 'shot_2',
      generation_prompt: 'Storyboard shot two prompt.'
    }
  ], null, 2));
  fs.writeFileSync(firstImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(secondImage, Buffer.from(tinyPngBase64(), 'base64'));

  runNode('daoge_prepare_run.js', [
    '--task-spec', taskSpec,
    '--strategy-file', strategyFile,
    '--prompts-file', promptsFile,
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--preview-count', '2',
    '--import-reference-assets', 'true',
    '--references', `${firstImage},${secondImage}`,
    '--slot-order', 'shot_1,shot_2',
    '--binding-text', '第一张给 shot_1，最后一张是 shot_2 的遮罩图',
  ]);

  const analysis = JSON.parse(fs.readFileSync(path.join(outputDir, 'reference_asset_analysis.json'), 'utf8'));
  const storyboardValidation = JSON.parse(fs.readFileSync(path.join(outputDir, 'storyboard_bundle.validation.json'), 'utf8'));
  const bindingConfirmation = fs.readFileSync(path.join(outputDir, 'binding_confirmation.md'), 'utf8');
  const bindingConversationCard = fs.readFileSync(path.join(outputDir, 'binding_conversation_card.md'), 'utf8');
  assert.equal(analysis.naturalLanguageBindings.explicitAssignments.length, 2);
  assert.equal(storyboardValidation.ok, true);
  assert.equal(storyboardValidation.generation_slots[0].reference_mode, 'reference-assisted');
  assert.equal(storyboardValidation.generation_slots[1].reference_mode, 'masked-edit');
  assert.match(bindingConfirmation, /第 1 张 -> shot_1/);
  assert.match(bindingConfirmation, /第 2 张 -> shot_2/);
  assert.match(bindingConversationCard, /DAOGE 绑定会话卡/);
  assert.match(bindingConversationCard, /确认，继续 prepare/);
});

test('plan_binding_from_draft converts llm draft into binding plan', () => {
  const tempDir = makeTempDir('interactive-image-batch-binding-plan-');
  const draftFile = path.join(tempDir, 'binding_intent_draft.json');
  const outputFile = path.join(tempDir, 'binding_plan.json');
  const firstImage = path.join(tempDir, 'desktop_upload_01.png');
  const secondImage = path.join(tempDir, 'desktop_upload_02.png');

  fs.writeFileSync(firstImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(secondImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(draftFile, JSON.stringify({
    binding_text: '第一张给 shot_1，最后一张是 shot_2 的遮罩图',
    draft: {
      slot_order: ['shot_1', 'shot_2'],
      asset_intents: [
        { asset_index: 0, target_slot_id: 'shot_1', intended_type: 'reference', confidence: 0.92, reason: 'first image is main reference' },
        { asset_index: 1, target_slot_id: 'shot_2', intended_type: 'mask', confidence: 0.95, reason: 'last image described as mask' }
      ],
      prompt_only_slots: [],
      unresolved_questions: [],
      summary: '图1给 shot_1，图2作为 shot_2 的遮罩图'
    }
  }, null, 2));

  runNode('plan_binding_from_draft.js', [
    '--draft-file', draftFile,
    '--output-file', outputFile,
    '--references', `${firstImage},${secondImage}`,
  ]);

  const plan = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  assert.equal(plan.reference_assets.length, 1);
  assert.equal(plan.mask_assets.length, 1);
  assert.equal(plan.reference_assets[0].slot_id, 'shot_1');
  assert.equal(plan.mask_assets[0].slot_id, 'shot_2');
});

test('daoge_prepare_run can use llm binding planner before asset import', async () => {
  await withMockImageServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/responses') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        const payload = JSON.parse(body);
        assert.equal(payload.model, 'gpt-5.4');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    slot_order: ['shot_1', 'shot_2'],
                    asset_intents: [
                      { asset_index: 0, target_slot_id: 'shot_1', intended_type: 'reference', confidence: 0.91, reason: '用户明确说第一张给 shot_1' },
                      { asset_index: 1, target_slot_id: 'shot_2', intended_type: 'mask', confidence: 0.95, reason: '用户明确说最后一张是 shot_2 的遮罩图' }
                    ],
                    prompt_only_slots: [],
                    unresolved_questions: [],
                    summary: '第一张给 shot_1，第二张作为 shot_2 的遮罩图',
                  }),
                },
              ],
            },
          ],
        }));
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }, async (baseUrl) => {
    const tempDir = makeTempDir('interactive-image-batch-prepare-llm-bind-');
    const outputDir = path.join(tempDir, 'out');
    const { taskSpec } = writeStoryboardFixtures(tempDir);
    const strategyFile = path.join(tempDir, 'prompt_strategy.json');
    const promptsFile = path.join(tempDir, 'prompts.generated.json');
    const envFile = path.join(tempDir, '.env');
    const firstImage = path.join(tempDir, 'desktop_upload_01.png');
    const secondImage = path.join(tempDir, 'desktop_upload_02.png');

    fs.writeFileSync(strategyFile, readFixture('prompt_strategy.minimal.json'));
    fs.writeFileSync(promptsFile, JSON.stringify([
      { index: 1, slug: 'storyboard-shot-1', slot_id: 'shot_1', generation_prompt: 'Storyboard shot one prompt.' },
      { index: 2, slug: 'storyboard-shot-2', slot_id: 'shot_2', generation_prompt: 'Storyboard shot two prompt.' }
    ], null, 2));
    fs.writeFileSync(envFile, [
      `OPENAI_BASE_URL=${baseUrl}/v1`,
      'OPENAI_API_KEY=test-key',
      'OPENAI_RESPONSES_MODEL=gpt-5.4',
    ].join('\n'));
    fs.writeFileSync(firstImage, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(secondImage, Buffer.from(tinyPngBase64(), 'base64'));

    await runNodeAsync('daoge_prepare_run.js', [
      '--task-spec', taskSpec,
      '--strategy-file', strategyFile,
      '--prompts-file', promptsFile,
      '--output-dir', outputDir,
      '--batch-size', '1',
      '--preview-count', '2',
      '--import-reference-assets', 'true',
      '--use-llm-binding-planner', 'true',
      '--references', `${firstImage},${secondImage}`,
      '--slot-order', 'shot_1,shot_2',
      '--binding-text', '第一张给 shot_1，最后一张是 shot_2 的遮罩图',
      '--env-file', envFile,
    ]);

    const draft = JSON.parse(fs.readFileSync(path.join(outputDir, 'binding_intent_draft.json'), 'utf8'));
    const plan = JSON.parse(fs.readFileSync(path.join(outputDir, 'binding_plan.json'), 'utf8'));
    const storyboardValidation = JSON.parse(fs.readFileSync(path.join(outputDir, 'storyboard_bundle.validation.json'), 'utf8'));
    const bindingConfirmation = fs.readFileSync(path.join(outputDir, 'binding_confirmation.md'), 'utf8');

    assert.equal(draft.draft.asset_intents.length, 2);
    assert.equal(plan.reference_assets.length, 1);
    assert.equal(plan.mask_assets.length, 1);
    assert.equal(storyboardValidation.ok, true);
    assert.equal(storyboardValidation.generation_slots[0].reference_mode, 'reference-assisted');
    assert.equal(storyboardValidation.generation_slots[1].reference_mode, 'masked-edit');
    assert.match(bindingConfirmation, /我理解到的绑定计划|我先按你的中文说明理解成这样/);
    assert.match(bindingConfirmation, /shot_2/);
  });
});

test('apply_binding_feedback can revise binding plan from chinese feedback', () => {
  const tempDir = makeTempDir('interactive-image-batch-binding-feedback-');
  const planFile = path.join(tempDir, 'binding_plan.json');
  const outputFile = path.join(tempDir, 'binding_plan.updated.json');

  fs.writeFileSync(planFile, JSON.stringify({
    binding_text: '第一张给 shot_1，最后一张是 shot_2 的遮罩图',
    slot_order: ['shot_1', 'shot_2'],
    reference_assets: [
      { path: '/tmp/ref_01.png', slot_id: 'shot_1', label: null, notes: 'first image', confidence: 0.9 }
    ],
    mask_assets: [
      { path: '/tmp/ref_02.png', slot_id: 'shot_2', label: null, notes: 'last image mask', confidence: 0.95 }
    ],
    prompt_only_slots: [],
    unresolved_questions: [],
    plan_assignments: [
      { asset_index: 0, path: '/tmp/ref_01.png', slot_id: 'shot_1', intended_type: 'reference', confidence: 0.9, reason: 'first image' },
      { asset_index: 1, path: '/tmp/ref_02.png', slot_id: 'shot_2', intended_type: 'mask', confidence: 0.95, reason: 'last image mask' }
    ],
    summary: '初始绑定计划'
  }, null, 2));

  runNode('apply_binding_feedback.js', [
    '--plan-file', planFile,
    '--output-file', outputFile,
    '--feedback-text', '第2张不要做遮罩图，改给 shot_1',
  ]);

  const updatedPlan = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  assert.equal(updatedPlan.reference_assets.length, 2);
  assert.equal(updatedPlan.mask_assets.length, 0);
  assert.equal(updatedPlan.reference_assets[1].slot_id, 'shot_1');
  assert.equal(updatedPlan.feedback_history.length, 1);
});

test('render_storyboard_board assembles storyboard html from validation bundle and results', () => {
  const tempDir = makeTempDir('interactive-image-batch-storyboard-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const storyboardFile = path.join(tempDir, 'storyboard_bundle.validation.json');
  const resultsFile = path.join(tempDir, 'success.json');
  const imageOne = path.join(outputDir, 'shot_1.png');
  const imageTwo = path.join(outputDir, 'shot_2.png');
  const boardFile = path.join(outputDir, 'storyboard_board.html');

  fs.writeFileSync(imageOne, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(imageTwo, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(storyboardFile, JSON.stringify({
    layout: {
      canvas: { width: 1440, height: 2560, background: '#111111' },
      regions: [
        { id: 'brand_panel', role: 'brand_panel', x: 40, y: 40, width: 300, height: 600 },
        { id: 'shot_1', role: 'shot', x: 380, y: 40, width: 500, height: 260 },
        { id: 'shot_2', role: 'shot', x: 380, y: 340, width: 500, height: 260 }
      ],
      bindings: [
        { region_id: 'brand_panel', slot_id: 'brand_panel' },
        { region_id: 'shot_1', slot_id: 'shot_1' },
        { region_id: 'shot_2', slot_id: 'shot_2' }
      ]
    },
    content: {
      board_id: 'board_demo',
      board_title: 'Demo Storyboard',
      board_theme: 'cinematic product storyboard',
      brand_panel: {
        title_lines: ['Brand', 'Storyboard']
      }
    },
    slot_blueprint: [
      { slot_id: 'shot_1', shot_label: 'Opening Shot', timecode: '0-2s', scene: 'hero reveal', slot_role: 'shot' },
      { slot_id: 'shot_2', shot_label: 'Closing Shot', timecode: '2-4s', scene: 'product close', slot_role: 'shot' }
    ]
  }, null, 2));
  fs.writeFileSync(resultsFile, JSON.stringify([
    { ok: true, slotId: 'shot_1', output: imageOne },
    { ok: true, slotId: 'shot_2', output: imageTwo }
  ], null, 2));

  runNode('render_storyboard_board.js', [
    '--storyboard-file', storyboardFile,
    '--results-file', resultsFile,
    '--output-dir', outputDir,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /Demo Storyboard/);
  assert.match(html, /Opening Shot/);
  assert.match(html, /shot_1\.png/);
  assert.match(html, /Brand/);
});

test('run_real_provider_smoke creates safe preflight report without live execution', () => {
  const tempDir = makeTempDir('interactive-image-batch-real-smoke-');
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  const reportFile = path.join(outputDir, 'real_provider_smoke_report.md');

  fs.writeFileSync(envFile, [
    'OPENAI_BASE_URL=https://example.com/v1',
    'OPENAI_API_KEY=test-key',
    'OPENAI_MODEL=gpt-image-2',
    'OPENAI_RESPONSES_MODEL=gpt-5.4',
  ].join('\n'));

  runNode('run_real_provider_smoke.js', [
    '--env-file', envFile,
    '--output-dir', outputDir,
  ]);

  const report = fs.readFileSync(reportFile, 'utf8');
  assert.match(report, /Live run confirmed: no/);
  assert.match(report, /No live provider calls were executed/);
});
