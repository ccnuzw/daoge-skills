const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

function required(args, key) {
  if (!args[key]) throw new Error(`Missing required flag: --${key}`);
  return path.resolve(args[key]);
}

function runNode(scriptPath, cliArgs) {
  execFileSync(process.execPath, [scriptPath, ...cliArgs], { stdio: 'inherit' });
}

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Required file not found: ${filePath}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function mergeAutofillPolicy(strategyPolicy, templatePolicy) {
  if (!templatePolicy) return strategyPolicy || null;
  if (!strategyPolicy) return templatePolicy;
  return {
    ...templatePolicy,
    ...strategyPolicy,
    rules: [
      ...(templatePolicy.rules || []),
      ...(strategyPolicy.rules || []),
    ],
  };
}

function enrichStrategyFromTemplate(strategyPath, modePath, outputPath) {
  const strategy = readJson(strategyPath);
  const mode = readJson(modePath);
  const template = mode.detected_template || {};
  const enriched = {
    ...strategy,
    template_variant: strategy.template_variant || template.variants?.[0] || null,
    variant_axes: (strategy.variant_axes && strategy.variant_axes.length) ? strategy.variant_axes : (template.default_variant_axes || []),
    autofill_policy: mergeAutofillPolicy(strategy.autofill_policy, template.autofill_policy),
    template_doc: template.template_doc || strategy.template_doc || null,
  };
  writeJson(outputPath, enriched);
  return outputPath;
}

function hasStoryboardPlan(taskSpecPath) {
  const taskSpec = readJson(taskSpecPath);
  return Boolean(taskSpec.storyboard_plan && taskSpec.storyboard_plan.enabled);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const taskSpecPath = required(args, 'task-spec');
  const strategyPath = required(args, 'strategy-file');
  const promptsFile = required(args, 'prompts-file');

  const outputDir = path.resolve(args['output-dir'] || path.dirname(promptsFile));
  fs.mkdirSync(outputDir, { recursive: true });

  const scriptsDir = __dirname;
  const normalizedTaskSpec = path.join(outputDir, 'task_spec.normalized.json');
  const normalizedStrategy = path.join(outputDir, 'prompt_strategy.normalized.json');
  const enrichedStrategy = path.join(outputDir, 'prompt_strategy.enriched.json');
  const strategyValidationReport = path.join(outputDir, 'prompt_strategy_validation_report.json');
  const promptSlots = path.join(outputDir, 'prompt_slots.json');
  const variantMatrixPlan = path.join(outputDir, 'variant_matrix_plan.json');
  const promptDraftBundle = path.join(outputDir, 'prompt_draft_bundle.json');
  const promptValidationReport = path.join(outputDir, 'prompt_validation_report.json');
  const promptPreview = path.join(outputDir, 'prompt_preview.md');
  const batchPlan = path.join(outputDir, 'batch_plan.json');
  const daogeSummary = path.join(outputDir, 'daoge_run_summary.md');
  const daogePreflight = path.join(outputDir, 'daoge_preflight_dashboard.md');
  const daogeModeDetection = path.join(outputDir, 'daoge_mode_detection.json');
  const storyboardBundleValidation = path.join(outputDir, 'storyboard_bundle.validation.json');

  runNode(path.join(scriptsDir, 'validate_task_spec.js'), [
    '--task-spec', taskSpecPath,
    '--output-file', normalizedTaskSpec,
  ]);

  runNode(path.join(scriptsDir, 'validate_prompt_strategy.js'), [
    '--strategy-file', strategyPath,
    '--task-spec', normalizedTaskSpec,
    '--output-file', normalizedStrategy,
    '--report-file', strategyValidationReport,
  ]);

  runNode(path.join(scriptsDir, 'detect_daoge_mode.js'), [
    '--task-spec', normalizedTaskSpec,
    '--strategy-file', normalizedStrategy,
    '--output-file', daogeModeDetection,
  ]);

  const storyboardEnabled = hasStoryboardPlan(normalizedTaskSpec);
  if (storyboardEnabled) {
    runNode(path.join(scriptsDir, 'validate_storyboard_bundle.js'), [
      '--task-spec', normalizedTaskSpec,
      '--output-file', storyboardBundleValidation,
    ]);
  }

  enrichStrategyFromTemplate(normalizedStrategy, daogeModeDetection, enrichedStrategy);

  runNode(path.join(scriptsDir, 'scaffold_prompt_bundle.js'), [
    '--strategy-file', enrichedStrategy,
    '--mode-file', daogeModeDetection,
    ...(storyboardEnabled ? ['--storyboard-file', storyboardBundleValidation] : []),
    '--output-file', promptSlots,
    '--matrix-plan-file', variantMatrixPlan,
  ]);

  runNode(path.join(scriptsDir, 'materialize_prompt_drafts.js'), [
    '--slots-file', promptSlots,
    '--output-file', promptDraftBundle,
  ]);

  runNode(path.join(scriptsDir, 'validate_prompt_bundle.js'), [
    '--prompts-file', promptsFile,
    '--task-spec', normalizedTaskSpec,
    '--output-file', promptValidationReport,
  ]);

  runNode(path.join(scriptsDir, 'render_prompt_preview.js'), [
    '--prompts-file', promptsFile,
    '--batch-size', String(args['batch-size'] || ''),
    '--preview-count', String(args['preview-count'] || ''),
    '--output-file', promptPreview,
    '--plan-file', batchPlan,
    '--summary-file', daogeSummary,
  ].filter((item) => item !== ''));

  ensureFile(promptPreview);
  ensureFile(batchPlan);
  ensureFile(daogeSummary);
  ensureFile(promptValidationReport);

  runNode(path.join(scriptsDir, 'render_preflight_dashboard.js'), [
    '--task-spec', normalizedTaskSpec,
    '--strategy-file', enrichedStrategy,
    '--prompts-file', promptsFile,
    '--validation-report', promptValidationReport,
    '--preview-file', promptPreview,
    '--plan-file', batchPlan,
    '--summary-file', daogeSummary,
    '--mode-file', daogeModeDetection,
    '--draft-file', promptDraftBundle,
    '--matrix-plan-file', variantMatrixPlan,
    ...(storyboardEnabled ? ['--storyboard-file', storyboardBundleValidation] : []),
    '--output-file', daogePreflight,
  ]);

  console.log(JSON.stringify({
    outputDir,
    normalizedTaskSpec,
    normalizedStrategy,
    enrichedStrategy,
    promptSlots,
    variantMatrixPlan,
    promptDraftBundle,
    storyboardBundleValidation: storyboardEnabled ? storyboardBundleValidation : null,
    promptValidationReport,
    promptPreview,
    batchPlan,
    daogeSummary,
    daogeModeDetection,
    daogePreflight,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
