#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs } = require('./script_utils');
const {
  buildBoardModel,
  ensureArray,
  escapeXml,
  wrapText,
  lineClamp,
  fitImage,
  relativePath,
} = require('./storyboard_board_render_core');

function renderTextBlock({ x, y, lines, fontSize, lineHeight, fill, weight = 500, opacity = 1, family = 'PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif' }) {
  return lines.map((line, index) => {
    const yy = y + index * lineHeight;
    return `<text x="${x}" y="${yy}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}" fill-opacity="${opacity}">${escapeXml(line)}</text>`;
  }).join('\n');
}

function buildBrandPanel(region, model) {
  const titleLines = ensureArray(model.content.brand_panel?.title_lines);
  const portraitMarkup = model.brandImageRelative ? `
    <clipPath id="brandPortraitClip">
      <rect x="${region.x + 34}" y="${region.y + 86}" rx="24" ry="24" width="${region.width - 68}" height="252" />
    </clipPath>
    <image href="${escapeXml(model.brandImageRelative)}" x="${region.x + 34}" y="${region.y + 86}" width="${region.width - 68}" height="252" preserveAspectRatio="xMidYMid slice" clip-path="url(#brandPortraitClip)" />
    <rect x="${region.x + 34}" y="${region.y + 86}" rx="24" ry="24" width="${region.width - 68}" height="252" fill="rgba(255,255,255,0.12)" stroke="rgba(176,230,255,0.82)" stroke-width="1"/>
  ` : '';
  const chips = model.keywords.map((item, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const chipX = region.x + 42 + col * 186;
    const chipY = region.y + 598 + row * 60;
    return `
      <g>
        <rect x="${chipX}" y="${chipY}" rx="18" ry="18" width="160" height="40" fill="rgba(255,255,255,0.52)" stroke="rgba(155,222,255,0.94)" stroke-width="1.1"/>
        <text x="${chipX + 18}" y="${chipY + 27}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="18" font-weight="600" fill="#225170">${escapeXml(item)}</text>
      </g>
    `;
  }).join('\n');

  return `
    <g>
      <rect x="${region.x}" y="${region.y}" rx="42" ry="42" width="${region.width}" height="${region.height}" fill="rgba(255,255,255,0.48)" stroke="rgba(184,234,255,0.92)" stroke-width="1.4"/>
      <rect x="${region.x + 18}" y="${region.y + 18}" rx="34" ry="34" width="${region.width - 36}" height="${region.height - 36}" fill="rgba(255,255,255,0.24)" stroke="rgba(255,255,255,0.88)" stroke-width="1"/>
      <rect x="${region.x + 38}" y="${region.y + 40}" rx="9" ry="9" width="136" height="9" fill="url(#accentBar)"/>
      ${portraitMarkup}
      ${renderTextBlock({
        x: region.x + 40,
        y: region.y + 394,
        lines: titleLines.length ? titleLines : ['Storyboard Board'],
        fontSize: 46,
        lineHeight: 58,
        fill: '#173550',
        weight: 700,
      })}
      ${renderTextBlock({
        x: region.x + 42,
        y: region.y + 576,
        lines: lineClamp(wrapText(model.content.board_theme || '', 20), 6),
        fontSize: 18,
        lineHeight: 30,
        fill: '#426784',
        opacity: 0.96,
      })}
      <text x="${region.x + 40}" y="${region.y + 772}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="20" font-weight="700" fill="#6B92B1">核心逻辑</text>
      ${chips}
    </g>
  `;
}

function buildShotPanel(region) {
  const slot = region.slot || {};
  const result = region.result || {};
  const slotId = slot.slot_id || region.slotId || region.id;
  const title = slot.shot_label || slotId;
  const subtitle = slot.timecode || '';
  const scene = slot.scene || '';
  const voiceover = slot.voiceover || result.voiceover || '';
  const cameraMove = slot.camera_move || result.cameraMove || '稳定讲解';
  const soundEffects = slot.sound_effects || result.soundEffects || '电子氛围 / UI 提示';
  const promptHints = ensureArray(slot.prompt_hints || result.promptHints).slice(0, 3);
  const shotRole = region.role === 'kv' ? '收尾 KV' : '分镜镜头';
  const panelRadius = 28;
  const imageHeight = Math.round(region.height * 0.65);
  const captionY = region.y + imageHeight + 14;

  let imageMarkup = `
    <rect x="${region.x + 10}" y="${region.y + 10}" rx="22" ry="22" width="${region.width - 20}" height="${imageHeight - 18}" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.36)" stroke-width="1"/>
    <text x="${region.x + 28}" y="${region.y + 54}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="22" font-weight="600" fill="#6C8CA8">NO IMAGE</text>
  `;

  if (region.imageFile && fs.existsSync(region.imageFile) && region.imageSize) {
    const fitted = fitImage(region.imageSize.width, region.imageSize.height, region.width - 20, imageHeight - 18);
    imageMarkup = `
      <clipPath id="clip-${slotId}">
        <rect x="${region.x + 10}" y="${region.y + 10}" rx="22" ry="22" width="${region.width - 20}" height="${imageHeight - 18}" />
      </clipPath>
      <image href="${escapeXml(region.imageRelative)}" x="${region.x + 10 + fitted.x}" y="${region.y + 10 + fitted.y}" width="${fitted.width}" height="${fitted.height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${slotId})" />
      <rect x="${region.x + 10}" y="${region.y + 10}" rx="22" ry="22" width="${region.width - 20}" height="${imageHeight - 18}" fill="url(#imageGlow)" fill-opacity="0.12"/>
    `;
  }

  const sceneLines = lineClamp(wrapText(scene, region.width > 700 ? 26 : 18), 2);
  const voiceLines = lineClamp(wrapText(`口播：${voiceover}`, region.width > 700 ? 30 : 20), region.width > 700 ? 3 : 2);
  const metaLines = lineClamp(wrapText(`运镜：${cameraMove} ｜ 音效：${soundEffects}`, region.width > 700 ? 34 : 22), 2);
  const tagMarkup = promptHints.map((item, index) => {
    const tagX = region.x + 20 + index * 118;
    const tagY = region.y + region.height - 66;
    return `
      <g>
        <rect x="${tagX}" y="${tagY}" rx="12" ry="12" width="108" height="28" fill="rgba(255,255,255,0.54)" stroke="rgba(178,228,255,0.9)" stroke-width="0.8"/>
        <text x="${tagX + 12}" y="${tagY + 19}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="12" font-weight="600" fill="#3A6887">${escapeXml(item)}</text>
      </g>
    `;
  }).join('\n');

  return `
    <g>
      <rect x="${region.x}" y="${region.y}" rx="${panelRadius}" ry="${panelRadius}" width="${region.width}" height="${region.height}" fill="rgba(255,255,255,0.34)" stroke="rgba(174,229,255,0.94)" stroke-width="1.3"/>
      <rect x="${region.x + 4}" y="${region.y + 4}" rx="${panelRadius - 4}" ry="${panelRadius - 4}" width="${region.width - 8}" height="${region.height - 8}" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.74)" stroke-width="0.9"/>
      ${imageMarkup}
      <g>
        <rect x="${region.x + 18}" y="${region.y + 18}" rx="16" ry="16" width="110" height="34" fill="rgba(255,255,255,0.78)" stroke="rgba(170,224,255,0.82)" stroke-width="1"/>
        <text x="${region.x + 34}" y="${region.y + 41}" font-family="JetBrains Mono, SFMono-Regular, monospace" font-size="15" font-weight="700" fill="#35607F">${escapeXml(String(slotId).toUpperCase())}</text>
      </g>
      <g>
        <rect x="${region.x + 138}" y="${region.y + 18}" rx="14" ry="14" width="100" height="30" fill="rgba(255,255,255,0.70)" stroke="rgba(183,231,255,0.84)" stroke-width="1"/>
        <text x="${region.x + 154}" y="${region.y + 38}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="12" font-weight="700" fill="#507898">${escapeXml(shotRole)}</text>
      </g>
      <text x="${region.x + 20}" y="${captionY + 28}" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif" font-size="${region.width > 700 ? 24 : 19}" font-weight="700" fill="#1A3C59">${escapeXml(title)}</text>
      ${subtitle ? `<text x="${region.x + region.width - 18}" y="${captionY + 28}" text-anchor="end" font-family="JetBrains Mono, SFMono-Regular, monospace" font-size="${region.width > 700 ? 16 : 13}" font-weight="600" fill="#78A4C8">${escapeXml(subtitle)}</text>` : ''}
      ${renderTextBlock({
        x: region.x + 20,
        y: captionY + 58,
        lines: sceneLines,
        fontSize: region.width > 700 ? 18 : 15,
        lineHeight: region.width > 700 ? 26 : 22,
        fill: '#466884',
        opacity: 0.96,
      })}
      ${renderTextBlock({
        x: region.x + 20,
        y: captionY + 112,
        lines: voiceLines,
        fontSize: region.width > 700 ? 16 : 14,
        lineHeight: region.width > 700 ? 23 : 20,
        fill: '#274B67',
        opacity: 0.98,
      })}
      ${renderTextBlock({
        x: region.x + 20,
        y: region.y + region.height - 34,
        lines: metaLines,
        fontSize: region.width > 700 ? 14 : 12,
        lineHeight: 18,
        fill: '#6B8AA5',
        opacity: 0.94,
      })}
      ${tagMarkup}
    </g>
  `;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['storyboard-file']) throw new Error('Missing required flag: --storyboard-file');
  if (!args['results-files']) throw new Error('Missing required flag: --results-files');

  const outputFile = path.resolve(args['output-file'] || 'storyboard_board.svg');
  const pngOutput = args['png-output'] ? path.resolve(args['png-output']) : null;
  const model = buildBoardModel(
    path.resolve(args['storyboard-file']),
    String(args['results-files']).split(',').map((item) => item.trim()).filter(Boolean),
    outputFile,
  );
  const backgroundImage = args['background-image'] ? path.resolve(args['background-image']) : null;
  const brandImage = args['brand-image'] ? path.resolve(args['brand-image']) : null;
  model.backgroundImageRelative = backgroundImage ? relativePath(outputFile, backgroundImage) : null;
  model.brandImageRelative = brandImage ? relativePath(outputFile, brandImage) : null;

  const defs = `
    <defs>
      <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FBFDFF"/>
        <stop offset="50%" stop-color="#EEF7FF"/>
        <stop offset="100%" stop-color="#F1F0FF"/>
      </linearGradient>
      <linearGradient id="accentBar" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#79DBFF"/>
        <stop offset="100%" stop-color="#D0A9FF"/>
      </linearGradient>
      <radialGradient id="orbPink" cx="78%" cy="20%" r="34%">
        <stop offset="0%" stop-color="rgba(255, 205, 236, 0.88)"/>
        <stop offset="100%" stop-color="rgba(255, 205, 236, 0)"/>
      </radialGradient>
      <radialGradient id="orbBlue" cx="18%" cy="82%" r="40%">
        <stop offset="0%" stop-color="rgba(157, 223, 255, 0.88)"/>
        <stop offset="100%" stop-color="rgba(157, 223, 255, 0)"/>
      </radialGradient>
      <linearGradient id="imageGlow" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#ACE8FF"/>
      </linearGradient>
      <filter id="panelShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="20" stdDeviation="26" flood-color="#9CDDFF" flood-opacity="0.20"/>
      </filter>
    </defs>
  `;

  const background = `
    <rect width="${model.canvas.width}" height="${model.canvas.height}" fill="url(#bgGradient)"/>
    ${model.backgroundImageRelative ? `<image href="${escapeXml(model.backgroundImageRelative)}" x="0" y="0" width="${model.canvas.width}" height="${model.canvas.height}" preserveAspectRatio="xMidYMid slice" opacity="0.26"/>` : ''}
    <rect width="${model.canvas.width}" height="${model.canvas.height}" fill="url(#orbPink)"/>
    <rect width="${model.canvas.width}" height="${model.canvas.height}" fill="url(#orbBlue)"/>
    <rect x="56" y="56" width="${model.canvas.width - 112}" height="${model.canvas.height - 112}" rx="54" ry="54" fill="rgba(255,255,255,0.22)" stroke="rgba(196,236,255,0.94)" stroke-width="1.2"/>
    <rect x="82" y="82" width="${model.canvas.width - 164}" height="${model.canvas.height - 164}" rx="46" ry="46" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.72)" stroke-width="0.9"/>
  `;

  const panels = model.regions.map((region) => {
    if (String(region.role || '').trim() === 'brand_panel') return buildBrandPanel(region, model);
    return buildShotPanel(region);
  }).join('\n');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${model.canvas.width}" height="${model.canvas.height}" viewBox="0 0 ${model.canvas.width} ${model.canvas.height}">
${defs}
${background}
<g filter="url(#panelShadow)">
${panels}
</g>
</svg>
`;

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, svg, 'utf8');

  if (pngOutput) {
    fs.mkdirSync(path.dirname(pngOutput), { recursive: true });
    execFileSync('sips', ['-s', 'format', 'png', outputFile, '--out', pngOutput], { stdio: 'inherit' });
  }

  console.log(outputFile);
  if (pngOutput) console.log(pngOutput);
}

main();
