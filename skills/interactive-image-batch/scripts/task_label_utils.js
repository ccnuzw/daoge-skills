const path = require('path');
const { readJsonIfExists } = require('./script_utils');

function cleanLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function looksInternalLabel(value) {
  const label = cleanLabel(value);
  if (!label) return true;
  if (/^(out|dist|build|output|outputs|result|results|tmp|temp|artifacts?)$/i.test(label)) return true;
  return /^(board_[a-z0-9_-]+|sample_preview_[a-z0-9_-]+|[a-z0-9]+(?:_[a-z0-9-]+){2,})$/i.test(label);
}

function pickPromptItems(outputDir) {
  const prompts = readJsonIfExists(path.join(outputDir, 'prompts.generated.json'));
  return Array.isArray(prompts) ? prompts : [];
}

function getBoardName(item = {}, promptItems = []) {
  const source = cleanLabel(
    item.boardId
    || item.board_id
    || promptItems[0]?.boardId
    || promptItems[0]?.board_id
    || ''
  ).toLowerCase();

  if (source.includes('board-a') || source.includes('board_a')) return 'A 段整板';
  if (source.includes('board-b') || source.includes('board_b')) return 'B 段整板';
  return '整板任务';
}

function getShotLabel(promptItems = []) {
  const first = promptItems[0] || {};
  const raw = cleanLabel(first.shot_label || first.title || first.slug || '');
  if (!raw) return '';
  return raw.replace(/^shot\s*\d+\s*/i, '').replace(/\s*sample$/i, '').trim();
}

function deriveTaskLabel(item = {}, outputDir) {
  const outputName = path.basename(outputDir);
  if (!looksInternalLabel(item.taskLabel)) return cleanLabel(item.taskLabel);

  const promptItems = pickPromptItems(outputDir);
  const selectedCount = Number(item.selectedCount || item.promptCount || 0);
  const manifestSampleSize = Number(item.sampleSize || 0);
  const isPausedPreview = manifestSampleSize > 0 || String(item.pauseReason || '').includes('sample');
  const isRerun = Boolean(item.resumeManifest) || selectedCount === 1;
  const shotLabel = getShotLabel(promptItems);
  const boardName = getBoardName(item, promptItems);

  if (isRerun && shotLabel) return `${shotLabel} 修订任务`;
  if (isPausedPreview && selectedCount > 0) return `${boardName} 抽样预览（${selectedCount} 张）`;
  if (promptItems.length > 1) return `${boardName}（${selectedCount || promptItems.length} 张）`;
  if (shotLabel) return `${shotLabel} 单张任务`;
  if (selectedCount > 0) return `图像任务（${selectedCount} 张）`;
  return outputName;
}

module.exports = {
  cleanLabel,
  looksInternalLabel,
  pickPromptItems,
  getBoardName,
  getShotLabel,
  deriveTaskLabel,
};
