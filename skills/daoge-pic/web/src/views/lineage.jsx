import { api } from '../app/api.js';
import { CreativeLineageCanvas } from '../creative-lineage-canvas.jsx';

/** 界面批 E（E1.6）从 main.jsx 的 viewRenderers 拆出（行为零变化）。 */
export function LineageView({ activeRun, addAssetsToCurrentRoundReferences, assetProvenance, assetTotal, assets, copyAsset, deliveries, deselectAsset, downloadAsset, eventRevision, inspectAsset, lineageAssetCoverage, lineageRunItemCoverage, lineageVisibleRunItems, markAsDeliverable, navigateRoute, openCreationDialog, openDerivedRoundDialog, openGenerationConfirmation, openReferenceDialog, openRejectReviewDialog, pendingPlanEditRoundId, rounds, runs, savePlanAsRecipe, selectedAssetIds, selectedProject, selectedRound, selectedTask, selectionBusyIds, setAssetProvenance, setAssetShared, setAssetsSelection, setCanvasSelectedAssetIds, setPendingPlanEditRoundId, setPreviewAssets, setPreviewZoom, sharedAssets, tasks, view, visibleAssets }) {
  return selectedProject ? (
    <CreativeLineageCanvas
      request={api}
      project={selectedProject}
      tasks={tasks}
      selectedTask={selectedTask}
      rounds={rounds}
      selectedRound={selectedRound}
      runs={runs}
      activeRun={activeRun}
      runItems={lineageVisibleRunItems}
      runItemCoverage={lineageRunItemCoverage}
      assets={visibleAssets}
      assetTotal={assetTotal}
      assetCoverage={lineageAssetCoverage}
      sharedAssets={sharedAssets}
      selectedAssetIds={selectedAssetIds}
      selectionBusyIds={selectionBusyIds}
      onCanvasAssetSelection={setCanvasSelectedAssetIds}
      deliveries={deliveries}
      assetProvenance={assetProvenance}
      onCloseAssetProvenance={() => setAssetProvenance(null)}
      onOpenAssetTrace={(output) => navigateRoute({ view: 'runs', projectId: output.project.id, taskId: output.task.id, roundId: output.round.id, runId: output.run.id })}
      layoutRevision={eventRevision.canvasLayout}
      onNavigate={navigateRoute}
      onPreviewAsset={(asset) => { setPreviewZoom(1); setPreviewAssets([asset]); }}
      onInspectAsset={inspectAsset}
      onToggleAsset={markAsDeliverable}
      onDeselectAsset={deselectAsset}
      onBatchSelectAssets={setAssetsSelection}
      onSetAssetShared={setAssetShared}
      onDownloadAsset={downloadAsset}
      onCopyAsset={copyAsset}
      onCreateTask={() => openCreationDialog('task')}
      onCreateRound={() => openCreationDialog('round')}
      onOpenReference={openReferenceDialog}
      onOpenDerive={openDerivedRoundDialog}
      onAddReference={(nextAssets, usage) => void addAssetsToCurrentRoundReferences(nextAssets, usage)}
      onReject={openRejectReviewDialog}
      onOpenConfirmation={(round) => void openGenerationConfirmation(round)}
      onSaveRecipe={(round) => void savePlanAsRecipe(round)}
      pendingPlanEditRoundId={pendingPlanEditRoundId}
      onPendingPlanEditHandled={() => setPendingPlanEditRoundId(null)}
    />
  ) : null;
}
