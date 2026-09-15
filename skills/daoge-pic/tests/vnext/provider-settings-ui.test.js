const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource } = require('./source-text');

test('Provider settings UI keeps secrets write-only and exposes accessible explicit actions', () => {
  const source = readFrontendSource();
  assert.match(source, /type="password"/);
  assert.match(source, /autoComplete="new-password"/);
  assert.match(source, /Base URL 更新/);
  assert.match(source, /keep.*replace.*clear/s);
  assert.match(source, /本地校验/);
  assert.match(source, /连接测试/);
  assert.match(source, /获取模型/);
  assert.match(source, /\/api\/provider-models/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /action\('models'\)/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /\/api\/providers\/[^']+\/models/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /mode === 'edit' && <button type="button" className="outline-button provider-model-fetch"/);
  assert.match(source, /provider-actions-grid/);
  assert.match(source, /provider-model-picker/);
  // 「热加载」是 daemon 的实现细节；人话说法是「后台自动换用新配置」，措辞变了但语义不变。
  assert.match(source, /后台会自动换用新配置/);
  assert.match(source, /端点信任模式/);
  assert.match(source, /Profile 级安全限额/);
  assert.match(source, /连接测试会真的访问生成服务，但不会出图/);
  assert.match(source, /Descriptor v/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /window\.(?:alert|confirm|prompt)/);
  assert.match(source, /<ConfirmationDialog/);
  assert.match(source, /profileName \+ '”正在使用中/);
  assert.match(source, /清除连接信息后，这一组暂时用不了/);
  assert.match(source, /aria-label="配置列表"/);
  assert.match(source, /role="alert"/);
  assert.match(source, /providerConcurrency\.target/);
  assert.match(source, /reconfigurationPending/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /重启前拒绝提交新运行/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /保存并重启/);
  assert.match(source, /aria-live="polite"/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /localStorage|sessionStorage/);
  // The three-command hint box is gone on purpose. It was a dead-end: it told the operator to leave the page and
  // run `daoge provider-validate | provider-test | provider-models` by hand, and because the three commands were
  // rendered as adjacent inline <code> elements they also copied out as one un-runnable string. The buttons
  // themselves now perform the action in the browser, so there is nothing left to copy and no fallback to show.
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /provider-cli-commands/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /copyCliCommand/);
  // NB: do not assert the absence of `provider-restart-note` — that class still carries the legitimate
  // endpoint-policy warning and hot-reload notices. Only the CLI hint block was removed.
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /daemon 只接受本地 Skill\/CLI 调用/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /Workbench 不代持密钥/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /navigator\.clipboard/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /<\/code><code>/);
  // A disabled button with no onClick swallows the click silently: the operator concludes the
  // control is broken. These three controls must stay enabled and actually perform their action
  // from the Workbench (the daemon accepts same-origin cookie callers for them).
  assert.match(source, /onClick=\{\(\) => void performAction\('validate'\)\}/);
  assert.match(source, /onClick=\{\(\) => void performAction\('test'\)\}/);
  assert.match(source, /onClick=\{\(\) => void loadModels\(\)\}/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /disabled title="涉及 Provider 凭据/, 'credential-only buttons must not sit silently disabled');
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /PROVIDER_SKILL_ONLY_ACTIONS/, 'the Workbench no longer treats these actions as CLI-only');
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
  const source = readFrontendSource();
  assert.match(source, /compatible_public[\s\S]*必须 HTTPS/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /compatible_public[\s\S]*建议 HTTPS/);
  assert.doesNotMatch(readSource('web/src/provider-settings.jsx'), /optionKeys\.includes\(['"]referenceEnabled['"]\)/);
});
