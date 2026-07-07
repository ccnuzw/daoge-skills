const NAV_ITEMS = [
  ['dashboard', '项目'],
  ['runs', '任务'],
  ['assets', '资产'],
  ['issues', '问题'],
  ['prompts', '提示词'],
  ['compare', '对比'],
  ['exports', '导出'],
];

const pageState = () => ({ items: [], nextCursor: null, total: 0, loading: false });

const state = {
  page: 'dashboard',
  query: '',
  status: 'all',
  kind: 'all',
  selectedFilter: 'all',
  density: 'comfortable',
  runFilter: 'all',
  project: null,
  runs: pageState(),
  assets: pageState(),
  issues: pageState(),
  events: pageState(),
  jobs: pageState(),
  prompts: pageState(),
  exports: [],
  selected: null,
  compareIds: [],
};

const $ = (id) => document.getElementById(id);

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
    const detail = text ? `：${text.slice(0, 160)}` : '';
    throw new Error(`请求失败 ${res.status}${detail}`);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`请求失败 ${res.status}：响应不是有效 JSON`);
  }
  if (!res.ok) throw new Error(data.error?.message || `请求失败 ${res.status}`);
  if (!data.ok) throw new Error(data.error?.message || '请求失败');
  return data.data;
}

async function loadPaged(name, path, params = {}, reset = true) {
  const bucket = state[name];
  if (bucket.loading) return bucket;
  bucket.loading = true;
  try {
    const cursor = reset ? null : bucket.nextCursor;
    const query = qs({ limit: 60, cursor, ...params });
    const data = await api(`${path}${query ? `?${query}` : ''}`);
    bucket.items = reset ? data.items : [...bucket.items, ...data.items];
    bucket.nextCursor = data.nextCursor || null;
    bucket.total = data.total ?? bucket.items.length;
    return bucket;
  } finally {
    bucket.loading = false;
  }
}

function setHead(title, subtitle, filters = []) {
  $('pageTitle').textContent = title;
  $('pageSubtitle').textContent = subtitle;
  $('statusFilters').innerHTML = filters.map(([id, label]) => (
    `<button type="button" data-filter="${escapeHtml(id)}" class="${state.status === id ? 'active' : ''}">${escapeHtml(label)}</button>`
  )).join('');
}

function renderNav() {
  $('nav').innerHTML = NAV_ITEMS.map(([id, label]) => (
    `<button type="button" data-page="${id}" class="${state.page === id ? 'active' : ''}">${escapeHtml(label)}</button>`
  )).join('');
}

function metric(label, value) {
  return `<div class="metric"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
}

function moreButton(bucket, key) {
  return bucket.nextCursor ? `<button class="load-more" data-more="${key}" type="button">加载更多</button>` : '';
}

function renderDashboard() {
  const counts = state.project?.counts || {};
  setHead('总览', state.project?.project?.name || '本地项目', []);
  const recentRuns = state.runs.items.slice(0, 6);
  $('view').innerHTML = `
    <div class="metric-grid">
      ${metric('任务批次', counts.runs || 0)}
      ${metric('提示词', counts.prompts || 0)}
      ${metric('资产', counts.assets || 0)}
      ${metric('未处理问题', counts.open_issues || 0)}
      ${metric('已选资产', counts.selections || 0)}
    </div>
    <table class="table">
      <thead><tr><th>最近任务</th><th>阶段</th><th>状态</th><th>成功</th><th>失败</th><th>时间</th></tr></thead>
      <tbody>
        ${recentRuns.length ? recentRuns.map((run) => `
          <tr data-run="${escapeHtml(run.id)}">
            <td>${escapeHtml(run.title || run.id)}</td>
            <td>${escapeHtml(run.phase)}</td>
            <td>${escapeHtml(run.status)}</td>
            <td>${escapeHtml(run.success_count)}</td>
            <td>${escapeHtml(run.failed_count)}</td>
            <td>${escapeHtml(run.updated_at)}</td>
          </tr>
        `).join('') : '<tr><td colspan="6">还没有任务记录。</td></tr>'}
      </tbody>
    </table>
  `;
}

function assetThumb(asset) {
  if (String(asset.mime || '').startsWith('image/') && asset.thumb_status === 'ready') {
    return `<img src="/api/assets/${encodeURIComponent(asset.id)}/thumb" alt="" loading="lazy">`;
  }
  return `<span>${escapeHtml(asset.thumb_status === 'missing' ? '无缩略图' : asset.kind)}</span>`;
}

function filterPanel() {
  return `
    <aside class="filter-panel">
      <label>类型
        <select data-asset-filter="kind">
          ${[
            ['all', '全部'], ['result', '结果图'], ['reference', '参考图'], ['input', '输入素材'], ['export', '导出文件'], ['issue', '问题记录'],
          ].map(([value, label]) => `<option value="${value}" ${state.kind === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      <label>选择状态
        <select data-asset-filter="selectedFilter">
          <option value="all" ${state.selectedFilter === 'all' ? 'selected' : ''}>全部</option>
          <option value="true" ${state.selectedFilter === 'true' ? 'selected' : ''}>已选择</option>
          <option value="false" ${state.selectedFilter === 'false' ? 'selected' : ''}>未选择</option>
        </select>
      </label>
      <label>网格密度
        <select data-asset-filter="density">
          <option value="comfortable" ${state.density === 'comfortable' ? 'selected' : ''}>舒适</option>
          <option value="compact" ${state.density === 'compact' ? 'selected' : ''}>紧凑</option>
        </select>
      </label>
    </aside>
  `;
}

function renderAssets() {
  const filters = [['all', '全部'], ['ready_for_selection', '可筛选'], ['needs_attention', '需处理'], ['needs_review', '待复核']];
  setHead('资产库', `服务端筛选，已加载 ${state.assets.items.length}/${state.assets.total || state.assets.items.length}`, filters);
  const cards = state.assets.items.map((asset) => {
    const inCompare = state.compareIds.includes(asset.id);
    return `
      <article class="asset-card ${inCompare ? 'selected' : ''}" data-asset="${escapeHtml(asset.id)}">
        <button class="compare-toggle" data-compare-toggle="${escapeHtml(asset.id)}" type="button">${inCompare ? '✓' : '+'}</button>
        <div class="thumb">${assetThumb(asset)}</div>
        <div class="asset-body">
          <div class="asset-title">${escapeHtml(asset.title)}</div>
          <div class="asset-meta"><span>${escapeHtml(asset.kind)}</span><span>${escapeHtml(asset.user_status || asset.status)}</span></div>
        </div>
      </article>
    `;
  }).join('');
  $('view').innerHTML = `
    <div class="asset-layout">
      ${filterPanel()}
      <section class="asset-results">
        <div class="asset-toolbar">
          <span>${state.compareIds.length} 张进入对比</span>
          <button class="small-button" data-page="compare" type="button">打开对比</button>
        </div>
        <div class="grid ${state.density === 'compact' ? 'compact' : ''}">${cards || '<div class="empty">没有符合条件的资产。</div>'}</div>
        ${moreButton(state.assets, 'assets')}
      </section>
    </div>
  `;
}

function renderRuns() {
  setHead('任务记录', `已加载 ${state.runs.items.length}/${state.runs.total || state.runs.items.length}`, []);
  $('view').innerHTML = `
    <table class="table">
      <thead><tr><th>任务</th><th>阶段</th><th>状态</th><th>服务</th><th>成功/失败/跳过</th><th>时间</th></tr></thead>
      <tbody>${state.runs.items.map((run) => `
        <tr data-run="${escapeHtml(run.id)}">
          <td>${escapeHtml(run.title || run.id)}</td>
          <td>${escapeHtml(run.phase)}</td>
          <td>${escapeHtml(run.status)}</td>
          <td>${escapeHtml(run.provider || '-')}</td>
          <td>${run.success_count}/${run.failed_count}/${run.skipped_count}</td>
          <td>${escapeHtml(run.updated_at)}</td>
        </tr>
      `).join('') || '<tr><td colspan="6">还没有任务记录。</td></tr>'}</tbody>
    </table>
    ${moreButton(state.runs, 'runs')}
  `;
}

function issueGroup(issue) {
  if (issue.status === 'resolved') return '已处理';
  if (issue.rerunnable) return '可补跑';
  if (issue.severity === 'blocking' || issue.blocking) return '必须处理';
  return '待复核';
}

function renderIssues() {
  const filters = [['all', '全部'], ['open', '未处理'], ['resolved', '已处理']];
  setHead('问题中心', `按处理方式分组，已加载 ${state.issues.items.length}/${state.issues.total || state.issues.items.length}`, filters);
  const groups = ['必须处理', '可补跑', '待复核', '已处理'].map((name) => {
    const items = state.issues.items.filter((issue) => issueGroup(issue) === name);
    return `
      <section class="issue-group">
        <h2>${name}<span>${items.length}</span></h2>
        <table class="table">
          <tbody>${items.map((issue) => `
            <tr data-issue="${escapeHtml(issue.id)}">
              <td>${escapeHtml(issue.title)}</td>
              <td>${escapeHtml(issue.message || '-')}</td>
              <td>${escapeHtml(issue.recommended_action || '-')}</td>
              <td>${escapeHtml(issue.status)}</td>
              <td class="row-action"><button class="small-button" data-resolve="${escapeHtml(issue.id)}">标记处理</button></td>
            </tr>
          `).join('') || '<tr><td>暂无</td></tr>'}</tbody>
        </table>
      </section>
    `;
  }).join('');
  $('view').innerHTML = `${groups}${moreButton(state.issues, 'issues')}`;
}

function renderPrompts() {
  setHead('提示词实验室', `按任务查看、复制、派生补跑，已加载 ${state.prompts.items.length}/${state.prompts.total || state.prompts.items.length}`, []);
  const runOptions = state.runs.items.map((run) => `<option value="${escapeHtml(run.id)}" ${state.runFilter === run.id ? 'selected' : ''}>${escapeHtml(run.title || run.id)}</option>`).join('');
  $('view').innerHTML = `
    <div class="prompt-tools">
      <label>任务
        <select data-run-filter>
          <option value="all" ${state.runFilter === 'all' ? 'selected' : ''}>全部任务</option>
          ${runOptions}
        </select>
      </label>
    </div>
    <table class="table">
      <thead><tr><th>编号</th><th>标题</th><th>提示词</th><th></th></tr></thead>
      <tbody>${state.prompts.items.map((prompt) => `
        <tr data-prompt="${escapeHtml(prompt.id)}">
          <td>${escapeHtml(prompt.prompt_index)}</td>
          <td>${escapeHtml(prompt.title)}</td>
          <td>${escapeHtml(prompt.prompt_text).slice(0, 220)}</td>
          <td class="row-action">
            <button class="small-button" data-copy="${escapeHtml(prompt.id)}">复制</button>
            <button class="small-button" data-rerun-prompt="${escapeHtml(prompt.id)}">补跑</button>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="4">还没有提示词。</td></tr>'}</tbody>
    </table>
    ${moreButton(state.prompts, 'prompts')}
  `;
}

function renderCompare() {
  setHead('对比视图', '支持 2、4、9 张图一起看，选出赢家', []);
  const assets = state.compareIds.map((id) => state.assets.items.find((asset) => asset.id === id)).filter(Boolean).slice(0, 9);
  $('view').innerHTML = assets.length ? `
    <div class="compare-grid count-${Math.min(assets.length, 9)}">
      ${assets.map((asset) => `
        <article class="compare-card" data-asset="${escapeHtml(asset.id)}">
          <div class="thumb">${assetThumb(asset)}</div>
          <div class="asset-title">${escapeHtml(asset.title)}</div>
          <button class="primary-button" data-select-current="${escapeHtml(asset.id)}" type="button">选为赢家</button>
        </article>
      `).join('')}
    </div>
  ` : '<div class="empty">在资产库点 + 加入对比。</div>';
}

function renderExports() {
  setHead('导出中心', '生成报告和已选资产包清单', []);
  $('view').innerHTML = `
    <div class="export-actions">
      <button class="primary-button" id="packButton" type="button">生成已选资产包</button>
    </div>
    <table class="table">
      <thead><tr><th>名称</th><th>类型</th><th>状态</th><th>路径</th><th>时间</th></tr></thead>
      <tbody>${state.exports.map((item) => `
        <tr>
          <td>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(item.kind)}</td>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(item.path || '-')}</td>
          <td>${escapeHtml(item.updated_at)}</td>
        </tr>
      `).join('') || '<tr><td colspan="5">还没有导出记录。</td></tr>'}</tbody>
    </table>
  `;
}

function detailRows(item, keys) {
  return keys.map(([key, label]) => `
    <div class="detail-row">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value">${escapeHtml(typeof item?.[key] === 'object' ? JSON.stringify(item[key], null, 2) : item?.[key] || '-')}</div>
    </div>
  `).join('');
}

function renderAssetInspector(detail) {
  const asset = detail.asset;
  state.selected = asset;
  const tags = detail.tags?.map((tag) => tag.name).join('、') || '无';
  const run = detail.runs?.[0];
  $('inspector').innerHTML = `
    <h2>${escapeHtml(asset.title || asset.id)}</h2>
    <div class="inspector-preview">${assetThumb(asset)}</div>
    <div class="detail-actions">
      <button class="primary-button" data-select-current="${escapeHtml(asset.id)}">选择</button>
      <button class="ghost-button" data-reject-current="${escapeHtml(asset.id)}">不采用</button>
    </div>
    <form class="tag-form" data-tag-form="${escapeHtml(asset.id)}">
      <input name="tag" placeholder="添加标签">
      <button class="small-button" type="submit">添加</button>
    </form>
    <div class="detail">
      ${detailRows(asset, [['path', '文件路径'], ['status', '状态'], ['kind', '类型'], ['width', '宽度'], ['height', '高度'], ['sha256', '文件指纹'], ['notes', '备注']])}
      <div class="detail-row"><div class="detail-label">标签</div><div class="detail-value">${escapeHtml(tags)}</div></div>
      <div class="detail-row"><div class="detail-label">来源任务</div><div class="detail-value">${escapeHtml(run ? `${run.run_title || run.run_id} / ${run.run_phase}` : '-')}</div></div>
      <div class="detail-row"><div class="detail-label">提示词</div><div class="detail-value">${escapeHtml(detail.prompt?.prompt_text || '-')}</div></div>
      <div class="detail-row"><div class="detail-label">生成参数</div><div class="detail-value">${escapeHtml(JSON.stringify(detail.prompt?.params || detail.runItem?.raw || {}, null, 2))}</div></div>
      <div class="detail-row"><div class="detail-label">血缘</div><div class="detail-value">${escapeHtml((detail.links || []).map((link) => `${link.source_type}:${link.source_id} → ${link.target_type}:${link.target_id}（${link.relation}）`).join('\n') || '-')}</div></div>
    </div>
  `;
}

function renderInspector(item, type) {
  state.selected = item;
  if (!item) {
    $('inspector').innerHTML = '<div class="inspector-empty">选择资产、任务或问题后查看详情。</div>';
    return;
  }
  const rows = Object.entries(item)
    .filter(([key]) => !['metadata', 'raw', 'params'].includes(key))
    .slice(0, 18)
    .map(([key, value]) => `
      <div class="detail-row">
        <div class="detail-label">${escapeHtml(key)}</div>
        <div class="detail-value">${escapeHtml(typeof value === 'object' ? JSON.stringify(value, null, 2) : value)}</div>
      </div>
    `).join('');
  $('inspector').innerHTML = `<h2>${escapeHtml(item.title || item.name || item.id)}</h2><div class="detail">${rows}</div>`;
}

function renderEvents() {
  $('eventLog').innerHTML = state.events.items.slice(0, 8).map((event) => (
    `<div class="event-pill">${escapeHtml(event.message || event.event_type)}</div>`
  )).join('');
  const active = state.jobs.items.find((job) => ['queued', 'running', 'failed'].includes(job.status));
  $('jobSummary').innerHTML = active
    ? `<button class="job-button" data-job="${escapeHtml(active.id)}">${escapeHtml(active.kind)}：${escapeHtml(active.status)}${active.error ? `，${escapeHtml(active.error)}` : ''}</button>`
    : '队列空闲';
}

function render() {
  renderNav();
  if (state.page === 'dashboard') renderDashboard();
  if (state.page === 'assets') renderAssets();
  if (state.page === 'runs') renderRuns();
  if (state.page === 'issues') renderIssues();
  if (state.page === 'prompts') renderPrompts();
  if (state.page === 'compare') renderCompare();
  if (state.page === 'exports') renderExports();
  renderEvents();
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
  } else if (state.page === 'exports') {
    state.exports = await api('/api/exports');
  }
}

async function refreshAll() {
  const [health, project] = await Promise.all([api('/api/health'), api('/api/project')]);
  state.project = project;
  await Promise.all([
    loadPaged('runs', '/api/runs', {}, true),
    loadPaged('assets', '/api/assets', {}, true),
    loadPaged('issues', '/api/issues', {}, true),
    loadPaged('events', '/api/events', { limit: 20 }, true),
    loadPaged('jobs', '/api/jobs', {}, true),
    loadPaged('prompts', '/api/prompts', {}, true),
    api('/api/exports').then((items) => { state.exports = items; }),
  ]);
  $('healthDot').classList.toggle('ok', health.status === 'ok');
  render();
}

async function reloadAndRender(reset = true) {
  await loadCurrent(reset);
  if (['assets', 'issues', 'prompts'].includes(state.page)) {
    await loadPaged('events', '/api/events', { limit: 20 }, true);
    await loadPaged('jobs', '/api/jobs', {}, true);
  }
  render();
}

function handleAsync(fn) {
  return (event) => {
    Promise.resolve(fn(event)).catch(showError);
  };
}

document.addEventListener('click', handleAsync(async (event) => {
  const page = event.target.closest('[data-page]')?.dataset.page;
  if (page) {
    state.page = page;
    state.status = 'all';
    await reloadAndRender(true);
    return;
  }
  const filter = event.target.closest('[data-filter]')?.dataset.filter;
  if (filter) {
    state.status = filter;
    await reloadAndRender(true);
    return;
  }
  const more = event.target.closest('[data-more]')?.dataset.more;
  if (more) {
    await loadCurrent(false);
    render();
    return;
  }
  const compareId = event.target.closest('[data-compare-toggle]')?.dataset.compareToggle;
  if (compareId) {
    state.compareIds = state.compareIds.includes(compareId)
      ? state.compareIds.filter((id) => id !== compareId)
      : [...state.compareIds, compareId].slice(0, 9);
    render();
    return;
  }
  const resolveId = event.target.closest('[data-resolve]')?.dataset.resolve;
  if (resolveId) {
    await api(`/api/issues/${encodeURIComponent(resolveId)}/resolve`, { method: 'POST' });
    await refreshAll();
    return;
  }
  const selectId = event.target.closest('[data-select-current]')?.dataset.selectCurrent;
  if (selectId) {
    await api('/api/selections', { method: 'POST', body: JSON.stringify({ asset_id: selectId, state: 'selected' }) });
    await refreshAll();
    return;
  }
  const rejectId = event.target.closest('[data-reject-current]')?.dataset.rejectCurrent;
  if (rejectId) {
    await api('/api/selections', { method: 'POST', body: JSON.stringify({ asset_id: rejectId, state: 'rejected' }) });
    await refreshAll();
    return;
  }
  const copyId = event.target.closest('[data-copy]')?.dataset.copy;
  if (copyId) {
    const prompt = state.prompts.items.find((item) => item.id === copyId);
    await navigator.clipboard.writeText(prompt?.prompt_text || '');
    return;
  }
  const rerunPrompt = event.target.closest('[data-rerun-prompt]')?.dataset.rerunPrompt;
  if (rerunPrompt) {
    await api('/api/jobs/rerun', { method: 'POST', body: JSON.stringify({ source: 'prompt', prompt_ids: [rerunPrompt] }) });
    await refreshAll();
    return;
  }
  if (event.target.id === 'packButton') {
    await api('/api/exports/pack', { method: 'POST' });
    await refreshAll();
    return;
  }
  const assetId = event.target.closest('[data-asset]')?.dataset.asset;
  if (assetId) {
    renderAssetInspector(await api(`/api/assets/${encodeURIComponent(assetId)}`));
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
    renderInspector(state.prompts.items.find((prompt) => prompt.id === promptId), 'prompt');
    return;
  }
  const jobId = event.target.closest('[data-job]')?.dataset.job;
  if (jobId) {
    renderInspector(await api(`/api/jobs/${encodeURIComponent(jobId)}`), 'job');
  }
}));

document.addEventListener('submit', handleAsync(async (event) => {
  const form = event.target.closest('[data-tag-form]');
  if (!form) return;
  event.preventDefault();
  const assetId = form.dataset.tagForm;
  const tag = new FormData(form).get('tag');
  await api(`/api/assets/${encodeURIComponent(assetId)}/tags`, { method: 'POST', body: JSON.stringify({ name: tag }) });
  form.reset();
  renderAssetInspector(await api(`/api/assets/${encodeURIComponent(assetId)}`));
}));

document.addEventListener('change', handleAsync(async (event) => {
  const assetField = event.target.closest('[data-asset-filter]')?.dataset.assetFilter;
  if (assetField) {
    state[assetField] = event.target.value;
    await reloadAndRender(true);
    return;
  }
  if (event.target.closest('[data-run-filter]')) {
    state.runFilter = event.target.value;
    await reloadAndRender(true);
  }
}));

let searchTimer = null;
$('globalSearch').addEventListener('input', (event) => {
  state.query = event.target.value;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => reloadAndRender(true).catch(showError), 220);
});

$('rerunButton').addEventListener('click', handleAsync(async () => {
  await api('/api/jobs/rerun', {
    method: 'POST',
    body: JSON.stringify({ source: 'workbench', issue_ids: state.issues.items.filter((item) => item.status === 'open').map((item) => item.id) }),
  });
  await refreshAll();
}));

$('exportButton').addEventListener('click', handleAsync(async () => {
  await api('/api/exports/report', { method: 'POST' });
  state.page = 'exports';
  await refreshAll();
}));

function showError(error) {
  $('healthDot').classList.remove('ok');
  $('view').innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
}

refreshAll().catch(showError);
