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
  assert.match(source, /获取模型/);
  assert.match(source, /\/api\/provider-models/);
  assert.doesNotMatch(source, /action\('models'\)/);
  assert.doesNotMatch(source, /\/api\/providers\/[^']+\/models/);
  assert.doesNotMatch(source, /mode === 'edit' && <button type="button" className="outline-button provider-model-fetch"/);
  assert.match(source, /provider-actions-grid/);
  assert.match(source, /provider-model-picker/);
  assert.match(source, /活动配置会自动热加载/);
  assert.match(source, /端点信任模式/);
  assert.match(source, /Profile 级安全限额/);
  assert.match(source, /连接测试会访问 Provider 但不生成图片/);
  assert.match(source, /Descriptor v/);
  assert.doesNotMatch(source, /window\.(?:alert|confirm|prompt)/);
  assert.match(source, /<ConfirmationDialog/);
  assert.match(source, /删除 Profile“/);
  assert.match(source, /清除连接信息会让该 Profile 暂时不可用/);
  assert.match(source, /aria-label="Provider Profile 列表"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /providerConcurrency\.target/);
  assert.match(source, /reconfigurationPending/);
  assert.doesNotMatch(source, /重启前拒绝提交新运行/);
  assert.doesNotMatch(source, /保存并重启/);
  assert.match(source, /aria-live="polite"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  // The three-command hint box is gone on purpose. It was a dead-end: it told the operator to leave the page and
  // run `daoge provider-validate | provider-test | provider-models` by hand, and because the three commands were
  // rendered as adjacent inline <code> elements they also copied out as one un-runnable string. The buttons
  // themselves now perform the action in the browser, so there is nothing left to copy and no fallback to show.
  assert.doesNotMatch(source, /provider-cli-commands/);
  assert.doesNotMatch(source, /copyCliCommand/);
  // NB: do not assert the absence of `provider-restart-note` — that class still carries the legitimate
  // endpoint-policy warning and hot-reload notices. Only the CLI hint block was removed.
  assert.doesNotMatch(source, /daemon 只接受本地 Skill\/CLI 调用/);
  assert.doesNotMatch(source, /Workbench 不代持密钥/);
  assert.doesNotMatch(source, /navigator\.clipboard/);
  assert.doesNotMatch(source, /<\/code><code>/);
  // A disabled button with no onClick swallows the click silently: the operator concludes the
  // control is broken. These three controls must stay enabled and actually perform their action
  // from the Workbench (the daemon accepts same-origin cookie callers for them).
  assert.match(source, /onClick=\{\(\) => void performAction\('validate'\)\}/);
  assert.match(source, /onClick=\{\(\) => void performAction\('test'\)\}/);
  assert.match(source, /onClick=\{\(\) => void loadModels\(\)\}/);
  assert.doesNotMatch(source, /disabled title="涉及 Provider 凭据/, 'credential-only buttons must not sit silently disabled');
  assert.doesNotMatch(source, /PROVIDER_SKILL_ONLY_ACTIONS/, 'the Workbench no longer treats these actions as CLI-only');
});

test('Provider edit model preserves projected Provider metadata and limits', async () => {
  const { createProviderEditForm, descriptorForProvider, normalizeProfileLimits } = await import('../../web/src/provider-settings-model.mjs');
  const profile = { name: 'Gemini', providerId: 'gemini-image', model: 'gemini-image-model', endpointTrustMode: 'official', limits: { maxRunItems: 2 }, referenceEnabled: true };
  const form = createProviderEditForm(profile);
  assert.equal(form.referenceEnabled, true);
  assert.equal(form.endpointTrustMode, 'official');
  assert.equal(form.limits.maxRunItems, 2);
  assert.deepEqual(normalizeProfileLimits({ maxRunItems: '2', maxExecutionConcurrency: '', requestTimeoutMs: '45000' }), { maxRunItems: 2, requestTimeoutMs: 45000 });
  assert.equal(descriptorForProvider([{ id: 'gemini-image' }], 'gemini-image').id, 'gemini-image');
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/provider-settings.jsx'), 'utf8');
  assert.match(source, /compatible_public[\s\S]*必须 HTTPS/);
  assert.doesNotMatch(source, /compatible_public[\s\S]*建议 HTTPS/);
  assert.doesNotMatch(source, /optionKeys\.includes\(['"]referenceEnabled['"]\)/);
});
