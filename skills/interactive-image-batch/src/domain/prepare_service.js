const path = require('path');
const {
  ensureV2Layout,
  readJson,
  writeJson,
  toArray,
} = require('../shared/workspace');
const {
  validateTaskSpec,
  validatePromptStrategy,
  validatePromptList,
} = require('../contracts');
const { refreshWorkspace } = require('./workspace_service');
const { buildGeneratedPrompts } = require('./prompt_builder');
const { normalizePromptMaterials } = require('./material_resolver');
const { syncWorkspaceToDbIfAvailable } = require('../db/sync');

function buildBatchPlan(prompts, batchSize) {
  const size = Math.max(1, Number(batchSize || prompts.length || 1));
  const batches = [];
  for (let i = 0; i < prompts.length; i += size) {
    const items = prompts.slice(i, i + size);
    batches.push({
      batchNumber: batches.length + 1,
      promptCount: items.length,
      firstIndex: items[0]?.index ?? i + 1,
      lastIndex: items[items.length - 1]?.index ?? i + items.length,
    });
  }
  return batches;
}

function prepareTask(options = {}) {
  if (!options.taskSpecFile) throw new Error('缺少 --task-spec');
  const outputDir = ensureV2Layout(options.outputDir || path.join(path.dirname(path.resolve(options.taskSpecFile)), 'daoge_output'));
  const taskSpec = readJson(options.taskSpecFile);
  const strategy = options.strategyFile ? readJson(options.strategyFile) : {};
  const rawPrompts = options.promptsFile
    ? readJson(options.promptsFile)
    : buildGeneratedPrompts({ taskSpec, promptStrategy: strategy, taskSpecFile: options.taskSpecFile });
  const promptSourceFile = options.promptsFile || path.join(outputDir, 'debug', 'prompts.generated.json');
  const resolvedPrompts = normalizePromptMaterials(rawPrompts, {
    promptsFile: options.promptsFile || null,
    baseDir: path.dirname(path.resolve(options.taskSpecFile)),
  });
  const prompts = resolvedPrompts.prompts;

  const taskReport = validateTaskSpec(taskSpec);
  const strategyReport = validatePromptStrategy(strategy);
  const promptReport = validatePromptList(prompts);
  const validationReport = {
    ok: taskReport.ok && strategyReport.ok && promptReport.ok && resolvedPrompts.issues.length === 0,
    errors: [
      ...taskReport.errors,
      ...strategyReport.errors,
      ...promptReport.errors,
      ...resolvedPrompts.issues.map((issue) => issue.message),
    ],
    warnings: [...taskReport.warnings, ...strategyReport.warnings, ...promptReport.warnings],
  };

  const internalDir = path.join(outputDir, 'internal');
  const debugDir = path.join(outputDir, 'debug');
  const normalizedTaskSpec = path.join(debugDir, 'task_spec.normalized.json');
  const normalizedStrategy = path.join(debugDir, 'prompt_strategy.normalized.json');
  const promptCopy = path.join(debugDir, 'prompts.generated.json');
  const validationPath = path.join(debugDir, 'prompt_validation_report.json');
  const batchPlanPath = path.join(internalDir, 'batch_plan.json');
  const manifestPath = path.join(internalDir, 'prepare_manifest.json');
  const promptItems = toArray(prompts);
  const batchPlan = buildBatchPlan(promptItems, options.batchSize || taskSpec.batch_size);

  writeJson(normalizedTaskSpec, taskReport.normalized);
  writeJson(normalizedStrategy, strategyReport.normalized);
  writeJson(promptCopy, promptItems);
  writeJson(validationPath, validationReport);
  writeJson(batchPlanPath, batchPlan);
  writeJson(manifestPath, {
    runtimeMode: 'prepare-only',
    promptSource: promptCopy,
    promptSourceOriginal: options.promptsFile ? path.resolve(options.promptsFile) : null,
    promptSourceMode: options.promptsFile ? 'user-provided' : 'generated-from-task-spec',
    selectedCount: promptItems.length,
    batchCount: batchPlan.length,
    batchSize: Number(options.batchSize || taskSpec.batch_size || 0) || null,
    defaultSize: taskSpec.width && taskSpec.height ? `${taskSpec.width}x${taskSpec.height}` : null,
    generatedAt: new Date().toISOString(),
  });

  const workspace = refreshWorkspace({
    outputDir,
    taskSpecFile: normalizedTaskSpec,
    promptsFile: promptCopy,
    batchPlanFile: batchPlanPath,
    validationReportFile: validationPath,
    manifestFile: manifestPath,
    materialBaseDir: path.dirname(path.resolve(options.taskSpecFile)),
    materialsFile: options.taskSpecFile,
    intent: options.intent,
  });
  const dbSync = syncWorkspaceToDbIfAvailable(outputDir, {
    snapshotPrefix: 'run_prepare',
    manifestFile: manifestPath,
    phase: 'prepare',
  });

  return {
    outputDir,
    workspaceIndex: workspace.workspaceIndex,
    database: dbSync.dbPath || null,
    dbWarning: dbSync.dbWarning || null,
    validation: validationReport,
    batchPlan: batchPlanPath,
    promptsFile: promptCopy,
    promptSource: promptSourceFile,
  };
}

module.exports = { prepareTask, buildBatchPlan };
