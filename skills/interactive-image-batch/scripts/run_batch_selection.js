const fs = require('fs');
const path = require('path');
const { normalizeSlug, resolveReferenceImages, resolveMaskImage } = require('./run_batch_shared');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function collectManifestResults(manifest) {
  return (manifest.batches || []).flatMap((batch) => batch.results || []);
}

function normalizeIndex(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return String(Math.floor(numeric));
  return String(value || '').replace(/^0+/, '') || '0';
}

function normalizeSlotId(value) {
  return String(value || '').trim();
}

function parseCsvSet(value) {
  if (value === undefined || value === null || value === '') return null;
  const values = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  return values.length ? new Set(values) : null;
}

function hasExplicitSelectionArgs(args) {
  return Boolean(parseCsvSet(args['select-indexes']) || parseCsvSet(args['select-slot-ids']));
}

function selectResumePrompts(promptPool, resumeManifestPath, failedOnly) {
  if (!resumeManifestPath) return promptPool;
  const manifest = readJson(resumeManifestPath);
  const results = collectManifestResults(manifest);
  const selectedResults = failedOnly ? results.filter((item) => !item.ok) : results;
  const wanted = new Map();
  const wantedSlotIds = new Set();
  selectedResults.forEach((item) => {
    const indexKey = normalizeIndex(item.index);
    const slugKey = normalizeSlug(item.slug);
    const slotIdKey = normalizeSlotId(item.slotId || item.slot_id);
    if (!wanted.has(indexKey)) wanted.set(indexKey, new Set());
    if (slugKey && slugKey !== 'image') wanted.get(indexKey).add(slugKey);
    if (slotIdKey) wantedSlotIds.add(slotIdKey);
  });
  const selected = promptPool.filter((item, index) => {
    const slotIdKey = normalizeSlotId(item.slot_id || item.slotId);
    if (slotIdKey) return wantedSlotIds.has(slotIdKey);
    const indexKey = normalizeIndex(item.index ?? index + 1);
    if (!wanted.has(indexKey)) return false;
    const allowedSlugs = wanted.get(indexKey);
    if (!allowedSlugs || !allowedSlugs.size) return true;
    return allowedSlugs.has(normalizeSlug(item.slug));
  });
  if (!selected.length) {
    throw new Error(`No prompts matched ${failedOnly ? 'failed' : 'resume'} results from ${resumeManifestPath}; prompt indexes or slugs may have changed`);
  }
  return selected;
}

function selectExplicitPrompts(promptPool, args) {
  const selectedIndexes = parseCsvSet(args['select-indexes']);
  const selectedSlotIds = parseCsvSet(args['select-slot-ids']);
  if (!selectedIndexes && !selectedSlotIds) return promptPool;

  const selected = promptPool.filter((item, index) => {
    const indexMatch = selectedIndexes ? selectedIndexes.has(normalizeIndex(item.index ?? index + 1)) : false;
    const slotMatch = selectedSlotIds ? selectedSlotIds.has(String(item.slot_id || '').trim()) : false;
    return indexMatch || slotMatch;
  });

  if (!selected.length) {
    throw new Error('No prompts matched --select-indexes/--select-slot-ids');
  }
  return selected;
}

function buildManifestResultLookup(resumeManifestPath) {
  if (!resumeManifestPath) return null;
  const manifest = readJson(resumeManifestPath);
  const results = collectManifestResults(manifest);
  const byIndex = new Map();
  const byIndexSlug = new Map();
  const bySlotId = new Map();
  results.forEach((item) => {
    if (!item.ok || !item.output) return;
    const indexKey = normalizeIndex(item.index);
    const slugKey = normalizeSlug(item.slug);
    const slotIdKey = normalizeSlotId(item.slotId || item.slot_id);
    if (!byIndex.has(indexKey)) byIndex.set(indexKey, item);
    if (slugKey) byIndexSlug.set(`${indexKey}|${slugKey}`, item);
    if (slotIdKey && !bySlotId.has(slotIdKey)) bySlotId.set(slotIdKey, item);
  });
  return { byIndex, byIndexSlug, bySlotId };
}

function applyPreviousOutputReuse(promptPool, resumeManifestPath, reuseOutputAsReference) {
  if (!reuseOutputAsReference) return promptPool;
  if (!resumeManifestPath) {
    throw new Error('--reuse-output-as-reference requires --resume-manifest');
  }
  const lookup = buildManifestResultLookup(resumeManifestPath);
  return promptPool.map((item, index) => {
    const indexKey = normalizeIndex(item.index ?? index + 1);
    const slugKey = normalizeSlug(item.slug);
    const slotIdKey = normalizeSlotId(item.slot_id || item.slotId);
    const hasStoryboardIdentity = Boolean(slotIdKey);
    const match = hasStoryboardIdentity
      ? lookup.bySlotId.get(slotIdKey)
      : (lookup.byIndexSlug.get(`${indexKey}|${slugKey}`) || (slugKey ? null : lookup.byIndex.get(indexKey)));
    if (!match?.output) {
      const identity = hasStoryboardIdentity
        ? `slot ${slotIdKey}`
        : `prompt ${indexKey}${slugKey ? ` (${slugKey})` : ''}`;
      throw new Error(`No successful previous output found for ${identity}`);
    }
    const referenceImages = Array.from(new Set([match.output, ...resolveReferenceImages(item)]));
    const next = {
      ...item,
      reference_images: referenceImages,
      edit_source: 'previous-output',
      edit_source_output: match.output,
    };
    const existingMode = String(item.reference_mode || item.referenceMode || '').trim().toLowerCase();
    if (!existingMode || existingMode === 'prompt-only') {
      next.reference_mode = resolveMaskImage(item) ? 'masked-edit' : 'reference-assisted';
    }
    return next;
  });
}

function writeRerunPlan(outputDir, resumeManifestPath, prompts) {
  if (!resumeManifestPath) return null;
  const planPath = path.join(outputDir, 'rerun_plan.json');
  const plan = {
    sourceManifest: path.resolve(resumeManifestPath),
    promptCount: prompts.length,
    indexes: prompts.map((item, index) => item.index ?? index + 1),
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
  return planPath;
}

module.exports = {
  readJson,
  collectManifestResults,
  normalizeIndex,
  normalizeSlotId,
  parseCsvSet,
  hasExplicitSelectionArgs,
  selectResumePrompts,
  selectExplicitPrompts,
  buildManifestResultLookup,
  applyPreviousOutputReuse,
  writeRerunPlan,
};
