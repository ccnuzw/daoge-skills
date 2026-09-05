import { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, Copy, KeyRound, LoaderCircle, Plus, Power, RefreshCw, Server, Trash2, X } from 'lucide-react';
import { AccessibleDialog } from './accessible-dialog.jsx';
import { ConfirmationDialog } from './confirmation-dialog.jsx';
import { createProviderEditForm } from './provider-settings-model.mjs';

const PROVIDERS = [
  ['openai-images', 'OpenAI Images'],
  ['gemini-image', 'Gemini Image'],
  ['gemini-openai-compatible', 'Gemini OpenAI Compatible'],
  ['xai-grok-image', 'xAI Grok Image']
];

function secretUpdate(action, value) {
  return action === 'replace' ? { action, value } : { action };
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
  const selected = useMemo(() => data?.profiles?.find((profile) => profile.id === selectedId) || null, [data, selectedId]);

  const load = async () => {
    setError('');
    const next = await request('/api/providers');
    setData(next);
    setSelectedId((current) => next.profiles.some((profile) => profile.id === current) ? current : next.profiles[0]?.id || null);
    return next;
  };

  useEffect(() => { void load().catch((nextError) => setError(nextError.message || '无法读取 Provider Profiles。')); }, []);

  const beginCreate = () => {
    setFeedback('');
    setMode('create');
    setForm({ name: '', providerId: 'openai-images', model: '', baseUrl: '', apiKey: '', referenceEnabled: false, active: !data?.profiles?.some((profile) => profile.active) });
  };
  const beginEdit = () => {
    if (!selected) return;
    setFeedback('');
    setMode('edit');
    setForm(createProviderEditForm(selected));
  };
  const cancelEdit = () => { setMode('idle'); setForm(null); setError(''); };

  const localError = () => {
    if (!form?.name.trim()) return '请输入 Profile 名称。';
    if (!form?.model.trim()) return '请输入模型名称。';
    if (mode === 'create' && !form.baseUrl.trim()) return '请输入完整 Base URL。';
    if (mode === 'create' && !form.apiKey.trim()) return '请输入 API Key。';
    if (mode === 'edit' && form.baseUrlAction === 'replace' && !form.baseUrl.trim()) return '请输入新的完整 Base URL。';
    if (mode === 'edit' && form.apiKeyAction === 'replace' && !form.apiKey.trim()) return '请输入新的 API Key。';
    try { if (mode === 'create' || form.baseUrlAction === 'replace') new URL(form.baseUrl); } catch { return 'Base URL 格式无效。'; }
    return '';
  };

  const persistSave = async (restart) => {
    setBusy(restart ? 'save-restart' : 'save'); setError(''); setFeedback('');
    try {
      if (mode === 'create') {
        await request('/api/providers', { method: 'POST', idempotencyKey: crypto.randomUUID(), body: { name: form.name, providerId: form.providerId, model: form.model, baseUrl: form.baseUrl, apiKey: form.apiKey, options: { referenceEnabled: form.referenceEnabled }, active: form.active } });
      } else {
        await request('/api/providers/' + encodeURIComponent(selected.id), { method: 'PUT', idempotencyKey: crypto.randomUUID(), body: { expectedConfigVersion: selected.configVersion, name: form.name, providerId: form.providerId, model: form.model, baseUrl: secretUpdate(form.baseUrlAction, form.baseUrl), apiKey: secretUpdate(form.apiKeyAction, form.apiKey), options: { referenceEnabled: form.referenceEnabled } } });
      }
      setForm(null); setMode('idle');
      await load();
      await onChanged();
      if (restart) {
        await request('/api/restart', { method: 'POST', idempotencyKey: crypto.randomUUID(), body: {} });
        setFeedback('配置已保存，Studio 正在优雅重启；当前页面授权会在连接恢复后继续有效。');
      } else setFeedback('Profile 已保存。若活动配置有变化，请使用“保存并重启”使新运行生效。');
    } catch (nextError) { setError(nextError.message || '无法保存 Provider Profile。'); }
    finally { setBusy(''); }
  };
  const save = async (restart) => {
    const invalid = localError();
    if (invalid) { setError(invalid); return; }
    if (mode === 'edit' && (form.baseUrlAction === 'clear' || form.apiKeyAction === 'clear')) {
      setConfirmation({ kind: 'clear', restart });
      return;
    }
    await persistSave(restart);
  };

  const performAction = async (name, target = selected) => {
    if (!target) return;
    setBusy(name); setError(''); setFeedback('');
    try {
      const suffix = name === 'copy' ? '/copy' : name === 'activate' ? '/activate' : name === 'delete' ? '/delete' : '/' + name;
      const result = await request('/api/providers/' + encodeURIComponent(target.id) + suffix, { method: 'POST', idempotencyKey: crypto.randomUUID(), body: {} });
      if (name === 'validate') setFeedback(result.valid ? '本地校验通过。未发起网络连接。' : '本地校验未通过：' + result.missing.join('、'));
      else if (name === 'test') setFeedback(result.connected ? '连接测试通过（HTTP ' + result.status + '）。' : '已连接端点，但鉴权或服务状态未通过（HTTP ' + result.status + '）。');
      else { await load(); await onChanged(); setFeedback(name === 'activate' ? '已设为活动 Profile；新运行前需要重启 Studio。' : name === 'copy' ? '已复制 Profile，副本默认不激活。' : 'Profile 已删除。'); }
    } catch (nextError) { setError(nextError.message || 'Provider 操作失败。'); }
    finally { setBusy(''); }
  };
  const action = async (name) => {
    if (!selected) return;
    if (name === 'delete') {
      setConfirmation({ kind: 'delete', profileId: selected.id, profileName: selected.name });
      return;
    }
    await performAction(name);
  };
  const confirmPendingAction = async () => {
    if (!confirmation) return;
    const pending = confirmation;
    setConfirmation(null);
    if (pending.kind === 'delete') await performAction('delete', { id: pending.profileId, name: pending.profileName });
    else await persistSave(pending.restart);
  };

  return <>
  <AccessibleDialog className="provider-settings-dialog" label="Provider Profile 设置" onDismiss={onDismiss}>
    <header className="provider-settings-head"><div><p className="eyebrow">本地敏感配置</p><h2>Provider Profiles</h2><span>密钥与完整 Base URL 只在当前写入表单中短暂出现，不会从服务端回显。</span></div><button type="button" className="icon-button" aria-label="关闭 Provider 设置" onClick={onDismiss}><X size={18} /></button></header>
    {error && <div className="provider-form-alert" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
    {feedback && <div className="provider-form-feedback" role="status" aria-live="polite"><Check size={16} /><span>{feedback}</span></div>}
    {!data ? <div className="provider-loading"><LoaderCircle className="spin" size={20} />正在读取 Profiles</div> : <div className="provider-settings-layout">
      <aside className="provider-profile-list" aria-label="Provider Profile 列表"><div className="provider-list-title"><span>{data.profiles.length} 个 Profile</span><button type="button" className="outline-button" onClick={beginCreate}><Plus size={15} />新建</button></div>{data.profiles.length ? data.profiles.map((profile) => <button type="button" key={profile.id} className={profile.id === selectedId ? 'is-selected' : ''} onClick={() => { setSelectedId(profile.id); cancelEdit(); }}><span className="provider-profile-icon"><Server size={17} /></span><span><strong>{profile.name}</strong><small>{profile.providerId} · {profile.model}</small><small>{profile.endpointSummary || '未设置端点'} · v{profile.configVersion}</small></span>{profile.active && <em><Power size={12} />活动</em>}</button>) : <div className="provider-empty"><KeyRound size={22} /><p>尚无 Profile</p><span>新建后可显式激活；不会自动连接 Provider。</span></div>}</aside>
      <section className="provider-profile-panel">
        {selected?.active && data?.runtime?.providerConcurrency && <div className="provider-runtime-status" role="status" aria-live="polite"><strong>Provider 并发</strong><span>目标 {data.runtime.providerConcurrency.target} / {data.runtime.providerConcurrency.max} · 当前活动 {data.runtime.providerConcurrency.active}</span><small>{data.runtime.providerConcurrency.lastReason === 'rate_limited' ? '因 Provider 限流已降速' : data.runtime.providerConcurrency.lastReason === 'memory_pressure' ? '因 Worker 内存压力已降速' : data.runtime.providerConcurrency.lastReason === 'transient' || data.runtime.providerConcurrency.lastReason === 'unknown' ? '因临时故障已降速' : data.runtime.providerConcurrency.lastReason === 'healthy' ? '健康窗口内逐步升速' : '启动预热中'}</small></div>}
        {mode === 'idle' && selected ? <><div className="provider-profile-summary"><div><p className="eyebrow">安全摘要</p><h3>{selected.name}</h3></div><span className={selected.active ? 'provider-active-badge' : 'provider-inactive-badge'}>{selected.active ? '当前活动' : '未激活'}</span></div><dl><div><dt>Provider</dt><dd>{selected.providerId}</dd></div><div><dt>模型</dt><dd>{selected.model}</dd></div><div><dt>端点摘要</dt><dd>{selected.endpointSummary || '未配置'}</dd></div><div><dt>API Key</dt><dd>{selected.apiKeyConfigured ? '已设置（write-only）' : '未设置'}</dd></div><div><dt>配置版本</dt><dd>{selected.configVersion}</dd></div></dl><div className="provider-actions"><button type="button" className="command-button" onClick={beginEdit}>编辑 Profile</button><button type="button" className="outline-button" disabled={Boolean(busy)} onClick={() => void action('validate')}>本地校验</button><button type="button" className="outline-button" disabled={Boolean(busy)} onClick={() => void action('test')}>{busy === 'test' ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}连接测试</button><button type="button" className="outline-button" disabled={selected.active || Boolean(busy)} onClick={() => void action('activate')}><Power size={15} />激活</button><button type="button" className="outline-button" disabled={Boolean(busy)} onClick={() => void action('copy')}><Copy size={15} />复制</button><button type="button" className="danger-button" disabled={Boolean(busy)} onClick={() => void action('delete')}><Trash2 size={15} />删除</button></div>{data.runtime?.restartRequired && <div className="provider-restart-note"><CircleAlert size={16} /><span>活动配置与 daemon 启动快照不同。重启前拒绝提交新运行。</span></div>}</> : mode === 'idle' ? <div className="provider-empty-panel"><Server size={26} /><h3>配置生成服务</h3><p>新建一个 Profile，保存后再显式激活。页面打开与保存都不会自动发起网络连接。</p><button type="button" className="command-button" onClick={beginCreate}><Plus size={16} />新建 Profile</button></div> : <form className="provider-form" onSubmit={(event) => { event.preventDefault(); void save(false); }}><div><p className="eyebrow">{mode === 'create' ? '新 Profile' : '编辑 Profile'}</p><h3>{mode === 'create' ? '填写连接配置' : '更新连接配置'}</h3></div><label><span>Profile 名称</span><input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label><span>Provider</span><select value={form.providerId} onChange={(event) => setForm({ ...form, providerId: event.target.value })}>{PROVIDERS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>模型</span><input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} autoComplete="off" /></label>{mode === 'edit' && <label><span>Base URL 更新</span><select value={form.baseUrlAction} onChange={(event) => setForm({ ...form, baseUrlAction: event.target.value, baseUrl: '' })}><option value="keep">保留现有值</option><option value="replace">替换</option><option value="clear">清除</option></select></label>}{(mode === 'create' || form.baseUrlAction === 'replace') && <label><span>完整 Base URL</span><input type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} autoComplete="off" spellCheck="false" /><small>仅随本次写入发送；不会存入浏览器。</small></label>}{mode === 'edit' && <label><span>API Key 更新</span><select value={form.apiKeyAction} onChange={(event) => setForm({ ...form, apiKeyAction: event.target.value, apiKey: '' })}><option value="keep">保留现有值</option><option value="replace">替换</option><option value="clear">清除</option></select></label>}{(mode === 'create' || form.apiKeyAction === 'replace') && <label><span>API Key</span><input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} autoComplete="new-password" spellCheck="false" /><small>write-only；关闭表单后立即从页面状态移除。</small></label>}<label className="provider-checkbox"><input type="checkbox" checked={form.referenceEnabled} onChange={(event) => setForm({ ...form, referenceEnabled: event.target.checked })} /><span>允许 Gemini 参考图能力</span></label>{mode === 'create' && <label className="provider-checkbox"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /><span>保存后设为活动 Profile</span></label>}<div className="provider-form-actions"><button type="button" className="outline-button" onClick={cancelEdit}>取消</button><button type="submit" className="outline-button" disabled={Boolean(busy)}>{busy === 'save' ? <LoaderCircle className="spin" size={15} /> : null}保存</button><button type="button" className="command-button" disabled={Boolean(busy)} onClick={() => void save(true)}>{busy === 'save-restart' ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}保存并重启</button></div></form>}
      </section>
    </div>}
  </AccessibleDialog>
  {confirmation && <ConfirmationDialog label={confirmation.kind === 'delete' ? '确认删除 Provider Profile' : '确认清除连接信息'} title={confirmation.kind === 'delete' ? '删除 Provider Profile？' : '清除连接信息？'} message={confirmation.kind === 'delete' ? '删除 Profile“' + confirmation.profileName + '”？此操作不会删除历史运行。' : '清除连接信息会让该 Profile 暂时不可用。是否继续？'} confirmLabel={confirmation.kind === 'delete' ? '确认删除' : '继续清除'} tone={confirmation.kind === 'delete' ? 'danger' : 'warning'} onCancel={() => setConfirmation(null)} onConfirm={confirmPendingAction} />}
  </>;
}
