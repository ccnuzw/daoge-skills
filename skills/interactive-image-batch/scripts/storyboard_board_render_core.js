const fs = require('fs');
const path = require('path');
const { readJson } = require('./script_utils');

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

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text, maxChars) {
  const source = String(text || '').trim();
  if (!source) return [];
  const lines = [];
  let current = '';
  for (const ch of source) {
    if ((current + ch).length <= maxChars) {
      current += ch;
      continue;
    }
    lines.push(current);
    current = ch;
  }
  if (current) lines.push(current);
  return lines;
}

function lineClamp(lines, maxLines) {
  if (lines.length <= maxLines) return lines;
  const sliced = lines.slice(0, maxLines);
  const last = sliced[maxLines - 1];
  sliced[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
  return sliced;
}

function relativePath(fromFile, targetFile) {
  return path.relative(path.dirname(fromFile), targetFile).split(path.sep).join('/');
}

function collectResults(resultFiles) {
  const results = [];
  resultFiles.forEach((file) => {
    const parsed = readJson(path.resolve(file));
    if (Array.isArray(parsed)) {
      results.push(...parsed);
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.results)) {
        results.push(...parsed.results);
      } else {
        results.push(parsed);
      }
    }
  });
  return results;
}

function findSlotResult(slotId, results) {
  return results.find((item) => String(item.slotId || item.slot_id || '').trim() === String(slotId || '').trim()) || null;
}

function parsePngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`Unsupported or invalid PNG: ${file}`);
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function fitImage(srcW, srcH, boxW, boxH) {
  const scale = Math.max(boxW / srcW, boxH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const x = (boxW - drawW) / 2;
  const y = (boxH - drawH) / 2;
  return { x, y, width: drawW, height: drawH };
}

function buildBoardModel(storyboardFile, resultFiles, outputFile) {
  const storyboard = readJson(path.resolve(storyboardFile));
  const results = collectResults(resultFiles);
  const layout = storyboard.layout || {};
  const content = storyboard.content || {};
  const canvas = layout.canvas || { width: 3840, height: 2160, background: '#F8FBFF' };
  const bindingMap = new Map(ensureArray(layout.bindings).map((item) => [item.region_id, item.slot_id]));
  const slotMap = new Map(ensureArray(content.slots).map((item) => [item.slot_id, item]));

  const regions = ensureArray(layout.regions).map((region) => {
    const slotId = bindingMap.get(region.id) || region.id;
    const slot = slotMap.get(slotId) || null;
    const result = findSlotResult(slotId, results);
    const imageFile = result?.output ? path.resolve(result.output) : null;
    const imageRelative = imageFile && outputFile ? relativePath(outputFile, imageFile) : null;
    const imageSize = imageFile && fs.existsSync(imageFile) ? parsePngSize(imageFile) : null;
    return {
      ...region,
      slotId,
      slot,
      result,
      imageFile,
      imageRelative,
      imageSize,
    };
  });

  const keywords = ensureArray(content.brand_panel?.keywords || [
    '内外共振',
    'AI算力',
    '国产替代',
    '产业链落地',
    '长期主义',
    '高波动风险',
  ]);

  return {
    storyboard,
    results,
    layout,
    content,
    canvas,
    regions,
    keywords,
  };
}

module.exports = {
  ensureArray,
  escapeHtml,
  escapeXml,
  wrapText,
  lineClamp,
  relativePath,
  collectResults,
  findSlotResult,
  parsePngSize,
  fitImage,
  buildBoardModel,
};
