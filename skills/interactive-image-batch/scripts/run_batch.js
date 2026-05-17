const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs } = require('./run_batch_cli');
const {
  sanitize,
  resolveProviderPathOverride,
  parseNumber,
  clampNumber,
  parseBoolean,
  slugify,
  normalizeSlug,
  ensureArray,
  ensureStringArray,
  resolveReferenceMode,
  resolveMaskImage,
  resolveReferenceImages,
  buildOperationMode,
} = require('./run_batch_shared');
const {
  supportsResponsesReferenceMode,
  supportsResponsesGenerateMode,
  requestImage,
  requestResponsesImageGenerate,
  requestImageEdit,
  requestResponsesImageEdit,
  requestWithFallback,
} = require('./run_batch_transport');
const {
  readJson,
  hasExplicitSelectionArgs,
  selectResumePrompts,
  selectExplicitPrompts,
  applyPreviousOutputReuse,
  writeRerunPlan,
} = require('./run_batch_selection');
const {
  renderCompletionReport,
  renderResultHub,
  createOperationalArtifacts,
} = require('./run_batch_artifacts');
const {
  writeJson,
  createJobState,
  writeJobState,
  writeCheckpoint,
  translatePauseReason,
  printExecutionStart,
  printBatchStart,
  printBatchSummary,
  updateStateAfterBatch,
  evaluatePausePolicy,
} = require('./run_batch_runtime');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function parseEnv(file) {
  const out = {};
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const normalizedLine = line.replace(/^\s*export\s+/, '');
    const idx = normalizedLine.indexOf('=');
    if (idx === -1) continue;
    const key = normalizedLine.slice(0, idx).trim();
    let value = normalizedLine.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }
    out[key] = value.trim();
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePromptFileForRerun(manifest, outputDir) {
  const localPromptCopy = path.join(outputDir, 'prompts.generated.json');
  if (manifest.promptSnapshot && fs.existsSync(manifest.promptSnapshot)) return manifest.promptSnapshot;
  if (fs.existsSync(localPromptCopy)) return localPromptCopy;
  return manifest.promptSource || localPromptCopy;
}

function chunkArray(items, chunkSize) {
  const out = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize));
  }
  return out;
}

function getPromptText(item) {
  return item.generation_prompt || item.prompt || '';
}

function buildSizeFromItem(item, fallbackWidth, fallbackHeight) {
  const params = item.params || {};
  if (params.size && /^\d+x\d+$/.test(params.size)) return params.size;
  const width = Math.max(16, Math.floor(parseNumber(params.width, fallbackWidth)));
  const height = Math.max(16, Math.floor(parseNumber(params.height, fallbackHeight)));
  return `${width}x${height}`;
}

function buildRequestConfig(item, ctx) {
  const params = item.params || {};
  return {
    model: params.model || ctx.model,
    size: buildSizeFromItem(item, ctx.width, ctx.height),
    outputFormat: params.output_format || ctx.outputFormat,
    timeoutMs: Math.max(1, parseNumber(params.timeout_seconds, ctx.timeoutSeconds)) * 1000,
  };
}

function buildFileParts(item, ordinal) {
  const index = String(item.index ?? ordinal).padStart(3, '0');
  const slug = slugify(item.slug || item.title || `image-${index}`);
  return { index, slug, fileBase: `${index}_${slug}` };
}

function findExistingResult(item, ctx) {
  const { index, slug, fileBase } = buildFileParts(item, ctx.ordinal);
  const req = buildRequestConfig(item, ctx);
  const outputPath = path.join(ctx.outDir, `${fileBase}_${req.size}.${req.outputFormat}`);
  const metaPath = path.join(ctx.outDir, `${fileBase}.json`);
  if (!fs.existsSync(outputPath) || !fs.existsSync(metaPath)) return null;
  try {
    const meta = readJson(metaPath);
    return {
      ok: true,
      skipped: true,
      ...meta,
      index,
      slug,
      output: outputPath,
      requestedSize: req.size,
    };
  } catch {
    return null;
  }
}

async function generateOne(item, ctx) {
  const existing = ctx.skipExisting ? findExistingResult(item, ctx) : null;
  if (existing) {
    console.log(`[skip] ${existing.index}_${existing.slug} existing output`);
    return existing;
  }
  const { index, slug, fileBase } = buildFileParts(item, ctx.ordinal);
  const prompt = getPromptText(item);
  if (!prompt.trim()) {
    throw new Error(`Prompt item ${index} is missing prompt/generation_prompt`);
  }

  const req = buildRequestConfig(item, ctx);
  const operation = buildOperationMode(item);
  const outputPath = path.join(ctx.outDir, `${fileBase}_${req.size}.${req.outputFormat}`);
  const metaPath = path.join(ctx.outDir, `${fileBase}.json`);

  for (let attempt = 1; attempt <= ctx.maxAttempts; attempt += 1) {
    console.log(`[start] ${fileBase} attempt ${attempt}`);
    const startedAt = new Date().toISOString();
    try {
      let result;
      if (operation.mode === 'prompt-only') {
        result = supportsResponsesGenerateMode(ctx.generatePath)
          ? await requestWithFallback({
            fileBase,
            label: 'responses prompt-only',
            primary: () => requestResponsesImageGenerate({
              baseUrl: ctx.baseUrl,
              apiKey: ctx.apiKey,
              toolModel: req.model,
              responsesModel: ctx.responsesModel,
              prompt,
              size: req.size,
              outputFormat: req.outputFormat,
              timeoutMs: req.timeoutMs,
              generatePath: ctx.generatePath,
            }),
            fallback: () => requestImage({
              baseUrl: ctx.baseUrl,
              apiKey: ctx.apiKey,
              model: req.model,
              prompt,
              size: req.size,
              outputFormat: req.outputFormat,
              timeoutMs: req.timeoutMs,
            }),
          })
          : await requestImage({
            baseUrl: ctx.baseUrl,
            apiKey: ctx.apiKey,
            model: req.model,
            prompt,
            size: req.size,
            outputFormat: req.outputFormat,
            timeoutMs: req.timeoutMs,
          });
      } else if (supportsResponsesReferenceMode(ctx.editPath, operation.mode)) {
        result = await requestWithFallback({
          fileBase,
          label: 'responses reference-assisted',
          primary: () => requestResponsesImageEdit({
            baseUrl: ctx.baseUrl,
            apiKey: ctx.apiKey,
            toolModel: req.model,
            responsesModel: ctx.responsesModel,
            prompt,
            size: req.size,
            outputFormat: req.outputFormat,
            timeoutMs: req.timeoutMs,
            referenceImages: operation.referenceImages,
            editPath: ctx.editPath,
          }),
          fallback: () => requestImageEdit({
            baseUrl: ctx.baseUrl,
            apiKey: ctx.apiKey,
            model: req.model,
            prompt,
            size: req.size,
            outputFormat: req.outputFormat,
            timeoutMs: req.timeoutMs,
            referenceImages: operation.referenceImages,
            maskImage: operation.maskImage,
            editPath: '',
          }),
        });
      } else {
        result = await requestImageEdit({
          baseUrl: ctx.baseUrl,
          apiKey: ctx.apiKey,
          model: req.model,
          prompt,
          size: req.size,
          outputFormat: req.outputFormat,
          timeoutMs: req.timeoutMs,
          referenceImages: operation.referenceImages,
          maskImage: operation.maskImage,
          editPath: operation.mode === 'masked-edit' ? '' : ctx.editPath,
        });
      }

      fs.writeFileSync(outputPath, Buffer.from(result.b64, 'base64'));
      const meta = {
        index,
        slug,
        title: item.title || slug,
        attempt,
        startedAt,
        finishedAt: new Date().toISOString(),
        output: outputPath,
        requestedSize: req.size,
        responseSize: result.responseSize,
        requestModel: req.model,
        responseModel: result.responseModel,
        requestMode: operation.mode,
        prompt,
        negativePrompt: item.negative_prompt || null,
        styleFamily: item.style_family || null,
        scene: item.scene || null,
        wardrobe: item.wardrobe || null,
        lighting: item.lighting || null,
        mood: item.mood || null,
        composition: item.composition || null,
        textPolicy: item.text_policy || null,
        sourceRefs: item.source_refs || [],
        boardId: item.board_id || null,
        slotId: item.slot_id || null,
        slotRole: item.slot_role || null,
        shotId: item.shot_id || null,
        shotLabel: item.shot_label || null,
        layoutRegionId: item.layout_region_id || null,
        timecode: item.timecode || null,
        referenceImages: item.reference_images || [],
        maskImage: resolveMaskImage(item),
        referenceNotes: item.reference_notes || [],
        promptHints: item.prompt_hints || [],
        continuityNotes: item.continuity_notes || [],
        editSource: item.edit_source || null,
        editSourceOutput: item.edit_source_output || null,
        voiceover: item.voiceover || null,
        music: item.music || null,
        soundEffects: item.sound_effects || null,
        cameraMove: item.camera_move || null,
        notes: item.notes || null,
        revisedPrompt: result.revisedPrompt,
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      console.log(`[ok] ${fileBase} -> ${path.basename(outputPath)}`);
      return { ok: true, ...meta };
    } catch (error) {
      const message = sanitize(error?.message || error);
      console.log(`[fail] ${fileBase} attempt ${attempt}: ${message}`);
      if (attempt < ctx.maxAttempts) {
        await sleep(2500);
        continue;
      }
      const meta = {
        index,
        slug,
        title: item.title || slug,
        attempt,
        finishedAt: new Date().toISOString(),
        output: null,
        requestedSize: req.size,
        requestModel: req.model,
        requestMode: operation.mode,
        prompt,
        negativePrompt: item.negative_prompt || null,
        styleFamily: item.style_family || null,
        scene: item.scene || null,
        wardrobe: item.wardrobe || null,
        lighting: item.lighting || null,
        mood: item.mood || null,
        composition: item.composition || null,
        textPolicy: item.text_policy || null,
        sourceRefs: item.source_refs || [],
        boardId: item.board_id || null,
        slotId: item.slot_id || null,
        slotRole: item.slot_role || null,
        shotId: item.shot_id || null,
        shotLabel: item.shot_label || null,
        layoutRegionId: item.layout_region_id || null,
        timecode: item.timecode || null,
        referenceImages: item.reference_images || [],
        maskImage: resolveMaskImage(item),
        referenceNotes: item.reference_notes || [],
        promptHints: item.prompt_hints || [],
        continuityNotes: item.continuity_notes || [],
        editSource: item.edit_source || null,
        editSourceOutput: item.edit_source_output || null,
        voiceover: item.voiceover || null,
        music: item.music || null,
        soundEffects: item.sound_effects || null,
        cameraMove: item.camera_move || null,
        notes: item.notes || null,
        error: message,
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      return { ok: false, ...meta };
    }
  }
}

async function runPool(items, workerCount, handler) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      results[current] = await handler(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function buildContactSheet(outDir, successfulFiles) {
  if (!successfulFiles.length) return false;
  if (!successfulFiles.every((file) => fs.existsSync(file))) return false;
  const ffmpeg = execFileSync('bash', ['-lc', 'command -v ffmpeg >/dev/null && echo yes || echo no'], { encoding: 'utf8' }).trim();
  if (ffmpeg !== 'yes') return false;

  const sample = successfulFiles.slice(0, 20);
  const tempDir = path.join(outDir, '_contact_tmp');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempInputPattern = path.join(tempDir, '%02d.png');
  sample.forEach((file, index) => {
    execFileSync('ffmpeg', [
      '-y',
      '-i', file,
      path.join(tempDir, `${String(index + 1).padStart(2, '0')}.png`),
    ], { stdio: 'ignore' });
  });

  const cols = sample.length > 10 ? 4 : 2;
  const rows = Math.ceil(sample.length / cols);
  const output = path.join(outDir, 'contact_sheet.png');
  try {
    execFileSync('ffmpeg', [
      '-y',
      '-framerate', '1',
      '-i', tempInputPattern,
      '-frames:v', '1',
      '-vf', `scale=240:426:force_original_aspect_ratio=decrease,pad=240:426:(ow-iw)/2:(oh-ih)/2:white,tile=${cols}x${rows}:padding=12:margin=12:color=white`,
      output,
    ], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function summarizeBatchItems(items, batchNumber, offsetBase) {
  return {
    batchNumber,
    promptCount: items.length,
    firstIndex: items[0]?.index ?? offsetBase + 1,
    lastIndex: items[items.length - 1]?.index ?? offsetBase + items.length,
    offsetBase,
  };
}

function buildExecutionPlan(selectedPrompts, batchSize, stageSize, sampleSize) {
  const stages = [];
  const allBatches = [];
  let batchNumber = 1;

  function appendStage(type, items, stagePromptOffset) {
    if (!items.length) return;
    const stageNumber = stages.length + 1;
    const chunks = chunkArray(items, batchSize);
    const batches = chunks.map((chunk, chunkIndex) => {
      const offsetBase = stagePromptOffset + chunkIndex * batchSize;
      const summary = summarizeBatchItems(chunk, batchNumber, offsetBase);
      const plannedBatch = { ...summary, items: chunk, stageNumber, stageType: type };
      batchNumber += 1;
      allBatches.push(plannedBatch);
      return summary;
    });
    stages.push({
      stageNumber,
      type,
      promptCount: items.length,
      batchCount: batches.length,
      batches,
    });
  }

  const normalizedSampleSize = Math.max(0, Math.min(sampleSize, selectedPrompts.length));
  let cursor = 0;
  if (normalizedSampleSize > 0) {
    appendStage('sample', selectedPrompts.slice(0, normalizedSampleSize), 0);
    cursor = normalizedSampleSize;
  }

  const remaining = selectedPrompts.slice(cursor);
  if (remaining.length) {
    const effectiveStageSize = stageSize > 0 ? stageSize : remaining.length;
    for (let i = 0; i < remaining.length; i += effectiveStageSize) {
      appendStage('production', remaining.slice(i, i + effectiveStageSize), cursor + i);
    }
  }

  return {
    totalPrompts: selectedPrompts.length,
    batchSize,
    stageSize: stageSize > 0 ? stageSize : null,
    sampleSize: normalizedSampleSize,
    stageCount: stages.length,
    batchCount: allBatches.length,
    stages,
    batches: allBatches,
  };
}

function publicExecutionPlan(plan) {
  return {
    totalPrompts: plan.totalPrompts,
    batchSize: plan.batchSize,
    stageSize: plan.stageSize,
    sampleSize: plan.sampleSize,
    stageCount: plan.stageCount,
    batchCount: plan.batchCount,
    stages: plan.stages,
  };
}

async function runBatch(batchItems, batchContext) {
  const batchDir = path.join(batchContext.rootOutputDir, `batch_${String(batchContext.batchNumber).padStart(3, '0')}`);
  fs.mkdirSync(batchDir, { recursive: true });
  fs.writeFileSync(path.join(batchDir, 'prompts.generated.json'), JSON.stringify(batchItems, null, 2));

  console.log(`[batch] ${batchContext.batchNumber}/${batchContext.totalBatches} -> ${batchDir}`);
  const results = await runPool(batchItems, batchContext.concurrency, (item, index) => generateOne(item, {
    outDir: batchDir,
    baseUrl: batchContext.baseUrl,
    apiKey: batchContext.apiKey,
    model: batchContext.model,
    responsesModel: batchContext.responsesModel,
    generatePath: batchContext.generatePath,
    editPath: batchContext.editPath,
    width: batchContext.width,
    height: batchContext.height,
    outputFormat: batchContext.outputFormat,
    timeoutSeconds: batchContext.timeoutSeconds,
    maxAttempts: batchContext.retryCount + 1,
    ordinal: batchContext.offsetBase + index + 1,
    skipExisting: batchContext.skipExisting,
  }));

  const manifest = {
    batchNumber: batchContext.batchNumber,
    totalBatches: batchContext.totalBatches,
    outputDir: batchDir,
    promptCount: batchItems.length,
    success: results.filter((item) => item.ok && !item.skipped).length,
    failed: results.filter((item) => !item.ok).length,
    skipped: results.filter((item) => item.skipped).length,
    results,
  };
  fs.writeFileSync(path.join(batchDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { batchDir, manifest };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['prompts-file']) throw new Error('Missing required flag: --prompts-file');

  const cwd = process.cwd();
  const envFile = path.resolve(args['env-file'] || path.join(cwd, '.env'));
  const env = parseEnv(envFile);
  if (!env.OPENAI_BASE_URL || !env.OPENAI_API_KEY) {
    throw new Error(`Missing OPENAI_BASE_URL or OPENAI_API_KEY in ${envFile}`);
  }
  const generatePathOverride = args['generate-path'] || env.OPENAI_IMAGE_GENERATE_PATH || '';
  const editPathOverride = args['edit-path'] || env.OPENAI_IMAGE_EDIT_PATH || '';
  const responsesModel = args['responses-model'] || env.OPENAI_RESPONSES_MODEL || 'gpt-5.4';

  const promptsFile = path.resolve(args['prompts-file']);
  const promptPool = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
  if (!Array.isArray(promptPool)) throw new Error(`Prompt file must be a JSON array: ${promptsFile}`);
  const resumeManifest = args['resume-manifest'] ? path.resolve(args['resume-manifest']) : null;
  const explicitSelection = hasExplicitSelectionArgs(args);
  const failedOnlyDefault = resumeManifest ? !explicitSelection : false;
  const failedOnly = parseBoolean(args['failed-only'], failedOnlyDefault);
  const reuseOutputAsReference = parseBoolean(args['reuse-output-as-reference'], false);
  const resumePool = selectResumePrompts(promptPool, resumeManifest, failedOnly);
  const explicitPool = selectExplicitPrompts(resumePool, args);
  const preparedPool = applyPreviousOutputReuse(explicitPool, resumeManifest, reuseOutputAsReference);

  const width = Math.max(16, Math.floor(parseNumber(args.width, 1440)));
  const height = Math.max(16, Math.floor(parseNumber(args.height, 2560)));
  const outputFormat = args['output-format'] || 'png';
  const timeoutSeconds = Math.max(1, parseNumber(args['timeout-seconds'], 450));
  const retryCount = Math.max(0, Math.floor(parseNumber(args['retry-count'], 1)));
  const concurrency = clampNumber(Math.floor(parseNumber(args.concurrency, 3)), 1, 12);
  const offset = Math.max(0, Math.floor(parseNumber(args.offset, 0)));
  const limit = Math.max(0, Math.floor(parseNumber(args.limit, preparedPool.length - offset)));
  const selectedPrompts = preparedPool.slice(offset, offset + limit);
  if (!selectedPrompts.length) throw new Error('No prompts selected after applying offset/limit');

  const batchSize = Math.max(1, Math.floor(parseNumber(args['batch-size'], selectedPrompts.length)));
  const stageSize = Math.max(0, Math.floor(parseNumber(args['stage-size'], 0)));
  const sampleSize = Math.max(0, Math.floor(parseNumber(args['sample-size'], 0)));
  const stopAfterSample = parseBoolean(args['stop-after-sample'], false);
  const pausePolicy = {
    enabled: parseBoolean(args['auto-pause'], true),
    maxConsecutiveFailures: Math.max(0, Math.floor(parseNumber(args['max-consecutive-failures'], 0))),
    maxBatchFailureRate: parseNumber(args['max-batch-failure-rate'], 1.1),
  };
  const contactSheet = parseBoolean(args['contact-sheet'], true);
  const dryRun = parseBoolean(args['dry-run'], false);
  const skipExisting = parseBoolean(args['skip-existing'], false);
  const runLabel = args['run-label'] ? slugify(args['run-label']) : `run_${stamp()}`;
  const outputDir = path.resolve(args['output-dir'] || path.join(cwd, 'generated_images', runLabel));
  fs.mkdirSync(outputDir, { recursive: true });

  const promptsCopyPath = path.join(outputDir, 'prompts.generated.json');
  fs.writeFileSync(promptsCopyPath, JSON.stringify(selectedPrompts, null, 2));
  const rerunPlanPath = writeRerunPlan(outputDir, resumeManifest, selectedPrompts);

  const executionPlan = buildExecutionPlan(selectedPrompts, batchSize, stageSize, sampleSize);
  const batches = executionPlan.batches;
  const batchPlan = batches.map(({ items, ...batch }) => batch);
  fs.writeFileSync(path.join(outputDir, 'batch_plan.json'), JSON.stringify(batchPlan, null, 2));
  fs.writeFileSync(path.join(outputDir, 'stage_plan.json'), JSON.stringify(publicExecutionPlan(executionPlan), null, 2));

  const jobState = createJobState(outputDir, {
    promptsFile,
    selectedCount: selectedPrompts.length,
    batchSize,
    stageSize,
    sampleSize: executionPlan.sampleSize,
    concurrency,
    retryCount,
    timeoutSeconds,
    pausePolicy,
  }, executionPlan);
  writeJobState(outputDir, jobState);
  writeCheckpoint(outputDir, jobState);

  console.log(`[info] output dir: ${outputDir}`);
  console.log(`[info] prompts: ${selectedPrompts.length}, stages: ${executionPlan.stageCount}, batches: ${batches.length}, batch size: ${batchSize}, concurrency: ${concurrency}, default size: ${width}x${height}, timeout per image: ${timeoutSeconds}s, retry: ${retryCount}`);
  console.log(`[info] prompt source: ${promptsFile}`);
  if (generatePathOverride) console.log(`[info] generate path override: ${generatePathOverride}`);
  if (editPathOverride) console.log(`[info] edit path override: ${editPathOverride}`);
  if (resumeManifest) console.log(`[info] resume manifest: ${resumeManifest}, failed only: ${failedOnly}`);
  if (explicitSelection) console.log('[info] explicit slot/index selection detected; defaulting failed-only to false unless explicitly overridden');
  if (reuseOutputAsReference) console.log('[info] previous successful outputs will be reused as edit references for selected prompts');
  if (dryRun) {
    const manifest = {
      outputDir,
      promptSource: promptsCopyPath,
      promptSourceOriginal: promptsFile,
      promptSnapshot: promptsCopyPath,
      resumeManifest,
      failedOnly,
      rerunPlan: rerunPlanPath,
      selectedCount: selectedPrompts.length,
      offset,
      limit,
      batchSize,
      stageSize: stageSize || null,
      sampleSize: executionPlan.sampleSize,
      stageCount: executionPlan.stageCount,
      batchCount: batches.length,
      model: env.OPENAI_MODEL || 'gpt-image-2',
      defaultSize: `${width}x${height}`,
      generatedAt: new Date().toISOString(),
      dryRun: true,
      skipExisting,
      jobState: path.join(outputDir, 'job_state.json'),
      checkpoint: path.join(outputDir, 'checkpoint.json'),
      stagePlan: path.join(outputDir, 'stage_plan.json'),
      success: 0,
      failed: 0,
      skipped: 0,
      batches: batchPlan.map((batch) => ({
        ...batch,
        outputDir: null,
        success: 0,
        failed: 0,
        skipped: 0,
        results: [],
      })),
    };
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const artifacts = createOperationalArtifacts(outputDir, manifest, [], { readJson, writeJson });
    fs.writeFileSync(path.join(outputDir, 'README.md'), [
      '# Interactive image batch dry run',
      '',
      `- Output dir: ${outputDir}`,
      `- Prompt source: ${promptsFile}`,
      `- Prompt snapshot: ${promptsCopyPath}`,
      `- Prompt count: ${selectedPrompts.length}`,
      `- Batch size: ${batchSize}`,
      `- Batch count: ${batches.length}`,
      `- Stage count: ${executionPlan.stageCount}`,
      `- Sample size: ${executionPlan.sampleSize}`,
      `- Resume manifest: ${resumeManifest || 'none'}`,
      `- Failed only: ${failedOnly}`,
      `- Rerun plan: ${rerunPlanPath || 'none'}`,
      `- Selection board: ${artifacts.selection.selectionBoard}`,
      `- Operations report: ${artifacts.operations.reportMd}`,
      `- Run index: ${artifacts.runIndex.indexMd}`,
    ].join('\n'));
    console.log('[dry-run]');
    console.log(JSON.stringify({ outputDir, selectedCount: selectedPrompts.length, batchCount: batches.length, rerunPlan: rerunPlanPath }, null, 2));
    return;
  }

  const batchResults = [];
  const allResults = [];
  let paused = false;
  let pauseReason = null;
  jobState.status = 'running';
  writeJobState(outputDir, jobState);
  printExecutionStart({
    selectedCount: selectedPrompts.length,
    stageCount: executionPlan.stageCount,
    batchCount: batches.length,
    width,
    height,
    concurrency,
    timeoutSeconds,
    retryCount,
    outputDir,
  });

  for (let i = 0; i < batches.length; i += 1) {
    const plannedBatch = batches[i];
    jobState.progress.currentStage = plannedBatch.stageNumber;
    jobState.progress.currentBatch = plannedBatch.batchNumber;
    writeJobState(outputDir, jobState);
    printBatchStart(plannedBatch, batches.length);

    const batchResult = await runBatch(plannedBatch.items, {
      rootOutputDir: outputDir,
      batchNumber: plannedBatch.batchNumber,
      totalBatches: batches.length,
      concurrency,
      baseUrl: env.OPENAI_BASE_URL,
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || 'gpt-image-2',
      responsesModel,
      generatePath: generatePathOverride,
      editPath: editPathOverride,
      width,
      height,
      outputFormat,
      timeoutSeconds,
      retryCount,
      skipExisting,
      offsetBase: offset + plannedBatch.offsetBase,
    });
    batchResults.push(batchResult);
    allResults.push(...(batchResult.manifest.results || []));
    updateStateAfterBatch(jobState, batchResult.manifest);
    writeJobState(outputDir, jobState);
    writeCheckpoint(outputDir, jobState, batchResult.manifest);
    printBatchSummary(plannedBatch, batchResult.manifest, jobState);

    pauseReason = evaluatePausePolicy(batchResult.manifest, allResults, pausePolicy);
    if (!pauseReason && stopAfterSample && plannedBatch.stageType === 'sample') {
      const nextBatch = batches[i + 1];
      if (!nextBatch || nextBatch.stageType !== 'sample') pauseReason = 'sample_stage_completed_review_required';
    }
    if (pauseReason) {
      paused = true;
      jobState.status = 'paused';
      jobState.pauseReason = pauseReason;
      writeJobState(outputDir, jobState);
      writeCheckpoint(outputDir, jobState, batchResult.manifest);
      console.log('DAOGE 状态：已暂停，等待处理');
      console.log(`[DAOGE][自动暂停] ${translatePauseReason(pauseReason)}`);
      console.log(`[pause] ${pauseReason}`);
      break;
    }
  }

  const successfulFiles = allResults.filter((item) => item.ok && item.output).map((item) => item.output);
  if (contactSheet && successfulFiles.length) buildContactSheet(outputDir, successfulFiles);

  const manifest = {
    outputDir,
    promptSource: promptsCopyPath,
    promptSourceOriginal: promptsFile,
    promptSnapshot: promptsCopyPath,
    resumeManifest,
    failedOnly,
    rerunPlan: rerunPlanPath,
    selectedCount: selectedPrompts.length,
    offset,
    limit,
    batchSize,
    stageSize: stageSize || null,
    sampleSize: executionPlan.sampleSize,
    stageCount: executionPlan.stageCount,
    batchCount: batches.length,
    model: env.OPENAI_MODEL || 'gpt-image-2',
    defaultSize: `${width}x${height}`,
    generatedAt: new Date().toISOString(),
    skipExisting,
    paused,
    pauseReason,
    jobState: path.join(outputDir, 'job_state.json'),
    checkpoint: path.join(outputDir, 'checkpoint.json'),
    stagePlan: path.join(outputDir, 'stage_plan.json'),
    success: allResults.filter((item) => item.ok && !item.skipped).length,
    skipped: allResults.filter((item) => item.skipped).length,
    failed: allResults.filter((item) => !item.ok).length,
    batches: batchResults.map((item) => item.manifest),
  };
  if (!paused) {
    jobState.status = 'completed';
    jobState.pauseReason = null;
    writeJobState(outputDir, jobState);
    writeCheckpoint(outputDir, jobState);
  }
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const artifacts = createOperationalArtifacts(outputDir, manifest, allResults, { readJson, writeJson });
  let completionReportPath = renderCompletionReport(outputDir);
  const resultHubPath = renderResultHub(outputDir);

  const readme = [
    '# DAOGE Run Output',
    '',
    `- DAOGE 结果总入口: ${resultHubPath}`,
    `- DAOGE completion report: ${completionReportPath}`,
    `- Output dir: ${outputDir}`,
    `- Prompt source: ${promptsFile}`,
    `- Success: ${manifest.success}`,
    `- Failed: ${manifest.failed}`,
    `- Skipped existing: ${allResults.filter((item) => item.skipped).length}`,
    `- Selection board: ${artifacts.selection.selectionBoard}`,
    `- Operations report: ${artifacts.operations.reportMd}`,
    `- Run index: ${artifacts.runIndex.indexMd}`,
    `- Job state: ${path.join(outputDir, 'job_state.json')}`,
    `- Checkpoint: ${path.join(outputDir, 'checkpoint.json')}`,
    `- Stage plan: ${path.join(outputDir, 'stage_plan.json')}`,
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, 'README.md'), readme);

  console.log(paused ? 'DAOGE 状态：已暂停，等待处理' : 'DAOGE 状态：任务完成');
  console.log(`[DAOGE][执行结果] 成功 ${manifest.success}，失败 ${manifest.failed}，跳过 ${allResults.filter((item) => item.skipped).length}，共 ${selectedPrompts.length} 张`);
  console.log(`[DAOGE][结果入口] 先看这里：${resultHubPath}`);
  if (paused) {
    console.log(`[DAOGE][下一步建议] ${translatePauseReason(pauseReason)}。建议先处理风险，再决定是否继续续跑。`);
  } else if (manifest.failed > 0) {
    console.log('[DAOGE][下一步建议] 建议先查看失败记录，再使用失败续跑只补跑失败项。');
  } else {
    console.log('[DAOGE][下一步建议] 本轮已稳定完成，可以进入选图、复盘或下一轮扩图。');
  }
  console.log('[done]');
  console.log(JSON.stringify({ outputDir, resultHubPath, success: manifest.success, failed: manifest.failed, batchCount: batches.length }, null, 2));
}

main().catch((error) => {
  console.error('[fatal]', sanitize(error?.message || error));
  process.exit(1);
});
