const path = require('path');
const fs = require('fs');
const {
  ensureV2Layout,
  readJson,
  readJsonIfExists,
  writeJson,
  toArray,
} = require('../shared/workspace');
const { parseNumber, clampNumber, parseBoolean } = require('./run_item');
const { loadImageEnv } = require('../shared/env');
const { runBatch } = require('./batch_executor');
const { refreshWorkspace } = require('./workspace_service');
const { normalizePromptMaterials } = require('./material_resolver');

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function stablePromptIndexes(prompts) {
  return prompts.map((item, index) => (hasOwn(item, 'index') ? item : { ...item, index: index + 1 }));
}

function indexKeys(value) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  const keys = new Set([text]);
  if (/^\d+$/.test(text)) keys.add(String(Number.parseInt(text, 10)));
  return Array.from(keys);
}

function selectFailedPrompts(prompts, resumeManifest) {
  if (!resumeManifest) return prompts;
  const failed = new Set();
  toArray(resumeManifest.results).forEach((item) => {
    if (item.status === 'failed' || item.ok === false) indexKeys(item.index).forEach((key) => failed.add(key));
  });
  toArray(resumeManifest.batches).forEach((batch) => {
    toArray(batch.results).forEach((item) => {
      if (item.status === 'failed' || item.ok === false) indexKeys(item.index).forEach((key) => failed.add(key));
    });
  });
  if (!failed.size) return [];
  return stablePromptIndexes(prompts).filter((item) => indexKeys(item.index).some((key) => failed.has(key)));
}

function buildExecutionPlan(prompts, options = {}) {
  const batchSize = Math.max(1, Math.floor(parseNumber(options.batchSize, prompts.length || 1)));
  const batches = chunk(prompts, batchSize).map((items, index) => ({
    batchNumber: index + 1,
    totalBatches: Math.ceil(prompts.length / batchSize),
    items,
    promptCount: items.length,
    offsetBase: index * batchSize,
  }));
  return {
    promptCount: prompts.length,
    batchSize,
    batchCount: batches.length,
    batches,
  };
}

function dryRunResults(prompts, offsetBase = 0) {
  return prompts.map((item, index) => ({
    ok: !toArray(item.materialIssues).length,
    skipped: !toArray(item.materialIssues).length,
    index: item.index ?? offsetBase + index + 1,
    title: item.title || `结果 ${offsetBase + index + 1}`,
    requestMode: item.reference_mode
      || item.referenceMode
      || (toArray(item.reference_images).length || toArray(item.referenceImages).length ? 'reference-assisted' : 'prompt-only'),
    output: null,
    error: toArray(item.materialIssues).map((issue) => issue.message).join('；') || null,
    worthRerun: Boolean(toArray(item.materialIssues).length),
    rerunReason: toArray(item.materialIssues).length ? '素材文件缺失' : null,
  }));
}

function materialIssueResult(item, index, offsetBase = 0) {
  const issues = toArray(item.materialIssues);
  return {
    ok: false,
    skipped: false,
    index: item.index ?? offsetBase + index + 1,
    title: item.title || `结果 ${offsetBase + index + 1}`,
    requestMode: item.reference_mode
      || item.referenceMode
      || (toArray(item.reference_images).length || toArray(item.referenceImages).length ? 'reference-assisted' : 'prompt-only'),
    output: null,
    error: issues.map((issue) => issue.message).join('；') || '素材文件缺失',
    worthRerun: true,
    rerunReason: '素材文件缺失',
  };
}

function splitMaterialIssuePrompts(prompts) {
  const blocked = [];
  const runnable = [];
  prompts.forEach((item, index) => {
    const entry = { item, index };
    if (toArray(item.materialIssues).length) blocked.push(entry);
    else runnable.push(entry);
  });
  return { blocked, runnable };
}

function promptSourceFromRunPlan(outputDir) {
  const runPlan = readJsonIfExists(path.join(outputDir, 'internal', 'run_plan.json')) || {};
  const candidates = [
    runPlan.source?.promptSource,
    runPlan.source?.promptSourceOriginal,
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(path.resolve(candidate))) || null;
}

function materialBaseDirFromRunPlan(outputDir) {
  const runPlan = readJsonIfExists(path.join(outputDir, 'internal', 'run_plan.json')) || {};
  const baseDir = runPlan.materials?.baseDir;
  return baseDir && fs.existsSync(path.resolve(baseDir)) ? path.resolve(baseDir) : null;
}

function resolvePromptsFile(options = {}, outputDir) {
  if (options.promptsFile) return path.resolve(options.promptsFile);
  const generated = path.join(outputDir, 'debug', 'prompts.generated.json');
  if (fs.existsSync(generated)) return generated;
  const fromPlan = promptSourceFromRunPlan(outputDir);
  if (fromPlan) return path.resolve(fromPlan);
  throw new Error([
    '缺少提示词文件。',
    `当前没有找到：${generated}`,
    '下一步：先运行 node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out',
    '或者执行时补充 --prompts-file prompts.json。',
  ].join('\n'));
}

function resolveTaskSpecFile(options = {}, outputDir) {
  if (options.taskSpecFile) return path.resolve(options.taskSpecFile);
  const generated = path.join(outputDir, 'debug', 'task_spec.normalized.json');
  return fs.existsSync(generated) ? generated : null;
}

function hasUsableOption(options, key) {
  return hasOwn(options, key) && options[key] !== undefined && options[key] !== null && options[key] !== '';
}

function executionOptionsWithTaskDefaults(options = {}, taskSpec = {}) {
  const mappings = [
    ['batchSize', 'batch_size'],
    ['concurrency', 'concurrency'],
    ['retryCount', 'retry_count'],
    ['timeoutSeconds', 'timeout_seconds'],
    ['width', 'width'],
    ['height', 'height'],
    ['outputFormat', 'output_format'],
  ];
  return mappings.reduce((resolved, [optionKey, taskKey]) => {
    if (hasUsableOption(resolved, optionKey) || !hasUsableOption(taskSpec, taskKey)) return resolved;
    return { ...resolved, [optionKey]: taskSpec[taskKey] };
  }, { ...options });
}

async function executeTask(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const promptsFile = resolvePromptsFile(options, outputDir);
  const taskSpecFile = resolveTaskSpecFile(options, outputDir);
  const taskSpec = taskSpecFile ? (readJsonIfExists(taskSpecFile) || {}) : {};
  const effectiveOptions = executionOptionsWithTaskDefaults(options, taskSpec);
  const resolvedPrompts = normalizePromptMaterials(readJson(promptsFile), { promptsFile });
  const allPrompts = resolvedPrompts.prompts;
  const resumeManifest = readJsonIfExists(options.resumeManifestFile);
  const failedOnly = parseBoolean(options.failedOnly, Boolean(resumeManifest));
  const selectedPrompts = stablePromptIndexes(failedOnly ? selectFailedPrompts(allPrompts, resumeManifest) : allPrompts);
  if (!selectedPrompts.length) throw new Error('没有可执行项目');

  const materialSplit = splitMaterialIssuePrompts(selectedPrompts);
  const runnablePrompts = options.dryRun ? selectedPrompts : materialSplit.runnable.map((entry) => entry.item);
  const envInfo = options.dryRun || !runnablePrompts.length ? { envFile: null, env: {} } : loadImageEnv(options.envFile);
  const plan = buildExecutionPlan(runnablePrompts, effectiveOptions);
  const debugDir = path.join(outputDir, 'debug');
  const batchRoot = path.join(debugDir, 'batches');
  const promptCopy = path.join(debugDir, 'prompts.generated.json');
  const stagePlanPath = path.join(debugDir, 'stage_plan.json');
  writeJson(promptCopy, selectedPrompts);
  writeJson(stagePlanPath, plan);

  const width = Math.max(16, Math.floor(parseNumber(effectiveOptions.width, 1440)));
  const height = Math.max(16, Math.floor(parseNumber(effectiveOptions.height, 2560)));
  const outputFormat = effectiveOptions.outputFormat || 'png';
  const timeoutSeconds = Math.max(1, parseNumber(effectiveOptions.timeoutSeconds, 450));
  const retryCount = Math.max(0, Math.floor(parseNumber(effectiveOptions.retryCount, 1)));
  const concurrency = clampNumber(Math.floor(parseNumber(effectiveOptions.concurrency, 3)), 1, 12);
  const allResults = [];
  const batchManifests = [];

  if (options.dryRun) {
    allResults.push(...dryRunResults(selectedPrompts));
    batchManifests.push(...plan.batches.map((batch) => {
      const results = dryRunResults(batch.items, batch.offsetBase);
      return {
        batchNumber: batch.batchNumber,
        totalBatches: batch.totalBatches,
        outputDir: null,
        promptCount: batch.promptCount,
        success: results.filter((item) => item.ok && !item.skipped).length,
        failed: results.filter((item) => !item.ok).length,
        skipped: results.filter((item) => item.skipped).length,
        results,
      };
    }));
  } else {
    if (materialSplit.blocked.length) {
      const blockedResults = materialSplit.blocked.map((entry) => materialIssueResult(entry.item, entry.index));
      allResults.push(...blockedResults);
      batchManifests.push({
        batchNumber: 0,
        totalBatches: plan.batchCount,
        outputDir: null,
        promptCount: blockedResults.length,
        success: 0,
        failed: blockedResults.length,
        skipped: 0,
        results: blockedResults,
      });
    }
    for (const batch of plan.batches) {
      const batchResult = await runBatch(batch.items, {
        rootOutputDir: batchRoot,
        batchNumber: batch.batchNumber,
        totalBatches: batch.totalBatches,
        concurrency,
        baseUrl: envInfo.env.OPENAI_BASE_URL,
        apiKey: envInfo.env.OPENAI_API_KEY,
        model: envInfo.env.OPENAI_MODEL || 'gpt-image-2',
        responsesModel: envInfo.env.OPENAI_RESPONSES_MODEL || 'gpt-5.4',
        generatePath: options.generatePath || envInfo.env.OPENAI_IMAGE_GENERATE_PATH || '',
        editPath: options.editPath || envInfo.env.OPENAI_IMAGE_EDIT_PATH || '',
        width,
        height,
        outputFormat,
        timeoutSeconds,
        retryCount,
        skipExisting: parseBoolean(options.skipExisting, false),
        offsetBase: batch.offsetBase,
        readJson,
      });
      batchManifests.push(batchResult.manifest);
      allResults.push(...batchResult.manifest.results);
    }
  }

  const manifest = {
    runtimeMode: 'local-batch-runner',
    dryRun: Boolean(options.dryRun),
    promptSource: promptCopy,
    promptSourceOriginal: promptsFile,
    selectedCount: selectedPrompts.length,
    batchSize: plan.batchSize,
    batchCount: plan.batchCount + (materialSplit.blocked.length && !options.dryRun ? 1 : 0),
    model: envInfo.env.OPENAI_MODEL || 'gpt-image-2',
    defaultSize: `${width}x${height}`,
    outputFormat,
    generatePath: options.generatePath || envInfo.env.OPENAI_IMAGE_GENERATE_PATH || '',
    editPath: options.editPath || envInfo.env.OPENAI_IMAGE_EDIT_PATH || '',
    skipExisting: parseBoolean(options.skipExisting, false),
    generatedAt: new Date().toISOString(),
    resumeManifest: options.resumeManifestFile || null,
    failedOnly,
    success: allResults.filter((item) => item.ok && !item.skipped).length,
    skipped: allResults.filter((item) => item.skipped).length,
    failed: allResults.filter((item) => !item.ok).length,
    batches: batchManifests,
  };
  const manifestPath = path.join(outputDir, 'internal', 'local_execution_raw.json');
  writeJson(manifestPath, manifest);

  const workspace = refreshWorkspace({
    outputDir,
    taskSpecFile,
    promptsFile: promptCopy,
    manifestFile: manifestPath,
    materialBaseDir: materialBaseDirFromRunPlan(outputDir) || (taskSpecFile ? path.dirname(path.resolve(taskSpecFile)) : null),
    materialsFile: taskSpecFile,
  });

  return {
    outputDir,
    workspaceIndex: workspace.workspaceIndex,
    success: manifest.success,
    failed: manifest.failed,
    skipped: manifest.skipped,
    batchCount: manifest.batchCount,
  };
}

module.exports = {
  executeTask,
  buildExecutionPlan,
  selectFailedPrompts,
  dryRunResults,
  materialBaseDirFromRunPlan,
};
