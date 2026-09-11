import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, BookOpen, Bookmark, BoxSelect, Check, Columns3, Copy, Download, Eye, GitFork, Grid2X2, Image, LoaderCircle, Map as MapIcon, Move, PackageCheck, Palette, Pause, Play, Redo2, RefreshCw, Save, Search, Share2, Sparkles, Tag, Trash2, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { assetThumbnailUrl } from './asset-media-url.mjs';
import { creativeLibraryResources, filterCreativeLibraryResources } from './creative-library-model.mjs';
import { createLineageExport, lineageExportFilename } from './lineage-export-model.mjs';
import { runExecutionPresentation, statusPresentation } from './status-presentation.mjs';
import { CreativeActionLauncher } from './creative-action-launcher.jsx';

const PURPOSE_LABELS = { exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' };
const OPERATION_LABELS = { generation: '生成', generate: '生成', edit: '编辑', variation: '变体', refinement: '优化', fill: '补图' };
const REVIEW_LABELS = { keep: '成果', review: '未定', reject: '不采用', derive: '可继续' };
const CREATOR_MODES = [
  ['map', '项目地图', '看项目、任务、轮次和交付全貌。'],
  ['flow', '任务创作流', '沿参考、计划、运行、结果继续推进。'],
  ['rounds', '轮次对比', '比较每一轮方向和保留率。'],
  ['assets', '资产分支', '围绕关键图片继续变体或精修。'],
  ['delivery', '交付路线', '只看交付候选、交付包和最终路径。']
];
const FILTERS = [
  ['all', '全部'],
  ['issues', '异常'],
  ['selected', '成果'],
  ['undecided', '未定'],
  ['rejected', '不采用'],
  ['delivery', '交付'],
  ['shared', '共享']
];
const BACKGROUNDS = [
  ['lines', '网格'],
  ['dots', '点阵'],
  ['blank', '空白']
];
const RELATION_OPTIONS = [
  ['reference', '参考自'],
  ['style', '风格继承'],
  ['alternative', '备选方案'],
  ['rejected', '客户否决'],
  ['todo', '待重做'],
  ['context', '计划上下文']
];
const RESOURCE_FILTERS = [
  ['all', '全部'],
  ['task', '任务类型'],
  ['style', '风格包'],
  ['brand', '品牌包']
];
const TEMPLATE_OPTIONS = [
  ['project', '项目总览'],
  ['selection', '选片复盘'],
  ['feedback', '反馈追踪'],
  ['resource', '资料规划']
];
const RESOURCE_NODE_TYPES = ['task_type', 'style_kit', 'brand_kit'];
const REFERENCE_TARGET_TYPES = ['project', 'task', 'round', 'plan'];
const DEFAULT_VIEWPORT = { x: 80, y: 80, k: 0.88 };
const DEFAULT_SETTINGS = { filter: 'all', mode: 'map', background: 'lines', minimap: true, snapGrid: true, edgeLabels: true };
const HISTORY_LIMIT = 50;
const SNAP_SIZE = 24;
const CULL_MARGIN = 520;
const SAVE_STATUS_LABELS = { idle: '布局已保存', loading: '读取布局', queued: '等待保存', saving: '保存中', saved: '已保存', error: '保存失败' };
const NODE_SIZE = {
  project: [250, 112],
  task: [250, 108],
  round: [238, 108],
  plan: [268, 142],
  run: [260, 128],
  run_item: [210, 102],
  asset: [174, 220],
  shared_asset: [174, 220],
  delivery: [230, 118],
  task_type: [230, 116],
  style_kit: [230, 116],
  brand_kit: [230, 116]
};
const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_SET = new Set();

function nodeKey(entityType, entityId) { return entityType + ':' + entityId; }
function clientId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
function shortId(value) { return String(value || '').replace(/^[^_]+_/, '').slice(0, 8) || '未记录'; }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function listValue(value) { return Array.isArray(value) ? value : EMPTY_ARRAY; }
function idSetValue(value) { return value instanceof Set ? value : new Set(Array.isArray(value) ? value.filter(Boolean) : []); }
function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
function deliveryAssetIds(delivery) { return listValue(delivery?.items).map((item) => item.assetId || item.id).filter(Boolean); }
function intersects(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
function clampScale(value) { return Math.min(5, Math.max(0.05, value)); }
function normalizeViewport(value) { return { x: Number.isFinite(value?.x) ? value.x : DEFAULT_VIEWPORT.x, y: Number.isFinite(value?.y) ? value.y : DEFAULT_VIEWPORT.y, k: clampScale(Number.isFinite(value?.k) ? value.k : DEFAULT_VIEWPORT.k) }; }
function clonePlain(value) { return JSON.parse(JSON.stringify(value)); }
function snapshotKey(snapshot) { return JSON.stringify(snapshot); }
function currentLayoutSnapshot({ positions, viewport, settings, groups, manualLinks, resourcePlacements }) {
  return { positions: clonePlain(positions || {}), viewport: normalizeViewport(viewport), settings: clonePlain(settings || DEFAULT_SETTINGS), groups: clonePlain(groups || []), manualLinks: clonePlain(manualLinks || []), resourcePlacements: clonePlain(resourcePlacements || []) };
}
function resourceEntityType(kind) { return kind === 'task' ? 'task_type' : kind === 'style' ? 'style_kit' : 'brand_kit'; }
function isResourceType(type) { return RESOURCE_NODE_TYPES.includes(type); }
function resourceNodeKey(resource) { return nodeKey(resource.entityType, resource.resourceId); }
function endpointFromNode(node) { return { type: node.entityType, id: node.entityId }; }
function relationLabel(type) { return RELATION_OPTIONS.find(([value]) => value === type)?.[1] || '标注关系'; }
function safeResourceSummary(resource) { return String(resource?.summary || resource?.source || '可作为计划上下文。').slice(0, 96); }
function nodeTypeLabel(type) { return ({ project: '项目', task: '任务', round: '轮次', plan: '计划', run: '生成运行', run_item: '运行项', asset: '项目资产', shared_asset: '共享素材', delivery: '交付', task_type: '任务类型', style_kit: '风格包', brand_kit: '品牌包', group: '分组' })[type] || type; }
function isAssetNode(node) { return node?.entityType === 'asset' || node?.entityType === 'shared_asset'; }
function mediaUnavailable(asset) { return asset?.deletedAt || asset?.mediaAvailable === false || asset?.mediaStatus === 'missing' || asset?.mediaStatus === 'unavailable'; }
function planOutputSummary(output = {}) {
  if (!output || typeof output !== 'object') return '输出规格待确认';
  const dimensions = output.width && output.height ? output.width + '×' + output.height : '';
  return [output.mediaType || output.format || '图片', output.aspectRatio || output.ratio, output.size || output.resolution || dimensions].filter(Boolean).join(' · ');
}
function roundPlanDetails(round = {}) {
  const plan = round.plan || round.planSnapshot || {};
  const operation = text(plan.operation) || text(plan.mode) || 'generation';
  const prompt = text(plan.prompt) || text(plan.promptSummary) || text(plan.description) || '计划内容待会话写入';
  const itemCount = Number(plan.itemCount || plan.count || plan.items?.length || 0);
  const referenceCount = Number(plan.referenceCount || plan.referenceAssetIds?.length || plan.references?.length || 0);
  const maskCount = plan.maskAssetId || plan.mask ? 1 : 0;
  const output = plan.output || plan.outputSpec || {};
  return { operation, operationLabel: OPERATION_LABELS[operation] || operation, prompt, itemCount, referenceCount, maskCount, outputSummary: planOutputSummary(output), output };
}
function planSummary(round) {
  const detail = roundPlanDetails(round);
  return [detail.operationLabel, detail.itemCount ? detail.itemCount + ' 项' : '', detail.outputSummary, detail.referenceCount ? detail.referenceCount + ' 个参考' : '', detail.maskCount ? '含遮罩' : ''].filter(Boolean).join(' · ');
}
function connectionPath(from, to) {
  const sx = from.x + from.width;
  const sy = from.y + from.height / 2;
  const tx = to.x;
  const ty = to.y + to.height / 2;
  const dx = Math.max(80, Math.abs(tx - sx) / 2);
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
}
function connectionLabelPoint(from, to) { return { x: (from.x + from.width + to.x) / 2, y: (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 8 }; }
function selectedNodeContextLine(node) {
  const status = isAssetNode(node) ? assetState(node.entity, node.selectedAsset, node.sharedAsset, node.deliveredAsset, node.mediaUnavailable) : statusPresentation(node.entityType === 'run_item' ? 'run_item' : node.entityType === 'run' ? 'run' : node.entityType === 'delivery' ? 'delivery' : 'generic', node.status).label;
  return [nodeTypeLabel(node.entityType) + '：' + node.title, status, node.subtitle, 'ID ' + shortId(node.entityId)].filter(Boolean).join(' · ');
}
function assetLabel(asset) { return asset?.display?.label || asset?.source?.label || shortId(asset?.id); }
function assetState(asset, selected, shared, delivered, unavailable, derived = false) {
  if (unavailable) return '媒体不可用';
  if (delivered) return '已交付';
  if (selected) return '已选成果';
  if (derived) return '已衍生';
  if (shared) return '共享素材';
  return REVIEW_LABELS[asset?.review?.decision] || '未评审';
}
function assetBadges(node) {
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
function roundReferenceMaterials(round) { return listValue(round?.plan?.referenceMaterials).filter((item) => item?.assetId); }
function roundParentAssetIds(round) { return [...new Set([...listValue(round?.plan?.parentAssetIds), ...listValue(round?.plan?.sourceAssetIds), ...roundReferenceMaterials(round).filter((item) => item.usage === 'subject').map((item) => item.assetId)].filter(Boolean))]; }
function roundMaskAssetIds(round) { return [...new Set([round?.plan?.maskAssetId, ...roundReferenceMaterials(round).filter((item) => item.usage === 'mask').map((item) => item.assetId)].filter(Boolean))]; }
function usageLabel(usage) { return ({ subject: '主体参考', style: '风格参考', composition: '构图参考', color: '色彩参考', brand: '品牌参考', mask: '遮罩', negative: '反例参考' })[usage] || '参考素材'; }
function assetSourceRoundId(asset) { return asset?.display?.roundId || asset?.source?.roundId || asset?.source?.creativeRoundId || null; }
function assetSourceTaskId(asset) { return asset?.display?.taskId || asset?.source?.taskId || asset?.source?.creativeTaskId || null; }
function taskForAsset(asset, tasks) { const taskId = assetSourceTaskId(asset); return listValue(tasks).find((task) => task.id === taskId) || null; }
function taskForAssets(assets, tasks) { const taskIds = [...new Set(listValue(assets).map(assetSourceTaskId).filter(Boolean))]; return taskIds.length === 1 ? taskForAsset({ display: { taskId: taskIds[0] } }, tasks) : null; }
function taskIntentSummary(task) { return text(task?.intent?.brief || task?.intent?.goal || task?.intent?.description || task?.intent?.summary || task?.intent?.creativeIntent || ''); }
function taskRounds(task, rounds) { return listValue(rounds).filter((round) => round.taskId === task?.id); }
function runStatusCounts(runs) { return runs.reduce((acc, run) => ({ ...acc, [run.status || 'unknown']: (acc[run.status || 'unknown'] || 0) + 1 }), {}); }
function reviewDecisionCounts(assets) {
  return listValue(assets).reduce((acc, asset) => {
    const key = asset?.deletedAt ? 'trash' : asset?.review?.decision || 'unreviewed';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { keep: 0, review: 0, reject: 0, derive: 0, unreviewed: 0, trash: 0 });
}
function createNode(entityType, entity, position, overrides = {}) {
  const [width, height] = NODE_SIZE[entityType] || [220, 120];
  const entityId = overrides.entityId || (typeof entity === 'string' ? entity : entity?.id);
  const node = { key: nodeKey(entityType, entityId), entityType, entityId, entity, x: position.x, y: position.y, width, height, status: entity?.status || 'active', ...overrides };
  return { ...node, searchText: overrides.searchText || nodeSearchHaystack(node) };
}
function createResourceNode(resource, position) {
  const entityType = resource.entityType || resourceEntityType(resource.kind);
  const entity = { ...resource, id: resource.resourceId };
  return createNode(entityType, entity, position, { title: resource.title, subtitle: resource.source + ' · ' + safeResourceSummary(resource), status: 'active', tone: entityType, resourceNode: true });
}
function createResourceCatalog(taskTypes, styleKits, brandKits) { return creativeLibraryResources({ taskTypes, styleKits, brandKits, assets: [] }).map((resource) => ({ ...resource, entityType: resourceEntityType(resource.kind) })); }
function groupMemberBounds(group, nodes) {
  const members = nodes.filter((node) => node.groupId === group.id);
  if (!members.length || group.metadata?.collapsed) return group;
  const bounds = members.reduce((acc, node) => ({ left: Math.min(acc.left, node.x), top: Math.min(acc.top, node.y), right: Math.max(acc.right, node.x + node.width), bottom: Math.max(acc.bottom, node.y + node.height) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  return { ...group, x: bounds.left - 24, y: bounds.top - 54, width: bounds.right - bounds.left + 48, height: bounds.bottom - bounds.top + 78 };
}
function serializeGroup(group, nodes) {
  const measured = groupMemberBounds(group, nodes);
  return { id: group.id, title: group.title, groupType: group.groupType || 'custom', x: measured.x, y: measured.y, width: measured.width, height: measured.height, metadata: { ...(group.metadata || {}) } };
}
function manualConnection(link) { return { id: 'manual:' + link.id, from: nodeKey(link.sourceType, link.sourceId), to: nodeKey(link.targetType, link.targetId), type: 'manual', linkType: link.linkType || 'custom', label: link.label || relationLabel(link.linkType), manual: true }; }
function endpointFromKey(key) {
  const value = String(key || '');
  const separator = value.indexOf(':');
  return separator > 0 ? { type: value.slice(0, separator), id: value.slice(separator + 1) } : null;
}
function lineageExportLink(connection) {
  const source = endpointFromKey(connection?.from);
  const target = endpointFromKey(connection?.to);
  if (!source || !target) return null;
  const linkType = connection.linkType || connection.type || 'custom';
  return { sourceType: source.type, sourceId: source.id, targetType: target.type, targetId: target.id, linkType, label: connection.label || relationLabel(linkType) };
}
function relatedLinksForNode(links, node) { return node ? links.filter((link) => (link.sourceType === node.entityType && link.sourceId === node.entityId) || (link.targetType === node.entityType && link.targetId === node.entityId)) : []; }
function expandedBounds(bounds, margin) { return { x: bounds.x - margin, y: bounds.y - margin, width: bounds.width + margin * 2, height: bounds.height + margin * 2 }; }
function dataTransferHasType(dataTransfer, type) {
  const types = dataTransfer?.types;
  if (!types) return false;
  if (typeof types.includes === 'function') return types.includes(type);
  if (typeof types.contains === 'function') return types.contains(type);
  return Array.from(types).includes(type);
}
function canWriteTextClipboard() { return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'; }
function boundsForItems(items) {
  if (!items.length) return null;
  const raw = items.reduce((acc, item) => ({ left: Math.min(acc.left, item.x), top: Math.min(acc.top, item.y), right: Math.max(acc.right, item.x + item.width), bottom: Math.max(acc.bottom, item.y + item.height) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  return { x: raw.left, y: raw.top, width: raw.right - raw.left, height: raw.bottom - raw.top };
}
function positionedItems(nodes, positions) {
  return nodes.map((node) => ({ ...node, ...(positions[node.key] || {}) }));
}
function safeMenuPoint(clientX, clientY) {
  if (typeof window === 'undefined') return { x: clientX, y: clientY };
  return { x: Math.max(12, Math.min(clientX, Math.max(12, window.innerWidth - 236))), y: Math.max(12, Math.min(clientY, Math.max(12, window.innerHeight - 280))) };
}
function nodeSearchHaystack(node) {
  return [node.title, node.subtitle, node.entityType, node.entityId, node.status, node.planDetail?.prompt, node.planDetail?.outputSummary, node.planDetail?.operationLabel, node.entity?.review?.decision, node.outputSource?.itemSequence, node.linkType].filter(Boolean).join(' ').toLowerCase();
}

function buildGraph({ project, tasks, selectedTask, rounds, selectedRound, runs, activeRun, runItems, assets, sharedAssets, selectedAssetIds, sharedAssetIds, deliveries, resourcePlacements, resourceCatalog }) {
  if (!project) return { nodes: [], connections: [], metrics: { issues: 0, selected: 0, assets: 0, deliveries: 0, resources: 0, reviews: reviewDecisionCounts([]) } };
  const safeTasks = listValue(tasks);
  const safeRounds = listValue(rounds);
  const safeRuns = listValue(runs);
  const safeRunItems = listValue(runItems);
  const safeAssets = listValue(assets);
  const safeSharedAssets = listValue(sharedAssets);
  const safeDeliveries = listValue(deliveries);
  const safeResourcePlacements = listValue(resourcePlacements);
  const safeResourceCatalog = listValue(resourceCatalog);
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

  const projectNode = createNode('project', project, { x: 0, y: 0 }, { title: project.name, subtitle: (project.description || '项目工作区').slice(0, 80), tone: 'project', focused: true });
  nodes.push(projectNode);

  taskList.forEach((task, index) => {
    const roundsForTask = taskRounds(task, visibleRounds);
    const intent = taskIntentSummary(task);
    const y = selectedTask ? 170 : 170 + index * Math.max(260, 152 + roundsForTask.length * 150);
    const taskNode = createNode('task', task, { x: 0, y }, { title: task.name, subtitle: [task.status === 'completed' ? '已完成任务' : '任务', task.taskTypeId || '通用创作', intent || '', roundsForTask.length ? roundsForTask.length + ' 个轮次' : '暂无轮次'].filter(Boolean).join(' · '), tone: 'task', focused: selectedTask?.id === task.id });
    nodes.push(taskNode);
    connect(projectNode.key, taskNode.key, 'contains', '包含任务');
  });

  visibleRounds.forEach((round) => {
    const taskIndex = taskIndexById.get(round.taskId) || 0;
    const localIndex = roundLocalIndex.get(round.taskId) || 0;
    roundLocalIndex.set(round.taskId, localIndex + 1);
    const taskBaseY = selectedTask ? 170 : 170 + taskIndex * Math.max(260, 152 + taskRounds({ id: round.taskId }, visibleRounds).length * 150);
    const y = taskBaseY + localIndex * 150;
    roundAnchorById.set(round.id, { x: 310, y });
    const detail = roundPlanDetails(round);
    const parentAssets = roundParentAssetIds(round);
    const references = roundReferenceMaterials(round);
    const masks = roundMaskAssetIds(round);
    for (const assetId of parentAssets) derivedAssetIds.add(assetId);
    const roundNode = createNode('round', round, { x: 310, y }, { title: (PURPOSE_LABELS[round.purpose] || round.purpose) + '轮次', subtitle: ['计划 v' + round.planVersion, detail.operationLabel, parentAssets.length ? parentAssets.length + ' 张父资产' : '', references.length ? references.length + ' 张参考' : ''].filter(Boolean).join(' · '), tone: 'round', focused: selectedRound?.id === round.id });
    const planNode = createNode('plan', round, { x: 590, y }, { title: '计划 v' + round.planVersion, subtitle: planSummary(round), status: round.status, tone: 'plan', planDetail: detail, focused: selectedRound?.id === round.id });
    nodes.push(roundNode, planNode);
    connect(nodeKey('task', round.taskId), roundNode.key, 'contains', '包含轮次');
    if (round.parentRoundId) connect(nodeKey('round', round.parentRoundId), roundNode.key, 'lineage', '衍生自');
    connect(roundNode.key, planNode.key, 'plan', '计划');
    for (const assetId of parentAssets) connect(nodeKey('asset', assetId), roundNode.key, 'lineage', '衍生起点');
    for (const material of references) connect(nodeKey(material.externalShared ? 'shared_asset' : 'asset', material.assetId), planNode.key, material.usage === 'negative' ? 'manual' : 'reference', usageLabel(material.usage));
    for (const assetId of masks) connect(nodeKey('asset', assetId), planNode.key, 'reference', '遮罩');
  });

  const runLocalIndex = new Map();
  safeRuns.forEach((run, index) => {
    const anchor = roundAnchorById.get(run.roundId);
    const localIndex = runLocalIndex.get(run.roundId) || 0;
    runLocalIndex.set(run.roundId, localIndex + 1);
    const y = anchor ? anchor.y + localIndex * 136 : 70 + index * 160;
    const runNode = createNode('run', run, { x: 900, y }, { title: '生成运行 ' + shortId(run.id), subtitle: '计划 v' + run.planVersion + ' · ' + (run.executionConcurrency || 0) + ' 路并发', status: run.status, tone: 'run', focused: activeRun?.id === run.id });
    nodes.push(runNode);
    connect(nodeKey('plan', run.roundId), runNode.key, 'run', '提交运行');
  });

  safeRunItems.forEach((item, index) => {
    const itemNode = createNode('run_item', item, { x: 1200, y: 58 + index * 118 }, { title: '第 ' + item.sequence + ' 项', subtitle: item.error?.summary || ('尝试 ' + (item.attempts || 0) + ' 次' + (Number(item.attempts || 0) > 1 ? ' · 重试产物' : '')), status: item.status, tone: 'run-item', focused: activeRun?.id && (item.runId || activeRun?.id) === activeRun.id });
    nodes.push(itemNode);
    connect(nodeKey('run', item.runId || activeRun?.id), itemNode.key, 'run-item', '运行项');
    if (item.result?.assetId) connect(itemNode.key, nodeKey('asset', item.result.assetId), 'generated', '生成资产');
    for (const output of listValue(item.outputAssets)) if (output?.id) connect(itemNode.key, nodeKey('asset', output.id), 'generated', '生成资产');
  });

  const assetLaneIndex = new Map();
  const currentAssetIds = new Set(safeAssets.map((asset) => asset?.id).filter(Boolean));
  safeAssets.forEach((asset, index) => {
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
    const sourceText = source ? '来自第 ' + source.itemSequence + ' 项' + (source.retry ? ' · 重试产物' : '') : sourceRoundId ? '来自轮次结果' : '';
    const subtitle = [assetState(asset, selected, shared, delivered, unavailable, derived), sourceText].filter(Boolean).join(' · ');
    const assetNode = createNode('asset', asset, { x: 1490 + (localIndex % 3) * 198, y: yBase + Math.floor(localIndex / 3) * 250 }, { title: assetLabel(asset), subtitle, status: unavailable ? 'unavailable' : asset.review?.decision || (selected ? 'selected' : derived ? 'derived' : 'active'), tone: shared ? 'shared' : 'asset', selectedAsset: selected, sharedAsset: shared, deliveredAsset: delivered, derivedAsset: derived, mediaUnavailable: unavailable, outputSource: source || null, focused: Boolean(activeRun?.id && source?.runId === activeRun.id) });
    nodes.push(assetNode);
    if (!source && sourceRoundId) connect(nodeKey('round', sourceRoundId), assetNode.key, 'generated', '轮次结果');
  });

  let externalSharedIndex = 0;
  safeSharedAssets.forEach((asset) => {
    if (!asset?.id || currentAssetIds.has(asset.id)) return;
    const index = externalSharedIndex;
    externalSharedIndex += 1;
    const delivered = deliveredAssetIds.has(asset.id);
    nodes.push(createNode('shared_asset', asset, { x: 1490 + (index % 3) * 198, y: 40 + Math.floor(index / 3) * 250 }, { title: assetLabel(asset), subtitle: delivered ? '跨项目共享素材 · 已交付' : '跨项目共享素材', status: 'shared', tone: 'shared', selectedAsset: false, sharedAsset: true, deliveredAsset: delivered, externalSharedAsset: true, mediaUnavailable: mediaUnavailable(asset) }));
  });

  safeDeliveries.forEach((delivery, index) => {
    const deliveryNode = createNode('delivery', delivery, { x: 2120, y: 70 + index * 150 }, { title: delivery.name, subtitle: (deliveryAssetIds(delivery).length || 0) + ' 张图片 · ' + delivery.status, status: delivery.status, tone: 'delivery' });
    nodes.push(deliveryNode);
    for (const assetId of deliveryAssetIds(delivery)) connect(nodeKey('asset', assetId), deliveryNode.key, 'delivery', '加入交付');
  });

  const resourceByKey = new Map(safeResourceCatalog.map((resource) => [resourceNodeKey(resource), resource]));
  safeResourcePlacements.forEach((placement, index) => {
    const key = nodeKey(placement.entityType, placement.entityId);
    const resource = resourceByKey.get(key);
    if (!resource) return;
    nodes.push(createResourceNode(resource, { x: 250 + (index % 2) * 250, y: 450 + Math.floor(index / 2) * 138 }));
  });

  const selectedCount = safeAssets.filter((asset) => selectedAssetSet.has(asset?.id)).length;
  const issues = [...safeRuns, ...safeRunItems].filter((item) => /failed|blocked|unknown|resume_pending|partial/.test(item?.status || '')).length;
  return { nodes, connections, metrics: { issues, selected: selectedCount, assets: safeAssets.length, deliveries: safeDeliveries.length, resources: safeResourcePlacements.length, reviews: reviewDecisionCounts(safeAssets) } };
}

function applySavedLayout(nodes, positions) {
  return nodes.map((node) => {
    const saved = positions[node.key] || positions[node.entityType + ':' + node.entityId];
    return saved ? { ...node, ...saved } : node;
  });
}
function visibleByFilter(node, filter, selectedKeys) {
  if (filter === 'all') return true;
  if (filter === 'issues') return /failed|blocked|unknown|resume_pending|partial|error|unavailable/.test(node.status || '');
  if (filter === 'selected') return node.selectedAsset || selectedKeys.has(node.key) || (isAssetNode(node) && node.entity?.review?.decision === 'keep');
  if (filter === 'undecided') return isAssetNode(node) && !node.externalSharedAsset && (!node.entity?.review?.decision || node.entity?.review?.decision === 'review');
  if (filter === 'rejected') return isAssetNode(node) && node.entity?.review?.decision === 'reject';
  if (filter === 'delivery') return node.entityType === 'delivery' || node.deliveredAsset || (node.selectedAsset && node.entity?.review?.decision === 'keep');
  if (filter === 'shared') return node.sharedAsset || node.entityType === 'shared_asset';
  return true;
}
function visibleByMode(node, mode) {
  if (mode === 'flow') return true;
  if (mode === 'map') return ['project', 'task', 'round', 'delivery'].includes(node.entityType) || node.selectedAsset || node.deliveredAsset || node.derivedAsset || node.entity?.review?.decision === 'keep';
  if (mode === 'rounds') return ['project', 'task', 'round', 'plan', 'run'].includes(node.entityType) || node.entity?.review?.decision === 'keep' || node.entity?.review?.decision === 'reject' || node.selectedAsset || node.deliveredAsset;
  if (mode === 'assets') return ['project', 'task', 'round', 'asset', 'shared_asset', 'delivery'].includes(node.entityType);
  if (mode === 'delivery') return ['project', 'delivery'].includes(node.entityType) || node.deliveredAsset || node.selectedAsset || node.entity?.review?.decision === 'keep';
  return true;
}

function statusCountText(counts) {
  const parts = Object.entries(counts || {}).filter(([, value]) => value > 0).map(([status, value]) => statusPresentation('run', status).label + ' ' + value);
  return parts.length ? parts.join(' / ') : '暂无运行';
}

function sessionContextLine(sessionPlanStatus, selectedTask, selectedRound) {
  const context = sessionPlanStatus?.context;
  if (context?.project?.name) {
    const round = context.round;
    return [context.task?.name, round ? (PURPOSE_LABELS[round.purpose] || round.purpose) + ' · 计划 v' + round.planVersion : '未绑定轮次'].filter(Boolean).join(' / ');
  }
  if (selectedRound) return (PURPOSE_LABELS[selectedRound.purpose] || selectedRound.purpose) + ' · 计划 v' + selectedRound.planVersion;
  if (selectedTask) return selectedTask.name;
  return '未绑定活动轮次';
}

function planStatusLine(sessionPlanStatus, selectedRound) {
  const contextRound = sessionPlanStatus?.context?.round;
  const round = selectedRound || contextRound;
  const pendingForRound = Boolean(sessionPlanStatus?.pendingConfirmation && (!selectedRound || !contextRound?.id || contextRound.id === selectedRound.id));
  if (pendingForRound) return '待确认；确认后由 Agent 执行预检和运行。';
  if (sessionPlanStatus?.confirmation?.confirmed && (!selectedRound || !contextRound?.id || contextRound.id === selectedRound.id)) return '计划已确认；预检与运行仍由 Agent 受控执行。';
  if (sessionPlanStatus?.latestRun && (!selectedRound || !contextRound?.id || contextRound.id === selectedRound.id)) return '最近运行：' + statusPresentation('run', sessionPlanStatus.latestRun.status).label;
  if (round?.status === 'draft') return '草稿轮次，可继续补充参考或整理计划。';
  if (round) return '状态：' + statusPresentation('generic', round.status).label;
  return '';
}

function LineageWorkspaceSummary({ project, selectedTask, selectedRound, runs = EMPTY_ARRAY, sessionPlanStatus, graph, mode, onMode, onOpenTasks, onCreateTask }) {
  const reviews = graph.metrics.reviews || {};
  const currentMode = CREATOR_MODES.find(([value]) => value === mode) || CREATOR_MODES[0];
  const undecided = (reviews.unreviewed || 0) + (reviews.review || 0);
  const metrics = [
    { key: 'selected', className: 'is-delivery', value: graph.metrics.selected || reviews.keep || 0, label: '成果' },
    { key: 'undecided', className: 'is-unreviewed', value: undecided, label: '未定' },
    { key: 'reject', className: 'is-reject', value: reviews.reject || 0, label: '不采用' },
    { key: 'runs', className: 'is-runs', value: runs.length, label: '运行', title: statusCountText(runStatusCounts(runs)) }
  ];
  const contextStatus = planStatusLine(sessionPlanStatus, selectedRound);
  return <div className="lineage-workspace-summary" data-lineage-no-zoom>
    <section className="lineage-focus-strip" aria-label="谱系当前视图与上下文">
      <section className="lineage-mode-panel" aria-label="创作谱系工作模式">
        <div className="lineage-mode-heading"><span>视图</span><strong>{currentMode[1]}</strong><small>{currentMode[2]}</small></div>
        <div className="lineage-mode-grid" role="radiogroup" aria-label="切换谱系视图">
          {CREATOR_MODES.map(([value, label, description]) => <button type="button" key={value} className={mode === value ? 'is-active' : ''} aria-pressed={mode === value} onClick={() => onMode(value)}><strong>{label}</strong><span>{description}</span></button>)}
        </div>
      </section>
      <div className="lineage-context-column">
        <div className="lineage-context-card">
          <span>上下文</span>
          <strong>{sessionContextLine(sessionPlanStatus, selectedTask, selectedRound)}</strong>
          {contextStatus && <small>{contextStatus}</small>}
          <div className="lineage-context-actions"><button type="button" className="outline-button" onClick={onOpenTasks}><GitFork size={14} />任务列表</button><button type="button" className="outline-button" onClick={onCreateTask}><Sparkles size={14} />新建任务</button></div>
        </div>
        <section className="lineage-metrics-strip" aria-label="创作决策统计">
          {metrics.map((item) => <article key={item.key} className={item.className} title={item.title || item.label}><b>{item.value}</b><span>{item.label}</span></article>)}
        </section>
      </div>
    </section>
  </div>;
}
export function CreativeLineageCanvas({ request, project, tasks, selectedTask, rounds, selectedRound, runs, activeRun, runItems, runItemCoverage = null, assets, assetTotal = null, sharedAssets, selectedAssetIds, selectionBusyIds, deliveries, taskTypes = [], styleKits = [], brandKits = [], sessionPlanStatus = null, layoutRevision = 0, onNavigate, onPreviewAsset, onInspectAsset, onToggleAsset, onBatchSelectAssets, onReviewAsset, onBatchReviewAssets, onSetAssetShared, onDownloadAsset, onCopyAsset, onRetryRunItem, onControlRun, onOpenProvider, onCreateTask, onCreateRound, onOpenReference, onOpenDerive, onAddReference, onReject, onCreateDelivery, onOpenConfirmation }) {
  tasks = listValue(tasks);
  rounds = listValue(rounds);
  runs = listValue(runs);
  runItems = listValue(runItems);
  assets = listValue(assets);
  sharedAssets = listValue(sharedAssets);
  deliveries = listValue(deliveries);
  taskTypes = listValue(taskTypes);
  styleKits = listValue(styleKits);
  brandKits = listValue(brandKits);
  selectedAssetIds = idSetValue(selectedAssetIds);
  selectionBusyIds = idSetValue(selectionBusyIds);
  const parsedAssetTotal = assetTotal == null ? assets.length : Number(assetTotal);
  const lineageAssetTotal = Number.isFinite(parsedAssetTotal) ? Math.max(0, parsedAssetTotal) : assets.length;
  const parsedRunItemTotal = runItemCoverage == null ? runItems.length : Number(runItemCoverage.total);
  const parsedRunItemLoaded = runItemCoverage == null ? runItems.length : Number(runItemCoverage.loaded);
  const lineageRunItemTotal = Number.isFinite(parsedRunItemTotal) ? Math.max(runItems.length, parsedRunItemTotal) : runItems.length;
  const lineageRunItemsLoaded = Number.isFinite(parsedRunItemLoaded) ? Math.max(runItems.length, parsedRunItemLoaded) : runItems.length;
  const canvasRef = useRef(null);
  const saveTimerRef = useRef(null);
  const saveRequestRef = useRef(0);
  const wheelHistoryTimerRef = useRef(null);
  const historyRef = useRef({ undo: [], redo: [] });
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const selectionRef = useRef(null);
  const positionsRef = useRef({});
  const viewportRef = useRef(DEFAULT_VIEWPORT);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const graphNodesRef = useRef([]);
  const groupsRef = useRef([]);
  const linksRef = useRef([]);
  const resourcePlacementsRef = useRef([]);
  const savedLayoutNodesRef = useRef([]);
  const layoutReadyRef = useRef(false);
  const assetCoverageRef = useRef({ loaded: 0, total: 0 });
  const mountedRef = useRef(false);
  const saveTargetRef = useRef({ projectId: null, scopeType: null, scopeId: null });
  const [tool, setTool] = useState('select');
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 560 });
  const [positions, setPositions] = useState({});
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutError, setLayoutError] = useState('');
  const [saveState, setSaveState] = useState({ status: 'idle', message: SAVE_STATUS_LABELS.idle });
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const [selectionBox, setSelectionBox] = useState(null);
  const [groups, setGroups] = useState([]);
  const [manualLinks, setManualLinks] = useState([]);
  const [resourcePlacements, setResourcePlacements] = useState([]);
  const [editing, setEditing] = useState(false);
  const [resourcePanelOpen, setResourcePanelOpen] = useState(false);
  const [resourceQuery, setResourceQuery] = useState('');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [groupTitle, setGroupTitle] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [nodeSearchQuery, setNodeSearchQuery] = useState('');
  const [nodeSearchIndex, setNodeSearchIndex] = useState(0);


  const scope = selectedRound ? { type: 'round', id: selectedRound.id } : selectedTask ? { type: 'task', id: selectedTask.id } : { type: 'project', id: project?.id || '' };
  saveTargetRef.current = { projectId: project?.id || null, scopeType: scope.type, scopeId: scope.id };
  const resourceCatalog = useMemo(() => createResourceCatalog(taskTypes, styleKits, brandKits), [taskTypes, styleKits, brandKits]);
  const resourceById = useMemo(() => new Map(resourceCatalog.map((resource) => [resource.id, resource])), [resourceCatalog]);
  const visibleResources = useMemo(() => {
    const placedKeys = new Set(resourcePlacements.map((placement) => nodeKey(placement.entityType, placement.entityId)));
    return filterCreativeLibraryResources(resourceCatalog, { query: resourceQuery, kind: resourceFilter }).filter((resource) => !placedKeys.has(resourceNodeKey(resource)));
  }, [resourceCatalog, resourceFilter, resourcePlacements, resourceQuery]);
  const graph = useMemo(() => buildGraph({ project, tasks, selectedTask, rounds, selectedRound, runs, activeRun, runItems, assets, sharedAssets, selectedAssetIds, sharedAssetIds: new Set(sharedAssets.map((asset) => asset.id)), deliveries, resourcePlacements, resourceCatalog }), [project, tasks, selectedTask, rounds, selectedRound, runs, activeRun, runItems, assets, sharedAssets, selectedAssetIds, deliveries, resourcePlacements, resourceCatalog]);
  const nodes = useMemo(() => applySavedLayout(graph.nodes, positions), [graph.nodes, positions]);
  const nodeByKey = useMemo(() => new Map(nodes.map((node) => [node.key, node])), [nodes]);
  const collapsedGroupIds = useMemo(() => new Set(groups.filter((group) => group.metadata?.collapsed).map((group) => group.id)), [groups]);
  const renderedGroups = useMemo(() => groups.map((group) => {
    const rendered = groupMemberBounds(group, nodes);
    return { ...rendered, key: nodeKey('group', rendered.id), entityType: 'group', entityId: rendered.id };
  }), [groups, nodes]);
  const filteredNodes = useMemo(() => nodes.filter((node) => !collapsedGroupIds.has(node.groupId) && visibleByMode(node, settings.mode || 'map') && visibleByFilter(node, settings.filter, selectedKeys)), [nodes, collapsedGroupIds, selectedKeys, settings.filter, settings.mode]);
  const selectedNodes = useMemo(() => nodes.filter((node) => selectedKeys.has(node.key)), [nodes, selectedKeys]);
  const selectedAssetNodes = selectedNodes.filter((node) => isAssetNode(node) && !node.externalSharedAsset);
  const primaryNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const endpointByKey = useMemo(() => new Map([...nodes.map((node) => [node.key, node]), ...renderedGroups.map((group) => [group.key, group])]), [nodes, renderedGroups]);
  const validManualLinks = useMemo(() => {
    const seen = new Set();
    return manualLinks.filter((link) => {
      const sourceKey = nodeKey(link.sourceType, link.sourceId);
      const targetKey = nodeKey(link.targetType, link.targetId);
      if (!endpointByKey.has(sourceKey) || !endpointByKey.has(targetKey)) return false;
      const linkKey = sourceKey + '->' + targetKey + ':' + (link.linkType || 'custom');
      if (seen.has(linkKey)) return false;
      seen.add(linkKey);
      return true;
    });
  }, [endpointByKey, manualLinks]);
  const primaryLinks = useMemo(() => relatedLinksForNode(validManualLinks, primaryNode), [validManualLinks, primaryNode]);
  const nodeSearchResults = useMemo(() => {
    const query = text(nodeSearchQuery).toLowerCase();
    if (!query) return EMPTY_ARRAY;
    const tokens = query.split(/\s+/).filter(Boolean);
    if (!tokens.length) return EMPTY_ARRAY;
    return nodes.filter((node) => {
      const haystack = node.searchText || nodeSearchHaystack(node);
      return tokens.every((token) => haystack.includes(token));
    }).slice(0, 12);
  }, [nodes, nodeSearchQuery]);
  useEffect(() => { setNodeSearchIndex(0); }, [nodeSearchQuery]);
  useEffect(() => { if (nodeSearchIndex >= nodeSearchResults.length) setNodeSearchIndex(0); }, [nodeSearchIndex, nodeSearchResults.length]);
  const activeNodeSearch = nodeSearchResults[nodeSearchIndex] || nodeSearchResults[0] || null;
  const nodeSearchMatchKeys = useMemo(() => new Set(nodeSearchResults.map((node) => node.key)), [nodeSearchResults]);
  const viewportBounds = useMemo(() => expandedBounds({
    x: -viewport.x / viewport.k,
    y: -viewport.y / viewport.k,
    width: canvasSize.width / viewport.k,
    height: canvasSize.height / viewport.k
  }, 360), [viewport.x, viewport.y, viewport.k, canvasSize.width, canvasSize.height]);
  const renderedNodes = useMemo(() => {
    if (filteredNodes.length <= 240) return filteredNodes;
    return filteredNodes.filter((node) => selectedKeys.has(node.key) || nodeSearchMatchKeys.has(node.key) || intersects(viewportBounds, node));
  }, [filteredNodes, nodeSearchMatchKeys, selectedKeys, viewportBounds]);
  const renderedNodeKeys = useMemo(() => new Set(renderedNodes.map((node) => node.key)), [renderedNodes]);
  const renderedGroupKeys = useMemo(() => new Set(renderedGroups.map((group) => group.key)), [renderedGroups]);
  const visibleConnections = useMemo(() => [...graph.connections, ...validManualLinks.map(manualConnection)].filter((connection) => (renderedNodeKeys.has(connection.from) || renderedGroupKeys.has(connection.from)) && (renderedNodeKeys.has(connection.to) || renderedGroupKeys.has(connection.to))), [graph.connections, renderedGroupKeys, renderedNodeKeys, validManualLinks]);


  const culledCount = Math.max(0, filteredNodes.length - renderedNodes.length);

  const captureSnapshot = useCallback(() => currentLayoutSnapshot({ positions: positionsRef.current, viewport: viewportRef.current, settings: settingsRef.current, groups: groupsRef.current, manualLinks: linksRef.current, resourcePlacements: resourcePlacementsRef.current }), []);
  const syncHistoryCounts = useCallback(() => setHistoryCounts({ undo: historyRef.current.undo.length, redo: historyRef.current.redo.length }), []);
  const resetHistory = useCallback(() => { historyRef.current = { undo: [], redo: [] }; syncHistoryCounts(); }, [syncHistoryCounts]);
  const recordHistory = useCallback(() => {
    const snapshot = captureSnapshot();
    const history = historyRef.current;
    const last = history.undo[history.undo.length - 1];
    if (!last || snapshotKey(last) !== snapshotKey(snapshot)) history.undo = [...history.undo.slice(-(HISTORY_LIMIT - 1)), snapshot];
    history.redo = [];
    syncHistoryCounts();
  }, [captureSnapshot, syncHistoryCounts]);

  useEffect(() => { positionsRef.current = positions; }, [positions]);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { graphNodesRef.current = nodes; }, [nodes]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  useEffect(() => { linksRef.current = manualLinks; }, [manualLinks]);
  useEffect(() => { resourcePlacementsRef.current = resourcePlacements; }, [resourcePlacements]);
  useEffect(() => { layoutReadyRef.current = layoutReady; }, [layoutReady]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { assetCoverageRef.current = { loaded: assets.length, total: Math.max(assets.length, lineageAssetTotal) }; }, [assets.length, lineageAssetTotal]);

  const submitLayoutSave = useCallback((targetProjectId = project?.id, targetScope = scope, permitSave = layoutReadyRef.current, updateState = true) => {
    if (!permitSave || !targetProjectId) return;
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    const canApplyState = () => {
      const target = saveTargetRef.current;
      return updateState && mountedRef.current && saveRequestRef.current === requestId && target.projectId === targetProjectId && target.scopeType === targetScope.type && target.scopeId === targetScope.id;
    };
    if (canApplyState()) setSaveState({ status: 'saving', message: SAVE_STATUS_LABELS.saving });
    const currentPositions = positionsRef.current;
    const currentNodes = graphNodesRef.current;
    const graphNodeKeys = new Set(currentNodes.map((node) => node.key));
    const currentPayloadNodes = currentNodes.map((node) => ({ entityType: node.entityType, entityId: node.entityId, x: currentPositions[node.key]?.x ?? node.x, y: currentPositions[node.key]?.y ?? node.y, width: currentPositions[node.key]?.width ?? node.width, height: currentPositions[node.key]?.height ?? node.height, collapsed: currentPositions[node.key]?.collapsed === true, groupId: currentPositions[node.key]?.groupId || null }));
    const assetCoverage = assetCoverageRef.current;
    const preservedAssetNodes = assetCoverage.total > assetCoverage.loaded ? savedLayoutNodesRef.current.filter((node) => (node.entityType === 'asset' || node.entityType === 'shared_asset') && !graphNodeKeys.has(nodeKey(node.entityType, node.entityId))).map((node) => ({ entityType: node.entityType, entityId: node.entityId, x: node.x, y: node.y, width: node.width, height: node.height, collapsed: node.collapsed === true, groupId: node.groupId || null })) : [];
    const payloadNodes = [...currentPayloadNodes, ...preservedAssetNodes];
    const payloadNodeKeys = new Set(payloadNodes.map((node) => nodeKey(node.entityType, node.entityId)));
    const payloadGroupNodes = payloadNodes.map((node) => ({ key: nodeKey(node.entityType, node.entityId), ...node }));
    const payloadGroups = groupsRef.current.map((group) => serializeGroup(group, payloadGroupNodes));
    const payloadEndpointKeys = new Set([...payloadNodeKeys, ...payloadGroups.map((group) => nodeKey('group', group.id))]);
    const payloadLinks = linksRef.current.filter((link) => payloadEndpointKeys.has(nodeKey(link.sourceType, link.sourceId)) && payloadEndpointKeys.has(nodeKey(link.targetType, link.targetId)));
    void request('/api/projects/' + encodeURIComponent(targetProjectId) + '/canvas-layout', { method: 'POST', idempotencyKey: 'lineage-layout-' + targetScope.type + '-' + targetScope.id + '-' + Date.now(), body: { scopeType: targetScope.type, scopeId: targetScope.id, viewport: viewportRef.current, settings: settingsRef.current, nodes: payloadNodes, groups: payloadGroups, links: payloadLinks } })
      .then(() => { if (canApplyState()) { setLayoutError(''); setSaveState({ status: 'saved', message: SAVE_STATUS_LABELS.saved }); } })
      .catch((error) => { if (canApplyState()) { const message = error.message || '无法保存创作谱系布局。'; setLayoutError(message); setSaveState({ status: 'error', message }); } });
  }, [project?.id, request, scope.type, scope.id]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return undefined;
    const update = () => {
      const next = { width: Math.max(1, element.clientWidth || 1), height: Math.max(1, element.clientHeight || 1) };
      setCanvasSize((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!project?.id) return undefined;
    let cancelled = false;
    setLayoutReady(false);
    setLayoutError('');
    setSaveState({ status: 'loading', message: SAVE_STATUS_LABELS.loading });
    const params = new URLSearchParams({ scopeType: scope.type, scopeId: scope.id });
    request('/api/projects/' + encodeURIComponent(project.id) + '/canvas-layout?' + params.toString())
      .then((data) => {
        if (cancelled) return;
        const layout = data.layout || {};
        const layoutNodes = Array.isArray(layout.nodes) ? layout.nodes : [];
        savedLayoutNodesRef.current = layoutNodes;
        const nextPositions = Object.fromEntries(layoutNodes.map((item) => [nodeKey(item.entityType, item.entityId), { x: item.x, y: item.y, width: item.width, height: item.height, collapsed: item.collapsed, groupId: item.groupId || null }]));
        const nextResources = layoutNodes.filter((item) => isResourceType(item.entityType)).map((item) => ({ entityType: item.entityType, entityId: item.entityId }));
        const nextGroups = Array.isArray(layout.groups) ? layout.groups.map((group) => ({ ...group, metadata: group.metadata || {} })) : [];
        const nextLinks = Array.isArray(layout.links) ? layout.links.map((link) => ({ ...link, label: link.label || relationLabel(link.linkType), metadata: link.metadata || {} })) : [];
        const nextViewport = normalizeViewport(layout.viewport);
        const nextSettings = { ...DEFAULT_SETTINGS, ...(layout.settings || {}) };
        positionsRef.current = nextPositions;
        viewportRef.current = nextViewport;
        settingsRef.current = nextSettings;
        groupsRef.current = nextGroups;
        linksRef.current = nextLinks;
        resourcePlacementsRef.current = nextResources;
        setPositions(nextPositions);
        setViewport(nextViewport);
        setSettings(nextSettings);
        setGroups(nextGroups);
        setManualLinks(nextLinks);
        setResourcePlacements(nextResources);
        resetHistory();
        setSaveState({ status: 'saved', message: SAVE_STATUS_LABELS.saved });
        setLayoutReady(true);
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error.message || '无法读取创作谱系布局。';
        positionsRef.current = {};
        viewportRef.current = DEFAULT_VIEWPORT;
        settingsRef.current = DEFAULT_SETTINGS;
        groupsRef.current = [];
        linksRef.current = [];
        resourcePlacementsRef.current = [];
        savedLayoutNodesRef.current = [];
        setPositions({});
        setViewport(DEFAULT_VIEWPORT);
        setSettings(DEFAULT_SETTINGS);
        setGroups([]);
        setManualLinks([]);
        setResourcePlacements([]);
        resetHistory();
        setLayoutError(message);
        setSaveState({ status: 'error', message });
        setLayoutReady(true);
      });
    return () => {
      cancelled = true;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        submitLayoutSave(project.id, scope, layoutReadyRef.current, false);
      }
      if (wheelHistoryTimerRef.current) window.clearTimeout(wheelHistoryTimerRef.current);
    };
  }, [project?.id, scope.type, scope.id, layoutRevision, request, resetHistory, submitLayoutSave]);

  useEffect(() => {
    setPositions((current) => {
      let changed = false;
      const next = { ...current };
      for (const node of graph.nodes) {
        if (next[node.key]) continue;
        next[node.key] = { x: node.x, y: node.y, width: node.width, height: node.height, collapsed: false, groupId: null };
        changed = true;
      }
      if (changed) positionsRef.current = next;
      return changed ? next : current;
    });
  }, [graph.nodes]);

  const persistLayout = useCallback(() => {
    if (!layoutReady || !project?.id) return;
    setSaveState({ status: 'queued', message: SAVE_STATUS_LABELS.queued });
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      submitLayoutSave(project.id, scope, true);
    }, 650);
  }, [layoutReady, project?.id, scope.type, scope.id, submitLayoutSave]);

  const replaceLayoutState = useCallback((patch, dirty = true, record = true) => {
    if (dirty && record) recordHistory();
    if (hasOwn(patch, 'positions')) { positionsRef.current = patch.positions; setPositions(patch.positions); }
    if (hasOwn(patch, 'viewport')) { const normalized = normalizeViewport(patch.viewport); viewportRef.current = normalized; setViewport(normalized); }
    if (hasOwn(patch, 'settings')) { settingsRef.current = patch.settings; setSettings(patch.settings); }
    if (hasOwn(patch, 'groups')) { groupsRef.current = patch.groups; setGroups(patch.groups); }
    if (hasOwn(patch, 'manualLinks')) { linksRef.current = patch.manualLinks; setManualLinks(patch.manualLinks); }
    if (hasOwn(patch, 'resourcePlacements')) { resourcePlacementsRef.current = patch.resourcePlacements; setResourcePlacements(patch.resourcePlacements); }
    if (dirty) persistLayout();
  }, [persistLayout, recordHistory]);
  const updatePositions = useCallback((updater, dirty = true, record = true) => replaceLayoutState({ positions: typeof updater === 'function' ? updater(positionsRef.current) : updater }, dirty, record), [replaceLayoutState]);
  const updateViewport = useCallback((next, dirty = true, record = true) => replaceLayoutState({ viewport: next }, dirty, record), [replaceLayoutState]);
  const updateSettings = useCallback((patch, record = true) => replaceLayoutState({ settings: { ...settingsRef.current, ...patch } }, true, record), [replaceLayoutState]);
  const updateGroups = useCallback((updater, dirty = true, record = true) => replaceLayoutState({ groups: typeof updater === 'function' ? updater(groupsRef.current) : updater }, dirty, record), [replaceLayoutState]);
  const updateManualLinks = useCallback((updater, dirty = true, record = true) => replaceLayoutState({ manualLinks: typeof updater === 'function' ? updater(linksRef.current) : updater }, dirty, record), [replaceLayoutState]);
  const applyLayoutSnapshot = useCallback((snapshot) => replaceLayoutState(snapshot, true, false), [replaceLayoutState]);
  const undoLayout = useCallback(() => {
    const previous = historyRef.current.undo.pop();
    if (!previous) return;
    historyRef.current.redo = [...historyRef.current.redo.slice(-(HISTORY_LIMIT - 1)), captureSnapshot()];
    syncHistoryCounts();
    applyLayoutSnapshot(previous);
  }, [applyLayoutSnapshot, captureSnapshot, syncHistoryCounts]);
  const redoLayout = useCallback(() => {
    const next = historyRef.current.redo.pop();
    if (!next) return;
    historyRef.current.undo = [...historyRef.current.undo.slice(-(HISTORY_LIMIT - 1)), captureSnapshot()];
    syncHistoryCounts();
    applyLayoutSnapshot(next);
  }, [applyLayoutSnapshot, captureSnapshot, syncHistoryCounts]);

  const snapCoordinate = useCallback((value) => settingsRef.current.snapGrid === false ? value : Math.round(value / SNAP_SIZE) * SNAP_SIZE, []);
  const snapPoint = useCallback((point) => ({ x: snapCoordinate(point.x), y: snapCoordinate(point.y) }), [snapCoordinate]);
  const screenToWorld = useCallback((clientX, clientY) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - viewportRef.current.x) / viewportRef.current.k, y: (clientY - rect.top - viewportRef.current.y) / viewportRef.current.k };
  }, []);
  const viewportForItems = useCallback((items) => {
    const bounds = boundsForItems(items);
    if (!bounds || !canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const padding = 72;
    const usableWidth = Math.max(120, rect.width - padding * 2);
    const usableHeight = Math.max(120, rect.height - padding * 2);
    const scale = clampScale(Math.min(usableWidth / Math.max(1, bounds.width), usableHeight / Math.max(1, bounds.height)));
    return { x: padding - bounds.x * scale, y: padding - bounds.y * scale, k: scale };
  }, []);
  const fitItems = useCallback((items, dirty = true, record = true) => {
    const nextViewport = viewportForItems(items);
    if (nextViewport) updateViewport(nextViewport, dirty, record);
  }, [updateViewport, viewportForItems]);
  const fitAll = useCallback(() => fitItems([...filteredNodes, ...renderedGroups]), [fitItems, filteredNodes, renderedGroups]);
  const fitSelection = useCallback(() => fitItems(selectedNodes.length ? selectedNodes : filteredNodes), [fitItems, selectedNodes, filteredNodes]);
  const resetView = useCallback(() => updateViewport(DEFAULT_VIEWPORT), [updateViewport]);
  const focusNode = useCallback((node, record = true) => {
    if (!node) return;
    setSelectedKeys(new Set([node.key]));
    canvasRef.current?.focus({ preventScroll: true });
    fitItems([node], true, record);
  }, [fitItems]);
  const focusCurrentContext = useCallback(() => {
    const context = sessionPlanStatus?.context;
    const key = selectedRound ? nodeKey('round', selectedRound.id) : context?.round?.id ? nodeKey('round', context.round.id) : selectedTask ? nodeKey('task', selectedTask.id) : context?.task?.id ? nodeKey('task', context.task.id) : project ? nodeKey('project', project.id) : null;
    focusNode(key ? nodeByKey.get(key) : null);
  }, [focusNode, nodeByKey, project, selectedRound, selectedTask, sessionPlanStatus?.context]);


  const selectNode = useCallback((event, node) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        if (next.has(node.key)) next.delete(node.key); else next.add(node.key);
      } else if (!next.has(node.key)) {
        next.clear();
        next.add(node.key);
      }
      return next;
    });
  }, []);
  const createManualLink = useCallback((linkType, sourceNode, targetNodes, direction = 'forward') => {
    const targets = Array.isArray(targetNodes) ? targetNodes : [targetNodes];
    if (!sourceNode || !targets.length) return;
    updateManualLinks((current) => {
      const next = [...current];
      for (const rawTarget of targets) {
        const targetNode = direction === 'reverse' ? sourceNode : rawTarget;
        const actualSource = direction === 'reverse' ? rawTarget : sourceNode;
        if (!actualSource || !targetNode || actualSource.key === targetNode.key) continue;
        const source = endpointFromNode(actualSource);
        const target = endpointFromNode(targetNode);
        if (next.some((link) => link.sourceType === source.type && link.sourceId === source.id && link.targetType === target.type && link.targetId === target.id && link.linkType === linkType)) continue;
        next.push({ id: clientId('link'), sourceType: source.type, sourceId: source.id, targetType: target.type, targetId: target.id, linkType, label: relationLabel(linkType), metadata: { manual: true } });
      }
      return next;
    });
  }, [updateManualLinks]);
  const removeManualLink = useCallback((linkId) => updateManualLinks((current) => current.filter((link) => link.id !== linkId)), [updateManualLinks]);
  const updateManualLink = useCallback((linkId, patch) => updateManualLinks((current) => current.map((link) => link.id === linkId ? { ...link, ...patch, label: text(patch.label) || relationLabel(patch.linkType || link.linkType) } : link)), [updateManualLinks]);
  const reverseManualLink = useCallback((linkId) => updateManualLinks((current) => current.map((link) => link.id === linkId ? { ...link, sourceType: link.targetType, sourceId: link.targetId, targetType: link.sourceType, targetId: link.sourceId } : link)), [updateManualLinks]);
  const handleNodeSearchKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setNodeSearchQuery('');
      return;
    }
    if (!nodeSearchResults.length) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      focusNode(nodeSearchResults[nodeSearchIndex] || nodeSearchResults[0]);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (nodeSearchIndex + delta + nodeSearchResults.length) % nodeSearchResults.length;
      setNodeSearchIndex(nextIndex);
      focusNode(nodeSearchResults[nextIndex]);
    }
  }, [focusNode, nodeSearchIndex, nodeSearchResults]);


  const handleNodePointerDown = useCallback((event, node) => {
    if (tool !== 'select') return;
    event.preventDefault();
    event.stopPropagation();
    canvasRef.current?.focus({ preventScroll: true });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Some browsers reject capture for interrupted pointer streams. */ }
    selectNode(event, node);
    if (!editing) return;
    const selected = selectedKeys.has(node.key) ? selectedNodes : [node];
    recordHistory();
    dragRef.current = { startX: event.clientX, startY: event.clientY, moved: false, nodes: selected.map((item) => ({ key: item.key, x: item.x, y: item.y })) };
  }, [editing, recordHistory, selectNode, selectedKeys, selectedNodes, tool]);

  useEffect(() => {
    const move = (event) => {
      if (dragRef.current) {
        const dx = (event.clientX - dragRef.current.startX) / viewportRef.current.k;
        const dy = (event.clientY - dragRef.current.startY) / viewportRef.current.k;
        dragRef.current.moved = dragRef.current.moved || Math.abs(dx) + Math.abs(dy) > 2;
        updatePositions((current) => {
          const next = { ...current };
          for (const item of dragRef.current.nodes) next[item.key] = { ...(next[item.key] || {}), x: snapCoordinate(item.x + dx), y: snapCoordinate(item.y + dy) };
          return next;
        }, false, false);
        return;
      }
      if (panRef.current) {
        updateViewport({ x: panRef.current.x + event.clientX - panRef.current.startX, y: panRef.current.y + event.clientY - panRef.current.startY, k: panRef.current.k }, false, false);
        return;
      }
      if (selectionRef.current) {
        const world = screenToWorld(event.clientX, event.clientY);
        const box = { ...selectionRef.current, currentX: world.x, currentY: world.y };
        selectionRef.current = box;
        setSelectionBox(box);
      }
    };
    const up = () => {
      if (dragRef.current) { if (dragRef.current.moved) persistLayout(); dragRef.current = null; }
      if (panRef.current) { persistLayout(); panRef.current = null; }
      if (selectionRef.current) {
        const box = selectionRef.current;
        const rect = { x: Math.min(box.startX, box.currentX), y: Math.min(box.startY, box.currentY), width: Math.abs(box.currentX - box.startX), height: Math.abs(box.currentY - box.startY) };
        const hits = filteredNodes.filter((node) => intersects(rect, node)).map((node) => node.key);
        setSelectedKeys(new Set(box.additive ? [...selectedKeys, ...hits] : hits));
        selectionRef.current = null;
        setSelectionBox(null);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [filteredNodes, persistLayout, screenToWorld, selectedKeys, snapCoordinate, updatePositions, updateViewport]);

  const handleCanvasPointerDown = (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.currentTarget.focus({ preventScroll: true });
    setContextMenu(null);
    const temporaryPan = event.button === 1 || event.ctrlKey || event.metaKey;
    if (tool === 'pan' || temporaryPan) {
      event.preventDefault();
      recordHistory();
      panRef.current = { startX: event.clientX, startY: event.clientY, x: viewport.x, y: viewport.y, k: viewport.k };
      return;
    }
    if (!editing) {
      if (!event.shiftKey) setSelectedKeys(new Set());
      return;
    }
    const world = screenToWorld(event.clientX, event.clientY);
    selectionRef.current = { startX: world.x, startY: world.y, currentX: world.x, currentY: world.y, additive: event.shiftKey };
    setSelectionBox(selectionRef.current);
    if (!event.shiftKey) setSelectedKeys(new Set());
  };
  const handleCanvasWheel = useCallback((event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-lineage-no-zoom]')) return;
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const currentViewport = viewportRef.current;
    if (!wheelHistoryTimerRef.current) recordHistory();
    else window.clearTimeout(wheelHistoryTimerRef.current);
    wheelHistoryTimerRef.current = window.setTimeout(() => { wheelHistoryTimerRef.current = null; persistLayout(); }, 280);
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - currentViewport.x) / currentViewport.k;
    const worldY = (mouseY - currentViewport.y) / currentViewport.k;
    const newScale = clampScale(currentViewport.k * Math.pow(1.1, -event.deltaY / 100));
    updateViewport({ x: mouseX - worldX * newScale, y: mouseY - worldY * newScale, k: newScale }, false, false);
  }, [persistLayout, recordHistory, updateViewport]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return undefined;
    element.addEventListener('wheel', handleCanvasWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleCanvasWheel);
  }, [handleCanvasWheel]);
  const autoArrange = useCallback(() => {
    const current = positionsRef.current;
    const next = {};
    graph.nodes.forEach((node) => { next[node.key] = { x: node.x, y: node.y, width: node.width, height: node.height, collapsed: false, groupId: current[node.key]?.groupId || null }; });
    const nextViewport = viewportForItems(positionedItems(graph.nodes, next));
    replaceLayoutState({ positions: next, ...(nextViewport ? { viewport: nextViewport } : {}) });
  }, [graph.nodes, replaceLayoutState, viewportForItems]);
  const applyLayoutTemplate = useCallback((template) => {
    const laneX = template === 'resource' ? { task_type: 0, style_kit: 0, brand_kit: 0, project: 310, task: 310, round: 590, plan: 860, run: 1160, run_item: 1450, asset: 1730, shared_asset: 1730, delivery: 2030 } : template === 'selection' ? { project: 0, task: 0, round: 280, plan: 560, run: 840, run_item: 1120, asset: 1400, shared_asset: 1400, delivery: 1700, task_type: 280, style_kit: 280, brand_kit: 280 } : template === 'feedback' ? { delivery: 0, asset: 300, shared_asset: 300, run_item: 610, run: 880, plan: 1160, round: 1430, task: 1700, project: 1700, task_type: 1160, style_kit: 1160, brand_kit: 1160 } : { project: 0, task: 0, round: 310, plan: 590, run: 900, run_item: 1200, asset: 1490, shared_asset: 1490, delivery: 2120, task_type: 250, style_kit: 500, brand_kit: 750 };
    const counters = {};
    const next = {};
    const current = positionsRef.current;
    for (const node of graph.nodes) {
      const column = laneX[node.entityType] ?? 0;
      const bucket = template === 'selection' && isAssetNode(node) ? (node.deliveredAsset ? 'asset-delivered' : node.selectedAsset ? 'asset-selected' : node.entity?.review?.decision === 'reject' ? 'asset-reject' : 'asset-review') : node.entityType;
      const index = counters[bucket] || 0;
      counters[bucket] = index + 1;
      const rowBase = template === 'selection' && bucket === 'asset-selected' ? 40 : template === 'selection' && bucket === 'asset-reject' ? 330 : template === 'selection' && bucket === 'asset-delivered' ? 620 : 60;
      next[node.key] = { x: column + (index % 2) * (isAssetNode(node) ? 198 : 34), y: rowBase + Math.floor(index / (isAssetNode(node) ? 2 : 1)) * (isAssetNode(node) ? 250 : 148), width: node.width, height: node.height, collapsed: current[node.key]?.collapsed === true, groupId: current[node.key]?.groupId || null };
    }
    const nextViewport = viewportForItems(positionedItems(graph.nodes, next));
    replaceLayoutState({ positions: next, ...(nextViewport ? { viewport: nextViewport } : {}) });
  }, [graph.nodes, replaceLayoutState, viewportForItems]);
  const nudgeSelected = useCallback((dx, dy) => updatePositions((current) => {
    const next = { ...current };
    selectedKeys.forEach((key) => { const node = nodeByKey.get(key); if (node) next[key] = { ...(next[key] || {}), x: snapCoordinate(node.x + dx), y: snapCoordinate(node.y + dy) }; });
    return next;
  }), [nodeByKey, selectedKeys, snapCoordinate, updatePositions]);

  const createGroup = useCallback(() => {
    if (selectedNodes.length < 2) return;
    const bounds = boundsForItems(selectedNodes);
    if (!bounds) return;
    const id = clientId('group');
    const title = groupTitle.trim() || '创作分组 ' + (groupsRef.current.length + 1);
    const group = { id, title, groupType: 'custom', x: bounds.x - 24, y: bounds.y - 54, width: bounds.width + 48, height: bounds.height + 78, metadata: { collapsed: false } };
    const nextPositions = { ...positionsRef.current };
    for (const node of selectedNodes) nextPositions[node.key] = { ...(nextPositions[node.key] || {}), x: node.x, y: node.y, width: node.width, height: node.height, groupId: id };
    setGroupTitle('');
    replaceLayoutState({ groups: [...groupsRef.current, group], positions: nextPositions });
  }, [groupTitle, replaceLayoutState, selectedNodes]);
  const toggleGroupCollapsed = useCallback((groupId) => updateGroups((current) => current.map((group) => group.id === groupId ? { ...group, metadata: { ...(group.metadata || {}), collapsed: !group.metadata?.collapsed } } : group)), [updateGroups]);
  const ungroup = useCallback((groupId) => {
    const nextPositions = Object.fromEntries(Object.entries(positionsRef.current).map(([key, value]) => [key, value?.groupId === groupId ? { ...value, groupId: null } : value]));
    replaceLayoutState({ groups: groupsRef.current.filter((group) => group.id !== groupId), positions: nextPositions });
  }, [replaceLayoutState]);
  const removeResourceNode = useCallback((node) => {
    if (!node || !isResourceType(node.entityType)) return;
    const nextPlacements = resourcePlacementsRef.current.filter((item) => !(item.entityType === node.entityType && item.entityId === node.entityId));
    const nextPositions = { ...positionsRef.current };
    delete nextPositions[node.key];
    const nextLinks = linksRef.current.filter((link) => !(link.sourceType === node.entityType && link.sourceId === node.entityId) && !(link.targetType === node.entityType && link.targetId === node.entityId));
    replaceLayoutState({ resourcePlacements: nextPlacements, positions: nextPositions, manualLinks: nextLinks });
    setSelectedKeys((current) => { const next = new Set(current); next.delete(node.key); return next; });
  }, [replaceLayoutState]);

  const addResourceNode = useCallback((resource, position = null) => {
    if (!resource) return;
    const entityType = resource.entityType;
    const entityId = resource.resourceId;
    const key = nodeKey(entityType, entityId);
    const rect = canvasRef.current?.getBoundingClientRect();
    const fallback = rect ? screenToWorld(rect.left + Math.min(rect.width - 180, 360), rect.top + 160 + resourcePlacementsRef.current.length * 24) : { x: 280, y: 460 };
    const world = snapPoint(position || fallback);
    const [width, height] = NODE_SIZE[entityType] || [230, 116];
    const placement = { entityType, entityId };
    const nextPlacements = resourcePlacementsRef.current.some((item) => item.entityType === entityType && item.entityId === entityId) ? resourcePlacementsRef.current : [...resourcePlacementsRef.current, placement];
    const nextPositions = { ...positionsRef.current, [key]: { ...(positionsRef.current[key] || {}), x: world.x, y: world.y, width, height, groupId: positionsRef.current[key]?.groupId || null } };
    let nextLinks = linksRef.current;
    const targetNode = primaryNode || (selectedRound ? { entityType: 'plan', entityId: selectedRound.id } : selectedTask ? { entityType: 'task', entityId: selectedTask.id } : project ? { entityType: 'project', entityId: project.id } : null);
    if (targetNode) {
      const targetType = targetNode.entityType;
      const targetId = targetNode.entityId;
      if (!(targetType === entityType && targetId === entityId) && !nextLinks.some((link) => link.sourceType === entityType && link.sourceId === entityId && link.targetType === targetType && link.targetId === targetId && link.linkType === 'context')) {
        nextLinks = [...nextLinks, { id: clientId('link'), sourceType: entityType, sourceId: entityId, targetType, targetId, linkType: 'context', label: '计划上下文', metadata: { manual: true } }];
      }
    }
    replaceLayoutState({ resourcePlacements: nextPlacements, positions: nextPositions, manualLinks: nextLinks });
    setSelectedKeys(new Set([key]));
  }, [primaryNode, project, replaceLayoutState, screenToWorld, selectedRound, selectedTask, snapPoint]);
  const handleResourceDrop = (event) => {
    const resourceId = event.dataTransfer?.getData('application/x-daoge-resource');
    if (!resourceId) return;
    const resource = resourceById.get(resourceId);
    if (!resource) return;
    event.preventDefault();
    event.stopPropagation();
    addResourceNode(resource, screenToWorld(event.clientX, event.clientY));
  };
  const handleNodeDragStart = useCallback((event, node) => {
    if (!isAssetNode(node) && !node.resourceNode) return;
    event.dataTransfer.setData('application/x-daoge-lineage-node', JSON.stringify({ key: node.key }));
    event.dataTransfer.effectAllowed = 'link';
  }, []);
  const handleNodeDrop = useCallback((event, targetNode) => {
    const raw = event.dataTransfer?.getData('application/x-daoge-lineage-node');
    if (!raw || !REFERENCE_TARGET_TYPES.includes(targetNode.entityType)) return;
    event.preventDefault();
    event.stopPropagation();
    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    const sourceNode = nodeByKey.get(payload.key);
    if (!sourceNode || sourceNode.key === targetNode.key) return;
    createManualLink(isAssetNode(sourceNode) ? 'reference' : 'context', sourceNode, targetNode);
    setSelectedKeys(new Set([sourceNode.key, targetNode.key]));
  }, [createManualLink, nodeByKey]);
  const handleNodeDragOver = useCallback((event, targetNode) => {
    if (!REFERENCE_TARGET_TYPES.includes(targetNode.entityType)) return;
    if (dataTransferHasType(event.dataTransfer, 'application/x-daoge-lineage-node')) event.preventDefault();
  }, []);

  const writeClipboard = useCallback((message) => {
    if (!canWriteTextClipboard()) { setLayoutError('当前浏览器未提供剪贴板权限，请在会话中手动引用该节点。'); return; }
    void navigator.clipboard.writeText(message).then(() => setSaveState({ status: 'saved', message: '上下文已复制' })).catch(() => setLayoutError('无法复制计划上下文，请在会话中手动引用该节点。'));
  }, []);
  const copyContextForNodes = useCallback((mode = 'plan', sourceNodes = selectedNodes) => {
    const intro = mode === 'variation' ? '请基于这些谱系节点起草一个“变体”轮次计划；不要预检、不要创建运行、不要调用 Provider，先给我审阅确认。' : mode === 'refinement' ? '请基于这些谱系节点起草一个“优化”轮次计划；不要预检、不要创建运行、不要调用 Provider，先给我审阅确认。' : mode === 'reference' ? '请把这些资产/资料作为下一轮参考上下文起草计划；不要预检、不要创建运行、不要调用 Provider，先给我审阅确认。' : '请基于 Workbench 创作谱系中的节点生成计划草稿；不要预检、不要创建运行、不要调用 Provider，先给我审阅确认。';
    const message = [intro, '项目：' + (project?.name || '未选择'), selectedTask ? '任务：' + selectedTask.name : '', selectedRound ? '轮次：' + (PURPOSE_LABELS[selectedRound.purpose] || selectedRound.purpose) + ' · v' + selectedRound.planVersion : '', ...sourceNodes.map(selectedNodeContextLine)].filter(Boolean).join('\n');
    writeClipboard(message);
  }, [project?.name, selectedNodes, selectedRound, selectedTask, writeClipboard]);
  const exportLineageSummary = useCallback(() => {
    try {
      const exportLinks = [...graph.connections.map(lineageExportLink).filter(Boolean), ...validManualLinks];
      const payload = createLineageExport({ project, scope, nodes, groups: renderedGroups, links: exportLinks });
      const content = JSON.stringify(payload, null, 2);
      if (canWriteTextClipboard()) void navigator.clipboard.writeText(content).catch(() => undefined);
      const blob = new Blob([content + '\n'], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = lineageExportFilename(project?.name || 'daoge-lineage');
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSaveState({ status: 'saved', message: '已导出脱敏谱系摘要' });
    } catch (error) {
      setLayoutError(error?.message || '无法导出脱敏谱系摘要。');
    }
  }, [graph.connections, nodes, project, renderedGroups, scope, validManualLinks]);

  const openContextMenu = useCallback((event, node = null) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    if (node && !selectedKeys.has(node.key)) setSelectedKeys(new Set([node.key]));
    const rect = event.currentTarget?.getBoundingClientRect?.();
    const fallbackX = rect ? rect.left + Math.min(rect.width, 220) / 2 : typeof window === 'undefined' ? 12 : window.innerWidth / 2;
    const fallbackY = rect ? rect.top + Math.min(rect.height, 120) / 2 : typeof window === 'undefined' ? 12 : window.innerHeight / 2;
    const x = Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : fallbackX;
    const y = Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : fallbackY;
    setContextMenu({ ...safeMenuPoint(x, y), nodeKey: node?.key || null });
  }, [selectedKeys]);
  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);
  const handleKeyDown = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input,textarea,select,[contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    const mod = event.metaKey || event.ctrlKey;
    if (mod && key === 'a') { event.preventDefault(); setSelectedKeys(new Set(filteredNodes.map((node) => node.key))); return; }
    if (mod && key === 'z' && event.shiftKey) { event.preventDefault(); redoLayout(); return; }
    if (mod && key === 'z') { event.preventDefault(); undoLayout(); return; }
    if (mod && key === 'y') { event.preventDefault(); redoLayout(); return; }
    if (key === 'escape') { setSelectedKeys(new Set()); setSelectionBox(null); setContextMenu(null); setShortcutsOpen(false); setNodeSearchQuery(''); return; }
    if (editing && (key === '?' || (event.shiftKey && key === '/'))) { event.preventDefault(); setShortcutsOpen((value) => !value); return; }
    if (key === 'f') { event.preventDefault(); fitSelection(); return; }
    if (editing && key === 'g' && selectedNodes.length > 1) { event.preventDefault(); createGroup(); return; }
    if (editing && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && selectedKeys.size) {
      event.preventDefault();
      const step = settings.snapGrid ? SNAP_SIZE : event.shiftKey ? 24 : 8;
      nudgeSelected(key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0);
    }
  };

  const selectedAssetIdsForBatch = selectedAssetNodes.map((node) => node.entity.id).filter(Boolean);
  const batchBusy = selectedAssetIdsForBatch.some((id) => selectionBusyIds.has(id));
  const contextNode = contextMenu?.nodeKey ? nodeByKey.get(contextMenu.nodeKey) : null;
  const assetCountLabel = graph.metrics.assets === lineageAssetTotal ? graph.metrics.assets + ' 张资产' : '已加载 ' + graph.metrics.assets + ' / ' + lineageAssetTotal + ' 张资产';
  const runItemCountLabel = lineageRunItemsLoaded === lineageRunItemTotal ? lineageRunItemTotal + ' 个运行项' : '已加载 ' + lineageRunItemsLoaded + ' / ' + lineageRunItemTotal + ' 个运行项';
  const searchListId = 'lineage-search-results';
  const activeSearchOptionId = activeNodeSearch ? 'lineage-search-option-' + nodeSearchIndex : undefined;

  const toolbarMode = CREATOR_MODES.find(([value]) => value === (settings.mode || 'map')) || CREATOR_MODES[0];
  return <section className={'lineage-stage ' + (editing ? 'is-editing' : 'is-browsing')} aria-label="创作谱系">
    <header className="lineage-toolbar" data-lineage-no-zoom>
      <div className="lineage-toolbar-title">
        <h2>{editing ? '布局编辑' : toolbarMode[1]}</h2>
        <span>{editing ? '只调整画布呈现，不改项目事实。' : toolbarMode[2]}</span>
      </div>
      <div className="lineage-actions">
        <button type="button" onClick={fitAll}><Search size={15} />适应全部</button>
        {selectedKeys.size > 0 && <button type="button" onClick={fitSelection}><ZoomIn size={15} />适应选择</button>}
        <button type="button" className={editing ? 'is-active' : ''} onClick={() => setEditing((value) => !value)}><Move size={15} />{editing ? '退出编辑' : '编辑模式'}</button>
        {editing && <>
          <button type="button" className={tool === 'select' ? 'is-active' : ''} onClick={() => setTool('select')}><BoxSelect size={15} />选择</button>
          <button type="button" className={tool === 'pan' ? 'is-active' : ''} onClick={() => setTool('pan')}><Move size={15} />拖动画布</button>
          <button type="button" onClick={autoArrange}><Columns3 size={15} />自动整理</button>
          <button type="button" onClick={() => setResourcePanelOpen((value) => !value)}><BookOpen size={15} />{resourcePanelOpen ? '隐藏资料' : '显示资料'}</button>
          <details className="lineage-edit-more">
            <summary><Grid2X2 size={15} />编辑设置</summary>
            <div className="lineage-edit-menu">
              <button type="button" onClick={resetView}><ZoomOut size={15} />重置视图</button>
              <button type="button" onClick={undoLayout} disabled={!historyCounts.undo}><Undo2 size={15} />撤销</button>
              <button type="button" onClick={redoLayout} disabled={!historyCounts.redo}><Redo2 size={15} />重做</button>
              <label><span>布局模板</span><select className="lineage-template-select" value="" onChange={(event) => { if (event.target.value) applyLayoutTemplate(event.target.value); event.target.value = ''; }} aria-label="套用布局模板"><option value="">选择模板</option>{TEMPLATE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <button type="button" onClick={() => updateSettings({ snapGrid: !settings.snapGrid })}><Grid2X2 size={15} />{settings.snapGrid ? '吸附开启' : '吸附关闭'}</button>
              <button type="button" onClick={() => updateSettings({ minimap: !settings.minimap })}><MapIcon size={15} />{settings.minimap ? '隐藏小地图' : '显示小地图'}</button>
              <button type="button" onClick={() => setShortcutsOpen((value) => !value)}><BookOpen size={15} />快捷键</button>
            </div>
          </details>
        </>}
        <button type="button" onClick={exportLineageSummary}><Download size={15} />导出摘要</button>
      </div>
    </header>
    <LineageWorkspaceSummary project={project} selectedTask={selectedTask} selectedRound={selectedRound} runs={runs} sessionPlanStatus={sessionPlanStatus} graph={graph} mode={settings.mode || 'map'} onMode={(mode) => updateSettings({ mode }, false)} onOpenTasks={() => onNavigate({ view: 'tasks', projectId: project?.id || null, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' })} onCreateTask={onCreateTask} />

    <div className="lineage-filterbar" data-lineage-no-zoom>
      <div>{FILTERS.map(([value, label]) => <button type="button" key={value} className={settings.filter === value ? 'is-active' : ''} onClick={() => updateSettings({ filter: value })}>{label}</button>)}</div>
      {editing && <div>{BACKGROUNDS.map(([value, label]) => <button type="button" key={value} className={settings.background === value ? 'is-active' : ''} onClick={() => updateSettings({ background: value })}>{label}</button>)}</div>}
      <span className={'lineage-save-state is-' + saveState.status}><Save size={13} />{saveState.message}</span>
      <span>{assetCountLabel} · {runItemCountLabel} · {graph.metrics.selected} 张已选 · {graph.metrics.issues} 个异常 · {groups.length} 个分组 · {validManualLinks.length} 条标注{culledCount ? ' · 已裁剪 ' + culledCount + ' 个离屏节点' : ''}{batchBusy ? ' · 批量选片同步中' : ''}</span>
    </div>

    <div className="lineage-searchbar" data-lineage-no-zoom>
      <label className="lineage-search-input">
        <Search size={14} />
        <input value={nodeSearchQuery} onChange={(event) => { setNodeSearchQuery(event.target.value); setNodeSearchIndex(0); }} onKeyDown={handleNodeSearchKeyDown} placeholder="搜索节点名称、类型、ID、状态" aria-label="搜索谱系节点" role="combobox" aria-autocomplete="list" aria-expanded={Boolean(nodeSearchQuery && nodeSearchResults.length)} aria-controls={searchListId} aria-activedescendant={activeSearchOptionId} />
      </label>
      <span>{nodeSearchQuery ? (nodeSearchResults.length ? nodeSearchResults.length + ' 个结果' : '无匹配节点') : '输入关键词快速定位节点'}</span>
      {nodeSearchQuery && nodeSearchResults.length ? <div className="lineage-search-results" id={searchListId} role="listbox" aria-label="谱系节点搜索结果">{nodeSearchResults.map((node, index) => <button type="button" role="option" aria-selected={index === nodeSearchIndex} id={'lineage-search-option-' + index} key={node.key} className={index === nodeSearchIndex ? 'is-active' : ''} onClick={() => { setNodeSearchIndex(index); focusNode(node); }}><strong>{node.title}</strong><small>{nodeTypeLabel(node.entityType)} · {shortId(node.entityId)}</small></button>)}</div> : null}
    </div>

    {layoutError && <div className="lineage-error" role="alert"><AlertTriangle size={15} />{layoutError}</div>}
    <div className={'lineage-shell' + (editing && resourcePanelOpen ? ' has-resources' : '')}>
      {editing && resourcePanelOpen && <ResourcePanel resources={visibleResources} query={resourceQuery} filter={resourceFilter} onQuery={setResourceQuery} onFilter={setResourceFilter} onAdd={addResourceNode} />}
      <div ref={canvasRef} tabIndex={0} className={'lineage-canvas bg-' + settings.background} onPointerDown={handleCanvasPointerDown} onKeyDown={handleKeyDown} onContextMenu={(event) => openContextMenu(event)} onDragOver={(event) => { if (dataTransferHasType(event.dataTransfer, 'application/x-daoge-resource')) event.preventDefault(); }} onDrop={handleResourceDrop} aria-label="创作谱系画布，可拖入资料节点，可用方向键微调选中节点">
        {!layoutReady && <div className="lineage-loading"><LoaderCircle size={18} className="spin" />读取谱系布局</div>}
        <svg className="lineage-edges" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` }}>
          <defs><marker id="lineage-arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" /></marker></defs>
          {visibleConnections.map((connection) => {
            const from = endpointByKey.get(connection.from);
            const to = endpointByKey.get(connection.to);
            if (!from || !to) return null;
            const label = connectionLabelPoint(from, to);
            return <g key={connection.id}><path className={connection.manual ? 'lineage-edge edge-manual edge-soft-' + connection.linkType : 'lineage-edge edge-' + connection.type} d={connectionPath(from, to)} markerEnd="url(#lineage-arrow)"><title>{connection.label}</title></path>{settings.edgeLabels && connection.manual && <text className={'lineage-edge-label edge-soft-' + connection.linkType} x={label.x} y={label.y}>{connection.label}</text>}</g>;
          })}
        </svg>
        <div className="lineage-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` }}>
          {renderedGroups.map((group) => <LineageGroup key={group.id} group={group} memberCount={nodes.filter((node) => node.groupId === group.id).length} onToggle={toggleGroupCollapsed} onUngroup={ungroup} />)}
          {renderedNodes.map((node) => <LineageNode key={node.key} node={node} active={selectedKeys.has(node.key)} searchHit={nodeSearchMatchKeys.has(node.key)} searchActive={activeNodeSearch?.key === node.key} onPointerDown={handleNodePointerDown} onSelect={selectNode} onOpen={() => openNode(node, { onNavigate, onInspectAsset })} onContextMenu={openContextMenu} onDragStart={handleNodeDragStart} onDragOver={handleNodeDragOver} onDrop={handleNodeDrop} />)}
          {selectionBox && <div className="lineage-selection-box" style={{ left: Math.min(selectionBox.startX, selectionBox.currentX), top: Math.min(selectionBox.startY, selectionBox.currentY), width: Math.abs(selectionBox.currentX - selectionBox.startX), height: Math.abs(selectionBox.currentY - selectionBox.startY) }} />}
        </div>
        {editing && settings.minimap && <LineageMinimap nodes={filteredNodes} groups={renderedGroups} viewport={viewport} canvasSize={canvasSize} searchMatchKeys={nodeSearchMatchKeys} onViewportChange={updateViewport} />}
        {contextMenu && <LineageContextMenu editing={editing} menu={contextMenu} node={contextNode} selectedCount={selectedNodes.length} canOpen={Boolean(contextNode && !isResourceType(contextNode.entityType))} canGroup={editing && selectedNodes.length > 1} canRemoveResource={editing && contextNode && isResourceType(contextNode.entityType)} onClose={() => setContextMenu(null)} onOpen={() => contextNode && openNode(contextNode, { onNavigate, onInspectAsset })} onFit={fitSelection} onGroup={createGroup} onCopy={() => copyContextForNodes('reference', contextNode ? [contextNode] : selectedNodes)} onRemoveResource={() => contextNode && removeResourceNode(contextNode)} onExport={exportLineageSummary} onShortcuts={() => setShortcutsOpen(true)} />}
        {editing && shortcutsOpen && <ShortcutPanel onClose={() => setShortcutsOpen(false)} />}
      </div>
      <LineageInspector tasks={tasks} editing={editing} node={primaryNode} selectedNodes={selectedNodes} selectedAssetNodes={selectedAssetNodes} selectedTask={selectedTask} selectedRound={selectedRound} batchBusy={batchBusy} groupTitle={groupTitle} nodeLinks={primaryLinks} onGroupTitleChange={setGroupTitle} onCreateGroup={createGroup} onCreateLink={createManualLink} onRemoveLink={removeManualLink} onUpdateLink={updateManualLink} onReverseLink={reverseManualLink} onClear={() => setSelectedKeys(new Set())} onNavigate={onNavigate} onPreviewAsset={onPreviewAsset} onInspectAsset={onInspectAsset} onToggleAsset={onToggleAsset} onReviewAsset={onReviewAsset} onBatchSelectAssets={onBatchSelectAssets} onBatchReviewAssets={onBatchReviewAssets} onSetAssetShared={onSetAssetShared} onDownloadAsset={onDownloadAsset} onCopyAsset={onCopyAsset} onRetryRunItem={onRetryRunItem} onControlRun={onControlRun} onOpenProvider={onOpenProvider} onCopyContext={copyContextForNodes} onCreateTask={onCreateTask} onCreateRound={onCreateRound} onOpenReference={onOpenReference} onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onCreateDelivery={onCreateDelivery} onOpenConfirmation={onOpenConfirmation} />
    </div>
  </section>;
}

function LineageContextMenu({ editing, menu, node, selectedCount, canOpen, canGroup, canRemoveResource, onClose, onOpen, onFit, onGroup, onCopy, onRemoveResource, onExport, onShortcuts }) {
  const menuRef = useRef(null);
  useEffect(() => {
    const restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = menuRef.current?.querySelector('[role="menuitem"]');
    first?.focus({ preventScroll: true });
    return () => restoreTarget?.focus?.({ preventScroll: true });
  }, []);
  const handleKeyDown = (event) => {
    const items = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || []);
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (!items.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + delta + items.length) % items.length].focus();
      return;
    }
    if (event.key === 'Home') { event.preventDefault(); items[0].focus(); return; }
    if (event.key === 'End') { event.preventDefault(); items[items.length - 1].focus(); }
  };
  return <div ref={menuRef} className="lineage-context-menu" style={{ left: menu.x, top: menu.y }} data-lineage-no-zoom role="menu" aria-label="谱系节点操作" onClick={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
    <strong>{node ? node.title : selectedCount ? selectedCount + ' 个节点' : '画布'}</strong>
    {canOpen && <button type="button" role="menuitem" onClick={() => { onOpen(); onClose(); }}><Eye size={14} />打开详情</button>}
    {selectedCount > 0 && <button type="button" role="menuitem" onClick={() => { onFit(); onClose(); }}><ZoomIn size={14} />适应选择</button>}
    {selectedCount > 0 && <button type="button" role="menuitem" onClick={() => { onCopy(); onClose(); }}><Copy size={14} />复制参考上下文</button>}
    {editing && canGroup && <button type="button" role="menuitem" onClick={() => { onGroup(); onClose(); }}><BoxSelect size={14} />组成分组</button>}
    {editing && canRemoveResource && <button type="button" role="menuitem" onClick={() => { onRemoveResource(); onClose(); }}><Trash2 size={14} />移除资料节点</button>}
    <button type="button" role="menuitem" onClick={() => { onExport(); onClose(); }}><Download size={14} />导出脱敏摘要</button>
    <button type="button" role="menuitem" onClick={() => { onShortcuts(); onClose(); }}><BookOpen size={14} />查看快捷键</button>
  </div>;
}

function ResourcePanel({ resources, query, filter, onQuery, onFilter, onAdd }) {
  return <aside className="lineage-resource-panel" data-lineage-no-zoom aria-label="创作资料节点">
    <div className="lineage-resource-head"><p className="eyebrow">资料节点</p><h2>拖入画布形成计划上下文</h2><span>只创建画布标注，不会预检、运行或访问 Provider。</span></div>
    <label className="lineage-resource-search"><Search size={14} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索任务、风格或品牌" /></label>
    <div className="lineage-resource-filters">{RESOURCE_FILTERS.map(([value, label]) => <button type="button" key={value} className={filter === value ? 'is-active' : ''} onClick={() => onFilter(value)}>{label}</button>)}</div>
    <div className="lineage-resource-list">{resources.length ? resources.map((resource) => <ResourceCard key={resource.id} resource={resource} onAdd={onAdd} />) : <p>暂无可拖入的资料。</p>}</div>
  </aside>;
}
function ResourceCard({ resource, onAdd }) {
  return <article className={'lineage-resource-card kind-' + resource.kind} draggable onDragStart={(event) => { event.dataTransfer.setData('application/x-daoge-resource', resource.id); event.dataTransfer.effectAllowed = 'copy'; }}>
    <div>{resource.kind === 'task' ? <BookOpen size={15} /> : resource.kind === 'style' ? <Palette size={15} /> : <Tag size={15} />}<span>{resource.source}</span></div>
    <strong>{resource.title}</strong>
    <p>{safeResourceSummary(resource)}</p>
    <button type="button" className="outline-button" onClick={() => onAdd(resource)}>加入画布</button>
  </article>;
}
function LineageGroup({ group, memberCount, onToggle, onUngroup }) {
  const collapsed = group.metadata?.collapsed === true;
  return <section className={'lineage-group' + (collapsed ? ' is-collapsed' : '')} style={{ left: group.x, top: group.y, width: group.width, height: group.height }}>
    <header data-lineage-no-zoom><strong>{group.title}</strong><span>{memberCount} 个节点</span><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onToggle(group.id)}>{collapsed ? '展开' : '折叠'}</button><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onUngroup(group.id)}>取消分组</button></header>
  </section>;
}
function LineageNode({ node, active, searchHit, searchActive, onPointerDown, onSelect, onOpen, onContextMenu, onDragStart, onDragOver, onDrop }) {
  const status = statusPresentation(node.entityType === 'run_item' ? 'run_item' : node.entityType === 'run' ? 'run' : node.entityType === 'delivery' ? 'delivery' : 'generic', node.status);
  const isAsset = isAssetNode(node);
  const canReference = isAsset || node.resourceNode;
  const handleKeyDown = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); onOpen(); return; }
    if (event.key === ' ') { event.preventDefault(); onSelect(event, node); return; }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); onContextMenu(event, node); }
  };
  return <article role="button" tabIndex={0} aria-pressed={active} aria-label={nodeTypeLabel(node.entityType) + '：' + node.title} className={'lineage-node type-' + node.entityType + ' tone-' + (node.tone || node.entityType) + (active ? ' is-active' : '') + (searchHit ? ' is-search-hit' : '') + (searchActive ? ' is-search-active' : '') + (node.focused ? ' is-focused' : '') + (node.mediaUnavailable ? ' is-unavailable' : '')} style={{ left: node.x, top: node.y, width: node.width, height: node.height }} onPointerDown={(event) => onPointerDown(event, node)} onKeyDown={handleKeyDown} onDoubleClick={onOpen} onContextMenu={(event) => onContextMenu(event, node)} onDragOver={(event) => onDragOver(event, node)} onDrop={(event) => onDrop(event, node)}>
    {canReference && <span className="lineage-reference-handle" draggable title="拖到计划、轮次、任务或项目节点作为参考上下文" aria-hidden="true" onPointerDown={(event) => event.stopPropagation()} onDragStart={(event) => onDragStart(event, node)}><GitFork size={12} /></span>}
    {isAsset ? <div className="lineage-thumb"><img src={assetThumbnailUrl(node.entity)} alt="" loading="lazy" decoding="async" />{assetBadges(node).map(([tone, label]) => <span key={tone + label} className={'badge-' + tone}>{label}</span>)}</div> : <NodeIcon node={node} />}
    <div className="lineage-node-copy"><header><strong title={node.title}>{node.title}</strong><span className={'lineage-status ' + status.tone}>{status.label}</span></header><p title={node.subtitle}>{node.subtitle}</p>{node.entityType === 'plan' && node.planDetail && <div className="lineage-plan-mini"><span>{node.planDetail.itemCount || 0} 项</span><span>{node.planDetail.referenceCount || 0} 参考</span><span>{node.planDetail.outputSummary}</span></div>}</div>
  </article>;
}
function NodeIcon({ node }) {
  const props = { size: 22, strokeWidth: 1.7 };
  const Icon = node.entityType === 'project' ? Archive : node.entityType === 'task' ? Sparkles : node.entityType === 'round' ? GitFork : node.entityType === 'plan' ? Copy : node.entityType === 'run' ? Play : node.entityType === 'run_item' ? Grid2X2 : node.entityType === 'delivery' ? PackageCheck : node.entityType === 'task_type' ? BookOpen : node.entityType === 'style_kit' ? Palette : node.entityType === 'brand_kit' ? Tag : Image;
  return <div className="lineage-node-icon"><Icon {...props} /></div>;
}
function openNode(node, { onNavigate, onInspectAsset }) {
  if (node.entityType === 'project') onNavigate({ view: 'project-overview', projectId: node.entity.id, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
  else if (node.entityType === 'task') onNavigate({ view: 'lineage', taskId: node.entity.id, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
  else if (node.entityType === 'round' || node.entityType === 'plan') onNavigate({ view: 'prompts', taskId: node.entity.taskId, roundId: node.entity.id, compareRoundIds: [node.entity.id], runId: null, assetScope: 'round' });
  else if (node.entityType === 'run') onNavigate({ view: 'runs', roundId: node.entity.roundId, compareRoundIds: [node.entity.roundId], runId: node.entity.id, assetScope: 'round' });
  else if (isAssetNode(node)) onInspectAsset(node.entity.id);
  else if (node.entityType === 'delivery') onNavigate({ view: 'deliveries', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
}
function contextRouteForNode(node) {
  if (!node) return null;
  if (node.entityType === 'project') return { view: 'lineage', projectId: node.entity.id, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' };
  if (node.entityType === 'task') return { view: 'lineage', projectId: node.entity.projectId, taskId: node.entity.id, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' };
  if (node.entityType === 'round' || node.entityType === 'plan') return { view: 'lineage', taskId: node.entity.taskId, roundId: node.entity.id, compareRoundIds: [node.entity.id], runId: null, assetScope: 'round' };
  return null;
}
function LineageInspector({ tasks = EMPTY_ARRAY, editing, node, selectedNodes, selectedAssetNodes, selectedTask, selectedRound, batchBusy, groupTitle, nodeLinks, onGroupTitleChange, onCreateGroup, onCreateLink, onRemoveLink, onUpdateLink, onReverseLink, onClear, onNavigate, onPreviewAsset, onInspectAsset, onToggleAsset, onBatchSelectAssets, onReviewAsset, onBatchReviewAssets, onSetAssetShared, onDownloadAsset, onCopyAsset, onRetryRunItem, onControlRun, onOpenProvider, onCopyContext, onCreateTask, onCreateRound, onOpenReference, onOpenDerive, onAddReference, onReject, onCreateDelivery, onOpenConfirmation }) {
  if (!selectedNodes.length) {
    return <aside className="lineage-inspector" data-lineage-no-zoom>
      <p className="eyebrow">检查器</p>
      <h2>选择一个节点</h2>
      <p>{editing ? '编辑模式可多选、分组、添加标注或拖入资料。' : '单击节点查看详情；节点相关动作会在这里出现。'}</p>
      <p className="lineage-note">先点画布里的图片或轮次；右侧只显示和当前选择直接相关的操作。</p>
    </aside>;
  }
  if (!node) {
    const selectedAssetIds = selectedAssetNodes.map((item) => item.entity.id).filter(Boolean);
    const selectedAssets = selectedAssetNodes.map((item) => item.entity).filter(Boolean);
    return <aside className="lineage-inspector" data-lineage-no-zoom>
      <div className="lineage-inspector-head">
        <div><p className="eyebrow">批量操作</p><h2>{selectedNodes.length} 个节点</h2></div>
        <button type="button" className="icon-button" aria-label="清除选择" onClick={onClear}><X size={15} /></button>
      </div>
      {selectedAssetIds.length ? <>
        <p className={batchBusy ? 'lineage-batch-status is-busy' : 'lineage-batch-status'}>{batchBusy ? '选片同步进行中，批量按钮暂不可用。' : '已选择 ' + selectedAssetIds.length + ' 个资产，可批量设为成果、移出成果，或作为参考继续创作。'}</p>
        <CreativeActionLauncher assets={batchBusy ? EMPTY_ARRAY : selectedAssets} selectedTask={selectedTask} fallbackTask={taskForAssets(selectedAssets, tasks)} selectedRound={selectedRound} label="继续创作" onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenReference={onOpenReference} />
        <div className="lineage-inspector-actions">
          <button type="button" className="outline-button" disabled={batchBusy} onClick={() => onBatchSelectAssets(selectedAssetIds, true)}><Bookmark size={15} />选为成果</button>
          <button type="button" className="outline-button" disabled={batchBusy} onClick={() => onBatchSelectAssets(selectedAssetIds, false)}><X size={15} />移出成果</button>
        </div>
      </> : <p>当前选择中没有可批量处理的资产节点。</p>}
      <div className="lineage-inspector-actions">
        <button type="button" className="command-button" onClick={() => onCopyContext('reference', selectedNodes)}><Copy size={15} />复制参考上下文</button>
        <button type="button" className="outline-button" onClick={() => onCopyContext('variation', selectedNodes)}><Sparkles size={15} />复制变体上下文</button>
        <button type="button" className="outline-button" onClick={() => onCopyContext('refinement', selectedNodes)}><RefreshCw size={15} />复制优化上下文</button>
      </div>
      {editing && <GroupActions value={groupTitle} onChange={onGroupTitleChange} onCreate={onCreateGroup} disabled={selectedNodes.length < 2} />}
      {editing && selectedNodes.length >= 2 && <RelationActions nodes={selectedNodes} onCreate={onCreateLink} />}
    </aside>;
  }
  const entity = node.entity;
  const isAsset = isAssetNode(node);
  const isResource = node.resourceNode || isResourceType(node.entityType);
  return <aside className="lineage-inspector" data-lineage-no-zoom>
    <div className="lineage-inspector-head">
      <div><p className="eyebrow">检查器</p><h2>{node.title}</h2></div>
      <button type="button" className="icon-button" aria-label="清除选择" onClick={onClear}><X size={15} /></button>
    </div>
    <dl>
      <div><dt>类型</dt><dd>{nodeTypeLabel(node.entityType)}</dd></div>
      <div><dt>状态</dt><dd>{isAsset ? assetState(entity, node.selectedAsset, node.sharedAsset, node.deliveredAsset, node.mediaUnavailable, node.derivedAsset) : statusPresentation(node.entityType === 'run_item' ? 'run_item' : node.entityType === 'run' ? 'run' : node.entityType === 'delivery' ? 'delivery' : 'generic', node.status).label}</dd></div>
      <div><dt>短 ID</dt><dd>{shortId(node.entityId)}</dd></div>
    </dl>
    {node.entityType === 'plan' ? <PlanActions node={node} onNavigate={onNavigate} onCopyContext={onCopyContext} onOpenConfirmation={onOpenConfirmation} /> : isAsset ? <AssetActions tasks={tasks} node={node} selectedTask={selectedTask} selectedRound={selectedRound} onPreviewAsset={onPreviewAsset} onInspectAsset={onInspectAsset} onToggleAsset={onToggleAsset} onReviewAsset={onReviewAsset} onSetAssetShared={onSetAssetShared} onDownloadAsset={onDownloadAsset} onCopyAsset={onCopyAsset} onCopyContext={onCopyContext} onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenReference={onOpenReference} /> : node.entityType === 'run_item' ? <RunItemActions item={entity} onRetryRunItem={onRetryRunItem} /> : node.entityType === 'run' ? <RunActions run={entity} onNavigate={onNavigate} onControlRun={onControlRun} /> : isResource ? <ResourceActions node={node} onCopyContext={onCopyContext} /> : ['task', 'round', 'delivery'].includes(node.entityType) ? <NavigationActions node={node} onNavigate={onNavigate} onCreateRound={onCreateRound} onOpenReference={onOpenReference} /> : null}
    {editing && nodeLinks.length ? <SoftLinkList links={nodeLinks} node={node} onRemove={onRemoveLink} onUpdate={onUpdateLink} onReverse={onReverseLink} /> : null}
  </aside>;
}
function GroupActions({ value, onChange, onCreate, disabled }) { return <div className="lineage-group-tools"><p>分组只是画布组织方式，不改变项目、运行或资产事实。</p><label><span>分组名称</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="例如：第一版探索" /></label><button type="button" className="outline-button" disabled={disabled} onClick={onCreate}><BoxSelect size={15} />组成分组</button></div>; }
function RelationActions({ nodes, onCreate }) {
  return <div className="lineage-relation-tools"><p>软连线只做人工标注，不会创建运行或修改资产来源。默认方向：{nodes[0].title} → 其余 {nodes.length - 1} 个节点。</p>{RELATION_OPTIONS.map(([value, label]) => <button type="button" key={value} className="outline-button" onClick={() => onCreate(value, nodes[0], nodes.slice(1))}><GitFork size={15} />{label}</button>)}{nodes.length === 2 && RELATION_OPTIONS.map(([value, label]) => <button type="button" key={'reverse-' + value} className="outline-button" onClick={() => onCreate(value, nodes[0], nodes[1], 'reverse')}><GitFork size={15} />反向 {label}</button>)}</div>;
}
function SoftLinkList({ links, node, onRemove, onUpdate, onReverse }) {
  return <div className="lineage-soft-links"><h3>人工标注</h3>{links.map((link) => <div key={link.id}><select value={link.linkType} onChange={(event) => onUpdate(link.id, { linkType: event.target.value, label: relationLabel(event.target.value) })}>{RELATION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={link.label} maxLength={80} onChange={(event) => onUpdate(link.id, { label: event.target.value })} aria-label="软连线标签" /><small>{link.sourceType === node.entityType && link.sourceId === node.entityId ? '指向 ' + nodeTypeLabel(link.targetType) + ' ' + shortId(link.targetId) : '来自 ' + nodeTypeLabel(link.sourceType) + ' ' + shortId(link.sourceId)}</small><button type="button" className="icon-button" aria-label="反转软连线方向" onClick={() => onReverse(link.id)}><GitFork size={13} /></button><button type="button" className="icon-button" aria-label="删除软连线" onClick={() => onRemove(link.id)}><X size={13} /></button></div>)}</div>;
}
function ResourceActions({ node, onCopyContext }) { return <div className="lineage-inspector-actions"><p className="lineage-note">资料节点只提供计划上下文。复制后回到会话生成待确认计划，不会直接调用 Provider。</p><button type="button" className="command-button" onClick={() => onCopyContext('plan', [node])}><Copy size={15} />复制计划上下文指令</button><button type="button" className="outline-button" onClick={() => onCopyContext('variation', [node])}><Sparkles size={15} />复制变体上下文</button></div>; }
function PlanActions({ node, onNavigate, onCopyContext, onOpenConfirmation }) {
  const detail = node.planDetail || roundPlanDetails(node.entity);
  const needsConfirmation = node.entity?.status === 'awaiting_confirmation';
  return <div className="lineage-plan-details">
    <p className="lineage-note">计划节点展示已保存的脱敏计划摘要。待确认时可在这里激活人工确认；预检和运行仍由会话受控执行。</p>
    <dl><div><dt>操作</dt><dd>{detail.operationLabel}</dd></div><div><dt>数量</dt><dd>{detail.itemCount || 0} 项</dd></div><div><dt>输出</dt><dd>{detail.outputSummary}</dd></div><div><dt>参考/遮罩</dt><dd>{detail.referenceCount || 0} / {detail.maskCount || 0}</dd></div><div><dt>提示词</dt><dd>{detail.prompt}</dd></div></dl>
    {needsConfirmation && <section className="lineage-confirmation-callout"><p>当前计划正在等待人工确认。</p><button type="button" className="command-button" onClick={() => onOpenConfirmation?.(node.entity)}><Check size={15} />审阅并确认计划</button></section>}
    <div className="lineage-inspector-actions"><button type="button" className="outline-button" onClick={() => openNode(node, { onNavigate, onInspectAsset: () => undefined })}><Eye size={15} />打开计划版本对比</button><button type="button" className="outline-button" onClick={() => onCopyContext('refinement', [node])}><RefreshCw size={15} />复制优化计划上下文</button><button type="button" className="outline-button" onClick={() => onCopyContext('variation', [node])}><Sparkles size={15} />复制变体计划上下文</button></div>
  </div>;
}
function LineageAssetGetActions({ asset, onPreviewAsset, onDownloadAsset, onCopyAsset }) {
  return <section className="lineage-action-section lineage-get-actions" aria-label="获取图片">
    <header><strong>获取图片</strong><span>查看、复制或保存原图</span></header>
    <div className="lineage-utility-row">
      <button type="button" className="outline-button" onClick={() => onPreviewAsset(asset)}><Eye size={15} />放大</button>
      <button type="button" className="outline-button" onClick={() => onCopyAsset(asset)}><Copy size={15} />复制</button>
      <button type="button" className="outline-button" onClick={() => onDownloadAsset(asset)}><Download size={15} />下载</button>
    </div>
  </section>;
}
function AssetActions({ tasks = EMPTY_ARRAY, node, selectedTask, selectedRound, onPreviewAsset, onInspectAsset, onToggleAsset, onReviewAsset, onSetAssetShared, onDownloadAsset, onCopyAsset, onCopyContext, onOpenDerive, onAddReference, onReject, onOpenReference }) {
  const asset = node.entity;
  const fallbackTask = taskForAsset(asset, tasks);
  if (node.externalSharedAsset) return <div className="lineage-inspector-stack">
    <CreativeActionLauncher assets={[asset]} selectedTask={selectedTask} fallbackTask={fallbackTask} selectedRound={selectedRound} label="继续使用" onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenReference={onOpenReference} />
    <LineageAssetGetActions asset={asset} onPreviewAsset={onPreviewAsset} onDownloadAsset={onDownloadAsset} onCopyAsset={onCopyAsset} />
    <details className="lineage-secondary-actions"><summary>更多信息</summary><div className="lineage-inspector-actions"><button type="button" className="outline-button" onClick={() => onInspectAsset(asset.id)}><GitFork size={15} />查看来源</button><button type="button" className="outline-button" onClick={() => onCopyContext('reference', [node])}><Copy size={15} />复制参考上下文</button></div></details>
  </div>;
  return <div className="lineage-inspector-stack">
    <div className="lineage-primary-actions">
      <button type="button" className="command-button" onClick={() => onToggleAsset(asset)}><Bookmark size={15} />{node.selectedAsset ? '移出成果' : '选为成果'}</button>
      <CreativeActionLauncher assets={[asset]} selectedTask={selectedTask} fallbackTask={fallbackTask} selectedRound={selectedRound} label="继续创作" onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenReference={onOpenReference} />
    </div>
    <LineageAssetGetActions asset={asset} onPreviewAsset={onPreviewAsset} onDownloadAsset={onDownloadAsset} onCopyAsset={onCopyAsset} />
    <details className="lineage-secondary-actions"><summary>更多信息</summary><div className="lineage-inspector-actions"><button type="button" className="outline-button" onClick={() => onInspectAsset(asset.id)}><GitFork size={15} />查看来源</button><button type="button" className="outline-button" onClick={() => onSetAssetShared(asset, !node.sharedAsset)}><Share2 size={15} />{node.sharedAsset ? '取消共享' : '共享素材'}</button></div></details>
  </div>;
}
function RunItemActions({ item, onRetryRunItem }) {
  const retryable = ['failed', 'blocked', 'retry_wait'].includes(item.status);
  return <div className="lineage-inspector-actions"><p>{item.error?.summary || item.error?.message || '该运行项暂无错误。'}</p>{retryable ? <button type="button" className="command-button" onClick={() => onRetryRunItem(item.id)}><RefreshCw size={15} />重试此项</button> : item.status === 'outcome_unknown' ? <p className="lineage-note">未知结果需要用户核实，不能自动重放。</p> : null}</div>;
}
function RunActions({ run, onNavigate, onControlRun }) {
  const execution = runExecutionPresentation(run, []);
  return <div className="lineage-inspector-actions"><p>{execution.detail || '运行由 daemon Worker 队列执行，画布只展示状态。'}</p><button type="button" className="outline-button" onClick={() => onNavigate({ view: 'runs', roundId: run.roundId, compareRoundIds: [run.roundId], runId: run.id, assetScope: 'round' })}><Eye size={15} />查看生成历史</button>{['queued', 'running'].includes(run.status) && <button type="button" className="outline-button" onClick={() => onControlRun('pause', run.id)}><Pause size={15} />暂停运行</button>}{run.status === 'paused' && <button type="button" className="command-button" onClick={() => onControlRun('resume', run.id)}><Play size={15} />恢复运行</button>}{!['completed', 'cancelled'].includes(run.status) && <button type="button" className="outline-button" onClick={() => onControlRun('cancel', run.id)}><X size={15} />取消运行</button>}</div>;
}
function NavigationActions({ node, onNavigate, onCreateRound, onOpenReference }) {
  const route = contextRouteForNode(node);
  const isTask = node.entityType === 'task';
  const isRound = node.entityType === 'round' || node.entityType === 'plan';
  return <div className="lineage-inspector-actions">
    {route && <button type="button" className="command-button" onClick={() => onNavigate(route)}><Search size={15} />设为当前上下文</button>}
    <button type="button" className="outline-button" onClick={() => openNode(node, { onNavigate, onInspectAsset: () => undefined })}><Eye size={15} />打开详情</button>
    {isTask && <button type="button" className="outline-button" onClick={() => { onNavigate(route); onCreateRound(); }}><GitFork size={15} />为此任务新建轮次</button>}
    {isRound && node.entity?.status === 'draft' && <button type="button" className="outline-button" onClick={() => onNavigate(route)}><Image size={15} />设为当前后添加参考</button>}
  </div>;
}
function LineageMinimap({ nodes, groups = [], viewport, canvasSize, searchMatchKeys = EMPTY_SET, onViewportChange }) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const bounds = useMemo(() => {
    const items = [...nodes, ...groups];
    if (!items.length) return { left: -500, top: -400, right: 500, bottom: 400 };
    return items.reduce((acc, item) => ({ left: Math.min(acc.left, item.x), top: Math.min(acc.top, item.y), right: Math.max(acc.right, item.x + item.width), bottom: Math.max(acc.bottom, item.y + item.height) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  }, [nodes, groups]);
  const width = 210;
  const height = 134;
  const worldWidth = Math.max(1, bounds.right - bounds.left + 360);
  const worldHeight = Math.max(1, bounds.bottom - bounds.top + 260);
  const scale = Math.min(width / worldWidth, height / worldHeight);
  const toMap = useCallback((x, y) => ({ x: (x - bounds.left + 180) * scale, y: (y - bounds.top + 130) * scale }), [bounds.left, bounds.top, scale]);
  const toWorld = useCallback((x, y) => ({ x: (x - 180) / scale + bounds.left, y: (y - 130) / scale + bounds.top }), [bounds.left, bounds.top, scale]);
  const viewportWidth = Math.max(1, canvasSize?.width || 900);
  const viewportHeight = Math.max(1, canvasSize?.height || 560);
  const updateViewportFromPointer = useCallback((event) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);
    onViewportChange({ x: viewportWidth / 2 - world.x * viewport.k, y: viewportHeight / 2 - world.y * viewport.k, k: viewport.k });
  }, [onViewportChange, toWorld, viewport.k, viewportHeight, viewportWidth]);
  const handlePointerDown = useCallback((event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    updateViewportFromPointer(event);
  }, [updateViewportFromPointer]);
  const handlePointerMove = useCallback((event) => {
    if (dragging) updateViewportFromPointer(event);
  }, [dragging, updateViewportFromPointer]);
  const stopDragging = useCallback(() => setDragging(false), []);
  return <div className={'lineage-minimap' + (dragging ? ' is-dragging' : ' is-idle')} data-lineage-no-zoom>
    <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDragging} onPointerCancel={stopDragging} onPointerLeave={stopDragging}>
      {groups.map((group) => {
        const p = toMap(group.x, group.y);
        return <rect key={'group-' + group.id} className="group" x={p.x} y={p.y} width={Math.max(3, group.width * scale)} height={Math.max(3, group.height * scale)} rx="3" />;
      })}
      {nodes.map((node) => {
        const p = toMap(node.x, node.y);
        return <rect key={node.key} className={searchMatchKeys.has(node.key) ? 'node search-hit' : 'node'} x={p.x} y={p.y} width={Math.max(2, node.width * scale)} height={Math.max(2, node.height * scale)} rx="2" />;
      })}
      <rect className="viewport" x={Math.max(0, (-viewport.x / viewport.k - bounds.left + 180) * scale)} y={Math.max(0, (-viewport.y / viewport.k - bounds.top + 130) * scale)} width={Math.max(4, viewportWidth / viewport.k * scale)} height={Math.max(4, viewportHeight / viewport.k * scale)} />
    </svg>
    <button type="button" onClick={() => onViewportChange(DEFAULT_VIEWPORT)}>重置视图</button>
  </div>;
}
function ShortcutPanel({ onClose }) {
  const rows = [['拖动画布', '中键 / Cmd / Ctrl + 拖拽'], ['框选节点', '空白处拖拽'], ['多选', 'Shift / Cmd 点击'], ['全选', 'Cmd/Ctrl + A'], ['撤销 / 重做', 'Cmd/Ctrl + Z / Shift+Z'], ['微调节点', '方向键；吸附开启时按网格移动'], ['组成分组', '选中多个节点后按 G'], ['适应选择', 'F'], ['关闭面板', 'Esc']];
  return <aside className="lineage-shortcut-panel" data-lineage-no-zoom><div><p className="eyebrow">快捷键</p><button type="button" className="icon-button" aria-label="关闭快捷键" onClick={onClose}><X size={14} /></button></div>{rows.map(([action, shortcut]) => <p key={action}><strong>{action}</strong><span>{shortcut}</span></p>)}</aside>;
}
