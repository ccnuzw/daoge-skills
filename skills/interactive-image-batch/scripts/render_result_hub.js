const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists, resolvePromptFileForRerun } = require('./script_utils');

function portableRunnerPreambleLines() {
  return [
    'DAOGE_RUNNER="${DAOGE_RUNNER_PATH:-./.codex/skills/interactive-image-batch/scripts/run_batch.js}"',
    'if [ ! -f "$DAOGE_RUNNER" ]; then DAOGE_RUNNER="${CODEX_HOME:-$HOME/.codex}/skills/interactive-image-batch/scripts/run_batch.js"; fi',
  ];
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
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
  const rerunBoardPath = path.join(outputDir, 'rerun_board.html');
  const operationsReportPath = path.join(outputDir, 'operations_report.md');
  const promptPreviewPath = path.join(outputDir, 'prompt_preview.md');
  const preflightPath = path.join(outputDir, 'daoge_preflight_dashboard.md');
  const reviewBoardPath = path.join(outputDir, 'review_board.html');
  const storyboardBoardPath = path.join(outputDir, 'storyboard_board.html');
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
    '如果你只想快速知道先打开哪个文件，就先看下面这组“推荐浏览顺序”。',
    '',
    '## 1. 推荐浏览顺序',
    '',
    `1. 先看 HTML 审阅看板: ${fileExists(reviewBoardPath) ? reviewBoardPath : '尚未生成 review_board.html'}`,
    `2. 再看 Storyboard 装板: ${fileExists(storyboardBoardPath) ? storyboardBoardPath : '尚未生成 storyboard_board.html'}`,
    `3. 再看完成报告: ${fileExists(completionReportPath) ? completionReportPath : '尚未生成 daoge_completion_report.md'}`,
    `4. 最后按需要处理失败补跑: ${fileExists(rerunBoardPath) ? rerunBoardPath : (fileExists(selectionBoardPath) ? selectionBoardPath : '尚未生成 selection_board.md')}`,
    '',
    '## 2. 四个最常用入口',
    '',
    `- 审阅入口: ${fileExists(reviewBoardPath) ? reviewBoardPath : '尚未生成 review_board.html'}`,
    `- 整板入口: ${fileExists(storyboardBoardPath) ? storyboardBoardPath : '尚未生成 storyboard_board.html'}`,
    `- 报告入口: ${fileExists(completionReportPath) ? completionReportPath : '尚未生成 daoge_completion_report.md'}`,
    `- 图片目录: ${outputDir}`,
    '',
    '## 3. 本轮结果摘要',
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
    '## 4. 入口之间怎么联动',
    '',
    '- 在 HTML 审阅看板里先筛图、切换审阅模式或画廊模式。',
    '- 如果某张图属于 storyboard 槽位，就从审阅卡里直接点“查看整板位置”。',
    '- 跳到 storyboard 装板后，会看到当前焦点条和高亮槽位，再判断它在整板里的上下文。',
    '- 如果还要看执行细节、路径和批次信息，再回到完成报告。',
    '',
    '## 5. 如何找图',
    '',
    `- 所有最终图片都在这个目录下: ${outputDir}`,
    '- 图片通常按 `batch_001 / batch_002 / ...` 分批存放',
    '- 每张图旁边会有同名 `.json` 元数据文件，方便后续追溯 prompt 和参数',
    '',
    '## 6. 看板与报告入口',
    '',
    `- 完成报告: ${fileExists(completionReportPath) ? completionReportPath : '未生成'}`,
    `- HTML 审阅看板: ${fileExists(reviewBoardPath) ? reviewBoardPath : '未生成'}`,
    `- Storyboard 装板: ${fileExists(storyboardBoardPath) ? storyboardBoardPath : '未生成'}`,
    `- 失败补跑看板: ${fileExists(rerunBoardPath) ? rerunBoardPath : '未生成'}`,
    `- 失败补跑 Markdown 入口: ${fileExists(selectionBoardPath) ? selectionBoardPath : '未生成'}`,
    `- 运营复盘: ${fileExists(operationsReportPath) ? operationsReportPath : '未生成'}`,
    `- 预检总览: ${fileExists(preflightPath) ? preflightPath : '未生成'}`,
    `- Prompt 预览: ${fileExists(promptPreviewPath) ? promptPreviewPath : '未生成'}`,
    `- 运行总索引: ${fileExists(runIndexPath) ? runIndexPath : '未生成'}`,
    '',
    '## 7. 先看什么，取决于你的目标',
    '',
    '- 想先选图：先看 HTML 审阅看板。',
    '- 想确认某张图在整板里的位置：从审阅卡跳到 Storyboard 装板。',
    '- 想看执行概览和目录结构：看完成报告。',
    '- 想只找最终图片：直接打开图片目录。',
    '- 想处理失败项：最后看失败补跑看板。',
    '',
    '## 8. 成功样例',
    '',
    ...(successful.length ? successful.map((item) => `- ${item.index} / ${item.title || item.slug}: ${item.output}`) : ['- 暂无成功样例']),
    '',
    '## 9. 失败补跑',
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
  lines.push('## 10. DAOGE 建议');
  lines.push('');
  lines.push('- 默认浏览路径：审阅看板 -> Storyboard 装板 -> 完成报告。');
  lines.push('- 如果你是 storyboard 任务，尽量不要只盯单张图，要结合整板焦点位置一起看。');
  lines.push('- 如果要排查失败或补跑，优先走“失败补跑入口”，不要从总入口直接回到整批执行。');
  lines.push('- 如果你只想找最终图片，不用先读所有报告，直接打开“图片目录”。');

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
