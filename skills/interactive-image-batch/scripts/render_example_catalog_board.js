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

function taskGroups() {
  return [
    {
      id: 'portrait-fashion',
      title: '人物与时尚视觉',
      description: '适合人物海报、近景肖像、棚拍大片和系列 Lookbook 这类人物主导任务。',
      matchCategories: new Set(['portraits-and-characters', 'grids-and-collages']),
      intentPriority: ['portrait', 'studio', 'lookbook'],
    },
    {
      id: 'commerce-brand',
      title: '电商与商业视觉',
      description: '适合电商主图、详情页组图、社媒图、广告测试、品牌海报和包装任务。',
      matchCategories: new Set(['product-visuals', 'social-campaigns', 'performance-creatives', 'poster-and-campaigns', 'branding-and-packaging']),
      intentPriority: ['ecommerce', 'detail', 'social', 'abtest', 'poster', 'packaging'],
    },
    {
      id: 'information-explainer',
      title: '信息与说明型视觉',
      description: '适合信息图、技术图、学术图、视觉文档页、排版海报和地图路线图。',
      matchCategories: new Set(['infographics', 'technical-diagrams', 'academic-figures', 'slides-and-visual-docs', 'typography-and-text-layout', 'maps']),
      intentPriority: ['academic', 'map', 'typography'],
    },
    {
      id: 'assets-edit',
      title: '资产与编辑',
      description: '适合头像、图像编辑、资产板、图标板和局部修图类任务。',
      matchCategories: new Set(['avatars-and-profile', 'editing-workflows', 'assets-and-props']),
      intentPriority: [],
    },
    {
      id: 'storyboard-narrative',
      title: '分镜与叙事',
      description: '适合电影分镜、口播整板、专家解说板、案例见证板和插画叙事场景。',
      matchCategories: new Set(['cinematic-sequences', 'scenes-and-illustrations']),
      intentPriority: ['cinematic', 'oralboard', 'financeboard', 'hostboard', 'productboard', 'eduboard', 'expertboard', 'testimonialboard'],
    },
    {
      id: 'ui-interface',
      title: '界面与产品样机',
      description: '适合界面视觉稿、产品 mockup、聊天界面、短视频封面式 UI 等任务。',
      matchCategories: new Set(['ui-mockups']),
      intentPriority: ['ui'],
    },
  ];
}

function groupExamplesByTask(examples) {
  const intentMap = new Map(starterIntentCards(examples).map((item) => [item.intent, item]));
  return taskGroups().map((group) => {
    const items = examples.filter((item) => group.matchCategories.has(String(item.category || '').trim()));
    const mainline = [];
    const variants = [];
    items.forEach((item) => {
      if (String(item.id || '').trim() === String(item.template_id || '').trim()) {
        mainline.push(item);
      } else {
        variants.push(item);
      }
    });
    return {
      ...group,
      items,
      mainline,
      variants,
      starterCards: group.intentPriority.map((intent) => intentMap.get(intent)).filter(Boolean),
    };
  }).filter((group) => group.items.length > 0);
}

function starterExamples(examples) {
  return examples.filter((item) => item.recommended_start === true);
}

const STARTER_SHORTLIST_INTENTS = new Set([
  'portrait',
  'studio',
  'ecommerce',
  'packaging',
  'cinematic',
  'oralboard',
]);

function shortlistStarterExamples(examples) {
  return starterExamples(examples).filter((item) =>
    STARTER_SHORTLIST_INTENTS.has(String(item.starter_intent || '').trim().toLowerCase())
  );
}

function starterIntentCards(examples) {
  return shortlistStarterExamples(examples)
    .filter((item) => item.starter_intent)
    .map((item) => ({
      intent: item.starter_intent,
      name: item.name,
      id: item.id,
      reason: item.starter_reason || item.description || '',
    }));
}

function renderCard(item, entryType) {
  const detailSummary = entryType === 'mainline' ? '查看模板细节（维护者）' : '查看变体细节（维护者）';
  return `
    <article class="card" data-entry-type="${entryType}" data-searchable="${escapeHtml(`${item.id} ${item.name} ${item.category} ${item.template_id} ${item.template_variant} ${item.description || ''}`.toLowerCase())}">
      <div class="card-top">
        <h3>${escapeHtml(item.name)}</h3>
        <span class="entry-tag ${entryType === 'mainline' ? 'entry-tag-main' : 'entry-tag-variant'}">${entryType === 'mainline' ? '主链入口' : '变体入口'}</span>
      </div>
      <div class="copy">${escapeHtml(item.description || '')}</div>
      <div class="quick-tips">
        <span class="quick-tag">${entryType === 'mainline' ? '适合第一次用这类任务的人' : '适合任务已经明确、需要更细风格控制的人'}</span>
      </div>
      <div class="cmd">node scripts/run_example_catalog_prepare.js \\
  --example-id ${escapeHtml(item.id)} \\
  --output-dir /tmp/daoge-${escapeHtml(item.id)}-demo</div>
      <details class="card-details">
        <summary>${detailSummary}</summary>
        <div class="meta meta-maintainer">
          <div class="meta-row"><div class="meta-label">内部 ID</div><div class="meta-value">${escapeHtml(item.id)}</div></div>
          <div class="meta-row"><div class="meta-label">内部分类</div><div class="meta-value">${escapeHtml(item.category)}</div></div>
          <div class="meta-row"><div class="meta-label">模板 ID</div><div class="meta-value">${escapeHtml(item.template_id)}</div></div>
          <div class="meta-row"><div class="meta-label">正式变体</div><div class="meta-value">${escapeHtml(item.template_variant)}</div></div>
          <div class="meta-row"><div class="meta-label">示例文件</div><div class="meta-value">${escapeHtml(item.example_file)}</div></div>
        </div>
      </details>
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
      <div class="quick-tips">
        <span class="quick-tag">推荐难度：${escapeHtml(item.difficulty || '未标注')}</span>
        <span class="quick-tag">第一次使用优先选它</span>
      </div>
      <div class="cmd">node scripts/run_example_catalog_prepare.js \\
  --example-id ${escapeHtml(item.id)} \\
  --output-dir /tmp/daoge-${escapeHtml(item.id)}-demo</div>
      <details class="card-details">
        <summary>查看模板细节（维护者）</summary>
        <div class="meta meta-maintainer">
          <div class="meta-row"><div class="meta-label">内部分类</div><div class="meta-value">${escapeHtml(item.category)}</div></div>
          <div class="meta-row"><div class="meta-label">模板 ID</div><div class="meta-value">${escapeHtml(item.template_id)}</div></div>
          <div class="meta-row"><div class="meta-label">正式变体</div><div class="meta-value">${escapeHtml(item.template_variant)}</div></div>
        </div>
      </details>
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
      <div class="quick-tips">
        <span class="quick-tag">直接按任务意图起步</span>
        <span class="quick-tag">适合不想先理解模板名的人</span>
      </div>
      <div class="cmd">node scripts/run_example_catalog_prepare.js \\
  --intent ${escapeHtml(item.intent)} \\
  --output-dir /tmp/daoge-${escapeHtml(item.intent)}-starter</div>
      <details class="card-details">
        <summary>查看内部映射（维护者）</summary>
        <div class="meta meta-maintainer">
          <div class="meta-row"><div class="meta-label">推荐入口</div><div class="meta-value">${escapeHtml(item.id)}</div></div>
          <div class="meta-row"><div class="meta-label">入口名称</div><div class="meta-value">${escapeHtml(item.name)}</div></div>
        </div>
      </details>
    </article>
  `;
}

function renderTaskStarter(item) {
  return `
    <article class="card starter-card">
      <div class="card-top">
        <h3>${escapeHtml(item.name)}</h3>
        <span class="entry-tag entry-tag-main">推荐意图入口</span>
      </div>
      <div class="copy">${escapeHtml(item.reason)}</div>
      <div class="quick-tips">
        <span class="quick-tag">这类任务建议先走意图入口</span>
      </div>
      <div class="cmd">node scripts/run_example_catalog_prepare.js \\
  --intent ${escapeHtml(item.intent)} \\
  --output-dir /tmp/daoge-${escapeHtml(item.intent)}-starter</div>
      <details class="card-details">
        <summary>查看内部映射（维护者）</summary>
        <div class="meta meta-maintainer">
          <div class="meta-row"><div class="meta-label">任务意图</div><div class="meta-value">${escapeHtml(item.intent)}</div></div>
          <div class="meta-row"><div class="meta-label">对应入口</div><div class="meta-value">${escapeHtml(item.id)}</div></div>
        </div>
      </details>
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
  const grouped = groupExamplesByTask(examples);
  const starters = shortlistStarterExamples(examples);
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
    .quick-tips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 14px 0 0;
    }
    .quick-tag {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.4;
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
    .card-details {
      margin-top: 14px;
      border-top: 1px solid rgba(255,255,255,0.08);
      padding-top: 12px;
    }
    .card-details summary {
      cursor: pointer;
      color: var(--text-sub);
      font-size: 13px;
      list-style: none;
      user-select: none;
    }
    .card-details summary::-webkit-details-marker {
      display: none;
    }
    .card-details summary::before {
      content: "▸";
      display: inline-block;
      margin-right: 8px;
      color: var(--accent);
      transition: transform 0.16s ease;
    }
    .card-details[open] summary::before {
      transform: rotate(90deg);
    }
    .meta-maintainer {
      margin-top: 12px;
      padding-top: 4px;
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
      <h1>中文任务入口总览</h1>
      <p class="hero-copy">这个页面现在优先按中文任务组织，而不是先按内部分类组织。你可以先判断自己属于哪类任务，再看推荐意图入口、主链入口和细分变体入口。对第一次使用者来说，先选中文任务，再决定是否继续往下选 variant，会比直接在全部 example 里盲选稳定得多。</p>
    </section>

    <section class="section">
      <div class="copy">当前页面优先展示 6 组中文任务：人物与时尚视觉、电商与商业视觉、信息与说明型视觉、资产与编辑、分镜与叙事、界面与产品样机。内部分类仍然保留在卡片详情里，但不再作为普通用户的第一视角。</div>
    </section>

    <section class="section">
      <h2 class="section-title">按任务意图开始</h2>
      <p class="section-copy">如果你还不想先理解模板名，可以先从这 6 个最高频任务意图开始。第一次使用先不要展开全部入口，先选最像你任务的一类再进预检。</p>
      <div class="grid">
        ${intentCards.map((item) => renderIntentCard(item)).join('')}
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">推荐起步</h2>
      <p class="section-copy">这里默认只保留 6 个最常用代表入口。它们更容易看懂、预检结果更稳定，也最适合作为第一次上手的起点。</p>
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
        <div class="copy">CLI 也支持只列这 6 个推荐入口：<span class="cmd">node scripts/run_example_catalog_prepare.js --starter true</span></div>
        <div class="copy">如果你已经知道任务意图，也建议第一次先从这 6 个里选：<span class="cmd">portrait</span> <span class="cmd">studio</span> <span class="cmd">ecommerce</span> <span class="cmd">packaging</span> <span class="cmd">cinematic</span> <span class="cmd">oralboard</span></div>
      </div>
    </section>

    <section class="section">
      <div class="group-stack">
        ${grouped.map((group) => `
          <section class="section group-panel" data-category="${escapeHtml(group.id)}">
            <div class="group-header">
              <div>
                <h2 class="section-title">${escapeHtml(group.title)}</h2>
                <p class="section-copy">${escapeHtml(group.description)} 当前共 ${group.mainline.length + group.variants.length} 个入口，其中主链入口 ${group.mainline.length} 个，变体入口 ${group.variants.length} 个。</p>
              </div>
              <button class="group-toggle" type="button" aria-expanded="true">折叠分组</button>
            </div>
            <div class="group-body">
            ${group.starterCards.length ? `
              <div class="subsection-block" data-subsection="starter">
              <h3 class="subsection-title">推荐意图入口</h3>
              <div class="grid">
                ${group.starterCards.map((item) => renderTaskStarter(item)).join('')}
              </div>
              </div>
            ` : ''}
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
