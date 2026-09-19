import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, Copy, KeyRound, LoaderCircle, Plus, Power, RefreshCw, Server, ShieldCheck, Trash2, X } from 'lucide-react';
import { AccessibleDialog } from './accessible-dialog.jsx';
import { ConfirmationDialog } from './confirmation-dialog.jsx';
import { createProviderEditForm, descriptorForProvider, normalizeProfileLimits } from './provider-settings-model.mjs';
import { profileChangeNeedsTest } from './provider-connection-model.mjs';
import { CONFIG_FACE_INTRO, CONFIG_GLOSSARY_COPY, CONFIG_TERM_GLOSSARY, configFieldHint } from './config-face-copy.mjs';

const FALLBACK_PROVIDERS = [
  { id: 'openai-images', displayName: 'OpenAI Images', endpoint: { defaultTrustMode: 'compatible_public', examples: ['https://api.openai.com/v1'], help: 'OpenAI Images 或兼容 /v1 images endpoint。' }, reference: { supported: true, maxCount: 8 }, mask: { supported: true }, operations: { generate: true, edit: true }, modelExamples: ['gpt-image-2'] },
  { id: 'gemini-image', displayName: 'Gemini Image', endpoint: { defaultTrustMode: 'compatible_public', examples: ['https://generativelanguage.googleapis.com'], help: 'Gemini generateContent endpoint。' }, reference: { supported: true, maxCount: 8, enableOptionKey: 'referenceEnabled' }, mask: { supported: false }, operations: { generate: true, edit: true }, modelExamples: ['gemini-2.5-flash-image'] },
  { id: 'gemini-openai-compatible', displayName: 'Gemini OpenAI Compatible', endpoint: { defaultTrustMode: 'compatible_public', examples: ['https://your-gemini-compatible.example/v1'], help: 'OpenAI-compatible images endpoint。' }, reference: { supported: false, maxCount: 0 }, mask: { supported: false }, operations: { generate: true, edit: false }, modelExamples: ['gemini-2.5-flash-image'] },
  { id: 'xai-grok-image', displayName: 'xAI Grok Image', endpoint: { defaultTrustMode: 'compatible_public', examples: ['https://api.x.ai/v1'], help: 'xAI image endpoint。' }, reference: { supported: true, maxCount: 5 }, mask: { supported: false }, operations: { generate: true, edit: true }, modelExamples: ['grok-imagine-image'] }
];

const TRUST_MODES = [
  ['official', '官方端点', '要求 HTTPS 和官方 host。'],
  ['compatible_public', '公开兼容端点', '适合第三方兼容服务；必须 HTTPS。HTTP 请选择本地代理或企业内网。'],
  ['local_proxy', '本地代理', '允许把密钥发给本机代理。'],
  ['enterprise_private', '企业内网', '允许受控内网网关；HTTP 仅限明确企业私有信任模式。']
];

const TRUST_MODE_LABELS = Object.fromEntries(TRUST_MODES.map(([value, label]) => [value, label]));
const LIMIT_ROWS = [
  ['maxRunItems', '一次最多出几张', '未限制', ' 张'],
  ['maxExecutionConcurrency', '同时最多出几张', '未限制', ' 张'],
  ['requestTimeoutMs', '等多久算超时', '默认', ' 毫秒'],
  ['maxRetryAttempts', '失败后最多重试几次', '默认', ' 次']
];

/**
 * 连接测试优先探测 Provider 的**模型列表端点**（一个真正的带凭据请求，能同时证明 DNS、TLS 和密钥是否被接受，
 * 网关通常答 200）；只有该端点不存在（404/405）时才回退到生成端点探测。生成端点多数网关只接受 POST，
 * 拿它当探针会得到 404，于是健康的 Provider 也被报成「未通过」。按状态码分开表述，避免误导。
 */
function connectionTestFeedback(result) {
  const status = result?.status;
  if (!result?.connected) return '无法连接端点（HTTP ' + status + '）。请检查 Base URL、网络和访问权限。';
  if (status === 401 || status === 403) return '端点可达，但鉴权未通过（HTTP ' + status + '）。请检查 API Key。已记录脱敏测试证据。';
  if (status === 404 || status === 405) return '端点可达，但探测路径返回 HTTP ' + status + '（该网关可能未开放模型列表，且生成端点不接受探测请求）。已记录脱敏测试证据。';
  if (Number.isFinite(status) && status < 400) return '连接测试通过（HTTP ' + status + '）：模型列表端点应答正常，网络、TLS 与密钥均可用。已记录脱敏测试证据。';
  return '端点可达，返回 HTTP ' + status + '；请确认是否符合该 Provider 的预期。已记录脱敏测试证据。';
}

function secretUpdate(action, value) {
  return action === 'replace' ? { action, value } : { action };
}

function trustModeLabel(value) {
  return TRUST_MODE_LABELS[value] || value || 'compatible_public';
}

function formatLimitValue(value, fallback, suffix) {
  return Number.isInteger(value) && value > 0 ? value + suffix : fallback;
}

function runtimeReasonLabel(reason) {
  if (reason === 'rate_limited') return '服务在限流，先放慢出图';
  if (reason === 'memory_pressure') return '后台内存吃紧，先放慢出图';
  if (reason === 'transient' || reason === 'unknown') return '刚遇到临时故障，先放慢出图';
  if (reason === 'healthy') return '一切正常，正在逐步加快';
  return '启动预热中';
}

function CapabilityPill({ label, active, detail }) {
  return <li className={active ? 'is-supported' : 'is-muted'}>
    <span>{label}</span>
    <strong>{detail}</strong>
  </li>;
}

function ProviderCapabilityCard({ descriptor, profile, modelCapability = null }) {
  if (!descriptor) return null;
  const referenceEnabled = profile ? profile.referenceEnabled : descriptor.reference?.defaultEnabled === true;
  const referenceActive = descriptor.reference?.supported && referenceEnabled;
  // P2：「支持」≠「当前模型能用」。有运行时态时，把它说清楚（含不可用的原因）。
  const runtimeEntries = modelCapability?.capabilities ? Object.entries(modelCapability.capabilities) : [];
  const runtimeUnavailable = runtimeEntries.filter(([, value]) => value && value.available === false && value.reason);
  return <section className="provider-card provider-capability-card" aria-label="生成服务能力摘要">
    <header><ShieldCheck size={16} /><div><strong>{descriptor.displayName} 能力</strong><span>Descriptor v{descriptor.descriptorVersion || 1} · Adapter {descriptor.adapterVersion || 'http-image-v1'}</span></div></header>
    <p className="provider-card-note">下面这份清单由服务自己申报，标明它支持哪些功能；看不懂也不影响使用。</p>
    <ul>
      <CapabilityPill label="文生图" active={descriptor.operations?.generate} detail={descriptor.operations?.generate ? '支持' : '不支持'} />
      <CapabilityPill label="参考图" active={referenceActive} detail={referenceActive ? '最多 ' + descriptor.reference.maxCount + ' 张' : descriptor.reference?.supported ? '可开启' : '不支持'} />
      <CapabilityPill label="遮罩" active={descriptor.mask?.supported} detail={descriptor.mask?.supported ? '支持' : '不支持'} />
      <CapabilityPill label="编辑" active={descriptor.operations?.edit} detail={descriptor.operations?.edit ? '支持' : '不支持'} />
    </ul>
    {modelCapability && <p className="provider-card-note provider-runtime-capability">当前模型 <b>{modelCapability.model}</b>：{modelCapability.applied ? '配置已生效' : '配置还没生效（后台正在切换）'}{runtimeUnavailable.length ? '；' + runtimeUnavailable.map(([, value]) => value.reason).join(' ') : '；上面这些能力此刻都可用。'}</p>}
  </section>;
}

function ProviderLimitSummary({ limits = {} }) {
  return <section className="provider-card provider-limit-summary" aria-label="这组配置的用量上限">
    <header><span>这组配置的用量上限</span><small>留空就用默认值</small></header>
    <p className="provider-card-note">{configFieldHint('limits')}</p>
    <dl>
      {LIMIT_ROWS.map(([key, label, fallback, suffix]) => <div key={key}>
        <dt>{label}</dt>
        <dd>{formatLimitValue(limits[key], fallback, suffix)}</dd>
      </div>)}
    </dl>
  </section>;
}

function ProviderModelButton({ model, selected = false, onChoose }) {
  const id = String(model?.id || '').trim();
  const label = String(model?.label || id || '未命名模型').trim();
  const ownedBy = String(model?.ownedBy || '').trim();
  const title = id && id !== label ? label + ' · ' + id : label;
  return <button type="button" title={title} onClick={() => onChoose(id || label)} className={selected ? 'is-selected' : ''}>
    <strong>{label}</strong>
    {id && id !== label ? <span className="provider-model-id">{id}</span> : null}
    {ownedBy && <small>{ownedBy}</small>}
  </button>;
}

function ConfigGlossaryPanel() {
  return <details className="provider-secondary-panel provider-glossary-panel">
    <summary><span><strong>{CONFIG_GLOSSARY_COPY.summary}</strong><small>{CONFIG_GLOSSARY_COPY.note}</small></span><em>{CONFIG_GLOSSARY_COPY.foldLabel}</em></summary>
    <dl className="provider-glossary-list">
      {CONFIG_TERM_GLOSSARY.map(([term, plain]) => <div key={term}><dt>{term}</dt><dd>{plain}</dd></div>)}
    </dl>
  </details>;
}

/** 限额字段：[表单字段名, 给创作者看的名字, 允许的最大值, 输入框提示]。 */
const LIMIT_FIELDS = /** @type {Array<[string, string, number, string]>} */ ([
  ['maxRunItems', '一次最多出几张', 1000, '最多 1000'],
  ['maxExecutionConcurrency', '同时最多出几张', 1000, '最多 1000'],
  ['requestTimeoutMs', '等多久算超时（毫秒）', 600000, '120000'],
  ['maxRetryAttempts', '失败后最多重试几次', 20, '默认 4']
]);

export function ProviderSettings({ request, onDismiss, onChanged }) {
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('idle');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [modelPicker, setModelPicker] = useState({ profileId: null, models: [] });
  const descriptors = data?.descriptors?.length ? data.descriptors : FALLBACK_PROVIDERS;
  const selected = useMemo(() => data?.profiles?.find((profile) => profile.id === selectedId) || null, [data, selectedId]);
  const selectedDescriptor = selected ? descriptorForProvider(descriptors, selected.providerId) : null;
  const activeDescriptor = descriptorForProvider(descriptors, form?.providerId || selected?.providerId || 'openai-images');

  const load = async () => {
    setError('');
    const next = await request('/api/providers');
    setData(next);
    setSelectedId((current) => next.profiles.some((profile) => profile.id === current) ? current : next.profiles[0]?.id || null);
    return next;
  };

  useEffect(() => { void load().catch((nextError) => setError(nextError.message || '读不到生成服务的配置。')); }, []);

  const beginCreate = () => {
    const descriptor = descriptorForProvider(descriptors, 'openai-images') || descriptors[0];
    setFeedback(''); setModelPicker({ profileId: null, models: [] });
    setMode('create');
    setForm({ name: '', providerId: descriptor.id, model: '', baseUrl: '', apiKey: '', endpointTrustMode: descriptor.endpoint?.defaultTrustMode || 'compatible_public', referenceEnabled: descriptor.reference?.defaultEnabled === true, limits: { maxRunItems: '', maxExecutionConcurrency: '', requestTimeoutMs: '', maxRetryAttempts: '' }, active: !data?.profiles?.some((profile) => profile.active) });
  };
  const beginEdit = () => {
    if (!selected) return;
    setFeedback(''); setModelPicker({ profileId: null, models: [] });
    setMode('edit');
    setForm(createProviderEditForm(selected));
  };
  const cancelEdit = () => { setMode('idle'); setForm(null); setError(''); };
  const setLimit = (key, value) => setForm({ ...form, limits: { ...(form.limits || {}), [key]: value } });
  const setProviderId = (providerId) => {
    const descriptor = descriptorForProvider(descriptors, providerId);
    setModelPicker({ profileId: null, models: [] });
    setForm({ ...form, providerId, endpointTrustMode: descriptor?.endpoint?.defaultTrustMode || form.endpointTrustMode || 'compatible_public', referenceEnabled: descriptor?.reference?.defaultEnabled === true });
  };

  const localError = () => {
    if (!form?.name.trim()) return '请给这一组起个名字。';
    if (!form?.model.trim()) return '请输入模型名称。';
    if (mode === 'create' && !form.baseUrl.trim()) return '请填写完整的服务地址（Base URL）。';
    if (mode === 'create' && !form.apiKey.trim()) return '请填写 API Key（调用密钥）。';
    if (mode === 'edit' && form.baseUrlAction === 'replace' && !form.baseUrl.trim()) return '请填写新的完整服务地址（Base URL）。';
    if (mode === 'edit' && form.apiKeyAction === 'replace' && !form.apiKey.trim()) return '请填写新的 API Key（调用密钥）。';
    try { if (mode === 'create' || form.baseUrlAction === 'replace') new URL(form.baseUrl); } catch { return 'Base URL 格式无效。'; }
    for (const [key, label, max] of LIMIT_FIELDS) {
      const raw = form.limits?.[key];
      if (raw !== '' && raw !== undefined && raw !== null) {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1 || value > max) return label + '要填 1 到 ' + max + ' 之间的整数。';
      }
    }
    return '';
  };

  /**
   * P1 配置即测：保存 / 切换后**自动测一次**（「配完就安心」）。
   * 失败也要有一句话——不能静默；测的是 HTTP 端点，不起额外进程。
   */
  const autoTest = async (profileId) => {
    if (!profileId) return '';
    try {
      const result = await request('/api/providers/' + encodeURIComponent(profileId) + '/test', { method: 'POST', idempotencyKey: crypto.randomUUID(), body: {} });
      return '自动连接测试：' + connectionTestFeedback(result);
    } catch (nextError) {
      return '自动连接测试没成功：' + (nextError.message || '请手动测一次。');
    }
  };
  const persistSave = async () => {
    setBusy('save'); setError(''); setFeedback('');
    try {
      const limits = normalizeProfileLimits(form.limits);
      const previousIdentity = mode === 'edit' && selected ? selected : null;
      const secretReplaced = mode === 'edit' && (form.baseUrlAction === 'replace' || form.apiKeyAction === 'replace');
      const saved = mode === 'create'
        ? await request('/api/providers', { method: 'POST', idempotencyKey: crypto.randomUUID(), body: { name: form.name, providerId: form.providerId, model: form.model, baseUrl: form.baseUrl, apiKey: form.apiKey, endpointTrustMode: form.endpointTrustMode, options: { referenceEnabled: form.referenceEnabled }, limits, active: form.active } })
        : await request('/api/providers/' + encodeURIComponent(selected.id), { method: 'PUT', idempotencyKey: crypto.randomUUID(), body: { expectedConfigVersion: selected.configVersion, name: form.name, providerId: form.providerId, model: form.model, baseUrl: secretUpdate(form.baseUrlAction, form.baseUrl), apiKey: secretUpdate(form.apiKeyAction, form.apiKey), endpointTrustMode: form.endpointTrustMode, options: { referenceEnabled: form.referenceEnabled }, limits } });
      setForm(null); setMode('idle'); setModelPicker({ profileId: null, models: [] });
      await load();
      await onChanged();
      let feedback = '配置已保存；后台会自动换用新配置。之前已经算过的，需要重新算一次再出图。';
      const nextIdentity = { profileId: saved?.id || previousIdentity?.id || null, configVersion: saved?.configVersion ?? previousIdentity?.configVersion ?? 0, providerId: form.providerId, model: form.model, secretChanged: secretReplaced };
      if (profileChangeNeedsTest(previousIdentity, nextIdentity)) feedback += ' ' + await autoTest(nextIdentity.profileId);
      setFeedback(feedback);
    } catch (nextError) { setError(nextError.message || '保存失败，配置没有改动。'); }
    finally { setBusy(''); }
  };
  const save = async () => {
    const invalid = localError();
    if (invalid) { setError(invalid); return; }
    if (mode === 'edit' && (form.baseUrlAction === 'clear' || form.apiKeyAction === 'clear')) {
      setConfirmation({ kind: 'clear' });
      return;
    }
    await persistSave();
  };

  const performAction = async (name, target = selected, body = {}) => {
    if (!target) return;
    setBusy(name); setError(''); setFeedback('');
    try {
      const suffix = name === 'copy' ? '/copy' : name === 'activate' ? '/activate' : name === 'delete' ? '/delete' : '/' + name;
      const result = await request('/api/providers/' + encodeURIComponent(target.id) + suffix, { method: 'POST', idempotencyKey: crypto.randomUUID(), body });
      if (name === 'validate') setFeedback(result.valid ? '本地校验通过。未发起网络连接。' + (result.warnings?.length ? ' 提示：' + result.warnings.join('；') : '') : '本地校验未通过：' + result.missing.join('、'));
      else if (name === 'test') setFeedback(connectionTestFeedback(result));
      else {
        await load(); await onChanged();
        if (name === 'activate') setFeedback('已经改用这一组；后台会自动切换，之后的出图都用它。 ' + await autoTest(target.id));
        else setFeedback(name === 'copy' ? '已复制这一组，副本默认不启用。' : (result.impact?.message || '配置已删除。'));
      }
    } catch (nextError) { setError(nextError.message || '操作失败，请重试。'); }
    finally { setBusy(''); }
  };
  const loadModels = async () => {
    const pickerKey = form ? (mode === 'create' ? 'create' : selected?.id || null) : null;
    if (!form || !pickerKey) return;
    setBusy('models'); setError(''); setFeedback('');
    try {
      const path = '/api/provider-models';
      const descriptor = descriptorForProvider(descriptors, form.providerId);
      const model = form.model || descriptor?.modelExamples?.[0] || '';
      const options = { referenceEnabled: form.referenceEnabled };
      const replacingBaseUrl = mode === 'edit' && form.baseUrlAction === 'replace' && Boolean(form.baseUrl.trim());
      const replacingApiKey = mode === 'edit' && form.apiKeyAction === 'replace' && Boolean(form.apiKey.trim());
      let body;
      if (mode === 'create') {
        if (!form.baseUrl.trim()) throw new Error('请先填写服务地址（Base URL），再获取模型列表。');
        if (!form.apiKey.trim()) throw new Error('请先填写 API Key，再获取模型列表。');
        // 草稿：直接用表单里填的端点与密钥去问 Provider，不落库。
        body = { providerId: form.providerId, model, baseUrl: form.baseUrl, apiKey: form.apiKey, endpointTrustMode: form.endpointTrustMode, options };
      } else if (form.baseUrlAction === 'clear' || form.apiKeyAction === 'clear') {
        throw new Error('清除连接信息后无法读取模型列表。');
      } else if (replacingBaseUrl && replacingApiKey) {
        // 表单里同时换了端点和密钥：按草稿测试这组新值。
        body = { providerId: form.providerId, model, baseUrl: form.baseUrl, apiKey: form.apiKey, endpointTrustMode: form.endpointTrustMode, options };
      } else if (replacingBaseUrl) {
        // 只换端点不换密钥是问不出模型列表的：已存密钥只在 Profile 自己配置的端点上使用，
        // 而任何别的端点都必须带上新密钥。与其发一个注定被拒（或发错端点）的请求，不如直接说清楚。
        throw new Error('换了服务地址（Base URL）还要填新的 API Key，才能用新地址获取模型列表。');
      } else if (replacingApiKey) {
        // 只换密钥：端点仍然用 Profile 自己配置的，只是拿新密钥去问。
        body = { profileId: selected.id, model, apiKey: form.apiKey, options };
      } else {
        // 其余情况一律只带 profileId，让服务端用 Profile 已保存的端点与密钥。
        // 之前这里无条件带上 providerId / endpointTrustMode，会被判成「覆盖端点」而要求新密钥 → 永远 400。
        body = { profileId: selected.id, model, options };
      }
      const result = await request(path, { method: 'POST', idempotencyKey: crypto.randomUUID(), body });
      const models = Array.isArray(result.models) ? result.models : [];
      setModelPicker({ profileId: pickerKey, models });
      setFeedback(models.length ? '已读取 ' + models.length + ' 个模型：' + models.map((entry) => entry.id).join('、') + '。选择后保存配置生效。' : '服务没有返回可用模型；可以直接手填模型名。');
    } catch (nextError) { setError(nextError.message || '读不到模型列表，请检查地址和密钥。'); }
    finally { setBusy(''); }
  };
  const chooseModel = (modelId) => {
    if (!modelId || !form) return;
    setForm({ ...form, model: modelId });
  };
  const action = async (name) => {
    if (!selected) return;
    if (name === 'delete') {
      setConfirmation({ kind: 'delete', profileId: selected.id, profileName: selected.name, force: selected.active, active: selected.active });
      return;
    }
    await performAction(name);
  };
  const confirmPendingAction = async () => {
    if (!confirmation) return;
    const pending = confirmation;
    setConfirmation(null);
    if (pending.kind === 'delete') await performAction('delete', { id: pending.profileId, name: pending.profileName }, { force: pending.force === true });
    else await persistSave();
  };

  const providerCount = data?.profiles?.length || 0;
  const runtimeConcurrency = selected?.active ? data?.runtime?.providerConcurrency : null;
  const modelPickerKey = form ? (mode === 'create' ? 'create' : selected?.id || null) : null;
  const selectedModels = modelPickerKey && modelPicker.profileId === modelPickerKey ? modelPicker.models : [];
  const modelsLoaded = Boolean(form && modelPickerKey && modelPicker.profileId === modelPickerKey);

  return <>
    <AccessibleDialog className="provider-settings-dialog" label="生成服务设置" onDismiss={onDismiss}>
      <header className="provider-settings-head">
        <div className="provider-settings-title">
          <p className="eyebrow">本地敏感配置</p>
          <h2>Provider Profiles</h2>
          <span className="provider-settings-plain">{CONFIG_FACE_INTRO}</span>
          <span>密钥与完整 Base URL 只在当前写入表单中短暂出现，不会从服务端回显。</span>
        </div>
        <div className="provider-head-actions">
          <button type="button" className="outline-button" onClick={beginCreate}><Plus size={15} />新建配置</button>
          <button type="button" className="icon-button" aria-label="关闭生成服务设置" onClick={onDismiss}><X size={18} /></button>
        </div>
      </header>

      {error && <div className="provider-form-alert" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
      {feedback && <div className="provider-form-feedback" role="status" aria-live="polite"><Check size={16} /><span>{feedback}</span></div>}

      {!data ? <div className="provider-loading"><LoaderCircle className="spin" size={20} />正在读取配置</div> : <div className="provider-settings-layout">
        <aside className="provider-profile-rail" aria-label="配置列表">
          <div className="provider-list-title"><span><strong>{providerCount}</strong> 组配置</span><small>都存在本机，不会自动联网</small></div>
          <div className="provider-profile-list">
            {data.profiles.length ? data.profiles.map((profile) => <button type="button" key={profile.id} aria-pressed={profile.id === selectedId} className={profile.id === selectedId ? 'is-selected' : ''} onClick={() => { setSelectedId(profile.id); cancelEdit(); }}>
              <span className="provider-profile-icon"><Server size={17} /></span>
              <span className="provider-profile-list-copy">
                <strong>{profile.name}</strong>
                <small>{profile.providerName || profile.providerId} · {profile.model}</small>
                <small>{profile.endpointSummary || '未设置端点'} · {trustModeLabel(profile.endpointTrustMode)}</small>
              </span>
              <span className="provider-profile-version">v{profile.configVersion}</span>
              {profile.active && <em><Power size={12} />活动</em>}
            </button>) : <div className="provider-empty">
              <KeyRound size={22} />
              <p>还没有任何配置</p>
              <span>新建后要手动启用；不会自动连服务。</span>
              <button type="button" className="command-button" onClick={beginCreate}><Plus size={15} />新建配置</button>
            </div>}
          </div>
        </aside>

        <section className="provider-profile-panel">
          <ConfigGlossaryPanel />
          {mode === 'idle' && selected ? <>
            <section className="provider-profile-card provider-profile-card--primary">
              <div className="provider-profile-summary">
                <div>
                  <p className="eyebrow">Profile 概览</p>
                  <h3>{selected.name}</h3>
                  <span>{selected.providerName || selected.providerId} · {selected.model}</span>
                </div>
                <span className={selected.active ? 'provider-active-badge' : 'provider-inactive-badge'}>{selected.active ? '当前活动' : '未激活'}</span>
              </div>
              <div className="provider-meta-strip" aria-label="Profile 状态">
                <span>{selected.apiKeyConfigured ? 'API Key 已设置（write-only）' : 'API Key 未设置'}</span>
                <span>{trustModeLabel(selected.endpointTrustMode)}</span>
                <span>配置第 {selected.configVersion} 版</span>
                <span>能力清单第 {selected.descriptorVersion} 版</span>
              </div>
              {runtimeConcurrency && <div className="provider-runtime-status provider-runtime-status--compact" role="status" aria-live="polite">
                <div><strong>同时出几张</strong><span>{runtimeReasonLabel(runtimeConcurrency.lastReason)}</span></div>
                <b>目标 {data.runtime.providerConcurrency.target} / {data.runtime.providerConcurrency.max}</b>
                <small>当前活动 {data.runtime.providerConcurrency.active}</small>
              </div>}
            </section>

            {selected.endpointPolicyWarnings?.length ? <div className="provider-restart-note"><CircleAlert size={16} /><span>{selected.endpointPolicyWarnings.join('；')}</span></div> : null}
            {data.runtime?.reconfigurationPending && <div className="provider-restart-note"><CircleAlert size={16} /><span>后台正在自动换用新配置，不用你重启；新的出图会等合适的后台任务接手。</span></div>}

            <section className="provider-actions-panel" aria-label="配置操作">
              <header><div><p className="eyebrow">操作</p><strong>配置、校验和模型选择集中在这里。</strong></div><small>连接测试和读取模型列表会真的访问生成服务，但不会出图。</small></header>
              <div className="provider-actions-grid">
                <button type="button" className="command-button" onClick={beginEdit}>编辑配置</button>
                <button type="button" className="outline-button" disabled={Boolean(busy)} onClick={() => void performAction('validate')} title="只检查这一组填得全不全，不会联网。">{busy === 'validate' ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}本地校验</button>
                <button type="button" className="outline-button" disabled={Boolean(busy)} onClick={() => void performAction('test')} title="用已存的密钥访问生成服务的模型列表（这份列表不存在时会退回到出图入口），只探测能不能连通，不会真出图；结果会记成一份已隐去隐私的测试记录。">{busy === 'test' ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}连接测试</button>
                <button type="button" className="outline-button" disabled={selected.active || Boolean(busy)} onClick={() => void action('activate')}><Power size={15} />激活</button>
                <button type="button" className="outline-button" disabled={Boolean(busy)} onClick={() => void action('copy')}><Copy size={15} />复制</button>
                <button type="button" className="danger-button" aria-label="删除这组配置" disabled={Boolean(busy)} onClick={() => void action('delete')}><Trash2 size={15} />删除</button>
              </div>
            </section>

            <div className="provider-overview-grid">
              <section className="provider-card provider-detail-card">
                <header><strong>连接状态</strong><small>仅显示安全投影</small></header>
                <dl>
                  <div><dt>端点摘要</dt><dd>{selected.endpointSummary || '未配置'}</dd></div>
                  <div><dt>信任模式</dt><dd>{trustModeLabel(selected.endpointTrustMode)}</dd></div>
                  <div><dt>API Key</dt><dd>{selected.apiKeyConfigured ? '已设置（write-only）' : '未设置'}</dd></div>
                  <div><dt>最后一次连接测试</dt><dd>{selected.lastTest ? selected.lastTest.testedAt + ' · HTTP ' + selected.lastTest.status : '还没测过'}</dd></div>
                </dl>
              </section>
              <details className="provider-secondary-panel">
                <summary><span><strong>能力与安全限额</strong><small>辅助信息；展开看这个服务能做些什么，以及这组配置的上限</small></span><em>辅助信息</em></summary>
                <div className="provider-secondary-grid">
                  <ProviderCapabilityCard descriptor={selectedDescriptor} profile={selected} modelCapability={selected?.active ? data?.runtime?.desired?.modelCapability || null : null} />
                  <ProviderLimitSummary limits={selected.limits} />
                </div>
              </details>
            </div>
          </> : mode === 'idle' ? <div className="provider-empty-panel">
            <Server size={26} />
            <h3>配置生成服务</h3>
            <p>新建一个 Profile（一组连接信息：服务 + 地址 + 密钥 + 模型），保存后再手动启用。打开页面和保存都不会自动联网。</p>
            <button type="button" className="command-button" onClick={beginCreate}><Plus size={16} />新建配置</button>
          </div> : <form className="provider-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <header className="provider-form-header">
              <div><p className="eyebrow">{mode === 'create' ? '新 Profile' : '编辑 Profile'}</p><h3>{mode === 'create' ? '填写连接配置' : '更新连接配置'}</h3></div>
              <span>{mode === 'create' ? '新建不会自动测试连接' : '密钥那一栏必须明确选「保留现有值 / 替换 / 清除」；保存后后台会自动换用新配置'}</span>
            </header>

            <section className="provider-form-section">
              <h4>Profile 身份</h4>
              <div className="provider-form-grid">
                <label><span>Profile 名称</span><input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><small className="provider-field-hint">{configFieldHint('name')}</small></label>
                <label><span>Provider</span><select value={form.providerId} onChange={(event) => setProviderId(event.target.value)}>{descriptors.map((descriptor) => <option value={descriptor.id} key={descriptor.id}>{descriptor.displayName}</option>)}</select><small className="provider-field-hint">{configFieldHint('provider')}</small></label>
                <label><span>模型</span><input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} autoComplete="off" placeholder={activeDescriptor?.modelExamples?.[0] || ''} /><small className="provider-field-hint">{configFieldHint('model')}</small></label>
                <button type="button" className="outline-button provider-model-fetch" disabled={Boolean(busy)} onClick={() => void loadModels()} title="按表单里填的内容去问生成服务有哪些模型；不会出图。模型名也可以直接手填。">{busy === 'models' ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}获取模型</button>
                {activeDescriptor?.reference?.enableOptionKey === 'referenceEnabled' && <label className="provider-checkbox"><input type="checkbox" checked={form.referenceEnabled} onChange={(event) => setForm({ ...form, referenceEnabled: event.target.checked })} /><span>允许 Gemini 参考图能力</span></label>}
              </div>
              {modelsLoaded && <div className="provider-model-picker provider-model-picker--form" aria-label="Provider 模型列表">
                <p>已读取模型列表；选择后保存配置生效。</p>
                {selectedModels.length ? <div className="provider-model-list">{selectedModels.map((model) => <ProviderModelButton key={model.id || model.label} model={model} selected={String(model.id || '').trim() === form.model} onChoose={chooseModel} />)}</div> : <p>Provider 返回空模型列表；可继续手动填写模型名。</p>}
              </div>}
            </section>

            <section className="provider-form-section">
              <h4>连接信息</h4>
              <div className="provider-form-grid">
                {mode === 'edit' && <label><span>Base URL 更新</span><select value={form.baseUrlAction} onChange={(event) => setForm({ ...form, baseUrlAction: event.target.value, baseUrl: '' })}><option value="keep">保留现有值</option><option value="replace">替换</option><option value="clear">清除</option></select></label>}
                {(mode === 'create' || form.baseUrlAction === 'replace') && <label><span>完整 Base URL</span><input type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} autoComplete="off" spellCheck="false" placeholder={activeDescriptor?.endpoint?.examples?.[0] || ''} /><small className="provider-field-hint">{configFieldHint('baseUrl')}</small><small>{activeDescriptor?.endpoint?.help || '仅随本次写入发送；不会存入浏览器。'}</small></label>}
                <label><span>端点信任模式</span><select value={form.endpointTrustMode} onChange={(event) => setForm({ ...form, endpointTrustMode: event.target.value })}>{TRUST_MODES.map(([value, label, description]) => <option value={value} key={value}>{label} - {description}</option>)}</select><small className="provider-field-hint">{configFieldHint('trustMode')}</small></label>
                {mode === 'edit' && <label><span>API Key 更新</span><select value={form.apiKeyAction} onChange={(event) => setForm({ ...form, apiKeyAction: event.target.value, apiKey: '' })}><option value="keep">保留现有值</option><option value="replace">替换</option><option value="clear">清除</option></select></label>}
                {(mode === 'create' || form.apiKeyAction === 'replace') && <label><span>API Key</span><input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} autoComplete="new-password" spellCheck="false" /><small className="provider-field-hint">{configFieldHint('apiKey')}</small><small>write-only；关闭表单后立即从页面状态移除。</small></label>}
              </div>
            </section>

            <details className="provider-secondary-panel provider-form-secondary">
              <summary><span><strong>能力与安全限额</strong><small>可选设置；默认收起，不影响连接配置</small></span><em>辅助信息</em></summary>
              <div className="provider-secondary-grid provider-secondary-grid--form">
                <ProviderCapabilityCard descriptor={activeDescriptor} profile={{ referenceEnabled: form.referenceEnabled }} />
                <fieldset className="provider-limit-grid">
                  <legend>这组配置的用量上限（可留空）</legend>
                  <p className="provider-field-hint">{configFieldHint('limits')}</p>
                  {LIMIT_FIELDS.map(([key, label, , placeholder]) => <label key={key}><span>{label}</span><input inputMode="numeric" value={form.limits?.[key] || ''} onChange={(event) => setLimit(key, event.target.value)} placeholder={placeholder} /></label>)}
                </fieldset>
              </div>
            </details>

            {mode === 'create' && <label className="provider-checkbox"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /><span>保存后就用这一组</span></label>}
            <div className="provider-form-note"><CircleAlert size={15} /><span>连接测试会真的访问生成服务，但不会出图；本地校验只查填得全不全，不联网。这几项都会用到你的密钥：后台只接受来自本机这个页面的调用，已存的密钥只会发往这一组自己填的服务地址。模型名可以点按钮拉取，也可以直接手填。</span></div>
            <div className="provider-form-actions"><button type="button" className="outline-button" onClick={cancelEdit}>取消</button><button type="submit" className="command-button" disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle className="spin" size={15} /> : null}保存配置</button></div>
          </form>}
        </section>
      </div>}
    </AccessibleDialog>
    {confirmation && <ConfirmationDialog label={confirmation.kind === 'delete' ? '确认删除这组配置' : '确认清除连接信息'} title={confirmation.kind === 'delete' ? '删除这组配置？' : '清除连接信息？'} message={confirmation.kind === 'delete' ? (confirmation.active ? '“' + confirmation.profileName + '”正在使用中。删除后新的出图会等你先启用另一组。要继续吗？' : '删除“' + confirmation.profileName + '”？已经出过的图不受影响。') : '清除连接信息后，这一组暂时用不了；保存后后台会自动换用新配置。要继续吗？'} confirmLabel={confirmation.kind === 'delete' ? '确认删除' : '继续清除'} tone={confirmation.kind === 'delete' ? 'danger' : 'warning'} onCancel={() => setConfirmation(null)} onConfirm={confirmPendingAction} />}
  </>;
}
