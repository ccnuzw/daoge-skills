const fs = require('fs');
const path = require('path');
const { parseArgs, readJson } = require('./script_utils');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function findSlotImage(slotId, results) {
  const hit = results.find((item) => String(item.slotId || item.slot_id || '').trim() === String(slotId || '').trim() && item.ok !== false);
  return hit ? hit.output || null : null;
}

function renderBrandPanel(region, content) {
  const titleLines = ensureArray(content?.brand_panel?.title_lines);
  return `
    <div class="panel panel-brand" style="left:${region.x}px;top:${region.y}px;width:${region.width}px;height:${region.height}px;">
      <div class="panel-brand-inner">
        ${titleLines.length ? titleLines.map((item) => `<div class="brand-line">${escapeHtml(item)}</div>`).join('') : '<div class="brand-line muted">Brand panel</div>'}
        <div class="brand-meta">${escapeHtml(content?.board_theme || '')}</div>
      </div>
    </div>
  `;
}

function renderImageRegion(region, slot, outputPath, outputDir) {
  const relativeImage = outputPath ? path.relative(outputDir, outputPath) : null;
  return `
    <div class="panel panel-shot" style="left:${region.x}px;top:${region.y}px;width:${region.width}px;height:${region.height}px;">
      <div class="panel-frame ${relativeImage ? 'has-image' : 'missing-image'}">
        ${relativeImage ? `<img src="${escapeHtml(relativeImage)}" alt="${escapeHtml(slot?.shot_label || slot?.slot_id || region.id)}" />` : '<div class="placeholder">No image</div>'}
      </div>
      <div class="panel-caption">
        <div class="panel-title">${escapeHtml(slot?.shot_label || slot?.slot_id || region.id)}</div>
        <div class="panel-meta">${escapeHtml(slot?.timecode || slot?.slot_role || slot?.role || '')}</div>
        <div class="panel-scene">${escapeHtml(slot?.scene || '')}</div>
      </div>
    </div>
  `;
}

function buildSlotMap(storyboard) {
  const slotBlueprint = ensureArray(storyboard.slot_blueprint);
  return new Map(slotBlueprint.map((item) => [item.slot_id, item]));
}

function buildBindingMap(layout) {
  const map = new Map();
  ensureArray(layout.bindings).forEach((binding) => {
    if (binding.region_id && binding.slot_id) map.set(binding.region_id, binding.slot_id);
  });
  return map;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['storyboard-file']) throw new Error('Missing required flag: --storyboard-file');
  if (!args['results-file']) throw new Error('Missing required flag: --results-file');

  const storyboardFile = path.resolve(args['storyboard-file']);
  const resultsFile = path.resolve(args['results-file']);
  const storyboard = readJson(storyboardFile);
  const results = readJson(resultsFile);
  const outputDir = path.resolve(args['output-dir'] || path.dirname(resultsFile));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'storyboard_board.html'));

  const layout = storyboard.layout || {};
  const content = storyboard.content || {};
  const canvas = layout.canvas || {};
  const regions = ensureArray(layout.regions);
  const bindingMap = buildBindingMap(layout);
  const slotMap = buildSlotMap(storyboard);

  const body = regions.map((region) => {
    const slotId = bindingMap.get(region.id) || region.id;
    const slot = slotMap.get(slotId) || content.slots?.find((item) => item.slot_id === slotId) || null;
    if (String(region.role || slot?.role || '').trim() === 'brand_panel') {
      return renderBrandPanel(region, content);
    }
    const output = findSlotImage(slotId, results);
    return renderImageRegion(region, slot, output, outputDir);
  }).join('\n');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(content.board_title || content.board_id || 'Storyboard Board')}</title>
  <style>
    :root {
      --board-bg: ${canvas.background || '#0f1115'};
      --panel-bg: rgba(255,255,255,0.06);
      --panel-border: rgba(255,255,255,0.12);
      --text-main: #f4f0e8;
      --text-sub: rgba(244,240,232,0.7);
      --accent: #d7b56d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at top left, rgba(215,181,109,0.18), transparent 28%),
        linear-gradient(135deg, #0b0d11 0%, #171c23 48%, #0f1115 100%);
      color: var(--text-main);
      font-family: "Noto Serif SC", "PingFang SC", "Hiragino Sans GB", serif;
      padding: 24px;
    }
    .board-shell {
      max-width: min(100vw - 48px, ${canvas.width || 1920}px);
      margin: 0 auto;
    }
    .board-title {
      margin: 0 0 16px;
      font-size: 28px;
      letter-spacing: 0.04em;
    }
    .board-subtitle {
      margin: 0 0 24px;
      color: var(--text-sub);
      font-size: 14px;
    }
    .board {
      position: relative;
      width: 100%;
      aspect-ratio: ${(canvas.width || 16)} / ${(canvas.height || 9)};
      background: var(--board-bg);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 20px 80px rgba(0,0,0,0.35);
    }
    .panel {
      position: absolute;
      border: 1px solid var(--panel-border);
      background: var(--panel-bg);
      backdrop-filter: blur(10px);
      border-radius: 18px;
      overflow: hidden;
    }
    .panel-frame {
      width: 100%;
      height: calc(100% - 74px);
      background: rgba(255,255,255,0.04);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .panel-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .panel-frame.missing-image {
      background:
        linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)),
        repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0, rgba(255,255,255,0.04) 8px, transparent 8px, transparent 16px);
    }
    .placeholder {
      color: var(--text-sub);
      font-size: 14px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .panel-caption {
      padding: 12px 14px 14px;
    }
    .panel-title {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .panel-meta {
      color: var(--accent);
      font-size: 12px;
      margin-bottom: 6px;
    }
    .panel-scene {
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.45;
    }
    .panel-brand {
      display: flex;
      align-items: stretch;
    }
    .panel-brand-inner {
      padding: 32px 28px;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      gap: 12px;
      width: 100%;
      background:
        linear-gradient(180deg, rgba(215,181,109,0.14), transparent 38%),
        rgba(255,255,255,0.02);
    }
    .brand-line {
      font-size: 36px;
      line-height: 1.1;
      letter-spacing: 0.05em;
    }
    .brand-line.muted {
      color: var(--text-sub);
      font-size: 18px;
    }
    .brand-meta {
      margin-top: auto;
      font-size: 13px;
      color: var(--text-sub);
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="board-shell">
    <h1 class="board-title">${escapeHtml(content.board_title || content.board_id || 'Storyboard Board')}</h1>
    <p class="board-subtitle">${escapeHtml(content.board_theme || '')}</p>
    <div class="board">
      ${body}
    </div>
  </div>
</body>
</html>`;

  fs.writeFileSync(outputPath, html);
  console.log(JSON.stringify({
    outputPath,
    regionCount: regions.length,
    renderedImageSlots: regions.filter((region) => {
      const slotId = bindingMap.get(region.id) || region.id;
      return Boolean(findSlotImage(slotId, results));
    }).length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
