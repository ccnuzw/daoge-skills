export function projectDeliverySelection(projectId, assets = []) {
  const selectedAssets = Array.isArray(assets) ? assets.filter(Boolean) : [];
  const eligibleAssets = selectedAssets.filter((asset) => !asset.deletedAt && asset.review?.decision === 'keep');
  const ineligibleAssets = selectedAssets.filter((asset) => !asset.deletedAt && asset.review?.decision !== 'keep');
  const state = !projectId ? 'needs_project' : !selectedAssets.length ? 'needs_selection' : ineligibleAssets.length ? 'needs_review' : eligibleAssets.length ? 'ready' : 'needs_selection';
  return { state, selectedAssets, eligibleAssets, ineligibleAssets };
}

export function deliverySelectionMessage(selection) {
  if (selection.state === 'needs_project') return '先打开一个项目，再选择要交付的成果。';
  if (selection.state === 'needs_selection') return '先在项目资产中选中至少一张已保留成果。';
  if (selection.state === 'needs_review') return '当前选片含未保留成果，完成评审或移出选片后才能创建草稿。';
  return selection.eligibleAssets.length + ' 张已保留选片可创建交付草稿。';
}

/**
 * 「拿出去」挂选中的判定（方案 7.11.2 / 4.3 · 施工单 G4 / H1）。
 *
 * 交付是一个**动作**（挑完就地接那一下），不是「另开一个地方走流程」。所以发起要挂在
 * 「选中已保留成果」这个前提下：给得出就可用，给不出就给一句人话——
 * **绝不给一个点了没用的按钮**（第 2 批「空壳按钮」的教训）。
 */
export function deliveryIntentFromSelection(input = {}) {
  const projectId = input.projectId || null;
  const selection = input.selection && typeof input.selection === 'object'
    ? input.selection
    : projectDeliverySelection(projectId, []);
  return { canStart: selection.state === 'ready', state: selection.state, copy: deliverySelectionMessage(selection) };
}
