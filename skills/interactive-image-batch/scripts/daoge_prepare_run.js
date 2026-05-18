const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs, readJson, writeJson } = require('./script_utils');
const { ensurePortalUiAssets } = require('./portal_ui_shared');

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
  let taskSpecPath = required(args, 'task-spec');
  const strategyPath = required(args, 'strategy-file');
  const promptsFile = required(args, 'prompts-file');

  const outputDir = path.resolve(args['output-dir'] || path.dirname(promptsFile));
  fs.mkdirSync(outputDir, { recursive: true });
  ensurePortalUiAssets(outputDir);

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
  const promptPreviewBoard = path.join(outputDir, 'prompt_preview.html');
  const batchPlan = path.join(outputDir, 'batch_plan.json');
  const daogeSummary = path.join(outputDir, 'daoge_run_summary.md');
  const daogePreflight = path.join(outputDir, 'daoge_preflight_dashboard.md');
  const preflightBoard = path.join(outputDir, 'preflight_board.html');
  const daogeModeDetection = path.join(outputDir, 'daoge_mode_detection.json');
  const storyboardBundleValidation = path.join(outputDir, 'storyboard_bundle.validation.json');
  const importedReferenceBindings = path.join(outputDir, 'reference_bindings.imported.json');
  const importedTaskSpec = path.join(outputDir, 'task_spec.with_imported_assets.json');
  const importedReferenceAnalysis = path.join(outputDir, 'reference_asset_analysis.json');
  const assetsBoard = path.join(outputDir, 'assets_board.html');
  const bindingIntentDraft = path.join(outputDir, 'binding_intent_draft.json');
  const bindingPlan = path.join(outputDir, 'binding_plan.json');
  const bindingConfirmation = path.join(outputDir, 'binding_confirmation.md');
  const bindingConversationCard = path.join(outputDir, 'binding_conversation_card.md');

  if (args['import-reference-assets'] === 'true' || args['import-reference-assets'] === '1') {
    if ((args['use-llm-binding-planner'] === 'true' || args['use-llm-binding-planner'] === '1') && args['binding-text']) {
      const draftArgs = [
        '--task-spec', taskSpecPath,
        '--binding-text', args['binding-text'],
        '--output-file', bindingIntentDraft,
      ];
      if (args.references) draftArgs.push('--references', args.references);
      if (args['slot-order']) draftArgs.push('--slot-order', args['slot-order']);
      if (args['generate-only']) draftArgs.push('--generate-only', args['generate-only']);
      if (args['env-file']) draftArgs.push('--env-file', path.resolve(args['env-file']));
      if (args['responses-model']) draftArgs.push('--responses-model', args['responses-model']);
      runNode(path.join(scriptsDir, 'generate_binding_intent_draft.js'), draftArgs);

      const planArgs = [
        '--draft-file', bindingIntentDraft,
        '--output-file', bindingPlan,
      ];
      if (args.references) planArgs.push('--references', args.references);
      runNode(path.join(scriptsDir, 'plan_binding_from_draft.js'), planArgs);
    }

    const importArgs = [
      '--task-spec', taskSpecPath,
      '--output-dir', outputDir,
      '--output-file', importedReferenceBindings,
      '--task-spec-output', importedTaskSpec,
      '--analysis-report-file', importedReferenceAnalysis,
    ];
    if (args['assets-manifest']) importArgs.push('--assets-manifest', path.resolve(args['assets-manifest']));
    if (args.references) importArgs.push('--references', args.references);
    if (args.masks) importArgs.push('--masks', args.masks);
    if (args['slot-order']) importArgs.push('--slot-order', args['slot-order']);
    if (args['binding-text']) importArgs.push('--binding-text', args['binding-text']);
    if ((args['use-llm-binding-planner'] === 'true' || args['use-llm-binding-planner'] === '1') && args['binding-text']) {
      importArgs.push('--binding-draft-file', bindingIntentDraft);
      importArgs.push('--binding-plan-file', bindingPlan);
    }
    if (args['generate-only']) importArgs.push('--generate-only', args['generate-only']);
    if (args['assets-dir']) importArgs.push('--assets-dir', path.resolve(args['assets-dir']));
    if (args['enable-vision-analysis']) importArgs.push('--enable-vision-analysis', args['enable-vision-analysis']);
    if (args['env-file']) importArgs.push('--env-file', path.resolve(args['env-file']));
    if (args['responses-model']) importArgs.push('--responses-model', args['responses-model']);
    if (args['vision-timeout-ms']) importArgs.push('--vision-timeout-ms', args['vision-timeout-ms']);
    runNode(path.join(scriptsDir, 'import_reference_assets.js'), importArgs);
    runNode(path.join(scriptsDir, 'render_binding_confirmation.js'), [
      '--analysis-file', importedReferenceAnalysis,
      '--bindings-file', importedReferenceBindings,
      ...((args['use-llm-binding-planner'] === 'true' || args['use-llm-binding-planner'] === '1') ? ['--plan-file', bindingPlan] : []),
      '--output-file', bindingConfirmation,
    ]);
    runNode(path.join(scriptsDir, 'render_binding_conversation_card.js'), [
      '--bindings-file', importedReferenceBindings,
      ...((args['use-llm-binding-planner'] === 'true' || args['use-llm-binding-planner'] === '1') ? ['--plan-file', bindingPlan] : []),
      '--output-file', bindingConversationCard,
    ]);
    runNode(path.join(scriptsDir, 'render_assets_board.js'), [
      '--bindings-file', importedReferenceBindings,
      '--analysis-file', importedReferenceAnalysis,
      '--output-file', assetsBoard,
    ]);
    taskSpecPath = importedTaskSpec;
  }

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

  runNode(path.join(scriptsDir, 'render_prompt_preview_board.js'), [
    '--prompts-file', promptsFile,
    '--plan-file', batchPlan,
    '--summary-file', daogeSummary,
    '--markdown-file', promptPreview,
    '--preview-count', String(args['preview-count'] || ''),
    '--output-file', promptPreviewBoard,
  ].filter((item) => item !== ''));

  ensureFile(promptPreview);
  ensureFile(promptPreviewBoard);
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

  runNode(path.join(scriptsDir, 'render_preflight_board.js'), [
    '--task-spec', normalizedTaskSpec,
    '--strategy-file', enrichedStrategy,
    '--prompts-file', promptsFile,
    '--validation-report', promptValidationReport,
    '--preview-file', promptPreview,
    '--plan-file', batchPlan,
    '--summary-file', daogeSummary,
    '--mode-file', daogeModeDetection,
    ...(storyboardEnabled ? ['--storyboard-file', storyboardBundleValidation] : []),
    '--output-file', preflightBoard,
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
    importedReferenceAnalysis: (args['import-reference-assets'] === 'true' || args['import-reference-assets'] === '1') ? importedReferenceAnalysis : null,
    assetsBoard: (args['import-reference-assets'] === 'true' || args['import-reference-assets'] === '1') ? assetsBoard : null,
    bindingConfirmation: (args['import-reference-assets'] === 'true' || args['import-reference-assets'] === '1') ? bindingConfirmation : null,
    bindingConversationCard: (args['import-reference-assets'] === 'true' || args['import-reference-assets'] === '1') ? bindingConversationCard : null,
    promptValidationReport,
    promptPreview,
    promptPreviewBoard,
    batchPlan,
    daogeSummary,
    daogeModeDetection,
    daogePreflight,
    preflightBoard,
    bindingIntentDraft: (args['use-llm-binding-planner'] === 'true' || args['use-llm-binding-planner'] === '1') ? bindingIntentDraft : null,
    bindingPlan: (args['use-llm-binding-planner'] === 'true' || args['use-llm-binding-planner'] === '1') ? bindingPlan : null,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
