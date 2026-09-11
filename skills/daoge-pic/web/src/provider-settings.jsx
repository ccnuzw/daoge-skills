import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, Copy, KeyRound, LoaderCircle, Plus, Power, RefreshCw, Server, ShieldCheck, Trash2, X } from 'lucide-react';
import { AccessibleDialog } from './accessible-dialog.jsx';
import { ConfirmationDialog } from './confirmation-dialog.jsx';
import { createProviderEditForm, descriptorForProvider, normalizeProfileLimits } from './provider-settings-model.mjs';

const FALLBACK_PROVIDERS = [
  { id: 'openai-images', displayName: 'OpenAI Images', endpoint: { defaultTrustMode: 'compatible_public', examples: ['https://api.openai.com/v1'], help: 'OpenAI Images 或兼容 /v1 images endpoint。' }, reference: { supported: true, maxCount: 8 }, mask: { supported: true }, operations: { generate: true, edit: true }, modelExamples: ['gpt-image-2'] },
  { id: 'gemini-image', displayName: 'Gemini Image', endpoint: { defaultTrustMode: 'compatible_public', examples: ['https://generativelanguage.googleapis.com'], help: 'Gemini generateContent endpoint。' }, reference: { supported: true, maxCount: 8, enableOptionKey: 'referenceEnabled' }, mask: { supported: false }, operations: { generate: true, edit: true }, modelExamples: ['gemini-2.5-flash-image'] },
  { id: 'gemini-openai-compatible', displayName: 'Gemini OpenAI Compatible', endpoint: { defaultTrustMode: 'compatible_public', examples: ['https://your-gemini-compatible.example/v1'], help: 'OpenAI-compatible images endpoint。' }, reference: { supported: false, maxCount: 0 }, mask: { supported: false }, operations: { generate: true, edit: false }, modelExamples: ['gemini-2.5-flash-image'] },
  { id: 'xai-grok-image', displayName: 'xAI Grok Image', endpoint: { defaultTrustMode: 'compatible_public', examples: ['https://api.x.ai/v1'], help: 'xAI image endpoint。' }, reference: { supported: true, maxCount: 5 }, mask: { supported: false }, operations: { generate: true, edit: true }, modelExamples: ['grok-imagine-image'] }
];

const TRUST_MODES = [
  ['official', '官方端点', '要求 HTTPS 和官方 host。'],
  ['compatible_public', '公开兼容端点', '适合第三方兼容服务；建议 HTTPS。'],
  ['local_proxy', '本地代理', '允许把密钥发给本机代理。'],
  ['enterprise_private', '企业内网', '允许受控内网网关；建议 HTTPS。']
];

const TRUST_MODE_LABELS = Object.fromEntries(TRUST_MODES.map(([value, label]) => [value, label]));
const LIMIT_ROWS = [
  ['maxRunItems', '单次数量', '未限制', '张'],
  ['maxExecutionConcurrency', '运行并发', '未限制', '路'],
  ['requestTimeoutMs', '请求超时', '默认', 'ms'],
  ['maxRetryAttempts', '自动重试', '默认', '次']
];

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
  if (reason === 'rate_limited') return 'Provider 限流降速';
  if (reason === 'memory_pressure') return 'Worker 内存压力降速';
  if (reason === 'transient' || reason === 'unknown') return '临时故障降速';
  if (reason === 'healthy') return '健康窗口逐步升速';
  return '启动预热中';
}

function CapabilityPill({ label, active, detail }) {
  return <li className={active ? 'is-supported' : 'is-muted'}>
    <span>{label}</span>
    <strong>{detail}</strong>
  </li>;
}

function ProviderCapabilityCard({ descriptor, profile }) {
  if (!descriptor) return null;
  const referenceEnabled = profile ? profile.referenceEnabled : descriptor.reference?.defaultEnabled === true;
  const referenceActive = descriptor.reference?.supported && referenceEnabled;
  return <section className="provider-card provider-capability-card" aria-label="Provider 能力摘要">
    <header><ShieldCheck size={16} /><div><strong>{descriptor.displayName} 能力</strong><span>Descriptor v{descriptor.descriptorVersion || 1} · Adapter {descriptor.adapterVersion || 'http-image-v1'}</span></div></header>
    <ul>
      <CapabilityPill label="文生图" active={descriptor.operations?.generate} detail={descriptor.operations?.generate ? '支持' : '不支持'} />
      <CapabilityPill label="参考图" active={referenceActive} detail={referenceActive ? '最多 ' + descriptor.reference.maxCount + ' 张' : descriptor.reference?.supported ? '可开启' : '不支持'} />
      <CapabilityPill label="遮罩" active={descriptor.mask?.supported} detail={descriptor.mask?.supported ? '支持' : '不支持'} />
      <CapabilityPill label="编辑" active={descriptor.operations?.edit} detail={descriptor.operations?.edit ? '支持' : '不支持'} />
    </ul>
  </section>;
}

function ProviderLimitSummary({ limits = {} }) {
  return <section className="provider-card provider-limit-summary" aria-label="Profile 级安全限额">
    <header><span>Profile 级安全限额</span><small>留空项使用全局安全边界</small></header>
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

  useEffect(() => { void load().catch((nextError) => setError(nextError.message || '无法读取 Provider Profiles。')); }, []);

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
    if (!form?.name.trim()) return '请输入 Profile 名称。';
    if (!form?.model.trim()) return '请输入模型名称。';
    if (mode === 'create' && !form.baseUrl.trim()) return '请输入完整 Base URL。';
    if (mode === 'create' && !form.apiKey.trim()) return '请输入 API Key。';
    if (mode === 'edit' && form.baseUrlAction === 'replace' && !form.baseUrl.trim()) return '请输入新的完整 Base URL。';
    if (mode === 'edit' && form.apiKeyAction === 'replace' && !form.apiKey.trim()) return '请输入新的 API Key。';
    try { if (mode === 'create' || form.baseUrlAction === 'replace') new URL(form.baseUrl); } catch { return 'Base URL 格式无效。'; }
    for (const [key, label, max] of [['maxRunItems', '单次数量上限', 1000], ['maxExecutionConcurrency', '运行并发上限', 1000], ['requestTimeoutMs', '请求超时毫秒', 600000], ['maxRetryAttempts', '自动重试上限', 20]]) {
      const raw = form.limits?.[key];
      if (raw !== '' && raw !== undefined && raw !== null) {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1 || value > max) return label + '必须是 1 到 ' + max + ' 的整数。';
      }
    }
    return '';
  };

  const persistSave = async () => {
    setBusy('save'); setError(''); setFeedback('');
    try {
      const limits = normalizeProfileLimits(form.limits);
      if (mode === 'create') {
        await request('/api/providers', { method: 'POST', idempotencyKey: crypto.randomUUID(), body: { name: form.name, providerId: form.providerId, model: form.model, baseUrl: form.baseUrl, apiKey: form.apiKey, endpointTrustMode: form.endpointTrustMode, options: { referenceEnabled: form.referenceEnabled }, limits, active: form.active } });
      } else {
        await request('/api/providers/' + encodeURIComponent(selected.id), { method: 'PUT', idempotencyKey: crypto.randomUUID(), body: { expectedConfigVersion: selected.configVersion, name: form.name, providerId: form.providerId, model: form.model, baseUrl: secretUpdate(form.baseUrlAction, form.baseUrl), apiKey: secretUpdate(form.apiKeyAction, form.apiKey), endpointTrustMode: form.endpointTrustMode, options: { referenceEnabled: form.referenceEnabled }, limits } });
      }
      setForm(null); setMode('idle'); setModelPicker({ profileId: null, models: [] });
      await load();
      await onChanged();
      setFeedback('Profile 已保存；活动配置会自动热加载，已完成的预检需重新预检后再运行。');
    } catch (nextError) { setError(nextError.message || '无法保存 Provider Profile。'); }
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
      else if (name === 'test') setFeedback(result.connected ? '连接测试通过（HTTP ' + result.status + '）。已记录脱敏测试证据。' : '已连接端点，但鉴权或服务状态未通过（HTTP ' + result.status + '）。');
      else { await load(); await onChanged(); setFeedback(name === 'activate' ? '已设为活动 Profile；daemon 会自动热加载，后续预检和新运行使用它。' : name === 'copy' ? '已复制 Profile，副本默认不激活。' : (result.impact?.message || 'Profile 已删除。')); }
    } catch (nextError) { setError(nextError.message || 'Provider 操作失败。'); }
    finally { setBusy(''); }
  };
  const loadModels = async () => {
    const pickerKey = form ? (mode === 'create' ? 'create' : selected?.id || null) : null;
    if (!form || !pickerKey) return;
    setBusy('models'); setError(''); setFeedback('');
    try {
      const path = '/api/provider-models';
      const descriptor = descriptorForProvider(descriptors, form.providerId);
      let body = { providerId: form.providerId, model: form.model || descriptor?.modelExamples?.[0] || '', endpointTrustMode: form.endpointTrustMode, options: { referenceEnabled: form.referenceEnabled } };
      if (mode === 'edit' && selected) body = { ...body, profileId: selected.id };
      if (mode === 'create') {
        if (!form.baseUrl.trim()) throw new Error('请输入 Base URL 后再获取模型列表。');
        if (!form.apiKey.trim()) throw new Error('请输入 API Key 后再获取模型列表。');
        body = { ...body, baseUrl: form.baseUrl, apiKey: form.apiKey };
      } else {
        if (form.baseUrlAction === 'clear' || form.apiKeyAction === 'clear') throw new Error('清除连接信息后无法读取模型列表。');
        if (form.baseUrlAction === 'replace') {
          if (!form.baseUrl.trim()) throw new Error('请输入新的 Base URL 后再获取模型列表。');
          body = { ...body, baseUrl: form.baseUrl };
        }
        if (form.apiKeyAction === 'replace') {
          if (!form.apiKey.trim()) throw new Error('请输入新的 API Key 后再获取模型列表。');
          body = { ...body, apiKey: form.apiKey };
        }
      }
      const result = await request(path, { method: 'POST', idempotencyKey: crypto.randomUUID(), body });
      const models = Array.isArray(result.models) ? result.models : [];
      setModelPicker({ profileId: pickerKey, models });
      setFeedback(models.length ? '已读取 ' + models.length + ' 个模型；选择后保存配置生效。' : 'Provider 返回空模型列表；可继续手动填写模型名。');
    } catch (nextError) { setError(nextError.message || '无法读取 Provider 模型列表。'); }
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
    <AccessibleDialog className="provider-settings-dialog" label="Provider Profile 设置" onDismiss={onDismiss}>
      <header className="provider-settings-head">
        <div className="provider-settings-title">
          <p className="eyebrow">本地敏感配置</p>
          <h2>Provider Profiles</h2>
          <span>密钥与完整 Base URL 只在当前写入表单中短暂出现，不会从服务端回显。</span>
        </div>
        <div className="provider-head-actions">
          <button type="button" className="outline-button" onClick={beginCreate}><Plus size={15} />新建 Profile</button>
          <button type="button" className="icon-button" aria-label="关闭 Provider 设置" onClick={onDismiss}><X size={18} /></button>
        </div>
      </header>

      {error && <div className="provider-form-alert" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
      {feedback && <div className="provider-form-feedback" role="status" aria-live="polite"><Check size={16} /><span>{feedback}</span></div>}

      {!data ? <div className="provider-loading"><LoaderCircle className="spin" size={20} />正在读取 Profiles</div> : <div className="provider-settings-layout">
        <aside className="provider-profile-rail" aria-label="Provider Profile 列表">
          <div className="provider-list-title"><span><strong>{providerCount}</strong> 个 Profile</span><small>本地配置，不自动联网</small></div>
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
              <p>尚无 Profile</p>
              <span>新建后可显式激活；不会自动连接 Provider。</span>
              <button type="button" className="command-button" onClick={beginCreate}><Plus size={15} />新建 Profile</button>
            </div>}
          </div>
        </aside>

        <section className="provider-profile-panel">
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
                <span>配置 v{selected.configVersion}</span>
                <span>Descriptor v{selected.descriptorVersion}</span>
              </div>
              {runtimeConcurrency && <div className="provider-runtime-status provider-runtime-status--compact" role="status" aria-live="polite">
                <div><strong>Provider 并发</strong><span>{runtimeReasonLabel(runtimeConcurrency.lastReason)}</span></div>
                <b>目标 {data.runtime.providerConcurrency.target} / {data.runtime.providerConcurrency.max}</b>
                <small>当前活动 {data.runtime.providerConcurrency.active}</small>
              </div>}
            </section>

            {selected.endpointPolicyWarnings?.length ? <div className="provider-restart-note"><CircleAlert size={16} /><span>{selected.endpointPolicyWarnings.join('；')}</span></div> : null}
            {data.runtime?.reconfigurationPending && <div className="provider-restart-note"><CircleAlert size={16} /><span>daemon 正在热加载活动配置；新运行会等待匹配的 Worker 接手，不需要重启。</span></div>}

            <section className="provider-actions-panel" aria-label="Provider Profile 操作">
              <header><div><p className="eyebrow">操作</p><strong>配置、校验和模型选择集中在这里。</strong></div><small>连接测试和模型列表会访问 Provider；不会生成图片。</small></header>
              <div className="provider-actions-grid">
                <button type="button" className="command-button" onClick={beginEdit}>编辑 Profile</button>
                <button type="button" className="outline-button" disabled={Boolean(busy)} onClick={() => void action('validate')}>本地校验</button>
                <button type="button" className="outline-button" disabled={Boolean(busy)} onClick={() => void action('test')}>{busy === 'test' ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}连接测试</button>
                <button type="button" className="outline-button" disabled={selected.active || Boolean(busy)} onClick={() => void action('activate')}><Power size={15} />激活</button>
                <button type="button" className="outline-button" disabled={Boolean(busy)} onClick={() => void action('copy')}><Copy size={15} />复制</button>
                <button type="button" className="danger-button" aria-label="删除 Profile" disabled={Boolean(busy)} onClick={() => void action('delete')}><Trash2 size={15} />删除</button>
              </div>
            </section>

            <div className="provider-overview-grid">
              <section className="provider-card provider-detail-card">
                <header><strong>连接状态</strong><small>仅显示安全投影</small></header>
                <dl>
                  <div><dt>端点摘要</dt><dd>{selected.endpointSummary || '未配置'}</dd></div>
                  <div><dt>信任模式</dt><dd>{trustModeLabel(selected.endpointTrustMode)}</dd></div>
                  <div><dt>API Key</dt><dd>{selected.apiKeyConfigured ? '已设置（write-only）' : '未设置'}</dd></div>
                  <div><dt>测试证据</dt><dd>{selected.lastTest ? selected.lastTest.testedAt + ' · HTTP ' + selected.lastTest.status : '尚未显式连接测试'}</dd></div>
                </dl>
              </section>
              <details className="provider-secondary-panel">
                <summary><span><strong>能力与安全限额</strong><small>辅助信息；展开查看 Provider 能力和 Profile 运行边界</small></span><em>辅助信息</em></summary>
                <div className="provider-secondary-grid">
                  <ProviderCapabilityCard descriptor={selectedDescriptor} profile={selected} />
                  <ProviderLimitSummary limits={selected.limits} />
                </div>
              </details>
            </div>
          </> : mode === 'idle' ? <div className="provider-empty-panel">
            <Server size={26} />
            <h3>配置生成服务</h3>
            <p>新建一个 Profile，保存后再显式激活。页面打开与保存都不会自动发起网络连接。</p>
            <button type="button" className="command-button" onClick={beginCreate}><Plus size={16} />新建 Profile</button>
          </div> : <form className="provider-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <header className="provider-form-header">
              <div><p className="eyebrow">{mode === 'create' ? '新 Profile' : '编辑 Profile'}</p><h3>{mode === 'create' ? '填写连接配置' : '更新连接配置'}</h3></div>
              <span>{mode === 'create' ? '新建不会自动测试连接' : '密钥字段必须明确 keep / replace / clear；活动配置会自动热加载'}</span>
            </header>

            <section className="provider-form-section">
              <h4>Profile 身份</h4>
              <div className="provider-form-grid">
                <label><span>Profile 名称</span><input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
                <label><span>Provider</span><select value={form.providerId} onChange={(event) => setProviderId(event.target.value)}>{descriptors.map((descriptor) => <option value={descriptor.id} key={descriptor.id}>{descriptor.displayName}</option>)}</select></label>
                <label><span>模型</span><input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} autoComplete="off" placeholder={activeDescriptor?.modelExamples?.[0] || ''} /></label>
                <button type="button" className="outline-button provider-model-fetch" disabled={Boolean(busy)} onClick={() => void loadModels()}>{busy === 'models' ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}获取模型</button>
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
                {(mode === 'create' || form.baseUrlAction === 'replace') && <label><span>完整 Base URL</span><input type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} autoComplete="off" spellCheck="false" placeholder={activeDescriptor?.endpoint?.examples?.[0] || ''} /><small>{activeDescriptor?.endpoint?.help || '仅随本次写入发送；不会存入浏览器。'}</small></label>}
                <label><span>端点信任模式</span><select value={form.endpointTrustMode} onChange={(event) => setForm({ ...form, endpointTrustMode: event.target.value })}>{TRUST_MODES.map(([value, label, description]) => <option value={value} key={value}>{label} - {description}</option>)}</select></label>
                {mode === 'edit' && <label><span>API Key 更新</span><select value={form.apiKeyAction} onChange={(event) => setForm({ ...form, apiKeyAction: event.target.value, apiKey: '' })}><option value="keep">保留现有值</option><option value="replace">替换</option><option value="clear">清除</option></select></label>}
                {(mode === 'create' || form.apiKeyAction === 'replace') && <label><span>API Key</span><input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} autoComplete="new-password" spellCheck="false" /><small>write-only；关闭表单后立即从页面状态移除。</small></label>}
              </div>
            </section>

            <details className="provider-secondary-panel provider-form-secondary">
              <summary><span><strong>能力与安全限额</strong><small>可选设置；默认收起，不影响连接配置</small></span><em>辅助信息</em></summary>
              <div className="provider-secondary-grid provider-secondary-grid--form">
                <ProviderCapabilityCard descriptor={activeDescriptor} profile={{ referenceEnabled: form.referenceEnabled }} />
                <fieldset className="provider-limit-grid">
                  <legend>Profile 级安全限额（可留空）</legend>
                  <label><span>单次数量上限</span><input inputMode="numeric" value={form.limits?.maxRunItems || ''} onChange={(event) => setLimit('maxRunItems', event.target.value)} placeholder="最多 1000" /></label>
                  <label><span>运行并发上限</span><input inputMode="numeric" value={form.limits?.maxExecutionConcurrency || ''} onChange={(event) => setLimit('maxExecutionConcurrency', event.target.value)} placeholder="最多 1000" /></label>
                  <label><span>请求超时 ms</span><input inputMode="numeric" value={form.limits?.requestTimeoutMs || ''} onChange={(event) => setLimit('requestTimeoutMs', event.target.value)} placeholder="120000" /></label>
                  <label><span>自动重试上限</span><input inputMode="numeric" value={form.limits?.maxRetryAttempts || ''} onChange={(event) => setLimit('maxRetryAttempts', event.target.value)} placeholder="默认 4" /></label>
                </fieldset>
              </div>
            </details>

            {mode === 'create' && <label className="provider-checkbox"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /><span>保存后设为活动 Profile</span></label>}
            <div className="provider-form-note"><CircleAlert size={15} /><span>连接测试会访问 Provider 但不生成图片；本地校验不会联网。</span></div>
            <div className="provider-form-actions"><button type="button" className="outline-button" onClick={cancelEdit}>取消</button><button type="submit" className="command-button" disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle className="spin" size={15} /> : null}保存配置</button></div>
          </form>}
        </section>
      </div>}
    </AccessibleDialog>
    {confirmation && <ConfirmationDialog label={confirmation.kind === 'delete' ? '确认删除 Provider Profile' : '确认清除连接信息'} title={confirmation.kind === 'delete' ? '删除 Provider Profile？' : '清除连接信息？'} message={confirmation.kind === 'delete' ? (confirmation.active ? 'Profile“' + confirmation.profileName + '”是当前活动 Profile。删除后新运行会等待你激活其他 Profile。是否继续？' : '删除 Profile“' + confirmation.profileName + '”？此操作不会删除历史运行。') : '清除连接信息会让该 Profile 暂时不可用；活动配置保存后会自动热加载。是否继续？'} confirmLabel={confirmation.kind === 'delete' ? '确认删除' : '继续清除'} tone={confirmation.kind === 'delete' ? 'danger' : 'warning'} onCancel={() => setConfirmation(null)} onConfirm={confirmPendingAction} />}
  </>;
}
