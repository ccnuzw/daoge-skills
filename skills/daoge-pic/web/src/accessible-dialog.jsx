import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { createDialogBackgroundSession, createDialogFocusSession } from './accessible-dialog-model.mjs';

export function AccessibleDialog({ label, onDismiss, className, children }) {
  const dialogRef = useRef(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const backgroundSession = createDialogBackgroundSession(document.getElementById('root'));
    const focusSession = createDialogFocusSession({
      dialog: dialogRef.current,
      activeElement: () => document.activeElement instanceof HTMLElement ? document.activeElement : null,
      dismiss: () => dismissRef.current()
    });
    backgroundSession.mount();
    focusSession.mount();
    return () => { backgroundSession.dispose(); focusSession.dispose(); };
  }, []);

  return createPortal(<div className="accessible-dialog-layer"><button type="button" className="accessible-dialog-backdrop" tabIndex={-1} aria-label="关闭对话框" onClick={() => dismissRef.current()} /><div ref={dialogRef} className={'accessible-dialog ' + (className || '')} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>{children}</div></div>, document.body);
}
