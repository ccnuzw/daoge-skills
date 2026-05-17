const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  sanitize,
  parseNumber,
  slugify,
  resolveMaskImage,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const meta = ctx.readJson(metaPath);
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
    readJson: batchContext.readJson,
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

module.exports = {
  buildContactSheet,
  runBatch,
};
