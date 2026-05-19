const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs, ensureDir, readJson, writeJson } = require('./script_utils');

function required(args, key) {
  if (!args[key]) throw new Error(`Missing required flag: --${key}`);
  return path.resolve(args[key]);
}

function runNode(scriptName, cliArgs) {
  execFileSync(process.execPath, [path.join(__dirname, scriptName), ...cliArgs], { stdio: 'pipe' });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const exampleFile = required(args, 'example-file');
  const outputDir = path.resolve(args['output-dir'] || path.join(path.dirname(exampleFile), 'quickstart-out'));
  ensureDir(outputDir);

  const taskSpecQuickstart = path.join(outputDir, 'task_spec.quickstart.json');
  const strategyQuickstart = path.join(outputDir, 'prompt_strategy.quickstart.json');
  const taskSpecNormalized = path.join(outputDir, 'task_spec.normalized.json');
  const strategyNormalized = path.join(outputDir, 'prompt_strategy.normalized.json');
  const strategyValidationReport = path.join(outputDir, 'prompt_strategy_validation_report.json');
  const modeDetection = path.join(outputDir, 'daoge_mode_detection.json');
  const storyboardValidation = path.join(outputDir, 'storyboard_bundle.validation.quickstart.json');
  const promptSlots = path.join(outputDir, 'prompt_slots.quickstart.json');
  const variantMatrixPlan = path.join(outputDir, 'variant_matrix_plan.quickstart.json');
  const promptDraftBundle = path.join(outputDir, 'prompt_draft_bundle.quickstart.json');
  const promptsQuickstart = path.join(outputDir, 'prompts.generated.quickstart.json');
  const prepareOutputDir = path.join(outputDir, 'prepare');

  runNode('build_example_quickstart.js', [
    '--example-file', exampleFile,
    '--output-dir', outputDir,
  ]);

  runNode('validate_task_spec.js', [
    '--task-spec', taskSpecQuickstart,
    '--output-file', taskSpecNormalized,
  ]);

  runNode('validate_prompt_strategy.js', [
    '--strategy-file', strategyQuickstart,
    '--task-spec', taskSpecNormalized,
    '--output-file', strategyNormalized,
    '--report-file', strategyValidationReport,
  ]);

  runNode('detect_daoge_mode.js', [
    '--task-spec', taskSpecNormalized,
    '--strategy-file', strategyNormalized,
    '--output-file', modeDetection,
  ]);

  const normalizedTask = readJson(taskSpecNormalized);
  const storyboardEnabled = Boolean(normalizedTask.storyboard_plan && normalizedTask.storyboard_plan.enabled);
  if (storyboardEnabled) {
    runNode('validate_storyboard_bundle.js', [
      '--task-spec', taskSpecNormalized,
      '--output-file', storyboardValidation,
    ]);
  }

  runNode('scaffold_prompt_bundle.js', [
    '--strategy-file', strategyNormalized,
    '--mode-file', modeDetection,
    ...(storyboardEnabled ? ['--storyboard-file', storyboardValidation] : []),
    '--output-file', promptSlots,
    '--matrix-plan-file', variantMatrixPlan,
  ]);

  runNode('materialize_prompt_drafts.js', [
    '--slots-file', promptSlots,
    '--output-file', promptDraftBundle,
  ]);

  const draftBundle = readJson(promptDraftBundle);
  writeJson(promptsQuickstart, draftBundle);

  runNode('daoge_prepare_run.js', [
    '--task-spec', taskSpecQuickstart,
    '--strategy-file', strategyQuickstart,
    '--prompts-file', promptsQuickstart,
    '--output-dir', prepareOutputDir,
    '--batch-size', '2',
    '--preview-count', '4',
  ]);

  console.log(JSON.stringify({
    exampleFile,
    outputDir,
    taskSpecQuickstart,
    strategyQuickstart,
    taskSpecNormalized,
    strategyNormalized,
    modeDetection,
    storyboardValidation: storyboardEnabled ? storyboardValidation : null,
    promptSlots,
    variantMatrixPlan,
    promptDraftBundle,
    promptsQuickstart,
    prepareOutputDir,
    preflightBoard: path.join(prepareOutputDir, 'preflight_board.html'),
    promptPreviewBoard: path.join(prepareOutputDir, 'prompt_preview.html'),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
