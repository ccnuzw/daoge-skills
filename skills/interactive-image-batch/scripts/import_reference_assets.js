const path = require('path');
const {
  parseArgs,
  readJson,
  writeJson,
  ensureDir,
  copyFileIntoDir,
} = require('./script_utils');
const {
  ensureString,
  splitCliList,
  slugify,
  buildSlotMap,
  inferSequentialSlotIds,
  buildAssetRecords,
  inferRuleAssignments,
  applyVisionRecommendations,
  mergeAssetRecommendations,
} = require('./reference_asset_analysis');
const {
  parseNaturalLanguageBindings,
  applyNaturalLanguageBindings,
} = require('./natural_language_bindings');

function getStoryboardPlan(taskSpec) {
  const plan = taskSpec.storyboard_plan || {};
  if (plan.enabled !== true) {
    throw new Error('task_spec.storyboard_plan.enabled must be true to import storyboard reference assets');
  }
  return plan;
}

function addAssignment(assignments, slotId, patch) {
  if (!slotId) return;
  if (!assignments.has(slotId)) {
    assignments.set(slotId, {
      slot_id: slotId,
      asset_ids: [],
      mask_asset_ids: [],
      reference_mode: null,
      priority: null,
      notes: null,
    });
  }
  const current = assignments.get(slotId);
  if (patch.asset_id && !current.asset_ids.includes(patch.asset_id)) current.asset_ids.push(patch.asset_id);
  if (patch.mask_asset_id && !current.mask_asset_ids.includes(patch.mask_asset_id)) current.mask_asset_ids.push(patch.mask_asset_id);
  if (patch.reference_mode) current.reference_mode = patch.reference_mode;
  if (patch.priority && !current.priority) current.priority = patch.priority;
  if (patch.notes) current.notes = current.notes ? `${current.notes}; ${patch.notes}` : patch.notes;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['task-spec']) throw new Error('Missing required flag: --task-spec');

  const taskSpecPath = path.resolve(args['task-spec']);
  const taskSpecDir = path.dirname(taskSpecPath);
  const taskSpec = readJson(taskSpecPath);
  const plan = getStoryboardPlan(taskSpec);
  if (!plan.content_manifest) throw new Error('task_spec.storyboard_plan.content_manifest is required');

  const contentManifestPath = path.isAbsolute(plan.content_manifest)
    ? plan.content_manifest
    : path.resolve(taskSpecDir, plan.content_manifest);
  const contentManifest = readJson(contentManifestPath);
  const { slots, map: slotMap } = buildSlotMap(contentManifest);

  const outputDir = path.resolve(args['output-dir'] || path.dirname(taskSpecPath));
  const assetsDir = path.resolve(args['assets-dir'] || path.join(outputDir, 'assets'));
  const refsDir = path.join(assetsDir, 'reference');
  const masksDir = path.join(assetsDir, 'masks');
  ensureDir(outputDir);
  ensureDir(assetsDir);
  ensureDir(refsDir);
  ensureDir(masksDir);

  const draftPayload = args['binding-draft-file'] ? readJson(path.resolve(args['binding-draft-file'])) : null;
  const plannedBindings = args['binding-plan-file'] ? readJson(path.resolve(args['binding-plan-file'])) : null;
  const inlineReferenceAssets = buildAssetRecords(args.references ? splitCliList(args.references) : [], 'cli');
  const inlineMaskAssets = buildAssetRecords(args.masks ? splitCliList(args.masks).map((maskPath) => ({ path: maskPath, type: 'mask' })) : [], 'cli-mask');
  const manifestAssetSpecs = plannedBindings || (args['assets-manifest'] ? readJson(path.resolve(args['assets-manifest'])) : {});
  const referenceAssets = buildAssetRecords(manifestAssetSpecs.reference_assets || manifestAssetSpecs.assets || [], 'manifest');
  const maskAssets = buildAssetRecords(manifestAssetSpecs.mask_assets || [], 'manifest-mask');

  const orderedSlotIds = args['slot-order']
    ? splitCliList(args['slot-order'])
    : inferSequentialSlotIds(slots, { generateOnly: String(args['generate-only'] || 'true').trim().toLowerCase() !== 'false' });

  const naturalLanguageBindings = draftPayload
    ? {
      slotOrder: draftPayload.draft?.slot_order || [],
      maskIndexes: [],
      explicitAssignments: (draftPayload.draft?.asset_intents || []).map((intent) => ({
        asset_index: Number(intent.asset_index),
        slot_id: intent.target_slot_id || null,
        type: /mask/i.test(String(intent.intended_type || '')) ? 'mask' : 'reference',
        reason: intent.reason || 'binding-intent-draft',
      })),
      unassignedIndexes: [],
      notes: ['binding-intent-draft'],
    }
    : (args['binding-text']
    ? parseNaturalLanguageBindings({
      instruction: args['binding-text'],
      assetPaths: [...splitCliList(args.references), ...splitCliList(args.masks)],
      slotIds: orderedSlotIds.length ? orderedSlotIds : Array.from(slotMap.keys()),
    })
    : null);

  const naturalLanguageAssets = naturalLanguageBindings
    ? buildAssetRecords(applyNaturalLanguageBindings({
      assetPaths: [...splitCliList(args.references), ...splitCliList(args.masks)],
      parsedBindings: naturalLanguageBindings,
    }), 'natural-language')
    : [];

  const preTypedAssets = naturalLanguageBindings
    ? [
      ...referenceAssets,
      ...maskAssets,
      ...naturalLanguageAssets,
    ]
    : [
      ...referenceAssets,
      ...inlineReferenceAssets,
      ...maskAssets,
      ...inlineMaskAssets,
    ];

  const ruleAssignments = inferRuleAssignments({
    assets: preTypedAssets,
    orderedSlotIds,
    slotMap,
  });

  const enableVisionAnalysis = String(args['enable-vision-analysis'] || 'false').trim().toLowerCase() === 'true';
  const visionRecommendations = enableVisionAnalysis
    ? await applyVisionRecommendations({
      assets: ruleAssignments,
      slots,
      envFile: args['env-file'] ? path.resolve(args['env-file']) : null,
      responsesModel: args['responses-model'] || null,
      timeoutMs: Number(args['vision-timeout-ms'] || 90000),
    })
    : { enabled: false, reason: 'disabled', recommendations: [] };

  const analyzedAssets = mergeAssetRecommendations({
    ruleAssignments,
    visionRecommendations,
    slotMap,
  });

  const assignments = new Map();
  const importedAssets = [];
  let referenceSequence = 0;
  let maskSequence = 0;

  analyzedAssets.forEach((asset) => {
    const inferredType = asset.inferred_type === 'mask' ? 'mask' : 'reference';
    const slotId = asset.slot_id || asset.inferred_slot_id || null;
    if (slotId && !slotMap.has(slotId)) throw new Error(`Unknown slot_id for imported asset: ${slotId}`);

    if (inferredType === 'mask') {
      maskSequence += 1;
      const slotSlug = slugify(slotId || `unassigned-mask-${maskSequence}`);
      const assetId = asset.asset_id || `mask_${String(maskSequence).padStart(2, '0')}`;
      const copiedPath = copyFileIntoDir(asset.path, masksDir, `${slotSlug}-${assetId}`);
      importedAssets.push({
        asset_id: assetId,
        path: path.relative(outputDir, copiedPath),
        asset_type: 'mask',
        label: asset.label || `${slotId || 'unassigned'} mask`,
        notes: asset.notes || null,
      });
      addAssignment(assignments, slotId, {
        mask_asset_id: assetId,
        reference_mode: 'masked-edit',
        notes: asset.notes || null,
      });
      return;
    }

    referenceSequence += 1;
    const slotSlug = slugify(slotId || `unassigned-reference-${referenceSequence}`);
    const assetId = asset.asset_id || `ref_${String(referenceSequence).padStart(2, '0')}`;
    const copiedPath = copyFileIntoDir(asset.path, refsDir, `${slotSlug}-${assetId}`);
    importedAssets.push({
      asset_id: assetId,
      path: path.relative(outputDir, copiedPath),
      asset_type: 'reference',
      label: asset.label || slotId || `Reference ${referenceSequence}`,
      notes: asset.notes || null,
    });
    addAssignment(assignments, slotId, {
      asset_id: assetId,
      reference_mode: 'reference-assisted',
      notes: asset.notes || null,
    });
  });

  const slotAssignments = Array.from(assignments.values()).map((assignment) => {
    const mode = assignment.mask_asset_ids.length
      ? 'masked-edit'
      : (assignment.asset_ids.length ? (assignment.reference_mode || 'reference-assisted') : 'prompt-only');
    return {
      slot_id: assignment.slot_id,
      asset_ids: assignment.asset_ids,
      mask_asset_ids: assignment.mask_asset_ids,
      reference_mode: mode,
      priority: assignment.priority || null,
      notes: assignment.notes || null,
    };
  });

  const outputBindings = {
    board_id: ensureString(contentManifest.board_id || contentManifest.id),
    reference_mode: slotAssignments.some((item) => item.mask_asset_ids.length) ? 'hybrid' : 'reference-assisted',
    reference_assets: importedAssets,
    slot_assignments: slotAssignments,
    defaults: {
      unassigned_slot_mode: 'prompt-only',
      unassigned_asset_policy: 'ignore',
    },
  };

  const bindingsPath = path.resolve(args['output-file'] || path.join(outputDir, 'reference_bindings.imported.json'));
  writeJson(bindingsPath, outputBindings);

  const analysisReportPath = path.resolve(args['analysis-report-file'] || path.join(outputDir, 'reference_asset_analysis.json'));
  writeJson(analysisReportPath, {
    taskSpecPath,
    contentManifestPath,
    orderedSlotIds,
    naturalLanguageBindings,
    ruleAssignments: analyzedAssets.map((asset) => ({
      path: path.resolve(asset.path),
      explicit_slot_id: asset.slot_id || null,
      inferred_slot_id: asset.inferred_slot_id || null,
      explicit_type: asset.type || null,
      inferred_type: asset.inferred_type || null,
      inference: asset.inference || null,
      vision_recommendation: asset.vision_recommendation || null,
    })),
    visionAnalysis: visionRecommendations,
    slotAssignments,
  });

  taskSpec.storyboard_plan = {
    ...plan,
    enabled: true,
    layout_manifest: path.isAbsolute(plan.layout_manifest)
      ? plan.layout_manifest
      : path.resolve(taskSpecDir, plan.layout_manifest),
    content_manifest: path.isAbsolute(plan.content_manifest)
      ? plan.content_manifest
      : path.resolve(taskSpecDir, plan.content_manifest),
    render_config: path.isAbsolute(plan.render_config)
      ? plan.render_config
      : path.resolve(taskSpecDir, plan.render_config),
    reference_bindings: bindingsPath,
  };
  const updatedTaskSpecPath = path.resolve(args['task-spec-output'] || path.join(outputDir, 'task_spec.with_imported_assets.json'));
  writeJson(updatedTaskSpecPath, taskSpec);

  console.log(JSON.stringify({
    taskSpecPath,
    updatedTaskSpecPath,
    bindingsPath,
    analysisReportPath,
    importedReferenceCount: importedAssets.filter((item) => item.asset_type === 'reference').length,
    importedMaskCount: importedAssets.filter((item) => item.asset_type === 'mask').length,
    slotAssignmentCount: slotAssignments.length,
    visionAnalysis: visionRecommendations.enabled ? visionRecommendations.reason : 'disabled',
    assetsDir,
  }, null, 2));
}

main().catch((error) => {
  console.error(String(error.message || error));
  process.exit(1);
});
