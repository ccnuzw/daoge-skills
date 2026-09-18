/**
 * Agent 连接面板的展示与配置逻辑（方案 4.6 / 7.11.3 · 施工单 C1 / C4）。纯函数，可单测。
 *
 * 三块：侦查结果怎么读、配置怎么存、催促超时怎么算。都是「宿主侧便利」，
 * 不是 Studio 的领域事实——所以配置存在浏览器（与页面大小 / 侧栏折叠同类），
 * 不往 `studio.db` 里塞（红线 2.1 管的是进度与选片这类领域状态）。
 *
 * 边界（4.6）：skills 的管理归宿主，Studio 只侦查、只展示，从不代管。
 */

export const AGENT_CONNECTION_STORAGE_KEYS = Object.freeze({
  invokeCommand: 'daoge-pic:agent-invoke-command',
  attentionMinutes: 'daoge-pic:queue-attention-minutes'
});

/** 「怎么唤起 agent」的默认值——扫描到的主 CLI 是一个合理起点（可改）。 */
export const DEFAULT_AGENT_INVOKE_COMMAND = 'workbuddy';
export const MIN_ATTENTION_MINUTES = 1;
export const MAX_ATTENTION_MINUTES = 60;
/** 8.10#1 的默认阈值：等 2 分钟或积压 3 条，先到先触发。 */
export const DEFAULT_ATTENTION_MINUTES = 2;

/** 把任意输入收敛成合法的「催促超时」分钟数。 */
export function normalizeAttentionMinutes(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_ATTENTION_MINUTES;
  return Math.min(MAX_ATTENTION_MINUTES, Math.max(MIN_ATTENTION_MINUTES, number));
}

/** 唤起命令是自由文本（不是枚举），只做去空白与长度收敛。 */
export function normalizeInvokeCommand(value) {
  return String(value == null ? '' : value).trim().slice(0, 200);
}

function safeRead(storage, key) {
  try { return storage?.getItem ? storage.getItem(key) : null; } catch { return null; }
}

function safeWrite(storage, key, value) {
  try { storage?.setItem?.(key, value); } catch { /* 隐私模式禁写时静默降级 */ }
}

export function readAgentConnectionConfig(storage) {
  const rawCommand = safeRead(storage, AGENT_CONNECTION_STORAGE_KEYS.invokeCommand);
  const rawMinutes = safeRead(storage, AGENT_CONNECTION_STORAGE_KEYS.attentionMinutes);
  return {
    invokeCommand: rawCommand === null ? DEFAULT_AGENT_INVOKE_COMMAND : normalizeInvokeCommand(rawCommand),
    attentionMinutes: rawMinutes === null ? DEFAULT_ATTENTION_MINUTES : normalizeAttentionMinutes(rawMinutes)
  };
}

export function writeAgentConnectionConfig(storage, patch = {}) {
  const current = readAgentConnectionConfig(storage);
  const next = { ...current };
  if (patch.invokeCommand !== undefined) next.invokeCommand = normalizeInvokeCommand(patch.invokeCommand);
  if (patch.attentionMinutes !== undefined) next.attentionMinutes = normalizeAttentionMinutes(patch.attentionMinutes);
  safeWrite(storage, AGENT_CONNECTION_STORAGE_KEYS.invokeCommand, next.invokeCommand);
  safeWrite(storage, AGENT_CONNECTION_STORAGE_KEYS.attentionMinutes, String(next.attentionMinutes));
  return next;
}

/** 催促超时（毫秒）——交给 `queueAttention` 的 `thresholdMs`。 */
export function queueAttentionThresholdMs(minutes) {
  return normalizeAttentionMinutes(minutes) * 60 * 1000;
}

/**
 * 把后端侦查报告翻成面板能直接渲染的形状。
 * 三句话各司其职：装了几个 / 哪个在 PATH 上 / 有没有 daoge-pic。
 */
export function detectedCliSummary(detection) {
  const clis = Array.isArray(detection?.clis) ? detection.clis : [];
  const shared = detection?.shared || null;
  const rows = clis.map((cli) => ({
    name: String(cli?.name || ''),
    onPath: cli?.onPath === true,
    installed: cli?.onPath === true || cli?.homeExists === true || cli?.skillsExists === true,
    hasDaogePic: cli?.hasDaogePic === true,
    detail: [
      cli?.onPath === true ? '命令可用' : '命令不在 PATH',
      cli?.homeExists === true ? '已装' : '未见家目录',
      cli?.hasDaogePic === true ? '含 daoge-pic' : '未装 daoge-pic'
    ].join(' · ')
  }));
  const installedCount = Number.isFinite(detection?.installedCount) ? detection.installedCount : rows.filter((row) => row.installed).length;
  const anyDaogePic = detection?.anyDaogePic === true || shared?.hasDaogePic === true || rows.some((row) => row.hasDaogePic);
  return {
    rows,
    installedCount,
    anyDaogePic,
    sharedHasDaogePic: shared?.hasDaogePic === true,
    headline: installedCount === 0 ? '没检测到已安装的 agent CLI' : '检测到 ' + installedCount + ' 个 agent CLI',
    skillLine: anyDaogePic ? 'daoge-pic 已装载（至少一处）' : '没找到 daoge-pic；先 register-skill 再登记在场'
  };
}