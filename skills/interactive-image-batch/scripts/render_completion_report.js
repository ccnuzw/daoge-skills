const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists, resolvePromptFileForRerun } = require('./script_utils');
const { v2WorkspacePaths } = require('./workspace_v2_shared');

function portableRunnerPreambleLines() {
  return [
    'DAOGE_RUNNER="${DAOGE_RUNNER_PATH:-./.codex/skills/interactive-image-batch/scripts/run_batch.js}"',
    'if [ ! -f "$DAOGE_RUNNER" ]; then DAOGE_RUNNER="${CODEX_HOME:-$HOME/.codex}/skills/interactive-image-batch/scripts/run_batch.js"; fi',
  ];
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

function topFailed(results, limit = 8) {
  return results.filter((item) => !item.ok).slice(0, limit);
}

function topSuccessful(results, limit = 8) {
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
  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(manifestPath), 'daoge_completion_report.md'));
  const outputDir = manifest.outputDir || path.dirname(manifestPath);

  const batchManifests = Array.isArray(manifest.batches) ? manifest.batches : [];
  const allResults = batchManifests.flatMap((batch) => batch.results || []);
  const failed = topFailed(allResults);
  const successful = topSuccessful(allResults);
  const skipped = allResults.filter((item) => item.skipped);
  const executed = allResults.filter((item) => !item.skipped);
  const attemptedLocalEdits = executed.filter(isLocalEditResult);
  const successfulLocalEdits = successful.filter(isLocalEditResult);
  const generatedSlotIds = uniqueSlotIds(executed);
  const attemptedLocalEditSlotIds = uniqueSlotIds(attemptedLocalEdits);
  const successfulLocalEditSlotIds = uniqueSlotIds(successfulLocalEdits);
  const contactSheetPath = path.join(path.dirname(manifestPath), 'contact_sheet.png');
  const selectionBoardPath = path.join(path.dirname(manifestPath), 'selection_board.md');
  const operationsReportPath = path.join(path.dirname(manifestPath), 'operations_report.md');
  const workspacePaths = v2WorkspacePaths(path.dirname(manifestPath));
  const workspaceHomePath = workspacePaths.workspaceIndex;
  const resultWorkspacePath = workspacePaths.workspaceResults;
  const exceptionWorkspacePath = workspacePaths.workspaceIssues;
  const recordWorkspacePath = workspacePaths.workspaceRecord;
  const storyboardBoardPath = path.join(path.dirname(manifestPath), 'storyboard_board.html');
  const runIndexPath = path.join(path.dirname(path.dirname(manifestPath)), 'daoge_run_index.md');

  const lines = [
    '# DAOGE 完成归档报告',
    '',
    '这份 Markdown 已经退到归档层，只负责本轮是否已经可以收口，以及收口前后该怎么处理。看主入口回 README 或工作台首页，看过程回任务档案。',
    '',
    '## 0. 本轮收口结论',
    '',
    `- 当前整体状态: ${(manifest.failed ?? 0) > 0 ? '还不能直接收口，建议先处理异常' : '整体稳定，可以继续筛图或进入下一轮'}`,
    `- 最推荐下一步: ${(manifest.failed ?? 0) > 0 ? (fileExists(exceptionWorkspacePath) ? exceptionWorkspacePath : '异常工作台尚未生成') : (fileExists(resultWorkspacePath) ? resultWorkspacePath : '结果工作台尚未生成')}`,
    `- 是否存在失败压力: ${(manifest.failed ?? 0) > 0 ? '有' : '没有'}`,
    `- 是否存在局部编辑复核压力: ${attemptedLocalEditSlotIds.length ? '有' : '没有'}`,
    '',
    '## 1. 收口入口',
    '',
    `- 回结果工作台: ${fileExists(resultWorkspacePath) ? resultWorkspacePath : '尚未生成'}`,
    `- 回异常工作台: ${fileExists(exceptionWorkspacePath) ? exceptionWorkspacePath : '尚未生成'}`,
    `- 看任务档案: ${recordWorkspacePath}`,
    `- 最终图片目录: ${manifest.outputDir || path.dirname(manifestPath)}`,
    '',
    '## 2. 运行概况',
    '',
    `- 成功张数: ${manifest.success ?? 0}`,
    `- 失败张数: ${manifest.failed ?? 0}`,
    `- 跳过已完成: ${skipped.length}`,
    `- 批次数量: ${manifest.batchCount ?? batchManifests.length}`,
    `- 阶段数量: ${manifest.stageCount ?? '未记录'}`,
    '',
    '## 3. 槽位覆盖',
    '',
    `- 本轮参与生成的槽位数: ${generatedSlotIds.length}`,
    `- 本轮参与生成的槽位: ${generatedSlotIds.length ? generatedSlotIds.join(', ') : '未记录'}`,
    `- 尝试局部编辑的槽位数: ${attemptedLocalEditSlotIds.length}`,
    `- 尝试局部编辑的槽位: ${attemptedLocalEditSlotIds.length ? attemptedLocalEditSlotIds.join(', ') : '无'}`,
    `- 成功完成局部编辑的槽位数: ${successfulLocalEditSlotIds.length}`,
    `- 成功完成局部编辑的槽位: ${successfulLocalEditSlotIds.length ? successfulLocalEditSlotIds.join(', ') : '无'}`,
    '',
    '## 4. 批次结果',
    '',
    ...batchManifests.map((batch) => `- 第 ${batch.batchNumber} 批: 成功 ${batch.success}，失败 ${batch.failed}`),
    '',
    '## 5. 成功样例',
    '',
  ];

  if (!successful.length) {
    lines.push('- 没有成功样例');
  } else {
    successful.forEach((item) => {
      lines.push(`- ${item.index} / ${item.title || item.slug}: ${item.output}`);
    });
  }

  lines.push('');
  lines.push('## 6. 失败样例');
  lines.push('');

  if (!failed.length) {
    lines.push('- 没有失败项');
  } else {
    failed.forEach((item) => {
      lines.push(`- ${item.index} / ${item.title || item.slug}: ${item.error || '未知错误'}`);
    });
  }

  lines.push('');
  lines.push('## 7. 这份报告不负责什么');
  lines.push('');
  lines.push('- 不负责总入口说明：想知道先从哪里进入，回 README 或工作台首页。');
  lines.push('- 不负责完整过程时间线：想知道这轮具体怎么跑完、每批发生了什么，去看任务档案。');
  lines.push('- 不负责结果主控：筛图、异常分流和最终取舍仍回结果工作台或异常工作台。');
  lines.push('');
  lines.push('## 8. 记录与定位');
  lines.push('');
  lines.push(`- 根 manifest: ${manifestPath}`);
  lines.push(`- README: ${path.join(path.dirname(manifestPath), 'README.md')}`);
  lines.push(`- 任务档案: ${recordWorkspacePath}`);
  if (fileExists(storyboardBoardPath)) lines.push(`- 分镜整板补充页: ${storyboardBoardPath}`);
  lines.push('');
  lines.push('## 9. DAOGE 建议');
  lines.push('');
  if ((manifest.failed ?? 0) > 0) {
    lines.push('- 当前先不要急着继续扩图，优先回异常工作台统一处理失败项。');
    lines.push('- 只有在明确需要补跑时，才使用下面这条只补失败项的命令。');
    lines.push('');
    lines.push('```bash');
    lines.push(...portableRunnerPreambleLines());
    lines.push('node "$DAOGE_RUNNER" \\');
    lines.push(`  --prompts-file ${shellQuote(resolvePromptFileForRerun(manifest, outputDir))} \\`);
    lines.push(`  --resume-manifest ${shellQuote(manifestPath)} \\`);
    lines.push('  --failed-only true');
    lines.push('```');
  } else {
    lines.push('- 本轮没有失败项，可以直接回结果工作台继续筛图或判断是否进入下一轮。');
  }
  if (attemptedLocalEditSlotIds.length) {
    lines.push('- 当前有局部编辑结果，建议按需打开分镜整板补充页看一次边界和衔接感。');
  }
  lines.push('- 如果要继续扩图，优先沿用这轮已经稳定的参数和方向。');

  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
  console.log(JSON.stringify({
    outputPath,
    success: manifest.success ?? 0,
    failed: manifest.failed ?? 0,
    batchCount: manifest.batchCount ?? batchManifests.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
