export function createDialogFocusSession({ dialog, activeElement, dismiss }) {
  const returnTarget = activeElement();
  const focusable = () => dialog ? [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hidden) : [];
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    const elements = focusable();
    if (!elements.length) {
      event.preventDefault();
      dialog?.focus();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    const current = activeElement();
    if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return {
    mount() {
      (focusable()[0] || dialog)?.focus();
      dialog?.addEventListener('keydown', onKeyDown);
    },
    dispose() {
      dialog?.removeEventListener('keydown', onKeyDown);
      returnTarget?.focus();
    }
  };
}

export function createDialogBackgroundSession(appRoot) {
  const previousAriaHidden = appRoot?.getAttribute('aria-hidden');
  const hadInertAttribute = appRoot?.hasAttribute('inert');
  const previousInert = Boolean(appRoot?.inert);
  return {
    mount() {
      if (!appRoot) return;
      appRoot.inert = true;
      appRoot.setAttribute('inert', '');
      appRoot.setAttribute('aria-hidden', 'true');
    },
    dispose() {
      if (!appRoot) return;
      appRoot.inert = previousInert;
      if (hadInertAttribute) appRoot.setAttribute('inert', '');
      else appRoot.removeAttribute('inert');
      if (previousAriaHidden === null) appRoot.removeAttribute('aria-hidden');
      else appRoot.setAttribute('aria-hidden', previousAriaHidden);
    }
  };
}
