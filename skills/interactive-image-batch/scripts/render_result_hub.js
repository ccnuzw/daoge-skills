const fs = require('fs');
const path = require('path');

function portableRunnerPreambleLines() {
  return [
    'DAOGE_RUNNER="${DAOGE_RUNNER_PATH:-./.codex/skills/interactive-image-batch/scripts/run_batch.js}"',
    'if [ ! -f "$DAOGE_RUNNER" ]; then DAOGE_RUNNER="${CODEX_HOME:-$HOME/.codex}/skills/interactive-image-batch/scripts/run_batch.js"; fi',
  ];
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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function exists(filePath) {
  return fs.existsSync(path.resolve(filePath));
}

function resolvePromptFileForRerun(manifest, outputDir) {
  const localPromptCopy = path.join(outputDir, 'prompts.generated.json');
  if (manifest.promptSnapshot && exists(manifest.promptSnapshot)) return manifest.promptSnapshot;
  if (exists(localPromptCopy)) return localPromptCopy;
  return manifest.promptSource || localPromptCopy;
}

function topSuccessful(results, limit = 6) {
  return results.filter((item) => item.ok && !item.skipped).slice(0, limit);
}

function uniqueSlotIds(items) {
  return Array.from(new Set((items || [])
    .map((item) => String(item.slotId || item.slot_id || '').trim())
    .filter(Boolean)));
}

function isLocalEditResult(item) {
  const requestMode = String(item.requestMode || item.request_mode || '').trim();
  const editSource = String(item.editSource || item.edit_source || '').trim();
  return requestMode === 'masked-edit' || editSource === 'previous-output';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = manifest.outputDir || path.dirname(manifestPath);
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'daoge_result_hub.md'));
  const completionReportPath = path.join(outputDir, 'daoge_completion_report.md');
  const selectionBoardPath = path.join(outputDir, 'selection_board.md');
  const operationsReportPath = path.join(outputDir, 'operations_report.md');
  const promptPreviewPath = path.join(outputDir, 'prompt_preview.md');
  const preflightPath = path.join(outputDir, 'daoge_preflight_dashboard.md');
  const runIndexPath = path.join(path.dirname(outputDir), 'daoge_run_index.md');
  const batchManifests = Array.isArray(manifest.batches) ? manifest.batches : [];
  const allResults = batchManifests.flatMap((batch) => batch.results || []);
  const successful = topSuccessful(allResults);
  const skipped = allResults.filter((item) => item.skipped).length;
  const executed = allResults.filter((item) => !item.skipped);
  const attemptedLocalEdits = executed.filter(isLocalEditResult);
  const successfulLocalEdits = successful.filter(isLocalEditResult);
  const generatedSlotIds = uniqueSlotIds(executed);
  const attemptedLocalEditSlotIds = uniqueSlotIds(attemptedLocalEdits);
  const successfulLocalEditSlotIds = uniqueSlotIds(successfulLocalEdits);
  const hasFailures = Number(manifest.failed || 0) > 0;
  const lines = [
    '# DAOGE 结果总入口',
    '',
    '我是 DAOGE。',
    '这份文件只负责把本轮最常用的结果入口收成一页，避免你在多个文件之间来回找。',
    '',
    '## 1. 三个最常用入口',
    '',
    `- 本次总览: ${exists(completionReportPath) ? completionReportPath : '尚未生成 daoge_completion_report.md'}`,
    `- 最终图片目录: ${outputDir}`,
    `- 失败补跑入口: ${exists(selectionBoardPath) ? selectionBoardPath : '尚未生成 selection_board.md'}`,
    '',
    '## 2. 本轮结果摘要',
    '',
    `- 成功张数: ${manifest.success ?? 0}`,
    `- 失败张数: ${manifest.failed ?? 0}`,
    `- 跳过已完成: ${skipped}`,
    `- 批次数量: ${manifest.batchCount ?? batchManifests.length}`,
    `- 默认尺寸: ${manifest.defaultSize || '未记录'}`,
    `- 是否暂停: ${manifest.paused ? '是' : '否'}`,
    `- 暂停原因: ${manifest.pauseReason || '无'}`,
    `- 参与生成槽位: ${generatedSlotIds.length ? generatedSlotIds.join(', ') : '未记录'}`,
    `- 尝试局部编辑槽位: ${attemptedLocalEditSlotIds.length ? attemptedLocalEditSlotIds.join(', ') : '无'}`,
    `- 成功局部编辑槽位: ${successfulLocalEditSlotIds.length ? successfulLocalEditSlotIds.join(', ') : '无'}`,
    '',
    '## 3. 如何找图',
    '',
    `- 所有最终图片都在这个目录下: ${outputDir}`,
    '- 图片通常按 `batch_001 / batch_002 / ...` 分批存放',
    '- 每张图旁边会有同名 `.json` 元数据文件，方便后续追溯 prompt 和参数',
    '',
    '## 4. 快速查看文件',
    '',
    `- 完成报告: ${exists(completionReportPath) ? completionReportPath : '未生成'}`,
    `- 筛选看板: ${exists(selectionBoardPath) ? selectionBoardPath : '未生成'}`,
    `- 运营复盘: ${exists(operationsReportPath) ? operationsReportPath : '未生成'}`,
    `- 预检总览: ${exists(preflightPath) ? preflightPath : '未生成'}`,
    `- Prompt 预览: ${exists(promptPreviewPath) ? promptPreviewPath : '未生成'}`,
    `- 运行总索引: ${exists(runIndexPath) ? runIndexPath : '未生成'}`,
    '',
    '## 5. 成功样例',
    '',
    ...(successful.length ? successful.map((item) => `- ${item.index} / ${item.title || item.slug}: ${item.output}`) : ['- 暂无成功样例']),
    '',
    '## 6. 失败补跑',
    '',
  ];

  if (hasFailures) {
    lines.push('- 本轮存在失败项，建议优先使用失败续跑，不要整批重跑。');
    lines.push('');
    lines.push('```bash');
    lines.push(...portableRunnerPreambleLines());
    lines.push('node "$DAOGE_RUNNER" \\');
    lines.push(`  --prompts-file ${shellQuote(resolvePromptFileForRerun(manifest, outputDir))} \\`);
    lines.push(`  --resume-manifest ${shellQuote(manifestPath)} \\`);
    lines.push('  --failed-only true');
    lines.push('```');
  } else {
    lines.push('- 本轮没有失败项，当前不需要补跑。');
    lines.push('- 如果你要继续扩图，建议先看完成报告和筛选看板，再决定是否复用这轮参数。');
  }

  lines.push('');
  lines.push('## 7. DAOGE 建议');
  lines.push('');
  lines.push('- 先看“本次总览”，再去图片目录选图。');
  lines.push('- 如果要排查失败或补跑，优先走“失败补跑入口”。');
  lines.push('- 如果你只想找最终图片，不用先读所有报告，直接打开“最终图片目录”。');

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
  console.log(JSON.stringify({
    outputPath,
    outputDir,
    success: manifest.success ?? 0,
    failed: manifest.failed ?? 0,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
