import { api } from '../app/api.js';
// 对话框只在用户点开时出现：随点击按需加载，不占首屏包。
const DerivedRoundDialog = lazy(() => import('../app/creation-dialogs.jsx').then((module) => ({ default: module.DerivedRoundDialog })));
const ProjectCreationDialog = lazy(() => import('../app/creation-dialogs.jsx').then((module) => ({ default: module.ProjectCreationDialog })));
const ReferenceAssetDialog = lazy(() => import('../app/creation-dialogs.jsx').then((module) => ({ default: module.ReferenceAssetDialog })));
const ReferenceRoundResolverDialog = lazy(() => import('../app/creation-dialogs.jsx').then((module) => ({ default: module.ReferenceRoundResolverDialog })));
const RejectReviewDialog = lazy(() => import('../app/creation-dialogs.jsx').then((module) => ({ default: module.RejectReviewDialog })));
const RoundCreationDialog = lazy(() => import('../app/creation-dialogs.jsx').then((module) => ({ default: module.RoundCreationDialog })));
const TaskCreationDialog = lazy(() => import('../app/creation-dialogs.jsx').then((module) => ({ default: module.TaskCreationDialog })));
import { WorkspaceContextBar } from '../app/shell-pieces.jsx';
import { AssetProvenanceBody } from '../asset-provenance.jsx';
import { requestContextAssetIds } from '../canvas-request-context.mjs';
import { IconButton } from '../components/IconButton.jsx';
import { LayoutAuditOverlay } from '../components/LayoutAuditOverlay.jsx';
import { StatusSlot } from '../components/StatusSlot.jsx';
import { ConfirmationDialog } from '../confirmation-dialog.jsx';
const ProviderSettings = lazy(() => import('../provider-settings.jsx').then((module) => ({ default: module.ProviderSettings })));
import { RequestQueueDock } from '../request-queue.jsx';
import { StudioSearch } from '../studio-search.jsx';
import { WorkbenchNavigation } from '../workbench-navigation.jsx';
import { selectProject, updateWorkbenchRoute } from '../workbench-route.mjs';
import { createDialogFocusSession } from '../accessible-dialog-model.mjs';
import { Suspense, lazy, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

/** 界面批 E（E1.6b）从 App 的返回壳搬出（行为零变化）。 */
export function WorkbenchShell({ EMPTY, ImageInspectorDialog, addAssetsToCurrentRoundReferences, agentConnection, agentDetection, agentDetectionLoading, agentPresenceStatus, answerRequest, assetProvenance, brandKits, canImport, canvasSelectedAssetIds, chooseReferenceRound, chooseReferenceTask, confirmGenerationPlan, confirmPendingAction, confirmation, confirmationBusy, confirmationError, confirmationPlanSummary, copyRuntimeDiagnostic, createDerivedRoundFromAssets, createProjectFromStudio, createRoundForPendingReference, createRoundFromStudio, createTaskFromStudio, creationBusy, creationDialog, creationError, currentLayoutTier, derivedBusy, derivedDialog, derivedError, detectAgents, dismissConfirmation, dismissCreationDialog, dismissDerivedDialog, dismissGenerationConfirmation, dismissReferenceDialog, dismissReferenceResolver, dismissRejectDialog, generationConfirmation, generationConfirmationBusy, generationConfirmationError, importDerivedMaskAsset, inputRef, layoutAuditEnabled, markAsDeliverable, navigateRoute, openDerivedRoundDialog, openProviderDetails, openReferenceDialog, openRejectReviewDialog, openRoundFromQueue, openRoundPlanEdit, openSearchResult, pendingRequestCount, previewAssets, previewZoom, progressForRequest, projectTemplates, projects, provider, providerDetails, providerNotice, railCollapsed, recoveryPhase, referenceBusy, referenceDialog, referenceError, referenceMaterials, referenceResolver, refresh, rejectBusy, rejectDialog, rejectError, renderActiveView, repairRuntime, requestBusy, rounds, route, routeView, runtimeRepairing, saveRejectReview, saveRoundReferenceMaterials, searchError, searchLoading, searchQuery, searchResults, selectedAssetIds, selectedProject, selectedRound, selectedTask, selectionBusyIds, sendRequest, setAssetProvenance, setPreviewAssets, setPreviewZoom, setProviderDetails, setRailCollapsed, setSearchQuery, sharedAssets, statusItems, studio, studioRequests, studioView, styleKits, surfaceEyebrow, surfaceSubtitle, surfaceTitle, taskForId, taskTypes, tasks, updateAgentConnection, upload, view, withdrawRequest }) {
  // S3（界面瑕疵专项）：资产来源浮层是**非模态**对话面（fixed 侧浮层，背景仍可用）——
  // 补上 role="dialog" 语义、焦点进入/返回与 Escape 关闭；不置 aria-modal：背景没有被 inert。
  const assetInspectorRef = useRef(null);
  useEffect(() => {
    const panel = assetInspectorRef.current;
    if (!assetProvenance || !panel) return undefined;
    const focusSession = createDialogFocusSession({
      dialog: panel,
      activeElement: () => document.activeElement instanceof HTMLElement ? document.activeElement : null,
      dismiss: () => setAssetProvenance(null)
    });
    focusSession.mount();
    return () => focusSession.dispose();
  }, [assetProvenance]);

  return (
<main className={'studio-shell' + (railCollapsed ? ' is-rail-collapsed' : '')} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const files = Array.from(event.dataTransfer.files).filter((item) => item.type.startsWith('image/')); if (files.length && canImport) void upload(files); }} onPaste={(event) => { const files = [...event.clipboardData.files].filter((item) => item.type.startsWith('image/')); if (files.length && canImport) { event.preventDefault(); void upload(files); } }}>
    <aside className="studio-rail" aria-label="Studio 左侧控制栏">
      <div className="rail-brand-row"><div className="brand-mark" aria-label="DAOGE Pic"><span>DAOGE</span><b>Pic</b></div><button type="button" className="rail-collapse-toggle" onClick={() => setRailCollapsed((current) => !current)} title={railCollapsed ? '展开左侧栏' : '折叠左侧栏'} aria-label={railCollapsed ? '展开左侧栏' : '折叠左侧栏'} aria-pressed={railCollapsed}>{railCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button></div>
      <WorkbenchNavigation view={view} project={selectedProject} task={selectedTask} round={selectedRound} provider={provider} studio={studio} recoveryPhase={recoveryPhase} repairing={runtimeRepairing} onOpenProvider={openProviderDetails} onOpenGuide={() => navigateRoute({ view: 'guide' })} onCopyRuntimeDiagnostic={() => void copyRuntimeDiagnostic()} onRefresh={() => void refresh()} onRepair={() => void repairRuntime()} onNavigate={(nextView, changes = {}) => navigateRoute({ view: nextView, ...changes })} />
    </aside>

    <section className={'work-surface' + (routeView === 'lineage' ? ' is-canvas' : '')}>
<div className="workspace-chrome">
        <header className="surface-header">
          <div className="heading-group"><p className="eyebrow">{surfaceEyebrow(view, Boolean(selectedProject))}</p><h1>{surfaceTitle(view, selectedProject)}</h1><span>{surfaceSubtitle(view, selectedProject)}</span></div>
          {!studioView && <WorkspaceContextBar project={selectedProject} tasks={tasks} task={selectedTask} rounds={rounds} selectedRound={selectedRound} onSelectTask={(taskId) => navigateRoute(updateWorkbenchRoute(route, { taskId, roundId: null, compareRoundIds: [], runId: null, assetScope: taskId ? 'task' : 'project' }))} onSelectRound={(roundId) => { const nextRound = rounds.find((round) => round.id === roundId); navigateRoute(updateWorkbenchRoute(route, { taskId: roundId ? nextRound?.taskId || selectedTask?.id || null : selectedTask?.id || null, roundId, compareRoundIds: roundId ? [roundId] : [], runId: null, assetScope: roundId ? 'round' : selectedTask ? 'task' : 'project' })); }} projects={projects} onSwitchProject={(projectId) => navigateRoute(selectProject(route, projectId))} />}
          <div className="header-actions">
            <StudioSearch query={searchQuery} results={searchResults} loading={searchLoading} error={searchError} onQueryChange={setSearchQuery} onOpenResult={openSearchResult} />
            <IconButton label="刷新工作台" onClick={() => void refresh()}><RefreshCw size={17} /></IconButton>
            <input ref={inputRef} className="file-input" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" aria-label="导入图片文件" onChange={(event) => void upload(event.target.files)} />
          </div>
        </header>
      </div>
      <StatusSlot items={statusItems} />
      {/* C4（第 7 批）：队列从「内容之上」挪到内容之后（底部槽）——首元素 y 越界的真因就是它。
          页面区在画布视图是可收缩的滚动区，所以队列长高时画布**让位**，不会被盖住。 */}
      <div className="work-scroll" data-region="scroll">
        <Suspense fallback={<div role="status" aria-live="polite" style={{ padding: '24px', opacity: 0.7 }}>正在加载视图…</div>}>{renderActiveView()}</Suspense>
      </div>
      <RequestQueueDock requests={studioRequests} pendingCount={pendingRequestCount} busy={requestBusy} presence={agentPresenceStatus} progress={progressForRequest} onOpenRound={openRoundFromQueue} context={{ projectId: selectedProject?.id || null, taskId: selectedTask?.id || null, roundId: selectedRound?.id || null, assetIds: requestContextAssetIds({ canvasAssetIds: canvasSelectedAssetIds, selectedAssetIds: [...selectedAssetIds] }) }} onSend={sendRequest} onWithdraw={withdrawRequest} onAnswer={answerRequest} onEditPlan={openRoundPlanEdit} providerNotice={providerNotice} detection={agentDetection} detectionLoading={agentDetectionLoading} onDetect={detectAgents} connection={agentConnection} onConnectionChange={updateAgentConnection} selecting={previewAssets.length > 0} />
      {layoutAuditEnabled && <LayoutAuditOverlay layout={currentLayoutTier} screen={routeView} />}
    </section>

    {assetProvenance && routeView !== 'lineage' && <aside ref={assetInspectorRef} className="asset-inspector" data-region="aside-overlay" role="dialog" tabIndex={-1} aria-label="资产来源与评审记录"><AssetProvenanceBody provenance={assetProvenance} onClose={() => setAssetProvenance(null)} onOpenTrace={(output) => navigateRoute({ view: 'runs', projectId: output.project.id, taskId: output.task.id, roundId: output.round.id, runId: output.run.id })} /></aside>}
    {generationConfirmation && <ConfirmationDialog label="确认创作计划" title={'确认这版计划（v' + generationConfirmation.round.planVersion + '）？'} message={confirmationPlanSummary(generationConfirmation.round)} note="确认会把这版计划绑定到当前 conversation 与计划哈希；确认本身不会调用生成服务，需要回到会话继续核算与出图。" confirmLabel="确认计划" busy={generationConfirmationBusy} error={generationConfirmationError} tone="warning" onCancel={dismissGenerationConfirmation} onConfirm={confirmGenerationPlan} />}
    {previewAssets.length > 0 && <ImageInspectorDialog readOnly={routeView === 'assets' || routeView === 'trash'} assets={previewAssets} zoom={previewZoom} selectedAssetIds={selectedAssetIds} selectionBusyIds={selectionBusyIds} selectedProject={selectedProject} selectedTask={selectedTask} fallbackTask={previewAssets.length === 1 ? taskForId(previewAssets[0]?.display?.taskId || previewAssets[0]?.source?.taskId || previewAssets[0]?.source?.creativeTaskId) : null} selectedRound={selectedRound} onClose={() => setPreviewAssets([])} onZoom={setPreviewZoom} onToggleDeliverable={markAsDeliverable} onOpenDerive={openDerivedRoundDialog} onAddReference={(nextAssets, usage) => void addAssetsToCurrentRoundReferences(nextAssets, usage)} onReject={openRejectReviewDialog} onOpenReference={openReferenceDialog} />}
    <Suspense fallback={null}>
    {rejectDialog && <RejectReviewDialog assets={rejectDialog.assets} canAddNegative={Boolean(selectedRound && selectedRound.status === 'draft')} canCreateNextRound={Boolean(selectedProject && selectedTask)} initialCreateNextRound={rejectDialog.createNextRound} busy={rejectBusy} error={rejectError} onDismiss={dismissRejectDialog} onSave={saveRejectReview} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {providerDetails && <ProviderSettings request={api} onDismiss={() => setProviderDetails(null)} onChanged={refresh} />}
    {creationDialog === 'project' && <ProjectCreationDialog projectTemplates={projectTemplates} busy={creationBusy} error={creationError} onDismiss={dismissCreationDialog} onCreate={createProjectFromStudio} />}
    {creationDialog === 'task' && selectedProject && <TaskCreationDialog project={selectedProject} projectTemplates={projectTemplates} taskTypes={taskTypes} styleKits={styleKits} brandKits={brandKits} busy={creationBusy} error={creationError} onDismiss={dismissCreationDialog} onCreate={createTaskFromStudio} />}
    {referenceResolver && selectedProject && <ReferenceRoundResolverDialog project={selectedProject} task={referenceResolver.task || selectedTask} tasks={referenceResolver.tasks || tasks} draftRounds={referenceResolver.draftRounds || EMPTY} assets={referenceResolver.assets || EMPTY} usage={referenceResolver.usage || 'subject'} busy={referenceBusy} error={referenceError} onDismiss={dismissReferenceResolver} onUseRound={(roundId) => void chooseReferenceRound(roundId)} onSelectTask={chooseReferenceTask} onCreateRound={createRoundForPendingReference} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {referenceDialog === 'round' && selectedProject && selectedTask && selectedRound && <ReferenceAssetDialog project={selectedProject} task={selectedTask} round={selectedRound} sharedAssets={sharedAssets} selectedMaterials={referenceMaterials} busy={referenceBusy} error={referenceError} onDismiss={dismissReferenceDialog} onSave={(materials) => void saveRoundReferenceMaterials(materials)} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {creationDialog === 'round' && selectedTask && <RoundCreationDialog task={selectedTask} rounds={rounds} currentRound={selectedRound} recipes={styleKits} busy={creationBusy} error={creationError} onDismiss={dismissCreationDialog} onCreate={createRoundFromStudio} />}
    {derivedDialog && selectedProject && selectedTask && <DerivedRoundDialog project={selectedProject} task={selectedTask} rounds={rounds} currentRound={selectedRound} assets={derivedDialog.assets} initialPurpose={derivedDialog.purpose} initialActionId={derivedDialog.actionId} busy={derivedBusy} error={derivedError} onDismiss={dismissDerivedDialog} onCreate={createDerivedRoundFromAssets} onImportMask={importDerivedMaskAsset} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    </Suspense>
    {confirmation && <ConfirmationDialog label={confirmation.kind === 'archive' ? '确认归档项目' : '确认移入回收站'} title={confirmation.kind === 'archive' ? '归档“' + confirmation.projectName + '”？' : '将图片移入回收站？'} message={confirmation.kind === 'archive' ? '归档后将关闭该项目下的任务与批次。未完成生成必须先暂停或取消。是否继续？' : '这张图片仍被选择、规则资料或交付引用。移入回收站不会删除已冻结交付；引用关系会保留但素材不可用。是否继续？'} confirmLabel={confirmation.kind === 'archive' ? '归档项目' : '移入回收站'} busy={confirmationBusy} error={confirmationError} tone="danger" onCancel={dismissConfirmation} onConfirm={confirmPendingAction} />}
  </main>
  );
}
