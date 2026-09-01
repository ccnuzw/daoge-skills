export const RUN_STATUSES = [
  'draft',
  'awaiting_confirmation',
  'queued',
  'running',
  'pausing',
  'paused',
  'interrupted',
  'resume_pending',
  'partial',
  'completed',
  'failed',
  'cancelled'
] as const;

export type RunStatus = typeof RUN_STATUSES[number];

export const RUN_ITEM_STATUSES = [
  'pending',
  'leased',
  'requesting',
  'receiving',
  'persisting',
  'succeeded',
  'retry_wait',
  'blocked',
  'cancel_requested',
  'cancelled',
  'outcome_unknown',
  'failed'
] as const;

export type RunItemStatus = typeof RUN_ITEM_STATUSES[number];

const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  draft: ['awaiting_confirmation', 'cancelled'],
  awaiting_confirmation: ['queued', 'cancelled'],
  queued: ['running', 'pausing', 'resume_pending', 'cancelled'],
  running: ['pausing', 'completed', 'partial', 'failed', 'interrupted', 'resume_pending', 'cancelled'],
  pausing: ['paused', 'partial', 'failed', 'resume_pending', 'cancelled'],
  paused: ['queued', 'cancelled'],
  interrupted: ['resume_pending'],
  resume_pending: ['queued', 'cancelled'],
  partial: ['queued', 'completed', 'cancelled'],
  completed: [],
  failed: ['queued', 'cancelled'],
  cancelled: []
};

const RUN_ITEM_TRANSITIONS: Record<RunItemStatus, readonly RunItemStatus[]> = {
  pending: ['leased', 'blocked', 'cancel_requested'],
  leased: ['pending', 'requesting', 'cancel_requested'],
  requesting: ['receiving', 'retry_wait', 'blocked', 'cancel_requested', 'outcome_unknown'],
  receiving: ['persisting', 'retry_wait', 'blocked', 'cancel_requested', 'outcome_unknown'],
  persisting: ['succeeded', 'blocked', 'cancel_requested', 'outcome_unknown'],
  succeeded: [],
  retry_wait: ['pending', 'failed', 'cancel_requested'],
  blocked: ['pending', 'failed', 'cancel_requested'],
  cancel_requested: ['cancelled', 'outcome_unknown'],
  cancelled: [],
  outcome_unknown: ['failed'],
  failed: ['pending']
};

export class StateTransitionError extends Error {
  readonly entity: 'run' | 'run_item';
  readonly from: string;
  readonly to: string;

  constructor(entity: 'run' | 'run_item', from: string, to: string) {
    super('Invalid ' + entity + ' transition: ' + from + ' -> ' + to);
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRun(from, to)) throw new StateTransitionError('run', from, to);
}

export function canTransitionRunItem(from: RunItemStatus, to: RunItemStatus): boolean {
  return RUN_ITEM_TRANSITIONS[from].includes(to);
}

export function assertRunItemTransition(from: RunItemStatus, to: RunItemStatus): void {
  if (!canTransitionRunItem(from, to)) throw new StateTransitionError('run_item', from, to);
}
