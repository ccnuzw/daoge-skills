const path = require('path');
const { parseArgs, readJson, writeJson } = require('./script_utils');
const { buildAssetRecords, splitCliList } = require('./reference_asset_analysis');

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['draft-file']) throw new Error('Missing required flag: --draft-file');

  const draftFile = path.resolve(args['draft-file']);
  const draftPayload = readJson(draftFile);
  const draft = draftPayload.draft || {};
  const assetIntents = ensureArray(draft.asset_intents);
  const slotOrder = ensureArray(draft.slot_order).map(String).map((item) => item.trim()).filter(Boolean);
  const assetPaths = splitCliList(args.references || '');
  const assets = buildAssetRecords(assetPaths, 'planned');

  const referenceAssets = [];
  const maskAssets = [];
  const planAssignments = [];

  assetIntents.forEach((intent) => {
    const index = Number(intent.asset_index);
    if (!Number.isInteger(index) || index < 0 || index >= assets.length) return;
    const asset = assets[index];
    const normalized = {
      path: asset.path,
      slot_id: intent.target_slot_id || null,
      label: asset.label || null,
      notes: intent.reason || null,
      confidence: Number(intent.confidence || 0),
    };
    if (/mask/i.test(String(intent.intended_type || ''))) {
      maskAssets.push(normalized);
    } else {
      referenceAssets.push(normalized);
    }
    planAssignments.push({
      asset_index: index,
      path: asset.path,
      slot_id: intent.target_slot_id || null,
      intended_type: intent.intended_type || 'reference',
      confidence: Number(intent.confidence || 0),
      reason: intent.reason || null,
    });
  });

  const output = {
    binding_text: draftPayload.binding_text || null,
    slot_order: slotOrder,
    reference_assets: referenceAssets,
    mask_assets: maskAssets,
    prompt_only_slots: ensureArray(draft.prompt_only_slots).map(String).map((item) => item.trim()).filter(Boolean),
    unresolved_questions: ensureArray(draft.unresolved_questions).map(String).map((item) => item.trim()).filter(Boolean),
    plan_assignments: planAssignments,
    summary: draft.summary || null,
  };

  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(draftFile), 'binding_plan.json'));
  writeJson(outputPath, output);
  console.log(JSON.stringify({
    outputPath,
    referenceAssetCount: referenceAssets.length,
    maskAssetCount: maskAssets.length,
    unresolvedQuestionCount: output.unresolved_questions.length,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
