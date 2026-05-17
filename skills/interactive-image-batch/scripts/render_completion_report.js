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
  const resultHubPath = path.join(path.dirname(manifestPath), 'daoge_result_hub.md');
  const runIndexPath = path.join(path.dirname(path.dirname(manifestPath)), 'daoge_run_index.md');

  const lines = [
    '# DAOGE 完成报告',
    '',
    'DAOGE 已完成本轮生图任务。',
    '以下是这次执行结果的最终摘要。',
    '',
    '## 0. 先看这里',
    '',
    `- DAOGE 结果总入口: ${fileExists(resultHubPath) ? resultHubPath : '尚未生成'}`,
    `- 最终图片目录: ${manifest.outputDir || path.dirname(manifestPath)}`,
    `- 失败补跑入口: ${fileExists(selectionBoardPath) ? selectionBoardPath : '尚未生成'}`,
    '',
    '## 1. 执行结果',
    '',
    `- 输出目录: ${outputDir}`,
    `- Prompt 来源: ${manifest.promptSource || '未记录'}`,
    `- Prompt 原始来源: ${manifest.promptSourceOriginal || manifest.promptSource || '未记录'}`,
    `- 续跑来源: ${manifest.resumeManifest || '无'}`,
    `- 仅重跑失败项: ${manifest.failedOnly ? '是' : '否'}`,
    `- 生成时间: ${manifest.generatedAt || '未记录'}`,
    `- 是否暂停: ${manifest.paused ? '是' : '否'}`,
    `- 暂停原因: ${manifest.pauseReason || '无'}`,
    `- 成功张数: ${manifest.success ?? 0}`,
    `- 失败张数: ${manifest.failed ?? 0}`,
    `- 跳过已完成: ${skipped.length}`,
    `- 批次数量: ${manifest.batchCount ?? batchManifests.length}`,
    `- 阶段数量: ${manifest.stageCount ?? '未记录'}`,
    `- 样本数量: ${manifest.sampleSize ?? 0}`,
    `- 每批数量: ${manifest.batchSize ?? '未记录'}`,
    `- 默认尺寸: ${manifest.defaultSize || '未记录'}`,
    `- 模型: ${manifest.model || '未记录'}`,
    '',
    '## 2. 槽位结果',
    '',
    `- 本轮参与生成的槽位数: ${generatedSlotIds.length}`,
    `- 本轮参与生成的槽位: ${generatedSlotIds.length ? generatedSlotIds.join(', ') : '未记录'}`,
    `- 尝试局部编辑的槽位数: ${attemptedLocalEditSlotIds.length}`,
    `- 尝试局部编辑的槽位: ${attemptedLocalEditSlotIds.length ? attemptedLocalEditSlotIds.join(', ') : '无'}`,
    `- 成功完成局部编辑的槽位数: ${successfulLocalEditSlotIds.length}`,
    `- 成功完成局部编辑的槽位: ${successfulLocalEditSlotIds.length ? successfulLocalEditSlotIds.join(', ') : '无'}`,
    '',
    '## 2. 批次结果',
    '',
    ...batchManifests.map((batch) => `- 第 ${batch.batchNumber} 批: 成功 ${batch.success}，失败 ${batch.failed}`),
    '',
    '## 3. 成功样例',
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
  lines.push('## 4. 失败样例');
  lines.push('');

  if (!failed.length) {
    lines.push('- 没有失败项');
  } else {
    failed.forEach((item) => {
      lines.push(`- ${item.index} / ${item.title || item.slug}: ${item.error || '未知错误'}`);
    });
  }

  lines.push('');
  lines.push('## 5. 关键文件');
  lines.push('');
  lines.push(`- 根 manifest: ${manifestPath}`);
  if (fileExists(resultHubPath)) {
    lines.push(`- DAOGE 结果总入口: ${resultHubPath}`);
  }
  lines.push(`- 批次计划: ${path.join(path.dirname(manifestPath), 'batch_plan.json')}`);
  lines.push(`- Prompt 文件: ${path.join(path.dirname(manifestPath), 'prompts.generated.json')}`);
  lines.push(`- README: ${path.join(path.dirname(manifestPath), 'README.md')}`);
  if (manifest.jobState && fileExists(manifest.jobState)) {
    lines.push(`- 任务状态: ${manifest.jobState}`);
  }
  if (manifest.checkpoint && fileExists(manifest.checkpoint)) {
    lines.push(`- 检查点: ${manifest.checkpoint}`);
  }
  if (manifest.stagePlan && fileExists(manifest.stagePlan)) {
    lines.push(`- 阶段计划: ${manifest.stagePlan}`);
  }
  if (fileExists(contactSheetPath)) {
    lines.push(`- 联系表: ${contactSheetPath}`);
  }
  if (fileExists(selectionBoardPath)) {
    lines.push(`- 筛选看板: ${selectionBoardPath}`);
  }
  if (fileExists(operationsReportPath)) {
    lines.push(`- 运营复盘: ${operationsReportPath}`);
  }
  if (fileExists(runIndexPath)) {
    lines.push(`- 运行总索引: ${runIndexPath}`);
  }
  lines.push('');
  lines.push('## 6. DAOGE 建议');
  lines.push('');
  if ((manifest.failed ?? 0) > 0) {
    lines.push('- 先检查失败项的错误信息，再决定是否补跑失败批次');
    lines.push('- 可使用 runner 的失败续跑能力，只重跑旧 manifest 里的失败项');
    lines.push('');
    lines.push('```bash');
    lines.push(...portableRunnerPreambleLines());
    lines.push('node "$DAOGE_RUNNER" \\');
    lines.push(`  --prompts-file ${shellQuote(resolvePromptFileForRerun(manifest, outputDir))} \\`);
    lines.push(`  --resume-manifest ${shellQuote(manifestPath)} \\`);
    lines.push('  --failed-only true');
    lines.push('```');
  } else {
    lines.push('- 本轮没有失败项，可以直接进入选图、复盘或下一轮扩图');
  }
  lines.push('- 如果要继续扩图，优先沿用这轮通过验证的任务参数');
  lines.push('- 如果要调整风格或批量策略，建议回到预览阶段重新确认');

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
