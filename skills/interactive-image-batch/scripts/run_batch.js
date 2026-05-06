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
    'DAOGE_RUNNER="${DAOGE_RUNNER_PATH:-./.agents/skills/interactive-image-batch/scripts/run_batch.js}"',
    'if [ ! -f "$DAOGE_RUNNER" ]; then DAOGE_RUNNER="./.codex/skills/interactive-image-batch/scripts/run_batch.js"; fi',
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
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const endpoint = /\/v1$/i.test(normalizedBase)
    ? `${normalizedBase}/images/generations`
    : /\/images\/generations$/i.test(normalizedBase)
      ? normalizedBase
      : `${normalizedBase}/v1/images/generations`;
  const res = await fetch(endpoint, {
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

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`non-json response (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok || !json?.data?.[0]?.b64_json) {
    throw new Error(`http ${res.status}: ${sanitize(json?.error?.message || 'missing image payload')}`);
  }

  return {
    b64: json.data[0].b64_json,
    revisedPrompt: json.data[0].revised_prompt || null,
    responseSize: json.size || null,
    responseModel: json.model || model,
  };
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
  const outputPath = path.join(ctx.outDir, `${fileBase}_${req.size}.${req.outputFormat}`);
  const metaPath = path.join(ctx.outDir, `${fileBase}.json`);

  for (let attempt = 1; attempt <= ctx.maxAttempts; attempt += 1) {
    console.log(`[start] ${fileBase} attempt ${attempt}`);
    const startedAt = new Date().toISOString();
    try {
      const result = await requestImage({
        baseUrl: ctx.baseUrl,
        apiKey: ctx.apiKey,
        model: req.model,
        prompt,
        size: req.size,
        outputFormat: req.outputFormat,
        timeoutMs: req.timeoutMs,
      });

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

function createSelectionArtifacts(outputDir, manifest, allResults) {
  const successful = allResults.filter((item) => item.ok && !item.skipped);
  const failed = allResults.filter((item) => !item.ok);
  const skipped = allResults.filter((item) => item.skipped);
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

  const lines = [
    '# DAOGE Selection Board',
    '',
    `- Output dir: ${outputDir}`,
    `- Success: ${successful.length}`,
    `- Failed: ${failed.length}`,
    `- Skipped existing: ${skipped.length}`,
    `- Needs review: ${needsReview.length}`,
    '',
    '## Success Samples',
    '',
    ...(successful.length ? successful.slice(0, 30).map((item) => `- ${item.index} / ${item.title || item.slug}: ${item.output}`) : ['- None']),
    '',
    '## Failed Items',
    '',
    ...(failed.length ? failed.map((item) => `- ${item.index} / ${item.title || item.slug}: ${item.error || 'unknown'}`) : ['- None']),
    '',
    '## Rerun Command',
    '',
    '```bash',
    ...portableRunnerPreambleLines(),
    'node "$DAOGE_RUNNER" \\',
    `  --prompts-file ${shellQuote(resolvePromptFileForRerun(manifest, outputDir))} \\`,
    `  --resume-manifest ${shellQuote(path.join(outputDir, 'manifest.json'))} \\`,
    '  --failed-only true',
    '```',
  ];
  fs.writeFileSync(artifacts.selectionBoard, `${lines.join('\n')}\n`);
  return artifacts;
}

function createOperationsReport(outputDir, manifest, allResults) {
  const successful = allResults.filter((item) => item.ok && !item.skipped);
  const failed = allResults.filter((item) => !item.ok);
  const skipped = allResults.filter((item) => item.skipped);
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
    batchSummaries,
    failureReasons: countBy(failed, 'error'),
    distributions: {
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
    '',
    '## Batch Summary',
    '',
    ...(batchSummaries.length ? batchSummaries.map((item) => `- Batch ${item.batchNumber}: ${item.success}/${item.promptCount} success (${item.successRate}%), failed ${item.failed}`) : ['- No batches']),
    '',
    '## Failure Reasons',
    '',
    ...(report.failureReasons.length ? report.failureReasons.map((item) => `- ${item.name}: ${item.count}`) : ['- None']),
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

  const promptsFile = path.resolve(args['prompts-file']);
  const promptPool = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
  if (!Array.isArray(promptPool)) throw new Error(`Prompt file must be a JSON array: ${promptsFile}`);
  const resumeManifest = args['resume-manifest'] ? path.resolve(args['resume-manifest']) : null;
  const failedOnly = parseBoolean(args['failed-only'], Boolean(resumeManifest));
  const resumePool = selectResumePrompts(promptPool, resumeManifest, failedOnly);

  const width = Math.max(16, Math.floor(parseNumber(args.width, 1440)));
  const height = Math.max(16, Math.floor(parseNumber(args.height, 2560)));
  const outputFormat = args['output-format'] || 'png';
  const timeoutSeconds = Math.max(1, parseNumber(args['timeout-seconds'], 450));
  const retryCount = Math.max(0, Math.floor(parseNumber(args['retry-count'], 1)));
  const concurrency = clampNumber(Math.floor(parseNumber(args.concurrency, 3)), 1, 12);
  const offset = Math.max(0, Math.floor(parseNumber(args.offset, 0)));
  const limit = Math.max(0, Math.floor(parseNumber(args.limit, resumePool.length - offset)));
  const selectedPrompts = resumePool.slice(offset, offset + limit);
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
  if (resumeManifest) console.log(`[info] resume manifest: ${resumeManifest}, failed only: ${failedOnly}`);
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
