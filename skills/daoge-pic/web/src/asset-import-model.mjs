/**
 * 导入图片时那些「会出错的判断」。
 *
 * 上传这件事本身只是发请求，真正容易埋雷的是几个判断：这张图该落到哪个范围、
 * 按什么用途进参考素材、进度怎么算、失败怎么汇总。它们过去散在 main.jsx 的
 * `upload()` 里，跟 13 个局部量缠在一起，谁也测不到。这里把它们收成纯函数：
 * 不碰 React、不碰 DOM，可以直接单测。
 */

import { REFERENCE_USAGE_LABELS, materialNeedUsagePreset } from './reference-usage-model.mjs';

/** 拖进来的一堆文件里，只有图片才进导入流程。 */
export function imageFilesFrom(files) {
  return Array.from(files || []).filter((file) => file?.type?.startsWith('image/'));
}

/**
 * 这次导入把图片挂到哪个范围（批次 > 任务 > 项目）。
 *
 * ⚠️ 这是**归属**判断：挂错了范围，素材就会出现在另一个工作对象下，而创作者
 * 只会觉得「我传的图不见了」。所以它被单独拎出来单测，不跟着 hook 一起搬。
 *
 * @param {object} input
 * @param {string} input.assetScope
 * @param {{ id: string }|null} [input.selectedRound]
 * @param {{ id: string }|null} [input.selectedTask]
 * @param {{ id: string }|null} [input.selectedProject]
 * @returns {{ type: string, id: string }|null}
 */
export function resolveUploadTarget({ assetScope, selectedRound = null, selectedTask = null, selectedProject = null }) {
  if (assetScope === 'round' && selectedRound) return { type: 'creative_round', id: selectedRound.id };
  if (assetScope === 'task' && selectedTask) return { type: 'creative_task', id: selectedTask.id };
  if (selectedProject) return { type: 'project', id: selectedProject.id };
  return null;
}

/**
 * 这次导入要不要按「素材需求」打标，以及用哪个用途。
 * 只有在当前上下文确实缺这个需求时才认，否则按范围给默认用途。
 *
 * @param {object} input
 * @param {string|null} input.selectedImportNeed
 * @param {string[]} [input.contextMaterialNeeds]
 * @param {string} input.assetScope
 * @returns {{ need: string, preset: { usage: string, usageLabel?: string, need?: string, hint?: string }|null }}
 */
export function resolveUploadMaterial({ selectedImportNeed, contextMaterialNeeds = [], assetScope }) {
  const need = selectedImportNeed && contextMaterialNeeds.includes(selectedImportNeed) ? selectedImportNeed : '';
  if (need) return { need, preset: materialNeedUsagePreset(need) };
  if (assetScope === 'round') return { need: '', preset: { usage: 'subject', usageLabel: REFERENCE_USAGE_LABELS.subject } };
  return { need: '', preset: null };
}

/** 完成一张。钳到总数，免得失败重试把进度刷成 101%。 */
export function advanceUploadProgress(current, total) {
  return { completed: Math.min(total, (current?.completed || 0) + 1), total };
}

/**
 * 把刚导入成功的素材并进本轮参考素材。
 * 同一个 assetId 以**新导入的为准**（覆盖用途与备注），不产生重复条目。
 */
export function mergeImportedReferences({ existing = [], importedAssets = [], usage = 'subject', note = '' }) {
  const materialMap = new Map(existing.filter(Boolean).map((item) => [item.assetId, item]));
  for (const asset of importedAssets) {
    if (!asset?.id) continue;
    materialMap.set(asset.id, { assetId: asset.id, usage, note });
  }
  return [...materialMap.values()];
}

/** 只有「本轮范围 + 批次还是草稿」才自动挂进参考素材：已确认的批次不该被静默改。 */
export function shouldLinkImportedToRound({ succeeded, importedCount, selectedRound, assetScope }) {
  return Boolean(succeeded && importedCount && selectedRound && assetScope === 'round' && selectedRound.status === 'draft');
}

/**
 * 导入结果 -> 给创作者看的一句提示 / 一句错误。
 * @param {object} input
 * @param {number} input.total
 * @param {Array<{ name: string }>} input.failed
 * @param {boolean} [input.savedAsReference]
 * @returns {{ succeeded: number, notice: string, error: string }}
 */
export function uploadOutcome({ total, failed = [], savedAsReference = false }) {
  const succeeded = total - failed.length;
  let notice = '';
  let error = '';
  if (succeeded) {
    notice = '已导入 ' + succeeded + ' 张图片'
      + (savedAsReference ? '，并已按用途加入当前这一轮的参考素材' : '')
      + (failed.length ? '，' + failed.length + ' 张失败。' : '。');
  }
  if (failed.length) {
    const names = failed.slice(0, 3).map((item) => item.name).join('、');
    error = '有 ' + failed.length + ' 张图片导入失败：' + names + (failed.length > 3 ? ' 等' : '') + '。';
  }
  return { succeeded, notice, error };
}

/** 遮罩导入：先判断能不能传，再拼请求头。返回空串表示可以传。 */
export function maskImportProblem({ selectedProject, file }) {
  if (!selectedProject) return '请先选择项目，再导入遮罩图。';
  if (!file?.type?.startsWith('image/')) return '请选择图片文件作为遮罩。';
  return '';
}

/** 遮罩导入的请求头。遮罩恒挂在项目下，不参与批次范围。 */
export function maskImportHeaders({ projectId, file }) {
  return {
    'x-daoge-filename': encodeURIComponent(file?.name || 'mask.png'),
    'x-daoge-target-type': 'project',
    'x-daoge-target-id': projectId
  };
}
