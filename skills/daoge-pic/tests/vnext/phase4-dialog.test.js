const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function fakeElement(name) {
  return { name, hidden: false, focused: false, focus() { this.focused = true; active.current = this; } };
}
const active = { current: null };

function fakeDialog(elements) {
  const listeners = new Map();
  return {
    focused: false,
    focus() { this.focused = true; active.current = this; },
    querySelectorAll() { return elements; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
    key(key, shiftKey = false) {
      let prevented = false;
      listeners.get('keydown')?.({ key, shiftKey, preventDefault() { prevented = true; } });
      return prevented;
    },
    listenerCount() { return listeners.size; }
  };
}

function fakeRoot() {
  const attributes = new Map();
  return {
    inert: false,
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    hasAttribute(name) { return attributes.has(name); },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); }
  };
}

test('dialog focus session traps Tab, dismisses Escape, and returns focus', async () => {
  const { createDialogFocusSession } = await import('../../web/src/accessible-dialog-model.mjs');
  const trigger = fakeElement('trigger');
  const first = fakeElement('first');
  const last = fakeElement('last');
  active.current = trigger;
  let dismissals = 0;
  const dialog = fakeDialog([first, last]);
  const session = createDialogFocusSession({ dialog, activeElement: () => active.current, dismiss: () => { dismissals += 1; } });
  session.mount();
  assert.equal(active.current, first);
  assert.equal(dialog.listenerCount(), 1);
  active.current = last;
  assert.equal(dialog.key('Tab'), true);
  assert.equal(active.current, first);
  active.current = first;
  assert.equal(dialog.key('Tab', true), true);
  assert.equal(active.current, last);
  assert.equal(dialog.key('Escape'), true);
  assert.equal(dismissals, 1);
  session.dispose();
  assert.equal(active.current, trigger);
  assert.equal(dialog.listenerCount(), 0);
});

test('AccessibleDialog rerender updates dismiss callback without resetting the mount-only focus session', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/accessible-dialog.jsx'), 'utf8');
  assert.match(source, /dismissRef\.current = onDismiss/);
  assert.match(source, /dismiss: \(\) => dismissRef\.current\(\)/);
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*?\}, \[\]\)/);
});

test('dialog background session hides and inerts the app root, then restores its prior state', async () => {
  const { createDialogBackgroundSession } = await import('../../web/src/accessible-dialog-model.mjs');
  const root = fakeRoot();
  root.setAttribute('aria-hidden', 'false');
  const session = createDialogBackgroundSession(root);
  session.mount();
  assert.equal(root.inert, true);
  assert.equal(root.getAttribute('inert'), '');
  assert.equal(root.getAttribute('aria-hidden'), 'true');
  session.dispose();
  assert.equal(root.inert, false);
  assert.equal(root.hasAttribute('inert'), false);
  assert.equal(root.getAttribute('aria-hidden'), 'false');
});

test('AccessibleDialog uses a portal and a full-viewport dismissible backdrop', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/accessible-dialog.jsx'), 'utf8');
  const styles = fs.readFileSync(path.resolve(__dirname, '../../web/src/styles.css'), 'utf8');
  assert.match(source, /createPortal/);
  assert.match(source, /accessible-dialog-backdrop/);
  assert.match(source, /onClick=\{\(\) => dismissRef\.current\(\)\}/);
  assert.match(styles, /\.accessible-dialog-layer \{ position:fixed;[\s\S]*?inset:0/);
  assert.match(styles, /\.accessible-dialog-backdrop \{ position:absolute; inset:0;/);
});
