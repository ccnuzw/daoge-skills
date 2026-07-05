const fs = require('fs');
const path = require('path');
const { toArray } = require('../shared/workspace');

function isPathLike(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^(https?:|data:|file:)/i.test(text)) return false;
  return true;
}

function resolveMaterialPath(value, baseDir) {
  const text = String(value || '').trim();
  if (!text || !isPathLike(text)) return text;
  return path.isAbsolute(text) ? text : path.resolve(baseDir || process.cwd(), text);
}

function existsAsFile(value) {
  if (!value || !isPathLike(value) || !fs.existsSync(value)) return false;
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function itemLabel(item, index) {
  return item.slot_id || item.slug || item.title || item.index || index + 1;
}

function normalizePromptMaterials(prompts, options = {}) {
  const baseDir = options.promptsFile ? path.dirname(path.resolve(options.promptsFile)) : (options.baseDir || process.cwd());
  const issues = [];
  const normalized = toArray(prompts).map((item, index) => {
    const next = { ...(item || {}) };
    const params = { ...(next.params || {}) };
    const itemIssues = [];
    const referenceSources = unique([
      ...toArray(next.reference_images),
      ...toArray(next.referenceImages),
      ...toArray(params.reference_images),
    ]);
    const referenceImages = unique(referenceSources.map((source) => resolveMaterialPath(source, baseDir)));
    const rawMask = params.mask_image || next.mask_image || next.edit_mask || '';
    const maskImage = rawMask ? resolveMaterialPath(rawMask, baseDir) : null;

    referenceImages.forEach((filePath) => {
      if (isPathLike(filePath) && !existsAsFile(filePath)) {
        itemIssues.push({
          promptIndex: next.index ?? index + 1,
          title: `第 ${index + 1} 条参考图找不到`,
          message: `缺少参考图：${filePath}`,
          field: 'reference_images',
          path: filePath,
        });
      }
    });
    if (maskImage && isPathLike(maskImage) && !existsAsFile(maskImage)) {
      itemIssues.push({
        promptIndex: next.index ?? index + 1,
        title: `第 ${index + 1} 条遮罩图找不到`,
        message: `缺少遮罩图：${maskImage}`,
        field: 'mask_image',
        path: maskImage,
      });
    }

    if (referenceImages.length) {
      next.reference_images = referenceImages;
      if (Object.prototype.hasOwnProperty.call(next, 'referenceImages')) next.referenceImages = referenceImages;
      if (Object.prototype.hasOwnProperty.call(params, 'reference_images')) params.reference_images = referenceImages;
    }
    if (maskImage) {
      next.mask_image = maskImage;
      if (Object.prototype.hasOwnProperty.call(next, 'edit_mask')) next.edit_mask = maskImage;
      if (Object.prototype.hasOwnProperty.call(params, 'mask_image')) params.mask_image = maskImage;
    }
    if (Object.keys(params).length) next.params = params;
    if (maskImage && referenceImages.length) next.reference_mode = next.reference_mode || next.referenceMode || 'masked-edit';
    if (!maskImage && referenceImages.length) next.reference_mode = next.reference_mode || next.referenceMode || 'reference-assisted';
    if (maskImage && !referenceImages.length) {
      itemIssues.push({
        promptIndex: next.index ?? index + 1,
        title: `第 ${index + 1} 条缺参考图`,
        message: `遮罩需要搭配参考图：${itemLabel(next, index)}`,
        field: 'reference_images',
        path: null,
      });
    }
    if (itemIssues.length) {
      next.materialIssues = itemIssues;
      issues.push(...itemIssues);
    }
    return next;
  });
  return { prompts: normalized, issues, baseDir };
}

function resolveOutputPathFromFile(value, sourceFile) {
  const text = String(value || '').trim();
  if (!text || !isPathLike(text)) return text || null;
  return path.isAbsolute(text) ? text : path.resolve(path.dirname(path.resolve(sourceFile)), text);
}

module.exports = {
  isPathLike,
  resolveMaterialPath,
  normalizePromptMaterials,
  resolveOutputPathFromFile,
};
