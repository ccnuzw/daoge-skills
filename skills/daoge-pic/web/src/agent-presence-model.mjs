/**
 * Agent 在场的展示逻辑（方案 4.6 / 7.11.3）。纯函数，可单测。
 *
 * 用户说一句话之前最想知道的是「有没有人在听」，其次才是「接单的会不会按
 * daoge-pic 的规范出图」。所以状态卡分两句话：
 *   - 在场：有没有 agent、最后活动时间；
 *   - 胜任：它申报了 daoge-pic 没有（**在场 ≠ 胜任**）。
 *
 * 边界：skills 的管理归宿主，这里只展示 agent 的**自我申报**。
 */

export const REQUIRED_SKILL = 'daoge-pic';

function minutesAgo(lastSeenAt, now) {
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.round((now - seen) / 60000));
}

/** 「刚刚 / N 分钟前」——状态卡只说人话。 */
export function lastSeenLabel(lastSeenAt, now = Date.now()) {
  const minutes = minutesAgo(lastSeenAt, now);
  if (minutes === null) return '';
  if (minutes < 1) return '刚刚还在';
  if (minutes < 60) return minutes + ' 分钟前还在';
  const hours = Math.round(minutes / 60);
  return hours < 24 ? hours + ' 小时前还在' : '很久没出现了';
}

/**
 * 状态卡形态。
 *   - 不在场：提示唤起（输入框点下去不能石沉大海）；
 *   - 在场但没申报所需 skill：明确提示「在场 ≠ 胜任」；
 *   - 在场且胜任：报「已装载」。
 */
export function agentPresencePresentation(presence, input = {}) {
  const requiredSkill = String(input.requiredSkill || REQUIRED_SKILL);
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const present = presence?.present === true;
  const equipped = presence?.equipped === true;
  const declared = Array.isArray(presence?.skills) ? presence.skills : [];
  // 无论在场与否，**都报最后活动时间**——让人自己判断，而不是只信一个二元状态。
  const seen = lastSeenLabel(presence?.lastSeenAt || presence?.agents?.[0]?.lastSeenAt, now);
  const everSeen = Boolean(presence?.lastSeenAt || presence?.agents?.length);
  if (!present) {
    return {
      tone: 'quiet',
      label: 'agent 不在场',
      equipped: false,
      // `seen` 形如「38 分钟前还在」——去掉「还在」就直接是「38 分钟前」，
      // 不要再补一个「前」（这里是「在 38 分钟前」，不是「在 38 分钟前前」）。
      detail: everSeen && seen
        ? '最近一次活动在 ' + seen.replace('还在', '') + '；说一句会先排上队，唤起 agent 就会接单。'
        : '说一句会先排上队；唤起 agent 就会接单。',
      declared
    };
  }
  if (!equipped) return { tone: 'warning', label: 'agent 在场 · 未申报 ' + requiredSkill, equipped: false, detail: '它没申报装了这个 skill，可能不会按规范出图；' + (seen || '刚刚还在') + '。', declared };
  const loaded = declared.find((skill) => skill?.name === requiredSkill);
  return { tone: 'ready', label: 'agent 在场 · ' + requiredSkill + ' 已装载' + (loaded?.version ? ' v' + loaded.version : ''), equipped: true, detail: seen, declared };
}

/** 输入框旁的那一句（未申报时最该被看到）。 */
export function agentReadinessHint(presence, input = {}) {
  const presentation = agentPresencePresentation(presence, input);
  if (!presentation.equipped) return presentation.label + '：' + presentation.detail;
  return '';
}
