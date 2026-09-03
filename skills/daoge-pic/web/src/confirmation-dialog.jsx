import { CircleAlert, LoaderCircle } from 'lucide-react';
import { AccessibleDialog } from './accessible-dialog.jsx';

export function ConfirmationDialog({ label, title, message, confirmLabel, busy = false, error = '', tone = 'danger', onCancel, onConfirm }) {
  const dismiss = () => { if (!busy) onCancel(); };
  return <AccessibleDialog className="confirmation-dialog" label={label} onDismiss={dismiss}>
    <div className="confirmation-dialog-body">
      <span className={'confirmation-dialog-icon is-' + tone}><CircleAlert size={20} /></span>
      <div className="confirmation-dialog-copy"><p className="eyebrow">需要确认</p><h2>{title}</h2><p>{message}</p></div>
    </div>
    {error && <div className="confirmation-dialog-error" role="alert"><CircleAlert size={15} /><span>{error}</span></div>}
    <footer className="confirmation-dialog-actions">
      <button type="button" className="outline-button" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" className={'command-button confirmation-dialog-confirm is-' + tone} disabled={busy} onClick={() => void onConfirm()}>{busy ? <><LoaderCircle className="spin" size={15} />正在处理</> : confirmLabel}</button>
    </footer>
  </AccessibleDialog>;
}
