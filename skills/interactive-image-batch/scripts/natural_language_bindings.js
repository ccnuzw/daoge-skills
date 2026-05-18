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

function parseOrdinal(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  if (/最后一张|最后1张|最后1个/.test(normalized)) return { kind: 'last', offset: 0 };
  if (/倒数第二张|倒数2张/.test(normalized)) return { kind: 'last', offset: 1 };
  const match = normalized.match(/第\s*(\d+)\s*张/);
  if (match) return { kind: 'index', index: Number(match[1]) - 1 };
  const zhMap = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 七: 6, 八: 7, 九: 8, 十: 9 };
  const zhMatch = normalized.match(/第([一二三四五六七八九十])张/);
  if (zhMatch && zhMap[zhMatch[1]] !== undefined) return { kind: 'index', index: zhMap[zhMatch[1]] };
  if (/前两张|前2张/.test(normalized)) return { kind: 'range', start: 0, count: 2 };
  if (/前三张|前3张/.test(normalized)) return { kind: 'range', start: 0, count: 3 };
  return null;
}

function resolveOrdinalSelection(selector, assetPaths) {
  if (!selector) return [];
  if (selector.kind === 'last') {
    const index = assetPaths.length - 1 - selector.offset;
    return index >= 0 ? [index] : [];
  }
  if (selector.kind === 'index') {
    return selector.index >= 0 && selector.index < assetPaths.length ? [selector.index] : [];
  }
  if (selector.kind === 'range') {
    return Array.from({ length: selector.count }, (_, offset) => selector.start + offset).filter((index) => index >= 0 && index < assetPaths.length);
  }
  return [];
}

function parseSlotIds(text, slotIds) {
  const hits = [];
  const normalized = String(text || '').toLowerCase();
  slotIds.forEach((slotId) => {
    if (normalized.includes(String(slotId).toLowerCase())) hits.push(slotId);
  });
  return hits;
}

function parseNaturalLanguageBindings({ instruction, assetPaths, slotIds }) {
  const text = String(instruction || '').trim();
  if (!text) {
    return {
      slotOrder: [],
      maskIndexes: [],
      explicitAssignments: [],
      unassignedIndexes: assetPaths.map((_, index) => index),
      notes: ['empty-instruction'],
    };
  }

  const sentences = text
    .split(/[。；;，,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const slotOrder = [];
  const maskIndexes = new Set();
  const explicitAssignments = [];
  const assignedIndexes = new Set();
  const notes = [];

  sentences.forEach((sentence) => {
    const selector = parseOrdinal(sentence);
    const mentionedSlots = parseSlotIds(sentence, slotIds);
    const isMask = /mask|遮罩|蒙版/.test(sentence);
    if (selector && mentionedSlots.length) {
      const indexes = resolveOrdinalSelection(selector, assetPaths);
      indexes.forEach((index) => {
        assignedIndexes.add(index);
        if (isMask) maskIndexes.add(index);
        explicitAssignments.push({
          asset_index: index,
          slot_id: mentionedSlots[0],
          type: isMask ? 'mask' : 'reference',
          reason: sentence,
        });
      });
    }

    if (/按上传顺序|按顺序|顺序对应/.test(sentence)) {
      const mentionedSlotsForOrder = parseSlotIds(sentence, slotIds);
      if (mentionedSlotsForOrder.length) {
        mentionedSlotsForOrder.forEach((slotId) => {
          if (!slotOrder.includes(slotId)) slotOrder.push(slotId);
        });
        notes.push('sequential-slot-order-from-language');
        return;
      }
      slotIds.forEach((slotId) => {
        if (!slotOrder.includes(slotId)) slotOrder.push(slotId);
      });
      notes.push('global-sequential-order');
    }
  });

  const unassignedIndexes = assetPaths
    .map((_, index) => index)
    .filter((index) => !assignedIndexes.has(index));

  return {
    slotOrder,
    maskIndexes: Array.from(maskIndexes).sort((a, b) => a - b),
    explicitAssignments,
    unassignedIndexes,
    notes,
  };
}

function applyNaturalLanguageBindings({ assetPaths, parsedBindings }) {
  const explicitByIndex = new Map(parsedBindings.explicitAssignments.map((item) => [item.asset_index, item]));
  return assetPaths.map((assetPath, index) => {
    const explicit = explicitByIndex.get(index);
    if (!explicit) {
      return {
        path: assetPath,
        slot_id: null,
        type: parsedBindings.maskIndexes.includes(index) ? 'mask' : 'reference',
        notes: null,
      };
    }
    return {
      path: assetPath,
      slot_id: explicit.slot_id,
      type: explicit.type,
      notes: explicit.reason,
    };
  });
}

module.exports = {
  ensureString,
  ensureStringArray,
  parseNaturalLanguageBindings,
  applyNaturalLanguageBindings,
};
