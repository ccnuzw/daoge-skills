const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./script_utils');
const {
  ensureString,
  parseBoolean,
  readJson,
  resolvePath,
  normalizeLayoutManifest,
  normalizeContentManifest,
  normalizeRenderConfig,
  normalizeReferenceBindings,
  buildStoryboardBlueprint,
  summarizeStoryboard,
} = require('./storyboard_manifest_utils');

function loadTaskStoryboard(taskSpecPath) {
  const taskSpec = readJson(taskSpecPath);
  const plan = taskSpec.storyboard_plan || {};
  return {
    taskSpec,
    plan,
    taskSpecPath,
  };
}

function requireExisting(filePath, label, errors) {
  if (!filePath) {
    errors.push(`缺少 ${label} 路径`);
    return false;
  }
  if (!fs.existsSync(filePath)) {
    errors.push(`${label} 不存在: ${filePath}`);
    return false;
  }
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['task-spec']) throw new Error('Missing required flag: --task-spec');

  const taskSpecPath = path.resolve(args['task-spec']);
  const { taskSpec, plan } = loadTaskStoryboard(taskSpecPath);
  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(taskSpecPath), 'storyboard_bundle.validation.json'));
  const errors = [];
  const warnings = [];

  if (parseBoolean(plan.enabled, false) !== true) {
    throw new Error('task_spec.storyboard_plan.enabled is not true');
  }

  const taskBaseDir = path.dirname(taskSpecPath);
  const layoutPath = resolvePath(plan.layout_manifest, taskBaseDir);
  const contentPath = resolvePath(plan.content_manifest, taskBaseDir);
  const renderPath = resolvePath(plan.render_config, taskBaseDir);
  const referenceBindingsPath = resolvePath(plan.reference_bindings, taskBaseDir);

  const hasLayout = requireExisting(layoutPath, 'layout_manifest', errors);
  const hasContent = requireExisting(contentPath, 'content_manifest', errors);
  const hasRender = requireExisting(renderPath, 'render_config', errors);
  const hasBindings = referenceBindingsPath ? requireExisting(referenceBindingsPath, 'reference_bindings', errors) : false;

  let result = {
    ok: false,
    errors,
    warnings,
    summary: null,
    layout: null,
    content: null,
    render: null,
    slot_blueprint: [],
    generation_slots: [],
  };

  if (!errors.length && hasLayout && hasContent && hasRender) {
    const layout = normalizeLayoutManifest(readJson(layoutPath), layoutPath, errors);
    const content = normalizeContentManifest(readJson(contentPath), contentPath, errors);
    const render = normalizeRenderConfig(readJson(renderPath), renderPath);
    const referenceBindings = hasBindings ? normalizeReferenceBindings(readJson(referenceBindingsPath), referenceBindingsPath) : null;
    const blueprint = buildStoryboardBlueprint({ layout, content, render, referenceBindings, errors, warnings });

    if (layout.canvas.width && taskSpec.width && Number(layout.canvas.width) !== Number(taskSpec.width)) {
      warnings.push(`layout canvas width ${layout.canvas.width} 与 task_spec.width ${taskSpec.width} 不一致`);
    }
    if (layout.canvas.height && taskSpec.height && Number(layout.canvas.height) !== Number(taskSpec.height)) {
      warnings.push(`layout canvas height ${layout.canvas.height} 与 task_spec.height ${taskSpec.height} 不一致`);
    }
    if (!blueprint.filter((item) => item.generate_image !== false).length) {
      errors.push('storyboard blueprint 没有可生图的 generation slot');
    }

    result = {
      ok: errors.length === 0,
      errors,
      warnings,
      summary: summarizeStoryboard(layout, content, render, blueprint),
      layout,
      content,
      render,
      reference_bindings: referenceBindings,
      slot_blueprint: blueprint,
      generation_slots: blueprint.filter((item) => item.generate_image !== false),
    };
  }

  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({
    outputPath,
    ok: result.ok,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    generationSlotCount: result.generation_slots.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
