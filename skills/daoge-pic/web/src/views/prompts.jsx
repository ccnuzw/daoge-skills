import { PromptWorkspace } from '../prompt-workspace.jsx';
import { LockKeyhole } from 'lucide-react';

/** 界面批 E（E1.6）从 main.jsx 的 viewRenderers 拆出（行为零变化）。 */
export function PromptsView({ confirmation, generationConfirmationBusy, loading, openGenerationConfirmation, planVersions, planVersionsLoading, refreshPlanVersions, selectedRound, session }) {
  return <><><PromptWorkspace round={selectedRound} planVersions={planVersions} loading={planVersionsLoading} onRefresh={() => void refreshPlanVersions()} />{selectedRound?.status === 'awaiting_confirmation' && <section className="human-confirmation-gate"><div><p className="eyebrow">人工确认闸门 · 可写操作</p><h3>等待当前用户确认计划</h3><span>确认必须由你本人在这里点。会话只能发起确认请求；确认后由会话核算一遍，再开始出图。</span></div><button type="button" className="command-button" onClick={() => void openGenerationConfirmation()} disabled={!session || generationConfirmationBusy}><LockKeyhole size={16} />{generationConfirmationBusy ? '正在准备确认' : '审阅并确认计划'}</button></section>}</></>;
}
