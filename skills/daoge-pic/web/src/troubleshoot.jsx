import { useCallback, useState } from 'react';
import { Activity, Copy, Download, HardDrive, RefreshCw, ShieldAlert } from 'lucide-react';
import { runtimeHealthPresentation } from './runtime-health.mjs';
import { backupManifestFileName, backupManifestPayload, summarizeBackupManifest, troubleshootSummaryLine } from './troubleshoot-model.mjs';
import { BACKUP_COPY, DIAGNOSTIC_COPY, RECOVERY_COPY, RECOVERY_HELP_HINT, RECOVERY_STEPS, TROUBLESHOOT_INTRO } from './troubleshoot-copy.mjs';

/**
 * 疑难处理页。
 *
 * 这一页的边界是**刻意的**：只做只读的事（看状态、数一遍数据、导出清单、复制诊断），
 * 写数据的那一半（恢复）留给本机命令行 —— 它需要一道与「谁在调用」无关的防线，
 * 浏览器上的一个按钮给不了。所以这里**不放置恢复按钮**，只把路径和命令讲清楚。
 * 别为了「功能更全」在这里加恢复入口：那条路由在服务端就是 bearer-only，点了也只会拿到 403。
 */

/** 把内容存成文件。与谱系导出用同一套写法，别另造一份。 */
function saveJsonFile(content, fileName) {
  const blob = new Blob([content + '\n'], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function StatusBlock({ studio, recoveryPhase, repairing, onRefresh, onCopyDiagnostic, onRepair }) {
  const presentation = runtimeHealthPresentation(studio?.runtime, recoveryPhase);
  const repairable = recoveryPhase === 'ready'
    && [studio?.runtime?.workerPool?.state, studio?.runtime?.mediaWorkerPool?.state].some((state) => state === 'degraded' || state === 'failed');
  return <section className="troubleshoot-block" aria-label={DIAGNOSTIC_COPY.title}>
    <header className="troubleshoot-block-head"><Activity size={17} aria-hidden="true" /><div><h3>{DIAGNOSTIC_COPY.title}</h3><p>{DIAGNOSTIC_COPY.note}</p></div></header>
    <div className={'troubleshoot-status is-' + presentation.tone} role={presentation.tone === 'danger' ? 'alert' : 'status'} aria-live={presentation.live ? 'polite' : 'off'}>
      <strong>{presentation.title}</strong>
      <span>{presentation.detail}</span>
    </div>
    <div className="troubleshoot-actions">
      <button type="button" className="outline-button" onClick={onRefresh}><RefreshCw size={15} />{DIAGNOSTIC_COPY.refresh}</button>
      <button type="button" className="outline-button" onClick={onCopyDiagnostic}><Copy size={15} />{DIAGNOSTIC_COPY.copy}</button>
      {repairable && <button type="button" className="outline-button" disabled={repairing} onClick={onRepair}><RefreshCw size={15} className={repairing ? 'spin' : ''} />{DIAGNOSTIC_COPY.restart}</button>}
    </div>
    <p className="troubleshoot-note">{repairable ? DIAGNOSTIC_COPY.restartNote : DIAGNOSTIC_COPY.copyless}</p>
  </section>;
}

function BackupBlock({ request }) {
  const [state, setState] = useState({ status: 'idle', summary: null, error: '' });
  const running = state.status === 'running';
  const exportManifest = useCallback(async () => {
    setState({ status: 'running', summary: null, error: '' });
    try {
      const data = await request('/api/backup/manifest');
      const manifest = data?.manifest;
      saveJsonFile(backupManifestPayload(manifest), backupManifestFileName(new Date()));
      setState({ status: 'done', summary: summarizeBackupManifest(manifest), error: '' });
    } catch (error) {
      // 服务端拒绝的原因是有信息量的（例如素材数量超上限），照实显示，不自己改写。
      setState({ status: 'error', summary: null, error: error?.message || '后台服务没有说明原因。' });
    }
  }, [request]);
  return <section className="troubleshoot-block" aria-label={BACKUP_COPY.title}>
    <header className="troubleshoot-block-head"><HardDrive size={17} aria-hidden="true" /><div><h3>{BACKUP_COPY.title}</h3><p>{BACKUP_COPY.note}</p></div></header>
    <div className="troubleshoot-actions">
      <button type="button" className="command-button" disabled={running} onClick={() => void exportManifest()}>{running ? <RefreshCw size={15} className="spin" /> : <Download size={15} />}{running ? BACKUP_COPY.running : BACKUP_COPY.action}</button>
    </div>
    {running && <p className="troubleshoot-note">{BACKUP_COPY.slow}</p>}
    {state.status === 'error' && <div className="error-strip" role="alert"><ShieldAlert size={15} aria-hidden="true" /><span>{'没数成：' + state.error}</span></div>}
    {state.status === 'done' && <>
      <p className="troubleshoot-summary">{troubleshootSummaryLine(state.summary)}</p>
      <p className="troubleshoot-note">{BACKUP_COPY.done}{BACKUP_COPY.purpose}</p>
    </>}
  </section>;
}

function RecoveryBlock() {
  return <section className="troubleshoot-block troubleshoot-block-recovery" aria-label={RECOVERY_COPY.title}>
    <header className="troubleshoot-block-head"><ShieldAlert size={17} aria-hidden="true" /><div><h3>{RECOVERY_COPY.title}</h3><p>{RECOVERY_COPY.readonly}</p></div></header>
    <p className="troubleshoot-guardrail" role="note">{RECOVERY_COPY.guardrail}</p>
    <p className="eyebrow">{RECOVERY_COPY.stepsTitle}</p>
    <ol className="troubleshoot-steps">
      {RECOVERY_STEPS.map((step) => <li key={step.command}>
        <p>{step.purpose}</p>
        <code>{step.command}</code>
      </li>)}
    </ol>
    <p className="troubleshoot-note">{RECOVERY_COPY.note}</p>
    <p className="troubleshoot-note">{RECOVERY_HELP_HINT}</p>
  </section>;
}

export function Troubleshoot({ request, studio, recoveryPhase, repairing, onRefresh, onCopyDiagnostic, onRepair }) {
  return <section className="guide-stage guide-stage-full troubleshoot-stage">
    <header className="learning-masthead">
      <div>
        <p className="eyebrow">Studio 疑难处理</p>
        <h2>出问题的时候从这里开始</h2>
        <p>{TROUBLESHOOT_INTRO}</p>
      </div>
    </header>
    <StatusBlock studio={studio} recoveryPhase={recoveryPhase} repairing={repairing} onRefresh={onRefresh} onCopyDiagnostic={onCopyDiagnostic} onRepair={onRepair} />
    <BackupBlock request={request} />
    <RecoveryBlock />
  </section>;
}
