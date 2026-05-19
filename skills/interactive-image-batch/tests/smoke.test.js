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
    'daoge_portal.html',
    'completion_board.html',
    'run_overview.html',
    'rerun_board.html',
    'review_board.html',
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
    'prompt_preview.html',
    'batch_plan.json',
    'daoge_run_summary.md',
    'daoge_mode_detection.json',
    'daoge_preflight_dashboard.md',
    'preflight_board.html',
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

  const preflightBoard = fs.readFileSync(path.join(outputDir, 'preflight_board.html'), 'utf8');
  assert.match(preflightBoard, /DAOGE 预检总览/);
  assert.match(preflightBoard, /关键入口/);
  assert.match(preflightBoard, /质量门禁/);

  const promptPreviewBoard = fs.readFileSync(path.join(outputDir, 'prompt_preview.html'), 'utf8');
  assert.match(promptPreviewBoard, /DAOGE Prompt 预览/);
  assert.match(promptPreviewBoard, /批次计划/);
  assert.match(promptPreviewBoard, /Prompt 样例/);
});

test('validate_template_registry reports healthy template mainline', () => {
  const tempDir = makeTempDir('interactive-image-batch-template-registry-');
  const reportFile = path.join(tempDir, 'template_registry_validation_report.json');

  const stdout = runNode('validate_template_registry.js', [
    '--output-file', reportFile,
  ]);

  const summary = JSON.parse(stdout);
  assert.equal(summary.ok, true);
  assert.equal(fs.existsSync(reportFile), true);

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  assert.equal(report.ok, true);
  assert.ok(report.templateCount >= 10);
  assert.equal(report.errorCount, 0);

  const campaignPoster = report.templates.find((item) => item.id === 'campaign-poster');
  assert.ok(campaignPoster);
  assert.equal(campaignPoster.docExists, true);
  assert.equal(campaignPoster.missingDocSections.length, 0);
});

test('render_template_registry_report writes markdown and html reports', () => {
  const tempDir = makeTempDir('interactive-image-batch-template-report-');
  const reportFile = path.join(tempDir, 'template_registry_validation_report.json');
  const markdownFile = path.join(tempDir, 'template_registry_report.md');
  const htmlFile = path.join(tempDir, 'template_registry_report.html');

  runNode('validate_template_registry.js', [
    '--output-file', reportFile,
  ]);

  const stdout = runNode('render_template_registry_report.js', [
    '--report-file', reportFile,
    '--markdown-file', markdownFile,
    '--html-file', htmlFile,
  ]);

  const summary = JSON.parse(stdout);
  assert.equal(summary.ok, true);
  assert.equal(fs.existsSync(markdownFile), true);
  assert.equal(fs.existsSync(htmlFile), true);

  const markdown = fs.readFileSync(markdownFile, 'utf8');
  const html = fs.readFileSync(htmlFile, 'utf8');
  assert.match(markdown, /# 模板主链校验报告/);
  assert.match(markdown, /### campaign-poster/);
  assert.match(html, /模板主链校验看板/);
  assert.match(html, /campaign-poster/);
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
  const assetsBoard = fs.readFileSync(path.join(outputDir, 'assets_board.html'), 'utf8');

  assert.equal(importedBindings.reference_assets.length, 2);
  assert.equal(storyboardValidation.ok, true);
  assert.equal(storyboardValidation.generation_slots.length, 2);
  assert.equal(storyboardValidation.generation_slots[0].reference_mode, 'reference-assisted');
  assert.equal(storyboardValidation.generation_slots[1].reference_mode, 'masked-edit');
  assert.match(assetsBoard, /DAOGE 资产看板/);
  assert.match(assetsBoard, /绑定关系/);
  assert.match(assetsBoard, /资产卡片/);
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
  assert.match(html, /结果摘要/);
  assert.match(html, /分组导航/);
  assert.match(html, /总镜头/);
  assert.match(html, /失败 \/ 缺图/);
  assert.match(html, /Board ID/);
  assert.match(html, /先看哪里/);
  assert.match(html, /已有画面|暂无画面/);
  assert.match(html, /href="#slot-shot_1"/);
  assert.match(html, /id="slot-shot_1"/);
  assert.match(html, /focus-banner/);
  assert.match(html, /当前焦点/);
  assert.match(html, /is-focused/);
  assert.match(html, /applyFocusFromHash/);
  assert.match(html, /已出图|待复核|执行失败|缺图/);
});

test('render_review_board assembles html review dashboard from execution artifacts', () => {
  const tempDir = makeTempDir('interactive-image-batch-review-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const successFile = path.join(outputDir, 'success.json');
  const failedFile = path.join(outputDir, 'failed.json');
  const needsReviewFile = path.join(outputDir, 'needs_review.json');
  const rerunCandidatesFile = path.join(outputDir, 'rerun_candidates.json');
  const operationsReportFile = path.join(outputDir, 'operations_report.json');
  const reviewBoardFile = path.join(outputDir, 'review_board.html');
  const storyboardBoardFile = path.join(outputDir, 'storyboard_board.html');
  const keepImage = path.join(outputDir, 'keep.png');
  const reviewImage = path.join(outputDir, 'review.png');

  fs.writeFileSync(keepImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(reviewImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    generatedAt: new Date().toISOString(),
    success: 2,
    failed: 1,
    batches: [],
  }, null, 2));
  fs.writeFileSync(successFile, JSON.stringify([
    {
      ok: true,
      index: '001',
      slug: 'keep-item',
      title: 'Keep Item',
      output: keepImage,
      requestMode: 'prompt-only',
      slotId: 'shot_1',
      scene: 'hero reveal',
      composition: 'full-body portrait',
    },
    {
      ok: true,
      index: '002',
      slug: 'review-item',
      title: 'Review Item',
      output: reviewImage,
      requestMode: 'masked-edit',
      slotId: 'shot_2',
      revisedPrompt: 'only edit lower-right corner',
    }
  ], null, 2));
  fs.writeFileSync(failedFile, JSON.stringify([
    {
      ok: false,
      index: '003',
      slug: 'failed-item',
      title: 'Failed Item',
      error: 'provider timeout',
      requestMode: 'reference-assisted',
      slotId: 'shot_3',
    }
  ], null, 2));
  fs.writeFileSync(needsReviewFile, JSON.stringify([
    {
      ok: true,
      index: '002',
      slug: 'review-item',
      title: 'Review Item',
      output: reviewImage,
      requestMode: 'masked-edit',
      slotId: 'shot_2',
      revisedPrompt: 'only edit lower-right corner',
    }
  ], null, 2));
  fs.writeFileSync(rerunCandidatesFile, JSON.stringify([
    {
      index: '003',
      slug: 'failed-item',
      title: 'Failed Item',
      slotId: 'shot_3',
      requestMode: 'reference-assisted',
      error: 'provider timeout',
    }
  ], null, 2));
  fs.writeFileSync(operationsReportFile, JSON.stringify({
    distributions: {
      requestMode: [
        { name: 'prompt-only', count: 1 },
        { name: 'masked-edit', count: 1 }
      ]
    }
  }, null, 2));
  fs.writeFileSync(storyboardBoardFile, '<html><body><div id="slot-shot_1"></div><div id="slot-shot_2"></div></body></html>');
  fs.writeFileSync(path.join(outputDir, 'assets_board.html'), '<html><body><div id="slot-shot_1"></div></body></html>');

  runNode('render_review_board.js', [
    '--manifest-file', manifestFile,
    '--output-file', reviewBoardFile,
  ]);

  const html = fs.readFileSync(reviewBoardFile, 'utf8');
  assert.match(html, /DAOGE 结果审阅看板/);
  assert.match(html, /建议保留/);
  assert.match(html, /建议复核/);
  assert.match(html, /建议重跑/);
  assert.match(html, /平均审阅分/);
  assert.match(html, /审阅分/);
  assert.match(html, /section-summary/);
  assert.match(html, /status-legend/);
  assert.match(html, /先看哪里/);
  assert.match(html, /结果摘要/);
  assert.match(html, /状态图例/);
  assert.match(html, /分组导航/);
  assert.match(html, /处理优先级/);
  assert.match(html, /展开更多细节/);
  assert.match(html, /card-details/);
  assert.match(html, /card-notes-primary/);
  assert.match(html, /数量/);
  assert.match(html, /均分/);
  assert.match(html, /保留/);
  assert.match(html, /复核/);
  assert.match(html, /重跑/);
  assert.match(html, /需检查文案留白|局部编辑边界风险|需检查遮罩融合感/);
  assert.match(html, /id="review-search"/);
  assert.match(html, /id="review-status"/);
  assert.match(html, /id="review-mode"/);
  assert.match(html, /id="review-sort"/);
  assert.match(html, /id="review-density"/);
  assert.match(html, /审阅模式/);
  assert.match(html, /画廊模式/);
  assert.match(html, /gallery-density/);
  assert.match(html, /查看整板位置/);
  assert.match(html, /查看素材来源/);
  assert.match(html, /storyboard_board\.html#slot-shot_1/);
  assert.match(html, /assets_board\.html#slot-shot_1/);
  assert.match(html, /当前展示全部结果|当前筛选后展示/);
  assert.match(html, /addEventListener\('input', applyFilters\)/);
  assert.match(html, /Keep Item/);
  assert.match(html, /Review Item/);
  assert.match(html, /Failed Item/);
});

test('render_result_hub writes guided navigation for review and storyboard flow', () => {
  const tempDir = makeTempDir('interactive-image-batch-result-hub-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const completionReportFile = path.join(outputDir, 'daoge_completion_report.md');
  const reviewBoardFile = path.join(outputDir, 'review_board.html');
  const storyboardBoardFile = path.join(outputDir, 'storyboard_board.html');
  const selectionBoardFile = path.join(outputDir, 'selection_board.md');
  const hubFile = path.join(outputDir, 'daoge_result_hub.md');

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    success: 2,
    failed: 1,
    batchCount: 2,
    defaultSize: '1024x1024',
    paused: false,
    pauseReason: '',
    batches: [
      {
        results: [
          { ok: true, index: '001', title: 'Keep Item', output: path.join(outputDir, 'keep.png'), slotId: 'shot_1' },
          { ok: true, index: '002', title: 'Review Item', output: path.join(outputDir, 'review.png'), slotId: 'shot_2', requestMode: 'masked-edit' },
          { ok: false, index: '003', title: 'Failed Item', output: null, slotId: 'shot_3' }
        ]
      }
    ]
  }, null, 2));
  fs.writeFileSync(completionReportFile, '# completion');
  fs.writeFileSync(reviewBoardFile, '<html>review</html>');
  fs.writeFileSync(storyboardBoardFile, '<html>storyboard</html>');
  fs.writeFileSync(selectionBoardFile, '# selection');

  runNode('render_result_hub.js', [
    '--manifest-file', manifestFile,
    '--output-file', hubFile,
  ]);

  const markdown = fs.readFileSync(hubFile, 'utf8');
  assert.match(markdown, /推荐浏览顺序/);
  assert.match(markdown, /先看 HTML 审阅看板/);
  assert.match(markdown, /再看 Storyboard 装板/);
  assert.match(markdown, /入口之间怎么联动/);
  assert.match(markdown, /查看整板位置/);
  assert.match(markdown, /默认浏览路径：审阅看板 -> Storyboard 装板 -> 完成报告/);
});

test('render_result_hub_board writes html portal-style result navigation', () => {
  const tempDir = makeTempDir('interactive-image-batch-result-hub-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const hubBoardFile = path.join(outputDir, 'result_hub.html');
  const hubMarkdownFile = path.join(outputDir, 'daoge_result_hub.md');
  const completionBoardFile = path.join(outputDir, 'completion_board.html');
  const reviewBoardFile = path.join(outputDir, 'review_board.html');
  const storyboardBoardFile = path.join(outputDir, 'storyboard_board.html');
  const rerunBoardFile = path.join(outputDir, 'rerun_board.html');
  const runOverviewFile = path.join(outputDir, 'run_overview.html');

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    success: 2,
    failed: 1,
    batchCount: 2,
    defaultSize: '1024x1024',
    paused: false,
    pauseReason: '',
    batches: [
      {
        results: [
          { ok: true, index: '001', title: 'Keep Item', output: path.join(outputDir, 'keep.png'), slotId: 'shot_1' },
          { ok: true, index: '002', title: 'Review Item', output: path.join(outputDir, 'review.png'), slotId: 'shot_2', requestMode: 'masked-edit' },
          { ok: false, index: '003', title: 'Failed Item', output: null, slotId: 'shot_3' }
        ]
      }
    ]
  }, null, 2));
  fs.writeFileSync(hubMarkdownFile, '# hub');
  fs.writeFileSync(completionBoardFile, '<html>completion</html>');
  fs.writeFileSync(reviewBoardFile, '<html>review</html>');
  fs.writeFileSync(storyboardBoardFile, '<html>storyboard</html>');
  fs.writeFileSync(rerunBoardFile, '<html>rerun</html>');
  fs.writeFileSync(runOverviewFile, '<html>overview</html>');

  runNode('render_result_hub_board.js', [
    '--manifest-file', manifestFile,
    '--output-file', hubBoardFile,
  ]);

  const html = fs.readFileSync(hubBoardFile, 'utf8');
  assert.match(html, /DAOGE 结果总入口/);
  assert.match(html, /推荐浏览顺序/);
  assert.match(html, /先看审阅看板/);
  assert.match(html, /再看 Storyboard 装板/);
  assert.match(html, /看完这一页后，下一步去哪/);
  assert.match(html, /完成报告/);
  assert.match(html, /失败补跑/);
  assert.match(html, /结果总入口 Markdown/);
  assert.match(html, /当前结果状态/);
  assert.match(html, /页面生成状态/);
  assert.match(html, /推荐下一步/);
});

test('render_portal_home writes unified html portal shell', () => {
  const tempDir = makeTempDir('interactive-image-batch-portal-home-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const portalFile = path.join(outputDir, 'daoge_portal.html');
  const reviewBoardFile = path.join(outputDir, 'review_board.html');
  const storyboardBoardFile = path.join(outputDir, 'storyboard_board.html');
  const completionBoardFile = path.join(outputDir, 'completion_board.html');
  const runOverviewFile = path.join(outputDir, 'run_overview.html');
  const preflightBoardFile = path.join(outputDir, 'preflight_board.html');
  const promptPreviewBoardFile = path.join(outputDir, 'prompt_preview.html');
  const assetsBoardFile = path.join(outputDir, 'assets_board.html');
  const selectionBoardFile = path.join(outputDir, 'selection_board.md');
  const rerunBoardFile = path.join(outputDir, 'rerun_board.html');
  const examplesCatalogFile = path.join(path.dirname(outputDir), 'references', 'examples', 'examples_catalog.html');
  fs.mkdirSync(path.dirname(examplesCatalogFile), { recursive: true });

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    success: 2,
    failed: 1,
    selectedCount: 3,
    batchCount: 2,
  }, null, 2));
  fs.writeFileSync(reviewBoardFile, '<html>review</html>');
  fs.writeFileSync(storyboardBoardFile, '<html>storyboard</html>');
  fs.writeFileSync(completionBoardFile, '<html>completion</html>');
  fs.writeFileSync(runOverviewFile, '<html>run overview</html>');
  fs.writeFileSync(preflightBoardFile, '<html>preflight</html>');
  fs.writeFileSync(promptPreviewBoardFile, '<html>prompt preview</html>');
  fs.writeFileSync(assetsBoardFile, '<html>assets</html>');
  fs.writeFileSync(rerunBoardFile, '<html>rerun</html>');
  fs.writeFileSync(selectionBoardFile, '# selection');
  fs.writeFileSync(examplesCatalogFile, '<html>examples</html>');

  runNode('render_portal_home.js', [
    '--manifest-file', manifestFile,
    '--output-file', portalFile,
  ]);

  const html = fs.readFileSync(portalFile, 'utf8');
  assert.match(html, /DAOGE 用户门户/);
  assert.match(html, /推荐浏览顺序/);
  assert.match(html, /四个最常用入口/);
  assert.match(html, /Prompt 预览/);
  assert.match(html, /预检总览/);
  assert.match(html, /资产看板/);
  assert.match(html, /运行概览/);
  assert.match(html, /失败补跑看板/);
  assert.match(html, /HTML 审阅看板/);
  assert.match(html, /Storyboard 装板/);
  assert.match(html, /完成报告/);
  assert.match(html, /失败补跑入口/);
  assert.match(html, /准备阶段先看 Prompt 预览和预检总览/);
  assert.match(html, /如果你现在只想完成一件事/);
  assert.match(html, /当前任务状态/);
  assert.match(html, /页面生成状态/);
  assert.match(html, /推荐下一步/);
  assert.match(html, /示例目录/);
  assert.match(html, /如果你是第一次使用 DAOGE/);
});

test('render_example_catalog_board links back into portal navigation', () => {
  const tempDir = makeTempDir('interactive-image-batch-example-catalog-links-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const catalogFile = path.join(skillRoot, 'references', 'examples', 'examples.catalog.json');
  const outputFile = path.join(outputDir, 'examples_catalog.html');
  const portalFile = path.join(outputDir, 'daoge_portal.html');
  const resultHubFile = path.join(outputDir, 'result_hub.html');
  const promptPreviewFile = path.join(outputDir, 'prompt_preview.html');
  fs.writeFileSync(portalFile, '<html>portal</html>');
  fs.writeFileSync(resultHubFile, '<html>hub</html>');
  fs.writeFileSync(promptPreviewFile, '<html>prompt preview</html>');

  runNode('render_example_catalog_board.js', [
    '--catalog-file', catalogFile,
    '--output-file', outputFile,
  ]);

  const html = fs.readFileSync(outputFile, 'utf8');
  assert.match(html, /中文任务入口总览/);
  assert.match(html, /按任务意图开始/);
  assert.match(html, /推荐起步/);
  assert.match(html, /人物与时尚视觉/);
  assert.match(html, /电商与商业视觉/);
  assert.match(html, /信息与说明型视觉/);
  assert.match(html, /分镜与叙事/);
  assert.match(html, /界面与产品样机/);
  assert.match(html, /推荐意图入口/);
  assert.match(html, /catalog-search/);
  assert.match(html, /只看主链/);
  assert.match(html, /只看变体/);
  assert.match(html, /折叠分组/);
  assert.match(html, /查看模板细节（维护者）|查看变体细节（维护者）/);
  assert.match(html, /第一次使用优先选它|适合不想先理解模板名的人/);
  assert.match(html, /返回 DAOGE 门户/);
  assert.match(html, /返回结果总入口/);
  assert.match(html, /返回 Prompt 预览/);
});

test('render_completion_board writes html completion summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-completion-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const portalFile = path.join(outputDir, 'daoge_portal.html');
  const reviewBoardFile = path.join(outputDir, 'review_board.html');
  const storyboardBoardFile = path.join(outputDir, 'storyboard_board.html');
  const resultHubFile = path.join(outputDir, 'daoge_result_hub.md');
  const boardFile = path.join(outputDir, 'completion_board.html');

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    success: 2,
    failed: 1,
    skipped: 0,
    batchCount: 2,
    defaultSize: '1024x1024',
    model: 'gpt-image-2',
    promptSource: path.join(outputDir, 'prompts.generated.json'),
    batches: [
      {
        results: [
          { ok: true, index: '001', title: 'Keep Item', output: path.join(outputDir, 'keep.png'), slotId: 'shot_1' },
          { ok: true, index: '002', title: 'Review Item', output: path.join(outputDir, 'review.png'), slotId: 'shot_2', requestMode: 'masked-edit' },
          { ok: false, index: '003', title: 'Failed Item', error: 'provider timeout', slotId: 'shot_3' }
        ]
      }
    ]
  }, null, 2));
  fs.writeFileSync(portalFile, '<html>portal</html>');
  fs.writeFileSync(reviewBoardFile, '<html>review</html>');
  fs.writeFileSync(storyboardBoardFile, '<html>storyboard</html>');
  fs.writeFileSync(resultHubFile, '# hub');

  runNode('render_completion_board.js', [
    '--manifest-file', manifestFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /DAOGE 完成报告/);
  assert.match(html, /返回 DAOGE 门户/);
  assert.match(html, /审阅看板/);
  assert.match(html, /Storyboard 装板/);
  assert.match(html, /成功张数/);
  assert.match(html, /失败张数/);
  assert.match(html, /执行与槽位摘要/);
  assert.match(html, /样例与下一步/);
  assert.match(html, /看完完成报告后，建议这样继续/);
});

test('render_preflight_board writes html preflight summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-preflight-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const taskSpecFile = path.join(outputDir, 'task_spec.normalized.json');
  const strategyFile = path.join(outputDir, 'prompt_strategy.enriched.json');
  const promptsFile = path.join(outputDir, 'prompts.generated.json');
  const validationFile = path.join(outputDir, 'prompt_validation_report.json');
  const previewFile = path.join(outputDir, 'prompt_preview.md');
  const summaryFile = path.join(outputDir, 'daoge_run_summary.md');
  const planFile = path.join(outputDir, 'batch_plan.json');
  const modeFile = path.join(outputDir, 'daoge_mode_detection.json');
  const boardFile = path.join(outputDir, 'preflight_board.html');

  fs.writeFileSync(taskSpecFile, JSON.stringify({
    content_brief: '高端运动品牌广告海报',
    output_mode: 'prompt-only',
    total_count: 4,
    width: 1024,
    height: 1024,
    batch_size: 2,
    concurrency: 2,
    retry_count: 1,
    timeout_seconds: 300,
    output_format: 'png',
    provider: 'openai',
    require_confirmation: true,
    style_requirements: ['高级质感', '品牌海报'],
    variation_requirements: ['不同构图', '不同场景'],
    source_images: [],
  }, null, 2));
  fs.writeFileSync(strategyFile, JSON.stringify({
    template_variant: { id: 'hero-poster', name: 'Hero Poster' },
  }, null, 2));
  fs.writeFileSync(promptsFile, JSON.stringify([
    { index: '001', title: 'Poster 1', style_family: 'brand', scene: 'studio', wardrobe: 'coat', composition: 'full body' },
    { index: '002', title: 'Poster 2', style_family: 'brand', scene: 'urban', wardrobe: 'jacket', composition: 'wide shot' },
  ], null, 2));
  fs.writeFileSync(validationFile, JSON.stringify({
    ok: true,
    promptCount: 2,
    errors: [],
    warnings: [],
    missing: {},
    duplicatePromptCount: 0,
    slugCollisions: [],
    distributions: {
      style_family: [{ name: 'brand', count: 2 }],
      scene: [{ name: 'studio', count: 1 }, { name: 'urban', count: 1 }],
      wardrobe: [{ name: 'coat', count: 1 }, { name: 'jacket', count: 1 }],
      composition: [{ name: 'full body', count: 1 }, { name: 'wide shot', count: 1 }],
    },
    qualityGates: {
      strict: false,
      shortPrompts: [],
      nearDuplicatePairs: [],
      templateMissing: {},
      sizeIssues: [],
    },
  }, null, 2));
  fs.writeFileSync(previewFile, '# Prompt Preview\n');
  fs.writeFileSync(summaryFile, '# Summary\n');
  fs.writeFileSync(planFile, JSON.stringify([
    { batchNumber: 1, promptCount: 2, firstIndex: '001', lastIndex: '002' },
    { batchNumber: 2, promptCount: 2, firstIndex: '003', lastIndex: '004' },
  ], null, 2));
  fs.writeFileSync(modeFile, JSON.stringify({
    detected_mode: 'prepare-only',
    detected_template: {
      id: 'campaign-poster',
      name: 'Campaign Poster',
      template_doc: 'references/templates/poster-and-campaigns/campaign-poster.md',
    },
  }, null, 2));

  runNode('render_preflight_board.js', [
    '--task-spec', taskSpecFile,
    '--strategy-file', strategyFile,
    '--prompts-file', promptsFile,
    '--validation-report', validationFile,
    '--preview-file', previewFile,
    '--plan-file', planFile,
    '--summary-file', summaryFile,
    '--mode-file', modeFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /DAOGE 预检总览/);
  assert.match(html, /任务定义/);
  assert.match(html, /执行参数/);
  assert.match(html, /质量门禁/);
  assert.match(html, /关键入口/);
});

test('render_prompt_preview_board writes html prompt summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-prompt-preview-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const promptsFile = path.join(outputDir, 'prompts.generated.json');
  const planFile = path.join(outputDir, 'batch_plan.json');
  const summaryFile = path.join(outputDir, 'daoge_run_summary.md');
  const markdownFile = path.join(outputDir, 'prompt_preview.md');
  const preflightBoardFile = path.join(outputDir, 'preflight_board.html');
  const boardFile = path.join(outputDir, 'prompt_preview.html');

  fs.writeFileSync(promptsFile, JSON.stringify([
    {
      index: '001',
      title: 'Poster 1',
      style_family: 'brand',
      purity_grade: 'hero',
      scene: 'studio',
      wardrobe: 'coat',
      composition: 'full body',
      prompt: 'Photoreal studio poster with premium fashion styling',
    },
    {
      index: '002',
      title: 'Poster 2',
      style_family: 'brand',
      purity_grade: 'hero',
      scene: 'urban',
      wardrobe: 'jacket',
      composition: 'wide shot',
      prompt: 'Photoreal urban poster with cinematic framing',
    }
  ], null, 2));
  fs.writeFileSync(planFile, JSON.stringify([
    { batchNumber: 1, promptCount: 2, firstIndex: '001', lastIndex: '002' }
  ], null, 2));
  fs.writeFileSync(summaryFile, '# summary');
  fs.writeFileSync(markdownFile, '# prompt preview');
  fs.writeFileSync(preflightBoardFile, '<html>preflight</html>');

  runNode('render_prompt_preview_board.js', [
    '--prompts-file', promptsFile,
    '--plan-file', planFile,
    '--summary-file', summaryFile,
    '--markdown-file', markdownFile,
    '--preview-count', '2',
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /DAOGE Prompt 预览/);
  assert.match(html, /分布概览/);
  assert.match(html, /批次计划/);
  assert.match(html, /Prompt 样例/);
  assert.match(html, /返回预检总览/);
});

test('render_assets_board writes html asset summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-assets-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const bindingsFile = path.join(outputDir, 'reference_bindings.imported.json');
  const analysisFile = path.join(outputDir, 'reference_asset_analysis.json');
  const assetImage = path.join(outputDir, 'shot_1-ref_01.png');
  const maskImage = path.join(outputDir, 'shot_2-mask_01.png');
  const boardFile = path.join(outputDir, 'assets_board.html');
  const preflightBoardFile = path.join(outputDir, 'preflight_board.html');
  const promptPreviewBoardFile = path.join(outputDir, 'prompt_preview.html');

  fs.writeFileSync(assetImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(maskImage, Buffer.from(tinyPngBase64(), 'base64'));
  fs.writeFileSync(preflightBoardFile, '<html>preflight</html>');
  fs.writeFileSync(promptPreviewBoardFile, '<html>prompt preview</html>');

  fs.writeFileSync(bindingsFile, JSON.stringify({
    reference_assets: [
      { asset_id: 'ref_01', path: 'shot_1-ref_01.png', asset_type: 'reference', label: '主参考图', notes: '桌面上传' },
      { asset_id: 'mask_01', path: 'shot_2-mask_01.png', asset_type: 'mask', label: '局部遮罩', notes: '右下角' },
    ],
    slot_assignments: [
      { slot_id: 'shot_1', asset_ids: ['ref_01'], mask_asset_ids: [], reference_mode: 'reference-assisted' },
      { slot_id: 'shot_2', asset_ids: [], mask_asset_ids: ['mask_01'], reference_mode: 'masked-edit' },
    ],
  }, null, 2));

  fs.writeFileSync(analysisFile, JSON.stringify({
    naturalLanguageBindings: {
      explicitAssignments: [
        { asset_index: 0, slot_id: 'shot_1', type: 'reference' },
        { asset_index: 1, slot_id: 'shot_2', type: 'mask' },
      ],
    },
    visionAnalysis: {
      enabled: true,
      reason: 'mocked',
    },
    ruleAssignments: [
      {
        path: assetImage,
        inferred_slot_id: 'shot_1',
        inferred_type: 'reference',
        inference: { reason: 'filename-slot-match' },
        vision_recommendation: { slot_id: 'shot_1', type: 'reference', confidence: 0.93 },
      },
      {
        path: maskImage,
        inferred_slot_id: 'shot_2',
        inferred_type: 'mask',
        inference: { reason: 'filename-slot-match' },
        vision_recommendation: { slot_id: 'shot_2', type: 'mask', confidence: 0.95 },
      },
    ],
  }, null, 2));

  runNode('render_assets_board.js', [
    '--bindings-file', bindingsFile,
    '--analysis-file', analysisFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /DAOGE 资产看板/);
  assert.match(html, /当前阶段/);
  assert.match(html, /素材阶段/);
  assert.match(html, /流程位置/);
  assert.match(html, /绑定关系/);
  assert.match(html, /资产卡片/);
  assert.match(html, /主参考图/);
  assert.match(html, /局部遮罩/);
  assert.match(html, /id="slot-shot_1"/);
  assert.match(html, /href="#asset-ref_01"/);
  assert.match(html, /href="#asset-mask_01"/);
});

test('render_run_overview writes html run summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-run-overview-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const operationsReportFile = path.join(outputDir, 'operations_report.json');
  const reviewBoardFile = path.join(outputDir, 'review_board.html');
  const completionBoardFile = path.join(outputDir, 'completion_board.html');
  const selectionBoardFile = path.join(outputDir, 'selection_board.md');
  const boardFile = path.join(outputDir, 'run_overview.html');

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    generatedAt: '2026-05-18T10:00:00.000Z',
    success: 2,
    failed: 1,
    batchCount: 2,
    batchSize: 1,
    model: 'gpt-image-2',
    defaultSize: '1024x1024',
    paused: false,
    dryRun: false,
    batches: [
      {
        batchNumber: 1,
        success: 1,
        failed: 0,
        results: [
          { ok: true, skipped: false, requestMode: 'prompt-only', styleFamily: 'brand', slotRole: 'hero' },
        ],
      },
      {
        batchNumber: 2,
        success: 1,
        failed: 1,
        results: [
          { ok: true, skipped: false, requestMode: 'masked-edit', styleFamily: 'brand', slotRole: 'detail' },
          { ok: false, skipped: false, requestMode: 'masked-edit', styleFamily: 'brand', slotRole: 'detail' },
        ],
      },
    ],
  }, null, 2));

  fs.writeFileSync(operationsReportFile, JSON.stringify({
    distributions: {
      requestMode: [{ name: 'prompt-only', count: 1 }, { name: 'masked-edit', count: 1 }],
      styleFamily: [{ name: 'brand', count: 2 }],
      slotRole: [{ name: 'hero', count: 1 }, { name: 'detail', count: 1 }],
    },
  }, null, 2));
  fs.writeFileSync(reviewBoardFile, '<html>review</html>');
  fs.writeFileSync(completionBoardFile, '<html>completion</html>');
  fs.writeFileSync(selectionBoardFile, '# selection');

  runNode('render_run_overview.js', [
    '--manifest-file', manifestFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /DAOGE 运行概览/);
  assert.match(html, /当前 Run/);
  assert.match(html, /执行阶段/);
  assert.match(html, /流程位置/);
  assert.match(html, /run-timeline/);
  assert.match(html, /准备/);
  assert.match(html, /预检/);
  assert.match(html, /执行/);
  assert.match(html, /审阅/);
  assert.match(html, /补跑/);
  assert.match(html, /运行参数/);
  assert.match(html, /批次与分布/);
  assert.match(html, /关键入口/);
  assert.match(html, /Request Mode 分布/);
});

test('render_rerun_board writes html rerun summary', () => {
  const tempDir = makeTempDir('interactive-image-batch-rerun-board-');
  const outputDir = path.join(tempDir, 'out');
  fs.mkdirSync(outputDir, { recursive: true });

  const manifestFile = path.join(outputDir, 'manifest.json');
  const failedFile = path.join(outputDir, 'failed.json');
  const needsReviewFile = path.join(outputDir, 'needs_review.json');
  const rerunCandidatesFile = path.join(outputDir, 'rerun_candidates.json');
  const runOverviewFile = path.join(outputDir, 'run_overview.html');
  const reviewBoardFile = path.join(outputDir, 'review_board.html');
  const completionBoardFile = path.join(outputDir, 'completion_board.html');
  const selectionBoardFile = path.join(outputDir, 'selection_board.md');
  const boardFile = path.join(outputDir, 'rerun_board.html');

  fs.writeFileSync(manifestFile, JSON.stringify({
    outputDir,
    promptSource: path.join(outputDir, 'prompts.generated.json'),
    failed: 1,
    success: 2,
  }, null, 2));
  fs.writeFileSync(failedFile, JSON.stringify([
    { index: '003', slug: 'failed-item', title: 'Failed Item', slotId: 'shot_3', requestMode: 'reference-assisted', error: 'provider timeout' }
  ], null, 2));
  fs.writeFileSync(needsReviewFile, JSON.stringify([
    { index: '002', slug: 'review-item', title: 'Review Item', slotId: 'shot_2', requestMode: 'masked-edit', revisedPrompt: 'only edit lower-right corner' }
  ], null, 2));
  fs.writeFileSync(rerunCandidatesFile, JSON.stringify([
    { index: '003', slug: 'failed-item', title: 'Failed Item', slotId: 'shot_3', requestMode: 'reference-assisted', error: 'provider timeout' }
  ], null, 2));
  fs.writeFileSync(runOverviewFile, '<html>run overview</html>');
  fs.writeFileSync(reviewBoardFile, '<html>review</html>');
  fs.writeFileSync(completionBoardFile, '<html>completion</html>');
  fs.writeFileSync(selectionBoardFile, '# selection');

  runNode('render_rerun_board.js', [
    '--manifest-file', manifestFile,
    '--output-file', boardFile,
  ]);

  const html = fs.readFileSync(boardFile, 'utf8');
  assert.match(html, /DAOGE 失败补跑看板/);
  assert.match(html, /失败项/);
  assert.match(html, /待复核项/);
  assert.match(html, /推荐命令/);
  assert.match(html, /provider timeout/);
});

test('analyze_review_results writes visual review analysis against mock responses provider', async () => {
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
                    items: [
                      {
                        output: JSON.parse(payload.input[0].content.find((item) => item.type === 'input_text' && /"output":/.test(item.text)).text).output,
                        verdict: 'review',
                        confidence: 0.91,
                        score: 74,
                        risk_tags: ['视觉检测：需检查遮罩融合感'],
                        reason: 'lower-right edit boundary is slightly visible',
                        next_action: '保留当前图作为方向，但建议局部再修一版',
                      }
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
    const tempDir = makeTempDir('interactive-image-batch-visual-review-');
    const outputDir = path.join(tempDir, 'out');
    const successFile = path.join(outputDir, 'success.json');
    const envFile = path.join(tempDir, '.env');
    const outputImage = path.join(outputDir, 'result.png');
    const analysisFile = path.join(outputDir, 'review_analysis.json');

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputImage, Buffer.from(tinyPngBase64(), 'base64'));
    fs.writeFileSync(successFile, JSON.stringify([
      {
        ok: true,
        index: '001',
        title: 'Visual Review Target',
        output: outputImage,
        requestMode: 'masked-edit',
        slotId: 'shot_2',
        scene: 'gift box close-up',
        composition: 'tight product crop',
      }
    ], null, 2));
    fs.writeFileSync(envFile, [
      `OPENAI_BASE_URL=${baseUrl}/v1`,
      'OPENAI_API_KEY=test-key',
      'OPENAI_RESPONSES_MODEL=gpt-5.4',
    ].join('\n'));

    await runNodeAsync('analyze_review_results.js', [
      '--success-file', successFile,
      '--output-file', analysisFile,
      '--env-file', envFile,
      '--max-items', '1',
    ]);

    const analysis = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
    assert.equal(analysis.enabled, true);
    assert.equal(analysis.items.length, 1);
    assert.equal(analysis.items[0].verdict, 'review');
    assert.equal(analysis.items[0].score, 74);
    assert.equal(analysis.items[0].risk_tags[0], '视觉检测：需检查遮罩融合感');
  });
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

test('run_example_catalog_prepare can run third-wave lookbook variants from widened catalog', () => {
  const tempDir = makeTempDir('interactive-image-batch-example-catalog-lookbook-wave3-');
  const cases = [
    { exampleId: 'lookbook-editorial-pairing-lookbook', variant: 'editorial-pairing-lookbook' },
    { exampleId: 'lookbook-detail-mix', variant: 'lookbook-detail-mix' },
  ];

  cases.forEach((item) => {
    const outputDir = path.join(tempDir, item.exampleId);
    const runStdout = runNode('run_example_catalog_prepare.js', [
      '--example-id', item.exampleId,
      '--output-dir', outputDir,
    ]);
    const summary = JSON.parse(runStdout);
    assert.equal(summary.selectedExample.id, item.exampleId);
    assert.equal(summary.selectedExample.template_variant, item.variant);
    assert.equal(fs.existsSync(summary.preflightBoard), true);
    assert.equal(fs.existsSync(summary.promptPreviewBoard), true);
  });
});

test('run_example_catalog_prepare can resolve second-wave oral storyboard starter intents', () => {
  const tempDir = makeTempDir('interactive-image-batch-oral-storyboard-wave2-intents-');
  const cases = [
    { intent: 'expertboard', exampleId: 'oral-storyboard-board-expert-led', variant: 'expert-led' },
    { intent: 'testimonialboard', exampleId: 'oral-storyboard-board-testimonial-led', variant: 'testimonial-led' },
  ];

  cases.forEach((item) => {
    const outputDir = path.join(tempDir, item.intent);
    const runStdout = runNode('run_example_catalog_prepare.js', [
      '--intent', item.intent,
      '--output-dir', outputDir,
    ]);
    const summary = JSON.parse(runStdout);
    assert.equal(summary.selectedExample.id, item.exampleId);
    assert.equal(summary.selectedExample.template_variant, item.variant);
    assert.equal(fs.existsSync(summary.preflightBoard), true);
    assert.equal(fs.existsSync(summary.promptPreviewBoard), true);
  });
});

test('run_example_catalog_prepare can run third-wave portrait-fashion variants from widened catalog', () => {
  const tempDir = makeTempDir('interactive-image-batch-portrait-fashion-wave3-');
  const cases = [
    { exampleId: 'portrait-kv-emotion-contrast-kv', variant: 'emotion-contrast-kv' },
    { exampleId: 'portrait-kv-product-linked-portrait-kv', variant: 'product-linked-portrait-kv' },
    { exampleId: 'studio-editorial-couture-minimal-studio', variant: 'couture-minimal-studio' },
    { exampleId: 'studio-editorial-gesture-sequence-studio', variant: 'gesture-sequence-studio' },
  ];

  cases.forEach((item) => {
    const outputDir = path.join(tempDir, item.exampleId);
    const runStdout = runNode('run_example_catalog_prepare.js', [
      '--example-id', item.exampleId,
      '--output-dir', outputDir,
    ]);
    const summary = JSON.parse(runStdout);
    assert.equal(summary.selectedExample.id, item.exampleId);
    assert.equal(summary.selectedExample.template_variant, item.variant);
    assert.equal(fs.existsSync(summary.preflightBoard), true);
    assert.equal(fs.existsSync(summary.promptPreviewBoard), true);
  });
});

test('run_example_catalog_prepare can run fourth-wave portrait-fashion variants from widened catalog', () => {
  const tempDir = makeTempDir('interactive-image-batch-portrait-fashion-wave4-');
  const cases = [
    { exampleId: 'portrait-kv-headline-safe-portrait-kv', variant: 'headline-safe-portrait-kv', templateId: 'portrait-kv' },
    { exampleId: 'portrait-kv-profile-silhouette-kv', variant: 'profile-silhouette-kv', templateId: 'portrait-kv' },
    { exampleId: 'studio-editorial-sharp-tailoring-studio', variant: 'sharp-tailoring-studio', templateId: 'studio-editorial' },
    { exampleId: 'studio-editorial-beauty-detail-studio', variant: 'beauty-detail-studio', templateId: 'studio-editorial' },
  ];

  cases.forEach((item) => {
    const outputDir = path.join(tempDir, item.exampleId);
    const runStdout = runNode('run_example_catalog_prepare.js', [
      '--example-id', item.exampleId,
      '--output-dir', outputDir,
    ]);
    const summary = JSON.parse(runStdout);
    assert.equal(summary.selectedExample.id, item.exampleId);
    assert.equal(summary.selectedExample.template_variant, item.variant);
    assert.equal(fs.existsSync(summary.preflightBoard), true);
    assert.equal(fs.existsSync(summary.promptPreviewBoard), true);
    const modeDetection = JSON.parse(fs.readFileSync(summary.modeDetection, 'utf8'));
    assert.equal(modeDetection.detected_template.id, item.templateId);
    const promptValidation = JSON.parse(fs.readFileSync(path.join(summary.prepareOutputDir, 'prompt_validation_report.json'), 'utf8'));
    assert.equal(promptValidation.duplicatePromptCount, 0);
    assert.deepEqual(promptValidation.warnings || [], []);
    assert.equal(promptValidation.qualityGates.ok, true);
  });
});
