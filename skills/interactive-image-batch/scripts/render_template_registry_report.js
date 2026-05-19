const fs = require('fs');
const path = require('path');
const { parseArgs, readJson } = require('./script_utils');
const { renderPortalHeadAssets } = require('./portal_ui_shared');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function summarizeByCategory(templates) {
  const counts = {};
  templates.forEach((item) => {
    const key = String(item.category || 'uncategorized').trim() || 'uncategorized';
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

function summarizeByField(templates, fieldName) {
  const counts = {};
  templates.forEach((item) => {
    const key = String(item[fieldName] || 'unassigned').trim() || 'unassigned';
    counts[key] = (counts[key] || 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}

function renderList(items, emptyText = '无') {
  if (!items || !items.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  return `<ul class="info-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderMarkdownList(items, emptyText = '无') {
  if (!items || !items.length) return [`- ${emptyText}`];
  return items.map((item) => `- ${item}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['report-file']) throw new Error('Missing required flag: --report-file');

  const reportPath = path.resolve(args['report-file']);
  const report = readJson(reportPath);
  const outputDir = path.dirname(reportPath);
  const markdownPath = path.resolve(args['markdown-file'] || path.join(outputDir, 'template_registry_report.md'));
  const htmlPath = path.resolve(args['html-file'] || path.join(outputDir, 'template_registry_report.html'));

  const templates = Array.isArray(report.templates) ? report.templates : [];
  const categories = summarizeByCategory(templates);
  const tiers = summarizeByField(templates, 'tier');
  const families = summarizeByField(templates, 'family');
  const failing = templates.filter((item) => !item.ok);
  const warningOnly = templates.filter((item) => item.ok && item.warnings && item.warnings.length);
  const healthy = templates.filter((item) => item.ok && (!item.warnings || item.warnings.length === 0));

  const markdown = [
    '# 模板主链校验报告',
    '',
    '## 1. 总览',
    '',
    `- 校验结果: ${report.ok ? '通过' : '失败'}`,
    `- 模板总数: ${report.templateCount || templates.length}`,
    `- 错误数: ${report.errorCount || 0}`,
    `- 警告数: ${report.warningCount || 0}`,
    `- 注册表路径: ${report.registryPath || '未记录'}`,
    '',
    '## 2. 分类分布',
    '',
    ...renderMarkdownList(categories.map((item) => `${item.name}: ${item.count}`)),
    '',
    '## 3. 层级分布',
    '',
    ...renderMarkdownList(tiers.map((item) => `${item.name}: ${item.count}`)),
    '',
    '## 4. 家族分布',
    '',
    ...renderMarkdownList(families.map((item) => `${item.name}: ${item.count}`)),
    '',
    '## 5. 健康状态',
    '',
    `- 完全通过: ${healthy.length}`,
    `- 仅警告: ${warningOnly.length}`,
    `- 失败: ${failing.length}`,
    '',
    '## 6. 模板明细',
    '',
  ];

  templates.forEach((item) => {
    markdown.push(`### ${item.id}`);
    markdown.push('');
    markdown.push(`- 层级: ${item.tier || '未记录'}`);
    markdown.push(`- 家族: ${item.family || '未记录'}`);
    markdown.push(`- 分类: ${item.category || '未记录'}`);
    markdown.push(`- 文档存在: ${item.docExists ? '是' : '否'}`);
    markdown.push(`- 文档路径: ${item.templateDoc || '未记录'}`);
    markdown.push(`- 缺失章节: ${(item.missingDocSections || []).length ? item.missingDocSections.join(', ') : '无'}`);
    markdown.push(`- 错误数: ${(item.errors || []).length}`);
    markdown.push(`- 警告数: ${(item.warnings || []).length}`);
    markdown.push('');
    markdown.push('错误：');
    markdown.push(...renderMarkdownList(item.errors, '无'));
    markdown.push('');
    markdown.push('警告：');
    markdown.push(...renderMarkdownList(item.warnings, '无'));
    markdown.push('');
  });

  fs.writeFileSync(markdownPath, `${markdown.join('\n')}\n`);

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DAOGE Template Registry Report</title>
${renderPortalHeadAssets()}
  <style>
    :root {
      --bg: #0e1318;
      --panel: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.1);
      --text-main: #f3efe6;
      --text-sub: rgba(243,239,230,0.68);
      --accent: #d9b36d;
      --green: #7cc5a3;
      --yellow: #e2c070;
      --red: #ff8c7a;
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
    .hero, .section {
      border: 1px solid var(--panel-border);
      background: var(--panel);
      backdrop-filter: blur(12px);
      border-radius: 24px;
      box-shadow: 0 18px 48px rgba(0,0,0,0.24);
    }
    .hero {
      padding: 28px 28px 24px;
      background:
        linear-gradient(160deg, rgba(217,179,109,0.16), transparent 38%),
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
    .metric-grid, .section-grid, .template-grid {
      display: grid;
      gap: 16px;
    }
    .metric-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: 20px;
    }
    .section {
      padding: 22px;
      margin-top: 18px;
    }
    .section h2 {
      margin: 0 0 12px;
      font-size: 20px;
    }
    .metric-card, .info-card, .template-card {
      border-radius: 20px;
      padding: 18px 18px 20px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .metric-label {
      color: var(--text-sub);
      font-size: 12px;
      margin-bottom: 10px;
    }
    .metric-value {
      font-size: 30px;
      font-weight: 700;
    }
    .section-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .template-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .info-list {
      margin: 0;
      padding-left: 18px;
      color: var(--text-sub);
      line-height: 1.7;
    }
    .empty-state {
      color: var(--text-sub);
      line-height: 1.6;
    }
    .meta-list {
      display: grid;
      gap: 10px;
      margin-bottom: 14px;
    }
    .meta-row {
      display: grid;
      grid-template-columns: 120px 1fr;
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
    .template-card h3 {
      margin: 0 0 10px;
      font-size: 18px;
      color: var(--accent);
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      margin-bottom: 12px;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .status-ok {
      color: var(--green);
      background: rgba(124,197,163,0.12);
    }
    .status-warn {
      color: var(--yellow);
      background: rgba(226,192,112,0.12);
    }
    .status-fail {
      color: var(--red);
      background: rgba(255,140,122,0.12);
    }
    @media (max-width: 1080px) {
      .metric-grid,
      .section-grid,
      .template-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body data-portal-page="template-registry-report">
  <div class="shell">
    <section class="hero">
      <div class="eyebrow">DAOGE Template Governance</div>
      <h1>模板主链校验看板</h1>
      <p class="hero-copy">这个看板用于检查模板注册表、模板文档路径和模板章节骨架是否保持一致。它不是运行时结果页，而是模板治理和维护页。</p>
      <div class="metric-grid">
        <article class="metric-card">
          <div class="metric-label">模板总数</div>
          <div class="metric-value">${escapeHtml(report.templateCount || templates.length)}</div>
        </article>
        <article class="metric-card">
          <div class="metric-label">错误数</div>
          <div class="metric-value">${escapeHtml(report.errorCount || 0)}</div>
        </article>
        <article class="metric-card">
          <div class="metric-label">警告数</div>
          <div class="metric-value">${escapeHtml(report.warningCount || 0)}</div>
        </article>
        <article class="metric-card">
          <div class="metric-label">校验结果</div>
          <div class="metric-value">${escapeHtml(report.ok ? '通过' : '失败')}</div>
        </article>
      </div>
    </section>

    <section class="section">
      <h2>分类、层级与健康状态</h2>
      <div class="section-grid">
        <article class="info-card">
          <h3>分类分布</h3>
          ${renderList(categories.map((item) => `${item.name}: ${item.count}`))}
        </article>
        <article class="info-card">
          <h3>层级分布</h3>
          ${renderList(tiers.map((item) => `${item.name}: ${item.count}`))}
        </article>
        <article class="info-card">
          <h3>家族分布</h3>
          ${renderList(families.map((item) => `${item.name}: ${item.count}`))}
        </article>
        <article class="info-card">
          <h3>健康状态</h3>
          ${renderList([
            `完全通过: ${healthy.length}`,
            `仅警告: ${warningOnly.length}`,
            `失败: ${failing.length}`,
            `注册表: ${report.registryPath || '未记录'}`,
          ])}
        </article>
      </div>
    </section>

    <section class="section">
      <h2>模板明细</h2>
      <div class="template-grid">
        ${templates.map((item) => {
          const statusClass = !item.ok ? 'status-fail' : (item.warnings && item.warnings.length ? 'status-warn' : 'status-ok');
          const statusLabel = !item.ok ? '失败' : (item.warnings && item.warnings.length ? '警告' : '通过');
          return `
            <article class="template-card">
              <div class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</div>
              <h3>${escapeHtml(item.id)}</h3>
              <div class="meta-list">
                <div class="meta-row"><div class="meta-label">层级</div><div class="meta-value">${escapeHtml(item.tier || '未记录')}</div></div>
                <div class="meta-row"><div class="meta-label">家族</div><div class="meta-value">${escapeHtml(item.family || '未记录')}</div></div>
                <div class="meta-row"><div class="meta-label">分类</div><div class="meta-value">${escapeHtml(item.category || '未记录')}</div></div>
                <div class="meta-row"><div class="meta-label">文档存在</div><div class="meta-value">${escapeHtml(item.docExists ? '是' : '否')}</div></div>
                <div class="meta-row"><div class="meta-label">文档路径</div><div class="meta-value">${escapeHtml(item.templateDoc || '未记录')}</div></div>
                <div class="meta-row"><div class="meta-label">缺失章节</div><div class="meta-value">${escapeHtml((item.missingDocSections || []).length ? item.missingDocSections.join(', ') : '无')}</div></div>
              </div>
              <div class="section-grid">
                <article class="info-card">
                  <h3>错误</h3>
                  ${renderList(item.errors, '无')}
                </article>
                <article class="info-card">
                  <h3>警告</h3>
                  ${renderList(item.warnings, '无')}
                </article>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </section>
  </div>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html);

  console.log(JSON.stringify({
    markdownPath,
    htmlPath,
    ok: report.ok,
    templateCount: report.templateCount || templates.length,
    errorCount: report.errorCount || 0,
    warningCount: report.warningCount || 0,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
