const QUIET = 'quiet';
const READY = 'ready';
const LIVE = 'live';
const DANGER = 'danger';

const GENERIC = {
  draft: { label: '草稿', tone: QUIET },
  awaiting_confirmation: { label: '待确认', tone: QUIET },
  confirmed: { label: '已确认', tone: READY },
  queued: { label: '排队中', tone: LIVE },
  running: { label: '运行中', tone: LIVE },
  pausing: { label: '正在暂停', tone: QUIET },
  paused: { label: '已暂停', tone: QUIET },
  resume_pending: { label: '等待会话确认', tone: QUIET },
  partial: { label: '部分完成', tone: QUIET },
  completed: { label: '已完成', tone: READY },
  failed: { label: '失败', tone: DANGER },
  cancelled: { label: '已取消', tone: QUIET },
  archived: { label: '已归档', tone: QUIET },
  keep: { label: '保留', tone: READY },
  review: { label: '待复核', tone: QUIET },
  reject: { label: '不采用', tone: DANGER },
  derive: { label: '衍生', tone: QUIET }
};

const PRESENTATIONS = {
  project: {
    active: { label: '开放', tone: READY },
    archived: GENERIC.archived
  },
  task: {
    draft: { label: '待规划', tone: QUIET },
    active: { label: '开放创作', tone: READY },
    completed: { label: '已收束', tone: READY },
    archived: GENERIC.archived
  },
  round: {
    draft: { label: '待规划', tone: QUIET },
    awaiting_confirmation: GENERIC.awaiting_confirmation,
    active: { label: '已确认 · 可继续', tone: READY },
    completed: { label: '已收束', tone: READY },
    archived: GENERIC.archived
  },
  run: {
    ...GENERIC,
    running: { label: '运行中', tone: LIVE },
    pausing: { label: '正在暂停', tone: QUIET }
  },
  run_item: {
    pending: { label: '等待处理', tone: QUIET },
    leased: { label: '正在准备', tone: LIVE },
    requesting: { label: '正在请求', tone: LIVE },
    receiving: { label: '正在接收', tone: LIVE },
    persisting: { label: '正在保存', tone: LIVE },
    succeeded: { label: '已完成', tone: READY },
    retry_wait: { label: '等待重试', tone: QUIET },
    blocked: { label: '已阻塞', tone: DANGER },
    cancel_requested: { label: '正在取消', tone: QUIET },
    cancelled: GENERIC.cancelled,
    outcome_unknown: { label: '需核实结果', tone: DANGER },
    failed: GENERIC.failed
  }
};

export function statusPresentation(scope, value) {
  return PRESENTATIONS[scope]?.[value] || GENERIC[value] || { label: String(value || '未知'), tone: QUIET };
}

export function taskPresentation(task, rounds = []) {
  if (!task) return { label: '未选择任务', tone: QUIET };
  if (task.status === 'archived' || task.status === 'completed') return statusPresentation('task', task.status);
  const confirmedRounds = rounds.filter((round) => round?.status === 'active').length;
  if (confirmedRounds) return { label: '已确认 · ' + confirmedRounds + ' 轮次', tone: READY };
  const awaitingRounds = rounds.filter((round) => round?.status === 'awaiting_confirmation').length;
  if (awaitingRounds) return { label: awaitingRounds + ' 轮待确认', tone: QUIET };
  return statusPresentation('task', task.status);
}

export function runExecutionPresentation(run, items = []) {
  if (!run) return { label: '尚无生成运行', tone: QUIET };
  if (['completed', 'partial', 'failed', 'cancelled', 'paused', 'resume_pending', 'pausing'].includes(run.status)) return statusPresentation('run', run.status);
  if (items.some((item) => ['requesting', 'receiving', 'persisting'].includes(item?.status))) return { label: '正在生成', tone: LIVE };
  if (items.some((item) => item?.status === 'leased')) return { label: '正在准备', tone: LIVE };
  if (items.some((item) => item?.status === 'retry_wait')) return { label: '等待重试', tone: QUIET };
  if (run.status === 'queued' || items.some((item) => item?.status === 'pending')) return { label: '排队中', tone: LIVE };
  return statusPresentation('run', run.status);
}

export function mergeRunHistoryItems(recordItems = [], liveItems = []) {
  const liveById = new Map(liveItems.map((item) => [item.id, item]));
  const merged = recordItems.map((recordItem) => {
    const liveItem = liveById.get(recordItem.id);
    if (!liveItem) return recordItem;
    liveById.delete(recordItem.id);
    return { ...recordItem, ...liveItem, outputAssets: liveItem.outputAssets || recordItem.outputAssets || [] };
  });
  return [...merged, ...liveById.values()];
}

export function runHistoryOption(run) {
  const createdAt = typeof run?.createdAt === 'string' && run.createdAt ? run.createdAt.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z') : '时间未知';
  const shortId = run?.shortId || String(run?.id || '').slice(-8) || '未知标识';
  const planVersion = Number.isInteger(run?.planVersion) ? 'v' + run.planVersion : 'v?';
  return createdAt + ' · ' + planVersion + ' · ' + shortId + ' · ' + statusPresentation('run', run?.status).label;
}

export function runItemRecovery(item) {
  const error = item?.error && typeof item.error === 'object' ? item.error : null;
  const safeError = error ? [error.summary, error.kind, error.code].filter((value) => typeof value === 'string' && value.trim()).join(' · ') : '';
  if (item?.status === 'retry_wait') return { error: safeError, advice: item.retryAt ? '系统将在 ' + item.retryAt + ' 后重试；也可立即重试此项。' : '系统正在等待重试；也可立即重试此项。' };
  if (item?.status === 'outcome_unknown') return { error: safeError, advice: '返回会话核实生成结果，再决定重试或保留。' };
  if (item?.status === 'blocked') return { error: safeError, advice: '先修复生成配置或输入约束，再重试此项。' };
  if (item?.status === 'failed') return { error: safeError, advice: '检查安全错误摘要后重试此项；仍失败时返回会话调整计划。' };
  return { error: safeError, advice: '' };
}
