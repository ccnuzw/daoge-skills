const path = require('path');
const { readJsonIfExists } = require('./script_utils');
const { normalizeRuntimeProtocolState } = require('./unified_status_summary');

const LEGACY_ASSET_FIELD_MAP = {
  preview: 'previewImages',
  result: 'resultAssets',
  review: 'reviewAssets',
  exception: 'exceptionItems',
  reference: 'referenceAssets',
};

function resolveUnifiedWorkbenchStatePath(outputDir) {
  return path.join(path.resolve(outputDir), 'workspace_live_state.json');
}

function resolveLegacyWorkbenchStatePath(outputDir) {
  return path.join(path.resolve(outputDir), 'workbench_state.json');
}

function buildWorkbenchStateSources(outputDir, overrides = {}) {
  return {
    preferredState: resolveUnifiedWorkbenchStatePath(outputDir),
    liveState: resolveUnifiedWorkbenchStatePath(outputDir),
    legacyPageSnapshot: resolveLegacyWorkbenchStatePath(outputDir),
    canonicalState: path.join(outputDir, 'workspace_state.json'),
    assetsState: path.join(outputDir, 'workspace_assets.json'),
    timelineState: path.join(outputDir, 'workspace_timeline.json'),
    entryState: path.join(outputDir, 'entry_state.json'),
    runtimeState: path.join(outputDir, 'runtime_state.json'),
    ...overrides,
  };
}

function buildRuntimeWorkflowFallback(runtimeState = {}) {
  if (!runtimeState || typeof runtimeState !== 'object') return null;
  if (runtimeState.runtimeWorkflow && typeof runtimeState.runtimeWorkflow === 'object') {
    return runtimeState.runtimeWorkflow;
  }
  const normalizedRuntimeState = normalizeRuntimeProtocolState(runtimeState);
  return normalizedRuntimeState.runtimeWorkflow || null;
}

function buildWorkflowSessionFallbacks(snapshot = {}) {
  const contracts = snapshot.workflowContracts && typeof snapshot.workflowContracts === 'object'
    ? snapshot.workflowContracts
    : {};
  const protocolRegistry = snapshot.workflowProtocolRegistry && typeof snapshot.workflowProtocolRegistry === 'object'
    ? snapshot.workflowProtocolRegistry
    : {};
  const stages = ['home', 'prepare', 'result', 'exception'];
  return Object.fromEntries(stages.map((stageKey) => {
    const contract = contracts[stageKey] && typeof contracts[stageKey] === 'object'
      ? contracts[stageKey]
      : null;
    const protocol = protocolRegistry[stageKey] && typeof protocolRegistry[stageKey] === 'object'
      ? protocolRegistry[stageKey]
      : null;
    return [stageKey, {
      stageKey,
      contract,
      protocol,
    }];
  }));
}

function readCanonicalWorkspaceState(outputDir, snapshot = {}) {
  const canonicalPath = String(
    snapshot?.stateSources?.canonicalState
    || path.join(outputDir, 'workspace_state.json')
  ).trim();
  return readJsonIfExists(canonicalPath) || {};
}

function pickStateSection(primaryValue, fallbackValue) {
  const primaryObject = primaryValue && typeof primaryValue === 'object' ? primaryValue : null;
  if (primaryObject && Object.keys(primaryObject).length) return primaryObject;
  const fallbackObject = fallbackValue && typeof fallbackValue === 'object' ? fallbackValue : null;
  return fallbackObject || {};
}

function toAssetArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeWorkbenchAssets(workspaceAssets = {}) {
  const source = workspaceAssets && typeof workspaceAssets === 'object' ? workspaceAssets : {};
  const assetCollections = source.assetCollections && typeof source.assetCollections === 'object'
    ? source.assetCollections
    : {};
  const userFacing = assetCollections.userFacing && typeof assetCollections.userFacing === 'object'
    ? { ...assetCollections.userFacing }
    : {};
  const system = assetCollections.system && typeof assetCollections.system === 'object'
    ? { ...assetCollections.system }
    : {};

  for (const [collectionKey, legacyField] of Object.entries(LEGACY_ASSET_FIELD_MAP)) {
    const canonicalItems = toAssetArray(userFacing[collectionKey]);
    const legacyItems = toAssetArray(source[legacyField]);
    userFacing[collectionKey] = canonicalItems.length ? canonicalItems : legacyItems;
  }

  const normalizedAssetCollections = {
    ...assetCollections,
    userFacing,
    system,
  };

  const normalizedAssets = {
    ...source,
    assetCollections: normalizedAssetCollections,
  };

  for (const [collectionKey, legacyField] of Object.entries(LEGACY_ASSET_FIELD_MAP)) {
    normalizedAssets[legacyField] = toAssetArray(userFacing[collectionKey]);
  }

  return normalizedAssets;
}

function mergeWorkbenchAssets(primaryAssets = {}, fallbackAssets = {}) {
  const primaryNormalized = normalizeWorkbenchAssets(primaryAssets);
  const fallbackNormalized = normalizeWorkbenchAssets(fallbackAssets);
  const mergedUserFacing = {};
  const userFacingKeys = new Set([
    ...Object.keys((fallbackNormalized.assetCollections && fallbackNormalized.assetCollections.userFacing) || {}),
    ...Object.keys((primaryNormalized.assetCollections && primaryNormalized.assetCollections.userFacing) || {}),
  ]);

  for (const key of userFacingKeys) {
    const primaryItems = toAssetArray(primaryNormalized.assetCollections?.userFacing?.[key]);
    const fallbackItems = toAssetArray(fallbackNormalized.assetCollections?.userFacing?.[key]);
    mergedUserFacing[key] = primaryItems.length ? primaryItems : fallbackItems;
  }

  const mergedAssetCollections = {
    ...(fallbackNormalized.assetCollections || {}),
    ...(primaryNormalized.assetCollections || {}),
    userFacing: mergedUserFacing,
    system: {
      ...((fallbackNormalized.assetCollections && fallbackNormalized.assetCollections.system) || {}),
      ...((primaryNormalized.assetCollections && primaryNormalized.assetCollections.system) || {}),
    },
  };

  const mergedAssets = {
    ...fallbackNormalized,
    ...primaryNormalized,
    assetCollections: mergedAssetCollections,
  };

  return normalizeWorkbenchAssets(mergedAssets);
}

function buildCanonicalWorkbenchAssets(workspaceAssets = {}) {
  const normalizedAssets = normalizeWorkbenchAssets(workspaceAssets);
  const canonicalAssets = {
    ...normalizedAssets,
  };

  for (const legacyField of Object.values(LEGACY_ASSET_FIELD_MAP)) {
    delete canonicalAssets[legacyField];
  }

  return canonicalAssets;
}

function shouldEmbedPageGovernance(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedDerivedSummaries(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedStageSummaries(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedStaticConfig(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedEntryBridge(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedCoreDecisionState(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedCoreRuntimeState(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedRuntimeWorkflow(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedRuntimeSummary(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedAssets(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedTimeline(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedWorkflowRegistries(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedTaskSessionSnapshots(snapshotRole) {
  return snapshotRole === 'derived-page-snapshot';
}

function shouldEmbedCompatibilitySections(snapshotRole) {
  return false;
}

function buildWorkbenchStateSnapshot(outputDir, options = {}) {
  const workspaceState = options.workspaceState && typeof options.workspaceState === 'object'
    ? options.workspaceState
    : {};
  const workspaceAssets = options.workspaceAssets && typeof options.workspaceAssets === 'object'
    ? normalizeWorkbenchAssets(options.workspaceAssets)
    : {};
  const workspaceTimeline = options.workspaceTimeline && typeof options.workspaceTimeline === 'object'
    ? options.workspaceTimeline
    : {};
  const runtimeState = options.runtimeState && typeof options.runtimeState === 'object'
    ? options.runtimeState
    : {};

  const generatedAt = String(
    runtimeState.updatedAt
    || runtimeState.generatedAt
    || workspaceState.generatedAt
    || workspaceState.updatedAt
    || workspaceTimeline.generatedAt
    || workspaceAssets.generatedAt
    || ''
  ).trim() || new Date().toISOString();
  const snapshotRole = String(options.snapshotRole || 'live-workbench-state').trim() || 'live-workbench-state';
  const outputFile = String(
    options.outputFile
    || (snapshotRole === 'derived-page-snapshot'
      ? resolveLegacyWorkbenchStatePath(outputDir)
      : resolveUnifiedWorkbenchStatePath(outputDir))
  ).trim();

  return {
    schemaVersion: 1,
    kind: 'daoge-workbench-state',
    role: snapshotRole,
    snapshotIntent: snapshotRole === 'derived-page-snapshot'
      ? 'compatibility-page-snapshot'
      : 'primary-runtime-source',
    generatedAt,
    outputDir,
    outputFile,
    stateSources: buildWorkbenchStateSources(outputDir, {
      currentState: outputFile,
      unifiedState: resolveUnifiedWorkbenchStatePath(outputDir),
    }),
    taskLabel: String(workspaceState.taskLabel || '').trim() || '未命名任务',
    mode: String(workspaceState.mode || '').trim() || 'workspace',
    runtimeMode: String(workspaceState.runtimeMode || '').trim() || 'unknown',
    entryBridge: shouldEmbedEntryBridge(snapshotRole) ? (workspaceState.entryBridge || null) : null,
    status: shouldEmbedCoreRuntimeState(snapshotRole) ? (workspaceState.status || {}) : {},
    counts: shouldEmbedCoreRuntimeState(snapshotRole) ? (workspaceState.counts || {}) : {},
    nextAction: shouldEmbedCoreRuntimeState(snapshotRole) ? (workspaceState.nextAction || {}) : {},
    routes: shouldEmbedStaticConfig(snapshotRole) ? (workspaceState.routes || {}) : {},
    risk: shouldEmbedCoreDecisionState(snapshotRole) ? (workspaceState.risk || {}) : {},
    confirmationState: shouldEmbedCoreDecisionState(snapshotRole) ? (workspaceState.confirmationState || {}) : {},
    sourceSummary: shouldEmbedDerivedSummaries(snapshotRole) ? (workspaceState.sourceSummary || {}) : {},
    assetLayers: shouldEmbedDerivedSummaries(snapshotRole) ? (workspaceState.assetLayers || {}) : {},
    governance: shouldEmbedPageGovernance(snapshotRole) ? (workspaceState.governance || {}) : {},
    governanceByPage: shouldEmbedPageGovernance(snapshotRole) ? (workspaceState.governanceByPage || {}) : {},
    artifactGovernance: shouldEmbedPageGovernance(snapshotRole) ? (workspaceState.artifactGovernance || {}) : {},
    workbenchGuide: shouldEmbedCompatibilitySections(snapshotRole) ? (workspaceState.workbenchGuide || {}) : {},
    assetVisibilityGuide: shouldEmbedCompatibilitySections(snapshotRole) ? (workspaceState.assetVisibilityGuide || {}) : {},
    workflowSessions: snapshotRole === 'derived-page-snapshot'
      ? (workspaceState.workflowSessions || {})
      : {},
    taskSessionSnapshots: shouldEmbedTaskSessionSnapshots(snapshotRole)
      ? (workspaceState.taskSessionSnapshots || {})
      : {},
    workflowProtocolRegistry: shouldEmbedWorkflowRegistries(snapshotRole)
      ? (workspaceState.workflowProtocolRegistry || {})
      : {},
    workflowCopilotRegistry: shouldEmbedWorkflowRegistries(snapshotRole)
      ? (workspaceState.workflowCopilotRegistry || {})
      : {},
    pageGroups: shouldEmbedPageGovernance(snapshotRole) ? (workspaceState.pageGroups || {}) : {},
    pageData: shouldEmbedCompatibilitySections(snapshotRole) ? (workspaceState.pageData || {}) : {},
    views: shouldEmbedCompatibilitySections(snapshotRole) ? (workspaceState.views || {}) : {},
    runtimeSummary: shouldEmbedRuntimeSummary(snapshotRole)
      ? (workspaceState.runtimeSummary || runtimeState || {})
      : {},
    runtimeWorkflow: shouldEmbedRuntimeWorkflow(snapshotRole)
      ? (workspaceState.runtimeWorkflow || buildRuntimeWorkflowFallback(workspaceState.runtimeSummary || runtimeState || {}) || null)
      : null,
    prepare: shouldEmbedStageSummaries(snapshotRole) ? (workspaceState.prepare || {}) : {},
    result: shouldEmbedStageSummaries(snapshotRole) ? (workspaceState.result || {}) : {},
    exception: shouldEmbedStageSummaries(snapshotRole) ? (workspaceState.exception || {}) : {},
    specialization: shouldEmbedStaticConfig(snapshotRole) ? (workspaceState.specialization || {}) : {},
    panels: shouldEmbedStaticConfig(snapshotRole) ? (workspaceState.panels || {}) : {},
    assets: shouldEmbedAssets(snapshotRole) ? workspaceAssets : undefined,
    timeline: shouldEmbedTimeline(snapshotRole) ? workspaceTimeline : {},
  };
}

function hydrateWorkbenchSnapshot(outputDir, snapshot = {}, options = {}) {
  const hydratedSnapshot = snapshot && typeof snapshot === 'object'
    ? { ...snapshot }
    : {};

  hydratedSnapshot.runtimeSummary = (
    hydratedSnapshot.runtimeSummary
    && typeof hydratedSnapshot.runtimeSummary === 'object'
    && Object.keys(hydratedSnapshot.runtimeSummary).length
  )
    ? hydratedSnapshot.runtimeSummary
    : (
      options.runtimeState && typeof options.runtimeState === 'object'
        ? options.runtimeState
        : (readJsonIfExists(hydratedSnapshot.stateSources?.runtimeState) || {})
    );
  hydratedSnapshot.runtimeWorkflow = hydratedSnapshot.runtimeWorkflow
    || buildRuntimeWorkflowFallback(hydratedSnapshot.runtimeSummary)
    || null;
  hydratedSnapshot.workflowSessions = (
    hydratedSnapshot.workflowSessions
    && typeof hydratedSnapshot.workflowSessions === 'object'
    && Object.keys(hydratedSnapshot.workflowSessions).length
  )
    ? hydratedSnapshot.workflowSessions
    : buildWorkflowSessionFallbacks(hydratedSnapshot);
  const providedWorkspaceState = options.workspaceState && typeof options.workspaceState === 'object'
    ? options.workspaceState
    : null;
  const canonicalWorkspaceState = (
    providedWorkspaceState
    && Object.keys(providedWorkspaceState).length
  )
    ? providedWorkspaceState
    : readCanonicalWorkspaceState(outputDir, hydratedSnapshot);
  hydratedSnapshot.taskSessionSnapshots = pickStateSection(
    hydratedSnapshot.taskSessionSnapshots,
    canonicalWorkspaceState.taskSessionSnapshots
  );
  hydratedSnapshot.workflowProtocolRegistry = pickStateSection(
    hydratedSnapshot.workflowProtocolRegistry,
    canonicalWorkspaceState.workflowProtocolRegistry
  );
  hydratedSnapshot.workflowCopilotRegistry = pickStateSection(
    hydratedSnapshot.workflowCopilotRegistry,
    canonicalWorkspaceState.workflowCopilotRegistry
  );
  hydratedSnapshot.workflowContracts = pickStateSection(
    hydratedSnapshot.workflowContracts,
    canonicalWorkspaceState.workflowContracts
  );
  hydratedSnapshot.entryBridge = hydratedSnapshot.entryBridge
    || canonicalWorkspaceState.entryBridge
    || null;
  const hydratedStateSections = [
    'status',
    'counts',
    'nextAction',
    'risk',
    'confirmationState',
    'sourceSummary',
    'assetLayers',
    'governance',
    'governanceByPage',
    'artifactGovernance',
    'workbenchGuide',
    'assetVisibilityGuide',
    'pageGroups',
    'pageData',
    'views',
    'prepare',
    'result',
    'exception',
    'routes',
    'specialization',
    'panels',
    'taskSessionSnapshots',
  ];

  for (const sectionKey of hydratedStateSections) {
    hydratedSnapshot[sectionKey] = pickStateSection(
      hydratedSnapshot[sectionKey],
      canonicalWorkspaceState[sectionKey]
    );
  }

  const persistedWorkspaceAssets = normalizeWorkbenchAssets(
    (
      options.workspaceAssets && typeof options.workspaceAssets === 'object'
        ? options.workspaceAssets
        : readJsonIfExists(
          hydratedSnapshot.stateSources?.assetsState
          || path.join(outputDir, 'workspace_assets.json')
        )
    ) || {}
  );
  const snapshotAssets = normalizeWorkbenchAssets(hydratedSnapshot.assets || {});
  const resolvedWorkspaceAssets = mergeWorkbenchAssets(snapshotAssets, persistedWorkspaceAssets);
  const resolvedWorkspaceTimeline = (
    options.workspaceTimeline && typeof options.workspaceTimeline === 'object'
  )
    ? options.workspaceTimeline
    : (
      (hydratedSnapshot.timeline && typeof hydratedSnapshot.timeline === 'object' && Object.keys(hydratedSnapshot.timeline).length)
        ? hydratedSnapshot.timeline
        : (readJsonIfExists(
          hydratedSnapshot.stateSources?.timelineState
          || path.join(outputDir, 'workspace_timeline.json')
        ) || {})
    );

  return {
    snapshot: hydratedSnapshot,
    pageState: hydratedSnapshot,
    workspaceState: hydratedSnapshot,
    workspaceAssets: resolvedWorkspaceAssets,
    workspaceTimeline: resolvedWorkspaceTimeline,
  };
}

function loadWorkbenchState(outputDir, options = {}) {
  const snapshotPath = resolveUnifiedWorkbenchStatePath(outputDir);
  const legacySnapshotPath = resolveLegacyWorkbenchStatePath(outputDir);
  const snapshot = readJsonIfExists(snapshotPath) || readJsonIfExists(legacySnapshotPath);
  if (snapshot && typeof snapshot === 'object') {
    const loadedFrom = readJsonIfExists(snapshotPath) ? snapshotPath : legacySnapshotPath;
    const normalizedSnapshot = {
      role: loadedFrom === legacySnapshotPath ? 'derived-page-snapshot' : 'live-workbench-state',
      snapshotIntent: loadedFrom === legacySnapshotPath ? 'compatibility-page-snapshot' : 'primary-runtime-source',
      outputFile: loadedFrom,
      stateSources: buildWorkbenchStateSources(outputDir, {
        currentState: loadedFrom,
        unifiedState: snapshotPath,
        ...(snapshot.stateSources && typeof snapshot.stateSources === 'object' ? snapshot.stateSources : {}),
      }),
      ...snapshot,
    };
    return hydrateWorkbenchSnapshot(outputDir, normalizedSnapshot, options);
  }

  const workspaceState = options.workspaceState || readJsonIfExists(path.join(outputDir, 'workspace_state.json')) || {};
  const workspaceAssets = normalizeWorkbenchAssets(
    options.workspaceAssets || readJsonIfExists(path.join(outputDir, 'workspace_assets.json')) || {}
  );
  const workspaceTimeline = options.workspaceTimeline || readJsonIfExists(path.join(outputDir, 'workspace_timeline.json')) || {};
  const runtimeState = options.runtimeState || readJsonIfExists(path.join(outputDir, 'runtime_state.json')) || {};

  const derivedSnapshot = buildWorkbenchStateSnapshot(outputDir, {
    workspaceState,
    workspaceAssets,
    workspaceTimeline,
    runtimeState,
    snapshotRole: 'derived-page-snapshot',
  });

  return hydrateWorkbenchSnapshot(outputDir, derivedSnapshot, {
    ...options,
    workspaceState,
    workspaceAssets,
    workspaceTimeline,
    runtimeState,
  });
}

module.exports = {
  buildCanonicalWorkbenchAssets,
  buildWorkbenchStateSnapshot,
  buildWorkbenchStateSources,
  buildRuntimeWorkflowFallback,
  loadWorkbenchState,
  mergeWorkbenchAssets,
  normalizeWorkbenchAssets,
  resolveLegacyWorkbenchStatePath,
  resolveUnifiedWorkbenchStatePath,
};
