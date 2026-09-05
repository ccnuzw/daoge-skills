const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('Provider settings UI keeps secrets write-only and exposes accessible explicit actions', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/provider-settings.jsx'), 'utf8');
  assert.match(source, /type="password"/);
  assert.match(source, /autoComplete="new-password"/);
  assert.match(source, /Base URL 更新/);
  assert.match(source, /keep.*replace.*clear/s);
  assert.match(source, /本地校验/);
  assert.match(source, /连接测试/);
  assert.match(source, /保存并重启/);
  assert.doesNotMatch(source, /window\.(?:alert|confirm|prompt)/);
  assert.match(source, /<ConfirmationDialog/);
  assert.match(source, /删除 Profile“/);
  assert.match(source, /清除连接信息会让该 Profile 暂时不可用/);
  assert.match(source, /aria-label="Provider Profile 列表"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /providerConcurrency\.target/);
  assert.match(source, /aria-live="polite"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});

test('Provider edit model preserves the projected referenceEnabled boolean', async () => {
  const { createProviderEditForm } = await import('../../web/src/provider-settings-model.mjs');
  const profile = { name: 'Gemini', providerId: 'gemini-image', model: 'gemini-image-model' };
  assert.equal(createProviderEditForm({ ...profile, referenceEnabled: false }).referenceEnabled, false);
  assert.equal(createProviderEditForm({ ...profile, referenceEnabled: true }).referenceEnabled, true);
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/provider-settings.jsx'), 'utf8');
  assert.doesNotMatch(source, /optionKeys\.includes\(['"]referenceEnabled['"]\)/);
});
