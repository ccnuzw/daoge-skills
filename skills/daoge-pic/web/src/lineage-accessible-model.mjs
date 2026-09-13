import { runItemRecovery, statusPresentation } from './status-presentation.mjs';

const NODE_TYPE_LABELS = Object.freeze({
  project: '项目',
  task: '任务',
  round: '轮次',
  plan: '计划',
  run: '生成运行',
  run_item: '运行项',
  asset: '项目资产',
  shared_asset: '共享素材',
  delivery: '交付',
  task_type: '任务类型',
  style_kit: '风格包',
  brand_kit: '品牌包',
  group: '分组'
});

const SCOPE_LABELS = Object.freeze({ project: '项目范围', task: '任务范围', round: '轮次范围' });
const OPENABLE_TYPES = new Set(['project', 'task', 'round', 'plan', 'run', 'run_item', 'asset', 'shared_asset', 'delivery']);
const SAFE_TONES = new Set(['quiet', 'ready', 'live', 'danger']);
const URL_TEXT = /https?:\/\/[^\s<>"']+/gi;
const WINDOWS_PATH = /[A-Za-z]:\\[^\r\n\t,;<>"']+/g;
const ABSOLUTE_PATH = /(^|[\s('"=:])\/(?:Users|home|tmp|var|private|Volumes|opt|srv|mnt|media|workspace)\/[^\s,;<>"')]+/g;
const SECRET_TEXT = /\b(?:bearer|authorization|api[_ -]?key|x-goog-api-key|token|secret|password|capability)\s*[:=]?\s*[^\s,;<>"']+/gi;
const PROVIDER_KEY = /\b(?:sk|pk|rk|dgpct1)[-_a-z0-9.]{8,}\b/gi;
const SENSITIVE_FIELD = /(?:prompt|提示词|response|响应体|request|请求体|raw|原始|url|链接|uri|endpoint|端点|path|路径)\s*[:=：]/i;
const SAFE_STATUS_LABELS = new Set(['开放', '已归档', '待规划', '开放创作', '已收束', '已确认 · 可继续', '待确认', '排队中', '运行中', '正在暂停', '已暂停', '等待会话确认', '部分完成', '已完成', '失败', '已取消', '保留', '待复核', '不采用', '衍生', '等待处理', '正在准备', '正在请求', '正在接收', '正在保存', '等待重试', '已阻塞', '正在取消', '需核实结果', '媒体不可用', '已交付', '已选成果', '可继续', '未定', '共享素材', '未加载']);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function finiteCount(value, fallback) { return Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : fallback; }

export function redactLineageText(value, maxLength = 160) {
  const source = text(value);
  if (!source) return '';
  return source
    .replace(URL_TEXT, '[已隐藏链接]')
    .replace(WINDOWS_PATH, '[已隐藏路径]')
    .replace(ABSOLUTE_PATH, '$1[已隐藏路径]')
    .replace(SECRET_TEXT, '[已隐藏敏感字段]')
    .replace(PROVIDER_KEY, '[已隐藏密钥]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function shortId(value) {
  const safe = String(value || '').replace(/^[^_]+_/, '').replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 8);
  return safe || '未记录';
}

function nodeTypeLabel(type) { return NODE_TYPE_LABELS[type] || '节点'; }
function statusScope(type) { return type === 'run_item' ? 'run_item' : type === 'run' ? 'run' : type === 'delivery' ? 'delivery' : type === 'round' ? 'round' : type === 'task' ? 'task' : type === 'project' ? 'project' : 'generic'; }

function statusForNode(node) {
  if (node?.mediaUnavailable) return { label: '媒体不可用', tone: 'danger' };
  if (node?.entityType === 'asset' || node?.entityType === 'shared_asset') {
    const decision = node.entity?.review?.decision;
    if (node.deliveredAsset) return { label: '已交付', tone: 'ready' };
    if (node.selectedAsset || decision === 'keep') return { label: '已选成果', tone: 'ready' };
    if (decision === 'reject') return { label: '不采用', tone: 'danger' };
    if (decision === 'derive') return { label: '可继续', tone: 'quiet' };
    if (decision === 'review') return { label: '未定', tone: 'quiet' };
    if (node.sharedAsset) return { label: '共享素材', tone: 'quiet' };
  }
  const presentation = statusPresentation(statusScope(node?.entityType), node?.status);
  const label = SAFE_STATUS_LABELS.has(presentation.label) ? presentation.label : '状态待确认';
  const tone = SAFE_TONES.has(presentation.tone) ? presentation.tone : 'quiet';
  return { label, tone };
}

function safeSummary(node) {
  const type = node?.entityType;
  if (type === 'project') return '项目工作区；列表只展示结构化关系和脱敏状态。';
  if (type === 'task') return '任务节点；计划、轮次和结果通过谱系关系查看。';
  if (type === 'plan') return '计划摘要已脱敏；提示词等受保护字段不在此视图展示。';
  if (type === 'task_type' || type === 'style_kit' || type === 'brand_kit') return '结构化资料节点；具体内容不在此视图展示。';
  if (type === 'run_item') {
    const recovery = runItemRecovery(node.entity);
    const error = redactLineageText(recovery.error, 120);
    return error && !SENSITIVE_FIELD.test(error) ? '脱敏错误摘要：' + error : '运行项状态已脱敏；异常详情请通过既有检查器查看。';
  }
  const candidate = redactLineageText(node?.subtitle, 160);
  if (!candidate || SENSITIVE_FIELD.test(candidate)) return '结构化摘要已脱敏。';
  return candidate;
}

function safeTitle(node) {
  const title = redactLineageText(node?.title, 120);
  return title && !SENSITIVE_FIELD.test(title) ? title : nodeTypeLabel(node?.entityType);
}

function publicNode(node = {}) {
  const entityType = text(node.entityType) || 'unknown';
  return {
    key: text(node.key) || entityType + ':' + String(node.entityId || ''),
    type: entityType,
    typeLabel: nodeTypeLabel(entityType),
    shortId: shortId(node.entityId),
    title: safeTitle(node),
    status: statusForNode(node),
    summary: safeSummary(node),
    openable: OPENABLE_TYPES.has(entityType) && (entityType !== 'run_item' || Boolean(node.roundId || node.entity?.roundId)),
    flags: {
      selected: node.selectedAsset === true,
      shared: node.sharedAsset === true,
      delivered: node.deliveredAsset === true,
      unavailable: node.mediaUnavailable === true
    }
  };
}

function endpointFromKey(key) {
  const value = text(key);
  const separator = value.indexOf(':');
  return separator > 0 ? { type: value.slice(0, separator), id: value.slice(separator + 1) } : null;
}

function unloadedEndpoint(key) {
  const endpoint = endpointFromKey(key);
  const type = endpoint?.type || 'unknown';
  return {
    key: text(key),
    type,
    typeLabel: nodeTypeLabel(type),
    shortId: shortId(endpoint?.id),
    title: '未加载' + nodeTypeLabel(type),
    status: { label: '未加载', tone: 'quiet' },
    summary: '该关系端点不在当前已加载数据中；不能据此判断完整谱系。',
    openable: false,
    unresolved: true,
    flags: { selected: false, shared: false, delivered: false, unavailable: false }
  };
}

function relationshipLabel(connection) {
  const label = redactLineageText(connection?.label, 80);
  return label && !SENSITIVE_FIELD.test(label) ? label : '谱系关系';
}
function safeCoverage(value, fallback) {
  const loaded = finiteCount(value?.loaded, fallback);
  const total = Math.max(loaded, finiteCount(value?.total, loaded));
  const loading = value?.loading === true;
  return { loaded, total, loading, complete: !loading && loaded >= total };
}

function coverageScope(scope) {
  const type = text(scope?.type) || 'project';
  return { type, label: SCOPE_LABELS[type] || '当前范围', shortId: shortId(scope?.id) };
}

/**
 * Builds a screen-reader-friendly lineage outline without exposing raw entity
 * payloads. It consumes only the graph already present in the caller.
 */
export function createAccessibleLineage({ nodes = [], connections = [], endpointByKey = new Map(), scope = null, coverage = {} } = {}) {
  const sourceNodes = Array.isArray(nodes) ? nodes : [];
  const publicNodes = sourceNodes.map(publicNode);
  const publicNodeByKey = new Map(publicNodes.map((node) => [node.key, node]));
  const endpoints = endpointByKey instanceof Map ? endpointByKey : new Map(sourceNodes.map((node) => [node.key, node]));
  const publicEndpoint = (key) => publicNodeByKey.get(key) || (endpoints.has(key) ? publicNode(endpoints.get(key)) : unloadedEndpoint(key));
  const publicConnections = (Array.isArray(connections) ? connections : []).map((connection, index) => {
    const sourceKey = text(connection?.from);
    const targetKey = text(connection?.to);
    if (!sourceKey || !targetKey) return null;
    const source = publicEndpoint(sourceKey);
    const target = publicEndpoint(targetKey);
    return {
      key: text(connection?.id) || sourceKey + '->' + targetKey + ':' + index,
      type: redactLineageText(connection?.type, 48) || '谱系',
      label: relationshipLabel(connection),
      source,
      target,
      unresolved: source.unresolved === true || target.unresolved === true
    };
  }).filter(Boolean);
  const coverageRows = [
    { id: 'assets', label: '资产数据', ...safeCoverage(coverage.assets, sourceNodes.filter((node) => node.entityType === 'asset' || node.entityType === 'shared_asset').length) },
    { id: 'run-items', label: '运行项数据', ...safeCoverage(coverage.runItems, sourceNodes.filter((node) => node.entityType === 'run_item').length) }
  ];
  const unresolvedRelations = publicConnections.filter((connection) => connection.unresolved).length;
  const complete = coverageRows.every((row) => row.complete) && unresolvedRelations === 0;
  const counts = publicNodes.reduce((result, node) => ({ ...result, [node.type]: (result[node.type] || 0) + 1 }), {});
  return {
    scope: coverageScope(scope),
    nodes: publicNodes,
    connections: publicConnections,
    counts,
    coverage: {
      rows: coverageRows,
      complete,
      unresolvedRelations,
      message: complete
        ? '当前列表来自已加载 graph 数据；资产与运行项分页均已覆盖，关系端点已解析。'
        : '当前仅展示已加载数据；loaded / total 未覆盖的分页节点不代表不存在，未加载关系端点也不会被冒充为完整谱系。',
      canvasNote: '画布活动窗口的虚拟化只限制画布 DOM；此列表不把虚拟化窗口冒充为完整数据。'
    }
  };
}

export function lineageNodeTypeLabel(type) { return nodeTypeLabel(type); }
export function lineageStatusForNode(node) { return statusForNode(node); }
