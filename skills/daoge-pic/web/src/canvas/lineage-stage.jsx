import { assetThumbnailUrl } from '../asset-media-url.mjs';
import { DEFAULT_VIEWPORT, EMPTY_ARRAY, EMPTY_SET, assetBadges, isAssetNode, mediaUnavailable, nodeTypeLabel, shortId, text } from '../canvas/lineage-shared.mjs';
import { createAccessibleLineage } from '../lineage-accessible-model.mjs';
import { MINIMAP_HEIGHT, MINIMAP_WIDTH, clampWorldPoint, createMinimapGeometry, createMinimapItems, minimapToWorld, viewportRectForMinimap, worldToMinimap } from '../lineage-minimap-model.mjs';
import { LINEAGE_NODE_RENDER_LIMIT } from '../lineage-viewport-model.mjs';
import { SHORTCUT_ROWS } from '../shortcut-model.mjs';
import { statusPresentation } from '../status-presentation.mjs';
import { BookOpen, BoxSelect, Copy, Download, Eye, GitFork, Image, Sparkles, X, ZoomIn } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** 界面批 E（E2）从 creative-lineage-canvas.jsx 搬出（行为零变化）。 */

export function LineageTextView({ id = 'lineage-accessible-view', nodes = EMPTY_ARRAY, connections = EMPTY_ARRAY, endpointByKey = new Map(), selectedKeys = EMPTY_SET, scope = null, coverage = {}, onFocus, onOpen }) {
  const outline = useMemo(() => createAccessibleLineage({ nodes, connections, endpointByKey, scope, coverage }), [connections, coverage, endpointByKey, nodes, scope]);
  const nodeByKey = useMemo(() => new Map(nodes.map((node) => [node.key, node])), [nodes]);
  const titleId = id + '-title';
  const coverageId = id + '-coverage';
  const nodeHeadingId = id + '-nodes';
  const relationHeadingId = id + '-relations';
  return <section id={id} className="lineage-text-view" data-lineage-no-zoom aria-labelledby={titleId}>
    <header className="lineage-text-head"><div><p className="eyebrow">非视觉入口</p><h2 id={titleId}>列表 / 文本谱系</h2><span>按当前已加载的谱系数据阅读项目、任务、批次、计划、出图、单张出图、资产和交付；不会把画布虚拟化窗口冒充为完整谱系。</span></div><div className="lineage-text-count"><strong>{outline.nodes.length} 个已加载节点 · {outline.connections.length} 条关系</strong><span>{outline.scope.label} · {outline.scope.shortId}</span></div></header>
    <section className="lineage-text-coverage" aria-labelledby={coverageId}>
      <div className="lineage-text-coverage-head"><h3 id={coverageId}>加载覆盖范围</h3><strong>{outline.coverage.complete ? '当前加载范围已覆盖' : '当前为局部加载'}</strong></div>
      <dl>{outline.coverage.rows.map((row) => <div key={row.id}><dt>{row.label}</dt><dd><strong>{row.loaded} / {row.total}</strong><span>{row.complete ? '已加载' : '仍有未加载'}</span></dd></div>)}</dl>
      <p role="note">{outline.coverage.message}</p><p>{outline.coverage.canvasNote}</p>
    </section>
    <div className="lineage-text-columns">
      <section aria-labelledby={nodeHeadingId}><h3 id={nodeHeadingId}>节点（当前已加载）</h3>{outline.nodes.length ? <ol className="lineage-text-node-list">{outline.nodes.map((summary) => { const node = nodeByKey.get(summary.key); const selected = selectedKeys.has(summary.key); const state = [summary.status.label, summary.shortId, summary.flags.unavailable ? '媒体不可用' : ''].filter(Boolean).join(' · '); return <li key={summary.key}><button type="button" className={selected ? 'is-active' : ''} aria-pressed={selected} aria-label={`${summary.typeLabel}：${summary.title}，${state}`} onClick={() => node && onFocus?.(node)}><span>{summary.typeLabel} · {summary.title}</span><small>{state}</small><em>{summary.summary}</em></button>{summary.openable && node ? <button type="button" className="lineage-text-open" aria-label={`打开${summary.typeLabel}：${summary.title}`} onClick={() => onOpen?.(node)}>打开</button> : <span className="lineage-text-unavailable">仅摘要</span>}</li>; })}</ol> : <p className="lineage-note">当前加载数据没有节点。</p>}</section>
      <section aria-labelledby={relationHeadingId}><h3 id={relationHeadingId}>关系（已加载的连线）</h3>{outline.connections.length ? <ol className="lineage-text-link-list">{outline.connections.map((connection) => <li key={connection.key}><span title={connection.source.title}>{connection.source.title}</span><b aria-hidden="true">→</b><span title={connection.target.title}>{connection.target.title}</span><small>{connection.label}{connection.unresolved ? ' · 连线未加载' : ''}</small></li>)}</ol> : <p className="lineage-note">当前加载数据没有关系。</p>}</section>
    </div>
  </section>;
}

export function LineageContextMenu({ editing, menu, node, selectedCount, canOpen, canGroup, nodeItems = EMPTY_ARRAY, onNodeItem, onClose, onOpen, onFit, onGroup, onCopy, onExport, onShortcuts }) {
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
  return <div ref={menuRef} className="lineage-context-menu" style={{ left: menu.x, top: menu.y }} data-lineage-no-zoom role="menu" aria-label="谱系节点操作" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
    <strong>{node ? node.title : selectedCount ? selectedCount + ' 个节点' : '画布'}</strong>
    {/* 「对它做什么」优先于「怎么看」（方案 4.4）：先给这个对象能做的动作，再给画布的通用工具。 */}
    {nodeItems.filter((item) => item.id !== 'detail').map((item) => <button type="button" role="menuitem" key={item.id} className={item.primary ? 'is-primary' : undefined} onClick={() => { onNodeItem(item.id); onClose(); }}>{item.label}</button>)}
    {canOpen && <button type="button" role="menuitem" onClick={() => { onOpen(); onClose(); }}><Eye size={14} />打开详情</button>}
    {selectedCount > 0 && <button type="button" role="menuitem" onClick={() => { onFit(); onClose(); }}><ZoomIn size={14} />适应选择</button>}
    {selectedCount > 0 && <button type="button" role="menuitem" onClick={() => { onCopy(); onClose(); }}><Copy size={14} />复制参考信息</button>}
    {editing && canGroup && <button type="button" role="menuitem" onClick={() => { onGroup(); onClose(); }}><BoxSelect size={14} />组成分组</button>}
    <button type="button" role="menuitem" onClick={() => { onExport(); onClose(); }}><Download size={14} />导出隐去隐私的摘要</button>
    <button type="button" role="menuitem" onClick={() => { onShortcuts(); onClose(); }}><BookOpen size={14} />查看快捷键</button>
  </div>;
}

export function LineageGroup({ group, memberCount, onToggle, onUngroup }) {
  const collapsed = group.metadata?.collapsed === true;
  return <section className={'lineage-group' + (collapsed ? ' is-collapsed' : '')} style={{ left: group.x, top: group.y, width: group.width, height: group.height }}>
    <header data-lineage-no-zoom><strong>{group.title}</strong><span>{memberCount} 个节点</span><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onToggle(group.id)}>{collapsed ? '展开' : '折叠'}</button><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => onUngroup(group.id)}>取消分组</button></header>
  </section>;
}

export function LineageNode({ node, active, searchHit, searchActive, actions = EMPTY_ARRAY, onAction, onPointerDown, onSelect, onOpen, onToggleCollapsed, onContextMenu, onDragStart, onDragOver, onDrop }) {
  const status = statusPresentation(node.entityType === 'round' ? 'round' : node.entityType === 'task' ? 'task' : 'generic', node.status);
  const isAsset = isAssetNode(node);
  const canReference = isAsset;
  const handleKeyDown = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); onOpen(); return; }
    if (event.key === ' ') { event.preventDefault(); onSelect(event, node); return; }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); onContextMenu(event, node); }
  };
  return <article role="button" tabIndex={0} aria-pressed={active} aria-label={nodeTypeLabel(node.entityType) + '：' + node.title} className={'lineage-node type-' + node.entityType + ' tone-' + (node.tone || node.entityType) + (active ? ' is-active' : '') + (searchHit ? ' is-search-hit' : '') + (searchActive ? ' is-search-active' : '') + (node.focused ? ' is-focused' : '') + (node.mediaUnavailable ? ' is-unavailable' : '')} style={{ left: node.x, top: node.y, width: node.width, height: node.height }} onPointerDown={(event) => onPointerDown(event, node)} onKeyDown={handleKeyDown} onDoubleClick={() => (node.collapsible ? onToggleCollapsed(node) : onOpen())} onContextMenu={(event) => onContextMenu(event, node)} onDragOver={(event) => onDragOver(event, node)} onDrop={(event) => onDrop(event, node)}>
    {active && actions.length > 0 && <div className="lineage-node-toolbar" data-lineage-no-zoom aria-label="对这个节点的操作">{actions.map((item) => <button type="button" key={item.id} className={item.primary ? 'is-primary' : undefined} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAction(item.id); }}>{item.label}</button>)}</div>}
    {canReference && <span className="lineage-reference-handle" draggable title="拖到批次或任务节点上，作为参考信息" aria-hidden="true" onPointerDown={(event) => event.stopPropagation()} onDragStart={(event) => onDragStart(event, node)}><GitFork size={12} /></span>}
    {isAsset ? <div className="lineage-thumb"><img src={assetThumbnailUrl(node.entity)} alt="" loading="lazy" decoding="async" />{assetBadges(node).map(([tone, label]) => <span key={tone + label} className={'badge-' + tone}>{label}</span>)}</div> : node.entityType === 'placeholder' ? <div className="lineage-thumb is-placeholder" role="status" aria-label="这张还在生成"><span>生成中</span></div> : <NodeIcon node={node} />}
    <div className="lineage-node-copy"><header><strong title={node.title}>{node.title}</strong><span className={'lineage-status ' + status.tone}>{status.label}</span></header><p title={node.subtitle}>{node.subtitle}</p>{node.collapsible && <p className="lineage-collapse-hint">{node.collapsed ? '双击展开这一批的图' : '双击收起'}</p>}{node.planDetail && <div className="lineage-plan-mini"><span>{node.planDetail.itemCount || 0} 项</span><span>{node.planDetail.referenceCount || 0} 参考</span><span>{node.planDetail.outputSummary}</span></div>}</div>
  </article>;
}

export function NodeIcon({ node }) {
  const props = { size: 22, strokeWidth: 1.7 };
  const Icon = node.entityType === 'task' ? Sparkles : node.entityType === 'round' ? GitFork : Image;
  return <div className="lineage-node-icon"><Icon {...props} /></div>;
}

export function LineageMinimap({ nodes, boundsNodes = nodes, groups = [], viewport, canvasSize, selectedKeys = EMPTY_SET, searchMatchKeys = EMPTY_SET, onViewportChange }) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const width = MINIMAP_WIDTH;
  const height = MINIMAP_HEIGHT;
  const geometry = useMemo(() => createMinimapGeometry([...boundsNodes, ...groups], width, height), [boundsNodes, groups, width, height]);
  const minimapItems = useMemo(() => createMinimapItems(nodes, geometry, { groups, selectedKeys, searchMatchKeys, limit: LINEAGE_NODE_RENDER_LIMIT }), [geometry, groups, nodes, searchMatchKeys, selectedKeys]);
  const viewportWidth = Math.max(1, Number.isFinite(canvasSize?.width) ? canvasSize.width : 900);
  const viewportHeight = Math.max(1, Number.isFinite(canvasSize?.height) ? canvasSize.height : 560);
  const updateViewportFromPointer = useCallback((event) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;
    const localX = Math.min(width, Math.max(0, (event.clientX - rect.left) * width / rect.width));
    const localY = Math.min(height, Math.max(0, (event.clientY - rect.top) * height / rect.height));
    const world = clampWorldPoint(geometry, minimapToWorld(geometry, localX, localY));
    onViewportChange({ x: viewportWidth / 2 - world.x * viewport.k, y: viewportHeight / 2 - world.y * viewport.k, k: viewport.k });
  }, [geometry, height, onViewportChange, viewport.k, viewportHeight, viewportWidth, width]);
  const handlePointerDown = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional for older browsers. */ }
    setDragging(true);
    updateViewportFromPointer(event);
  }, [updateViewportFromPointer]);
  const handlePointerMove = useCallback((event) => {
    if (!dragging) return;
    event.preventDefault();
    event.stopPropagation();
    updateViewportFromPointer(event);
  }, [dragging, updateViewportFromPointer]);
  const stopDragging = useCallback((event) => {
    event?.stopPropagation();
    try {
      if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch { /* Pointer capture is optional for older browsers. */ }
    setDragging(false);
  }, []);
  const viewportRect = viewportRectForMinimap(geometry, viewport, { width: viewportWidth, height: viewportHeight });
  return <div className={'lineage-minimap' + (dragging ? ' is-dragging' : ' is-idle')} data-lineage-no-zoom onPointerDown={(event) => event.stopPropagation()} onPointerUp={stopDragging} onPointerCancel={stopDragging}>
    <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} aria-label="画布缩略图，拖动以定位" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDragging} onPointerCancel={stopDragging}>
      {minimapItems.map((item) => {
        const p = worldToMinimap(geometry, item.x, item.y);
        const isGroup = item.kind === 'group';
        const isAggregate = item.kind === 'aggregate';
        const className = (isGroup ? 'group' : 'node') + (isAggregate ? ' aggregate' : '') + (item.searchHit ? ' search-hit' : '') + (item.selected ? ' selected' : '');
        const size = isGroup ? 3 : 2;
        return <rect key={item.key} className={className} x={p.x} y={p.y} width={Math.max(size, item.width * geometry.scale)} height={Math.max(size, item.height * geometry.scale)} rx="2" data-member-count={isAggregate ? item.memberCount : undefined} style={item.selected ? { stroke: '#2f6545', strokeWidth: 1.5, opacity: 0.95 } : undefined} />;
      })}
      <rect className="viewport" x={viewportRect.x} y={viewportRect.y} width={viewportRect.width} height={viewportRect.height} />
    </svg>
    <button type="button" onClick={() => onViewportChange(DEFAULT_VIEWPORT)}>重置视图</button>
  </div>;
}

export function ShortcutPanel({ onClose }) {
  const rows = SHORTCUT_ROWS;
  // 界面瑕疵专项 S20：面板从右键菜单打开时焦点留在 body，Esc 到不了画布的处理器——
  // 面板自己接住初始焦点（焦点在面板内时 keydown 会冒泡到画布容器，Esc 即「关闭最上层」）。
  const panelRef = useRef(null);
  useEffect(() => { panelRef.current?.focus(); }, []);
  return <aside ref={panelRef} tabIndex={-1} aria-label="画布快捷键" className="lineage-shortcut-panel" data-lineage-no-zoom><div><p className="eyebrow">快捷键</p><button type="button" className="icon-button" aria-label="关闭快捷键" onClick={onClose}><X size={14} /></button></div>{rows.map(([action, shortcut]) => <p key={action}><strong>{action}</strong><span>{shortcut}</span></p>)}</aside>;
}
