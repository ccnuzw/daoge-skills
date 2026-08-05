const fs = require('fs');
const path = require('path');

function sanitize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function normalizeApiPathOverride(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return text;
}

function resolveProviderPathOverride({ explicitOverride }) {
  const normalizedExplicit = normalizeApiPathOverride(explicitOverride);
  if (normalizedExplicit) return normalizedExplicit;
  return null;
}

function parseNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'image';
}

function normalizeSlug(value) {
  return slugify(value || '');
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function ensureStringArray(value) {
  return ensureArray(value).map((item) => String(item).trim()).filter(Boolean);
}

function detectMimeType(filePath) {
  const ext = String(path.extname(filePath || '')).trim().toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

function fileToDataUrl(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`reference file not found: ${absolutePath}`);
  const mime = detectMimeType(absolutePath);
  const b64 = fs.readFileSync(absolutePath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function resolveReferenceMode(item) {
  return String(item.reference_mode || item.referenceMode || '').trim().toLowerCase();
}

function resolveMaskImage(item) {
  const params = item.params || {};
  return String(params.mask_image || item.mask_image || item.edit_mask || '').trim() || null;
}

function resolveReferenceImages(item) {
  const params = item.params || {};
  return Array.from(new Set([
    ...ensureStringArray(item.reference_images || item.referenceImages),
    ...ensureStringArray(params.reference_images),
  ]));
}

function buildOperationMode(item) {
  const explicitMode = resolveReferenceMode(item);
  const referenceImages = resolveReferenceImages(item);
  const maskImage = resolveMaskImage(item);
  if (maskImage && !referenceImages.length) {
    throw new Error(`Slot ${item.slot_id || item.slug || item.index || 'unknown'} has mask_image but no reference_images`);
  }
  if (maskImage) return { mode: 'masked-edit', referenceImages, maskImage };
  if (referenceImages.length) return { mode: 'reference-assisted', referenceImages, maskImage: null };
  if (explicitMode === 'reference-assisted') {
    throw new Error(`Slot ${item.slot_id || item.slug || item.index || 'unknown'} is reference-assisted but has no reference_images`);
  }
  if (explicitMode === 'masked-edit') {
    throw new Error(`Slot ${item.slot_id || item.slug || item.index || 'unknown'} is masked-edit but has no reference_images/mask_image`);
  }
  return { mode: 'prompt-only', referenceImages: [], maskImage: null };
}

module.exports = {
  sanitize,
  normalizeApiPathOverride,
  resolveProviderPathOverride,
  parseNumber,
  clampNumber,
  parseBoolean,
  slugify,
  normalizeSlug,
  ensureArray,
  ensureStringArray,
  detectMimeType,
  fileToDataUrl,
  resolveReferenceMode,
  resolveMaskImage,
  resolveReferenceImages,
  buildOperationMode,
};
