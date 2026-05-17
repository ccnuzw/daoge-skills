const fs = require('fs');
const path = require('path');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function createJobState(outputDir, config, plan) {
  return {
    jobId: path.basename(outputDir),
    outputDir,
    status: 'planned',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    promptSource: config.promptsFile,
    selectedCount: config.selectedCount,
    batchSize: config.batchSize,
    stageSize: config.stageSize || null,
    sampleSize: config.sampleSize || 0,
    concurrency: config.concurrency,
    retryCount: config.retryCount,
    timeoutSeconds: config.timeoutSeconds,
    pausePolicy: config.pausePolicy,
    progress: {
      completedBatches: 0,
      totalBatches: plan.batchCount,
      completedPrompts: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      currentStage: null,
      currentBatch: null,
    },
    pauseReason: null,
    completedBatchNumbers: [],
  };
}

function writeJobState(outputDir, state) {
  state.updatedAt = new Date().toISOString();
  writeJson(path.join(outputDir, 'job_state.json'), state);
}

function writeCheckpoint(outputDir, state, batchManifest = null) {
  const checkpointsDir = path.join(outputDir, 'checkpoints');
  fs.mkdirSync(checkpointsDir, { recursive: true });
  const checkpoint = {
    writtenAt: new Date().toISOString(),
    status: state.status,
    pauseReason: state.pauseReason,
    progress: state.progress,
    completedBatchNumbers: state.completedBatchNumbers,
    latestBatch: batchManifest ? {
      batchNumber: batchManifest.batchNumber,
      success: batchManifest.success,
      failed: batchManifest.failed,
      promptCount: batchManifest.promptCount,
      outputDir: batchManifest.outputDir,
    } : null,
  };
  writeJson(path.join(outputDir, 'checkpoint.json'), checkpoint);
  if (batchManifest) {
    writeJson(path.join(checkpointsDir, `checkpoint_batch_${String(batchManifest.batchNumber).padStart(3, '0')}.json`), checkpoint);
  }
}

function skippedCount(results) {
  return (results || []).filter((item) => item.skipped).length;
}

function stageLabel(stageType) {
  if (stageType === 'sample') return '样本阶段';
  if (stageType === 'production') return '正式阶段';
  return stageType || '未标记阶段';
}

function translatePauseReason(reason) {
  const text = String(reason || '').trim();
  if (!text) return '未说明';
  if (text === 'sample_stage_completed_review_required') return '样本阶段已完成，等待人工复核后再继续';
  let match = text.match(/^batch_failure_rate (.+)% exceeded (.+)%$/);
  if (match) return `单批失败率 ${match[1]}% 超过阈值 ${match[2]}%`;
  match = text.match(/^consecutive_failures (.+) reached threshold (.+)$/);
  if (match) return `连续失败 ${match[1]} 次，已达到阈值 ${match[2]}`;
  return text;
}

function printExecutionStart(ctx) {
  console.log('DAOGE 状态：正在执行');
  console.log(`[DAOGE][执行总览] 共 ${ctx.selectedCount} 张，分 ${ctx.stageCount} 个阶段、${ctx.batchCount} 批执行`);
  console.log(`[DAOGE][执行总览] 默认尺寸 ${ctx.width}x${ctx.height}，并发 ${ctx.concurrency}，超时 ${ctx.timeoutSeconds} 秒，重试 ${ctx.retryCount} 次`);
  console.log(`[DAOGE][执行总览] 输出目录：${ctx.outputDir}`);
}

function printBatchStart(plannedBatch, totalBatches) {
  console.log('DAOGE 状态：正在执行');
  console.log(`[DAOGE][批次开始] 第 ${plannedBatch.batchNumber}/${totalBatches} 批 | ${stageLabel(plannedBatch.stageType)} ${plannedBatch.stageNumber} | ${plannedBatch.promptCount} 张 | 索引 ${plannedBatch.firstIndex} -> ${plannedBatch.lastIndex}`);
}

function printBatchSummary(plannedBatch, batchManifest, state) {
  const skipped = skippedCount(batchManifest.results);
  console.log(`[DAOGE][批次完成] 第 ${plannedBatch.batchNumber}/${batchManifest.totalBatches} 批：成功 ${batchManifest.success}，失败 ${batchManifest.failed}，跳过 ${skipped}`);
  console.log(`[DAOGE][累计进度] 已完成 ${state.progress.completedBatches}/${state.progress.totalBatches} 批，成功 ${state.progress.success}，失败 ${state.progress.failed}，跳过 ${state.progress.skipped}，已处理 ${state.progress.completedPrompts}/${state.selectedCount} 张`);
}

function updateStateAfterBatch(state, batchManifest) {
  const results = batchManifest.results || [];
  state.progress.completedBatches += 1;
  state.progress.completedPrompts += batchManifest.promptCount || results.length;
  state.progress.success += batchManifest.success || 0;
  state.progress.failed += batchManifest.failed || 0;
  state.progress.skipped += results.filter((item) => item.skipped).length;
  state.progress.currentBatch = batchManifest.batchNumber;
  state.completedBatchNumbers.push(batchManifest.batchNumber);
}

function maxConsecutiveFailures(results) {
  let max = 0;
  let current = 0;
  for (const item of results) {
    if (item.ok) {
      current = 0;
    } else {
      current += 1;
      max = Math.max(max, current);
    }
  }
  return max;
}

function evaluatePausePolicy(batchManifest, allResults, policy) {
  if (!policy || policy.enabled === false) return null;
  const batchRate = batchManifest.promptCount ? batchManifest.failed / batchManifest.promptCount : 0;
  if (policy.maxBatchFailureRate <= 1 && batchRate > policy.maxBatchFailureRate) {
    return `batch_failure_rate ${Number((batchRate * 100).toFixed(2))}% exceeded ${Number((policy.maxBatchFailureRate * 100).toFixed(2))}%`;
  }
  const consecutive = maxConsecutiveFailures(allResults);
  if (policy.maxConsecutiveFailures > 0 && consecutive >= policy.maxConsecutiveFailures) {
    return `consecutive_failures ${consecutive} reached threshold ${policy.maxConsecutiveFailures}`;
  }
  return null;
}

module.exports = {
  writeJson,
  createJobState,
  writeJobState,
  writeCheckpoint,
  translatePauseReason,
  printExecutionStart,
  printBatchStart,
  printBatchSummary,
  updateStateAfterBatch,
  evaluatePausePolicy,
};
