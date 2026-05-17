const fs = require('fs');
const path = require('path');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function ensureString(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function ensureStringArray(value) {
  return ensureArray(value).map((item) => String(item).trim()).filter(Boolean);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function resolvePath(value, baseDir) {
  const text = ensureString(value);
  if (!text) return null;
  return path.isAbsolute(text) ? text : path.resolve(baseDir, text);
}

function resolvePathArray(value, baseDir) {
  return ensureStringArray(value).map((item) => resolvePath(item, baseDir));
}

function uniqueById(items, key, errors, label) {
  const seen = new Set();
  items.forEach((item) => {
    const id = ensureString(item[key]);
    if (!id) {
      errors.push(`${label} 缺少 ${key}`);
      return;
    }
    if (seen.has(id)) errors.push(`${label} ${id} 重复`);
    seen.add(id);
  });
}

function normalizeLayoutManifest(raw, layoutPath, errors) {
  const baseDir = path.dirname(layoutPath);
  const regions = ensureArray(raw.regions).map((region, index) => ({
    id: ensureString(region.id, `region_${index + 1}`),
    role: ensureString(region.role, 'shot'),
    sequence: Number.isFinite(Number(region.sequence)) ? Number(region.sequence) : null,
    x: Number.isFinite(Number(region.x)) ? Number(region.x) : null,
    y: Number.isFinite(Number(region.y)) ? Number(region.y) : null,
    width: Number.isFinite(Number(region.width)) ? Number(region.width) : Number(region.w),
    height: Number.isFinite(Number(region.height)) ? Number(region.height) : Number(region.h),
    aspect_ratio: ensureString(region.aspect_ratio),
    notes: ensureString(region.notes),
    reference_images: resolvePathArray(region.reference_images, baseDir),
  }));
  uniqueById(regions, 'id', errors, 'layout region');

  const bindingEntries = [];
  if (Array.isArray(raw.bindings)) {
    raw.bindings.forEach((item) => {
      bindingEntries.push({
        region_id: ensureString(item.region_id || item.region || item.id),
        slot_id: ensureString(item.slot_id || item.slot || item.bind),
      });
    });
  } else if (raw.bindings && typeof raw.bindings === 'object') {
    Object.entries(raw.bindings).forEach(([regionId, slotId]) => {
      bindingEntries.push({
        region_id: ensureString(regionId),
        slot_id: ensureString(slotId),
      });
    });
  }

  return {
    path: layoutPath,
    layout_id: ensureString(raw.layout_id || raw.id || path.basename(layoutPath, path.extname(layoutPath))),
    board_role: ensureString(raw.board_role, 'storyboard-board'),
    canvas: {
      width: Number.isFinite(Number(raw.canvas?.width)) ? Number(raw.canvas.width) : null,
      height: Number.isFinite(Number(raw.canvas?.height)) ? Number(raw.canvas.height) : null,
      aspect_ratio: ensureString(raw.canvas?.aspect_ratio),
      background: ensureString(raw.canvas?.background),
    },
    regions,
    bindings: bindingEntries,
  };
}

function normalizeContentManifest(raw, contentPath, errors) {
  const baseDir = path.dirname(contentPath);
  const slots = ensureArray(raw.slots).map((slot, index) => ({
    slot_id: ensureString(slot.slot_id || slot.id, `slot_${index + 1}`),
    role: ensureString(slot.role, 'shot'),
    shot_id: ensureString(slot.shot_id || slot.slot_id || slot.id),
    shot_label: ensureString(slot.shot_label || slot.title || slot.name),
    sequence: Number.isFinite(Number(slot.sequence)) ? Number(slot.sequence) : null,
    asset_mode: ensureString(slot.asset_mode || slot.subject_type),
    reference_mode: ensureString(slot.reference_mode),
    generate_image: parseBoolean(slot.generate_image, ['shot', 'kv', 'packshot', 'endcard', 'hero'].includes(String(slot.role || '').trim())),
    scene: ensureString(slot.scene),
    composition_hint: ensureString(slot.composition_hint || slot.composition),
    lighting_hint: ensureString(slot.lighting_hint || slot.lighting),
    prompt_hints: ensureStringArray(slot.prompt_hints),
    visual_elements: ensureStringArray(slot.visual_elements),
    continuity_notes: ensureStringArray(slot.continuity_notes),
    reference_notes: ensureStringArray(slot.reference_notes),
    reference_images: resolvePathArray(slot.reference_images, baseDir),
    mask_image: resolvePath(slot.mask_image || slot.edit_mask || slot.mask, baseDir),
    source_refs: ensureStringArray(slot.source_refs),
    timecode: ensureString(slot.timecode),
    voiceover: ensureString(slot.voiceover),
    music: ensureString(slot.music),
    sound_effects: ensureString(slot.sound_effects || slot.sfx),
    camera_move: ensureString(slot.camera_move || slot.camera_language),
    text_policy: ensureString(slot.text_policy),
    notes: ensureString(slot.notes),
  }));
  uniqueById(slots, 'slot_id', errors, 'content slot');

  return {
    path: contentPath,
    board_id: ensureString(raw.board_id || raw.id || path.basename(contentPath, path.extname(contentPath))),
    board_title: ensureString(raw.board_title || raw.title),
    board_theme: ensureString(raw.board_theme || raw.theme),
    brand_panel: raw.brand_panel || null,
    slots,
  };
}

function normalizeRenderConfig(raw, renderPath) {
  const baseDir = path.dirname(renderPath);
  return {
    path: renderPath,
    render_mode: ensureString(raw.render_mode, 'storyboard_board'),
    generation_mode: ensureString(raw.generation_mode, 'per-slot'),
    assembly_mode: ensureString(raw.assembly_mode, 'external-compositor'),
    reference_mode: ensureString(raw.reference_mode, 'metadata-only'),
    output_name: ensureString(raw.output_name || raw.run_label),
    layout_manifest: resolvePath(raw.layout_manifest, baseDir),
    content_manifest: resolvePath(raw.content_manifest, baseDir),
    policies: raw.policies && typeof raw.policies === 'object' ? raw.policies : {},
  };
}

function normalizeReferenceBindings(raw, referencePath) {
  if (!raw || typeof raw !== 'object') return null;
  const baseDir = path.dirname(referencePath);
  const assets = ensureArray(raw.reference_assets || raw.assets).map((asset, index) => ({
    asset_id: ensureString(asset.asset_id || asset.id || asset.key, `ref_${String(index + 1).padStart(2, '0')}`),
    path: resolvePath(asset.path || asset.file || asset.image || asset.src, baseDir),
    asset_type: ensureString(asset.asset_type || asset.type || asset.kind, 'reference'),
    label: ensureString(asset.label || asset.name),
    notes: ensureString(asset.notes),
  }));
  const slotAssignments = ensureArray(raw.slot_assignments || raw.bindings || raw.assignments).map((item) => ({
    slot_id: ensureString(item.slot_id || item.slot || item.id),
    asset_ids: ensureStringArray(item.asset_ids || item.assets || item.reference_assets || item.images),
    mask_asset_ids: ensureStringArray(item.mask_asset_ids || item.mask_assets || item.masks || item.mask_images),
    reference_mode: ensureString(item.reference_mode || item.mode),
    priority: ensureString(item.priority),
    notes: ensureString(item.notes),
  }));
  return {
    path: referencePath,
    board_id: ensureString(raw.board_id || raw.id),
    reference_mode: ensureString(raw.reference_mode || 'hybrid'),
    assets,
    slot_assignments: slotAssignments,
    defaults: raw.defaults && typeof raw.defaults === 'object' ? raw.defaults : {},
  };
}

function buildBindingMap(layout) {
  const map = new Map();
  ensureArray(layout.bindings).forEach((binding) => {
    const regionId = ensureString(binding.region_id);
    const slotId = ensureString(binding.slot_id);
    if (regionId && slotId) map.set(regionId, slotId);
  });
  return map;
}

function buildStoryboardBlueprint({ layout, content, render, referenceBindings, errors, warnings }) {
  const regionById = new Map(layout.regions.map((region) => [region.id, region]));
  const slotById = new Map(content.slots.map((slot) => [slot.slot_id, slot]));
  const bindingMap = buildBindingMap(layout);
  const assetById = new Map();
  const assignmentsBySlotId = new Map();

  ensureArray(referenceBindings?.assets).forEach((asset) => {
    if (asset.asset_id) assetById.set(asset.asset_id, asset);
  });
  ensureArray(referenceBindings?.slot_assignments).forEach((assignment) => {
    if (!assignment.slot_id) return;
    if (!assignmentsBySlotId.has(assignment.slot_id)) assignmentsBySlotId.set(assignment.slot_id, []);
    assignmentsBySlotId.get(assignment.slot_id).push(assignment);
  });

  ensureArray(layout.bindings).forEach((binding) => {
    if (!regionById.has(binding.region_id)) errors.push(`layout binding 指向了不存在的 region: ${binding.region_id}`);
    if (!slotById.has(binding.slot_id)) errors.push(`layout binding 指向了不存在的 slot: ${binding.slot_id}`);
  });

  const blueprint = [];
  layout.regions.forEach((region) => {
    const slotId = bindingMap.get(region.id) || region.id;
    const slot = slotById.get(slotId);
    if (!slot) {
      warnings.push(`region ${region.id} 未绑定 content slot，已跳过`);
      return;
    }

    const referenceImages = Array.from(new Set([
      ...ensureArray(region.reference_images),
      ...ensureArray(slot.reference_images),
    ]));
    const slotAssignments = ensureArray(assignmentsBySlotId.get(slot.slot_id));
    const resolvedAssignmentAssets = slotAssignments.flatMap((assignment) => ensureArray(assignment.asset_ids).map((assetId) => assetById.get(assetId)?.path || assetId).filter(Boolean));
    const resolvedAssignmentMasks = slotAssignments.flatMap((assignment) => ensureArray(assignment.mask_asset_ids).map((assetId) => assetById.get(assetId)?.path || assetId).filter(Boolean));
    const combinedReferenceImages = Array.from(new Set([
      ...referenceImages,
      ...resolvedAssignmentAssets,
    ]));
    const resolvedMaskImage = slot.mask_image || resolvedAssignmentMasks[0] || null;
    const referenceMode = slot.reference_mode || slotAssignments[0]?.reference_mode || (resolvedMaskImage ? 'masked-edit' : (combinedReferenceImages.length ? 'reference-assisted' : 'prompt-only'));

    const item = {
      board_id: content.board_id,
      board_title: content.board_title,
      board_theme: content.board_theme,
      slot_id: slot.slot_id,
      shot_id: slot.shot_id || slot.slot_id,
      slot_role: slot.role || region.role,
      reference_mode: referenceMode,
      shot_label: slot.shot_label || slot.slot_id,
      sequence: slot.sequence ?? region.sequence ?? null,
      asset_mode: slot.asset_mode || null,
      generate_image: slot.generate_image !== false,
      layout_region_id: region.id,
      layout_role: region.role || null,
      layout_region: {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        aspect_ratio: region.aspect_ratio,
      },
      scene: slot.scene || null,
      composition_hint: slot.composition_hint || region.aspect_ratio || null,
      lighting_hint: slot.lighting_hint || null,
      prompt_hints: slot.prompt_hints || [],
      visual_elements: slot.visual_elements || [],
      continuity_notes: slot.continuity_notes || [],
      reference_notes: slot.reference_notes || [],
      reference_images: combinedReferenceImages,
      reference_asset_ids: slotAssignments.flatMap((assignment) => ensureArray(assignment.asset_ids)).filter(Boolean),
      mask_image: resolvedMaskImage,
      mask_asset_ids: slotAssignments.flatMap((assignment) => ensureArray(assignment.mask_asset_ids)).filter(Boolean),
      source_refs: slot.source_refs || [],
      timecode: slot.timecode || null,
      voiceover: slot.voiceover || null,
      music: slot.music || null,
      sound_effects: slot.sound_effects || null,
      camera_move: slot.camera_move || null,
      text_policy: slot.text_policy || null,
      notes: slot.notes || region.notes || null,
    };
    blueprint.push(item);
  });

  content.slots.forEach((slot) => {
    if (!blueprint.some((item) => item.slot_id === slot.slot_id)) {
      warnings.push(`content slot ${slot.slot_id} 未绑定到任何 region`);
    }
  });

  blueprint.forEach((item) => {
    ensureArray(item.reference_images).forEach((imagePath) => {
      if (!fs.existsSync(imagePath)) warnings.push(`slot ${item.slot_id} 的参考图不存在: ${imagePath}`);
    });
    if (item.mask_image && !fs.existsSync(item.mask_image)) warnings.push(`slot ${item.slot_id} 的遮罩图不存在: ${item.mask_image}`);
    if (item.reference_mode === 'masked-edit' && !item.mask_image) errors.push(`slot ${item.slot_id} 被标记为 masked-edit，但没有 mask_image`);
  });

  if (!blueprint.some((item) => item.slot_role === 'shot')) warnings.push('storyboard blueprint 中没有 role=shot 的分镜格');
  if (!blueprint.some((item) => item.slot_role === 'kv')) warnings.push('storyboard blueprint 中没有 role=kv 的收尾画面');
  if (!blueprint.some((item) => item.slot_role === 'brand_panel')) warnings.push('storyboard blueprint 中没有 role=brand_panel 的信息区');
  if (render.reference_mode === 'hard-reference') {
    warnings.push('当前 runner 仅保留 reference_images 元数据，尚未把硬参考图真正发送给 provider');
  }

  if (referenceBindings && ensureArray(referenceBindings.assets).length) {
    ensureArray(referenceBindings.assets).forEach((asset) => {
      if (!asset.path || !fs.existsSync(asset.path)) warnings.push(`reference asset 不存在: ${asset.asset_id}`);
    });
    ensureArray(referenceBindings.slot_assignments).forEach((assignment) => {
      ensureArray(assignment.asset_ids).forEach((assetId) => {
        if (!assetById.has(assetId)) warnings.push(`slot ${assignment.slot_id} 引用了不存在的 reference asset: ${assetId}`);
      });
      ensureArray(assignment.mask_asset_ids).forEach((assetId) => {
        if (!assetById.has(assetId)) warnings.push(`slot ${assignment.slot_id} 引用了不存在的 mask asset: ${assetId}`);
      });
    });
  }

  return blueprint.sort((a, b) => {
    const seqA = Number.isFinite(Number(a.sequence)) ? Number(a.sequence) : Number.MAX_SAFE_INTEGER;
    const seqB = Number.isFinite(Number(b.sequence)) ? Number(b.sequence) : Number.MAX_SAFE_INTEGER;
    return seqA - seqB || String(a.slot_id).localeCompare(String(b.slot_id));
  });
}

function summarizeStoryboard(layout, content, render, blueprint) {
  const generationSlots = blueprint.filter((item) => item.generate_image !== false);
  const roleCounts = {};
  const referenceModeCounts = {};
  let maskSlotCount = 0;
  let localEditSlotCount = 0;
  generationSlots.forEach((item) => {
    const role = item.slot_role || 'unknown';
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    const mode = item.reference_mode || 'prompt-only';
    referenceModeCounts[mode] = (referenceModeCounts[mode] || 0) + 1;
    if (item.mask_image) maskSlotCount += 1;
    if (item.mask_image || mode === 'masked-edit') localEditSlotCount += 1;
  });
  return {
    layout_id: layout.layout_id,
    board_id: content.board_id,
    render_mode: render.render_mode,
    generation_mode: render.generation_mode,
    reference_mode: render.reference_mode,
    canvas: layout.canvas,
    total_regions: layout.regions.length,
    total_slots: content.slots.length,
    generation_slot_count: generationSlots.length,
    role_counts: roleCounts,
    reference_mode_counts: referenceModeCounts,
    mask_slot_count: maskSlotCount,
    local_edit_slot_count: localEditSlotCount,
  };
}

module.exports = {
  ensureArray,
  ensureString,
  ensureStringArray,
  parseBoolean,
  readJson,
  resolvePath,
  resolvePathArray,
  normalizeLayoutManifest,
  normalizeContentManifest,
  normalizeRenderConfig,
  normalizeReferenceBindings,
  buildStoryboardBlueprint,
  summarizeStoryboard,
};
