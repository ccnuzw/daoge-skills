function statusBadge(status) {
  const labels = {
    ready: 'DAOGE 状态：已就绪',
    preview: 'DAOGE 状态：预览完成，等待确认',
    running: 'DAOGE 状态：正在执行',
    paused: 'DAOGE 状态：已暂停，等待处理',
    done: 'DAOGE 状态：任务完成',
    blocked: 'DAOGE 状态：需要补充信息',
  };
  return labels[status] || `DAOGE 状态：${status || '未设置'}`;
}

function brandHeader(title, status = 'ready') {
  return [
    `# ${title}`,
    '',
    `> ${statusBadge(status)}`,
    '> 你只需要确认方向、参数和风险；文件、批次和续跑记录由 DAOGE 管。',
  ];
}

function quickReplyBlock(replies) {
  const list = Array.isArray(replies) ? replies.filter(Boolean) : [];
  if (!list.length) return [];
  return [
    '',
    '## 可直接回复',
    '',
    ...list.map((item) => `- ${item}`),
  ];
}

function userFocusBlock(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return [];
  return [
    '',
    '## 你先看这三件事',
    '',
    ...list.slice(0, 3).map((item) => `- ${item}`),
  ];
}

module.exports = {
  statusBadge,
  brandHeader,
  quickReplyBlock,
  userFocusBlock,
};
