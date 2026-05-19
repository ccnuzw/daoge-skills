const path = require('path');
const { fileExists } = require('./script_utils');

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function relativeFile(outputDir, targetPath) {
  if (!targetPath) return null;
  return path.relative(outputDir, targetPath);
}

function makeLink(label, href) {
  if (!href) return '';
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

function renderPortalTopLinks(outputDir, options = {}) {
  const currentPage = String(options.currentPage || '').trim();
  const extraLinks = Array.isArray(options.extraLinks) ? options.extraLinks : [];
  const examplesCatalogPath = path.join(__dirname, '..', 'references', 'examples', 'examples_catalog.html');
  const defaultEntries = [
    { file: 'daoge_portal.html', label: '返回 DAOGE 门户' },
    { file: 'result_hub.html', label: '结果总入口' },
    { file: 'prompt_preview.html', label: 'Prompt 预览' },
    { file: 'preflight_board.html', label: '预检总览' },
    { file: 'assets_board.html', label: '资产看板' },
    { file: 'run_overview.html', label: '运行概览' },
    { file: 'review_board.html', label: '审阅看板' },
    { file: 'storyboard_board.html', label: 'Storyboard 装板' },
    { file: 'completion_board.html', label: '完成报告' },
    { file: 'rerun_board.html', label: '失败补跑看板' },
  ];

  const links = [];
  for (const entry of defaultEntries) {
    if (entry.file === currentPage) continue;
    const absolutePath = path.join(outputDir, entry.file);
    if (!fileExists(absolutePath)) continue;
    links.push(makeLink(entry.label, relativeFile(outputDir, absolutePath)));
  }

  if (currentPage !== 'examples-catalog' && fileExists(examplesCatalogPath)) {
    links.push(makeLink('示例目录', relativeFile(outputDir, examplesCatalogPath)));
  }

  for (const entry of extraLinks) {
    if (!entry || !entry.label) continue;
    let href = null;
    if (entry.href) {
      href = entry.href;
    } else if (entry.file) {
      const absolutePath = path.isAbsolute(entry.file) ? entry.file : path.join(outputDir, entry.file);
      if (!fileExists(absolutePath)) continue;
      href = relativeFile(outputDir, absolutePath);
    }
    if (!href) continue;
    links.push(makeLink(entry.label, href));
  }

  return links.join('\n        ');
}

function renderPortalContextBar(options = {}) {
  const runLabel = String(options.runLabel || '').trim();
  const boardLabel = String(options.boardLabel || '').trim();
  const phaseLabel = String(options.phaseLabel || '').trim();
  const flowLabel = String(options.flowLabel || '').trim();
  const counts = Array.isArray(options.counts) ? options.counts.filter(Boolean) : [];
  const hints = Array.isArray(options.hints) ? options.hints.filter(Boolean) : [];

  const contextItems = [
    runLabel ? { label: '当前 Run', value: runLabel } : null,
    boardLabel ? { label: '当前 Board', value: boardLabel } : null,
    phaseLabel ? { label: '当前阶段', value: phaseLabel } : null,
    flowLabel ? { label: '流程位置', value: flowLabel } : null,
  ].filter(Boolean);

  if (!contextItems.length && !counts.length && !hints.length) return '';

  return `
    <section class="portal-context-bar">
      <div class="portal-context-main">
        ${contextItems.map((item) => `
          <div class="portal-context-item">
            <div class="portal-context-label">${escapeHtml(item.label)}</div>
            <div class="portal-context-value">${escapeHtml(item.value)}</div>
          </div>
        `).join('')}
      </div>
      ${counts.length ? `
        <div class="portal-context-counts">
          ${counts.map((item) => `
            <span class="portal-context-pill">${escapeHtml(item.label)} ${escapeHtml(item.value)}</span>
          `).join('')}
        </div>
      ` : ''}
      ${hints.length ? `
        <div class="portal-context-hints">
          ${hints.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
        </div>
      ` : ''}
    </section>
  `;
}

module.exports = {
  escapeHtml,
  relativeFile,
  makeLink,
  renderPortalTopLinks,
  renderPortalContextBar,
};
