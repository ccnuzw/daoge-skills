const fs = require('fs');
const path = require('path');
const { parseArgs, readJson } = require('./script_utils');
const { renderPortalTopLinks } = require('./portal_shared');
const { renderPortalHeadAssets } = require('./portal_ui_shared');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function groupExamples(examples) {
  const groups = new Map();
  examples.forEach((item) => {
    const category = String(item.category || 'uncategorized').trim() || 'uncategorized';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  });

  return Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, items]) => {
      const mainline = [];
      const variants = [];
      items.forEach((item) => {
        if (String(item.id || '').trim() === String(item.template_id || '').trim()) {
          mainline.push(item);
        } else {
          variants.push(item);
        }
      });
      return { category, mainline, variants };
    });
}

function starterExamples(examples) {
  return examples.filter((item) => item.recommended_start === true);
}

function starterIntentCards(examples) {
  return starterExamples(examples)
    .filter((item) => item.starter_intent)
    .map((item) => ({
      intent: item.starter_intent,
      name: item.name,
      id: item.id,
      reason: item.starter_reason || item.description || '',
    }));
}

function renderCard(item, entryType) {
  return `
    <article class="card" data-entry-type="${entryType}" data-searchable="${escapeHtml(`${item.id} ${item.name} ${item.category} ${item.template_id} ${item.template_variant} ${item.description || ''}`.toLowerCase())}">
      <div class="card-top">
        <h3>${escapeHtml(item.name)}</h3>
        <span class="entry-tag ${entryType === 'mainline' ? 'entry-tag-main' : 'entry-tag-variant'}">${entryType === 'mainline' ? '主链入口' : '变体入口'}</span>
      </div>
      <div class="copy">${escapeHtml(item.description || '')}</div>
      <div class="meta">
        <div class="meta-row"><div class="meta-label">ID</div><div class="meta-value">${escapeHtml(item.id)}</div></div>
        <div class="meta-row"><div class="meta-label">分类</div><div class="meta-value">${escapeHtml(item.category)}</div></div>
        <div class="meta-row"><div class="meta-label">模板</div><div class="meta-value">${escapeHtml(item.template_id)}</div></div>
        <div class="meta-row"><div class="meta-label">变体</div><div class="meta-value">${escapeHtml(item.template_variant)}</div></div>
        <div class="meta-row"><div class="meta-label">示例文件</div><div class="meta-value">${escapeHtml(item.example_file)}</div></div>
      </div>
      <div class="cmd">node scripts/run_example_catalog_prepare.js \\
  --example-id ${escapeHtml(item.id)} \\
  --output-dir /tmp/daoge-${escapeHtml(item.id)}-demo</div>
    </article>
  `;
}

function renderStarterCard(item) {
  return `
    <article class="card starter-card" data-entry-type="starter" data-searchable="${escapeHtml(`${item.id} ${item.name} ${item.category} ${item.template_id} ${item.template_variant} ${item.description || ''} ${item.starter_reason || ''}`.toLowerCase())}">
      <div class="card-top">
        <h3>${escapeHtml(item.name)}</h3>
        <span class="entry-tag entry-tag-main">推荐起步</span>
      </div>
      <div class="copy">${escapeHtml(item.starter_reason || item.description || '')}</div>
      <div class="meta">
        <div class="meta-row"><div class="meta-label">推荐难度</div><div class="meta-value">${escapeHtml(item.difficulty || 'unspecified')}</div></div>
        <div class="meta-row"><div class="meta-label">分类</div><div class="meta-value">${escapeHtml(item.category)}</div></div>
        <div class="meta-row"><div class="meta-label">模板</div><div class="meta-value">${escapeHtml(item.template_id)}</div></div>
        <div class="meta-row"><div class="meta-label">变体</div><div class="meta-value">${escapeHtml(item.template_variant)}</div></div>
      </div>
      <div class="cmd">node scripts/run_example_catalog_prepare.js \\
  --example-id ${escapeHtml(item.id)} \\
  --output-dir /tmp/daoge-${escapeHtml(item.id)}-demo</div>
    </article>
  `;
}

function renderIntentCard(item) {
  return `
    <article class="card starter-card">
      <div class="card-top">
        <h3>${escapeHtml(item.intent)}</h3>
        <span class="entry-tag entry-tag-main">任务意图</span>
      </div>
      <div class="copy">${escapeHtml(item.reason)}</div>
      <div class="meta">
        <div class="meta-row"><div class="meta-label">推荐入口</div><div class="meta-value">${escapeHtml(item.id)}</div></div>
        <div class="meta-row"><div class="meta-label">入口名称</div><div class="meta-value">${escapeHtml(item.name)}</div></div>
      </div>
      <div class="cmd">node scripts/run_example_catalog_prepare.js \\
  --intent ${escapeHtml(item.intent)} \\
  --output-dir /tmp/daoge-${escapeHtml(item.intent)}-starter</div>
    </article>
  `;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalogFile = path.resolve(args['catalog-file'] || path.join(__dirname, '..', 'references', 'examples', 'examples.catalog.json'));
  const outputFile = path.resolve(args['output-file'] || path.join(path.dirname(catalogFile), 'examples_catalog.html'));
  const portalDir = path.dirname(outputFile);
  const portalFile = path.join(portalDir, 'daoge_portal.html');
  const resultHubFile = path.join(portalDir, 'result_hub.html');
  const promptPreviewFile = path.join(portalDir, 'prompt_preview.html');
  const catalog = readJson(catalogFile);
  const examples = Array.isArray(catalog.examples) ? catalog.examples : [];
  const grouped = groupExamples(examples);
  const starters = starterExamples(examples);
  const intentCards = starterIntentCards(examples);

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE Example Catalog</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --bg: #0e1318;
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --info: #88b9ff;
      --success: #7cc5a3;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, rgba(217,179,109,0.18), transparent 26%),
        linear-gradient(135deg, #0a0f13 0%, #101720 45%, #0e1318 100%);
      color: var(--text-main);
      font-family: "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    }
    .shell {
      max-width: 1480px;
      margin: 0 auto;
      padding: 28px 24px 56px;
    }
    .hero, .section, .card {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      backdrop-filter: blur(12px);
      border-radius: 24px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.24);
    }
    .hero {
      padding: 28px 28px 24px;
      background:
        linear-gradient(160deg, rgba(136,185,255,0.15), transparent 38%),
        rgba(255,255,255,0.04);
      margin-bottom: 20px;
    }
    .eyebrow {
      display: inline-flex;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      color: var(--accent);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 14px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 34px;
      line-height: 1.1;
    }
    .hero-copy {
      margin: 0;
      color: var(--text-sub);
      line-height: 1.7;
      max-width: 76ch;
    }
    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    }
    .group-stack {
      display: grid;
      gap: 18px;
    }
    .section {
      padding: 22px;
      margin-top: 18px;
    }
    .section-title {
      margin: 0 0 6px;
      font-size: 22px;
      color: var(--accent);
    }
    .section-copy {
      margin: 0 0 18px;
      color: var(--text-sub);
      line-height: 1.7;
      font-size: 14px;
    }
    .toolbar {
      display: grid;
      gap: 14px;
    }
    .toolbar-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }
    .search-input {
      flex: 1 1 320px;
      min-width: 240px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(0,0,0,0.18);
      color: var(--text-main);
      padding: 12px 14px;
      font-size: 14px;
    }
    .search-input::placeholder {
      color: rgba(243,239,230,0.4);
    }
    .toggle-group {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .toggle-button {
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.05);
      color: var(--text-sub);
      padding: 10px 14px;
      border-radius: 999px;
      cursor: pointer;
      font-size: 13px;
    }
    .toggle-button.is-active {
      color: var(--text-main);
      border-color: rgba(217,179,109,0.4);
      background: rgba(217,179,109,0.14);
    }
    .group-panel[hidden],
    .card[hidden],
    .subsection-block[hidden] {
      display: none !important;
    }
    .group-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .group-toggle {
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.05);
      color: var(--text-sub);
      padding: 8px 12px;
      border-radius: 999px;
      cursor: pointer;
      font-size: 12px;
    }
    .group-toggle[aria-expanded="false"] {
      color: var(--accent);
    }
    .subsection-title {
      margin: 0 0 14px;
      font-size: 15px;
      color: var(--text-sub);
      letter-spacing: 0.02em;
    }
    .card {
      padding: 20px;
    }
    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .card h3 {
      margin: 0;
      font-size: 20px;
      color: var(--accent);
    }
    .entry-tag {
      display: inline-flex;
      align-items: center;
      padding: 5px 10px;
      border-radius: 999px;
      font-size: 12px;
      white-space: nowrap;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .entry-tag-main {
      color: var(--success);
      background: rgba(124,197,163,0.12);
    }
    .entry-tag-variant {
      color: var(--info);
      background: rgba(136,185,255,0.12);
    }
    .meta {
      display: grid;
      gap: 10px;
      margin: 14px 0;
    }
    .meta-row {
      display: grid;
      grid-template-columns: 92px 1fr;
      gap: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .meta-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }
    .meta-label {
      color: var(--text-sub);
      font-size: 12px;
    }
    .meta-value {
      font-size: 13px;
      line-height: 1.6;
      word-break: break-word;
    }
    .copy {
      color: var(--text-sub);
      line-height: 1.7;
      font-size: 14px;
    }
    .cmd {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 16px;
      background: rgba(0,0,0,0.22);
      border: 1px solid rgba(255,255,255,0.08);
      color: var(--info);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
    }
    @media (max-width: 720px) {
      .shell { padding: 18px 14px 44px; }
      h1 { font-size: 28px; }
      .meta-row { grid-template-columns: 1fr; gap: 6px; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body data-portal-page="examples-catalog">
  <div class="shell">
    <section class="hero">
      <div class="top-links">
        ${renderPortalTopLinks(portalDir, {
          currentPage: 'examples-catalog',
          extraLinks: [
            { label: '返回 DAOGE 门户', file: portalFile },
            { label: '返回结果总入口', file: resultHubFile },
            { label: '返回 Prompt 预览', file: promptPreviewFile },
          ],
        })}
      </div>
      <div class="eyebrow">DAOGE Examples</div>
      <h1>Example Catalog</h1>
      <p class="hero-copy">这个页面列出当前可直接进入预检 demo 的模板示例。你可以先按模板类型挑选，再通过 CLI 一键生成对应的 DAOGE 预检面板。当前 catalog 已经覆盖 UI 样机、信息图、技术图、学术图、品牌包装、插画场景、地图路线、排版海报、资产道具、头像资产和视觉文档页。</p>
    </section>

    <section class="section">
      <div class="copy">当前已覆盖的主链类目包括：UI 样机、信息图、技术图、学术图、品牌包装板、插画场景组、地图路线板、排版海报、资产道具板、头像资产和视觉文档页。这个页面现在已经成为 DAOGE 示例层的统一体验入口。</div>
    </section>

    <section class="section">
      <h2 class="section-title">按任务意图开始</h2>
      <p class="section-copy">如果你还不想先理解模板名，可以直接按任务意图开始。每个意图先只推荐一个起步入口，保证第一次使用时路径清晰。</p>
      <div class="grid">
        ${intentCards.map((item) => renderIntentCard(item)).join('')}
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">推荐起步</h2>
      <p class="section-copy">如果你是第一次进入 DAOGE examples，不要先在全部入口里挑。先从下面这些代表入口开始：它们更容易看懂、预检结果更稳定，也更能代表不同任务家族。</p>
      <div class="grid">
        ${starters.map((item) => renderStarterCard(item)).join('')}
      </div>
    </section>

    <section class="section">
      <div class="toolbar">
        <div class="toolbar-row">
          <input id="catalog-search" class="search-input" type="search" placeholder="搜索 ID、类目、模板、变体或描述" />
        </div>
        <div class="toolbar-row">
          <div class="toggle-group" role="group" aria-label="入口过滤">
            <button class="toggle-button is-active" type="button" data-filter-type="all">全部入口</button>
            <button class="toggle-button" type="button" data-filter-type="mainline">只看主链</button>
            <button class="toggle-button" type="button" data-filter-type="variant">只看变体</button>
          </div>
        </div>
        <div class="copy">CLI 也支持只列推荐入口：<span class="cmd">node scripts/run_example_catalog_prepare.js --starter true</span></div>
        <div class="copy">如果你已经知道任务意图，也可以直接运行：<span class="cmd">node scripts/run_example_catalog_prepare.js --intent ui</span></div>
        <div class="copy">当前还支持：<span class="cmd">--intent academic</span> <span class="cmd">--intent packaging</span> <span class="cmd">--intent map</span> <span class="cmd">--intent typography</span> <span class="cmd">--intent ecommerce</span> <span class="cmd">--intent detail</span> <span class="cmd">--intent social</span> <span class="cmd">--intent abtest</span> <span class="cmd">--intent poster</span> <span class="cmd">--intent lookbook</span> <span class="cmd">--intent portrait</span> <span class="cmd">--intent studio</span> <span class="cmd">--intent cinematic</span> <span class="cmd">--intent oralboard</span> <span class="cmd">--intent financeboard</span> <span class="cmd">--intent hostboard</span> <span class="cmd">--intent productboard</span> <span class="cmd">--intent eduboard</span> <span class="cmd">--intent expertboard</span> <span class="cmd">--intent testimonialboard</span></div>
      </div>
    </section>

    <section class="section">
      <div class="group-stack">
        ${grouped.map((group) => `
          <section class="section group-panel" data-category="${escapeHtml(group.category)}">
            <div class="group-header">
              <div>
                <h2 class="section-title">${escapeHtml(group.category)}</h2>
                <p class="section-copy">这个分组下共 ${group.mainline.length + group.variants.length} 个入口，其中主链入口 ${group.mainline.length} 个，变体入口 ${group.variants.length} 个。</p>
              </div>
              <button class="group-toggle" type="button" aria-expanded="true">折叠分组</button>
            </div>
            <div class="group-body">
            ${group.mainline.length ? `
              <div class="subsection-block" data-subsection="mainline">
              <h3 class="subsection-title">主链入口</h3>
              <div class="grid">
                ${group.mainline.map((item) => renderCard(item, 'mainline')).join('')}
              </div>
              </div>
            ` : ''}
            ${group.variants.length ? `
              <div class="subsection-block" data-subsection="variant">
              <h3 class="subsection-title">变体入口</h3>
              <div class="grid">
                ${group.variants.map((item) => renderCard(item, 'variant')).join('')}
              </div>
              </div>
            ` : ''}
            </div>
          </section>
        `).join('')}
      </div>
    </section>
  </div>
  <script>
    (() => {
      const searchInput = document.getElementById('catalog-search');
      const filterButtons = Array.from(document.querySelectorAll('[data-filter-type]'));
      const panels = Array.from(document.querySelectorAll('.group-panel'));
      let activeFilter = 'all';

      function applyFilters() {
        const query = String(searchInput.value || '').trim().toLowerCase();
        panels.forEach((panel) => {
          const cards = Array.from(panel.querySelectorAll('.card'));
          let visibleCount = 0;
          cards.forEach((card) => {
            const text = String(card.dataset.searchable || '');
            const entryType = String(card.dataset.entryType || '');
            const matchesQuery = !query || text.includes(query);
            const matchesType = activeFilter === 'all' || entryType === activeFilter;
            const visible = matchesQuery && matchesType;
            card.hidden = !visible;
            if (visible) visibleCount += 1;
          });

          panel.querySelectorAll('.subsection-block').forEach((block) => {
            const blockCards = Array.from(block.querySelectorAll('.card'));
            block.hidden = blockCards.every((card) => card.hidden);
          });

          panel.hidden = visibleCount === 0;
        });
      }

      filterButtons.forEach((button) => {
        button.addEventListener('click', () => {
          activeFilter = button.dataset.filterType;
          filterButtons.forEach((item) => item.classList.toggle('is-active', item === button));
          applyFilters();
        });
      });

      panels.forEach((panel) => {
        const toggle = panel.querySelector('.group-toggle');
        const body = panel.querySelector('.group-body');
        toggle.addEventListener('click', () => {
          const expanded = toggle.getAttribute('aria-expanded') === 'true';
          toggle.setAttribute('aria-expanded', String(!expanded));
          toggle.textContent = expanded ? '展开分组' : '折叠分组';
          body.hidden = expanded;
        });
      });

      searchInput.addEventListener('input', applyFilters);
      applyFilters();
    })();
  </script>
</body>
</html>`;

  fs.writeFileSync(outputFile, html);
  console.log(JSON.stringify({
    catalogFile,
    outputFile,
    exampleCount: examples.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
