/**
 * 选片时那些「会出错的判断」。
 *
 * 选片不是「记住一个 id 集合」那么简单：它是**一串串行的写**，每写一次都要回答
 * 「这次的返回值还算不算数」。切项目、连点多次、批量清空的中间失败，都会让某个
 * 请求的响应姗姗来迟 —— 如果照单全收，创作者会看到勾选莫名其妙地跳回去。
 *
 * 这里把判断抽出来：不碰 React、不碰 DOM、不发请求，只回答「该不该」。
 */

/** 清空/批量选片时一次最多带多少个 id。 */
export const SELECTION_BATCH_SIZE = 500;

/** 服务端返回的选片结果 -> id 集合。 */
export function selectionIdSet(selection) {
  return new Set((selection?.assets || []).map((asset) => asset.id));
}

/** 去重 + 去空，批量接口收到的 id 列表先过一遍。 */
export function normalizeAssetIds(assetIds) {
  return [...new Set(assetIds || [])].filter(Boolean);
}

/**
 * 勾选/取消后新的 id 集合。
 * @param {Set<string>} current
 * @param {string[]} assetIds
 * @param {boolean} selected
 * @returns {Set<string>}
 */
export function nextSelectedIds(current, assetIds, selected) {
  const next = new Set(current);
  for (const assetId of assetIds) {
    if (selected) next.add(assetId); else next.delete(assetId);
  }
  return next;
}

/** 一批 id 进入/退出「正在保存」状态。 */
export function nextBusySet(current, assetIds, busy) {
  const next = new Set(current);
  for (const assetId of assetIds) {
    if (busy) next.add(assetId); else next.delete(assetId);
  }
  return next;
}

/**
 * 这次写回来的结果还算不算数。
 *
 * 两个条件都要看：项目没被切走（切走了连 id 都不属于当前上下文），并且没有比它
 * 更新的写（连点时后一次会顶掉前一次）。**两个守卫其实是同一个判断**，所以成功
 * 应用与失败上报共用它 —— 改一处忘了另一处，就会出现「失败静默」或「旧结果覆盖
 * 新结果」。
 *
 * @param {object} input
 * @param {string} input.projectId 发起这次写时的项目
 * @param {string|null} input.currentProjectId 现在的项目
 * @param {number} input.epoch 这次写拿到的序号
 * @param {number} input.currentEpoch 现在的序号
 */
export function isSelectionWriteCurrent({ projectId, currentProjectId, epoch, currentEpoch }) {
  return currentProjectId === projectId && currentEpoch === epoch;
}

/**
 * 写完了，该不该解除这批 id 的「正在保存」。
 *
 * ⚠️ **故意只看项目、不看 epoch**。两点：
 *  1. 被更新的写顶掉时（epoch 过期但项目没变），仍要把它那批 id 放出来 —— 否则这些
 *     id 会永远卡在 busy 上，创作者再也点不动它们。这是它不看 epoch 的原因。
 *  2. 项目被切走时则不清：切换那一侧已经把选中集与 busy 集整体重置了，而这些 id
 *     属于旧项目，此时再清一次毫无意义。
 */
export function shouldClearSelectionBusy({ projectId, currentProjectId }) {
  return currentProjectId === projectId;
}

/** 按 SELECTION_BATCH_SIZE 切片，供批量接口分批提交。 */
export function chunkAssetIds(assetIds, size = SELECTION_BATCH_SIZE) {
  const ids = normalizeAssetIds(assetIds);
  const chunks = [];
  for (let offset = 0; offset < ids.length; offset += Math.max(1, size)) chunks.push(ids.slice(offset, offset + Math.max(1, size)));
  return chunks;
}

/**
 * 分批提交时保留最后一个非空结果。
 * 服务端对空批次可能不返回 selection，直接覆盖会把已选的清单清成空。
 */
export function latestSelection(current, incoming) {
  return incoming || current;
}

/**
 * 全选/全不选本页时，真正需要改动的那些资产。
 * `已选状态 !== 目标状态` 的才动，避免把已经是目标状态的资产再提交一遍。
 */
export function selectionCandidates(assets, selectedIds, selected) {
  return (assets || []).filter((asset) => Boolean(selectedIds.has(asset.id)) !== Boolean(selected));
}

/**
 * 顺带把这些资产标成「保留」的 id 列表 —— 只有勾选时才需要，取消时为空。
 * 还没有 keep 评审记录的资产才需要补一条。
 */
export function keepCandidateIds(assets, selected) {
  if (!selected) return [];
  return (assets || []).filter((asset) => asset?.review?.decision !== 'keep').map((asset) => asset.id);
}

/**
 * 把资产对象并进/移出当前选片清单。
 * @param {Array<{ id: string }>} current
 * @param {Array<{ id: string }|undefined>} assets 可能含 undefined（id 查不到资产时）
 * @param {boolean} selected
 */
export function mergeSelectionAssets(current, assets, selected) {
  const incoming = (assets || []).filter(Boolean);
  if (!selected) {
    const drop = new Set(incoming.map((asset) => asset.id));
    return current.filter((asset) => !drop.has(asset.id));
  }
  const known = new Set(current.map((asset) => asset.id));
  return [...current, ...incoming.filter((asset) => !known.has(asset.id))];
}

/** 选为成果前要不要先补一条「保留」评审。 */
export function needsKeepReview(asset) {
  return asset?.review?.decision !== 'keep';
}

/**
 * 点「选为成果」时该做什么：
 * 已选中的再点一次是**取消**，不是重复选；没有项目就什么都不做。
 * @returns {'skip'|'deselect'|'select'}
 */
export function deliverableIntent({ hasProject, isSelected }) {
  if (!hasProject) return 'skip';
  if (isSelected) return 'deselect';
  return 'select';
}
