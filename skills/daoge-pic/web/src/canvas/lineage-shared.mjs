import { reviewDistribution } from '../batch-quality-model.mjs';
import { batchFailureSummary } from '../failure-copy-model.mjs';
import { redactLineageText } from '../lineage-accessible-model.mjs';
import { pendingRunItems } from '../run-item-pagination.mjs';
import { statusPresentation } from '../status-presentation.mjs';

/** 界面批 E（E2）从 creative-lineage-canvas.jsx 搬出（行为零变化）。 */

export const PURPOSE_LABELS = { exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' };

export const OPERATION_LABELS = { generation: '生成', generate: '生成', edit: '编辑', variation: '变体', refinement: '优化', fill: '补图' };

export const REVIEW_LABELS = { keep: '成果', review: '未定', reject: '不采用', derive: '可继续' };

export const CREATOR_MODES = [
  ['map', '全局', '看项目、任务、批次和交付全貌。图按批次收着，双击展开。'],
  ['assets', '按图片', '翻库：全部图片平铺，围绕关键图继续变体或精修。'],
  ['delivery', '按交付', '只看交付候选、交付包和最终路径。']
];

export const FILTERS = [
  ['all', '全部'],
  ['issues', '异常'],
  ['selected', '成果'],
  ['undecided', '未定'],
  ['rejected', '不采用'],
  ['delivery', '交付'],
  ['shared', '共享']
];

export const BACKGROUNDS = [
  ['lines', '网格'],
  ['dots', '点阵'],
  ['blank', '空白']
];

export const RELATION_OPTIONS = [
  ['reference', '参考自'],
  ['style', '风格继承'],
  ['alternative', '备选方案'],
  ['rejected', '客户否决'],
  ['todo', '待重做'],
  ['context', '计划信息']
];

export const TEMPLATE_OPTIONS = [
  ['project', '项目总览'],
  ['selection', '选片复盘'],
  ['feedback', '反馈追踪']
];

export const PERSISTED_NODE_TYPES = new Set(['task', 'round', 'asset']);

export const REFERENCE_TARGET_TYPES = ['task', 'round'];

export const DEFAULT_VIEWPORT = { x: 80, y: 80, k: 0.88 };

export const DEFAULT_SETTINGS = { filter: 'all', mode: 'map', background: 'lines', minimap: true, snapGrid: true, edgeLabels: true };

export const HISTORY_LIMIT = 50;

export const SNAP_SIZE = 24;

export const SAVE_STATUS_LABELS = { idle: '布局已保存', loading: '读取布局', queued: '等待保存', saving: '保存中', saved: '已保存', error: '保存失败' };

export const NODE_SIZE = {
  task: [250, 108],
  round: [238, 108],
  asset: [174, 220],
  placeholder: [174, 220]
};

export const EMPTY_ARRAY = /** @type {any[]} */ (Object.freeze([]));

export const EMPTY_SET = new Set();

export const PLAN_PROMPT_PROTECTED_LABEL = '提示词受保护，请在会话中查看。';

export const SAFE_NODE_SUMMARY_LABEL = '摘要已隐去隐私。';

export const LINEAGE_SENSITIVE_PATTERNS = [
  /https?:\/\/[^\s<>"']+/i,
  /[A-Za-z]:\\[^\r\n\t,;<>"']+/,
  /(^|[\s('"=:])\/(?:Users|home|tmp|var|private|Volumes|opt|srv|mnt|media|workspace)\/[^\s,;<>"')]+/,
  /\b(?:bearer|authorization|api[_ -]?key|x-goog-api-key|token|secret|password|capability)\s*[:=]?\s*[^\s,;<>"']+/i,
  /\b(?:sk|pk|rk|dgpct1)[-_a-z0-9.]{8,}\b/i,
  /(?:prompt|提示词|brief|response|响应体|request|请求体|raw|原始|url|链接|uri|endpoint|端点|path|路径)\s*[:=：]/i
];

export function nodeKey(entityType, entityId) { return entityType + ':' + entityId; }

export function clientId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

export function shortId(value) { return String(value || '').replace(/^[^_]+_/, '').slice(0, 8) || '未记录'; }

export function text(value) { return typeof value === 'string' ? value.trim() : ''; }

export function listValue(value) { return Array.isArray(value) ? value : EMPTY_ARRAY; }

export function idSetValue(value) { return value instanceof Set ? value : new Set(Array.isArray(value) ? value.filter(Boolean) : []); }

export function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

export function deliveryAssetIds(delivery) { return listValue(delivery?.items).map((item) => item.assetId || item.id).filter(Boolean); }

export function intersects(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }

export function clampScale(value) { return Math.min(5, Math.max(0.05, value)); }

export function normalizeViewport(value) { return { x: Number.isFinite(value?.x) ? value.x : DEFAULT_VIEWPORT.x, y: Number.isFinite(value?.y) ? value.y : DEFAULT_VIEWPORT.y, k: clampScale(Number.isFinite(value?.k) ? value.k : DEFAULT_VIEWPORT.k) }; }

export function clonePlain(value) { return JSON.parse(JSON.stringify(value)); }

export function snapshotKey(snapshot) { return JSON.stringify(snapshot); }

export function currentLayoutSnapshot({ positions, viewport, settings, groups, manualLinks, explicitKeys }) {
  return { positions: clonePlain(positions || {}), viewport: normalizeViewport(viewport), settings: clonePlain(settings || DEFAULT_SETTINGS), groups: clonePlain(groups || []), manualLinks: clonePlain(manualLinks || []), explicitKeys: [...(explicitKeys || EMPTY_SET)] };
}

export function endpointFromNode(node) { return { type: node.entityType, id: node.entityId }; }

export function relationLabel(type) { return RELATION_OPTIONS.find(([value]) => value === type)?.[1] || '标注关系'; }

export function nodeTypeLabel(type) { return ({ task: '任务', round: '批次', asset: '图片', placeholder: '正在生成', group: '分组' })[type] || type; }

export function isAssetNode(node) { return node?.entityType === 'asset'; }

export function mediaUnavailable(asset) { return asset?.deletedAt || asset?.mediaAvailable === false || asset?.mediaStatus === 'missing' || asset?.mediaStatus === 'unavailable'; }

export function hasProtectedLineageText(value) {
  const source = text(value);
  return Boolean(source && LINEAGE_SENSITIVE_PATTERNS.some((pattern) => pattern.test(source)));
}

export function safeDisplayText(value, fallback = SAFE_NODE_SUMMARY_LABEL, maxLength = 120) {
  const source = text(value);
  if (!source) return fallback;
  if (hasProtectedLineageText(source)) return fallback;
  return redactLineageText(source, maxLength) || fallback;
}

export function safeNodeTitle(entityType, value) { return safeDisplayText(value, nodeTypeLabel(entityType), 120); }

export function safeNodeSubtitle(value, fallback = '') { return value ? safeDisplayText(value, fallback || SAFE_NODE_SUMMARY_LABEL, 160) : fallback; }

export function safeSearchToken(value) { return hasProtectedLineageText(value) ? '' : redactLineageText(value, 120); }
/** @param {any} [output] */

export function planOutputSummary(output = {}) {
  if (!output || typeof output !== 'object') return '输出规格待确认';
  const dimensions = output.width && output.height ? output.width + '×' + output.height : '';
  return safeDisplayText([output.mediaType || output.format || '图片', output.aspectRatio || output.ratio, output.size || output.resolution || dimensions].filter(Boolean).join(' · '), '输出规格待确认', 96);
}

export function roundPlanDetails(round = {}) {
  const plan = round.plan || round.planSnapshot || {};
  const operation = safeDisplayText(text(plan.operation) || text(plan.mode) || 'generation', 'generation', 48);
  const itemCount = Number(plan.itemCount || plan.count || plan.items?.length || 0);
  const referenceCount = Number(plan.referenceCount || plan.referenceAssetIds?.length || plan.references?.length || 0);
  const maskCount = plan.maskAssetId || plan.mask ? 1 : 0;
  const output = plan.output || plan.outputSpec || {};
  return { operation, operationLabel: OPERATION_LABELS[operation] || operation, promptNotice: PLAN_PROMPT_PROTECTED_LABEL, itemCount, referenceCount, maskCount, outputSummary: planOutputSummary(output) };
}

export function roundOutputSummary(roundId, assets, runItems, runById) {
  if (!roundId) return '';
  const images = assets.filter((asset) => asset?.id && assetSourceRoundId(asset) === roundId).length;
  // 「没成」（failed / outcome_unknown）与「被挡」（blocked）**分开说**——两者的下一步不同（方案 4.10）。
  let failed = 0;
  let blocked = 0;
  runItems.forEach((item) => {
    const itemRound = item.roundId || runById?.get(item.runId)?.roundId;
    if (itemRound !== roundId) return;
    if (item.status === 'blocked') blocked += 1;
    else if (['failed', 'outcome_unknown'].includes(item.status)) failed += 1;
  });
  const failureText = batchFailureSummary({ failed, blocked });
  if (!images && !failureText) return '';
  return images + ' 张图' + (failureText ? ' · ' + failureText : '');
}

export function connectionPath(from, to) {
  const sx = from.x + from.width;
  const sy = from.y + from.height / 2;
  const tx = to.x;
  const ty = to.y + to.height / 2;
  const dx = Math.max(80, Math.abs(tx - sx) / 2);
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
}

export function connectionLabelPoint(from, to) { return { x: (from.x + from.width + to.x) / 2, y: (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 8 }; }

export function selectedNodeContextLine(node) {
  const status = isAssetNode(node) ? assetState(node.entity, node.selectedAsset, node.sharedAsset, node.deliveredAsset, node.mediaUnavailable) : statusPresentation(node.entityType === 'round' ? 'round' : node.entityType === 'task' ? 'task' : 'generic', node.status).label;
  return [nodeTypeLabel(node.entityType) + '：' + safeNodeTitle(node.entityType, node.title), status, safeNodeSubtitle(node.subtitle, ''), 'ID ' + shortId(node.entityId)].filter(Boolean).join(' · ');
}

export function assetLabel(asset) { return asset?.display?.label || asset?.source?.label || shortId(asset?.id); }

export function assetState(asset, selected, shared, delivered, unavailable, derived = false) {
  if (unavailable) return '媒体不可用';
  if (delivered) return '已交付';
  if (selected) return '已选成果';
  if (derived) return '已衍生';
  if (shared) return '共享素材';
  return REVIEW_LABELS[asset?.review?.decision] || '未评审';
}

export function assetBadges(node) {
  if (!isAssetNode(node)) return [];
  if (node.mediaUnavailable) return [['danger', '不可用']];
  if (node.deliveredAsset) return [['delivery', '已交付']];
  const decision = node.entity?.review?.decision;
  if (node.selectedAsset || decision === 'keep') return [['ready', '成果']];
  if (decision === 'reject') return [['danger', '不采用']];
  if (decision === 'derive') return [['derived', '可继续']];
  if (decision === 'review') return [['neutral', '未定']];
  if (node.sharedAsset) return [['shared', '共享']];
  return [];
}

export function roundReferenceMaterials(round) { return listValue(round?.plan?.referenceMaterials).filter((item) => item?.assetId); }

export function roundParentAssetIds(round) { return [...new Set([...listValue(round?.plan?.parentAssetIds), ...listValue(round?.plan?.sourceAssetIds), ...roundReferenceMaterials(round).filter((item) => item.usage === 'subject').map((item) => item.assetId)].filter(Boolean))]; }

export function roundMaskAssetIds(round) { return [...new Set([round?.plan?.maskAssetId, ...roundReferenceMaterials(round).filter((item) => item.usage === 'mask').map((item) => item.assetId)].filter(Boolean))]; }

export function usageLabel(usage) { return ({ subject: '主体参考', style: '风格参考', composition: '构图参考', color: '色彩参考', brand: '品牌参考', mask: '遮罩', negative: '反例参考' })[usage] || '参考素材'; }

export function assetSourceRoundId(asset) { return asset?.display?.roundId || asset?.source?.roundId || asset?.source?.creativeRoundId || null; }

export function assetSourceTaskId(asset) { return asset?.display?.taskId || asset?.source?.taskId || asset?.source?.creativeTaskId || null; }

export function taskForAsset(asset, tasks) { const taskId = assetSourceTaskId(asset); return listValue(tasks).find((task) => task.id === taskId) || null; }

export function taskForAssets(assets, tasks) { const taskIds = [...new Set(listValue(assets).map(assetSourceTaskId).filter(Boolean))]; return taskIds.length === 1 ? taskForAsset({ display: { taskId: taskIds[0] } }, tasks) : null; }

export function taskRounds(task, rounds) { return listValue(rounds).filter((round) => round.taskId === task?.id); }

export function runStatusCounts(runs) { return runs.reduce((acc, run) => ({ ...acc, [run.status || 'unknown']: (acc[run.status || 'unknown'] || 0) + 1 }), {}); }
/** 统计口径收进 batch-quality-model（唯一来源）；这里保留原名字，调用方不动。 */

export function reviewDecisionCounts(assets) {
  return reviewDistribution(listValue(assets));
}

export function defaultCollapsedFor(node) { return node?.collapsible === true; }
/** 没有展开批次时的常量集合，避免每次渲染新建。 */

export const EMPTY_ROUND_SET = new Set();

export function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function findFreeSlot(node, occupied) {
  if (!occupied.length) return { x: node.x, y: node.y };
  const step = Math.max(60, Math.round((node.height || 120) * 0.75));
  let y = node.y;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = { x: node.x, y, width: node.width, height: node.height };
    if (!occupied.some((rect) => rectsOverlap(rect, candidate))) return { x: node.x, y };
    y += step;
  }
  return { x: node.x, y: node.y };
}

export function createNode(entityType, entity, position, overrides = {}) {
  const [width, height] = NODE_SIZE[entityType] || [220, 120];
  const entityId = overrides.entityId || (typeof entity === 'string' ? entity : entity?.id);
  const node = { key: nodeKey(entityType, entityId), entityType, entityId, entity, x: position.x, y: position.y, width, height, status: entity?.status || 'active', ...overrides };
  const wideNode = /** @type {any} */ (node);
  const safeNode = { ...wideNode, title: safeNodeTitle(entityType, wideNode.title), subtitle: safeNodeSubtitle(wideNode.subtitle, '') };
  return { ...safeNode, searchText: overrides.searchText || nodeSearchHaystack(safeNode) };
}

export function groupMemberBounds(group, nodes) {
  const members = nodes.filter((node) => node.groupId === group.id);
  if (!members.length || group.metadata?.collapsed) return group;
  const bounds = members.reduce((acc, node) => ({ left: Math.min(acc.left, node.x), top: Math.min(acc.top, node.y), right: Math.max(acc.right, node.x + node.width), bottom: Math.max(acc.bottom, node.y + node.height) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  return { ...group, x: bounds.left - 24, y: bounds.top - 54, width: bounds.right - bounds.left + 48, height: bounds.bottom - bounds.top + 78 };
}

export function serializeGroup(group, nodes) {
  const measured = groupMemberBounds(group, nodes);
  return { id: group.id, title: group.title, groupType: group.groupType || 'custom', x: measured.x, y: measured.y, width: measured.width, height: measured.height, metadata: { ...(group.metadata || {}) } };
}

export function manualConnection(link) { return { id: 'manual:' + link.id, from: nodeKey(link.sourceType, link.sourceId), to: nodeKey(link.targetType, link.targetId), type: 'manual', linkType: link.linkType || 'custom', label: link.label || relationLabel(link.linkType), manual: true }; }

export function endpointFromKey(key) {
  const value = String(key || '');
  const separator = value.indexOf(':');
  return separator > 0 ? { type: value.slice(0, separator), id: value.slice(separator + 1) } : null;
}

export function lineageExportLink(connection) {
  const source = endpointFromKey(connection?.from);
  const target = endpointFromKey(connection?.to);
  if (!source || !target) return null;
  const linkType = connection.linkType || connection.type || 'custom';
  return { sourceType: source.type, sourceId: source.id, targetType: target.type, targetId: target.id, linkType, label: connection.label || relationLabel(linkType) };
}

export function relatedLinksForNode(links, node) { return node ? links.filter((link) => (link.sourceType === node.entityType && link.sourceId === node.entityId) || (link.targetType === node.entityType && link.targetId === node.entityId)) : []; }

export function dataTransferHasType(dataTransfer, type) {
  const types = dataTransfer?.types;
  if (!types) return false;
  if (typeof types.includes === 'function') return types.includes(type);
  if (typeof types.contains === 'function') return types.contains(type);
  return Array.from(types).includes(type);
}

export function canWriteTextClipboard() { return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'; }

export function boundsForItems(items) {
  if (!items.length) return null;
  const raw = items.reduce((acc, item) => ({ left: Math.min(acc.left, item.x), top: Math.min(acc.top, item.y), right: Math.max(acc.right, item.x + item.width), bottom: Math.max(acc.bottom, item.y + item.height) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  return { x: raw.left, y: raw.top, width: raw.right - raw.left, height: raw.bottom - raw.top };
}

export function positionedItems(nodes, positions) {
  return nodes.map((node) => ({ ...node, ...(positions[node.key] || {}) }));
}

export function safeMenuPoint(clientX, clientY) {
  if (typeof window === 'undefined') return { x: clientX, y: clientY };
  return { x: Math.max(12, Math.min(clientX, Math.max(12, window.innerWidth - 236))), y: Math.max(12, Math.min(clientY, Math.max(12, window.innerHeight - 280))) };
}

export function nodeSearchHaystack(node) {
  return [safeSearchToken(node.title), safeSearchToken(node.subtitle), node.entityType, node.entityId, node.status, safeSearchToken(node.planDetail?.outputSummary), safeSearchToken(node.planDetail?.operationLabel), node.entity?.review?.decision, node.outputSource?.itemSequence, node.linkType].filter(Boolean).join(' ').toLowerCase();
}

export function buildGraph({ tasks, selectedTask, rounds, selectedRound, runs, activeRun, runItems, assets, selectedAssetIds, sharedAssetIds, deliveries }) {
  if (!tasks) return { nodes: [], connections: [], metrics: { issues: 0, selected: 0, assets: 0, deliveries: 0, reviews: reviewDecisionCounts([]) } };
  const safeTasks = listValue(tasks);
  const safeRounds = listValue(rounds);
  const safeRuns = listValue(runs);
  const runById = new Map(safeRuns.map((run) => [run.id, run]));
  const safeRunItems = listValue(runItems);
  const safeAssets = listValue(assets);
  const safeDeliveries = listValue(deliveries);
  const selectedAssetSet = selectedAssetIds instanceof Set ? selectedAssetIds : EMPTY_SET;
  const sharedAssetSet = sharedAssetIds instanceof Set ? sharedAssetIds : EMPTY_SET;
  const nodes = [];
  const connections = [];
  const connectionIds = new Set();
  const connect = (from, to, type, label) => {
    if (!from || !to) return;
    const id = from + '->' + to + ':' + type + ':' + (label || '');
    if (connectionIds.has(id)) return;
    connectionIds.add(id);
    connections.push({ id, from, to, type, label, manual: false });
  };
  const deliveredAssetIds = new Set(safeDeliveries.flatMap(deliveryAssetIds));
  const outputByAsset = new Map();
  for (const item of safeRunItems) {
    const outputs = [...(item?.result?.assetId ? [{ id: item.result.assetId }] : []), ...listValue(item?.outputAssets)];
    for (const output of outputs) {
      if (!output?.id || outputByAsset.has(output.id)) continue;
      outputByAsset.set(output.id, { itemId: item.id, itemSequence: item.sequence, runId: item.runId || activeRun?.id, attempts: item.attempts || 0, retry: Number(item.attempts || 0) > 1 });
    }
  }

  const taskList = selectedTask ? [selectedTask] : safeTasks;
  const taskIndexById = new Map(taskList.map((task, index) => [task.id, index]));
  const visibleRounds = safeRounds.filter((round) => taskIndexById.has(round.taskId));
  const roundLocalIndex = new Map();
  const roundAnchorById = new Map();
  const derivedAssetIds = new Set();

  // 项目不是画布节点，是画布的标题与边界（方案 6.2）：它由画布的 heading 与顶栏承载。
  taskList.forEach((task, index) => {
    const roundsForTask = taskRounds(task, visibleRounds);
    const y = selectedTask ? 0 : index * Math.max(260, 152 + roundsForTask.length * 150);
    const taskNode = createNode('task', task, { x: 0, y }, { title: task.name, subtitle: [task.status === 'completed' ? '已完成任务' : '任务', task.taskTypeId || '通用创作', roundsForTask.length ? roundsForTask.length + ' 个批次' : '暂无批次'].filter(Boolean).join(' · '), tone: 'task', focused: selectedTask?.id === task.id });
    nodes.push(taskNode);
  });

  visibleRounds.forEach((round) => {
    const taskIndex = taskIndexById.get(round.taskId) || 0;
    const localIndex = roundLocalIndex.get(round.taskId) || 0;
    roundLocalIndex.set(round.taskId, localIndex + 1);
    const taskBaseY = selectedTask ? 0 : taskIndex * Math.max(260, 152 + taskRounds({ id: round.taskId }, visibleRounds).length * 150);
    const y = taskBaseY + localIndex * 150;
    roundAnchorById.set(round.id, { x: 310, y });
    const detail = roundPlanDetails(round);
    const parentAssets = roundParentAssetIds(round);
    const references = roundReferenceMaterials(round);
    const masks = roundMaskAssetIds(round);
    for (const assetId of parentAssets) derivedAssetIds.add(assetId);
    // 去冗余（方案 4.3 第二刀）：计划是批次的属性、运行与出图槽位是中间过程——
    // 三者都不再各占一个画布节点，信息收进批次节点（计划详情）与输出摘要（几张图 / 几张没成）。
    const outputSummary = roundOutputSummary(round.id, safeAssets, safeRunItems, runById);
    const roundNode = createNode('round', round, { x: 310, y }, { title: (PURPOSE_LABELS[round.purpose] || round.purpose) + '批次', subtitle: ['计划 v' + round.planVersion, detail.operationLabel, detail.itemCount ? detail.itemCount + ' 项' : '', parentAssets.length ? parentAssets.length + ' 张父资产' : '', references.length ? references.length + ' 张参考' : '', outputSummary].filter(Boolean).join(' · '), status: round.status, tone: 'round', planDetail: detail, collapsible: true, focused: selectedRound?.id === round.id });
    nodes.push(roundNode);
    connect(nodeKey('task', round.taskId), roundNode.key, 'contains', '包含批次');
    if (round.parentRoundId) connect(nodeKey('round', round.parentRoundId), roundNode.key, 'lineage', '衍生自');
    for (const assetId of parentAssets) connect(nodeKey('asset', assetId), roundNode.key, 'lineage', '衍生起点');
    // 参考素材与遮罩原本挂在计划节点上；计划节点取消后，它们直接挂在批次上。
    for (const material of references) connect(nodeKey('asset', material.assetId), roundNode.key, material.usage === 'negative' ? 'manual' : 'reference', usageLabel(material.usage));
    for (const assetId of masks) connect(nodeKey('asset', assetId), roundNode.key, 'reference', '遮罩');
  });

  const assetLaneIndex = new Map();
  safeAssets.forEach((asset) => {
    if (!asset?.id) return;
    const selected = selectedAssetSet.has(asset.id);
    const shared = sharedAssetSet.has(asset.id);
    const delivered = deliveredAssetIds.has(asset.id);
    const derived = derivedAssetIds.has(asset.id) || asset.review?.decision === 'derive';
    const unavailable = mediaUnavailable(asset);
    const source = outputByAsset.get(asset.id);
    const sourceRoundId = assetSourceRoundId(asset);
    const sourceTaskId = assetSourceTaskId(asset);
    const laneKey = sourceRoundId || sourceTaskId || 'project';
    const localIndex = assetLaneIndex.get(laneKey) || 0;
    assetLaneIndex.set(laneKey, localIndex + 1);
    const sourceAnchor = sourceRoundId ? roundAnchorById.get(sourceRoundId) : null;
    const taskIndex = sourceTaskId ? taskIndexById.get(sourceTaskId) : null;
    const yBase = sourceAnchor ? sourceAnchor.y : Number.isInteger(taskIndex) ? 170 + taskIndex * 260 : 40;
    const sourceText = source ? '来自第 ' + source.itemSequence + ' 项' + (source.retry ? ' · 重试产物' : '') : sourceRoundId ? '来自批次结果' : '';
    const subtitle = [assetState(asset, selected, shared, delivered, unavailable, derived), sourceText].filter(Boolean).join(' · ');
    const assetNode = createNode('asset', asset, { x: 1490 + (localIndex % 3) * 198, y: yBase + Math.floor(localIndex / 3) * 250 }, { title: assetLabel(asset), subtitle, status: unavailable ? 'unavailable' : asset.review?.decision || (selected ? 'selected' : derived ? 'derived' : 'active'), tone: shared ? 'shared' : 'asset', selectedAsset: selected, sharedAsset: shared, deliveredAsset: delivered, derivedAsset: derived, mediaUnavailable: unavailable, outputSource: source || null, roundId: sourceRoundId, focused: Boolean(activeRun?.id && source?.runId === activeRun.id) });
    nodes.push(assetNode);
    // B2 删掉出图槽位中间层后，图**直接挂批次** —— 这是归属图唯一的入边，
    // 不能只补给「无 output 来源」的那部分（否则大部分图展开批次后没有线，2026-09-17 实机抓到的回归）。
    if (sourceRoundId) connect(nodeKey('round', sourceRoundId), assetNode.key, 'generated', '批次结果');
  });

  // C4（方案 4.9）：还没出完的项**先立占位格**——它同时说明「要出几张」和「出了几张」，
  // 比一个进度数字有用得多。占位与图同尺寸、排在同一条道上，出一张就顶掉一个占位。
  for (const item of pendingRunItems(safeRunItems)) {
    const itemRun = runById.get(item.runId) || activeRun;
    const itemRoundId = item.roundId || itemRun?.roundId || null;
    const laneKey = itemRoundId || 'project';
    const localIndex = assetLaneIndex.get(laneKey) || 0;
    assetLaneIndex.set(laneKey, localIndex + 1);
    const anchor = itemRoundId ? roundAnchorById.get(itemRoundId) : null;
    const yBase = anchor ? anchor.y : 40;
    nodes.push(createNode('placeholder', item, { x: 1490 + (localIndex % 3) * 198, y: yBase + Math.floor(localIndex / 3) * 250 }, { title: '生成中', subtitle: '第 ' + item.sequence + ' 张 · 还没出来', status: item.status, tone: 'pending', roundId: itemRoundId }));
  }

  // 共享素材走「导入」、交付在交付页、规则资料在规则资料页（方案 4.3 / 6.2 / 7.11）：
  // 它们的能力都有新家，不再各占一个画布节点（工程的「收」= 换位置，不是删能力）。
  // 「这张图已交付 / 已共享」的标记仍留在图节点上——那是图自己的状态。

  const selectedCount = safeAssets.filter((asset) => selectedAssetSet.has(asset?.id)).length;
  const issues = [...safeRuns, ...safeRunItems].filter((item) => /failed|blocked|unknown|resume_pending|partial/.test(item?.status || '')).length;
  return { nodes, connections, metrics: { issues, selected: selectedCount, assets: safeAssets.length, deliveries: safeDeliveries.length, reviews: reviewDecisionCounts(safeAssets) } };
}

export function applySavedLayout(nodes, positions) {
  return nodes.map((node) => {
    const saved = positions[node.key] || positions[node.entityType + ':' + node.entityId];
    return saved ? { ...node, ...saved } : node;
  });
}

export function visibleByFilter(node, filter, selectedKeys) {
  if (filter === 'all') return true;
  if (filter === 'issues') return /failed|blocked|unknown|resume_pending|partial|error|unavailable/.test(node.status || '');
  if (filter === 'selected') return node.selectedAsset || selectedKeys.has(node.key) || (isAssetNode(node) && node.entity?.review?.decision === 'keep');
  if (filter === 'undecided') return isAssetNode(node) && (!node.entity?.review?.decision || node.entity?.review?.decision === 'review');
  if (filter === 'rejected') return isAssetNode(node) && node.entity?.review?.decision === 'reject';
  if (filter === 'delivery') return node.deliveredAsset || (node.selectedAsset && node.entity?.review?.decision === 'keep');
  if (filter === 'shared') return node.sharedAsset;
  return true;
}

export function normalizeCanvasMode(mode) {
  if (mode === 'flow') return 'assets';
  if (mode === 'rounds') return 'map';
  return mode;
}

export function visibleByMode(node, rawMode, expandedRoundIds = EMPTY_ROUND_SET) {
  const mode = normalizeCanvasMode(rawMode);
  // 折叠语义（方案 4.3 第一刀）：批次收起 = 这批的图**全部**收进去——
  // 已选定 / 已交付 / 可继续也不例外（数量在批次摘要里、内容在展开后，一样不少）。
  // 否则只要批里有几张已选的图，批次就**永远关不上**（2026-09-17 刀哥实机抓到）。
  const collapsedIntoBatch = isAssetNode(node) && node.roundId && !expandedRoundIds.has(node.roundId);
  if (mode === 'map') return ['task', 'round'].includes(node.entityType)
    // 折叠到批次级：批次默认收起，它的图只在**展开**时铺到画布上。
    || ((isAssetNode(node) || node.entityType === 'placeholder') && node.roundId && expandedRoundIds.has(node.roundId))
    || (!collapsedIntoBatch && (node.selectedAsset || node.deliveredAsset || node.derivedAsset || node.entity?.review?.decision === 'keep'));
  if (mode === 'assets') return ['task', 'round', 'asset'].includes(node.entityType);
  if (mode === 'delivery') return node.deliveredAsset || node.selectedAsset || node.entity?.review?.decision === 'keep';
  return true;
}

export function openNode(node, { onNavigate, onInspectAsset }) {
  if (node.entityType === 'task') onNavigate({ view: 'lineage', taskId: node.entity.id, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
  else if (node.entityType === 'round') onNavigate({ view: 'prompts', taskId: node.entity.taskId, roundId: node.entity.id, compareRoundIds: [node.entity.id], runId: null, assetScope: 'round' });
  else if (isAssetNode(node)) onInspectAsset(node.entity.id);
}

export function contextRouteForNode(node) {
  if (!node) return null;
  if (node.entityType === 'task') return { view: 'lineage', projectId: node.entity.projectId, taskId: node.entity.id, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' };
  if (node.entityType === 'round') return { view: 'lineage', taskId: node.entity.taskId, roundId: node.entity.id, compareRoundIds: [node.entity.id], runId: null, assetScope: 'round' };
  return null;
}
