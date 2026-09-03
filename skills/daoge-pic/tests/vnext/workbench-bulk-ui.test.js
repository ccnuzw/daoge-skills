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
