#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./script_utils');
const { buildBoardModel, escapeHtml, ensureArray, relativePath } = require('./storyboard_board_render_core');

function clampText(text, maxChars) {
  const source = String(text || '').trim();
  if (!source) return '';
  if (source.length <= maxChars) return source;
  return `${source.slice(0, Math.max(0, maxChars - 1))}…`;
}

function slotInfo(region) {
  const slot = region.slot || {};
  const result = region.result || {};
  const voiceover = slot.voiceover || result.voiceover || '';
  const scene = slot.scene || result.scene || '';
  const cameraMove = slot.camera_move || result.cameraMove || '稳定讲解';
  const soundEffects = slot.sound_effects || result.soundEffects || '电子氛围 / UI 提示';
  const visualSummary = slot.visual_summary || slot.visualSummary || scene || '';
  const actionSummary = slot.action_summary || slot.actionSummary || cameraMove || '';
  const logicSummary = slot.logic_summary || slot.logicSummary || '';
  return {
    slotId: region.slotId,
    title: slot.shot_label || region.slotId,
    timecode: slot.timecode || '',
    scene,
    voiceover,
    cameraMove,
    soundEffects,
    visualSummary,
    actionSummary,
    logicSummary,
    shortVisualSummary: clampText(visualSummary, 34),
    shortActionSummary: clampText(actionSummary, 26),
    shortVoiceover: clampText(voiceover, 78),
  };
}

function phaseForIndex(index) {
  if (index <= 2) {
    return {
      key: 'phase-a',
      label: '行情 / 问题',
      summary: '情绪升温只是表象，先把问题钩出来。',
    };
  }
  if (index <= 5) {
    return {
      key: 'phase-b',
      label: '周期 / 驱动',
      summary: '库存回暖、AI 拉动、国产替代开始形成共振。',
    };
  }
  return {
    key: 'phase-c',
    label: '落地 / 风险',
    summary: '从产业链落到生活，再收束到长期主义与波动提醒。',
  };
}

function boardLayout(canvas) {
  const outer = 32;
  const topBarH = 244;
  const topGap = 18;
  const cols = 5;
  const rows = 2;
  const gapX = 18;
  const gapY = 18;
  const cardW = Math.floor((canvas.width - outer * 2 - gapX * (cols - 1)) / cols);
  const cardH = Math.floor((canvas.height - outer * 2 - topBarH - topGap - gapY) / rows);
  return {
    outer,
    topBar: {
      x: outer,
      y: outer,
      width: canvas.width - outer * 2,
      height: topBarH,
    },
    grid: {
      x: outer,
      y: outer + topBarH + topGap,
      cols,
      rows,
      gapX,
      gapY,
      cardW,
      cardH,
    },
  };
}

function renderMedia(imageRelative, alt, extraClass = '') {
  if (!imageRelative) {
    return `<div class="media-empty">NO IMAGE</div>`;
  }
  return `
    <img class="media-blur" src="${escapeHtml(imageRelative)}" alt="${escapeHtml(alt)}" />
    <img class="media-image ${extraClass}" src="${escapeHtml(imageRelative)}" alt="${escapeHtml(alt)}" />
  `;
}

function resolveExistingFile(filePath) {
  if (!filePath) return null;
  const absolute = path.resolve(filePath);
  return fs.existsSync(absolute) ? absolute : null;
}

function findReferenceAssetPath(storyboard, preferredAssetIds = []) {
  const assets = ensureArray(storyboard?.reference_bindings?.assets);
  for (const assetId of preferredAssetIds) {
    const match = assets.find((item) => String(item.asset_id || '').trim() === String(assetId || '').trim());
    const resolved = resolveExistingFile(match?.path);
    if (resolved) return resolved;
  }
  return null;
}

function renderTopBar(model, layout) {
  const brandPanel = model.content.brand_panel || {};
  const titleLines = ensureArray(brandPanel.title_lines);
  const persona = titleLines[0] || 'Yomi米姐';
  const boardName = titleLines[1] || brandPanel.script_title || '半导体口播分镜版';
  const subTitle = titleLines[2] || brandPanel.theme_line || '主题：半导体逆势狂飙，芯片行情凭什么火？';
  const personaLine = brandPanel.persona_line || '人物设定：Yomi米姐（专业、睿智、亲和力强的财经主播）';
  const visualLine = brandPanel.visual_line || '核心视觉：科技感全息投影、产业链模型、动态数据图表';
  const conciseSummary = brandPanel.summary || '核心判断：半导体这轮上涨，不只是情绪升温，而是海外 AI 算力回暖与国产替代提速同步共振。';
  const logicItems = ensureArray(brandPanel.logic_items).length
    ? ensureArray(brandPanel.logic_items)
    : [
        '去库存接近尾声，订单与资本开支回暖。',
        '海外 AI 需求外溢，数据中心扩建抬升芯片需求。',
        '国产替代加速推进，产业链补齐形成长期驱动。',
      ];
  const chips = ensureArray(brandPanel.keywords).length
    ? ensureArray(brandPanel.keywords)
    : ['内外共振', 'AI算力外溢', '国产替代提速', '产业链落地', '长期主义'];
  const summaryMark = brandPanel.summary_mark || 'SEMI / 2026 / ORAL BOARD';
  const personaText = personaLine.replace(/^人物设定：/, '');
  const visualText = visualLine.replace(/^核心视觉：/, '');
  const sideTitle = brandPanel.side_title || '本期拆解主线';
  const storySlotCount = ensureArray(model.content.slots).filter((item) => item && item.role !== 'brand_panel').length;
  const statItems = ensureArray(brandPanel.stat_items).length
    ? ensureArray(brandPanel.stat_items)
    : [
        { label: '脚本结构', value: `${storySlotCount} 段` },
        { label: '主讲定位', value: '财经主播' },
        { label: '画面语气', value: '科技演播室' },
      ];
  const routeText = brandPanel.route_text || '热点开篇 / 周期拆解 / 双轮驱动 / 生活连接 / 风险回归';

  return `
    <section class="topbar panel" style="left:${layout.topBar.x}px;top:${layout.topBar.y}px;width:${layout.topBar.width}px;height:${layout.topBar.height}px;">
      <div class="topbar-ribbon"></div>
      <div class="topbar-grid"></div>
      <div class="topbar-glow topbar-glow-a"></div>
      <div class="topbar-glow topbar-glow-b"></div>
      <div class="topbar-profile">
        <div class="topbar-avatar">
          ${renderMedia(model.brandImageRelative, 'Yomi米姐', 'media-image-portrait')}
          <div class="topbar-avatar-badge">
            <span>HOST</span>
            <strong>${escapeHtml(persona)}</strong>
          </div>
        </div>
        <div class="topbar-profile-card">
          <div class="topbar-profile-eyebrow">人物设定</div>
          <p>${escapeHtml(personaText)}</p>
        </div>
      </div>
      <div class="topbar-main">
        <div class="topbar-kicker">YOMI MIJIE · SEMICONDUCTOR STORYBOARD</div>
        <div class="topbar-heading">
          <h1>${escapeHtml(boardName)}</h1>
          <h2>${escapeHtml(subTitle)}</h2>
        </div>
        <div class="topbar-theme-pill">${escapeHtml(summaryMark)}</div>
        <p class="topbar-summary">${escapeHtml(conciseSummary)}</p>
        <div class="topbar-detail-grid">
          <div class="topbar-detail-card">
            <span>主讲路线</span>
            <strong>${escapeHtml(routeText)}</strong>
          </div>
          <div class="topbar-detail-card">
            <span>核心视觉</span>
            <strong>${escapeHtml(visualText)}</strong>
          </div>
        </div>
        <div class="topbar-chip-bar">
          <div class="topbar-chip-bar-label">关键词</div>
          <div class="topbar-chips">
            ${chips.map((item) => `<em>${escapeHtml(item)}</em>`).join('')}
          </div>
        </div>
      </div>
      <div class="topbar-side">
        <div class="topbar-side-panel">
          <div class="topbar-side-label">${escapeHtml(sideTitle)}</div>
          <div class="topbar-logic">
            ${logicItems.map((item, index) => `
              <div class="topbar-logic-item">
                <span>${String(index + 1).padStart(2, '0')}</span>
                <strong>${escapeHtml(item)}</strong>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="topbar-stats">
          ${statItems.map((item) => `
            <div class="topbar-stat-card">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
  `;
}

function renderCard(region, index, layout) {
  const info = slotInfo(region);
  const col = index % layout.grid.cols;
  const row = Math.floor(index / layout.grid.cols);
  const x = layout.grid.x + col * (layout.grid.cardW + layout.grid.gapX);
  const y = layout.grid.y + row * (layout.grid.cardH + layout.grid.gapY);
  const width = layout.grid.cardW;
  const height = layout.grid.cardH;
  const phase = phaseForIndex(index);

  return `
    <section class="story-card panel" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px;">
      <div class="story-card-media">
        ${renderMedia(region.imageRelative, info.title)}
        <div class="story-phase story-phase-${escapeHtml(phase.key)}">${escapeHtml(phase.label)}</div>
        <div class="story-pill story-pill-left">${escapeHtml(String(info.slotId).toUpperCase())}</div>
        <div class="story-pill story-pill-right">${escapeHtml(info.timecode)}</div>
      </div>
      <div class="story-copy">
        <div class="story-copy-header">
          <span class="story-role">${escapeHtml(phase.label)}</span>
          <h2>${escapeHtml(info.title)}</h2>
        </div>
        <div class="story-copy-block">
          <span class="story-copy-label">视觉</span>
          <p class="story-copy-text">${escapeHtml(info.shortVisualSummary)}</p>
        </div>
        <div class="story-copy-block">
          <span class="story-copy-label">动作</span>
          <p class="story-copy-text">${escapeHtml(info.shortActionSummary)}</p>
        </div>
        ${info.logicSummary ? `
        <div class="story-copy-block story-copy-block-logic">
          <span class="story-copy-label">逻辑</span>
          <p class="story-copy-text">${escapeHtml(clampText(info.logicSummary, 34))}</p>
        </div>` : ''}
        <p class="story-voice">${escapeHtml(info.shortVoiceover)}</p>
        <div class="story-meta">
          <span>运镜：${escapeHtml(clampText(info.cameraMove, 18))}</span>
          <span>段落：${escapeHtml(clampText(phase.summary, 20))}</span>
        </div>
      </div>
    </section>
  `;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['storyboard-file']) throw new Error('Missing required flag: --storyboard-file');
  if (!args['results-files']) throw new Error('Missing required flag: --results-files');

  const outputFile = path.resolve(args['output-file'] || 'storyboard_board_pro.html');
  const model = buildBoardModel(
    path.resolve(args['storyboard-file']),
    String(args['results-files']).split(',').map((item) => item.trim()).filter(Boolean),
    outputFile,
  );

  const backgroundImage = resolveExistingFile(args['background-image']) || findReferenceAssetPath(model.storyboard, ['studio_background']);
  const brandImage = resolveExistingFile(args['brand-image']) || findReferenceAssetPath(model.storyboard, ['mijie_master']);
  model.backgroundImageRelative = backgroundImage ? relativePath(outputFile, backgroundImage) : null;
  model.brandImageRelative = brandImage ? relativePath(outputFile, brandImage) : null;

  const layout = boardLayout(model.canvas);
  const shots = model.regions
    .filter((region) => String(region.role || '').trim() === 'shot')
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(model.content.board_title || model.content.board_id || 'Storyboard Board')}</title>
  <style>
    :root {
      --bg-a: #07111e;
      --bg-b: #0d1d32;
      --bg-c: #142741;
      --panel: rgba(11, 24, 42, 0.68);
      --panel-border: rgba(122, 191, 255, 0.34);
      --text-main: #eff7ff;
      --text-sub: rgba(214, 232, 255, 0.86);
      --text-soft: rgba(174, 203, 232, 0.66);
      --shadow: 0 28px 70px rgba(4, 10, 18, 0.42);
      --overlay: rgba(6, 16, 28, 0.88);
      --overlay-soft: rgba(126, 190, 255, 0.16);
      --accent-a: #69d0ff;
      --accent-b: #8d8cff;
      --accent-c: #69ffc9;
      --card-surface: rgba(7, 16, 29, 0.72);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      background:
        radial-gradient(circle at 18% 20%, rgba(105, 208, 255, 0.18), transparent 26%),
        radial-gradient(circle at 80% 14%, rgba(141, 140, 255, 0.16), transparent 24%),
        linear-gradient(135deg, var(--bg-a) 0%, var(--bg-b) 52%, var(--bg-c) 100%);
      color: var(--text-main);
    }
    .page {
      width: ${model.canvas.width}px;
      margin: 0;
    }
    .board {
      position: relative;
      width: ${model.canvas.width}px;
      height: ${model.canvas.height}px;
      border-radius: 54px;
      overflow: hidden;
      border: 1px solid rgba(129, 196, 255, 0.34);
      background:
        linear-gradient(180deg, rgba(16,30,50,0.94), rgba(8,16,30,0.98)),
        linear-gradient(135deg, rgba(83, 181, 255, 0.08), rgba(141, 140, 255, 0.08));
      box-shadow: var(--shadow);
    }
    .board::before {
      content: "";
      position: absolute;
      inset: 22px;
      border-radius: 40px;
      border: 1px solid rgba(160, 217, 255, 0.16);
      pointer-events: none;
      z-index: 0;
    }
    .board::after {
      content: "";
      position: absolute;
      inset: 0;
      background:
        ${model.backgroundImageRelative ? `linear-gradient(180deg, rgba(6,16,28,0.56), rgba(6,16,28,0.20)), url("${escapeHtml(model.backgroundImageRelative)}") center/cover no-repeat;` : 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04));'}
      opacity: 0.18;
      mix-blend-mode: lighten;
      pointer-events: none;
      z-index: 0;
    }
    .panel {
      position: absolute;
      background:
        linear-gradient(180deg, rgba(28,49,77,0.64), rgba(9,20,37,0.82)),
        var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 30px;
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
      overflow: hidden;
      z-index: 2;
    }
    .topbar {
      display: grid;
      grid-template-columns: 300px minmax(0, 1.28fr) minmax(0, 0.92fr);
      gap: 24px;
      padding: 26px 28px 24px;
      background:
        radial-gradient(circle at 13% 18%, rgba(105, 208, 255, 0.18), transparent 24%),
        radial-gradient(circle at 88% 14%, rgba(141, 140, 255, 0.20), transparent 24%),
        linear-gradient(180deg, rgba(18,37,60,0.96), rgba(9,19,35,0.92));
    }
    .topbar-glow {
      position: absolute;
      border-radius: 999px;
      filter: blur(22px);
      pointer-events: none;
      z-index: 1;
    }
    .topbar-glow-a {
      width: 220px;
      height: 220px;
      left: 210px;
      top: -70px;
      background: rgba(105, 208, 255, 0.12);
    }
    .topbar-glow-b {
      width: 260px;
      height: 220px;
      right: 320px;
      bottom: -92px;
      background: rgba(141, 140, 255, 0.12);
    }
    .topbar-profile,
    .topbar-main,
    .topbar-side {
      position: relative;
      z-index: 2;
      min-width: 0;
    }
    .topbar-profile {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .topbar-ribbon {
      position: absolute;
      left: 28px;
      top: 16px;
      width: 184px;
      height: 12px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--accent-a), var(--accent-b));
      box-shadow: 0 0 22px rgba(139, 220, 255, 0.42);
    }
    .topbar-grid {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(rgba(148, 202, 248, 0.08) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148, 202, 248, 0.08) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: linear-gradient(180deg, rgba(0,0,0,0.42), rgba(0,0,0,0));
      pointer-events: none;
    }
    .topbar-avatar {
      position: relative;
      border-radius: 30px;
      overflow: hidden;
      border: 1px solid rgba(129, 196, 255, 0.34);
      background: linear-gradient(180deg, rgba(34,58,88,0.66), rgba(16,27,46,0.56));
      min-height: 152px;
      box-shadow:
        inset 0 1px 0 rgba(177,216,255,0.18),
        0 18px 34px rgba(7, 14, 24, 0.26);
    }
    .topbar-avatar::after {
      content: "";
      position: absolute;
      inset: auto 0 0 0;
      height: 44%;
      background: linear-gradient(180deg, rgba(10, 26, 40, 0), rgba(10, 26, 40, 0.52));
      z-index: 2;
      pointer-events: none;
    }
    .topbar-avatar-badge {
      position: absolute;
      left: 16px;
      right: 16px;
      bottom: 16px;
      z-index: 3;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 18px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)),
        rgba(7, 18, 32, 0.56);
      border: 1px solid rgba(160, 217, 255, 0.16);
      backdrop-filter: blur(10px);
      box-shadow: 0 10px 24px rgba(5, 12, 20, 0.24);
    }
    .topbar-avatar-badge span {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.16);
      border: 1px solid rgba(255,255,255,0.20);
      color: rgba(233,245,255,0.88);
      font-size: 11px;
      line-height: 1;
      letter-spacing: 0.16em;
      font-weight: 700;
      text-transform: uppercase;
    }
    .topbar-avatar-badge strong {
      color: #fff;
      font-size: 20px;
      line-height: 1;
      letter-spacing: -0.02em;
    }
    .topbar-profile-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px 14px;
      border-radius: 22px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)),
        rgba(7, 17, 31, 0.44);
      border: 1px solid rgba(129, 196, 255, 0.14);
      box-shadow: inset 0 1px 0 rgba(177,216,255,0.08);
    }
    .topbar-profile-eyebrow {
      font-size: 11px;
      line-height: 1;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #9fc9ec;
      font-weight: 700;
    }
    .topbar-profile-card p {
      margin: 0;
      font-size: 13px;
      line-height: 1.5;
      color: rgba(228,244,255,0.82);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .topbar-main, .topbar-side {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .topbar-kicker {
      font-size: 12px;
      line-height: 1;
      letter-spacing: 0.18em;
      font-weight: 700;
      color: #86abd2;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .topbar-heading h1 {
      margin: 0;
      font-size: 52px;
      line-height: 0.94;
      letter-spacing: -0.03em;
      color: #f4fbff;
    }
    .topbar-heading h2 {
      margin: 10px 0 0;
      max-width: 920px;
      font-size: 22px;
      line-height: 1.38;
      letter-spacing: -0.01em;
      color: rgba(223, 240, 255, 0.88);
      font-weight: 500;
    }
    .topbar-theme-pill {
      display: inline-flex;
      align-items: center;
      align-self: flex-start;
      margin-top: 14px;
      padding: 10px 16px;
      border-radius: 999px;
      background:
        linear-gradient(90deg, rgba(105, 208, 255, 0.16), rgba(141, 140, 255, 0.22)),
        rgba(8, 18, 34, 0.64);
      border: 1px solid rgba(129, 196, 255, 0.26);
      box-shadow: inset 0 1px 0 rgba(177,216,255,0.12);
      color: #e8f6ff;
      font-size: 13px;
      line-height: 1.2;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .topbar-detail-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 16px;
    }
    .topbar-detail-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 14px 16px;
      border-radius: 20px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
        rgba(7, 17, 31, 0.46);
      border: 1px solid rgba(129, 196, 255, 0.14);
    }
    .topbar-detail-card span {
      font-size: 11px;
      line-height: 1;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #9fc9ec;
      font-weight: 700;
    }
    .topbar-detail-card strong {
      font-size: 15px;
      line-height: 1.45;
      color: #edf8ff;
      font-weight: 600;
    }
    .topbar-summary {
      margin: 0;
      margin-top: 14px;
      font-size: 22px;
      line-height: 1.5;
      color: #f3fbff;
      padding: 0;
      max-width: 980px;
      background: none;
      border: 0;
    }
    .topbar-chip-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid rgba(129, 196, 255, 0.12);
    }
    .topbar-chip-bar-label {
      flex: 0 0 auto;
      font-size: 11px;
      line-height: 1;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #9fc9ec;
      font-weight: 700;
    }
    .topbar-summary-mark {
      flex: 0 0 auto;
      font-size: 11px;
      line-height: 1.2;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #cae7ff;
      padding: 10px 12px;
      border-radius: 999px;
      background:
        linear-gradient(90deg, rgba(105, 208, 255, 0.12), rgba(141, 140, 255, 0.12)),
        rgba(9, 22, 38, 0.66);
      border: 1px solid rgba(129, 196, 255, 0.22);
    }
    .topbar-side-label {
      font-size: 13px;
      line-height: 1;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #9ec2e3;
      margin-bottom: 14px;
      font-weight: 700;
    }
    .topbar-side-panel {
      padding: 18px 18px 16px;
      border-radius: 24px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)),
        rgba(7, 17, 31, 0.44);
      border: 1px solid rgba(129, 196, 255, 0.14);
    }
    .topbar-logic {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .topbar-logic-item {
      display: grid;
      grid-template-columns: 36px 1fr;
      gap: 14px;
      align-items: start;
    }
    .topbar-logic-item span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 999px;
      background: linear-gradient(180deg, rgba(105, 208, 255, 0.24), rgba(141, 140, 255, 0.18));
      border: 1px solid rgba(129, 196, 255, 0.22);
      color: #f3fbff;
      font-size: 12px;
      font-weight: 700;
      box-shadow: 0 6px 16px rgba(7, 14, 24, 0.22);
    }
    .topbar-logic-item strong {
      font-size: 16px;
      line-height: 1.42;
      color: #e8f5ff;
      font-weight: 600;
    }
    .topbar-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 14px;
    }
    .topbar-stat-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px 12px 11px;
      border-radius: 18px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)),
        rgba(7, 17, 31, 0.42);
      border: 1px solid rgba(129, 196, 255, 0.12);
    }
    .topbar-stat-card span {
      font-size: 10px;
      line-height: 1;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #97bfdf;
      font-weight: 700;
    }
    .topbar-stat-card strong {
      font-size: 18px;
      line-height: 1.18;
      color: #f5fbff;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .topbar-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      margin-top: 0;
    }
    .topbar-chips em {
      font-style: normal;
      padding: 8px 13px;
      border-radius: 999px;
      background: rgba(10, 22, 39, 0.58);
      border: 1px solid rgba(129, 196, 255, 0.20);
      color: #d6ecff;
      font-size: 12px;
      font-weight: 600;
    }
    .story-card {
      display: flex;
      flex-direction: column;
      padding: 12px;
      background:
        linear-gradient(180deg, rgba(39,62,89,0.48), rgba(7,18,31,0.72)),
        rgba(6,15,26,0.58);
    }
    .story-card-media {
      position: relative;
      width: 100%;
      flex: 0 0 535px;
      border-radius: 24px;
      overflow: hidden;
      background: linear-gradient(135deg, rgba(28,51,78,0.56), rgba(11,21,36,0.32));
      border: 1px solid rgba(184, 226, 255, 0.18);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
    }
    .story-copy {
      position: relative;
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px 16px 14px;
      border-radius: 24px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)),
        rgba(8, 18, 31, 0.76);
      border: 1px solid rgba(255,255,255,0.10);
      backdrop-filter: blur(14px);
      box-shadow: 0 14px 36px rgba(5, 12, 20, 0.28);
      flex: 0 0 auto;
    }
    .story-copy-header h2 {
      margin: 6px 0 0;
      font-size: 28px;
      line-height: 1.08;
      letter-spacing: -0.02em;
      color: #fff;
      text-shadow: 0 2px 12px rgba(0,0,0,0.26);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .story-copy-block {
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 8px;
      align-items: start;
      padding: 8px 10px;
      border-radius: 16px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .story-copy-block-logic {
      background: rgba(105, 208, 255, 0.08);
      border-color: rgba(129, 196, 255, 0.12);
    }
    .story-copy-label {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      background: rgba(105, 208, 255, 0.14);
      color: #d8efff;
      font-size: 11px;
      line-height: 1;
      letter-spacing: 0.08em;
      font-weight: 700;
    }
    .story-copy-text {
      margin: 0;
      font-size: 14px;
      line-height: 1.5;
      color: rgba(231,244,255,0.88);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .story-role {
      display: inline-flex;
      align-items: center;
      padding: 5px 10px;
      border-radius: 999px;
      background: rgba(105, 208, 255, 0.12);
      border: 1px solid rgba(129, 196, 255, 0.18);
      color: #dbf0ff;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      backdrop-filter: blur(8px);
    }
    .story-voice {
      margin: 0;
      font-size: 16px;
      line-height: 1.56;
      color: rgba(255,255,255,0.92);
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-shadow: 0 2px 10px rgba(0,0,0,0.22);
    }
    .story-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 10px;
      font-size: 14px;
      line-height: 1.4;
      color: rgba(218,236,255,0.76);
    }
    .story-meta span {
      display: inline-flex;
      align-items: center;
      padding: 5px 8px;
      border-radius: 999px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.08);
    }
    .story-pill {
      position: absolute;
      top: 14px;
      z-index: 4;
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(8, 20, 35, 0.72);
      border: 1px solid rgba(129, 196, 255, 0.20);
      color: #d8efff;
      font-size: 13px;
      font-weight: 700;
      backdrop-filter: blur(8px);
    }
    .story-pill-left { left: 14px; }
    .story-pill-right { right: 14px; }
    .story-phase {
      position: absolute;
      left: 14px;
      top: 58px;
      z-index: 4;
      padding: 7px 11px;
      border-radius: 999px;
      font-size: 12px;
      line-height: 1;
      letter-spacing: 0.08em;
      font-weight: 700;
      color: #f5fbff;
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.12);
    }
    .story-phase-phase-a {
      background: rgba(105, 208, 255, 0.18);
    }
    .story-phase-phase-b {
      background: rgba(141, 140, 255, 0.18);
    }
    .story-phase-phase-c {
      background: rgba(105, 255, 201, 0.16);
    }
    .media-blur,
    .media-image {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
    .media-blur {
      object-fit: cover;
      transform: scale(1.05);
      filter: blur(18px) saturate(1.02) brightness(0.58);
      opacity: 0.58;
      z-index: 1;
    }
    .media-image {
      object-fit: cover;
      padding: 0;
      z-index: 2;
    }
    .media-image-portrait {
      object-fit: contain;
      object-position: center 14%;
      padding: 8px 12px 0;
    }
    .media-empty {
      display: grid;
      place-items: center;
      width: 100%;
      height: 100%;
      color: var(--text-soft);
      letter-spacing: 0.08em;
    }
  </style>
</head>
<body>
  <div class="page">
    <main class="board">
      ${renderTopBar(model, layout)}
      ${shots.map((region, index) => renderCard(region, index, layout)).join('\n')}
    </main>
  </div>
</body>
</html>`;

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, html, 'utf8');
  console.log(outputFile);
}

main();
