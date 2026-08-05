const fs = require('fs');
const path = require('path');
const {
  parseArgs,
  readJson,
  ensureDir,
  escapeHtml,
  assertNoUserFacingInternalTerms,
} = require('../shared/workspace');

const MAX_RENDERED_ASSET_CARDS = 120;

function renderList(items, emptyText) {
  const values = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!values.length) return `<p class="muted">${escapeHtml(emptyText)}</p>`;
  return `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderReplySuggestions(items) {
  return `<div class="reply-list">${(items || []).map((item) => `<code>${escapeHtml(item)}</code>`).join('')}</div>`;
}

function renderAction(action, className = 'action-link') {
  if (!action) return '';
  const href = action.href || action.targetPage || '#';
  const disabled = action.enabled === false;
  const tag = disabled ? 'span' : 'a';
  const attrs = disabled ? `class="${className} disabled"` : `class="${className}" href="${escapeHtml(href)}"`;
  const reason = disabled && action.disabledReason ? action.disabledReason : action.reason;
  return `<${tag} ${attrs}><strong>${escapeHtml(action.label)}</strong><span>${escapeHtml(reason)}</span></${tag}>`;
}

function renderSecondaryActions(actions) {
  const values = (Array.isArray(actions) ? actions : []).filter(Boolean);
  if (!values.length) return '';
  return `<div class="secondary-actions">${values.map((item) => renderAction(item, 'mini-action')).join('')}</div>`;
}

function renderPrimaryAction(action) {
  if (!action) return '';
  const disabled = action.enabled === false;
  const content = `
            <strong>${escapeHtml(action.label)}</strong>
            <p>${escapeHtml(disabled && action.disabledReason ? action.disabledReason : action.reason)}</p>
            <code>${escapeHtml(action.reply)}</code>
            ${disabled ? '<span class="go disabled">不可用</span>' : '<span class="go">打开</span>'}
  `;
  if (disabled) return `<span class="primary-action disabled">${content}</span>`;
  const href = action.href || action.targetPage || '#';
  return `<a class="primary-action" href="${escapeHtml(href)}">${content}</a>`;
}

function renderAssets(assets, emptyText, options = {}) {
  if (!assets.length) return `<p class="muted">${escapeHtml(emptyText)}</p>`;
  const visible = assets.slice(0, MAX_RENDERED_ASSET_CARDS);
  const hiddenCount = assets.length - visible.length;
  const directoryPath = options.directoryPath || '';
  const summary = hiddenCount > 0
    ? `<p class="muted">已显示前 ${visible.length} 个，另有 ${hiddenCount} 个在 <a href="../${escapeHtml(directoryPath)}">${escapeHtml(directoryPath)}</a>。</p>`
    : '';
  return `${summary}<div class="asset-grid">${visible.map((asset) => {
    const image = asset.previewPath && !asset.path.endsWith('.json')
      ? `<a class="thumb" href="../${escapeHtml(asset.path)}"><img src="../${escapeHtml(asset.previewPath)}" alt="${escapeHtml(asset.userTitle)}" loading="lazy"></a>`
      : '<div class="thumb empty"></div>';
    const openLabel = asset.previewPath ? '打开图片' : '打开文件';
    return `<article class="asset-card">${image}<h3>${escapeHtml(asset.userTitle)}</h3><p class="status">${escapeHtml(asset.userStatus)}</p><p>${escapeHtml(asset.userPurpose || '当前任务资产')}</p><p class="muted">${escapeHtml(asset.sourceReason || '')}</p><strong>${escapeHtml(asset.userAction || '按页面建议处理')}</strong>${asset.path && !asset.path.endsWith('.json') ? `<a href="../${escapeHtml(asset.path)}">${openLabel}</a>` : ''}</article>`;
  }).join('')}</div>`;
}

function renderIssueActions(actions) {
  const values = (Array.isArray(actions) ? actions : []).filter(Boolean).slice(0, 4);
  if (!values.length) return '';
  return `<div class="issue-actions">${values.map((item) => renderAction(item, 'mini-action')).join('')}</div>`;
}

function renderIssueSummary(summary = {}) {
  const items = [
    `${Number(summary.mustHandle || 0)} 个必须处理`,
    `${Number(summary.worthRerun || 0)} 个可补跑`,
    `${Number(summary.needsMaterial || 0)} 个要先补素材`,
    `${Number(summary.needsConfirmation || 0)} 个只需复核`,
    `${Number(summary.safeToIgnore || 0)} 个可按缺口忽略`,
  ];
  return `<section class="panel"><h2>问题概览</h2><div class="metrics">${items.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div></section>`;
}

function renderIssueGroups(groups, summary = {}) {
  if (!groups.length) return '<p class="muted">当前没有需要处理的问题。</p>';
  return `${renderIssueSummary(summary)}${groups.map((group) => `
    <section class="panel">
      <h2>${escapeHtml(group.title)}</h2>
      ${group.items.length ? group.items.map((item) => `
        <article class="issue-card">
          <h3>${escapeHtml(item.userTitle || item.title)}</h3>
          <p>${escapeHtml(item.userMessage || item.userImpact || item.impact)}</p>
          <p class="muted">${escapeHtml(item.rerunnable ? `可补跑：${item.rerunReason || '适合只补这一张'}` : (item.safeToIgnore ? '可忽略：不影响关键交付时可以接受缺口。' : '不可直接补跑：需要先处理原因。'))}</p>
          <strong>${escapeHtml(item.userAction || item.recommendedAction)}</strong>
          ${renderIssueActions(item.availableActions)}
        </article>
      `).join('') : '<p class="muted">暂无。</p>'}
    </section>
  `).join('')}`;
}

function renderPageBody(vm) {
  if (vm.pageId === 'prepare') {
    return `
      <section class="panel">
        <h2>${vm.readiness.canRun ? '可以开跑' : '先补准备'}</h2>
        <p>${escapeHtml(vm.decision.summary || '')}</p>
        <div class="metrics"><span>${vm.readiness.promptCount} 条提示词</span><span>${vm.readiness.batchCount} 轮执行</span><span>${vm.readiness.canRun ? '准备可执行' : '准备未完成'}</span></div>
      </section>
      <section class="panel"><h2>还缺什么</h2>${renderList(vm.readiness.blockingItems, '没有必须补齐的项目。')}</section>
      <section class="panel"><h2>提醒</h2>${renderList([...vm.readiness.attentionItems, ...vm.readiness.materialNotes], '当前没有额外提醒。')}</section>
    `;
  }
  if (vm.pageId === 'results') {
    return `
      <section class="panel"><h2>可筛选结果</h2>${renderAssets(vm.assets.ready, '当前还没有可筛选结果。', { directoryPath: 'assets/results/' })}</section>
      <section class="panel"><h2>推荐优先看</h2>${renderAssets(vm.assets.selected, '当前没有推荐候选。', { directoryPath: 'assets/selected/' })}</section>
      <section class="panel"><h2>交付候选</h2>${renderAssets(vm.assets.exports, '当前还没有交付候选。', { directoryPath: 'assets/exports/selected_images/' })}</section>
      <section class="panel"><h2>建议复核</h2>${renderAssets(vm.assets.review, '当前没有建议复核的结果。', { directoryPath: 'assets/review/' })}</section>
      <section class="panel"><h2>失败和补跑</h2><p>${escapeHtml(vm.worthRerunCount ? `${vm.worthRerunCount} 个结果值得补跑。` : '当前没有明确补跑压力。')}</p>${renderAssets(vm.assets.issues, '当前没有失败记录。', { directoryPath: 'assets/issues/' })}</section>
    `;
  }
  if (vm.pageId === 'issues') {
    return renderIssueGroups(vm.issueGroups, vm.issueSummary);
  }
  if (vm.pageId === 'record') {
    return `
      <section class="panel"><h2>这轮做了什么</h2><p>${escapeHtml(vm.record.did)}</p></section>
      <section class="panel"><h2>最终状态</h2><p>${escapeHtml(vm.record.finalStatus)}</p></section>
      <section class="panel"><h2>资产位置</h2>${renderList(vm.record.assetLocations.map((item) => `${item.label}: ${item.path}`), '暂无资产位置。')}</section>
      <section class="panel"><h2>下次继续</h2><code>${escapeHtml(vm.record.continueText)}</code></section>
    `;
  }
  return (vm.sections || []).map((section) => `
    <section class="panel">
      <h2>${escapeHtml(section.title)}</h2>
      <p>${escapeHtml(section.body)}</p>
    </section>
  `).join('');
}

function renderWorkspacePage(vm) {
  const nav = (vm.nav || []).map((item) => `<a class="${item.current ? 'current' : ''}" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`).join('');
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(vm.task.title)} - ${escapeHtml(vm.title)}</title>
  <style>
    :root { color-scheme: light; --ink:#202124; --muted:#5f6368; --line:#d7d9de; --soft:#f6f7f9; --accent:#0f766e; --warn:#a15c00; --bad:#b3261e; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:#fff; line-height:1.55; }
    header { border-bottom:1px solid var(--line); background:#fafafa; }
    .wrap { max-width:1120px; margin:0 auto; padding:24px; }
    nav { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:22px; }
    nav a { color:var(--muted); text-decoration:none; border:1px solid var(--line); padding:7px 11px; border-radius:6px; font-size:14px; }
    nav a.current { color:#fff; background:var(--accent); border-color:var(--accent); }
    h1 { font-size:34px; margin:0 0 8px; letter-spacing:0; }
    h2 { font-size:18px; margin:0 0 12px; letter-spacing:0; }
    h3 { font-size:15px; margin:10px 0 4px; letter-spacing:0; }
    p { margin:0 0 10px; }
    .hero { display:flex; gap:24px; align-items:flex-end; }
    .hero > div { flex:1 1 520px; min-width:0; }
    .hero > aside { flex:0 0 280px; }
    .summary { color:var(--muted); max-width:760px; }
    .action { border:2px solid var(--accent); border-radius:8px; padding:16px; background:#f2fbf9; }
    .action strong { display:block; font-size:20px; margin-bottom:4px; }
    .action .primary-action { color:inherit; text-decoration:none; display:block; }
    .action .primary-action.disabled { color:var(--muted); }
    .action .go { display:inline-block; margin-top:10px; color:#fff; background:var(--accent); padding:8px 10px; border-radius:6px; }
    .action .go.disabled { background:var(--muted); }
    .grid { display:flex; flex-wrap:wrap; gap:16px; margin-top:20px; }
    .grid > .panel { flex:1 1 420px; }
    .panel { border:1px solid var(--line); border-radius:8px; padding:18px; background:#fff; min-width:0; }
    .muted { color:var(--muted); }
    .reply-list { display:flex; flex-wrap:wrap; gap:8px; }
    code { display:inline-block; color:#17443f; background:#eef7f5; border:1px solid #c6e7df; border-radius:6px; padding:5px 8px; white-space:normal; }
    .secondary-actions, .issue-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:12px; }
    .mini-action { flex:1 1 190px; display:block; border:1px solid var(--line); border-radius:8px; padding:10px; color:var(--ink); text-decoration:none; background:#fff; }
    .mini-action strong { display:block; font-size:14px; }
    .mini-action span { display:block; color:var(--muted); font-size:13px; }
    .mini-action.disabled { color:var(--muted); background:var(--soft); }
    ul { margin:0; padding-left:20px; }
    .metrics { display:flex; gap:10px; flex-wrap:wrap; }
    .metrics span { border:1px solid var(--line); border-radius:6px; padding:8px 10px; background:var(--soft); }
    .asset-grid { display:flex; flex-wrap:wrap; gap:12px; }
    .asset-grid > .asset-card { flex:1 1 180px; max-width:260px; }
    .asset-card { border:1px solid var(--line); border-radius:8px; padding:10px; }
    .asset-card p { font-size:14px; }
    .asset-card .status { color:#17443f; font-weight:700; }
    .asset-card strong { display:block; font-size:13px; margin:8px 0; }
    .thumb { display:block; aspect-ratio:4/3; background:var(--soft); border-radius:6px; overflow:hidden; }
    .thumb img { width:100%; height:100%; object-fit:cover; display:block; }
    .thumb.empty { border:1px dashed var(--line); }
    .asset-card a { color:var(--accent); }
    .issue-card { border-left:4px solid var(--warn); padding:10px 0 10px 12px; }
    footer { border-top:1px solid var(--line); margin-top:28px; color:var(--muted); }
    @media (max-width: 760px) { .wrap { padding:18px; } .hero { display:block; } .action { margin-top:18px; } h1 { font-size:27px; } .asset-grid > .asset-card { max-width:none; flex-basis:100%; } }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <nav>${nav}</nav>
      <div class="hero">
        <div>
          <h1>${escapeHtml(vm.task.title)}</h1>
          <p class="summary">${escapeHtml(vm.task.summary)}</p>
          <p>${escapeHtml(vm.stage.name)} · ${escapeHtml(vm.decision.headline)}</p>
        </div>
        <aside class="action">
          ${renderPrimaryAction(vm.primaryAction)}
        </aside>
      </div>
    </div>
  </header>
  <main class="wrap">
    <section class="panel">
      <h2>下一句可以说</h2>
      ${renderReplySuggestions(vm.replySuggestions)}
      ${renderSecondaryActions(vm.secondaryActions)}
    </section>
    <div class="grid">${renderPageBody(vm)}</div>
  </main>
  <footer><div class="wrap">从任务页开始；素材在 assets 目录中按用途整理。</div></footer>
</body>
</html>
`;
  assertNoUserFacingInternalTerms(html, `${vm.pageId}.html`);
  return html;
}

function renderViewModelFile(viewModelFile, outputFile) {
  const vm = readJson(viewModelFile);
  const html = renderWorkspacePage(vm);
  ensureDir(path.dirname(outputFile));
  fs.writeFileSync(outputFile, html);
  return outputFile;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputFile = path.resolve(args['output-file']);
  const viewModelFile = path.resolve(args['view-model']);
  renderViewModelFile(viewModelFile, outputFile);
  console.log(JSON.stringify({ ok: true, outputFile }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

module.exports = { renderWorkspacePage, renderViewModelFile };
