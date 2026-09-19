import { errorMessageForDisplay, isAbortError } from '../error-model.mjs';
import { bootstrapLocalStudioSession } from '../local-auth.mjs';
import { negotiateStudioVersion, versionProbeRequest } from '../version-negotiation-model.mjs';
import { api } from './api.js';
import { WorkbenchShell } from './workbench-shell.jsx';
import { useWorkbenchController } from './workbench-controller.jsx';
import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import { Component, useEffect, useState } from 'react';

export class WorkbenchErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error) { window.__daogeWorkbenchRenderError = error instanceof Error ? error.stack || error.message : String(error); }

  render() {
    if (this.state.failed) return <main className="fatal-error"><CircleAlert size={24} /><div><h1>无法显示工作台</h1><p>详情内容未能安全显示。刷新后可继续使用 Studio。</p></div><button type="button" className="command-button" onClick={() => window.location.reload()}>刷新</button></main>;
    return this.props.children;
  }
}


export function StudioVersionGate() {
  const [attempt, setAttempt] = useState(0);
  const [negotiation, setNegotiation] = useState(null);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/studio', versionProbeRequest({ signal: controller.signal }));
        const payload = await response.json().catch(() => null);
        const studio = payload && payload.ok === true ? payload.data : null;
        if (current) setNegotiation(negotiateStudioVersion(studio));
      } catch (error) {
        if (current && !isAbortError(error)) setNegotiation({ compatible: false, message: '无法连接到本地 Studio。请确认后台服务在运行后重试。' });
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [attempt]);

  if (!negotiation) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在连接 Studio</span></div>;
  if (negotiation.compatible) return <App />;
  return <main className="local-auth-failure" role="alert"><CircleAlert size={26} /><div><h1>界面与后台服务版本不一致</h1><p>{negotiation.message}</p></div><button type="button" className="command-button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} />重新检查</button></main>;
}


export function LocalStudioAuthorizationGate() {
  const [attempt, setAttempt] = useState(0);
  const [authorizationError, setAuthorizationError] = useState('');
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let current = true;
    setAuthorizationError('');
    setAuthorized(false);
    void bootstrapLocalStudioSession().then(() => {
      if (current) setAuthorized(true);
    }).catch((nextError) => {
      if (current) setAuthorizationError(errorMessageForDisplay(nextError, '本地 Studio 授权失败。请重试。'));
    });
    return () => { current = false; };
  }, [attempt]);

  if (authorized) return <StudioVersionGate />;
  if (!authorizationError) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在验证本地 Studio 授权</span></div>;
  return <main className="local-auth-failure" role="alert"><CircleAlert size={26} /><div><h1>无法授权本地 Studio</h1><p>{authorizationError}</p></div><button type="button" className="command-button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} />重试授权</button></main>;
}


/** 极薄的 App：一次取控制器，交给壳渲染（界面批 E · E1.6c）。 */
export function App() {
  const shellProps = useWorkbenchController();
  // 加载壳归 App（控制器只报状态、不返回 JSX；否则展开出的 props 全是 undefined）。
  if (shellProps.loading) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在连接 Studio</span></div>;
  return <WorkbenchShell {.../** @type {any} */ (shellProps)} />;
}
