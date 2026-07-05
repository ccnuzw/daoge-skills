const path = require('path');
const {
  parseArgs,
  readJsonIfExists,
  writeJson,
  toArray,
  normalizeText,
  ensureV2Layout,
  resolveTask,
} = require('./workspace_v2_shared');

function normalizeMaterialItem(item, index, fallbackKind, baseDir = null) {
  const raw = typeof item === 'string' ? { path: item } : (item || {});
  return {
    id: normalizeText(raw.id, `${fallbackKind}_${String(index + 1).padStart(3, '0')}`),
    title: normalizeText(raw.title || raw.name || raw.label, `${fallbackKind === 'mask' ? '遮罩' : '素材'} ${String(index + 1).padStart(3, '0')}`),
    path: normalizeText(raw.path || raw.file || raw.source || raw.href),
    baseDir,
    category: normalizeText(raw.category || raw.group || raw.kind),
    note: normalizeText(raw.note || raw.description),
  };
}

function importedBindingMaterials(taskSpec, baseDir = null) {
  const bindingsPath = taskSpec.storyboard_plan?.reference_bindings;
  const absoluteBindingsPath = bindingsPath
    ? (path.isAbsolute(bindingsPath) ? bindingsPath : path.resolve(baseDir || process.cwd(), bindingsPath))
    : null;
  const bindings = readJsonIfExists(absoluteBindingsPath) || {};
  return toArray(bindings.reference_assets).map((asset, index) => ({
    id: normalizeText(asset.asset_id || asset.id, `${asset.asset_type === 'mask' ? 'mask' : 'reference'}_${String(index + 1).padStart(3, '0')}`),
    title: normalizeText(asset.label || asset.title, asset.asset_type === 'mask' ? `遮罩 ${String(index + 1).padStart(3, '0')}` : `参考素材 ${String(index + 1).padStart(3, '0')}`),
    path: normalizeText(asset.path),
    baseDir,
    category: normalizeText(asset.asset_type || asset.type, 'reference'),
    note: normalizeText(asset.notes),
    assetType: normalizeText(asset.asset_type || asset.type, 'reference'),
  }));
}

function buildMaterialList(taskSpec, promptsFile, baseDir = null) {
  const sourceFiles = toArray(taskSpec.source_files || taskSpec.source_images || taskSpec.inputs);
  const referenceFiles = toArray(taskSpec.reference_images || taskSpec.references);
  const maskFiles = toArray(taskSpec.masks);
  const bindingMaterials = importedBindingMaterials(taskSpec, baseDir);
  const bindingReferences = bindingMaterials.filter((item) => item.assetType !== 'mask');
  const bindingMasks = bindingMaterials.filter((item) => item.assetType === 'mask');
  const inputs = sourceFiles.map((item, index) => normalizeMaterialItem(item, index, 'input', baseDir));
  if (promptsFile) {
    inputs.push({
      id: 'input_prompt_plan',
      title: '提示词文档',
      path: promptsFile,
      baseDir: path.dirname(path.resolve(promptsFile)),
      category: '任务文档',
      note: '本轮准备阶段使用的提示词清单',
    });
  }
  inputs.push({
    id: 'input_task_brief',
    title: '任务说明',
    path: null,
    category: '任务文档',
    note: normalizeText(taskSpec.content_brief, '当前任务说明'),
  });
  return {
    inputs,
    references: referenceFiles.map((item, index) => normalizeMaterialItem(item, index, 'reference', baseDir)).concat(bindingReferences),
    masks: maskFiles.map((item, index) => normalizeMaterialItem(item, index, 'mask', baseDir)).concat(bindingMasks),
  };
}

function buildRunPlan(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const taskSpec = readJsonIfExists(options.taskSpecFile) || {};
  const materialSpec = readJsonIfExists(options.materialsFile) || taskSpec;
  const prompts = toArray(readJsonIfExists(options.promptsFile));
  const batchPlan = toArray(readJsonIfExists(options.batchPlanFile));
  const validation = readJsonIfExists(options.validationReportFile) || {};
  const mode = readJsonIfExists(options.modeFile) || {};
  const manifest = readJsonIfExists(options.manifestFile) || {};
  const task = resolveTask({
    intent: options.intent,
    contentBrief: taskSpec.content_brief || manifest.contentBrief,
    outputMode: taskSpec.output_mode,
    summary: taskSpec.content_brief || manifest.promptSourceOriginal,
  });

  const errors = toArray(validation.errors);
  const warnings = toArray(validation.warnings);
  const canRun = validation.ok !== false && errors.length === 0;
  const width = Number(taskSpec.width || String(manifest.defaultSize || '').split('x')[0] || 0) || null;
  const height = Number(taskSpec.height || String(manifest.defaultSize || '').split('x')[1] || 0) || null;
  const taskSpecBaseDir = options.materialBaseDir
    ? path.resolve(options.materialBaseDir)
    : (options.materialsFile
      ? path.dirname(path.resolve(options.materialsFile))
      : (options.taskSpecFile ? path.dirname(path.resolve(options.taskSpecFile)) : outputDir));
  const materialList = buildMaterialList(materialSpec, options.promptsFile, taskSpecBaseDir);
  const materials = {
    baseDir: taskSpecBaseDir,
    inputs: materialList.inputs,
    references: materialList.references,
    masks: materialList.masks,
    inputCount: materialList.inputs.length,
    referenceCount: materialList.references.length,
    maskCount: materialList.masks.length,
    enoughForStart: true,
    notes: materialList.inputs.length > 1 || materialList.references.length
      ? ['当前素材已纳入准备检查']
      : ['参考图较少，结果风格可能更自由'],
  };

  const runPlan = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    phase: 'prepare',
    task,
    readiness: {
      canRun,
      headline: canRun ? '可以开跑' : '先补准备',
      summary: canRun
        ? '提示词、尺寸和素材已完成开跑前检查'
        : '还有准备项需要处理后再开跑',
      blockingItems: errors.map((item) => String(item)),
      attentionItems: warnings.length ? warnings.map((item) => String(item)) : materials.notes,
    },
    promptPlan: {
      promptCount: prompts.length || Number(manifest.selectedCount || 0),
      batchCount: batchPlan.length || Number(manifest.batchCount || 0),
      batchSize: Number(taskSpec.batch_size || manifest.batchSize || 0) || null,
      size: width && height ? `${width}x${height}` : normalizeText(manifest.defaultSize, '未指定'),
      items: prompts.map((item, index) => ({
        id: `prompt_${String(index + 1).padStart(3, '0')}`,
        userTitle: normalizeText(item.title, `${task.title} ${String(index + 1).padStart(3, '0')}`),
        summary: normalizeText(item.scene || item.composition || item.generation_prompt, '待生成画面'),
      })),
    },
    materials,
    source: {
      mode: normalizeText(mode.mode, normalizeText(manifest.runtimeMode, 'prepare-only')),
    },
  };

  const outputFile = options.outputFile || path.join(outputDir, 'internal', 'run_plan.json');
  writeJson(outputFile, runPlan);
  return runPlan;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args['output-dir'] || process.cwd();
  const runPlan = buildRunPlan({
    outputDir,
    outputFile: args['output-file'],
    taskSpecFile: args['task-spec'],
    promptsFile: args['prompts-file'],
    batchPlanFile: args['batch-plan'],
    validationReportFile: args['validation-report'],
    modeFile: args['mode-file'],
    manifestFile: args['manifest-file'],
    intent: args.intent,
    materialBaseDir: args['material-base-dir'],
    materialsFile: args['materials-file'],
  });
  console.log(JSON.stringify({ ok: true, outputDir: path.resolve(outputDir), task: runPlan.task.id }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

module.exports = { buildRunPlan, buildMaterialList, normalizeMaterialItem, importedBindingMaterials };
