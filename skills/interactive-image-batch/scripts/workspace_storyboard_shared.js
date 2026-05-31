const path = require('path');
const { fileExists } = require('./script_utils');

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.bindings)) return value.bindings;
  return [];
}

function resolveWorkspaceRouteFile(outputDir, workspaceState, key, fallbackFile) {
  const routeFile = workspaceState?.routes?.[key];
  if (routeFile && fileExists(routeFile)) return routeFile;
  if (fallbackFile && fileExists(fallbackFile)) return fallbackFile;
  return fallbackFile || null;
}

function collectManifestResults(manifest) {
  const batches = toArray(manifest?.batches);
  return batches.flatMap((batch) => toArray(batch?.results));
}

function itemLooksLikeStoryboard(item) {
  if (!item || typeof item !== 'object') return false;
  const slotId = item.slotId || item.slot_id;
  const boardId = item.boardId || item.board_id;
  const shotLabel = item.shotLabel || item.shot_label;
  const shotId = item.shotId || item.shot_id;
  const timecode = item.timecode;
  const layoutRegionId = item.layoutRegionId || item.layout_region_id;
  const keywordText = [
    item.title,
    item.slug,
    item.prompt,
    item.revisedPrompt,
    item.generation_prompt,
    item.scene,
    item.composition,
    item.notes,
    item.styleFamily,
  ].filter(Boolean).join(' ');
  const hasStoryboardKeyword = /storyboard/i.test(keywordText);
  const hasShotMetadata = Boolean(boardId || shotLabel || shotId || timecode || layoutRegionId);
  return hasStoryboardKeyword || Boolean(slotId && hasShotMetadata);
}

function inferStoryboardSpecialization(options = {}) {
  const outputDir = path.resolve(options.outputDir || process.cwd());
  const taskSpec = options.taskSpec || {};
  const modeDetection = options.modeDetection || {};
  const manifest = options.manifest || {};
  const successItems = toArray(options.successItems);
  const failedItems = toArray(options.failedItems);
  const reviewItems = toArray(options.reviewItems);
  const manifestResults = collectManifestResults(manifest);
  const allItems = successItems.concat(failedItems, reviewItems, manifestResults);
  const taskSpecSlots = toArray(taskSpec?.storyboard_plan?.content_slots || taskSpec?.storyboard_plan?.slots);
  const enabled = [
    Boolean(taskSpec?.storyboard_plan?.enabled),
    /storyboard/i.test(String(modeDetection?.detected_mode || '')),
    /storyboard/i.test(String(modeDetection?.detected_template?.id || '')),
    fileExists(path.join(outputDir, 'storyboard_bundle.validation.json')),
    fileExists(path.join(outputDir, 'layout_manifest.storyboard.json')),
    fileExists(path.join(outputDir, 'content_manifest.storyboard.json')),
    fileExists(path.join(outputDir, 'render_config.storyboard.json')),
    allItems.some((item) => itemLooksLikeStoryboard(item)),
  ].some(Boolean);

  return {
    enabled,
    slotCount: taskSpecSlots.length || allItems.filter((item) => itemLooksLikeStoryboard(item)).length || null,
  };
}

function shouldShowStoryboardPage(options = {}) {
  const storyboardPath = options.storyboardPath ? path.resolve(options.storyboardPath) : null;
  if (!storyboardPath || !fileExists(storyboardPath)) return false;
  const workspaceEnabled = Boolean(options.workspaceState?.specialization?.storyboard?.enabled);
  return workspaceEnabled || inferStoryboardSpecialization(options).enabled;
}

module.exports = {
  inferStoryboardSpecialization,
  resolveWorkspaceRouteFile,
  shouldShowStoryboardPage,
};
