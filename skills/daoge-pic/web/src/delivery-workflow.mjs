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
