// 画布上「右键菜单 / 浮出工具条」放什么（方案 4.4）。
//
// 判据只有一条：**这个动作有没有「作用对象」？**
//   有 → 右键菜单（对它做什么）；没有 → 工具栏（怎么看）。
// 所以这里只回答「对一个具体节点，能对它做什么」——**全是动词**，
// 不出现「计划信息」「运行」这类名词（方案 4.4 明文：没有一项叫这些）。
//
// 菜单还要**随对象状态变**：候选 / 已选定 / 已交付 三套完全不同。
// 这是纯函数，所以「三套不同」这件事能真跑单测（守卫见 tests/vnext/lineage-menu.test.js）。

/** 每张菜单最多几项（方案 4.4：3–4 项）。主体项先占位，详情永远留一格。 */
export const MENU_ITEM_LIMIT = 4;

/**
 * @param {any} node 画布节点
 * @param {{ canReview?: boolean, canDeliver?: boolean, canDerive?: boolean, collapsed?: boolean }} [options]
 *   `canDerive` 指「照它再来几张」——它要经队列派给 agent，本批还没有队列，所以传 false 时不出现。
 * @returns {Array<{ id: string, label: string, primary?: boolean }>}
 */
export function nodeMenuItems(node, { canReview = false, canDeliver = false, canDerive = false, collapsed = false } = {}) {
  if (!node) return [];
  const type = node.entityType;
  const body = [];
  // 推入顺序 = 优先级：决策项 > 终点动作 > 依赖队列的动作。超出上限时**先被切掉的是最不需要的**。
  const pushDerive = () => { if (canDerive) body.push({ id: 'derive', label: '照它再来几张' }); };

  if (type === 'asset' && !node.externalSharedAsset) {
    if (node.deliveredAsset) {
      // 已交付：这批图已经出去了，能做的只剩「找到它」和「拿走」。
      body.push({ id: 'open-delivery', label: '查看所在交付' });
      body.push({ id: 'download', label: '下载' });
    } else if (node.selectedAsset) {
      // 已选定：下一步是「用它」或「不要了」。
      body.push({ id: 'unkeep', label: '移出成果' });
      if (canDeliver) body.push({ id: 'deliver', label: '去交付' });
      pushDerive();
    } else {
      // 候选：最常走的一套——选为成果 / 不采用。交付候选 = 选定的图（动态投影），
      // 非成果进不了候选，所以「去交付」只在已选定态出现。
      body.push({ id: 'keep', label: '选为成果', primary: true });
      body.push({ id: 'reject', label: '不采用' });
      pushDerive();
    }
  } else if (type === 'round') {
    // 批次：折叠态给「展开」，展开态给「收起」——同一格随状态换说法。
    body.push({ id: 'toggle', label: collapsed ? '展开这一批的图' : '收起这一批的图' });
    if (canReview) body.push({ id: 'confirm', label: '审阅并确认计划' });
    if (canDeliver) body.push({ id: 'deliver', label: '去交付' });
  } else if (type === 'task') {
    body.push({ id: 'open', label: '打开这个任务' });
    body.push({ id: 'new-round', label: '新建批次' });
  } else if (type === 'project') {
    body.push({ id: 'open', label: '打开项目全貌' });
    body.push({ id: 'new-task', label: '在项目里新建任务' });
  } else if (type === 'placeholder') {
    // 占位是「还在生成的那一张」，此刻没有可做的决定。
    return [{ id: 'detail', label: '详情' }];
  } else {
    body.push({ id: 'open', label: '打开' });
  }

  // 主体项最多 3 条，「详情」永远占最后一格 —— 于是每张菜单 3–4 项（方案 4.4）。
  return [...body.slice(0, MENU_ITEM_LIMIT - 1), { id: 'detail', label: '详情' }];
}
