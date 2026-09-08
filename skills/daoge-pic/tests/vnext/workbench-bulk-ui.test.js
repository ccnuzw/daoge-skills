const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

test('project assets expose page selection, configurable pagination, and multi-file import', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  assert.match(main, /全选本页/);
  assert.match(main, /取消全选本页/);
  assert.match(main, /ASSET_PAGE_SIZES/);
  assert.match(main, /type="file" multiple/);
  assert.match(main, /Array\.from\(files \|\| \[\]\)/);
  assert.match(main, /正在导入.*completed.*total/);
});

test('delivery page exposes a visible all-images selection action', () => {
  const delivery = fs.readFileSync(path.join(skillRoot, 'web/src/creator-delivery.jsx'), 'utf8');
  assert.match(delivery, /全选全部.*assets\.length.*张/);
  assert.match(delivery, /取消全选/);
  assert.match(delivery, /打包下载.*selected\.length.*张/);
});

test('image preview can select deliverables and the selection strip keeps removal compact', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  assert.match(main, /inspector-select-control/);
  assert.match(main, /onChange=\{\(\) => void markAsDeliverable\(asset\)\}/);
  assert.match(main, /className="selection-item"/);
  assert.match(main, /className="selection-item-copy"/);
  assert.match(styles, /\.selection-strip-items article > button\.selection-remove \{ position:absolute; top:7px; right:7px;.*width:24px; height:24px;/);
  assert.match(styles, /\.selection-strip-items article\.selection-item \{[^}]*padding:6px 40px 6px 6px;/);
});

test('Workbench confirmations use the shared accessible modal instead of native dialogs', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const provider = fs.readFileSync(path.join(skillRoot, 'web/src/provider-settings.jsx'), 'utf8');
  const confirmation = fs.readFileSync(path.join(skillRoot, 'web/src/confirmation-dialog.jsx'), 'utf8');
  assert.doesNotMatch(main + provider, /window\.(?:alert|confirm|prompt)|\b(?:alert|confirm|prompt)\s*\(/);
  assert.match(main, /<ConfirmationDialog/);
  assert.match(main, /归档后将关闭该项目下的任务与轮次/);
  assert.match(main, /这张图片仍被选择、资料库或交付引用/);
  assert.match(provider, /<ConfirmationDialog/);
  assert.match(confirmation, /<AccessibleDialog/);
  assert.match(confirmation, /confirmation-dialog-actions/);
});

test('Workbench suppresses only injected diagnostics startTime errors', async () => {
  const { isInjectedDiagnosticsStartTimeError } = await import('../../web/src/browser-error-guard.mjs');
  assert.equal(isInjectedDiagnosticsStartTimeError({
    message: "Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')",
    filename: 'VM190',
    error: { stack: "TypeError: Cannot read properties of undefined (reading 'startTime')\n    at et.reportAllChanges (<anonymous>:2:19429)" }
  }), true);
  assert.equal(isInjectedDiagnosticsStartTimeError({
    message: "Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')",
    filename: '/assets/index.js',
    error: { stack: "TypeError: Cannot read properties of undefined (reading 'startTime')\n    at reportAllChanges (/assets/index.js:2:10)" }
  }), false);
  assert.equal(isInjectedDiagnosticsStartTimeError({
    message: "Cannot read properties of undefined (reading 'id')",
    error: { stack: "TypeError\n    at et.reportAllChanges (<anonymous>:2:19429)" }
  }), false);
});

test('Workbench guards injected diagnostics timer callbacks without hiding app errors', async () => {
  const { installBrowserErrorGuard } = await import('../../web/src/browser-error-guard.mjs');
  const listeners = new Map();
  const target = {
    onerror: null,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    setTimeout(callback, delay, ...args) { this.pendingTimeout = { callback, delay, args }; return 1; },
    setInterval(callback, delay, ...args) { this.pendingInterval = { callback, delay, args }; return 2; }
  };
  const restore = installBrowserErrorGuard(target);
  const injectedError = new TypeError("Cannot read properties of undefined (reading 'startTime')");
  injectedError.stack = "TypeError: Cannot read properties of undefined (reading 'startTime')\n    at et.reportAllChanges (<anonymous>:2:19429)";
  target.setTimeout(() => { throw injectedError; }, 10);
  assert.doesNotThrow(() => target.pendingTimeout.callback());
  target.setTimeout(() => { throw new TypeError("Cannot read properties of undefined (reading 'id')"); }, 10);
  assert.throws(() => target.pendingTimeout.callback(), /reading 'id'/);
  const event = { message: "Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')", filename: 'VM84', preventDefaultCalled: false, stopped: false, preventDefault() { this.preventDefaultCalled = true; }, stopImmediatePropagation() { this.stopped = true; } };
  listeners.get('error')(event);
  assert.equal(event.preventDefaultCalled, true);
  assert.equal(event.stopped, true);
  assert.equal(target.onerror(event.message, event.filename, 2, 19429, null), true);
  restore();
});

test('lineage canvas preserves group soft links as layout endpoints', () => {
  const lineage = fs.readFileSync(path.join(skillRoot, 'web/src/creative-lineage-canvas.jsx'), 'utf8');
  assert.match(lineage, /endpointByKey/);
  assert.match(lineage, /nodeKey\('group', rendered\.id\)/);
  assert.match(lineage, /payloadEndpointKeys/);
  assert.doesNotMatch(lineage, /payloadNodeKeys\.has\(nodeKey\(link\.sourceType, link\.sourceId\)\) && payloadNodeKeys\.has/);
});

test('lineage canvas exposes complete data loading and keyboard-accessible overlays', () => {
  const lineage = fs.readFileSync(path.join(skillRoot, 'web/src/creative-lineage-canvas.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  assert.match(main, /runItems=\{lineageVisibleRunItems\}/);
  assert.match(main, /runItemCoverage=\{lineageRunItemCoverage\}/);
  assert.match(main, /loadCompleteLineageAssets\(route/);
  assert.match(lineage, /assetCountLabel/);
  assert.match(lineage, /runItemCountLabel/);
  assert.match(lineage, /role="combobox"/);
  assert.match(lineage, /aria-activedescendant=\{activeSearchOptionId\}/);
  assert.match(lineage, /role="listbox"/);
  assert.match(lineage, /role="option"/);
  assert.match(lineage, /const menuRef = useRef\(null\)/);
  assert.match(lineage, /event\.key === 'Escape'/);
  assert.match(lineage, /event\.key === 'ArrowDown'/);
  assert.match(lineage, /return <article role="button" tabIndex=\{0\}/);
  assert.match(lineage, /event\.key === 'Enter'/);
  assert.match(lineage, /event\.key === 'ContextMenu'/);
  assert.match(styles, /\.lineage-node:focus-visible/);
});

test('Workbench renders route context errors as live alerts', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  assert.match(main, /contextError && <div className="error-strip" role="alert" aria-live="assertive"/);
  assert.match(main, /关闭上下文错误/);
});
