const fs = require('fs');
const path = require('path');
const {
  parseArgs,
  readJsonIfExists,
  writeJson,
  toArray,
  normalizeText,
  ensureV2Layout,
  numberedName,
  copyFileIfExists,
  relativeToOutput,
  resultDisplayTitle,
  publicAsset,
  userFilePart,
  escapeHtml,
} = require('./workspace_v2_shared');

function extensionForResult(result) {
  if (result.status === 'failed') return '.json';
  const source = result.sourceOutput || result.output || '';
  const ext = path.extname(String(source)).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
}

function createFailureRecord(targetPath, result) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify({
    title: result.title,
    status: '生成失败',
    error: result.error || '生成失败',
  }, null, 2)}\n`);
}

function usage(overrides = {}) {
  return {
    canSelect: false,
    needsReview: false,
    hasIssue: false,
    canExport: false,
    ...overrides,
  };
}

function assetRecord(fields) {
  return {
    id: fields.id,
    kind: fields.kind,
    userTitle: fields.userTitle,
    userStatus: fields.userStatus,
    path: fields.path,
    previewPath: fields.previewPath || null,
    group: fields.group,
    usage: usage(fields.usage),
    source: {
      stage: fields.source?.stage || 'prepare',
    },
  };
}

function materialExtension(sourcePath, fallback = '.json') {
  const ext = path.extname(String(sourcePath || '')).toLowerCase();
  return ext || fallback;
}

function writeMaterialPlaceholder(targetPath, material, kind) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  writeJson(targetPath, {
    title: material.title,
    kind,
    note: material.note || null,
  });
}

function resolveMaterialSource(outputDir, material, defaultBaseDir = null) {
  if (!material.path) return null;
  const text = String(material.path).trim();
  if (!text) return null;
  if (path.isAbsolute(text)) return text;
  const baseDir = material.baseDir || defaultBaseDir || outputDir;
  const baseCandidate = path.resolve(baseDir, text);
  if (fs.existsSync(baseCandidate)) return baseCandidate;
  return path.resolve(outputDir, text);
}

function copyOrDescribeMaterial(outputDir, material, targetPath, kind, defaultBaseDir = null) {
  const sourcePath = resolveMaterialSource(outputDir, material, defaultBaseDir);
  if (sourcePath && copyFileIfExists(sourcePath, targetPath)) {
    return { copied: true, path: targetPath, preview: ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(targetPath).toLowerCase()) };
  }
  const parsed = path.parse(targetPath);
  const placeholderPath = path.join(parsed.dir, `${parsed.name || 'missing_material'}.json`);
  writeMaterialPlaceholder(placeholderPath, material, kind);
  return { copied: false, path: placeholderPath, preview: false };
}

function referenceGroup(material) {
  const text = `${material.category || ''} ${material.title || ''} ${material.note || ''}`.toLowerCase();
  if (/person|character|人物|角色|肖像|模特/.test(text)) return '人物参考';
  if (/scene|location|场景|空间|环境|地点/.test(text)) return '场景参考';
  if (/product|pack|商品|产品|包装|瓶|盒/.test(text)) return '产品参考';
  return '风格参考';
}

function addPrepareAssets({ outputDir, runPlan, assets }) {
  const materials = runPlan.materials || {};
  const materialBaseDir = materials.baseDir || outputDir;
  toArray(materials.inputs).forEach((material, index) => {
    const ext = material.path ? materialExtension(material.path) : '.json';
    const targetPath = path.join(outputDir, 'assets', 'inputs', `${String(index + 1).padStart(3, '0')}_${userFilePart(material.title, '输入素材')}${ext}`);
    const materialFile = copyOrDescribeMaterial(outputDir, material, targetPath, 'input', materialBaseDir);
    assets.push(assetRecord({
      id: material.id || `input_${String(index + 1).padStart(3, '0')}`,
      kind: 'input',
      userTitle: material.title || `输入素材 ${String(index + 1).padStart(3, '0')}`,
      userStatus: '已整理',
      path: relativeToOutput(outputDir, materialFile.path),
      previewPath: materialFile.preview ? relativeToOutput(outputDir, materialFile.path) : null,
      group: '用户原始输入',
      usage: { canExport: true },
      source: { stage: 'prepare' },
    }));
  });

  toArray(materials.references).forEach((material, index) => {
    const group = referenceGroup(material);
    const ext = material.path ? materialExtension(material.path) : '.json';
    const targetPath = path.join(outputDir, 'assets', 'references', group, `${String(index + 1).padStart(3, '0')}_${userFilePart(material.title, '参考素材')}${ext}`);
    const materialFile = copyOrDescribeMaterial(outputDir, material, targetPath, 'reference', materialBaseDir);
    assets.push(assetRecord({
      id: material.id || `reference_${String(index + 1).padStart(3, '0')}`,
      kind: 'reference',
      userTitle: material.title || `${group} ${String(index + 1).padStart(3, '0')}`,
      userStatus: '已整理',
      path: relativeToOutput(outputDir, materialFile.path),
      previewPath: materialFile.preview ? relativeToOutput(outputDir, materialFile.path) : null,
      group,
      usage: { canExport: true },
      source: { stage: 'prepare' },
    }));
  });

  toArray(materials.masks).forEach((material, index) => {
    const ext = material.path ? materialExtension(material.path) : '.json';
    const title = material.title && !/^素材\s+\d+/.test(material.title) ? material.title : `遮罩 ${String(index + 1).padStart(3, '0')}`;
    const targetPath = path.join(outputDir, 'assets', 'masks', `${String(index + 1).padStart(3, '0')}_${userFilePart(title, '遮罩')}${ext}`);
    const materialFile = copyOrDescribeMaterial(outputDir, { ...material, title }, targetPath, 'mask', materialBaseDir);
    assets.push(assetRecord({
      id: material.id || `mask_${String(index + 1).padStart(3, '0')}`,
      kind: 'mask',
      userTitle: title,
      userStatus: `局部修改范围 ${String(index + 1).padStart(3, '0')}`,
      path: relativeToOutput(outputDir, materialFile.path),
      previewPath: materialFile.preview ? relativeToOutput(outputDir, materialFile.path) : null,
      group: '局部重绘遮罩',
      usage: { canExport: false },
      source: { stage: 'prepare' },
    }));
  });
}

function createMissingResultRecord(targetPath, result) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify({
    title: result.title,
    status: '文件缺失',
    error: '结果文件不存在或复制失败',
    source: result.output || result.sourceOutput || null,
  }, null, 2)}\n`);
}

function sourceForResult(outputDir, result) {
  if (result.sourceOutput) return result.sourceOutput;
  if (!result.output) return null;
  return path.isAbsolute(result.output) ? result.output : path.join(outputDir, result.output);
}

function writeExportReport(outputDir, assets) {
  const reportPath = path.join(outputDir, 'assets', 'exports', 'report.html');
  const selected = assets.filter((item) => item.group === '已选结果');
  const rows = selected.length
    ? selected.map((item) => `<li><a href="../../${escapeHtml(item.path)}">${escapeHtml(item.userTitle)}</a> - ${escapeHtml(item.userStatus)}</li>`).join('\n')
    : '<li>当前还没有已选结果，先回结果页筛选。</li>';
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>交付报告</title></head>
<body><h1>交付报告</h1><ul>${rows}</ul></body>
</html>
`);
  return reportPath;
}

function buildAssetLibrary(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const runPlan = readJsonIfExists(options.runPlanFile || path.join(outputDir, 'internal', 'run_plan.json')) || {};
  const executionManifest = readJsonIfExists(options.executionManifestFile || path.join(outputDir, 'internal', 'execution_manifest.json')) || {};
  const taskTitle = normalizeText(runPlan.task?.title, '生图结果');
  const results = toArray(executionManifest.results);
  const assets = [];

  addPrepareAssets({ outputDir, runPlan, assets });

  results.forEach((result, index) => {
    const statusMap = {
      success: '可筛选',
      needs_review: '待复核',
      failed: '生成失败',
      skipped: '已跳过',
    };
    const userStatus = statusMap[result.status] || '待确认';
    const userTitle = resultDisplayTitle(result, index, taskTitle);
    const ext = extensionForResult(result);
    const fileName = numberedName(result.index || index + 1, taskTitle, userStatus, ext);
    const targetDir = result.status === 'needs_review' ? 'assets/review' : 'assets/results';
    const targetPath = path.join(outputDir, targetDir, fileName);
    let copied = false;
    if (result.status === 'failed') {
      createFailureRecord(targetPath, result);
      createFailureRecord(path.join(outputDir, 'assets/issues', fileName), result);
      copied = true;
    } else {
      copied = copyFileIfExists(sourceForResult(outputDir, result), targetPath);
    }

    if (result.status !== 'failed' && !copied) {
      const issuePath = path.join(outputDir, 'assets', 'issues', numberedName(result.index || index + 1, taskTitle, '文件缺失', '.json'));
      createMissingResultRecord(issuePath, result);
      assets.push(assetRecord({
        id: result.id || `result_${String(index + 1).padStart(3, '0')}`,
        kind: 'issue_record',
        userTitle,
        userStatus: '文件缺失',
        path: relativeToOutput(outputDir, issuePath),
        previewPath: null,
        group: '问题相关',
        usage: {
          canSelect: false,
          needsReview: false,
          hasIssue: true,
          canExport: false,
        },
        source: { stage: 'execute' },
      }));
      return;
    }

    assets.push(assetRecord({
      id: result.id || `result_${String(index + 1).padStart(3, '0')}`,
      kind: result.status === 'failed' ? 'issue_record' : 'image_result',
      userTitle,
      userStatus,
      path: relativeToOutput(outputDir, targetPath),
      previewPath: result.status === 'failed' ? null : relativeToOutput(outputDir, targetPath),
      group: result.status === 'needs_review' ? '建议复核' : (result.status === 'failed' ? '问题相关' : '所有生成结果'),
      usage: {
        canSelect: result.status === 'success',
        needsReview: result.status === 'needs_review',
        hasIssue: result.status === 'failed',
        canExport: result.status === 'success' || result.status === 'needs_review',
      },
      source: { stage: 'execute' },
    }));

    if (result.status === 'success') {
      const selectedPath = path.join(outputDir, 'assets', 'selected', fileName);
      const exportPath = path.join(outputDir, 'assets', 'exports', 'selected_images', fileName);
      copyFileIfExists(targetPath, selectedPath);
      copyFileIfExists(targetPath, exportPath);
      assets.push(assetRecord({
        id: `selected_${String(index + 1).padStart(3, '0')}`,
        kind: 'selected_result',
        userTitle: `${userTitle}（建议优先看）`,
        userStatus: '建议优先筛选',
        path: relativeToOutput(outputDir, selectedPath),
        previewPath: relativeToOutput(outputDir, selectedPath),
        group: '已选结果',
        usage: { canSelect: true, canExport: true },
        source: { stage: 'execute' },
      }));
      assets.push(assetRecord({
        id: `export_image_${String(index + 1).padStart(3, '0')}`,
        kind: 'export_image',
        userTitle: `${userTitle}（交付图）`,
        userStatus: '已放入交付',
        path: relativeToOutput(outputDir, exportPath),
        previewPath: relativeToOutput(outputDir, exportPath),
        group: '交付成果',
        usage: { canSelect: false, canExport: true },
        source: { stage: 'execute' },
      }));
    }
  });

  const reportPath = writeExportReport(outputDir, assets);
  assets.push(assetRecord({
    id: 'export_report',
    kind: 'export_report',
    userTitle: '交付报告',
    userStatus: '已生成',
    path: relativeToOutput(outputDir, reportPath),
    previewPath: null,
    group: '交付成果',
    usage: { canExport: true },
    source: { stage: results.length ? 'execute' : 'prepare' },
  }));

  const groups = [
    { id: 'inputs', title: '用户原始输入', assetIds: assets.filter((item) => item.group === '用户原始输入').map((item) => item.id) },
    { id: 'references', title: '参考素材', assetIds: assets.filter((item) => ['人物参考', '风格参考', '场景参考', '产品参考'].includes(item.group)).map((item) => item.id) },
    { id: 'masks', title: '局部重绘遮罩', assetIds: assets.filter((item) => item.group === '局部重绘遮罩').map((item) => item.id) },
    { id: 'ready_results', title: '可筛选结果', assetIds: assets.filter((item) => item.kind === 'image_result' && item.usage.canSelect).map((item) => item.id) },
    { id: 'needs_review', title: '建议复核', assetIds: assets.filter((item) => item.usage.needsReview).map((item) => item.id) },
    { id: 'issues', title: '问题相关', assetIds: assets.filter((item) => item.usage.hasIssue).map((item) => item.id) },
    { id: 'selected', title: '已选结果', assetIds: assets.filter((item) => item.group === '已选结果').map((item) => item.id) },
    { id: 'exports', title: '交付成果', assetIds: assets.filter((item) => item.group === '交付成果').map((item) => item.id) },
  ];

  const library = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    directories: {
      inputs: 'assets/inputs',
      references: 'assets/references',
      masks: 'assets/masks',
      results: 'assets/results',
      selected: 'assets/selected',
      review: 'assets/review',
      issues: 'assets/issues',
      exports: 'assets/exports',
      archive: 'assets/archive',
    },
    assets,
    publicAssets: assets.map(publicAsset),
    groups,
  };

  const outputFile = options.outputFile || path.join(outputDir, 'internal', 'asset_library.json');
  writeJson(outputFile, library);
  return library;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args['output-dir'] || process.cwd();
  const library = buildAssetLibrary({
    outputDir,
    outputFile: args['output-file'],
    runPlanFile: args['run-plan'],
    executionManifestFile: args['execution-manifest'],
  });
  console.log(JSON.stringify({ ok: true, outputDir: path.resolve(outputDir), assets: library.assets.length }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

module.exports = { buildAssetLibrary };
