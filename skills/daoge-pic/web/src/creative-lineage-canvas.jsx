import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Bookmark, BoxSelect, Check, Columns3, Copy, Download, Eye, Gauge, GitFork, Grid2X2, Image, LoaderCircle, Map as MapIcon, Move, Pencil, Play, Plus, Redo2, RefreshCw, Save, Search, Share2, SlidersHorizontal, Sparkles, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { assetThumbnailUrl } from './asset-media-url.mjs';
import { AssetProvenanceBody } from './asset-provenance.jsx';
import { MINIMAP_HEIGHT, MINIMAP_WIDTH, clampWorldPoint, createMinimapGeometry, createMinimapItems, minimapToWorld, viewportRectForMinimap, worldToMinimap } from './lineage-minimap-model.mjs';
import { LINEAGE_NODE_RENDER_LIMIT, lineageViewportBounds, virtualizeLineageNodes } from './lineage-viewport-model.mjs';
import { createAccessibleLineage, redactLineageText } from './lineage-accessible-model.mjs';
import { createLineageExport, lineageExportFilename } from './lineage-export-model.mjs';
import { statusPresentation } from './status-presentation.mjs';
import { pendingRunItems } from './run-item-pagination.mjs';
import { nodeMenuItems } from './lineage-menu-model.mjs';
import { LineageContextMenu, LineageGroup, LineageMinimap, LineageNode, LineageTextView, NodeIcon, ShortcutPanel } from './canvas/lineage-stage.jsx';
import { AssetActions, GroupActions, LineageAssetGetActions, LineageInspector, NavigationActions, PlanActions, PlanEditDialog, RelationActions, ReplyHistoryPanel, SoftLinkList } from './canvas/lineage-inspector.jsx';
import { BACKGROUNDS, CREATOR_MODES, DEFAULT_SETTINGS, DEFAULT_VIEWPORT, EMPTY_ARRAY, EMPTY_ROUND_SET, EMPTY_SET, FILTERS, HISTORY_LIMIT, LINEAGE_SENSITIVE_PATTERNS, NODE_SIZE, OPERATION_LABELS, PERSISTED_NODE_TYPES, PLAN_PROMPT_PROTECTED_LABEL, PURPOSE_LABELS, REFERENCE_TARGET_TYPES, RELATION_OPTIONS, REVIEW_LABELS, SAFE_NODE_SUMMARY_LABEL, SAVE_STATUS_LABELS, SNAP_SIZE, TEMPLATE_OPTIONS, applySavedLayout, assetBadges, assetLabel, assetSourceRoundId, assetSourceTaskId, assetState, boundsForItems, buildGraph, canWriteTextClipboard, clampScale, clientId, clonePlain, connectionLabelPoint, connectionPath, contextRouteForNode, createNode, currentLayoutSnapshot, dataTransferHasType, defaultCollapsedFor, deliveryAssetIds, endpointFromKey, endpointFromNode, findFreeSlot, groupMemberBounds, hasOwn, hasProtectedLineageText, idSetValue, intersects, isAssetNode, lineageExportLink, listValue, manualConnection, mediaUnavailable, nodeKey, nodeSearchHaystack, nodeTypeLabel, normalizeCanvasMode, normalizeViewport, openNode, planOutputSummary, positionedItems, rectsOverlap, relatedLinksForNode, relationLabel, reviewDecisionCounts, roundMaskAssetIds, roundOutputSummary, roundParentAssetIds, roundPlanDetails, roundReferenceMaterials, runStatusCounts, safeDisplayText, safeMenuPoint, safeNodeSubtitle, safeNodeTitle, safeSearchToken, selectedNodeContextLine, serializeGroup, shortId, snapshotKey, taskForAsset, taskForAssets, taskRounds, text, usageLabel, visibleByFilter, visibleByMode } from './canvas/lineage-shared.mjs';
import { asideMetrics, asideSubject } from './aside-model.mjs';
import { SHORTCUT_ROWS } from './shortcut-model.mjs';
import { deriveAvailability } from './derive-path-model.mjs';
import { understandingNote } from './plan-understanding-model.mjs';
import { applyPlanEdit, planEditForm, planEditIssues } from './plan-edit-model.mjs';
import { batchFailureSummary } from './failure-copy-model.mjs';
import { batchQualityCopy, reviewDistribution } from './batch-quality-model.mjs';
import { AccessibleDialog } from './accessible-dialog.jsx';
import { CreativeActionLauncher } from './creative-action-launcher.jsx';

// 这是同一张图上的三种「看法」，不是三个去处 —— 名字必须和左侧一级入口明显区分。
// 2026-09-17 从五种收敛为三种（刀哥裁定）：折叠 + 去冗余之后，「按批次」与全局重合、「按任务」与按图片重合。
// 只有这三类节点会持久化位置（外加系统生成的 group）；其余只在渲染期存在。
// 这两个空值既当默认值又当返回值。用 Object.freeze 会让类型变成 readonly，
// 而下面所有用到它的地方都只读取、不修改，所以声明成普通可变类型更贴合实际用法。
/** @type {Set<string>} */

/** 批次节点的输出摘要：把原先散在「运行 / 出图槽位」节点上的结果收回批次（方案 4.3 第二刀）。
 *  失败口径与 4.10 一致：failed 与 blocked 都要说，outcome_unknown 也要计入「没成」。 */

/** 折叠的默认值：可折叠的节点（批次）**默认收起**——「默认一个批次 = 一个节点，双击展开」（方案 4.3 第一刀）。 */

/** 两个矩形是否重叠（增量插入时用来避让已占位的区域）。 */

/**
 * 增量插入：新节点**不重排已有布局**，但也不能落在别人身上。
 * 节点自带的坐标来自固定公式（按索引排布），而用户可能挪过节点——两者一撞就叠在一起。
 * 所以从自带位置起沿 y 向下找第一个不重叠的空位；探测有上限，找不到就退回原位（宁可重叠，不要跑到天边）。
 */

/** @param {any} [overrides] 节点上允许覆盖/追加任意字段（title、subtitle、searchText、deliveredAsset…） */

/** 旧布局可能存着已收敛的模式值，归一化到语义最近的新模式（flow≈按图片，rounds≈全局）。 */

function statusCountText(counts) {
  const parts = Object.entries(counts || {}).filter(([, value]) => value > 0).map(([status, value]) => statusPresentation('run', status).label + ' ' + value);
  return parts.length ? parts.join(' / ') : '暂无运行';
}

export function CreativeLineageCanvas({ request, project, tasks, selectedTask, rounds, selectedRound, runs, activeRun, runItems, runItemCoverage = null, assets, assetCoverage = null, assetTotal = null, sharedAssets, selectedAssetIds, selectionBusyIds, deliveries, assetProvenance = null, onCloseAssetProvenance = null, onOpenAssetTrace = null, layoutRevision = 0, onNavigate, onPreviewAsset, onInspectAsset, onToggleAsset, onBatchSelectAssets, onSetAssetShared, onDownloadAsset, onCopyAsset, onCreateTask, onCreateRound, onOpenReference, onOpenDerive, onAddReference, onReject, onOpenConfirmation, onDeselectAsset, onCanvasAssetSelection, onSaveRecipe, pendingPlanEditRoundId = null, onPendingPlanEditHandled }) {
  tasks = listValue(tasks);
  rounds = listValue(rounds);
  runs = listValue(runs);
  runItems = listValue(runItems);
  assets = listValue(assets);
  sharedAssets = listValue(sharedAssets);
  deliveries = listValue(deliveries);
  selectedAssetIds = idSetValue(selectedAssetIds);
  selectionBusyIds = idSetValue(selectionBusyIds);
  const parsedAssetTotal = assetCoverage == null ? (assetTotal == null ? assets.length : Number(assetTotal)) : Number(assetCoverage.total);
  const parsedAssetLoaded = assetCoverage == null ? assets.length : Number(assetCoverage.loaded);
  const lineageAssetsLoaded = Number.isFinite(parsedAssetLoaded) ? Math.max(assets.length, parsedAssetLoaded) : assets.length;
  const lineageAssetTotal = Number.isFinite(parsedAssetTotal) ? Math.max(lineageAssetsLoaded, parsedAssetTotal) : lineageAssetsLoaded;
  const lineageAssetLoading = assetCoverage?.loading === true;
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
  // A7c（方案 7.3）：表里只存**用户动过**的节点。没记录 = 自动布局算的。
  // 这个集合就是「哪些算用户动过」的唯一判据：拖拽 / 键盘微调 / 折叠 / 分组 / 显式套用整理模板。
  const explicitKeysRef = useRef(new Set());
  const viewportRef = useRef(DEFAULT_VIEWPORT);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const graphNodesRef = useRef([]);
  const groupsRef = useRef([]);
  const linksRef = useRef([]);
  const savedLayoutNodesRef = useRef([]);
  const layoutReadyRef = useRef(false);
  const assetCoverageRef = useRef({ loaded: 0, total: 0 });
  const mountedRef = useRef(false);
  const saveTargetRef = useRef({ projectId: null });
  const [tool, setTool] = useState('select');
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 560 });
  const [positions, setPositions] = useState({});
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [layoutReady, setLayoutReady] = useState(false);
  const [saveState, setSaveState] = useState({ status: 'idle', message: SAVE_STATUS_LABELS.idle });
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const [selectionBox, setSelectionBox] = useState(null);
  const [groups, setGroups] = useState([]);
  const [manualLinks, setManualLinks] = useState([]);
  const [editing, setEditing] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [nodeSearchQuery, setNodeSearchQuery] = useState('');
  const [nodeSearchIndex, setNodeSearchIndex] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);

  // 画布一项目一份（方案 7.4）：保存不再带 scope。`scope` 仍供导出与文本视图描述来源。
  const scope = selectedRound ? { type: 'round', id: selectedRound.id } : selectedTask ? { type: 'task', id: selectedTask.id } : { type: 'project', id: project?.id || '' };
  saveTargetRef.current = { projectId: project?.id || null };
  const graph = useMemo(() => buildGraph({ tasks, selectedTask, rounds, selectedRound, runs, activeRun, runItems, assets, selectedAssetIds, sharedAssetIds: new Set(sharedAssets.map((asset) => asset.id)), deliveries }), [project, tasks, selectedTask, rounds, selectedRound, runs, activeRun, runItems, assets, sharedAssets, selectedAssetIds, deliveries]);
  const nodes = useMemo(() => applySavedLayout(graph.nodes, positions), [graph.nodes, positions]);
  const nodeByKey = useMemo(() => new Map(nodes.map((node) => [node.key, node])), [nodes]);
  const collapsedGroupIds = useMemo(() => new Set(groups.filter((group) => group.metadata?.collapsed).map((group) => group.id)), [groups]);
  const renderedGroups = useMemo(() => groups.map((group) => {
    const rendered = groupMemberBounds(group, nodes);
    return { ...rendered, key: nodeKey('group', rendered.id), entityType: 'group', entityId: rendered.id };
  }), [groups, nodes]);
  // 展开的批次：折叠状态存在 positions 里（复用既有的 collapsed 字段），key 形如 `round:<id>`。
  const expandedRoundIds = useMemo(() => new Set(Object.entries(positions).filter(([key, value]) => key.startsWith('round:') && value.collapsed === false).map(([key]) => key.slice('round:'.length))), [positions]);
  const filteredNodes = useMemo(() => nodes.filter((node) => !collapsedGroupIds.has(node.groupId) && visibleByMode(node, settings.mode || 'map', expandedRoundIds) && visibleByFilter(node, settings.filter, selectedKeys)), [nodes, collapsedGroupIds, selectedKeys, settings.filter, settings.mode, positions, expandedRoundIds]);
  const selectedNodes = useMemo(() => nodes.filter((node) => selectedKeys.has(node.key)), [nodes, selectedKeys]);
  const selectedAssetNodes = selectedNodes.filter((node) => isAssetNode(node));
  // G1：画布圈选要成为「说一句」的指代。这里只把选中的**图 id** 往上报，
  // 组合与去重交给纯模型（`requestContextAssetIds`），画布不持久化任何选中态。
  const selectedCanvasAssetIds = useMemo(() => nodes.filter((node) => selectedKeys.has(node.key) && isAssetNode(node)).map((node) => node.entity.id).filter(Boolean), [nodes, selectedKeys]);
  useEffect(() => { onCanvasAssetSelection?.(selectedCanvasAssetIds); }, [onCanvasAssetSelection, selectedCanvasAssetIds]);
  const primaryNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  // 「质量跟着看的东西走」（方案 7.10.2）：选中批次时，检查器直接给这一批的评审分布。
  // 项目级指标留在 project-overview（能力只加强不删）——这里是加，不是搬走。
  const inspectorBatchQuality = useMemo(() => {
    const round = primaryNode?.entityType === 'round' ? primaryNode.entity : null;
    if (!round?.id) return '';
    const roundAssets = (Array.isArray(assets) ? assets : []).filter((asset) => asset?.id && assetSourceRoundId(asset) === round.id);
    return batchQualityCopy(reviewDistribution(roundAssets), roundAssets.length);
  }, [primaryNode, assets]);
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
  const viewportBounds = useMemo(() => lineageViewportBounds(viewport, canvasSize), [viewport.x, viewport.y, viewport.k, canvasSize.width, canvasSize.height]);
  const renderableNodes = useMemo(() => {
    const byKey = new Map(filteredNodes.map((node) => [node.key, node]));
    for (const node of [...selectedNodes, ...nodeSearchResults]) {
      if (!collapsedGroupIds.has(node.groupId)) byKey.set(node.key, node);
    }
    return [...byKey.values()];
  }, [collapsedGroupIds, filteredNodes, nodeSearchResults, selectedNodes]);
  const canvasElements = useMemo(() => [
    ...renderedGroups.map((group) => ({ ...group, __lineageElementType: 'group' })),
    ...renderableNodes
  ], [renderableNodes, renderedGroups]);
  const renderedCanvasModel = useMemo(() => virtualizeLineageNodes(canvasElements, { viewportBounds, selectedKeys, searchMatchKeys: nodeSearchMatchKeys, limit: LINEAGE_NODE_RENDER_LIMIT }), [canvasElements, nodeSearchMatchKeys, selectedKeys, viewportBounds]);
  const renderedNodes = useMemo(() => renderedCanvasModel.nodes.filter((item) => item.__lineageElementType !== 'group'), [renderedCanvasModel.nodes]);
  const renderedCanvasGroups = useMemo(() => renderedCanvasModel.nodes.filter((item) => item.__lineageElementType === 'group'), [renderedCanvasModel.nodes]);
  const renderedNodeKeys = useMemo(() => new Set(renderedNodes.map((node) => node.key)), [renderedNodes]);
  const renderedGroupKeys = useMemo(() => new Set(renderedCanvasGroups.map((group) => group.key)), [renderedCanvasGroups]);
  const allConnections = useMemo(() => [...graph.connections, ...validManualLinks.map(manualConnection)], [graph.connections, validManualLinks]);
  const visibleConnections = useMemo(() => allConnections.filter((connection) => (renderedNodeKeys.has(connection.from) || renderedGroupKeys.has(connection.from)) && (renderedNodeKeys.has(connection.to) || renderedGroupKeys.has(connection.to))), [allConnections, renderedGroupKeys, renderedNodeKeys]);

  const culledCount = Math.max(0, renderableNodes.length - renderedNodes.length);

  const captureSnapshot = useCallback(() => currentLayoutSnapshot({ positions: positionsRef.current, viewport: viewportRef.current, settings: settingsRef.current, groups: groupsRef.current, manualLinks: linksRef.current, explicitKeys: explicitKeysRef.current }), []);
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
  useEffect(() => { layoutReadyRef.current = layoutReady; }, [layoutReady]);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => { assetCoverageRef.current = { loaded: lineageAssetsLoaded, total: Math.max(lineageAssetsLoaded, lineageAssetTotal) }; }, [lineageAssetsLoaded, lineageAssetTotal]);

  const submitLayoutSave = useCallback((targetProjectId = project?.id, permitSave = layoutReadyRef.current, updateState = true) => {
    if (!permitSave || !targetProjectId) return;
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    const canApplyState = () => updateState && mountedRef.current && saveRequestRef.current === requestId && saveTargetRef.current.projectId === targetProjectId;
    if (canApplyState()) setSaveState({ status: 'saving', message: SAVE_STATUS_LABELS.saving });
    const currentPositions = positionsRef.current;
    // 只有会出现在创作叙述里的三类节点（任务 / 批次 / 图）才落库；数据库的
    // CHECK 也会拒绝其它类型（方案 7.5：让 schema 自己挡住违规）。
    // A7c（方案 7.3）：表里只存用户动过的节点。没记录 = 自动布局算的；「自动整理」的结果也算显式（见 autoArrange）。
    const persistableNodes = graphNodesRef.current.filter((node) => PERSISTED_NODE_TYPES.has(node.entityType) && explicitKeysRef.current.has(node.key));
    const graphNodeKeys = new Set(graphNodesRef.current.map((node) => node.key));
    const currentPayloadNodes = persistableNodes.map((node) => ({ entityType: node.entityType, entityId: node.entityId, x: currentPositions[node.key]?.x ?? node.x, y: currentPositions[node.key]?.y ?? node.y, width: currentPositions[node.key]?.width ?? node.width, height: currentPositions[node.key]?.height ?? node.height, collapsed: currentPositions[node.key]?.collapsed === true, groupId: currentPositions[node.key]?.groupId || null }));
    const assetCoverage = assetCoverageRef.current;
    const preservedAssetNodes = assetCoverage.total > assetCoverage.loaded ? savedLayoutNodesRef.current.filter((node) => node.entityType === 'asset' && !graphNodeKeys.has(nodeKey(node.entityType, node.entityId))).map((node) => ({ entityType: node.entityType, entityId: node.entityId, x: node.x, y: node.y, width: node.width, height: node.height, collapsed: node.collapsed === true, groupId: node.groupId || null })) : [];
    const payloadNodes = [...currentPayloadNodes, ...preservedAssetNodes];
    const payloadNodeKeys = new Set(payloadNodes.map((node) => nodeKey(node.entityType, node.entityId)));
    const payloadGroupNodes = payloadNodes.map((node) => ({ key: nodeKey(node.entityType, node.entityId), ...node }));
    const payloadGroups = groupsRef.current.map((group) => serializeGroup(group, payloadGroupNodes));
    const payloadEndpointKeys = new Set([...payloadNodeKeys, ...payloadGroups.map((group) => nodeKey('group', group.id))]);
    const payloadLinks = linksRef.current.filter((link) => payloadEndpointKeys.has(nodeKey(link.sourceType, link.sourceId)) && payloadEndpointKeys.has(nodeKey(link.targetType, link.targetId)));
    void request('/api/projects/' + encodeURIComponent(targetProjectId) + '/canvas-layout', { method: 'POST', idempotencyKey: 'lineage-layout-' + targetProjectId + '-' + Date.now(), body: { viewport: viewportRef.current, settings: settingsRef.current, nodes: payloadNodes, groups: payloadGroups, links: payloadLinks } })
      .then(() => { if (canApplyState()) { setSaveState({ status: 'saved', message: SAVE_STATUS_LABELS.saved }); } })
      .catch((error) => { if (canApplyState()) { const message = error.message || '无法保存创作谱系布局。'; setSaveState({ status: 'error', message }); } });
  }, [project?.id, request]);

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
    setSaveState({ status: 'loading', message: SAVE_STATUS_LABELS.loading });
    request('/api/projects/' + encodeURIComponent(project.id) + '/canvas-layout')
      .then((data) => {
        if (cancelled) return;
        const layout = data.layout || {};
        const layoutNodes = Array.isArray(layout.nodes) ? layout.nodes : [];
        savedLayoutNodesRef.current = layoutNodes;
        // ① 自动布局：在画布上的每个节点先按公式各就各位。
        const nextPositions = Object.fromEntries(graphNodesRef.current.map((node) => [node.key, { x: node.x, y: node.y, width: node.width, height: node.height, collapsed: defaultCollapsedFor(node), groupId: null }]));
        // ② 覆盖：库里记着的就是用户动过的（A7c），没记录的一律保持自动布局。
        for (const item of layoutNodes) {
          const key = nodeKey(item.entityType, item.entityId);
          nextPositions[key] = { x: item.x, y: item.y, width: item.width, height: item.height, collapsed: item.collapsed === true, groupId: item.groupId || null };
        }
        // ③ 库里有的就是「人动过」的——保存时据此筛选。
        explicitKeysRef.current = new Set(layoutNodes.map((item) => nodeKey(item.entityType, item.entityId)));
        const nextGroups = Array.isArray(layout.groups) ? layout.groups.map((group) => ({ ...group, metadata: group.metadata || {} })) : [];
        // 系统引用线是后端按 parent_round_id 派生并落库的投影，画布的谱系边已经画了它；
        // 这里只取用户手动连线，避免同一条关系被画两次（A8 投影式收口）。
        const nextLinks = Array.isArray(layout.links) ? layout.links.filter((link) => !(link.metadata && link.metadata.system)).map((link) => ({ ...link, label: link.label || relationLabel(link.linkType), metadata: link.metadata || {} })) : [];
        const nextViewport = normalizeViewport(layout.viewport);
        const nextSettings = { ...DEFAULT_SETTINGS, ...(layout.settings || {}) };
        positionsRef.current = nextPositions;
        viewportRef.current = nextViewport;
        settingsRef.current = nextSettings;
        groupsRef.current = nextGroups;
        linksRef.current = nextLinks;
        setPositions(nextPositions);
        setViewport(nextViewport);
        setSettings(nextSettings);
        setGroups(nextGroups);
        setManualLinks(nextLinks);
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
        savedLayoutNodesRef.current = [];
        explicitKeysRef.current = new Set();
        setPositions({});
        setViewport(DEFAULT_VIEWPORT);
        setSettings(DEFAULT_SETTINGS);
        setGroups([]);
        setManualLinks([]);
        resetHistory();
        setSaveState({ status: 'error', message });
        setLayoutReady(true);
      });
    return () => {
      cancelled = true;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        submitLayoutSave(project.id, layoutReadyRef.current, false);
      }
      if (wheelHistoryTimerRef.current) window.clearTimeout(wheelHistoryTimerRef.current);
    };
  }, [project?.id, layoutRevision, request, resetHistory, submitLayoutSave]);

  useEffect(() => {
    setPositions((current) => {
      let changed = false;
      const next = { ...current };
      // 已占位的矩形（含用户挪过的位置）。**首次铺布局时它是空的**——那时所有节点都用自带坐标，
      // 精心排好的列布局不会被避让逻辑打乱；只有「增量插入」才避让。
      const occupied = Object.values(next).filter((rect) => rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height));
      const incremental = occupied.length > 0;
      for (const node of /** @type {any[]} */ (graph.nodes)) {
        if (next[node.key]) continue;
        const slot = incremental ? findFreeSlot(node, occupied) : { x: node.x, y: node.y };
        next[node.key] = { x: slot.x, y: slot.y, width: node.width, height: node.height, collapsed: defaultCollapsedFor(node), groupId: null };
        occupied.push(next[node.key]);
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
      submitLayoutSave(project.id, true);
    }, 650);
  }, [layoutReady, project?.id, submitLayoutSave]);

  const replaceLayoutState = useCallback((patch, dirty = true, record = true) => {
    if (dirty && record) recordHistory();
    if (hasOwn(patch, 'positions')) { positionsRef.current = patch.positions; setPositions(patch.positions); }
    if (hasOwn(patch, 'viewport')) { const normalized = normalizeViewport(patch.viewport); viewportRef.current = normalized; setViewport(normalized); }
    if (hasOwn(patch, 'settings')) { settingsRef.current = patch.settings; setSettings(patch.settings); }
    if (hasOwn(patch, 'groups')) { groupsRef.current = patch.groups; setGroups(patch.groups); }
    if (hasOwn(patch, 'explicitKeys')) explicitKeysRef.current = new Set(patch.explicitKeys || []);
    if (hasOwn(patch, 'manualLinks')) { linksRef.current = patch.manualLinks; setManualLinks(patch.manualLinks); }
    if (dirty) persistLayout();
  }, [persistLayout, recordHistory]);
  /** 记下「这些节点的位置/状态是人定的」——保存时只落这些（A7c / 方案 7.3）。 */
  const markExplicit = useCallback((keys) => {
    let changed = false;
    for (const key of keys || []) if (key && !explicitKeysRef.current.has(key)) { explicitKeysRef.current.add(key); changed = true; }
    return changed;
  }, []);
  const updatePositions = useCallback((updater, dirty = true, record = true) => replaceLayoutState({ positions: typeof updater === 'function' ? updater(positionsRef.current) : updater }, dirty, record), [replaceLayoutState]);
  const updateViewport = useCallback((next, dirty = true, record = true) => replaceLayoutState({ viewport: next }, dirty, record), [replaceLayoutState]);
  const updateSettings = useCallback((patch, record = true) => replaceLayoutState({ settings: { ...settingsRef.current, ...patch } }, true, record), [replaceLayoutState]);
  const updateGroups = useCallback((updater, dirty = true, record = true) => replaceLayoutState({ groups: typeof updater === 'function' ? updater(groupsRef.current) : updater }, dirty, record), [replaceLayoutState]);
  const updateManualLinks = useCallback((updater, dirty = true, record = true) => replaceLayoutState({ manualLinks: typeof updater === 'function' ? updater(linksRef.current) : updater }, dirty, record), [replaceLayoutState]);
  const applyLayoutSnapshot = useCallback((snapshot) => replaceLayoutState(snapshot, true, false), [replaceLayoutState]);
  /** 切换一个批次的折叠（双击批次节点）。状态写在 positions 的 `collapsed` 上、与布局一起持久化——
   *  所以刷新或换标签页之后收起状态还在，不是前端影子状态（红线：唯一事实依据）。 */
  /** 改计划：只改「提示词」与「数量」，其余字段由 applyPlanEdit 原样带回。
   *  写计划带 expectedVersion —— 旧确认会因版本对不上自动失效（方案 4.5 的证据链）。 */
  const [planEdit, setPlanEdit] = useState(null);
  const [planEditBusy, setPlanEditBusy] = useState(false);
  const [planEditError, setPlanEditError] = useState('');
  const [planEditNotice, setPlanEditNotice] = useState('');
  const openPlanEdit = useCallback((node) => {
    setPlanEditError('');
    setPlanEditNotice('');
    setPlanEdit({ node, form: planEditForm(node?.entity?.plan) });
  }, []);
  // 4.1 Q1：队列卡片上的「改一下」把「要打开哪一批的计划编辑」交过来。
  // 画布这边拿到**对应节点**（可能在收起的组里，但节点本身在）就打开编辑器，然后销掉待办。
  useEffect(() => {
    if (!pendingPlanEditRoundId || planEdit) return;
    const node = nodes.find((item) => item.entityType === 'round' && item.entity?.id === pendingPlanEditRoundId);
    if (!node) return;
    openPlanEdit(node);
    onPendingPlanEditHandled?.();
  }, [pendingPlanEditRoundId, nodes, planEdit, openPlanEdit, onPendingPlanEditHandled]);
  const savePlanEdit = useCallback(async () => {
    const round = planEdit?.node?.entity;
    if (!round?.id) return;
    const issues = planEditIssues(planEdit.form);
    if (issues.length) { setPlanEditError(issues.join(' ')); return; }
    setPlanEditBusy(true);
    setPlanEditError('');
    try {
      await request('/api/rounds/' + encodeURIComponent(round.id) + '/plan', {
        method: 'POST',
        idempotencyKey: 'plan-edit-' + round.id + '-' + round.version,
        body: { expectedVersion: round.version, plan: applyPlanEdit(round.plan, planEdit.form) }
      });
      setPlanEdit(null);
      // 方案 4.5：改完必须明确提示——否则会出现「改完以为确认过了」或「确认后改了却以为仍是确认态」两种误会。
      setPlanEditNotice('计划已更新，请重新确认。');
    } catch (error) {
      setPlanEditError(error?.message || '计划没保存上，请重试。');
    } finally {
      setPlanEditBusy(false);
    }
  }, [planEdit, request]);

  const toggleNodeCollapsed = useCallback((node) => {
    if (!node?.collapsible) return;
    // 折叠也是人做的决定，必须随布局落库（否则「存了却没人改」的老问题会以另一种形式回来）。
    markExplicit([node.key]);
    const current = positionsRef.current[node.key] || { x: node.x, y: node.y, width: node.width, height: node.height };
    replaceLayoutState({ positions: { ...positionsRef.current, [node.key]: { ...current, collapsed: current.collapsed !== true } } });
  }, [markExplicit, replaceLayoutState]);
  /** 菜单的上下文：哪些动作此刻可用。判据都是「此刻真的做得了吗」，不做推测。 */
  const nodeMenuContext = useCallback((node) => ({
    // 「去确认计划」只对等着确认的批次有意义。
    canReview: node?.entityType === 'round' && node?.entity?.status === 'awaiting_confirmation',
    // 「拿出去」要有项目才能落到某次交付里。**图上的交付由菜单模型按「已选定」把关**
    // （`lineage-menu-model` 只在 `node.selectedAsset` 分支给 `deliver`），批次仍可整体去交付——
    // 这里是既有能力，红线 2.4：只加强不删。
    canDeliver: Boolean(project?.id),
    // 草稿也能改计划（改后照样走确认）；有了出图记录才谈得上生成历史。
    canEditPlan: node?.entityType === 'round' && ['draft', 'awaiting_confirmation'].includes(node?.entity?.status),
    canHistory: node?.entityType === 'round' && !['draft', 'awaiting_confirmation'].includes(node?.entity?.status),
    // 「照它再来」＝本地建草稿（决策 D1，方案 4.3：复制出来是草稿，不是执行命令）。
    canDerive: deriveAvailability(node).available,
    collapsed: positionsRef.current[node?.key]?.collapsed === true
  }), [project?.id]);
  /** 菜单项 → 动作。全走画布已有的回调，不新增能力、不绕过既有流程。 */
  const runNodeMenuItem = useCallback((itemId, node) => {
    if (!node || !itemId) return;
    const entity = node.entity;
    if (itemId === 'toggle') return toggleNodeCollapsed(node);
    if (itemId === 'open' || itemId === 'detail') return openNode(node, { onNavigate, onInspectAsset });
    // 「去交付」＝跳到交付页处理（交付的创建在交付页内完成，产品没有「自动送入」流程）。
    // 文案与选片工具条统一；导航带上图/批次的任务上下文，交付页创建时才有落点。
    if (itemId === 'deliver' || itemId === 'open-delivery') {
      const deliverTaskId = entity?.taskId || assetSourceTaskId(entity) || null;
      return onNavigate({ view: 'deliveries', projectId: project?.id || null, taskId: deliverTaskId, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
    }
    if (itemId === 'confirm') return onNavigate({ view: 'prompts', taskId: entity?.taskId || null, roundId: entity?.id || null, compareRoundIds: entity?.id ? [entity.id] : [], runId: null, assetScope: 'round' });
    // 「选为成果」带 keep 评审（markAsDeliverable）；「移出成果」**显式传方向**——
    // markAsDeliverable 靠 selectedAssetIdsRef 反推意图，选区写入异步时 ref 会滞后，
    // 菜单明明知道状态，就不该让方向靠推断（2026-09-17 刀哥实机：移出永远无效）。
    if (itemId === 'keep') return void onToggleAsset(entity);
    if (itemId === 'unkeep') return void onDeselectAsset(entity.id);
    if (itemId === 'reject') return onReject([entity], { createNextRound: false });
    if (itemId === 'download') return onDownloadAsset(entity);
    if (itemId === 'new-round') return onCreateRound();
    // 「照它再来」走**本地草稿**（D1）：图节点用那张图；批次节点用它出的那些图。
    // 只把来源图交给既有 `openDerivedRoundDialog`，不新增能力、不绕过确认闸门。
    if (itemId === 'derive') {
      const sourceAssets = node.entityType === 'asset'
        ? [entity]
        : nodes.filter((item) => isAssetNode(item) && item.roundId === entity?.id).map((item) => item.entity).filter(Boolean);
      if (!sourceAssets.length) return;
      return onOpenDerive?.(sourceAssets, 'variation', 'derive');
    }
    if (itemId === 'preview') return onPreviewAsset(entity);
    if (itemId === 'edit-plan') return openPlanEdit(node);
    if (itemId === 'history') return onNavigate({ view: 'runs', taskId: entity?.taskId || null, roundId: entity?.id || null, compareRoundIds: entity?.id ? [entity.id] : [], runId: null, assetScope: 'round' });
    if (itemId === 'copy-plan') return void navigator.clipboard?.writeText('请基于 Workbench 创作谱系中的节点生成计划草稿；先不要真的出图，给我审阅确认。').catch(() => setSaveState({ status: 'error', message: '无法复制计划信息，请在会话里手动引用这个节点。' }));
  }, [toggleNodeCollapsed, onNavigate, project?.id, onInspectAsset, onToggleAsset, onReject, onDownloadAsset, onCreateRound, onCreateTask, openPlanEdit, onPreviewAsset, onOpenDerive, nodes]);

  const undoLayout = useCallback(() => {
    const previous = historyRef.current.undo.pop();
    if (!previous) return;
    historyRef.current.redo = [...historyRef.current.redo.slice(-(HISTORY_LIMIT - 1)), captureSnapshot()];
    syncHistoryCounts();
    applyLayoutSnapshot(previous);
    // 撤销/重做也可能改变「哪些算人动过」，所以要落库（A7c 之后这件事才需要显式做）。
    persistLayout();
  }, [applyLayoutSnapshot, captureSnapshot, persistLayout, syncHistoryCounts]);
  const redoLayout = useCallback(() => {
    const next = historyRef.current.redo.pop();
    if (!next) return;
    historyRef.current.undo = [...historyRef.current.undo.slice(-(HISTORY_LIMIT - 1)), captureSnapshot()];
    syncHistoryCounts();
    applyLayoutSnapshot(next);
    persistLayout();
  }, [applyLayoutSnapshot, captureSnapshot, persistLayout, syncHistoryCounts]);

  const snapCoordinate = useCallback((value) => settingsRef.current.snapGrid === false ? value : Math.round(value / SNAP_SIZE) * SNAP_SIZE, []);
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
  const selectAccessibleNode = useCallback((node) => {
    if (!node?.key) return;
    setSelectedKeys(new Set([node.key]));
  }, []);

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
        if (Math.abs(dx) + Math.abs(dy) > 2) {
          dragRef.current.moved = true;
          for (const item of dragRef.current.nodes) explicitKeysRef.current.add(item.key);
        }
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
  /**
   * G2：空白处双击就建任务（方案 4.3「空白双击新建」）。
   * 只认「真的点在空白」——双击节点是展开/打开，不能顺手又建一个。
   */
  const handleCanvasDoubleClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.lineage-node, .lineage-group, [data-lineage-no-zoom]')) return;
    if (!project?.id) return;
    onCreateTask?.();
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
    graph.nodes.forEach((node) => { next[node.key] = { x: node.x, y: node.y, width: node.width, height: node.height, collapsed: current[node.key]?.collapsed ?? defaultCollapsedFor(node), groupId: current[node.key]?.groupId || null }; });
    const nextViewport = viewportForItems(positionedItems(graph.nodes, next));
    // 「自动整理」是用户主动要的，所以它的结果**整体算显式布局**并落库（A7c 的裁定）；
    // 它不是「清空记录回到公式」——那会让用户点完整理、刷新后布局又变回去。
    markExplicit(graph.nodes.map((node) => node.key));
    replaceLayoutState({ positions: next, ...(nextViewport ? { viewport: nextViewport } : {}) });
  }, [graph.nodes, markExplicit, replaceLayoutState, viewportForItems]);
  const applyLayoutTemplate = useCallback((template) => {
    const laneX = template === 'selection' ? { task: 0, round: 280, asset: 1400 } : template === 'feedback' ? { asset: 300, round: 1430, task: 1700 } : { task: 0, round: 310, asset: 1490 };
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
    markExplicit(graph.nodes.map((node) => node.key));
    replaceLayoutState({ positions: next, ...(nextViewport ? { viewport: nextViewport } : {}) });
  }, [graph.nodes, markExplicit, replaceLayoutState, viewportForItems]);
  const nudgeSelected = useCallback((dx, dy) => { markExplicit(selectedKeys); updatePositions((current) => {
    const next = { ...current };
    selectedKeys.forEach((key) => { const node = nodeByKey.get(key); if (node) next[key] = { ...(next[key] || {}), x: snapCoordinate(node.x + dx), y: snapCoordinate(node.y + dy) }; });
    return next;
  }); }, [markExplicit, nodeByKey, selectedKeys, snapCoordinate, updatePositions]);

  const createGroup = useCallback(() => {
    if (selectedNodes.length < 2) return;
    const bounds = boundsForItems(selectedNodes);
    if (!bounds) return;
    const id = clientId('group');
    const title = groupTitle.trim() || '创作分组 ' + (groupsRef.current.length + 1);
    const group = { id, title, groupType: 'custom', x: bounds.x - 24, y: bounds.y - 54, width: bounds.width + 48, height: bounds.height + 78, metadata: { collapsed: false } };
    const nextPositions = { ...positionsRef.current };
    for (const node of selectedNodes) nextPositions[node.key] = { ...(nextPositions[node.key] || {}), x: node.x, y: node.y, width: node.width, height: node.height, groupId: id };
    markExplicit(selectedNodes.map((node) => node.key));
    setGroupTitle('');
    replaceLayoutState({ groups: [...groupsRef.current, group], positions: nextPositions });
  }, [groupTitle, markExplicit, replaceLayoutState, selectedNodes]);
  const toggleGroupCollapsed = useCallback((groupId) => updateGroups((current) => current.map((group) => group.id === groupId ? { ...group, metadata: { ...(group.metadata || {}), collapsed: !group.metadata?.collapsed } } : group)), [updateGroups]);
  const ungroup = useCallback((groupId) => {
    const affected = Object.entries(positionsRef.current).filter(([, value]) => value?.groupId === groupId).map(([key]) => key);
    const nextPositions = Object.fromEntries(Object.entries(positionsRef.current).map(([key, value]) => [key, value?.groupId === groupId ? { ...value, groupId: null } : value]));
    markExplicit(affected);
    replaceLayoutState({ groups: groupsRef.current.filter((group) => group.id !== groupId), positions: nextPositions });
  }, [markExplicit, replaceLayoutState]);
  const handleNodeDragStart = useCallback((event, node) => {
    if (!isAssetNode(node)) return;
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
    if (!canWriteTextClipboard()) { setSaveState({ status: 'error', message: '当前浏览器未提供剪贴板权限，请在会话中手动引用该节点。' }); return; }
    void navigator.clipboard.writeText(message).then(() => setSaveState({ status: 'saved', message: '已复制' })).catch(() => setSaveState({ status: 'error', message: '无法复制计划信息，请在会话里手动引用这个节点。' }));
  }, []);
  const copyContextForNodes = useCallback((mode = 'plan', sourceNodes = selectedNodes) => {
    const intro = mode === 'variation' ? '请基于这些谱系节点起草一个“变体”批次计划；先不要真的出图，给我审阅确认。' : mode === 'refinement' ? '请基于这些谱系节点起草一个“优化”批次计划；先不要真的出图，给我审阅确认。' : mode === 'reference' ? '请把这些素材/资料作为下一轮的参考起草计划；先不要真的出图，给我审阅确认。' : '请基于 Workbench 创作谱系中的节点生成计划草稿；先不要真的出图，给我审阅确认。';
    const message = [intro, '项目：' + (project?.name || '未选择'), selectedTask ? '任务：' + selectedTask.name : '', selectedRound ? '批次：' + (PURPOSE_LABELS[selectedRound.purpose] || selectedRound.purpose) + ' · v' + selectedRound.planVersion : '', ...sourceNodes.map(selectedNodeContextLine)].filter(Boolean).join('\n');
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
      setSaveState({ status: 'saved', message: '已导出隐去隐私的谱系摘要' });
    } catch (error) {
      setSaveState({ status: 'error', message: error?.message || '无法导出隐去隐私的谱系摘要。' });
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
  const assetCountLabel = lineageAssetLoading ? '正在加载 ' + lineageAssetsLoaded + ' / ' + lineageAssetTotal + ' 张资产' : lineageAssetsLoaded === lineageAssetTotal ? lineageAssetTotal + ' 张资产' : '已加载 ' + lineageAssetsLoaded + ' / ' + lineageAssetTotal + ' 张资产';
  const runItemCountLabel = lineageRunItemsLoaded === lineageRunItemTotal ? lineageRunItemTotal + ' 张出图' : '已加载 ' + lineageRunItemsLoaded + ' / ' + lineageRunItemTotal + ' 张出图';
  const searchListId = 'lineage-search-results';
  const activeSearchOptionId = activeNodeSearch ? 'lineage-search-option-' + nodeSearchIndex : undefined;

  // C5（第 7 批）：这四项从「常显横带」移进右栏顶部——信息一个不丢，常显面积减少（模型：aside-model.mjs）。
  const inspectorMetrics = asideMetrics({ graph, runs, statusText: (list) => statusCountText(runStatusCounts(list)) });
  // 模式切换从焦点条搬进工具条（C1）：名字与动作不变，只是换了家。
  const mode = settings.mode || 'map';
  const onMode = (value) => updateSettings({ mode: value }, false);
  const toolbarMode = CREATOR_MODES.find(([value]) => value === (settings.mode || 'map')) || CREATOR_MODES[0];
  return <section className={'lineage-stage ' + (editing ? 'is-editing' : 'is-browsing')} aria-label="创作谱系">
    {/* C1（第 7 批）：四条 chrome 收成这一条 48px——并打上 toolbar 标，让布局审计真的看得见它。 */}
    <header className="lineage-toolbar" data-region="toolbar" data-lineage-no-zoom>
      <details className="lineage-popover lineage-mode-menu" data-popover="mode">
        <summary title={editing ? '只调整画布呈现，不改项目事实。' : toolbarMode[2]}><strong>{editing ? '布局编辑' : toolbarMode[1]}</strong></summary>
        <div className="lineage-popover-body lineage-mode-list" role="radiogroup" aria-label="切换画布视角">
          {CREATOR_MODES.map(([value, label, description]) => <button type="button" key={value} className={mode === value ? 'is-active' : ''} aria-pressed={mode === value} title={description} onClick={() => onMode(value)}><strong>{label}</strong></button>)}
        </div>
      </details>
      <div className="lineage-actions">
        <button type="button" onClick={fitAll}><Search size={15} />适应全部</button>
        {selectedKeys.size > 0 && <button type="button" onClick={fitSelection}><ZoomIn size={15} />适应选择</button>}
        {/* D1：上下文条去重后，「新建批次」落在画布工具条（空白双击是第二条路，第 3 批 G2 已有）。 */}
        {selectedTask && <button type="button" className="lineage-new-round" onClick={onCreateRound}><Plus size={15} />新建批次</button>}
        <button type="button" className={editing ? 'is-active' : ''} onClick={() => setEditing((value) => { const next = !value; if (!next) setTool('select'); return next; })}><Move size={15} />{editing ? '退出编辑' : '编辑模式'}</button>
        {editing && <>
          <button type="button" className={tool === 'select' ? 'is-active' : ''} onClick={() => setTool('select')}><BoxSelect size={15} />选择</button>
          <button type="button" className={tool === 'pan' ? 'is-active' : ''} onClick={() => setTool('pan')}><Move size={15} />拖动画布</button>
          <button type="button" onClick={autoArrange}><Columns3 size={15} />自动整理</button>
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
      </div>
      <div className="lineage-toolbar-tail">
        <details className="lineage-popover lineage-filter-popover" data-popover="filter">
          <summary aria-label={'筛选：' + (FILTERS.find(([value]) => value === settings.filter) || FILTERS[0])[1]}><SlidersHorizontal size={14} />{(FILTERS.find(([value]) => value === settings.filter) || FILTERS[0])[1]}</summary>
          <div className="lineage-popover-body">
            <p className="eyebrow">筛选</p>
            <div className="lineage-choice-row">{FILTERS.map(([value, label]) => <button type="button" key={value} className={settings.filter === value ? 'is-active' : ''} onClick={() => updateSettings({ filter: value })}>{label}</button>)}</div>
            {editing && <><p className="eyebrow">背景</p><div className="lineage-choice-row">{BACKGROUNDS.map(([value, label]) => <button type="button" key={value} className={settings.background === value ? 'is-active' : ''} onClick={() => updateSettings({ background: value })}>{label}</button>)}</div></>}
          </div>
        </details>
        {/* C2：一长串 11px 统计收进浮层——数字一个不少，常显只剩下面那个保存指示点。 */}
        <details className="lineage-popover lineage-stats-popover" data-popover="stats">
          <summary><Gauge size={14} />统计</summary>
          <div className="lineage-popover-body lineage-stats">
            <dl><div><dt>资产</dt><dd>{assetCountLabel}</dd></div><div><dt>单张出图记录</dt><dd>{runItemCountLabel}</dd></div><div><dt>已选</dt><dd>{graph.metrics.selected}</dd></div><div><dt>异常</dt><dd>{graph.metrics.issues}</dd></div><div><dt>分组</dt><dd>{groups.length}</dd></div><div><dt>标注</dt><dd>{validManualLinks.length}</dd></div>{culledCount ? <div><dt>已虚拟化</dt><dd>{culledCount} 个节点</dd></div> : null}{renderedCanvasModel.limited ? <div><dt>活动窗口上限</dt><dd>{LINEAGE_NODE_RENDER_LIMIT} 个画布元素</dd></div> : null}{batchBusy ? <div><dt>批量选片</dt><dd>同步中</dd></div> : null}</dl>
          </div>
        </details>
        <div className="lineage-searchbar" data-lineage-no-zoom>
          <label className="lineage-search-input">
            <Search size={14} />
            <input value={nodeSearchQuery} onChange={(event) => { setNodeSearchQuery(event.target.value); setNodeSearchIndex(0); }} onKeyDown={handleNodeSearchKeyDown} placeholder="搜索节点名称、类型、ID、状态" aria-label="搜索谱系节点" role="combobox" aria-autocomplete="list" aria-expanded={Boolean(nodeSearchQuery && nodeSearchResults.length)} aria-controls={searchListId} aria-activedescendant={activeSearchOptionId} />
          </label>
          {nodeSearchQuery && <span className="lineage-search-hint">{nodeSearchResults.length ? nodeSearchResults.length + ' 个结果' : '无匹配节点'}</span>}
          {nodeSearchQuery && nodeSearchResults.length ? <div className="lineage-search-results" id={searchListId} role="listbox" aria-label="谱系节点搜索结果">{nodeSearchResults.map((node, index) => <button type="button" role="option" aria-selected={index === nodeSearchIndex} id={'lineage-search-option-' + index} key={node.key} className={index === nodeSearchIndex ? 'is-active' : ''} onClick={() => { setNodeSearchIndex(index); focusNode(node); }}><strong>{node.title}</strong><small>{nodeTypeLabel(node.entityType)} · {shortId(node.entityId)}</small></button>)}</div> : null}
        </div>
        <details className="lineage-popover lineage-more" data-popover="more">
          <summary aria-label="更多画布动作">更多</summary>
          <div className="lineage-popover-body">
            <button type="button" onClick={exportLineageSummary}><Download size={15} />导出摘要</button>
            <button type="button" className={outlineOpen ? 'is-active' : ''} aria-pressed={outlineOpen} aria-controls="lineage-accessible-view" aria-label={outlineOpen ? '收起列表文字谱系视图' : '打开列表文字谱系视图'} onClick={() => setOutlineOpen((value) => !value)}><BookOpen size={15} />{outlineOpen ? '收起文字谱系' : '文字谱系'}</button>
          </div>
        </details>
        {/* C2：保存态降为一个指示点；**失败仍有一行字**（aria-live），「变红点」不算通知到位。 */}
        <span className={'lineage-save-indicator is-' + saveState.status} data-save={saveState.status} role="status" aria-live="polite" title={saveState.message}>{saveState.status === 'error' ? <><Save size={13} aria-hidden="true" />{saveState.message}</> : <Save size={13} aria-label={saveState.message} />}</span>
      </div>
    </header>
    {outlineOpen && <LineageTextView id="lineage-accessible-view" nodes={nodes} connections={allConnections} endpointByKey={endpointByKey} selectedKeys={selectedKeys} scope={scope} coverage={{ assets: { loaded: lineageAssetsLoaded, total: lineageAssetTotal, loading: lineageAssetLoading || !layoutReady }, runItems: { loaded: lineageRunItemsLoaded, total: lineageRunItemTotal, loading: runItemCoverage?.loading === true || !layoutReady } }} onFocus={selectAccessibleNode} onOpen={(node) => openNode(node, { onNavigate, onInspectAsset })} />}
    <div className="lineage-shell">
      <div ref={canvasRef} tabIndex={0} className={'lineage-canvas bg-' + settings.background} onPointerDown={handleCanvasPointerDown} onDoubleClick={handleCanvasDoubleClick} onKeyDown={handleKeyDown} onContextMenu={(event) => openContextMenu(event)} onDragOver={(event) => { if (dataTransferHasType(event.dataTransfer, 'application/x-daoge-lineage-node')) event.preventDefault(); }} aria-label="创作谱系画布；拖拽图片到批次上可建立引用，可用方向键微调选中节点">
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
          {renderedCanvasGroups.map((group) => <LineageGroup key={group.id} group={group} memberCount={nodes.filter((node) => node.groupId === group.id).length} onToggle={toggleGroupCollapsed} onUngroup={ungroup} />)}
          {renderedNodes.map((node) => <LineageNode key={node.key} node={{ ...node, collapsed: positions[node.key]?.collapsed === true }} active={selectedKeys.has(node.key)} searchHit={nodeSearchMatchKeys.has(node.key)} searchActive={activeNodeSearch?.key === node.key} actions={selectedKeys.size === 1 && selectedKeys.has(node.key) ? nodeMenuItems(node, nodeMenuContext(node)).filter((item) => item.id !== 'detail') : EMPTY_ARRAY} onAction={(itemId) => runNodeMenuItem(itemId, node)} onPointerDown={handleNodePointerDown} onSelect={selectNode} onOpen={() => openNode(node, { onNavigate, onInspectAsset })} onToggleCollapsed={toggleNodeCollapsed} onContextMenu={openContextMenu} onDragStart={handleNodeDragStart} onDragOver={handleNodeDragOver} onDrop={handleNodeDrop} />)}
          {selectionBox && <div className="lineage-selection-box" style={{ left: Math.min(selectionBox.startX, selectionBox.currentX), top: Math.min(selectionBox.startY, selectionBox.currentY), width: Math.abs(selectionBox.currentX - selectionBox.startX), height: Math.abs(selectionBox.currentY - selectionBox.startY) }} />}
        </div>
        {planEditNotice && <p className="lineage-notice" role="status">{planEditNotice}</p>}
        {planEdit && <PlanEditDialog node={planEdit.node} form={planEdit.form} busy={planEditBusy} error={planEditError} onChange={(form) => setPlanEdit({ ...planEdit, form })} onSave={() => void savePlanEdit()} onDismiss={() => setPlanEdit(null)} />}
        {contextMenu && <LineageContextMenu editing={editing} menu={contextMenu} node={contextNode} nodeItems={contextNode ? nodeMenuItems(contextNode, nodeMenuContext(contextNode)) : EMPTY_ARRAY} onNodeItem={(itemId) => runNodeMenuItem(itemId, contextNode)} selectedCount={selectedNodes.length} canOpen={Boolean(contextNode)} canGroup={editing && selectedNodes.length > 1} onClose={() => setContextMenu(null)} onOpen={() => contextNode && openNode(contextNode, { onNavigate, onInspectAsset })} onFit={fitSelection} onGroup={createGroup} onCopy={() => copyContextForNodes('reference', contextNode ? [contextNode] : selectedNodes)} onExport={exportLineageSummary} onShortcuts={() => setShortcutsOpen(true)} />}
        {editing && settings.minimap && <LineageMinimap nodes={renderableNodes} boundsNodes={nodes} groups={renderedGroups} viewport={viewport} canvasSize={canvasSize} selectedKeys={selectedKeys} searchMatchKeys={nodeSearchMatchKeys} onViewportChange={updateViewport} />}
        {editing && shortcutsOpen && <ShortcutPanel onClose={() => setShortcutsOpen(false)} />}
      </div>
      <LineageInspector onEditPlan={openPlanEdit} runs={runs} metrics={inspectorMetrics} assetProvenance={assetProvenance} onCloseAssetProvenance={onCloseAssetProvenance} onOpenAssetTrace={onOpenAssetTrace} batchQuality={inspectorBatchQuality} tasks={tasks} editing={editing} node={primaryNode} selectedNodes={selectedNodes} selectedAssetNodes={selectedAssetNodes} selectedTask={selectedTask} selectedRound={selectedRound} batchBusy={batchBusy} groupTitle={groupTitle} nodeLinks={primaryLinks} onGroupTitleChange={setGroupTitle} onCreateGroup={createGroup} onCreateLink={createManualLink} onRemoveLink={removeManualLink} onUpdateLink={updateManualLink} onReverseLink={reverseManualLink} onClear={() => setSelectedKeys(new Set())} onNavigate={onNavigate} onPreviewAsset={onPreviewAsset} onInspectAsset={onInspectAsset} onToggleAsset={onToggleAsset} onBatchSelectAssets={onBatchSelectAssets} onSetAssetShared={onSetAssetShared} onDownloadAsset={onDownloadAsset} onCopyAsset={onCopyAsset} onCopyContext={copyContextForNodes} onCreateRound={onCreateRound} onOpenReference={onOpenReference} onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenConfirmation={onOpenConfirmation} onSaveRecipe={onSaveRecipe} />
    </div>
  </section>;
}

/**
 * 检查器里的「生成历史」页签（B4）：**就地**看这一批的运行，不再跳页。
 * 仍保留「打开完整生成历史」——那是能力，不是入口重复（完整视图有分页/筛选/详情）。
 */

