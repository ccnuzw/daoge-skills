const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource, readStyles } = require('./source-text');


test('asset cards tuck status help away, keep action labels readable, and show full thumbnails', () => {
  const source = readFrontendSource();
  const styles = readStyles();
  const legend = readFrontendSource();
  const assetCard = source.slice(source.indexOf('function AssetCard('), source.indexOf('class WorkbenchErrorBoundary'));
  const previewEnd = assetCard.search(/\r?\n {4}<\/div>\r?\n {4}\{menuOpen && <div className="asset-action-menu"/);
  assert.ok(previewEnd > 0);
  assert.match(assetCard.slice(0, previewEnd), /className="asset-select-control"/);
  assert.match(assetCard.slice(0, previewEnd), /className="asset-card-tools"/);
  assert.doesNotMatch(assetCard.slice(0, previewEnd), /asset-action-menu/);
  assert.match(source, /<AssetStateLegend title="状态说明" compact collapsed \/>/);
  // 浮层收回批（2026-09-20）：折叠态图例与「显示」浮层改为共用 Disclosure；
  // 断言从 `<details` 字面实现迁到组件钩子（意图不变：它们仍是折叠浮层）。
  assert.match(legend, /return <Disclosure className=\{className\} aria-label=\{title\} summary=\{<summary><FileCheck2/);
  assert.match(styles, /\.asset-select-control \{ top:8px; bottom:auto;/);
  assert.match(styles, /\.asset-state-legend\.is-collapsed > \.asset-state-legend-panel \{ position:absolute;/);
  assert.match(styles, /\.asset-action-menu \{ grid-template-columns:1fr; gap:8px; \}/);
  assert.match(styles, /\.asset-action-section > div \{ display:grid; grid-template-columns:repeat\(2,minmax\(76px,1fr\)\)/);
  assert.match(styles, /\.asset-action-section > div > button span \{ min-width:0; overflow:visible; text-overflow:clip; white-space:normal;/);
  assert.match(source, /ASSET_PREVIEW_FIT_KEY = 'daoge-pic:asset-preview-fit'/);
  assert.match(source, /previewFit=\{assetPreviewFit\}/);
  assert.match(source, /className=\{'asset-card is-preview-' \+ previewFit/);
  assert.match(source, /<Disclosure className="asset-view-options" summary=\{<summary><SlidersHorizontal size=\{14\} \/>显示<span className="asset-view-current">/);
  assert.match(source, /saved === 'cover' \|\| saved === 'cover-top' \? 'cover-top' : saved === 'adaptive' \? 'adaptive' : 'contain'/);
  assert.match(source, /aria-pressed=\{assetPreviewFit === 'adaptive'\}/);
  assert.match(source, /aria-pressed=\{assetPreviewFit === 'contain'\}/);
  assert.match(source, /aria-pressed=\{assetPreviewFit === 'cover-top'\}/);
  assert.match(source, /自适应卡片<span>按原图比例展示<\/span>/);
  assert.match(source, /完整显示<span>留白不裁切<\/span>/);
  assert.match(source, /填满裁切<span>铺满卡片，优先显示上半部<\/span>/);
  assert.match(source, /className=\{'asset-grid is-preview-' \+ assetPreviewFit\}/);
  assert.match(styles, /\.asset-grid\.is-preview-adaptive \.asset-preview img,\.asset-card\.is-preview-adaptive \.asset-preview img \{ width:auto; height:auto; max-width:100%; max-height:100%; object-fit:contain;/);
  assert.match(styles, /\.asset-grid\.is-preview-contain \.asset-preview img,\.asset-card\.is-preview-contain \.asset-preview img \{ width:100%; height:100%; object-fit:contain; background-color:#e7eee4;/);
  assert.match(styles, /\.asset-grid\.is-preview-cover-top \.asset-preview img,\.asset-card\.is-preview-cover-top \.asset-preview img \{ width:100%; height:100%; object-fit:cover; object-position:center top;/);
  assert.match(styles, /\.run-detail-panel \.run-item-output button \{ width:34px; height:34px;/);
  assert.match(styles, /\.run-detail-panel \.run-item-output img \{ display:block; width:100%; height:100%; object-fit:cover; object-position:center top; \}/);
  assert.match(styles, /\.run-item-detail-assets > div \{ display:grid; grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,220px\),1fr\)\);/);
  assert.match(styles, /\.run-item-detail-assets button \{ display:grid; width:100%; max-width:260px;/);
  assert.match(styles, /\.run-item-detail-assets img \{ display:block; width:100%; height:220px; object-fit:contain;/);
  assert.match(styles, /\.asset-view-mode button\.is-active \{ border-color:#274d34; background:#315f3f; color:#fffef9; \}/);
  assert.match(styles, /\.asset-view-mode button\.is-active span \{ color:#e9f4e3; \}/);
  // 第 1 批 C3 把缩放上限从 2× 提到 4× 并收进共享模型（image-review-keys-model）。
  // 这里断言「意图」：放大按钮尊重上限、且步进走共享模型，而不是锁死旧的 2× 常量。
  assert.match(source, /disabled=\{clampReviewZoom\(zoom\) >= REVIEW_ZOOM_MAX\}/, '放大按钮必须尊重缩放上限');
  assert.match(source, /onClick=\{\(\) => onZoom\(reviewZoomStep\(zoom, 1\)\)\}/, '放大必须走共享步进模型');
  assert.match(source, /<div className="inspector-image-frame" style=\{\{ '--inspector-zoom': zoom \}\}><img src=\{assetOriginalUrl\(asset\)\} alt="" \/><\/div>/);
  assert.match(styles, /\.inspector-image-frame \{ position:relative; display:grid; place-items:center; width:100%; height:100%; min-height:0; overflow:hidden;/);
  assert.match(styles, /\.inspector-images img \{ position:absolute; inset:14px; display:block; width:calc\(100% - 28px\); height:calc\(100% - 28px\); max-width:none; max-height:none; object-fit:contain;/);
  assert.match(styles, /\.asset-action-menu \.creative-action-grid,\.asset-action-menu \.creative-action-grid\.is-compact \{ grid-template-columns:1fr; \}/);
  assert.match(styles, /\.asset-action-menu \.creative-action-card b,\.asset-action-menu \.creative-action-card small \{ overflow:visible; text-overflow:clip; white-space:normal; \}/);
  assert.match(styles, /\.asset-action-menu \.creative-action-panel \{ gap:10px; padding:10px; max-height:none; overflow:visible; \}/);
  assert.match(source, /<div className="project-index-list">/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /project-index-grid/);
  assert.doesNotMatch(styles, /project-index-grid/);
  assert.match(styles, /\.selection-strip-items article > button\.selection-remove \{ position:absolute; top:7px; right:7px;.*width:24px; height:24px;/);
  // 批 E（E1.6）迁移：图标清单随组件分散到各文件——改为在整个前端源码里找这三个图标。
  for (const icon of ['Activity', 'Archive', 'Bookmark']) assert.match(readFrontendSource(), new RegExp('\\b' + icon + '\\b'), icon + ' 必须在用');
});
