const fs = require('fs');
const path = require('path');
const { parseEnvFile } = require('./script_utils');

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

function splitCliList(value) {
  return ensureArray(value)
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset';
}

function buildSlotMap(contentManifest) {
  const slots = ensureArray(contentManifest.slots);
  const map = new Map();
  slots.forEach((slot, index) => {
    const slotId = ensureString(slot.slot_id || slot.id, `slot_${index + 1}`);
    map.set(slotId, { ...slot, slot_id: slotId });
  });
  return { slots, map };
}

function inferSequentialSlotIds(slots, options) {
  const generateOnly = options.generateOnly === true;
  return slots
    .filter((slot) => {
      if (!generateOnly) return true;
      return slot.generate_image !== false;
    })
    .map((slot) => slot.slot_id);
}

function buildAssetRecords(assetSpec, context) {
  return ensureArray(assetSpec).map((item, index) => {
    if (typeof item === 'string') {
      return {
        path: item,
        type: 'reference',
        label: null,
        notes: null,
        slot_id: null,
        sequence: index,
        context,
      };
    }
    return {
      path: ensureString(item.path || item.file || item.image || item.src),
      type: ensureString(item.type || item.asset_type || item.kind, 'reference'),
      label: ensureString(item.label || item.name),
      notes: ensureString(item.notes),
      slot_id: ensureString(item.slot_id || item.slot),
      asset_id: ensureString(item.asset_id || item.id),
      sequence: Number.isFinite(Number(item.sequence)) ? Number(item.sequence) : index,
      context,
    };
  }).filter((item) => item.path);
}

function summarizeSlot(slot) {
  return [
    slot.slot_id,
    slot.role,
    slot.shot_label,
    slot.scene,
    slot.asset_mode,
    ...(slot.prompt_hints || []),
  ].filter(Boolean).join(' | ');
}

function tokenSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  );
}

function scoreTokenOverlap(a, b) {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (!setA.size || !setB.size) return 0;
  let common = 0;
  for (const token of setA) {
    if (setB.has(token)) common += 1;
  }
  return common / Math.max(setA.size, setB.size);
}

function inferRuleType(asset) {
  const fileName = path.basename(asset.path || '').toLowerCase();
  const label = String(asset.label || '').toLowerCase();
  const notes = String(asset.notes || '').toLowerCase();
  const corpus = `${fileName} ${label} ${notes}`;
  if (/\bmask\b|遮罩|蒙版|alpha|matte|inpaint/i.test(corpus)) return 'mask';
  return 'reference';
}

function inferRuleSlot(asset, orderedSlotIds, slotMap) {
  if (asset.slot_id && slotMap.has(asset.slot_id)) {
    return {
      slotId: asset.slot_id,
      confidence: 1,
      reason: 'explicit-slot-id',
    };
  }

  const fileName = path.basename(asset.path || '').toLowerCase();
  const label = String(asset.label || '').toLowerCase();
  const notes = String(asset.notes || '').toLowerCase();
  const corpus = `${fileName} ${label} ${notes}`;

  for (const slotId of orderedSlotIds) {
    const slot = slotMap.get(slotId);
    const slotSummary = summarizeSlot(slot).toLowerCase();
    const slotSlug = slugify(slotId);
    if (corpus.includes(slotId.toLowerCase()) || corpus.includes(slotSlug) || scoreTokenOverlap(corpus, slotSummary) >= 0.45) {
      return {
        slotId,
        confidence: corpus.includes(slotId.toLowerCase()) || corpus.includes(slotSlug) ? 0.92 : 0.68,
        reason: corpus.includes(slotId.toLowerCase()) || corpus.includes(slotSlug) ? 'filename-slot-match' : 'slot-summary-token-match',
      };
    }
  }

  return null;
}

function inferRuleAssignments({ assets, orderedSlotIds, slotMap }) {
  let sequentialCursor = 0;
  return assets.map((asset) => {
    const inferredType = inferRuleType(asset);
    const slotGuess = inferRuleSlot(asset, orderedSlotIds, slotMap);
    const slotId = slotGuess?.slotId || (orderedSlotIds[sequentialCursor] || null);
    if (!slotGuess && slotId) sequentialCursor += 1;
    const confidence = slotGuess?.confidence || (slotId ? 0.4 : 0.1);
    const reason = slotGuess?.reason || (slotId ? 'sequential-fallback' : 'unassigned');
    return {
      ...asset,
      inferred_type: inferredType,
      inferred_slot_id: slotId,
      inference: {
        strategy: 'rules',
        confidence,
        reason,
      },
    };
  });
}

function resolveEnvFile(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function requestVisionRecommendations({ envFile, baseUrl, apiKey, model, assets, slots, timeoutMs }) {
  const endpoint = `${String(baseUrl).replace(/\/+$/, '')}/responses`;
  const slotIndex = slots.map((slot) => ({
    slot_id: slot.slot_id,
    role: slot.role || null,
    shot_label: slot.shot_label || null,
    scene: slot.scene || null,
    asset_mode: slot.asset_mode || null,
    prompt_hints: slot.prompt_hints || [],
  }));

  const content = [];
  content.push({
    type: 'input_text',
    text: [
      '你是一个 storyboard 素材分配助手。',
      '任务：根据素材文件名、标签、备注和图片内容，判断每个素材更适合绑定到哪个 slot，以及它更像 reference 还是 mask。',
      '要求：只输出 JSON，对每个 asset 返回 asset_path、recommended_slot_id、recommended_type、confidence、reason。',
      `可选 slot 列表：${JSON.stringify(slotIndex)}`,
    ].join('\n'),
  });

  assets.forEach((asset) => {
    const absolutePath = path.resolve(asset.path);
    const mime = absolutePath.toLowerCase().endsWith('.png')
      ? 'image/png'
      : (absolutePath.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    const b64 = fs.readFileSync(absolutePath).toString('base64');
    content.push({
      type: 'input_text',
      text: `asset_path=${absolutePath}\nlabel=${asset.label || ''}\nnotes=${asset.notes || ''}\ncurrent_type=${asset.type || 'reference'}\ncurrent_slot_id=${asset.slot_id || ''}`,
    });
    content.push({
      type: 'input_image',
      image_url: `data:${mime};base64,${b64}`,
    });
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'asset_binding_recommendations',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              recommendations: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    asset_path: { type: 'string' },
                    recommended_slot_id: { type: ['string', 'null'] },
                    recommended_type: { type: 'string' },
                    confidence: { type: 'number' },
                    reason: { type: 'string' },
                  },
                  required: ['asset_path', 'recommended_slot_id', 'recommended_type', 'confidence', 'reason'],
                },
              },
            },
            required: ['recommendations'],
          },
        },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`vision analysis failed: ${payload?.error?.message || response.status}`);
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const contents = Array.isArray(item.content) ? item.content : [];
    for (const contentItem of contents) {
      const candidate = contentItem?.text || contentItem?.output_text || contentItem?.json || null;
      if (!candidate) continue;
      const parsed = typeof candidate === 'string' ? JSON.parse(candidate) : candidate;
      if (Array.isArray(parsed?.recommendations)) return parsed.recommendations;
    }
  }
  throw new Error('vision analysis returned no recommendations');
}

async function applyVisionRecommendations({ assets, slots, envFile, responsesModel, timeoutMs = 90000 }) {
  const resolvedEnvFile = resolveEnvFile([
    envFile,
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ]);
  if (!resolvedEnvFile) {
    return {
      enabled: false,
      reason: 'env-not-found',
      recommendations: [],
    };
  }

  const env = parseEnvFile(resolvedEnvFile);
  if (!env.OPENAI_BASE_URL || !env.OPENAI_API_KEY) {
    return {
      enabled: false,
      reason: 'missing-openai-env',
      recommendations: [],
    };
  }

  const recommendations = await requestVisionRecommendations({
    envFile: resolvedEnvFile,
    baseUrl: env.OPENAI_BASE_URL,
    apiKey: env.OPENAI_API_KEY,
    model: responsesModel || env.OPENAI_RESPONSES_MODEL || 'gpt-5.4',
    assets,
    slots,
    timeoutMs,
  });

  const byPath = new Map(recommendations.map((item) => [path.resolve(item.asset_path), item]));
  return {
    enabled: true,
    reason: 'ok',
    recommendations: assets.map((asset) => {
      const hit = byPath.get(path.resolve(asset.path));
      if (!hit) return null;
      return {
        asset_path: path.resolve(asset.path),
        recommended_slot_id: hit.recommended_slot_id || null,
        recommended_type: hit.recommended_type || 'reference',
        confidence: Number(hit.confidence || 0),
        reason: hit.reason || 'vision-recommendation',
      };
    }).filter(Boolean),
  };
}

function mergeAssetRecommendations({ ruleAssignments, visionRecommendations, slotMap }) {
  const visionByPath = new Map((visionRecommendations?.recommendations || []).map((item) => [path.resolve(item.asset_path), item]));
  return ruleAssignments.map((asset) => {
    const vision = visionByPath.get(path.resolve(asset.path));
    if (!vision) return asset;
    const suggestedSlot = vision.recommended_slot_id && slotMap.has(vision.recommended_slot_id)
      ? vision.recommended_slot_id
      : asset.inferred_slot_id;
    const suggestedType = /mask/i.test(String(vision.recommended_type || '')) ? 'mask' : asset.inferred_type;
    const shouldOverride = Number(vision.confidence || 0) >= 0.72 && !asset.slot_id;
    return {
      ...asset,
      inferred_type: shouldOverride ? suggestedType : asset.inferred_type,
      inferred_slot_id: shouldOverride ? suggestedSlot : asset.inferred_slot_id,
      inference: shouldOverride ? {
        strategy: 'vision',
        confidence: Number(vision.confidence || 0),
        reason: vision.reason || 'vision-recommendation',
      } : asset.inference,
      vision_recommendation: {
        slot_id: vision.recommended_slot_id || null,
        type: suggestedType,
        confidence: Number(vision.confidence || 0),
        reason: vision.reason || 'vision-recommendation',
      },
    };
  });
}

module.exports = {
  ensureArray,
  ensureString,
  ensureStringArray,
  splitCliList,
  slugify,
  buildSlotMap,
  inferSequentialSlotIds,
  buildAssetRecords,
  inferRuleAssignments,
  applyVisionRecommendations,
  mergeAssetRecommendations,
};
