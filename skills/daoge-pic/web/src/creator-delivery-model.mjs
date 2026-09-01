export const DELIVERY_COMPLETION_PHASES = Object.freeze({
  draft: { action: '创建草稿', busyAction: '正在创建草稿', step: 1 },
  prepare: { action: '准备交付', busyAction: '正在准备交付', step: 2 },
  export: { action: '导出文件', busyAction: '正在导出文件', step: 3 },
  complete: { action: '完成', busyAction: '正在完成', step: 4 }
});

export function deliveryCompletionPresentation(completion, busy = false) {
  const phase = completion?.phase || 'draft';
  const value = DELIVERY_COMPLETION_PHASES[phase] || DELIVERY_COMPLETION_PHASES.draft;
  return {
    phase,
    action: busy ? value.busyAction : value.action,
    step: value.step,
    frozen: Boolean(completion),
    complete: phase === 'complete'
  };
}

export function isDeliveryOperationCurrent({ activeProjectId, projectId, currentEpoch, operationEpoch }) {
  return Boolean(projectId) && activeProjectId === projectId && currentEpoch === operationEpoch;
}

export function createDeliveryInteractionGuard() {
  let busy = false;
  return {
    begin() {
      if (busy) return false;
      busy = true;
      return true;
    },
    end() { busy = false; },
    reset() { busy = false; },
    isBusy() { return busy; }
  };
}

export function createBatchOperationSnapshot({ action, batchId = null, versionId = null, deliveryIds = [], eligibleDeliveryIds = null, name = '' }) {
  const eligible = eligibleDeliveryIds === null ? null : new Set(eligibleDeliveryIds);
  return Object.freeze({
    action,
    batchId,
    versionId,
    deliveryIds: Object.freeze([...deliveryIds].filter((deliveryId) => !eligible || eligible.has(deliveryId)).sort()),
    name: String(name).trim()
  });
}

export function batchOperationSignature(input) {
  return JSON.stringify(createBatchOperationSnapshot(input));
}
