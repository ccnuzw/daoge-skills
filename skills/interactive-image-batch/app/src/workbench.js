const NAV_ITEMS = [
  { id: 'dashboard', label: '总览', desc: '生产状态与资产速览', icon: '⌂' },
  { id: 'runs', label: '任务', desc: '批次、阶段、成功失败', icon: '↻' },
  { id: 'assets', label: '资产', desc: '图库、筛选、选择', icon: '▧' },
  { id: 'issues', label: '问题', desc: '阻塞、复核、补跑', icon: '!' },
  { id: 'prompts', label: '提示词', desc: 'Prompt Lab', icon: '¶' },
  { id: 'compare', label: '对比', desc: '多图评审', icon: '⇄' },
  { id: 'exports', label: '导出', desc: '交付包与报告', icon: '⇩' },
];

const STATUS_LABELS = {
  all: '全部',
  ready: '就绪',
  ready_for_selection: '可筛选',
  needs_attention: '需处理',
  needs_review: '待复核',
  open: '未处理',
  resolved: '已处理',
  queued: '排队',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  selected: '已选择',
  rejected: '不采用',
};

const KIND_LABELS = {
  all: '全部',
  result: '结果图',
  reference: '参考图',
  input: '输入素材',
  export: '导出文件',
  issue: '问题记录',
  mask: '遮罩',
};

const DRAWER_TYPES_BY_PAGE = {
  dashboard: ['asset', 'run', 'issue', 'prompt', 'job', 'event'],
  runs: ['run', 'job', 'event'],
  assets: ['asset', 'job', 'event'],
  issues: ['issue', 'job', 'event'],
  prompts: ['prompt', 'job', 'event'],
  compare: ['asset', 'job', 'event'],
  exports: ['export', 'job', 'event'],
};

const state = {
  page: 'dashboard',
  query: '',
  status: 'all',
  kind: 'all',
  selectedFilter: 'all',
  density: 'comfortable',
  assetView: 'grid',
  runFilter: 'all',
  loading: true,
  project: null,
  health: null,
  runs: pageState(),
  assets: pageState(),
  issues: pageState(),
  events: pageState(),
  jobs: pageState(),
  prompts: pageState(),
  exports: [],
  exportsError: null,
  exportBusy: null,
  exportResult: null,
  drawer: { open: false, page: 'dashboard', type: 'overview', id: null, data: null, detail: null, mode: 'overview' },
  compareIds: [],
  compareAssetsById: {},
  bulkMode: false,
  bulkAssetIds: [],
  promptFocusId: null,
  expandedPrompt: false,
  copiedPromptId: null,
  sidebarOpen: false,
};

let drawerReturnFocus = null;
let drawerReturnFocusSelector = null;
let shouldFocusDrawerClose = false;

function pageState() {
  return { items: [], nextCursor: null, total: 0, loading: false, error: null };
}

const $ = (id) => document.getElementById(id);

function drawerTypesForPage(page = state.page) {
  return DRAWER_TYPES_BY_PAGE[page] || [];
}

function isDrawerAllowed(type, page = state.page) {
  return type === 'overview' || drawerTypesForPage(page).includes(type);
}

function resetDrawer(mode = 'overview') {
  state.drawer = { open: false, page: state.page, type: 'overview', id: null, data: null, detail: null, mode };
}

function setDrawer(type, id, data, detail = null) {
  if (!isDrawerAllowed(type, state.page)) {
    resetDrawer('context_reset');
    return;
  }
  state.drawer = { open: true, page: state.page, type, id, data, detail, mode: 'detail' };
  shouldFocusDrawerClose = true;
}

function openSummaryDrawer() {
  state.drawer = { open: true, page: state.page, type: 'overview', id: null, data: null, detail: null, mode: 'summary' };
  shouldFocusDrawerClose = true;
}

function closeDrawer() {
  state.drawer = { ...state.drawer, open: false };
  const target = drawerReturnFocus;
  const selector = drawerReturnFocusSelector;
  drawerReturnFocus = null;
  drawerReturnFocusSelector = null;
  render();
  const nextTarget = selector ? document.querySelector(selector) : null;
  const fallback = document.querySelector('[data-open-summary]') || $('refreshButton');
  if (canRestoreFocusToTarget(target)) {
    target.focus();
  } else if (nextTarget && typeof nextTarget.focus === 'function') {
    nextTarget.focus();
  } else if (fallback && typeof fallback.focus === 'function') {
    fallback.focus();
  }
}

function canRestoreFocusToTarget(target) {
  if (!target || typeof target.focus !== 'function') return false;
  if (target.isConnected === true) return true;
  return typeof document.contains === 'function' && document.contains(target);
}

function syncDrawerToPage() {
  const drawer = state.drawer;
  if (!drawer || drawer.page !== state.page || !isDrawerAllowed(drawer.type, state.page)) {
    resetDrawer('page_summary');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function qs(params) {
  const out = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '' && value !== 'all') out.set(key, value);
  });
  return out.toString();
}

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new Error(`请求失败 ${res.status}${text ? `：${text.slice(0, 140)}` : ''}`);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`请求失败 ${res.status}：响应不是有效 JSON`);
  }
  if (!res.ok || !data.ok) throw new Error(data.error?.message || `请求失败 ${res.status}`);
  return data.data;
}

async function loadPaged(name, path, params = {}, reset = true) {
  const bucket = state[name];
  if (bucket.loading) return bucket;
  bucket.loading = true;
  bucket.error = null;
  try {
    const cursor = reset ? null : bucket.nextCursor;
    const query = qs({ limit: 60, cursor, ...params });
    const data = await api(`${path}${query ? `?${query}` : ''}`);
    bucket.items = reset ? data.items : [...bucket.items, ...data.items];
    if (name === 'assets') bucket.items.forEach((asset) => {
      if (state.compareIds.includes(asset.id)) cacheCompareAsset(asset);
    });
    bucket.nextCursor = data.nextCursor || null;
    bucket.total = data.total ?? bucket.items.length;
    return bucket;
  } catch (error) {
    bucket.error = error;
    throw error;
  } finally {
    bucket.loading = false;
  }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 19);
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function statusText(value) {
  return STATUS_LABELS[value] || value || '-';
}

function kindText(value) {
  return KIND_LABELS[value] || value || '-';
}

function badge(value, variant = badgeVariant(value)) {
  return `<span class="badge ${variant}">${escapeHtml(statusText(value))}</span>`;
}

function kindBadge(value) {
  return `<span class="badge info">${escapeHtml(kindText(value))}</span>`;
}

function normalizeSelectionState(value) {
  return ['selected', 'rejected', 'needs_review'].includes(value) ? value : 'pending';
}

function selectionState(asset) {
  return normalizeSelectionState(asset?.selection_state || asset?.selectionState);
}

function selectionText(value) {
  if (value === 'selected') return '已选';
  if (value === 'rejected') return '不采用';
  if (value === 'needs_review') return '待复核';
  return '待选择';
}

function selectionBadge(asset) {
  const value = selectionState(asset);
  const variant = value === 'selected' ? 'success' : value === 'rejected' ? 'danger' : 'accent';
  return `<span class="badge selection-badge ${variant}" data-selection-state="${escapeHtml(value)}">${escapeHtml(selectionText(value))}</span>`;
}

function deliverableBadge(asset) {
  const ready = ['ready', 'ready_for_selection'].includes(asset?.status) && asset?.path;
  return `<span class="badge ${ready ? 'success' : 'warning'}">${ready ? '可交付' : '需检查'}</span>`;
}

function assetStatusBadge(asset) {
  return badge(asset.user_status || asset.status);
}

function badgeVariant(value) {
  if (['ready', 'ready_for_selection', 'succeeded', 'selected', 'resolved'].includes(value)) return 'success';
  if (['needs_review', 'queued', 'running'].includes(value)) return 'warning';
  if (['needs_attention', 'failed', 'open', 'blocking', 'rejected'].includes(value)) return 'danger';
  if (['result', 'reference', 'input', 'export'].includes(value)) return 'info';
  return 'accent';
}

function metric(label, value, hint) {
  return `
    <article class="metric">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(formatNumber(value))}</div>
      <div class="hint">${escapeHtml(hint)}</div>
    </article>
  `;
}

function skeletonCards(count = 8) {
  return Array.from({ length: count }, () => `
    <article class="asset-card">
      <div class="thumb skeleton"></div>
      <div class="asset-body">
        <div class="skeleton" style="height:14px;border-radius:5px;margin-bottom:8px"></div>
        <div class="skeleton" style="height:11px;width:70%;border-radius:5px"></div>
      </div>
    </article>
  `).join('');
}

function emptyState(title, action = '') {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong>${action ? `<span>${escapeHtml(action)}</span>` : ''}</div>`;
}

function bucketNotice(bucket) {
  if (bucket?.loading) return emptyState('加载中', '同步本地数据库状态。');
  if (bucket?.error) return emptyState('加载失败，显示上次数据', bucket.error.message);
  return '';
}

function errorNotice(error) {
  return error ? emptyState('加载失败，显示上次数据', error.message) : '';
}

function moreButton(bucket, key) {
  return bucket.nextCursor ? `<button class="load-more" data-more="${key}" type="button">加载更多</button>` : '';
}

function updateAssetSelection(assetId, selection) {
  const nextState = selection?.state || null;
  const patch = !nextState || nextState === 'removed'
    ? { selection_id: null, selection_state: null, selection_reason: null, selected_at: null }
    : {
      selection_id: selection?.id || null,
      selection_state: nextState,
      selection_reason: selection?.reason || null,
      selected_at: selection?.selected_at || new Date().toISOString(),
    };
  state.assets.items = state.assets.items.map((item) => item.id === assetId ? { ...item, ...patch } : item);
  if (state.compareAssetsById[assetId]) {
    state.compareAssetsById[assetId] = { ...state.compareAssetsById[assetId], ...patch };
  }
  if (state.drawer?.type === 'asset' && state.drawer.id === assetId) {
    state.drawer.data = { ...state.drawer.data, ...patch };
    if (state.drawer.detail?.asset) {
      state.drawer.detail = {
        ...state.drawer.detail,
        asset: { ...state.drawer.detail.asset, ...patch },
      };
    }
  }
}

function cacheCompareAsset(asset) {
  if (!asset?.id) return;
  state.compareAssetsById[asset.id] = { ...state.compareAssetsById[asset.id], ...asset };
}

function assetSnapshotById(id) {
  return state.assets.items.find((asset) => asset.id === id) || state.compareAssetsById[id] || null;
}

function selectorValue(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function drawerFocusSelector(trigger) {
  if (!trigger?.dataset) return null;
  if (trigger.dataset.openSummary !== undefined) return '[data-open-summary]';
  const map = [
    ['asset', 'data-asset'],
    ['run', 'data-run'],
    ['issue', 'data-issue'],
    ['prompt', 'data-prompt'],
    ['job', 'data-job'],
    ['event', 'data-event'],
    ['export', 'data-export'],
  ];
  const match = map.find(([key]) => trigger.dataset[key] !== undefined);
  return match ? `[${match[1]}="${selectorValue(trigger.dataset[match[0]])}"]` : null;
}

function syncPromptFocus() {
  if (!state.prompts.items.length) {
    state.promptFocusId = null;
    state.expandedPrompt = false;
    if (state.drawer.open && state.drawer.type === 'prompt') resetDrawer('prompt_empty');
    return null;
  }
  const current = state.prompts.items.find((prompt) => prompt.id === state.promptFocusId);
  if (current) {
    if (state.drawer.open && state.drawer.type === 'prompt' && state.drawer.id === current.id) {
      state.drawer.data = current;
    }
    return current;
  }
  state.promptFocusId = state.prompts.items[0].id;
  state.expandedPrompt = false;
  if (state.drawer.open && state.drawer.type === 'prompt') resetDrawer('prompt_focus_reset');
  return state.prompts.items[0];
}

function toggleBulkAsset(assetId) {
  state.bulkAssetIds = state.bulkAssetIds.includes(assetId)
    ? state.bulkAssetIds.filter((id) => id !== assetId)
    : [...state.bulkAssetIds, assetId];
}

function addCompareIds(ids) {
  const added = [];
  let duplicateSkipped = 0;
  let capacitySkipped = 0;
  for (const id of ids) {
    if (state.compareIds.includes(id) || added.includes(id)) {
      duplicateSkipped += 1;
      continue;
    }
    if (state.compareIds.length + added.length >= 9) {
      capacitySkipped += 1;
      continue;
    }
    cacheCompareAsset(assetSnapshotById(id));
    added.push(id);
  }
  state.compareIds = [...state.compareIds, ...added];
  return {
    added,
    skipped: duplicateSkipped + capacitySkipped,
    duplicateSkipped,
    capacitySkipped,
    full: state.compareIds.length >= 9,
  };
}

function setHead(eyebrow, title, subtitle, controls = '') {
  $('pageEyebrow').textContent = eyebrow;
  $('pageTitle').textContent = title;
  $('pageSubtitle').textContent = subtitle;
  $('pageControls').innerHTML = `
    ${controls}
    <button class="secondary-button inspector-button" data-open-summary type="button" aria-haspopup="dialog">检查器</button>
  `;
}

function segmented(name, current, items) {
  return `
    <div class="segmented" role="tablist" aria-label="${escapeHtml(name)}">
      ${items.map(([id, label]) => `
        <button type="button" data-filter="${escapeHtml(id)}" class="${current === id ? 'active' : ''}" aria-pressed="${current === id ? 'true' : 'false'}">${escapeHtml(label)}</button>
      `).join('')}
    </div>
  `;
}

function renderNav() {
  $('nav').innerHTML = NAV_ITEMS.map((item) => `
    <button type="button" data-page="${escapeHtml(item.id)}" class="${state.page === item.id ? 'active' : ''}">
      <span class="nav-icon" aria-hidden="true">${escapeHtml(item.icon)}</span>
      <span class="nav-copy">
        <span class="nav-label">${escapeHtml(item.label)}</span>
        <span class="nav-desc">${escapeHtml(item.desc)}</span>
      </span>
    </button>
  `).join('');
}

function updateShell() {
  const counts = state.project?.counts || {};
  $('sideAssetCount').textContent = formatNumber(counts.assets || state.assets.total || 0);
  $('sideIssueCount').textContent = formatNumber(counts.open_issues || 0);
  $('healthDot').classList.toggle('ok', state.health?.status === 'ok');
  $('healthText').textContent = state.health?.status === 'ok' ? '本地服务在线' : '连接异常';
  $('menuButton').setAttribute('aria-expanded', state.sidebarOpen ? 'true' : 'false');
  $('exportButton').disabled = Boolean(state.exportBusy);
  $('exportButton').textContent = state.exportBusy ? '导出中' : '导出';
  document.querySelector('[data-shell]').classList.toggle('sidebar-open', state.sidebarOpen);
}

function assetThumb(asset) {
  if (String(asset.mime || '').startsWith('image/') && asset.thumb_status === 'ready') {
    return `<img src="/api/assets/${encodeURIComponent(asset.id)}/thumb" alt="${escapeHtml(asset.title || '资产缩略图')}" loading="lazy" decoding="async">`;
  }
  const label = asset.thumb_status === 'missing' ? '无缩略图' : kindText(asset.kind);
  return `<div class="thumb-fallback"><strong>${escapeHtml((kindText(asset.kind) || '?').slice(0, 1))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function assetCard(asset, compact = false) {
  const inCompare = state.compareIds.includes(asset.id);
  const active = state.drawer?.page === state.page && state.drawer?.type === 'asset' && state.drawer.id === asset.id;
  const bulkChecked = state.bulkAssetIds.includes(asset.id);
  const selectState = selectionState(asset);
  return `
    <article class="asset-card ${inCompare ? 'in-compare' : ''} ${active ? 'active' : ''} selection-${escapeHtml(selectState)} ${bulkChecked ? 'bulk-active' : ''}" data-asset="${escapeHtml(asset.id)}" tabindex="0">
      ${state.bulkMode ? `
        <label class="bulk-check" aria-label="选择资产 ${escapeHtml(asset.title || asset.id)}">
          <input type="checkbox" data-bulk-asset="${escapeHtml(asset.id)}" ${bulkChecked ? 'checked' : ''}>
          <span></span>
        </label>
      ` : ''}
      <button class="compare-toggle" data-compare-toggle="${escapeHtml(asset.id)}" type="button" aria-label="${inCompare ? '移出对比' : '加入对比'}">${inCompare ? '✓' : '+'}</button>
      <div class="thumb">${assetThumb(asset)}</div>
      <div class="asset-body">
        <div class="asset-title">${escapeHtml(asset.title || asset.id)}</div>
        <div class="asset-meta">
          ${kindBadge(asset.kind)}
          ${assetStatusBadge(asset)}
          ${selectionBadge(asset)}
          ${deliverableBadge(asset)}
          ${compact ? '' : `<span>${escapeHtml(formatTime(asset.updated_at))}</span>`}
        </div>
      </div>
    </article>
  `;
}

function renderDashboard() {
  const counts = state.project?.counts || {};
  const recentRuns = state.runs.items.slice(0, 6);
  const recentAssets = state.assets.items.slice(0, 8);
  const openIssues = state.issues.items.filter((issue) => issue.status === 'open').slice(0, 4);
  setHead(
    'Local asset OS',
    '生产总览',
    state.project?.project?.name || '本地批量生图项目',
    ''
  );
  $('view').innerHTML = `
    <section class="metric-grid" aria-label="关键指标">
      ${metric('任务批次', counts.runs || state.runs.total, '最近生产运行')}
      ${metric('提示词', counts.prompts || state.prompts.total, '可复用生成输入')}
      ${metric('资产', counts.assets || state.assets.total, '本地文件资产')}
      ${metric('未处理问题', counts.open_issues || 0, '影响交付项')}
      ${metric('已选资产', counts.selections || 0, '进入交付候选')}
    </section>

    <section class="dashboard-grid">
      <div class="surface-card">
        <div class="section-head">
          <div><h2>Production runs</h2><p>最近批次、状态、成功失败统计。</p></div>
          <button class="small-button" data-page="runs" type="button">查看全部</button>
        </div>
        ${recentRuns.length ? renderRunsList(recentRuns) : emptyState('还没有任务记录', '准备或执行后会出现生产批次。')}
      </div>

      <div class="surface-card">
        <div class="section-head">
          <div><h2>资产预览</h2><p>最近入库图片和交付候选。</p></div>
          <button class="small-button" data-page="assets" type="button">打开资产库</button>
        </div>
        <div class="asset-preview-row">
          ${recentAssets.length ? recentAssets.map((asset) => `
            <button class="mini-asset" data-asset="${escapeHtml(asset.id)}" type="button">
              <div class="thumb">${assetThumb(asset)}</div>
              <div class="mini-title">${escapeHtml(asset.title || asset.id)}</div>
            </button>
          `).join('') : (state.assets.loading ? skeletonCards(4) : emptyState('还没有资产', '执行或导入后会显示最近图片。'))}
        </div>
      </div>

      <div class="surface-card">
        <div class="section-head">
          <div><h2>下一步动作</h2><p>按当前项目状态给出短路径。</p></div>
        </div>
        <div class="next-actions">
          ${actionRow('筛选可用资产', `${formatNumber(counts.assets || 0)} 个资产`, '资产库', 'assets')}
          ${actionRow('处理未关闭问题', `${formatNumber(counts.open_issues || 0)} 个未处理`, '问题中心', 'issues')}
          ${actionRow('生成交付报告', '导出 JSON 报告或资产包清单', '导出', 'exports')}
        </div>
      </div>

      <div class="surface-card">
        <div class="section-head">
          <div><h2>问题信号</h2><p>阻塞、需复核、可补跑集中处理。</p></div>
          <button class="small-button" data-page="issues" type="button">处理</button>
        </div>
        ${openIssues.length ? openIssues.map(issueCard).join('') : emptyState('没有未处理问题', '当前交付风险低。')}
      </div>
    </section>
  `;
}

function actionRow(title, meta, label, page) {
  return `
    <div class="action-row">
      <div>
        <div class="action-title">${escapeHtml(title)}</div>
        <div class="action-meta">${escapeHtml(meta)}</div>
      </div>
      <button class="small-button" data-page="${escapeHtml(page)}" type="button">${escapeHtml(label)}</button>
    </div>
  `;
}

function filterPanel() {
  return `
    <aside class="filter-panel" aria-label="资产筛选">
      <label class="field">类型
        <select data-asset-filter="kind">
          ${Object.entries(KIND_LABELS).map(([value, label]) => `<option value="${value}" ${state.kind === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      <label class="field">选择状态
        <select data-asset-filter="selectedFilter">
          <option value="all" ${state.selectedFilter === 'all' ? 'selected' : ''}>全部</option>
          <option value="true" ${state.selectedFilter === 'true' ? 'selected' : ''}>已选</option>
          <option value="false" ${state.selectedFilter === 'false' ? 'selected' : ''}>未选中</option>
        </select>
      </label>
      <label class="field">网格密度
        <select data-asset-filter="density">
          <option value="comfortable" ${state.density === 'comfortable' ? 'selected' : ''}>舒适</option>
          <option value="compact" ${state.density === 'compact' ? 'selected' : ''}>紧凑</option>
        </select>
      </label>
    </aside>
  `;
}

function renderAssets() {
  const filters = [['all', '全部'], ['ready_for_selection', '可筛选'], ['needs_attention', '需处理'], ['needs_review', '待复核'], ['ready', '就绪']];
  const controls = `
    ${segmented('资产状态', state.status, filters)}
    <div class="segmented" aria-label="视图模式">
      <button type="button" data-asset-view="grid" class="${state.assetView === 'grid' ? 'active' : ''}">网格</button>
      <button type="button" data-asset-view="list" class="${state.assetView === 'list' ? 'active' : ''}">列表</button>
    </div>
    <button class="secondary-button" data-bulk-mode type="button" aria-pressed="${state.bulkMode ? 'true' : 'false'}">${state.bulkMode ? '退出批量' : '批量选择'}</button>
  `;
  setHead('Asset library', '资产库', `已加载 ${formatNumber(state.assets.items.length)}/${formatNumber(state.assets.total || state.assets.items.length)}，按本地数据库筛选。`, controls);
  const content = state.assets.loading
    ? `<div class="grid">${skeletonCards(10)}</div>`
    : state.assetView === 'list'
      ? renderAssetTable()
      : `<div class="grid ${state.density === 'compact' ? 'compact' : ''}">${state.assets.items.map((asset) => assetCard(asset, state.density === 'compact')).join('') || emptyState('没有符合条件的资产', '换个状态或搜索词。')}</div>`;
  $('view').innerHTML = `
    <div class="asset-layout">
      ${filterPanel()}
      <section class="asset-results">
        <div class="asset-toolbar">
          <div>${badge(`${state.compareIds.length} 张对比`, 'accent')} ${badge(`已载 ${state.assets.items.length}`, 'info')} ${state.bulkMode ? badge(`批量 ${state.bulkAssetIds.length}`, 'warning') : ''}</div>
          <div class="toolbar-actions">
            ${state.bulkMode ? `
              <button class="small-button" data-bulk-action="compare" type="button" ${state.bulkAssetIds.length ? '' : 'disabled'}>加入对比</button>
              <button class="small-button" data-bulk-action="selected" type="button" ${state.bulkAssetIds.length ? '' : 'disabled'}>标记已选</button>
              <button class="small-button" data-bulk-action="rejected" type="button" ${state.bulkAssetIds.length ? '' : 'disabled'}>不采用</button>
              <button class="small-button" data-bulk-action="clear" type="button" ${state.bulkAssetIds.length ? '' : 'disabled'}>清空</button>
            ` : ''}
            <button class="small-button" data-page="compare" type="button">打开对比</button>
          </div>
        </div>
        ${bucketNotice(state.assets)}
        ${content}
        ${moreButton(state.assets, 'assets')}
      </section>
    </div>
  `;
}

function renderAssetTable() {
  return `
    <table class="table">
      <thead><tr><th>资产</th><th>类型</th><th>状态</th><th>选择</th><th>尺寸</th><th>更新时间</th></tr></thead>
      <tbody>
        ${state.assets.items.map((asset) => `
          <tr data-asset="${escapeHtml(asset.id)}" tabindex="0">
            <td><strong>${escapeHtml(asset.title || asset.id)}</strong><br><span class="detail-value">${escapeHtml(asset.path || '-')}</span></td>
            <td>${kindBadge(asset.kind)}</td>
            <td>${assetStatusBadge(asset)} ${deliverableBadge(asset)}</td>
            <td>${selectionBadge(asset)}</td>
            <td>${asset.width && asset.height ? `${escapeHtml(asset.width)}×${escapeHtml(asset.height)}` : '-'}</td>
            <td>${escapeHtml(formatTime(asset.updated_at))}</td>
          </tr>
        `).join('') || '<tr><td colspan="6">没有符合条件的资产。</td></tr>'}
      </tbody>
    </table>
  `;
}

function renderRuns() {
  setHead('Production', '任务记录', `已加载 ${formatNumber(state.runs.items.length)}/${formatNumber(state.runs.total || state.runs.items.length)} 个运行批次。`, '');
  $('view').innerHTML = `
    ${bucketNotice(state.runs)}
    ${state.runs.items.length ? renderRunsList(state.runs.items) : emptyState('还没有任务记录', '准备或执行后会同步到这里。')}
    ${moreButton(state.runs, 'runs')}
  `;
}

function renderRunsList(runs) {
  return `
    <div class="runs-list">
      ${runs.map((run) => `
        <article class="run-card" data-run="${escapeHtml(run.id)}" tabindex="0">
          <div class="run-body">
            <div class="run-title">${escapeHtml(run.title || run.id)}</div>
            <div class="run-meta">
              ${badge(run.status)}
              <span class="badge info">${escapeHtml(run.phase || '-')}</span>
              <span>${escapeHtml(run.provider || 'local')}</span>
              <span>${escapeHtml(formatTime(run.updated_at))}</span>
            </div>
          </div>
          <div class="run-stats" aria-label="运行统计">
            <div class="stat-pill"><strong>${formatNumber(run.success_count)}</strong><span>成功</span></div>
            <div class="stat-pill"><strong>${formatNumber(run.failed_count)}</strong><span>失败</span></div>
            <div class="stat-pill"><strong>${formatNumber(run.skipped_count)}</strong><span>跳过</span></div>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function issueGroup(issue) {
  if (issue.status === 'resolved') return '已处理';
  if (issue.severity === 'blocking' || issue.blocking) return '阻塞';
  if (issue.rerunnable) return '可补跑';
  return '需复核';
}

function issueCard(issue) {
  return `
    <article class="issue-card" data-issue="${escapeHtml(issue.id)}" tabindex="0">
      <div class="asset-meta">
        ${badge(issue.status)}
        ${badge(issue.severity || issue.type, badgeVariant(issue.severity || issue.type))}
      </div>
      <div class="asset-title">${escapeHtml(issue.title || issue.id)}</div>
      <p>${escapeHtml(issue.message || issue.recommended_action || '等待处理。')}</p>
      <div class="card-actions">
        ${issue.status !== 'resolved' ? `<button class="small-button" data-resolve="${escapeHtml(issue.id)}" type="button">标记解决</button>` : ''}
        ${issue.rerunnable ? `<button class="small-button" data-rerun-issue="${escapeHtml(issue.id)}" type="button">创建补跑</button>` : ''}
        <button class="small-button" type="button" disabled title="当前后端没有忽略接口">稍后处理</button>
      </div>
    </article>
  `;
}

function renderIssues() {
  const filters = [['all', '全部'], ['open', '未处理'], ['resolved', '已处理']];
  setHead('Recovery', '问题中心', `按处理方式分组，已加载 ${formatNumber(state.issues.items.length)}/${formatNumber(state.issues.total || state.issues.items.length)}。`, segmented('问题状态', state.status, filters));
  const groups = ['阻塞', '需复核', '可补跑', '已处理'].map((name) => {
    const items = state.issues.items.filter((issue) => issueGroup(issue) === name);
    return `
      <section class="issue-group">
        <h2>${escapeHtml(name)} <span class="badge ${items.length ? 'warning' : ''}">${formatNumber(items.length)}</span></h2>
        ${items.length ? items.map(issueCard).join('') : emptyState('暂无', '')}
      </section>
    `;
  }).join('');
  $('view').innerHTML = `${bucketNotice(state.issues)}<div class="issues-board">${groups}</div>${moreButton(state.issues, 'issues')}`;
}

function renderPrompts() {
  const active = syncPromptFocus();
  const runOptions = state.runs.items.map((run) => `<option value="${escapeHtml(run.id)}" ${state.runFilter === run.id ? 'selected' : ''}>${escapeHtml(run.title || run.id)}</option>`).join('');
  const promptText = active?.prompt_text || '暂无提示词。';
  const shouldClamp = promptText.length > 900 && !state.expandedPrompt;
  setHead('Prompt Lab', '提示词实验室', `搜索、复制、派生补跑，已加载 ${formatNumber(state.prompts.items.length)}/${formatNumber(state.prompts.total || state.prompts.items.length)}。`, `
    <label class="field prompt-run-filter">任务
      <select data-run-filter>
        <option value="all" ${state.runFilter === 'all' ? 'selected' : ''}>全部任务</option>
        ${runOptions}
      </select>
    </label>
  `);
  $('view').innerHTML = `
    ${bucketNotice(state.prompts)}
    <section class="prompt-lab">
      <aside class="prompt-list-panel surface-card">
        <div class="section-head">
          <div><h2>提示词列表</h2><p>${formatNumber(state.prompts.items.length)} 条已载入。</p></div>
        </div>
        <div class="prompt-list">
          ${state.prompts.items.map((prompt) => `
            <button class="prompt-card ${active?.id === prompt.id ? 'active' : ''}" data-prompt="${escapeHtml(prompt.id)}" type="button" aria-pressed="${active?.id === prompt.id ? 'true' : 'false'}">
              <div class="prompt-title">${escapeHtml(prompt.title || `Prompt ${prompt.prompt_index || ''}`)}</div>
              <div class="prompt-meta"><span>${escapeHtml(prompt.prompt_index || '-')}</span><span>${escapeHtml(formatTime(prompt.updated_at))}</span></div>
            </button>
          `).join('') || emptyState('还没有提示词', '准备阶段会写入提示词。')}
          ${moreButton(state.prompts, 'prompts')}
        </div>
      </aside>
      <div class="prompt-workspace">
        <div class="prompt-toolbar surface-card">
          <div class="prompt-current">
            <h2>${escapeHtml(active?.title || '提示词预览')}</h2>
            <p>${escapeHtml(active?.id || '-')}</p>
          </div>
          <div class="toolbar-actions">
            <button class="small-button" data-copy="${escapeHtml(active?.id || '')}" type="button" ${active ? '' : 'disabled'}>${state.copiedPromptId === active?.id ? '已复制' : '复制'}</button>
            <button class="small-button" data-toggle-prompt type="button" ${active ? '' : 'disabled'}>${state.expandedPrompt ? '收起' : '展开'}</button>
            <button class="small-button" data-rerun-prompt="${escapeHtml(active?.id || '')}" type="button" ${active ? '' : 'disabled'}>补跑</button>
          </div>
        </div>
        <div class="prompt-preview surface-card">
          <div class="prompt-text ${shouldClamp ? 'is-clamped' : ''}">${highlightQuery(promptText)}</div>
        </div>
        <section class="prompt-meta-panel surface-card">
          <div class="section-head"><div><h2>参数与关联</h2><p>运行输入摘要。</p></div></div>
          <div class="prompt-meta-grid">
            ${detailRows(active || {}, [['run_id', '任务'], ['prompt_index', '编号'], ['negative_prompt', '负向提示词'], ['source_path', '来源路径']])}
          </div>
          <pre class="code-block prompt-params">${escapeHtml(JSON.stringify(active?.params || {}, null, 2))}</pre>
        </section>
      </div>
    </section>
  `;
}

function highlightQuery(text) {
  const escaped = escapeHtml(text);
  const query = state.query.trim();
  if (!query) return escaped;
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(safe, 'gi'), (match) => `<mark>${match}</mark>`);
}

function renderCompare() {
  setHead('Review', '对比视图', '支持 2、4、9 张图一起看，固定画幅避免跳动。', '');
  const assets = state.compareIds.map((id) => assetSnapshotById(id)).filter(Boolean).slice(0, 9);
  $('view').innerHTML = assets.length ? `
    <div class="compare-grid count-${Math.min(assets.length, 9)}">
      ${assets.map((asset) => `
        <article class="compare-card" data-asset="${escapeHtml(asset.id)}" tabindex="0">
          <div class="thumb">${assetThumb(asset)}</div>
          <div class="asset-title">${escapeHtml(asset.title || asset.id)}</div>
          <div class="compare-meta">${assetStatusBadge(asset)} ${selectionBadge(asset)} <span>${escapeHtml(asset.width && asset.height ? `${asset.width}×${asset.height}` : '尺寸未知')}</span></div>
          <textarea class="notes-area" aria-label="差异备注" placeholder="差异备注"></textarea>
          <div class="card-actions">
            <button class="primary-button" data-select-current="${escapeHtml(asset.id)}" type="button">选为赢家</button>
            <button class="small-button" data-compare-toggle="${escapeHtml(asset.id)}" type="button">移除</button>
          </div>
        </article>
      `).join('')}
    </div>
  ` : emptyState('未选择对比资产', '在资产库点击 + 加入对比。');
}

function renderExports() {
  setHead('Delivery', '导出中心', '交付包、报告、已选资产与导出历史。', '');
  const selected = state.project?.counts?.selections || 0;
  const openIssues = state.project?.counts?.open_issues || 0;
  const lastExport = state.exports[0];
  const packReady = state.exports.some((item) => item.kind === 'pack' && item.status === 'ready');
  $('view').innerHTML = `
    ${errorNotice(state.exportsError)}
    <section class="export-layout">
      <div class="export-card">
        <div class="section-head"><div><h2>交付前检查</h2><p>${formatNumber(selected)} 个已选资产，${formatNumber(openIssues)} 个未处理问题。</p></div></div>
        <div class="delivery-checklist">
          <div><span>已选资产</span><strong>${formatNumber(selected)}</strong></div>
          <div><span>未处理问题</span><strong>${formatNumber(openIssues)}</strong></div>
          <div><span>最近导出</span><strong>${escapeHtml(lastExport ? formatTime(lastExport.updated_at || lastExport.created_at) : '无')}</strong></div>
          <div><span>资产包状态</span><strong>${packReady ? '已生成' : '待生成'}</strong></div>
        </div>
        ${state.exportResult?.path ? `<div class="export-result"><strong>完成</strong><span>${escapeHtml(state.exportResult.path)}</span></div>` : ''}
        <div class="next-actions">
          <div class="action-row">
            <div><div class="action-title">已选资产包</div><div class="action-meta">写入 selected_pack_manifest.json</div></div>
            <button class="primary-button" id="packButton" type="button" ${state.exportBusy ? 'disabled' : ''}>${state.exportBusy === 'pack' ? '生成中' : '生成'}</button>
          </div>
          <div class="action-row">
            <div><div class="action-title">工作台报告</div><div class="action-meta">写入 workbench_report.json</div></div>
            <button class="secondary-button" data-export-report type="button" ${state.exportBusy ? 'disabled' : ''}>${state.exportBusy === 'report' ? '生成中' : '生成'}</button>
          </div>
        </div>
      </div>
      <div class="export-card export-history">
        <div class="section-head"><div><h2>最近导出</h2><p>报告、资产包清单、交付记录。</p></div></div>
        <table class="table export-table">
          <thead><tr><th>名称</th><th>类型</th><th>状态</th><th>路径</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>${state.exports.map((item) => `
            <tr data-export="${escapeHtml(item.id)}" tabindex="0">
              <td class="export-name">${escapeHtml(item.title || item.id)}</td>
              <td>${kindBadge(item.kind)}</td>
              <td>${badge(item.status)}</td>
              <td><code class="export-path">${escapeHtml(item.path || '-')}</code></td>
              <td>${escapeHtml(formatTime(item.updated_at || item.created_at))}</td>
              <td><button class="small-button" data-export="${escapeHtml(item.id)}" type="button">详情</button></td>
            </tr>
          `).join('') || '<tr><td colspan="6">还没有导出记录。</td></tr>'}</tbody>
        </table>
        <div class="export-cards">
          ${state.exports.map((item) => `
            <article class="export-record-card" data-export="${escapeHtml(item.id)}" tabindex="0">
              <div class="export-record-head">
                <strong>${escapeHtml(item.title || item.id)}</strong>
                <span>${kindBadge(item.kind)} ${badge(item.status)}</span>
              </div>
              <code class="export-path">${escapeHtml(item.path || '-')}</code>
              <div class="export-record-actions">
                <span>${escapeHtml(formatTime(item.updated_at || item.created_at))}</span>
                <button class="small-button" data-export="${escapeHtml(item.id)}" type="button">详情</button>
              </div>
            </article>
          `).join('') || emptyState('还没有导出记录', '生成报告或资产包后显示。')}
        </div>
      </div>
    </section>
  `;
}

function detailRows(item, keys) {
  return keys.map(([key, label]) => `
    <div class="detail-row">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value">${escapeHtml(formatDetailValue(item?.[key]))}</div>
    </div>
  `).join('');
}

function formatDetailValue(value) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return value;
}

function renderAssetDrawer(detail) {
  const asset = detail.asset;
  cacheCompareAsset(asset);
  setDrawer('asset', asset.id, asset, detail);
  render();
}

function assetInspectorHtml(detail) {
  const asset = detail.asset;
  const tags = detail.tags?.map((tag) => tag.name).join('、') || '无';
  const run = detail.runs?.[0];
  return `
    <h2>${escapeHtml(asset.title || asset.id)}</h2>
    <p class="inspector-subtitle">资产详情 · ${escapeHtml(state.page === 'compare' ? '对比评审' : '资产库')}</p>
    <div class="asset-meta">${kindBadge(asset.kind)} ${assetStatusBadge(asset)} ${selectionBadge(asset)} ${deliverableBadge(asset)} <span>${escapeHtml(formatTime(asset.updated_at))}</span></div>
    <div class="inspector-preview"><div class="thumb">${assetThumb(asset)}</div></div>
    <div class="detail-actions">
      <button class="primary-button" data-select-current="${escapeHtml(asset.id)}" type="button">设为已选</button>
      <button class="ghost-button" data-reject-current="${escapeHtml(asset.id)}" type="button">不采用</button>
      <button class="small-button" data-clear-selection="${escapeHtml(asset.id)}" type="button">移除选择</button>
      <button class="small-button" data-compare-toggle="${escapeHtml(asset.id)}" type="button">对比</button>
    </div>
    <form class="tag-form" data-tag-form="${escapeHtml(asset.id)}">
      <input name="tag" placeholder="添加标签" aria-label="添加标签">
      <button class="small-button" type="submit">添加</button>
    </form>
    <div class="detail">
      ${detailRows(asset, [['path', '文件路径'], ['status', '资产状态'], ['selection_state', '选择状态'], ['selected_at', '选择时间'], ['user_status', '资产标签状态'], ['width', '宽度'], ['height', '高度'], ['size_bytes', '文件大小'], ['sha256', '文件指纹'], ['notes', '备注']])}
      <div class="detail-row"><div class="detail-label">标签</div><div class="detail-value">${escapeHtml(tags)}</div></div>
      <div class="detail-row"><div class="detail-label">来源任务</div><div class="detail-value">${escapeHtml(run ? `${run.run_title || run.run_id} / ${run.run_phase}` : '-')}</div></div>
      <div class="detail-row"><div class="detail-label">提示词</div><div class="detail-value code-block">${escapeHtml(detail.prompt?.prompt_text || '-')}</div></div>
      <div class="detail-row"><div class="detail-label">生成参数</div><div class="detail-value code-block">${escapeHtml(JSON.stringify(detail.prompt?.params || detail.runItem?.raw || {}, null, 2))}</div></div>
    </div>
  `;
}

function renderDefaultDrawer() {
  const counts = state.project?.counts || {};
  const activeJob = state.jobs.items.find((job) => ['queued', 'running', 'failed'].includes(job.status));
  const lastEvent = state.events.items[0];
  const defaults = {
    dashboard: {
      title: '项目检查器',
      subtitle: '当前项目概览和下一步动作。',
      rows: [
        ['项目', state.project?.project?.name || '本地项目'],
        ['资产', formatNumber(counts.assets || 0)],
        ['未处理问题', formatNumber(counts.open_issues || 0)],
        ['当前队列', activeJob ? `${activeJob.kind} / ${statusText(activeJob.status)}` : '空闲'],
        ['最近事件', lastEvent?.message || lastEvent?.event_type || '-'],
      ],
      actions: [
        ['资产库', 'assets'],
        ['问题中心', 'issues'],
        ['导出', 'exports'],
      ],
    },
    runs: {
      title: '任务检查器',
      subtitle: '选择任务查看阶段、provider 和成功失败统计。',
      rows: [
        ['任务筛选', statusText(state.status)],
        ['已加载', `${formatNumber(state.runs.items.length)} / ${formatNumber(state.runs.total || state.runs.items.length)}`],
        ['运行中', formatNumber(state.runs.items.filter((item) => item.status === 'running').length)],
        ['失败', formatNumber(state.runs.items.filter((item) => item.status === 'failed').length)],
      ],
      actions: [['刷新任务', 'runs'], ['处理问题', 'issues']],
    },
    assets: {
      title: '资产筛选摘要',
      subtitle: '选择资产后显示文件、选择状态和交付动作。',
      rows: [
        ['搜索', state.query || '未输入'],
        ['状态', statusText(state.status)],
        ['类型', kindText(state.kind)],
        ['选择筛选', state.selectedFilter === 'true' ? '已选' : state.selectedFilter === 'false' ? '未选中' : '全部'],
        ['已加载', `${formatNumber(state.assets.items.length)} / ${formatNumber(state.assets.total || state.assets.items.length)}`],
        ['批量模式', state.bulkMode ? `已开启，选中 ${formatNumber(state.bulkAssetIds.length)}` : '未开启'],
        ['对比篮', `${formatNumber(state.compareIds.length)} / 9`],
      ],
      actions: [['打开对比', 'compare'], ['导出中心', 'exports']],
    },
    issues: {
      title: '问题处理建议',
      subtitle: '选择问题后显示原因、严重级别和处理动作。',
      rows: [
        ['搜索', state.query || '未输入'],
        ['状态', statusText(state.status)],
        ['未处理', formatNumber(state.issues.items.filter((item) => item.status === 'open').length)],
        ['可补跑', formatNumber(state.issues.items.filter((item) => item.rerunnable).length)],
        ['已加载', `${formatNumber(state.issues.items.length)} / ${formatNumber(state.issues.total || state.issues.items.length)}`],
      ],
      actions: [['补跑未处理', 'runs'], ['资产库', 'assets']],
    },
    prompts: {
      title: '提示词摘要',
      subtitle: '选择提示词后显示来源、参数、复制和补跑操作。',
      rows: [
        ['搜索', state.query || '未输入'],
        ['任务', state.runFilter === 'all' ? '全部任务' : state.runFilter],
        ['已加载', `${formatNumber(state.prompts.items.length)} / ${formatNumber(state.prompts.total || state.prompts.items.length)}`],
        ['当前预览', state.promptFocusId || state.prompts.items[0]?.id || '-'],
      ],
      actions: [['任务记录', 'runs'], ['问题中心', 'issues']],
    },
    compare: {
      title: '对比篮',
      subtitle: '选择图卡查看资产详情，标记赢家或移出对比。',
      rows: [
        ['已加入', `${formatNumber(state.compareIds.length)} / 9`],
        ['已选资产', formatNumber(counts.selections || 0)],
        ['建议', state.compareIds.length < 2 ? '至少加入 2 张图后评审' : '记录选择理由并标记赢家'],
      ],
      actions: [['回到资产库', 'assets'], ['导出中心', 'exports']],
    },
    exports: {
      title: '交付检查器',
      subtitle: '导出完成后这里显示最新检查摘要。',
      rows: [
        ['已选资产', formatNumber(counts.selections || 0)],
        ['未处理问题', formatNumber(counts.open_issues || 0)],
        ['导出状态', state.exportBusy ? '生成中' : state.exportResult?.path ? '已完成' : '待生成'],
        ['结果路径', state.exportResult?.path || '-'],
        ['历史记录', formatNumber(state.exports.length)],
      ],
      actions: [['资产库', 'assets'], ['问题中心', 'issues']],
    },
  };
  const model = defaults[state.page] || defaults.dashboard;
  $('drawerTitle').textContent = drawerSummaryTitleForPage(state.page);
  $('drawerEyebrow').textContent = 'Context';
  $('drawerBody').innerHTML = `
    <div class="inspector-empty">
      <strong>${escapeHtml(model.title)}</strong>
      ${escapeHtml(model.subtitle)}
    </div>
    <div class="detail inspector-summary">
      ${model.rows.map(([label, value]) => `
        <div class="detail-row"><div class="detail-label">${escapeHtml(label)}</div><div class="detail-value">${escapeHtml(value)}</div></div>
      `).join('')}
    </div>
    <div class="detail-actions inspector-actions">
      ${model.actions.map(([label, page]) => `<button class="secondary-button" data-page="${escapeHtml(page)}" type="button">${escapeHtml(label)}</button>`).join('')}
    </div>
  `;
}

function drawerSummaryTitleForPage(page) {
  return {
    dashboard: '项目检查器',
    runs: '任务检查器',
    assets: '资产检查器',
    issues: '问题检查器',
    prompts: '提示词检查器',
    compare: '资产检查器',
    exports: '交付检查器',
  }[page] || '项目检查器';
}

function drawerTitleFor(type) {
  return {
    overview: '项目检查器',
    run: '任务检查器',
    asset: '资产检查器',
    issue: '问题检查器',
    prompt: '提示词检查器',
    export: '交付检查器',
    job: '任务检查器',
    event: '事件检查器',
  }[type] || '项目检查器';
}

function setDrawerBody(html, type = state.drawer.type) {
  $('drawerTitle').textContent = drawerTitleFor(type);
  $('drawerEyebrow').textContent = NAV_ITEMS.find((item) => item.id === state.page)?.label || 'Context';
  $('drawerBody').innerHTML = html;
}

function focusDrawerCloseIfNeeded() {
  if (!shouldFocusDrawerClose) return;
  shouldFocusDrawerClose = false;
  window.setTimeout(() => $('drawerClose')?.focus(), 0);
}

function genericDrawerHtml(item, type) {
  const title = item.title || item.name || item.kind || item.id;
  const typeLabel = {
    run: '任务详情',
    issue: '问题详情',
    prompt: '提示词详情',
    job: '队列详情',
    event: '事件详情',
    export: '导出详情',
  }[type] || '详情';
  const rows = Object.entries(item)
    .filter(([key]) => !['metadata', 'raw', 'params', 'payload', 'result'].includes(key))
    .slice(0, 18)
    .map(([key, value]) => `
      <div class="detail-row">
        <div class="detail-label">${escapeHtml(key)}</div>
        <div class="detail-value">${escapeHtml(formatDetailValue(value))}</div>
      </div>
    `).join('');
  const issueActions = type === 'issue' && item.status !== 'resolved'
    ? `<button class="primary-button" data-resolve="${escapeHtml(item.id)}" type="button">标记解决</button>${item.rerunnable ? `<button class="secondary-button" data-rerun-issue="${escapeHtml(item.id)}" type="button">创建补跑</button>` : ''}`
    : '';
  const promptActions = type === 'prompt'
    ? `<button class="secondary-button" data-copy="${escapeHtml(item.id)}" type="button">${state.copiedPromptId === item.id ? '已复制' : '复制'}</button><button class="secondary-button" data-rerun-prompt="${escapeHtml(item.id)}" type="button">补跑</button>`
    : '';
  return `
    <h2>${escapeHtml(title)}</h2>
    <p class="inspector-subtitle">${escapeHtml(typeLabel)} · ${escapeHtml(NAV_ITEMS.find((item) => item.id === state.page)?.label || state.page)}</p>
    ${(issueActions || promptActions) ? `<div class="detail-actions inspector-actions">${issueActions}${promptActions}</div>` : ''}
    <div class="detail inspector-summary">${rows}</div>
  `;
}

function renderCurrentDrawer() {
  syncDrawerToPage();
  $('drawerLayer').classList.toggle('open', Boolean(state.drawer.open));
  $('drawerLayer').setAttribute('aria-hidden', state.drawer.open ? 'false' : 'true');
  if (!state.drawer.open) return;
  if (state.drawer.type === 'asset' && state.drawer.detail?.asset) {
    setDrawerBody(assetInspectorHtml(state.drawer.detail), 'asset');
    focusDrawerCloseIfNeeded();
    return;
  }
  if (state.drawer.type !== 'overview' && state.drawer.data) {
    setDrawerBody(genericDrawerHtml(state.drawer.data, state.drawer.type), state.drawer.type);
    focusDrawerCloseIfNeeded();
    return;
  }
  renderDefaultDrawer();
  focusDrawerCloseIfNeeded();
}

function setGenericDrawer(item, type) {
  if (!item) {
    resetDrawer('empty_selection');
    render();
    return;
  }
  setDrawer(type, item.id, item);
  render();
}

function renderInspector(item, type) {
  setGenericDrawer(item, type);
}

function renderEvents() {
  const active = state.jobs.items.find((job) => ['queued', 'running', 'failed'].includes(job.status));
  $('jobSummary').innerHTML = active
    ? `<button class="job-button job-${escapeHtml(active.status)}" data-job="${escapeHtml(active.id)}" type="button"><span>${escapeHtml(active.kind)} · ${escapeHtml(statusText(active.status))}</span><small>${escapeHtml(formatTime(active.updated_at || active.created_at))}</small>${active.error ? `<em>${escapeHtml(active.error)}</em>` : ''}</button>`
    : '队列空闲';
  $('eventLog').innerHTML = state.events.items.slice(0, 4).map((event) => `
    <button class="activity-item" data-event="${escapeHtml(event.id)}" type="button">
      <strong>${escapeHtml(event.message || event.event_type)}</strong>
      <span>${escapeHtml(formatTime(event.updated_at || event.created_at))}</span>
    </button>
  `).join('') || '<div class="activity-item"><strong>暂无事件</strong><span>等待本地任务写入</span></div>';
}

function render() {
  renderNav();
  updateShell();
  if (state.loading) {
    setHead('Local asset OS', '生产总览', '读取本地数据库状态中。', '');
    $('view').innerHTML = `<section class="metric-grid">${skeletonCards(5)}</section><div class="grid">${skeletonCards(8)}</div>`;
    renderEvents();
    renderCurrentDrawer();
    return;
  }
  if (state.page === 'dashboard') renderDashboard();
  if (state.page === 'assets') renderAssets();
  if (state.page === 'runs') renderRuns();
  if (state.page === 'issues') renderIssues();
  if (state.page === 'prompts') renderPrompts();
  if (state.page === 'compare') renderCompare();
  if (state.page === 'exports') renderExports();
  renderEvents();
  renderCurrentDrawer();
}

async function loadCurrent(reset = true) {
  if (state.page === 'assets') {
    await loadPaged('assets', '/api/assets', {
      q: state.query,
      status: state.status,
      kind: state.kind,
      selected: state.selectedFilter,
    }, reset);
  } else if (state.page === 'runs' || state.page === 'dashboard') {
    await loadPaged('runs', '/api/runs', {}, reset);
  } else if (state.page === 'issues') {
    await loadPaged('issues', '/api/issues', { q: state.query, status: state.status }, reset);
  } else if (state.page === 'prompts') {
    await loadPaged('prompts', '/api/prompts', { q: state.query, run_id: state.runFilter }, reset);
    syncPromptFocus();
  } else if (state.page === 'exports') {
    state.exportsError = null;
    try {
      state.exports = await api('/api/exports');
    } catch (error) {
      state.exportsError = error;
      throw error;
    }
  }
}

async function refreshProject() {
  state.project = await api('/api/project');
}

async function refreshAll() {
  state.loading = true;
  render();
  try {
    const [health, project] = await Promise.all([api('/api/health'), api('/api/project')]);
    state.health = health;
    state.project = project;
    const failures = [];
    const optional = (label, promise) => promise.catch((error) => {
      failures.push(`${label}：${error.message}`);
    });
    await Promise.all([
      optional('任务', loadPaged('runs', '/api/runs', {}, true)),
      optional('资产', loadPaged('assets', '/api/assets', {}, true)),
      optional('问题', loadPaged('issues', '/api/issues', {}, true)),
      optional('事件', loadPaged('events', '/api/events', { limit: 20 }, true)),
      optional('队列', loadPaged('jobs', '/api/jobs', {}, true)),
      optional('提示词', loadPaged('prompts', '/api/prompts', {}, true)),
      optional('导出', api('/api/exports').then((items) => {
        state.exports = items;
        state.exportsError = null;
      }).catch((error) => {
        state.exportsError = error;
        throw error;
      })),
    ]);
    await optional('当前页', loadCurrent(true));
    if (failures.length) toast('部分数据加载失败', failures[0]);
  } finally {
    state.loading = false;
  }
  render();
}

async function reloadAndRender(reset = true) {
  const failures = [];
  const optional = (label, promise) => promise.catch((error) => {
    failures.push(`${label}：${error.message}`);
  });
  await optional('当前页', loadCurrent(reset));
  await Promise.all([
    optional('事件', loadPaged('events', '/api/events', { limit: 20 }, true)),
    optional('队列', loadPaged('jobs', '/api/jobs', {}, true)),
  ]);
  if (failures.length) toast('部分数据加载失败', failures[0]);
  render();
}

function toast(title, message = '') {
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ''}`;
  $('toastStack').appendChild(node);
  window.setTimeout(() => node.remove(), 3600);
}

function showError(error) {
  state.health = { status: 'error' };
  updateShell();
  toast('操作失败', error.message);
  $('view').innerHTML = `<div class="empty"><strong>请求失败</strong>${escapeHtml(error.message)}</div>`;
}

function handleAsync(fn) {
  return (event) => Promise.resolve(fn(event)).catch(showError);
}

async function fetchOpenIssueIds() {
  const ids = [];
  let cursor = null;
  do {
    const query = qs({ status: 'open', limit: 100, cursor });
    const data = await api(`/api/issues?${query}`);
    ids.push(...data.items.map((item) => item.id));
    cursor = data.nextCursor || null;
  } while (cursor);
  return ids;
}

async function ensureCompareAssets() {
  const missing = state.compareIds.filter((id) => !assetSnapshotById(id));
  await Promise.all(missing.map((id) => api(`/api/assets/${encodeURIComponent(id)}`).then((detail) => {
    cacheCompareAsset(detail.asset);
  }).catch(() => null)));
}

async function selectPage(page) {
  state.page = page;
  state.status = 'all';
  state.sidebarOpen = false;
  resetDrawer('page_change');
  if (page === 'compare' && !state.assets.items.length) await loadPaged('assets', '/api/assets', {}, true);
  if (page === 'compare') await ensureCompareAssets();
  await reloadAndRender(true);
}

async function markAssetSelection(assetId, nextState) {
  const selection = await api('/api/selections', {
    method: 'POST',
    body: JSON.stringify({ asset_id: assetId, state: nextState }),
  });
  updateAssetSelection(assetId, selection);
  return selection;
}

async function runExport(kind) {
  if (state.exportBusy) return;
  resetDrawer('export_busy');
  state.exportBusy = kind;
  state.exportResult = null;
  render();
  try {
    const result = await api(kind === 'pack' ? '/api/exports/pack' : '/api/exports/report', { method: 'POST' });
    state.exportResult = { kind, path: result.path, selected: result.selected };
    toast(kind === 'pack' ? '资产包清单已生成' : '工作台报告已生成', result.path || '');
    await refreshAll();
    resetDrawer('export_done');
  } finally {
    state.exportBusy = null;
    render();
  }
}

document.addEventListener('click', handleAsync(async (event) => {
  const drawerTrigger = event.target.closest('[data-open-summary], [data-asset], [data-run], [data-issue], [data-prompt], [data-job], [data-event], [data-export]');
  if (drawerTrigger && typeof drawerTrigger.focus === 'function') {
    drawerReturnFocus = drawerTrigger;
    drawerReturnFocusSelector = drawerFocusSelector(drawerTrigger);
  }

  const page = event.target.closest('[data-page]')?.dataset.page;
  if (page) {
    await selectPage(page);
    return;
  }

  if (event.target.closest('[data-close-drawer]')) {
    closeDrawer();
    return;
  }

  if (event.target.closest('[data-open-summary]')) {
    openSummaryDrawer();
    render();
    return;
  }

  if (event.target.closest('[data-close-sidebar]')) {
    state.sidebarOpen = false;
    render();
    return;
  }

  const filter = event.target.closest('[data-filter]')?.dataset.filter;
  if (filter) {
    state.status = filter;
    resetDrawer('filter_change');
    await reloadAndRender(true);
    return;
  }

  const viewMode = event.target.closest('[data-asset-view]')?.dataset.assetView;
  if (viewMode) {
    state.assetView = viewMode;
    resetDrawer('view_change');
    render();
    return;
  }

  if (event.target.closest('[data-bulk-mode]')) {
    state.bulkMode = !state.bulkMode;
    if (!state.bulkMode) state.bulkAssetIds = [];
    resetDrawer(state.bulkMode ? 'bulk_mode' : 'bulk_exit');
    render();
    return;
  }

  const bulkAssetId = event.target.closest('[data-bulk-asset]')?.dataset.bulkAsset;
  if (bulkAssetId) {
    toggleBulkAsset(bulkAssetId);
    render();
    return;
  }

  const bulkAction = event.target.closest('[data-bulk-action]')?.dataset.bulkAction;
  if (bulkAction) {
    const ids = [...state.bulkAssetIds];
    if (bulkAction === 'clear') {
      state.bulkAssetIds = [];
      resetDrawer('bulk_clear');
      render();
      return;
    }
    if (bulkAction === 'compare') {
      const result = addCompareIds(ids);
      if (!result.added.length) {
        toast(
          result.capacitySkipped ? '最多对比 9 张' : '未新增对比资产',
          result.capacitySkipped ? '请先移除一张再加入。' : `${result.duplicateSkipped} 个资产已在对比中。`
        );
      } else if (result.skipped) {
        toast('已部分加入对比', `新增 ${result.added.length} 个，已跳过 ${result.skipped} 个。`);
      } else {
        toast('已加入对比', `${result.added.length} 个资产`);
      }
      render();
      return;
    }
    await Promise.all(ids.map((id) => markAssetSelection(id, bulkAction)));
    toast(bulkAction === 'selected' ? '已批量标记已选' : '已批量标记不采用', `${ids.length} 个资产`);
    resetDrawer('bulk_done');
    await reloadAndRender(true);
    return;
  }

  const more = event.target.closest('[data-more]')?.dataset.more;
  if (more) {
    await reloadAndRender(false);
    return;
  }

  const compareId = event.target.closest('[data-compare-toggle]')?.dataset.compareToggle;
  if (compareId) {
    if (state.compareIds.includes(compareId)) {
      state.compareIds = state.compareIds.filter((id) => id !== compareId);
      toast('已移出对比');
      render();
      return;
    }
    if (state.compareIds.length >= 9) {
      toast('最多对比 9 张', '请先移除一张再加入。');
      return;
    }
    addCompareIds([compareId]);
    toast('已加入对比');
    render();
    return;
  }

  const resolveId = event.target.closest('[data-resolve]')?.dataset.resolve;
  if (resolveId) {
    await api(`/api/issues/${encodeURIComponent(resolveId)}/resolve`, { method: 'POST' });
    state.issues.items = state.issues.items.map((issue) => issue.id === resolveId ? { ...issue, status: 'resolved', resolved_at: new Date().toISOString() } : issue);
    if (state.drawer?.type === 'issue' && state.drawer.id === resolveId) resetDrawer('issue_resolved');
    await refreshProject();
    toast('问题已处理');
    render();
    await reloadAndRender(true);
    return;
  }

  const rerunIssue = event.target.closest('[data-rerun-issue]')?.dataset.rerunIssue;
  if (rerunIssue) {
    await api('/api/jobs/rerun', { method: 'POST', body: JSON.stringify({ source: 'issue', issue_ids: [rerunIssue] }) });
    toast('补跑任务已创建');
    await refreshAll();
    return;
  }

  const selectId = event.target.closest('[data-select-current]')?.dataset.selectCurrent;
  if (selectId) {
    await markAssetSelection(selectId, 'selected');
    toast('资产已选择');
    await refreshAll();
    renderAssetDrawer(await api(`/api/assets/${encodeURIComponent(selectId)}`));
    return;
  }

  const rejectId = event.target.closest('[data-reject-current]')?.dataset.rejectCurrent;
  if (rejectId) {
    await markAssetSelection(rejectId, 'rejected');
    toast('资产已标记不采用');
    await refreshAll();
    renderAssetDrawer(await api(`/api/assets/${encodeURIComponent(rejectId)}`));
    return;
  }

  const clearSelectionId = event.target.closest('[data-clear-selection]')?.dataset.clearSelection;
  if (clearSelectionId) {
    const selection = await api(`/api/selections/${encodeURIComponent(clearSelectionId)}`, { method: 'DELETE' });
    updateAssetSelection(clearSelectionId, selection);
    toast('资产已恢复待选择');
    await refreshAll();
    renderAssetDrawer(await api(`/api/assets/${encodeURIComponent(clearSelectionId)}`));
    return;
  }

  const copyId = event.target.closest('[data-copy]')?.dataset.copy;
  if (copyId) {
    const prompt = state.prompts.items.find((item) => item.id === copyId);
    await navigator.clipboard.writeText(prompt?.prompt_text || '');
    state.copiedPromptId = copyId;
    toast('提示词已复制');
    render();
    return;
  }

  if (event.target.closest('[data-toggle-prompt]')) {
    state.expandedPrompt = !state.expandedPrompt;
    render();
    return;
  }

  const rerunPrompt = event.target.closest('[data-rerun-prompt]')?.dataset.rerunPrompt;
  if (rerunPrompt) {
    await api('/api/jobs/rerun', { method: 'POST', body: JSON.stringify({ source: 'prompt', prompt_ids: [rerunPrompt] }) });
    toast('补跑任务已创建');
    await refreshAll();
    return;
  }

  if (event.target.id === 'packButton') {
    await runExport('pack');
    return;
  }

  if (event.target.closest('[data-export-report]')) {
    await runExport('report');
    return;
  }

  const assetId = event.target.closest('[data-asset]')?.dataset.asset;
  if (assetId) {
    renderAssetDrawer(await api(`/api/assets/${encodeURIComponent(assetId)}`));
    return;
  }

  const runId = event.target.closest('[data-run]')?.dataset.run;
  if (runId) {
    renderInspector(state.runs.items.find((run) => run.id === runId), 'run');
    return;
  }

  const issueId = event.target.closest('[data-issue]')?.dataset.issue;
  if (issueId) {
    renderInspector(state.issues.items.find((issue) => issue.id === issueId), 'issue');
    return;
  }

  const promptId = event.target.closest('[data-prompt]')?.dataset.prompt;
  if (promptId) {
    state.promptFocusId = promptId;
    state.expandedPrompt = false;
    renderInspector(state.prompts.items.find((prompt) => prompt.id === promptId), 'prompt');
    return;
  }

  const jobId = event.target.closest('[data-job]')?.dataset.job;
  if (jobId) {
    renderInspector(await api(`/api/jobs/${encodeURIComponent(jobId)}`), 'job');
    return;
  }

  const eventId = event.target.closest('[data-event]')?.dataset.event;
  if (eventId) {
    renderInspector(state.events.items.find((item) => item.id === eventId), 'event');
    return;
  }

  const exportId = event.target.closest('[data-export]')?.dataset.export;
  if (exportId) {
    renderInspector(state.exports.find((item) => item.id === exportId), 'export');
  }
}));

document.addEventListener('keydown', handleAsync(async (event) => {
  if (event.key === 'Escape' && state.drawer.open) {
    event.preventDefault();
    closeDrawer();
    return;
  }
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const actionable = event.target.closest('[data-asset], [data-run], [data-issue], [data-prompt], [data-export]');
  if (!actionable || event.target.closest('button, input, textarea, select')) return;
  event.preventDefault();
  actionable.click();
}));

document.addEventListener('submit', handleAsync(async (event) => {
  const form = event.target.closest('[data-tag-form]');
  if (!form) return;
  event.preventDefault();
  const assetId = form.dataset.tagForm;
  const tag = new FormData(form).get('tag');
  await api(`/api/assets/${encodeURIComponent(assetId)}/tags`, { method: 'POST', body: JSON.stringify({ name: tag }) });
  form.reset();
  toast('标签已添加');
  renderAssetDrawer(await api(`/api/assets/${encodeURIComponent(assetId)}`));
}));

document.addEventListener('change', handleAsync(async (event) => {
  const assetField = event.target.closest('[data-asset-filter]')?.dataset.assetFilter;
  if (assetField) {
    state[assetField] = event.target.value;
    resetDrawer('asset_filter_change');
    await reloadAndRender(true);
    return;
  }
  if (event.target.closest('[data-run-filter]')) {
    state.runFilter = event.target.value;
    state.promptFocusId = null;
    resetDrawer('prompt_filter_change');
    await reloadAndRender(true);
  }
}));

let searchTimer = null;
$('globalSearch').addEventListener('input', (event) => {
  state.query = event.target.value;
  resetDrawer('search');
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => reloadAndRender(true).catch(showError), 220);
});

$('menuButton').addEventListener('click', () => {
  state.sidebarOpen = !state.sidebarOpen;
  updateShell();
});

$('refreshButton').addEventListener('click', handleAsync(async () => {
  resetDrawer('refresh');
  await refreshAll();
  toast('已刷新');
}));

$('rerunButton').addEventListener('click', handleAsync(async () => {
  const issueIds = await fetchOpenIssueIds();
  if (!issueIds.length) {
    toast('没有可补跑问题', '当前没有未处理问题。');
    return;
  }
  await api('/api/jobs/rerun', { method: 'POST', body: JSON.stringify({ source: 'workbench', issue_ids: issueIds }) });
  toast('补跑任务已创建', `${issueIds.length} 个问题进入队列`);
  await refreshAll();
}));

$('exportButton').addEventListener('click', handleAsync(async () => {
  state.page = 'exports';
  resetDrawer('command_export');
  await runExport('report');
}));

render();
refreshAll().catch(showError);
