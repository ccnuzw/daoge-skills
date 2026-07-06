const fs = require('fs');
const path = require('path');
const {
  ASSET_KINDS,
  LIFECYCLE_STATUSES,
  parseArgs,
  readJsonIfExists,
  writeJson,
  toArray,
  normalizeText,
  normalizeEnumValue,
  ensureV2Layout,
  numberedName,
  copyFileIfExists,
  hardlinkOrCopyFileIfExists,
  relativeToOutput,
  resultDisplayTitle,
  publicAsset,
  userFilePart,
  escapeHtml,
  classifyResultAvailability,
} = require('../shared/workspace');

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
  const sourceStage = fields.source?.stage || 'prepare';
  const defaultLifecycleStatus = sourceStage === 'prepare' ? 'ready_for_run' : 'ready_for_review';
  return {
    id: fields.id,
    kind: normalizeEnumValue('asset.kind', fields.kind, ASSET_KINDS, 'image_result'),
    userTitle: fields.userTitle,
    userStatus: fields.userStatus,
    userPurpose: fields.userPurpose || '帮助完成当前生图任务',
    userAction: fields.userAction || '按当前页面建议处理',
    lifecycleStatus: normalizeEnumValue('asset.lifecycleStatus', fields.lifecycleStatus || defaultLifecycleStatus, LIFECYCLE_STATUSES, defaultLifecycleStatus),
    sourceReason: fields.sourceReason || '由当前任务整理生成',
    path: fields.path,
    previewPath: fields.previewPath || null,
    group: fields.group,
    usage: usage(fields.usage),
    relationships: fields.relationships || {},
    source: {
      stage: sourceStage,
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
      userPurpose: '保留本轮任务的原始说明和输入素材',
      userAction: '开跑前确认内容是否正确',
      lifecycleStatus: 'ready_for_run',
      sourceReason: material.note || '来自用户输入或任务文档',
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
      userPurpose: `作为${group}影响生成结果`,
      userAction: '开跑前确认参考是否符合预期',
      lifecycleStatus: 'ready_for_run',
      sourceReason: material.note || '来自用户提供的参考素材',
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
      userPurpose: '限定局部修改范围',
      userAction: '开跑前确认修改区域是否正确',
      lifecycleStatus: 'ready_for_run',
      sourceReason: material.note || '来自用户提供的局部修改范围',
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

function userLifecycleLabel(status) {
  const labels = {
    ready_for_run: '开跑前已整理',
    ready_for_review: '等待复核',
    ready_for_selection: '可筛选',
    needs_review: '需要复核',
    needs_attention: '需要处理',
    recommended_first_pass: '建议优先看',
    user_selected: '用户已选',
    deliverable_candidate: '交付候选',
    waiting_for_user_selection: '等待选择',
    report_ready: '清单已生成',
  };
  return labels[status] || '待确认';
}

function writeExportReport(outputDir, assets) {
  const reportPath = path.join(outputDir, 'assets', 'exports', 'report.html');
  const reportGroups = assets.reduce((groups, item) => {
    if (item.kind === 'selected_result') groups.selected.push(item);
    if (item.group === '交付成果' && item.kind === 'export_image') groups.deliverables.push(item);
    if (item.group === '建议复核' || item.group === '问题相关') groups.related.push(item);
    return groups;
  }, { selected: [], deliverables: [], related: [] });
  const renderRows = (items, emptyText) => items.length
    ? items.map((item) => `<tr><td><a href="../../${escapeHtml(item.path)}">${escapeHtml(item.userTitle)}</a></td><td>${escapeHtml(item.userPurpose)}</td><td>${escapeHtml(item.userAction)}</td><td>${escapeHtml(userLifecycleLabel(item.lifecycleStatus))}</td></tr>`).join('\n')
    : `<tr><td colspan="4">${escapeHtml(emptyText)}</td></tr>`;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>交付清单</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;color:#202124;background:#fff;line-height:1.55}
    main{max-width:960px;margin:0 auto;padding:28px}
    h1{font-size:30px;margin:0 0 8px}
    h2{font-size:18px;margin:24px 0 10px}
    p{color:#5f6368}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #d7d9de;padding:10px;text-align:left;vertical-align:top}
    th{background:#f6f7f9}
    a{color:#0f766e}
  </style>
</head>
<body>
<main>
  <h1>交付清单</h1>
  <p>这里列出建议交付图、推荐优先看的候选，以及仍需复核或处理的项目。</p>
  <h2>建议交付</h2>
  <table><thead><tr><th>文件</th><th>这是什么</th><th>建议怎么处理</th><th>状态</th></tr></thead><tbody>${renderRows(reportGroups.deliverables, '当前还没有建议交付图，先回结果页筛选。')}</tbody></table>
  <h2>推荐候选</h2>
  <table><thead><tr><th>文件</th><th>这是什么</th><th>建议怎么处理</th><th>状态</th></tr></thead><tbody>${renderRows(reportGroups.selected, '当前还没有推荐候选。')}</tbody></table>
  <h2>需要留意</h2>
  <table><thead><tr><th>文件</th><th>这是什么</th><th>建议怎么处理</th><th>状态</th></tr></thead><tbody>${renderRows(reportGroups.related, '当前没有需要留意的项目。')}</tbody></table>
</main>
</body>
</html>
`);
  return reportPath;
}

function shouldRecommendResult(result, availableSuccessIndex) {
  if (result.userSelected || result.selected || result.recommended || result.priority === 'high') return true;
  return availableSuccessIndex < 3;
}

function resultAssetId(result, index) {
  return result.id || `result_${String(index + 1).padStart(3, '0')}`;
}

function buildAssetLibrary(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const runPlan = readJsonIfExists(options.runPlanFile || path.join(outputDir, 'internal', 'run_plan.json')) || {};
  const executionManifest = readJsonIfExists(options.executionManifestFile || path.join(outputDir, 'internal', 'execution_manifest.json')) || {};
  const taskTitle = normalizeText(runPlan.task?.title, '生图结果');
  const results = toArray(executionManifest.results);
  const assets = [];
  let copiedSuccessCount = 0;
  let hasUserSelectedResult = false;

  addPrepareAssets({ outputDir, runPlan, assets });

  results.forEach((result, index) => {
    const stableResultAssetId = resultAssetId(result, index);
    const availability = classifyResultAvailability(outputDir, result);
    const statusMap = {
      success: '可筛选',
      needs_review: '待复核',
      failed: '生成失败',
      skipped: '已跳过',
    };
    const userStatus = statusMap[availability.status] || '待确认';
    const userTitle = resultDisplayTitle(result, index, taskTitle);
    const ext = extensionForResult({ ...result, status: availability.status });
    const fileName = numberedName(result.index || index + 1, taskTitle, userStatus, ext);
    const targetDir = availability.needsReview ? 'assets/review' : (availability.failed ? 'assets/issues' : 'assets/results');
    const targetPath = path.join(outputDir, targetDir, fileName);
    let copied = false;
    if (availability.failed) {
      createFailureRecord(targetPath, result);
      copied = true;
    } else if (availability.available) {
      copied = copyFileIfExists(availability.outputPath, targetPath);
    }

    if (availability.missingOutput || (availability.available && !copied)) {
      const issuePath = path.join(outputDir, 'assets', 'issues', numberedName(result.index || index + 1, taskTitle, '文件缺失', '.json'));
      createMissingResultRecord(issuePath, result);
      assets.push(assetRecord({
        id: stableResultAssetId,
        kind: 'issue_record',
        userTitle,
        userStatus: '文件缺失',
        path: relativeToOutput(outputDir, issuePath),
        previewPath: null,
        group: '问题相关',
        userPurpose: '记录缺失的结果文件',
        userAction: '回问题页确认是否需要补跑或忽略',
        lifecycleStatus: 'needs_attention',
        sourceReason: '结果记录存在，但图片文件没有复制成功',
        usage: {
          canSelect: false,
          needsReview: false,
          hasIssue: true,
          canExport: false,
        },
        relationships: {
          sourceResultId: stableResultAssetId,
          issueRecordPath: relativeToOutput(outputDir, issuePath),
        },
        source: { stage: 'execute' },
      }));
      return;
    }

    if (!availability.failed && !availability.available) {
      return;
    }

    assets.push(assetRecord({
      id: stableResultAssetId,
      kind: availability.failed ? 'issue_record' : 'image_result',
      userTitle,
      userStatus,
      path: relativeToOutput(outputDir, targetPath),
      previewPath: availability.failed ? null : relativeToOutput(outputDir, targetPath),
      group: availability.needsReview ? '建议复核' : (availability.failed ? '问题相关' : '所有生成结果'),
      userPurpose: availability.success
        ? '本轮生成的可筛选图片'
        : (availability.needsReview ? '可能可用但需要人工确认的图片' : '记录生成失败原因'),
      userAction: availability.success
        ? '在结果页筛选，满意后作为交付候选'
        : (availability.needsReview ? '先放大复核主体、构图和文字区域' : '到问题页决定处理、忽略或补跑'),
      lifecycleStatus: availability.success
        ? 'ready_for_selection'
        : (availability.needsReview ? 'needs_review' : 'needs_attention'),
      sourceReason: availability.success
        ? '生成成功，进入结果筛选'
        : (availability.needsReview ? '生成完成但标记为建议复核' : '生成失败，保留错误记录'),
      usage: {
        canSelect: availability.canSelect,
        needsReview: availability.needsReview,
        hasIssue: availability.hasIssue,
        canExport: availability.canExport,
      },
      relationships: {
        sourceResultId: stableResultAssetId,
        resultPath: relativeToOutput(outputDir, targetPath),
      },
      source: { stage: 'execute' },
    }));

    if (availability.success && (result.userSelected || result.selected)) {
      hasUserSelectedResult = true;
    }

    const availableSuccessIndex = copiedSuccessCount;
    if (availability.success) {
      copiedSuccessCount += 1;
    }

    if (availability.success && shouldRecommendResult(result, availableSuccessIndex)) {
      const selectedPath = path.join(outputDir, 'assets', 'selected', fileName);
      const exportPath = path.join(outputDir, 'assets', 'exports', 'selected_images', fileName);
      hardlinkOrCopyFileIfExists(targetPath, selectedPath);
      hardlinkOrCopyFileIfExists(targetPath, exportPath);
      assets.push(assetRecord({
        id: `selected_${String(index + 1).padStart(3, '0')}`,
        kind: 'selected_result',
        userTitle: `${userTitle}（建议优先看）`,
        userStatus: '建议优先筛选',
        path: relativeToOutput(outputDir, selectedPath),
        previewPath: relativeToOutput(outputDir, selectedPath),
        group: '已选结果',
        userPurpose: result.userSelected || result.selected ? '用户已选的候选图' : '系统建议优先查看的候选图',
        userAction: '先在结果页放大确认，满意后保留到交付清单',
        lifecycleStatus: result.userSelected || result.selected ? 'user_selected' : 'recommended_first_pass',
        sourceReason: result.userSelected || result.selected ? '用户已标记选择' : '结果成功且排在推荐优先查看范围',
        usage: { canSelect: true, canExport: true },
        relationships: {
          sourceResultId: stableResultAssetId,
          derivedFromAssetId: stableResultAssetId,
          copiedFrom: relativeToOutput(outputDir, targetPath),
        },
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
        userPurpose: '可放入交付包的候选图片',
        userAction: '交付前再确认是否最终采用',
        lifecycleStatus: 'deliverable_candidate',
        sourceReason: '来自推荐优先查看或用户已选结果',
        usage: { canSelect: false, canExport: true },
        relationships: {
          sourceResultId: stableResultAssetId,
          derivedFromAssetId: `selected_${String(index + 1).padStart(3, '0')}`,
          copiedFrom: relativeToOutput(outputDir, selectedPath),
        },
        source: { stage: 'execute' },
      }));
    }
  });

  if (copiedSuccessCount && !hasUserSelectedResult) {
    const placeholderPath = path.join(outputDir, 'assets', 'selected', 'README.json');
    writeJson(placeholderPath, {
      title: '用户已选占位',
      note: '当前还没有明确选择；请先在结果页筛选。',
    });
    assets.push(assetRecord({
      id: 'selected_placeholder',
      kind: 'selection_placeholder',
      userTitle: '用户已选占位',
      userStatus: '等待选择',
      userPurpose: '标记这里放最终选择，不自动等于全部成功结果',
      userAction: '回结果页选择真正要保留的图片',
      lifecycleStatus: 'waiting_for_user_selection',
      sourceReason: '有成功结果，但没有明确用户选择',
      path: relativeToOutput(outputDir, placeholderPath),
      previewPath: null,
      group: '已选结果',
      usage: { canExport: false },
      relationships: {},
      source: { stage: 'execute' },
    }));
  }

  const reportPath = writeExportReport(outputDir, assets);
  assets.push(assetRecord({
    id: 'export_report',
    kind: 'export_report',
    userTitle: '交付报告',
    userStatus: '已生成',
    userPurpose: '汇总本轮建议交付、推荐候选和待处理项目',
    userAction: '交付前打开核对清单',
    lifecycleStatus: 'report_ready',
    sourceReason: '根据当前资产库自动生成',
    path: relativeToOutput(outputDir, reportPath),
    previewPath: null,
    group: '交付成果',
    usage: { canExport: true },
    source: { stage: results.length ? 'execute' : 'prepare' },
  }));

  const groupIds = {
    inputs: [],
    references: [],
    masks: [],
    ready_results: [],
    needs_review: [],
    issues: [],
    selected: [],
    exports: [],
  };
  assets.forEach((item) => {
    if (item.group === '用户原始输入') groupIds.inputs.push(item.id);
    if (['人物参考', '风格参考', '场景参考', '产品参考'].includes(item.group)) groupIds.references.push(item.id);
    if (item.group === '局部重绘遮罩') groupIds.masks.push(item.id);
    if (item.kind === 'image_result' && item.usage.canSelect) groupIds.ready_results.push(item.id);
    if (item.usage.needsReview) groupIds.needs_review.push(item.id);
    if (item.usage.hasIssue) groupIds.issues.push(item.id);
    if (item.group === '已选结果') groupIds.selected.push(item.id);
    if (item.group === '交付成果') groupIds.exports.push(item.id);
  });

  const groups = [
    { id: 'inputs', title: '用户原始输入', assetIds: groupIds.inputs },
    { id: 'references', title: '参考素材', assetIds: groupIds.references },
    { id: 'masks', title: '局部重绘遮罩', assetIds: groupIds.masks },
    { id: 'ready_results', title: '可筛选结果', assetIds: groupIds.ready_results },
    { id: 'needs_review', title: '建议复核', assetIds: groupIds.needs_review },
    { id: 'issues', title: '问题相关', assetIds: groupIds.issues },
    { id: 'selected', title: '已选结果', assetIds: groupIds.selected },
    { id: 'exports', title: '交付成果', assetIds: groupIds.exports },
  ];

  const library = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    supportedKinds: ASSET_KINDS,
    supportedLifecycleStatuses: LIFECYCLE_STATUSES,
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
