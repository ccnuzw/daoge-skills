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
  const workspaceHomePath = path.join(outputDir, 'workspace_home.html');
  const resultWorkspacePath = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspacePath = path.join(outputDir, 'exception_workspace.html');
  const completionReportPath = path.join(outputDir, 'daoge_completion_report.md');
  const selectionBoardPath = path.join(outputDir, 'selection_board.md');
  const operationsReportPath = path.join(outputDir, 'operations_report.md');
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
    '# DAOGE 结果说明',
    '',
    '我是 DAOGE。',
    '这份说明只负责告诉你：结果现在稳不稳、最推荐回哪个工作台、以及还需要哪些补充动作。',
    '',
    '## 1. 最推荐入口',
    '',
    `- 工作台首页: ${fileExists(workspaceHomePath) ? workspaceHomePath : '尚未生成'}`,
    `- 结果工作台: ${fileExists(resultWorkspacePath) ? resultWorkspacePath : '尚未生成'}`,
    `- 异常工作台: ${fileExists(exceptionWorkspacePath) ? exceptionWorkspacePath : '尚未生成'}`,
    `- 整板页: ${fileExists(storyboardBoardPath) ? storyboardBoardPath : '本轮未生成'}`,
    '',
    '## 2. 当前结果判断',
    '',
    `- 当前整体状态: ${hasFailures ? '还有问题待处理，建议先去异常工作台' : '整体稳定，可以继续筛图或进入下一轮'}`,
    `- 最终图片目录: ${outputDir}`,
    `- 补救说明: ${fileExists(selectionBoardPath) ? selectionBoardPath : '尚未生成'}`,
    `- 完成报告: ${fileExists(completionReportPath) ? completionReportPath : '尚未生成'}`,
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
    '## 4. 这些入口分别什么时候用',
    '',
    '- 工作台首页: 用来重新判断整条任务现在走到哪一步。',
    '- 结果工作台: 正常情况下默认先回这里做筛图和收口判断。',
    '- 异常工作台: 只有出现失败项或待复核压力时才优先进入。',
    '- 分镜整板页: 只有分镜任务才需要回这里看上下文和镜头关系。',
    '- 完成报告: 更适合查看目录、批次、覆盖范围和最终归档说明。',
    '',
    '## 5. 快速查看文件',
    '',
    `- 完成报告: ${fileExists(completionReportPath) ? completionReportPath : '未生成'}`,
    `- 结果挑选与补救说明: ${fileExists(selectionBoardPath) ? selectionBoardPath : '未生成'}`,
    `- 运行复盘: ${fileExists(operationsReportPath) ? operationsReportPath : '未生成'}`,
    `- 运行总索引: ${fileExists(runIndexPath) ? runIndexPath : '未生成'}`,
    '',
    '## 6. 成功样例',
    '',
    ...(successful.length ? successful.map((item) => `- ${item.index} / ${item.title || item.slug}: ${item.output}`) : ['- 暂无成功样例']),
    '',
    '## 7. DAOGE 建议',
    '',
    ...(hasFailures
      ? ['- 当前有失败项，先回异常工作台，不要直接继续下一轮。']
      : ['- 当前没有失败项，建议先回结果工作台继续筛图和最终取舍。']),
    ...(fileExists(storyboardBoardPath)
      ? ['- 这轮是分镜任务时，别只看单张，记得回整板页检查上下文。']
      : ['- 当前不是整板优先任务，可以把注意力集中在结果工作台。']),
    '- 如果你只想找最终图片，不需要先读所有说明，直接打开图片目录即可。',
  ];

  if (hasFailures) {
    lines.push('');
    lines.push('## 8. 维护者补跑命令');
    lines.push('');
    lines.push('如果你确实要只补跑失败项，可以使用下面这条命令：');
    lines.push('');
    lines.push('```bash');
    lines.push(...portableRunnerPreambleLines());
    lines.push('node "$DAOGE_RUNNER" \\');
    lines.push(`  --prompts-file ${shellQuote(resolvePromptFileForRerun(manifest, outputDir))} \\`);
    lines.push(`  --resume-manifest ${shellQuote(manifestPath)} \\`);
    lines.push('  --failed-only true');
    lines.push('```');
  }

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
