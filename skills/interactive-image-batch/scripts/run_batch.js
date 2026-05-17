const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

function sanitize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function normalizeApiPathOverride(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text;
}

function resolveProviderPathOverride({ baseUrl, model, kind, explicitOverride }) {
  const normalizedExplicit = normalizeApiPathOverride(explicitOverride);
  if (normalizedExplicit) return normalizedExplicit;
  return null;
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
    args[key] = value;
    if (value !== 'true') i += 1;
  }
  return args;
}

function parseNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'image';
}

function normalizeSlug(value) {
  return slugify(value || '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portableRunnerPreambleLines() {
  return [
    'DAOGE_RUNNER="${DAOGE_RUNNER_PATH:-./.codex/skills/interactive-image-batch/scripts/run_batch.js}"',
    'if [ ! -f "$DAOGE_RUNNER" ]; then DAOGE_RUNNER="${CODEX_HOME:-$HOME/.codex}/skills/interactive-image-batch/scripts/run_batch.js"; fi',
  ];
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

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function ensureStringArray(value) {
  return ensureArray(value).map((item) => String(item).trim()).filter(Boolean);
}

function detectMimeType(filePath) {
  const ext = String(path.extname(filePath || '')).trim().toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

function fileToDataUrl(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`reference file not found: ${absolutePath}`);
  const mime = detectMimeType(absolutePath);
  const b64 = fs.readFileSync(absolutePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function resolveReferenceMode(item) {
  return String(item.reference_mode || item.referenceMode || '').trim().toLowerCase();
}

function resolveMaskImage(item) {
  const params = item.params || {};
  return String(params.mask_image || item.mask_image || item.edit_mask || '').trim() || null;
}

function resolveReferenceImages(item) {
  const params = item.params || {};
  return Array.from(new Set([
    ...ensureStringArray(item.reference_images || item.referenceImages),
    ...ensureStringArray(params.reference_images),
  ]));
}

function buildOperationMode(item) {
  const explicitMode = resolveReferenceMode(item);
  const referenceImages = resolveReferenceImages(item);
  const maskImage = resolveMaskImage(item);
  if (maskImage && !referenceImages.length) {
    throw new Error(`Slot ${item.slot_id || item.slug || item.index || 'unknown'} has mask_image but no reference_images`);
  }
  if (maskImage) return { mode: 'masked-edit', referenceImages, maskImage };
  if (referenceImages.length) return { mode: 'reference-assisted', referenceImages, maskImage: null };
  if (explicitMode === 'reference-assisted') {
    throw new Error(`Slot ${item.slot_id || item.slug || item.index || 'unknown'} is reference-assisted but has no reference_images`);
  }
  if (explicitMode === 'masked-edit') {
    throw new Error(`Slot ${item.slot_id || item.slug || item.index || 'unknown'} is masked-edit but has no reference_images/mask_image`);
  }
  return { mode: 'prompt-only', referenceImages: [], maskImage: null };
}

function supportsResponsesReferenceMode(pathOverride, operationMode) {
  if (operationMode === 'masked-edit') return false;
  return /\/responses(?:\/|$)/i.test(String(pathOverride || '').trim());
}

function supportsResponsesGenerateMode(pathOverride) {
  return /\/responses(?:\/|$)/i.test(String(pathOverride || '').trim());
}

function parseSseEvents(text) {
  const chunks = String(text || '').split(/\n\n/);
  const events = [];
  for (const rawChunk of chunks) {
    const lines = rawChunk.split(/\n/);
    let eventType = null;
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    const dataText = dataLines.join('\n');
    if (dataText === '[DONE]') {
      events.push({ type: eventType || 'done', done: true, data: null });
      continue;
    }
    try {
      events.push({ type: eventType || 'message', done: false, data: JSON.parse(dataText) });
    } catch {
      events.push({ type: eventType || 'message', done: false, data: { raw: dataText } });
    }
  }
  return events;
}

function extractResponsesImagePayload(text) {
  const events = parseSseEvents(text);
  let finalB64 = null;
  let revisedPrompt = null;
  let responseModel = null;
  let responseSize = null;
  let errorMessage = null;

  for (const event of events) {
    const data = event.data || {};
    if (data.error && !errorMessage) {
      errorMessage = typeof data.error === 'string' ? data.error : sanitize(JSON.stringify(data.error));
    }
    if (data.response?.model && !responseModel) responseModel = data.response.model;

    const responseOutput = Array.isArray(data.response?.output) ? data.response.output : [];
    for (const item of responseOutput) {
      if (item?.type === 'image_generation_call' && item?.result) {
        finalB64 = item.result;
        revisedPrompt = item.revised_prompt || revisedPrompt;
        responseSize = item.size || responseSize;
      }
    }

    if (data.item?.type === 'image_generation_call' && data.item?.result) {
      finalB64 = data.item.result;
      revisedPrompt = data.item.revised_prompt || revisedPrompt;
      responseSize = data.item.size || responseSize;
    }
  }

  return { finalB64, revisedPrompt, responseModel, responseSize, errorMessage };
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

async function requestImage({ baseUrl, apiKey, model, prompt, size, outputFormat, timeoutMs }) {
  const endpoint = buildApiEndpoint(baseUrl, 'generations', {
    overridePath: resolveProviderPathOverride({
      baseUrl,
      model,
      kind: 'generations',
      explicitOverride: arguments[0].generatePath,
    }),
  });
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        size,
        output_format: outputFormat,
        prompt,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`fetch failed for ${endpoint}: ${sanitize(error?.message || error)}`);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`non-json response (${res.status}): ${text.slice(0, 300)}`);
  }

  const payload = extractImagePayload(json);
  if (!res.ok || !payload?.b64) {
    throw new Error(`http ${res.status}: ${sanitize(json?.error?.message || 'missing image payload')}`);
  }

  return {
    b64: payload.b64,
    revisedPrompt: payload.revisedPrompt,
    responseSize: json.size || null,
    responseModel: json.model || model,
  };
}

async function requestResponsesImageGenerate({ baseUrl, apiKey, toolModel, responsesModel, prompt, size, outputFormat, timeoutMs, generatePath }) {
  const endpoint = buildApiEndpoint(baseUrl, 'generations', {
    overridePath: resolveProviderPathOverride({
      baseUrl,
      model: toolModel,
      kind: 'generations',
      explicitOverride: generatePath,
    }),
  });

  const requestBody = {
    model: responsesModel,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
        ],
      },
    ],
    stream: true,
    tools: [
      {
        type: 'image_generation',
        model: toolModel,
        partial_images: 2,
        size,
        output_format: outputFormat,
      },
    ],
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`fetch failed for ${endpoint}: ${sanitize(error?.message || error)}`);
  }

  const text = await res.text();
  const payload = extractResponsesImagePayload(text);
  if (!res.ok) {
    throw new Error(`http ${res.status}: ${sanitize(payload.errorMessage || text.slice(0, 300) || 'responses image generation failed')}`);
  }
  if (!payload.finalB64) {
    throw new Error(`responses image generation returned no final image payload from ${endpoint}`);
  }

  return {
    b64: payload.finalB64,
    revisedPrompt: payload.revisedPrompt,
    responseSize: payload.responseSize || size,
    responseModel: payload.responseModel || responsesModel,
  };
}

function buildApiEndpoint(baseUrl, kind, options = {}) {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const overridePath = normalizeApiPathOverride(options.overridePath);
  if (overridePath) {
    if (/^https?:\/\//i.test(overridePath)) return overridePath.replace(/\/+$/, '');
    const normalizedOverride = overridePath.startsWith('/') ? overridePath : `/${overridePath}`;
    return `${normalizedBase}${normalizedOverride}`.replace(/\/+$/, '');
  }
  if (kind === 'edits') {
    if (/\/v1$/i.test(normalizedBase)) return `${normalizedBase}/images/edits`;
    if (/\/images\/edits$/i.test(normalizedBase)) return normalizedBase;
    return `${normalizedBase}/v1/images/edits`;
  }
  if (/\/v1$/i.test(normalizedBase)) return `${normalizedBase}/images/generations`;
  if (/\/images\/generations$/i.test(normalizedBase)) return normalizedBase;
  return `${normalizedBase}/v1/images/generations`;
}

function extractImagePayload(json) {
  const directData = json?.data?.[0];
  if (directData?.b64_json) {
    return {
      b64: directData.b64_json,
      revisedPrompt: directData.revised_prompt || null,
    };
  }
  if (directData?.base64) {
    return {
      b64: directData.base64,
      revisedPrompt: directData.revised_prompt || null,
    };
  }

  const outputs = Array.isArray(json?.output) ? json.output : [];
  for (const output of outputs) {
    const contents = Array.isArray(output?.content) ? output.content : [];
    for (const content of contents) {
      const candidate = content?.image_base64 || content?.b64_json || content?.base64;
      if (candidate) {
        return {
          b64: candidate,
          revisedPrompt: content?.revised_prompt || output?.revised_prompt || null,
        };
      }
    }
  }

  if (json?.image_base64 || json?.b64_json || json?.base64) {
    return {
      b64: json.image_base64 || json.b64_json || json.base64,
      revisedPrompt: json?.revised_prompt || null,
    };
  }

  return null;
}

function appendFileToForm(form, fieldName, filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`reference file not found: ${absolutePath}`);
  const buffer = fs.readFileSync(absolutePath);
  const blob = new Blob([buffer], { type: detectMimeType(absolutePath) });
  form.append(fieldName, blob, path.basename(absolutePath));
}

async function requestImageEdit({ baseUrl, apiKey, model, prompt, size, outputFormat, timeoutMs, referenceImages, maskImage, editPath }) {
  const endpoint = buildApiEndpoint(baseUrl, 'edits', {
    overridePath: resolveProviderPathOverride({
      baseUrl,
      model,
      kind: 'edits',
      explicitOverride: editPath,
    }),
  });
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('output_format', outputFormat);
  referenceImages.forEach((imagePath) => appendFileToForm(form, 'image[]', imagePath));
  if (maskImage) appendFileToForm(form, 'mask', maskImage);

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`fetch failed for ${endpoint}: ${sanitize(error?.message || error)}`);
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`non-json response (${res.status}): ${text.slice(0, 300)}`);
  }

  const payload = extractImagePayload(json);
  if (!res.ok || !payload?.b64) {
    throw new Error(`http ${res.status}: ${sanitize(json?.error?.message || 'missing image payload')}`);
  }

  return {
    b64: payload.b64,
    revisedPrompt: payload.revisedPrompt,
    responseSize: json.size || null,
    responseModel: json.model || model,
  };
}

async function requestResponsesImageEdit({ baseUrl, apiKey, toolModel, responsesModel, prompt, size, outputFormat, timeoutMs, referenceImages, editPath }) {
  const endpoint = buildApiEndpoint(baseUrl, 'edits', {
    overridePath: resolveProviderPathOverride({
      baseUrl,
      model: toolModel,
      kind: 'edits',
      explicitOverride: editPath,
    }),
  });

  const requestBody = {
    model: responsesModel,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          ...referenceImages.map((imagePath) => ({
            type: 'input_image',
            image_url: fileToDataUrl(imagePath),
          })),
        ],
      },
    ],
    stream: true,
    tools: [
      {
        type: 'image_generation',
        model: toolModel,
        partial_images: 2,
        size,
        output_format: outputFormat,
      },
    ],
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`fetch failed for ${endpoint}: ${sanitize(error?.message || error)}`);
  }

  const text = await res.text();
  const payload = extractResponsesImagePayload(text);
  if (!res.ok) {
    throw new Error(`http ${res.status}: ${sanitize(payload.errorMessage || text.slice(0, 300) || 'responses image edit failed')}`);
  }
  if (!payload.finalB64) {
    throw new Error(`responses image edit returned no final image payload from ${endpoint}`);
  }

  return {
    b64: payload.finalB64,
    revisedPrompt: payload.revisedPrompt,
    responseSize: payload.responseSize || size,
    responseModel: payload.responseModel || responsesModel,
  };
}

async function requestWithFallback({ primary, fallback, fileBase, label }) {
  try {
    return await primary();
  } catch (primaryError) {
    console.log(`[fallback] ${fileBase} ${label}: ${sanitize(primaryError?.message || primaryError)} -> Images API`);
    try {
      return await fallback();
    } catch (fallbackError) {
      throw new Error(`${sanitize(primaryError?.message || primaryError)} | fallback failed: ${sanitize(fallbackError?.message || fallbackError)}`);
    }
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
  sample.forEach((file, index) => {
    fs.copyFileSync(file, path.join(tempDir, `${String(index + 1).padStart(2, '0')}${path.extname(file)}`));
  });

  const cols = sample.length > 10 ? 4 : 2;
  const rows = Math.ceil(sample.length / cols);
  const output = path.join(outDir, 'contact_sheet.png');
  try {
    execFileSync('ffmpeg', [
      '-y',
      '-framerate', '1',
      '-i', path.join(tempDir, `%02d${path.extname(sample[0])}`),
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function collectManifestResults(manifest) {
  return (manifest.batches || []).flatMap((batch) => batch.results || []);
}

function normalizeIndex(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return String(Math.floor(numeric));
  return String(value || '').replace(/^0+/, '') || '0';
}

function parseCsvSet(value) {
  if (value === undefined || value === null || value === '') return null;
  const values = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  return values.length ? new Set(values) : null;
}

function hasExplicitSelectionArgs(args) {
  return Boolean(parseCsvSet(args['select-indexes']) || parseCsvSet(args['select-slot-ids']));
}

function selectResumePrompts(promptPool, resumeManifestPath, failedOnly) {
  if (!resumeManifestPath) return promptPool;
  const manifest = readJson(resumeManifestPath);
  const results = collectManifestResults(manifest);
  const selectedResults = failedOnly ? results.filter((item) => !item.ok) : results;
  const wanted = new Map();
  selectedResults.forEach((item) => {
    const indexKey = normalizeIndex(item.index);
    const slugKey = normalizeSlug(item.slug);
    if (!wanted.has(indexKey)) wanted.set(indexKey, new Set());
    if (slugKey && slugKey !== 'image') wanted.get(indexKey).add(slugKey);
  });
  const selected = promptPool.filter((item, index) => {
    const indexKey = normalizeIndex(item.index ?? index + 1);
    if (!wanted.has(indexKey)) return false;
    const allowedSlugs = wanted.get(indexKey);
    if (!allowedSlugs || !allowedSlugs.size) return true;
    return allowedSlugs.has(normalizeSlug(item.slug));
  });
  if (!selected.length) {
    throw new Error(`No prompts matched ${failedOnly ? 'failed' : 'resume'} results from ${resumeManifestPath}; prompt indexes or slugs may have changed`);
  }
  return selected;
}

function selectExplicitPrompts(promptPool, args) {
  const selectedIndexes = parseCsvSet(args['select-indexes']);
  const selectedSlotIds = parseCsvSet(args['select-slot-ids']);
  if (!selectedIndexes && !selectedSlotIds) return promptPool;

  const selected = promptPool.filter((item, index) => {
    const indexMatch = selectedIndexes ? selectedIndexes.has(normalizeIndex(item.index ?? index + 1)) : false;
    const slotMatch = selectedSlotIds ? selectedSlotIds.has(String(item.slot_id || '').trim()) : false;
    return indexMatch || slotMatch;
  });

  if (!selected.length) {
    throw new Error('No prompts matched --select-indexes/--select-slot-ids');
  }
  return selected;
}

function buildManifestResultLookup(resumeManifestPath) {
  if (!resumeManifestPath) return null;
  const manifest = readJson(resumeManifestPath);
  const results = collectManifestResults(manifest);
  const byIndex = new Map();
  const byIndexSlug = new Map();
  results.forEach((item) => {
    if (!item.ok || !item.output) return;
    const indexKey = normalizeIndex(item.index);
    const slugKey = normalizeSlug(item.slug);
    if (!byIndex.has(indexKey)) byIndex.set(indexKey, item);
    if (slugKey) byIndexSlug.set(`${indexKey}|${slugKey}`, item);
  });
  return { byIndex, byIndexSlug };
}

function applyPreviousOutputReuse(promptPool, resumeManifestPath, reuseOutputAsReference) {
  if (!reuseOutputAsReference) return promptPool;
  if (!resumeManifestPath) {
    throw new Error('--reuse-output-as-reference requires --resume-manifest');
  }
  const lookup = buildManifestResultLookup(resumeManifestPath);
  return promptPool.map((item, index) => {
    const indexKey = normalizeIndex(item.index ?? index + 1);
    const slugKey = normalizeSlug(item.slug);
    const match = lookup.byIndexSlug.get(`${indexKey}|${slugKey}`) || lookup.byIndex.get(indexKey);
    if (!match?.output) {
      throw new Error(`No successful previous output found for prompt ${indexKey}${slugKey ? ` (${slugKey})` : ''}`);
    }
    const referenceImages = Array.from(new Set([match.output, ...resolveReferenceImages(item)]));
    const next = {
      ...item,
      reference_images: referenceImages,
      edit_source: 'previous-output',
      edit_source_output: match.output,
    };
    const existingMode = resolveReferenceMode(item);
    if (!existingMode || existingMode === 'prompt-only') {
      next.reference_mode = resolveMaskImage(item) ? 'masked-edit' : 'reference-assisted';
    }
    return next;
  });
}

function writeRerunPlan(outputDir, resumeManifestPath, prompts) {
  if (!resumeManifestPath) return null;
  const planPath = path.join(outputDir, 'rerun_plan.json');
  const plan = {
    sourceManifest: path.resolve(resumeManifestPath),
    promptCount: prompts.length,
    indexes: prompts.map((item, index) => item.index ?? index + 1),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  return planPath;
}

function renderCompletionReport(outputDir) {
  const scriptPath = path.join(__dirname, 'render_completion_report.js');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const reportPath = path.join(outputDir, 'daoge_completion_report.md');
  execFileSync(process.execPath, [scriptPath, '--manifest-file', manifestPath, '--output-file', reportPath], {
    stdio: 'ignore',
  });
  return reportPath;
}

function renderResultHub(outputDir) {
  const scriptPath = path.join(__dirname, 'render_result_hub.js');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const hubPath = path.join(outputDir, 'daoge_result_hub.md');
  execFileSync(process.execPath, [scriptPath, '--manifest-file', manifestPath, '--output-file', hubPath], {
    stdio: 'ignore',
  });
  return hubPath;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] === undefined || item[key] === null || item[key] === '' ? '(missing)' : String(item[key]);
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function uniqueSlotIds(items) {
  return Array.from(new Set((items || [])
    .map((item) => String(item.slotId || item.slot_id || '').trim())
    .filter(Boolean)));
}

function isLocalEditResult(item) {
  const requestMode = String(item.requestMode || item.request_mode || '').trim();
  const editSource = String(item.editSource || item.edit_source || '').trim();
  return requestMode === 'masked-edit' || editSource === 'previous-output';
}

function createSelectionArtifacts(outputDir, manifest, allResults) {
  const successful = allResults.filter((item) => item.ok && !item.skipped);
  const failed = allResults.filter((item) => !item.ok);
  const skipped = allResults.filter((item) => item.skipped);
  const executed = allResults.filter((item) => !item.skipped);
  const localEditResults = executed.filter(isLocalEditResult);
  const needsReview = successful.filter((item) => !item.output || !fs.existsSync(item.output));
  const rerunCandidates = failed.map((item) => ({
    index: item.index,
    slug: item.slug,
    title: item.title,
    error: item.error || 'unknown',
    prompt: item.prompt,
  }));

  const artifacts = {
    successFile: path.join(outputDir, 'success.json'),
    failedFile: path.join(outputDir, 'failed.json'),
    skippedFile: path.join(outputDir, 'skipped.json'),
    needsReviewFile: path.join(outputDir, 'needs_review.json'),
    rerunCandidatesFile: path.join(outputDir, 'rerun_candidates.json'),
    selectionBoard: path.join(outputDir, 'selection_board.md'),
  };

  writeJson(artifacts.successFile, successful);
  writeJson(artifacts.failedFile, failed);
  writeJson(artifacts.skippedFile, skipped);
  writeJson(artifacts.needsReviewFile, needsReview);
  writeJson(artifacts.rerunCandidatesFile, rerunCandidates);
  const generatedSlots = uniqueSlotIds(executed);
  const localEditSlots = uniqueSlotIds(localEditResults);

  const lines = [
    '# DAOGE 筛选与补跑入口',
    '',
    '我是 DAOGE。',
    '这份文件用于快速看成功/失败，并给你现成的补跑入口。',
    '',
    '## 1. 当前结果摘要',
    '',
    `- 输出目录: ${outputDir}`,
    `- 成功张数: ${successful.length}`,
    `- 失败张数: ${failed.length}`,
    `- 跳过已完成: ${skipped.length}`,
    `- 需要人工复核: ${needsReview.length}`,
    `- 参与生成槽位: ${generatedSlots.length ? generatedSlots.join(', ') : '无'}`,
    `- 局部编辑槽位: ${localEditSlots.length ? localEditSlots.join(', ') : '无'}`,
    '',
    '## 2. 成功样例',
    '',
    ...(successful.length ? successful.slice(0, 30).map((item) => `- ${item.index} / ${item.title || item.slug}: ${item.output}`) : ['- 无']),
    '',
    '## 3. 失败项',
    '',
    ...(failed.length ? failed.map((item) => `- ${item.index} / ${item.title || item.slug}: ${item.error || 'unknown'}`) : ['- 无']),
    '',
    '## 4. 失败补跑命令',
    '',
    '```bash',
    ...portableRunnerPreambleLines(),
    'node "$DAOGE_RUNNER" \\',
    `  --prompts-file ${shellQuote(resolvePromptFileForRerun(manifest, outputDir))} \\`,
    `  --resume-manifest ${shellQuote(path.join(outputDir, 'manifest.json'))} \\`,
    '  --failed-only true',
    '```',
  ];
  if (localEditSlots.length) {
    lines.push('');
    lines.push('## 5. 局部编辑续改命令');
    lines.push('');
    lines.push('- 如果你要继续只改本轮已经命中的局部编辑分镜，可以直接复用上一轮结果做底图。');
    lines.push('');
    lines.push('```bash');
    lines.push(...portableRunnerPreambleLines());
    lines.push('node "$DAOGE_RUNNER" \\');
    lines.push(`  --prompts-file ${shellQuote(resolvePromptFileForRerun(manifest, outputDir))} \\`);
    lines.push(`  --resume-manifest ${shellQuote(path.join(outputDir, 'manifest.json'))} \\`);
    lines.push(`  --select-slot-ids ${localEditSlots.join(',')} \\`);
    lines.push('  --reuse-output-as-reference true \\');
    lines.push('  --batch-size 1 \\');
    lines.push('  --concurrency 1');
    lines.push('```');
  }
  lines.push('');
  lines.push('## 6. DAOGE 建议');
  lines.push('');
  lines.push(failed.length ? '- 先看失败项，再决定是否只补跑失败项。' : '- 当前没有失败项，可以直接进入选图或下一轮微调。');
  lines.push(localEditSlots.length ? '- 如果只是继续微调同一个分镜，优先走“局部编辑续改命令”，不要整板重跑。' : '- 如果后面要改单格，可以回到 DAOGE 用“只改分镜X”的方式继续。');
  fs.writeFileSync(artifacts.selectionBoard, `${lines.join('\n')}\n`);
  return artifacts;
}

function createOperationsReport(outputDir, manifest, allResults) {
  const successful = allResults.filter((item) => item.ok && !item.skipped);
  const failed = allResults.filter((item) => !item.ok);
  const skipped = allResults.filter((item) => item.skipped);
  const executed = allResults.filter((item) => !item.skipped);
  const attemptedLocalEdits = executed.filter(isLocalEditResult);
  const successfulLocalEdits = successful.filter(isLocalEditResult);
  const total = successful.length + failed.length;
  const successRate = total ? Number((successful.length / total * 100).toFixed(2)) : 0;
  const batchSummaries = (manifest.batches || []).map((batch) => ({
    batchNumber: batch.batchNumber,
    promptCount: batch.promptCount,
    success: batch.success,
    failed: batch.failed,
    successRate: batch.promptCount ? Number((batch.success / batch.promptCount * 100).toFixed(2)) : 0,
  }));
  const report = {
    outputDir,
    generatedAt: new Date().toISOString(),
    promptSource: manifest.promptSource,
    selectedCount: manifest.selectedCount,
    paused: Boolean(manifest.paused),
    pauseReason: manifest.pauseReason || null,
    success: successful.length,
    failed: failed.length,
    skipped: skipped.length,
    successRate,
    generatedSlots: uniqueSlotIds(executed),
    attemptedLocalEditSlots: uniqueSlotIds(attemptedLocalEdits),
    successfulLocalEditSlots: uniqueSlotIds(successfulLocalEdits),
    batchSummaries,
    failureReasons: countBy(failed, 'error'),
    distributions: {
      requestMode: countBy(successful, 'requestMode').slice(0, 12),
      styleFamily: countBy(successful, 'styleFamily').slice(0, 12),
      scene: countBy(successful, 'scene').slice(0, 12),
      wardrobe: countBy(successful, 'wardrobe').slice(0, 12),
      composition: countBy(successful, 'composition').slice(0, 12),
    },
  };
  const reportPath = path.join(outputDir, 'operations_report.json');
  const reportMd = path.join(outputDir, 'operations_report.md');
  writeJson(reportPath, report);
  const lines = [
    '# DAOGE Operations Report',
    '',
    `- Output dir: ${outputDir}`,
    `- Success rate: ${successRate}%`,
    `- Paused: ${manifest.paused ? 'yes' : 'no'}`,
    `- Pause reason: ${manifest.pauseReason || 'none'}`,
    `- Success: ${successful.length}`,
    `- Failed: ${failed.length}`,
    `- Skipped existing: ${skipped.length}`,
    `- Generated slots: ${report.generatedSlots.length ? report.generatedSlots.join(', ') : 'None'}`,
    `- Attempted local-edit slots: ${report.attemptedLocalEditSlots.length ? report.attemptedLocalEditSlots.join(', ') : 'None'}`,
    `- Successful local-edit slots: ${report.successfulLocalEditSlots.length ? report.successfulLocalEditSlots.join(', ') : 'None'}`,
    '',
    '## Batch Summary',
    '',
    ...(batchSummaries.length ? batchSummaries.map((item) => `- Batch ${item.batchNumber}: ${item.success}/${item.promptCount} success (${item.successRate}%), failed ${item.failed}`) : ['- No batches']),
    '',
    '## Failure Reasons',
    '',
    ...(report.failureReasons.length ? report.failureReasons.map((item) => `- ${item.name}: ${item.count}`) : ['- None']),
    '',
    '## Request Modes',
    '',
    ...(report.distributions.requestMode.length ? report.distributions.requestMode.map((item) => `- ${item.name}: ${item.count}`) : ['- None']),
    '',
    '## Next Actions',
    '',
    failed.length ? '- Rerun failed items with `--resume-manifest manifest.json --failed-only true`.' : '- No failed items. Move to selection and next-round expansion.',
    skipped.length ? '- Skipped items indicate resume/skip-existing worked as intended.' : '- No skipped existing items recorded.',
  ];
  fs.writeFileSync(reportMd, `${lines.join('\n')}\n`);
  return { reportPath, reportMd };
}

function createContactSheetIndex(outputDir, manifest) {
  const rootSheet = path.join(outputDir, 'contact_sheet.png');
  const lines = [
    '# DAOGE Contact Sheet Index',
    '',
    fs.existsSync(rootSheet) ? `- Root contact sheet: ${rootSheet}` : '- Root contact sheet: not generated',
    '',
    '## Batch Outputs',
    '',
    ...(manifest.batches || []).map((batch) => `- Batch ${batch.batchNumber}: ${batch.outputDir || 'unknown'} (${batch.success || 0} success, ${batch.failed || 0} failed)`),
  ];
  const outputPath = path.join(outputDir, 'contact_sheet_index.md');
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
  return outputPath;
}

function updateRunIndex(outputDir, manifest, allResults, artifacts) {
  const rootDir = path.dirname(outputDir);
  const indexPath = path.join(rootDir, 'daoge_run_index.json');
  let index = [];
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = readJson(indexPath);
      index = Array.isArray(parsed) ? parsed : [];
    } catch {
      index = [];
    }
  }
  const entry = {
    outputDir,
    manifest: path.join(outputDir, 'manifest.json'),
    generatedAt: manifest.generatedAt,
    promptSource: manifest.promptSource,
    selectedCount: manifest.selectedCount,
    success: manifest.success,
    failed: manifest.failed,
    skipped: allResults.filter((item) => item.skipped).length,
    batchCount: manifest.batchCount,
    batchSize: manifest.batchSize,
    model: manifest.model,
    defaultSize: manifest.defaultSize,
    resumeManifest: manifest.resumeManifest,
    artifacts,
  };
  index = index.filter((item) => item.outputDir !== outputDir);
  index.push(entry);
  writeJson(indexPath, index);
  const indexMd = path.join(rootDir, 'daoge_run_index.md');
  const lines = [
    '# DAOGE Run Index',
    '',
    ...index.slice(-100).reverse().map((item) => `- ${item.generatedAt || 'unknown'} | success ${item.success}/${item.selectedCount} | failed ${item.failed} | skipped ${item.skipped || 0} | ${item.outputDir}`),
  ];
  fs.writeFileSync(indexMd, `${lines.join('\n')}\n`);
  return { indexPath, indexMd };
}

function createOperationalArtifacts(outputDir, manifest, allResults) {
  const selection = createSelectionArtifacts(outputDir, manifest, allResults);
  const operations = createOperationsReport(outputDir, manifest, allResults);
  const contactSheetIndex = createContactSheetIndex(outputDir, manifest);
  const runIndex = updateRunIndex(outputDir, manifest, allResults, { selection, operations, contactSheetIndex });
  return { selection, operations, contactSheetIndex, runIndex };
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

function createJobState(outputDir, config, plan) {
  return {
    jobId: path.basename(outputDir),
    outputDir,
    status: 'planned',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    promptSource: config.promptsFile,
    selectedCount: config.selectedCount,
    batchSize: config.batchSize,
    stageSize: config.stageSize || null,
    sampleSize: config.sampleSize || 0,
    concurrency: config.concurrency,
    retryCount: config.retryCount,
    timeoutSeconds: config.timeoutSeconds,
    pausePolicy: config.pausePolicy,
    progress: {
      completedBatches: 0,
      totalBatches: plan.batchCount,
      completedPrompts: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      currentStage: null,
      currentBatch: null,
    },
    pauseReason: null,
    completedBatchNumbers: [],
  };
}

function writeJobState(outputDir, state) {
  state.updatedAt = new Date().toISOString();
  writeJson(path.join(outputDir, 'job_state.json'), state);
}

function writeCheckpoint(outputDir, state, batchManifest = null) {
  const checkpointsDir = path.join(outputDir, 'checkpoints');
  fs.mkdirSync(checkpointsDir, { recursive: true });
  const checkpoint = {
    writtenAt: new Date().toISOString(),
    status: state.status,
    pauseReason: state.pauseReason,
    progress: state.progress,
    completedBatchNumbers: state.completedBatchNumbers,
    latestBatch: batchManifest ? {
      batchNumber: batchManifest.batchNumber,
      success: batchManifest.success,
      failed: batchManifest.failed,
      promptCount: batchManifest.promptCount,
      outputDir: batchManifest.outputDir,
    } : null,
  };
  writeJson(path.join(outputDir, 'checkpoint.json'), checkpoint);
  if (batchManifest) {
    writeJson(path.join(checkpointsDir, `checkpoint_batch_${String(batchManifest.batchNumber).padStart(3, '0')}.json`), checkpoint);
  }
}

function skippedCount(results) {
  return (results || []).filter((item) => item.skipped).length;
}

function stageLabel(stageType) {
  if (stageType === 'sample') return '样本阶段';
  if (stageType === 'production') return '正式阶段';
  return stageType || '未标记阶段';
}

function translatePauseReason(reason) {
  const text = String(reason || '').trim();
  if (!text) return '未说明';
  if (text === 'sample_stage_completed_review_required') return '样本阶段已完成，等待人工复核后再继续';
  let match = text.match(/^batch_failure_rate (.+)% exceeded (.+)%$/);
  if (match) return `单批失败率 ${match[1]}% 超过阈值 ${match[2]}%`;
  match = text.match(/^consecutive_failures (.+) reached threshold (.+)$/);
  if (match) return `连续失败 ${match[1]} 次，已达到阈值 ${match[2]}`;
  return text;
}

function printExecutionStart(ctx) {
  console.log('DAOGE 状态：正在执行');
  console.log(`[DAOGE][执行总览] 共 ${ctx.selectedCount} 张，分 ${ctx.stageCount} 个阶段、${ctx.batchCount} 批执行`);
  console.log(`[DAOGE][执行总览] 默认尺寸 ${ctx.width}x${ctx.height}，并发 ${ctx.concurrency}，超时 ${ctx.timeoutSeconds} 秒，重试 ${ctx.retryCount} 次`);
  console.log(`[DAOGE][执行总览] 输出目录：${ctx.outputDir}`);
}

function printBatchStart(plannedBatch, totalBatches) {
  console.log(`DAOGE 状态：正在执行`);
  console.log(`[DAOGE][批次开始] 第 ${plannedBatch.batchNumber}/${totalBatches} 批 | ${stageLabel(plannedBatch.stageType)} ${plannedBatch.stageNumber} | ${plannedBatch.promptCount} 张 | 索引 ${plannedBatch.firstIndex} -> ${plannedBatch.lastIndex}`);
}

function printBatchSummary(plannedBatch, batchManifest, state) {
  const skipped = skippedCount(batchManifest.results);
  console.log(`[DAOGE][批次完成] 第 ${plannedBatch.batchNumber}/${batchManifest.totalBatches} 批：成功 ${batchManifest.success}，失败 ${batchManifest.failed}，跳过 ${skipped}`);
  console.log(`[DAOGE][累计进度] 已完成 ${state.progress.completedBatches}/${state.progress.totalBatches} 批，成功 ${state.progress.success}，失败 ${state.progress.failed}，跳过 ${state.progress.skipped}，已处理 ${state.progress.completedPrompts}/${state.selectedCount} 张`);
}

function updateStateAfterBatch(state, batchManifest) {
  const results = batchManifest.results || [];
  state.progress.completedBatches += 1;
  state.progress.completedPrompts += batchManifest.promptCount || results.length;
  state.progress.success += batchManifest.success || 0;
  state.progress.failed += batchManifest.failed || 0;
  state.progress.skipped += results.filter((item) => item.skipped).length;
  state.progress.currentBatch = batchManifest.batchNumber;
  state.completedBatchNumbers.push(batchManifest.batchNumber);
}

function maxConsecutiveFailures(results) {
  let max = 0;
  let current = 0;
  for (const item of results) {
    if (item.ok) {
      current = 0;
    } else {
      current += 1;
      max = Math.max(max, current);
    }
  }
  return max;
}

function evaluatePausePolicy(batchManifest, allResults, policy) {
  if (!policy || policy.enabled === false) return null;
  const batchRate = batchManifest.promptCount ? batchManifest.failed / batchManifest.promptCount : 0;
  if (policy.maxBatchFailureRate <= 1 && batchRate > policy.maxBatchFailureRate) {
    return `batch_failure_rate ${Number((batchRate * 100).toFixed(2))}% exceeded ${Number((policy.maxBatchFailureRate * 100).toFixed(2))}%`;
  }
  const consecutive = maxConsecutiveFailures(allResults);
  if (policy.maxConsecutiveFailures > 0 && consecutive >= policy.maxConsecutiveFailures) {
    return `consecutive_failures ${consecutive} reached threshold ${policy.maxConsecutiveFailures}`;
  }
  return null;
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
    const artifacts = createOperationalArtifacts(outputDir, manifest, []);
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
  const artifacts = createOperationalArtifacts(outputDir, manifest, allResults);
  let completionReportPath = renderCompletionReport(outputDir);
  const resultHubPath = renderResultHub(outputDir);
  completionReportPath = renderCompletionReport(outputDir);

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
