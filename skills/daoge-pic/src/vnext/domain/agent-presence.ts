import { createId, nowIso } from '../shared/ids';
import { StudioDatabase, withTransaction } from '../studio/database';
import { InvalidCommandError } from './studio-commands';

/**
 * Agent presence (plan 4.6 / 7.11.3).
 *
 * Studio only needs to answer one question before the user speaks: **is anyone
 * listening, and are they equipped to do the job**. So an Agent registers
 * itself — including an identity declaration of the skills it has — and the
 * presence card reads `last_seen_at` back out.
 *
 * Boundary (deliberate): skills themselves belong to the host. Studio never
 * manages them; it only *displays what the Agent declared*.
 */

/**
 * How long a registration still counts as "present".
 *
 * 15 minutes, not 2. Two different questions used to share one clock:
 *   1. "is anyone listening" — a status, which tolerates an idle gap (an agent
 *      sitting in a conversation has no operations to report, so nothing
 *      renews it);
 *   2. "has this request waited too long" — a nudge, which is impatient by
 *      design and is **already** controlled separately by `queueAttention`
 *      (2 minutes / 3 items, per 8.10#1).
 *
 * Conflating them made the status card claim the agent was gone while it was
 * still sitting right there. The card also always states *when* it was last
 * seen, so the user can judge rather than trust a binary.
 */
export const DEFAULT_AGENT_OFFLINE_AFTER_MS = 15 * 60 * 1000;

export interface DeclaredSkill { name: string; version?: string; }

export interface RegisterAgentInput {
  studioId: string;
  cliName: string;
  cliVersion?: string | null;
  skills?: DeclaredSkill[];
  capabilities?: Record<string, unknown>;
  now?: string;
}

export interface StudioAgent {
  id: string;
  studioId: string;
  cliName: string;
  cliVersion: string | null;
  skillName: string | null;
  skillVersion: string | null;
  capabilities: Record<string, unknown>;
  lastSeenAt: string;
  registeredAt: string;
}

export interface AgentPresence {
  present: boolean;
  offlineAfterMs: number;
  /** 当前**在场**的 agent（超过阈值的不在这里）。 */
  agents: StudioAgent[];
  /**
   * **最近一次**活动时间——包括已经离线的 agent。
   *
   * 界面要能说「最近一次活动在 25 分钟前」，这样用户自己判断要不要唤起它；
   * 只给在场者的话，离线时这里是 null，界面就只能说一句干巴巴的「不在场」。
   * （`present` 已经回答了「现在有没有人」，所以这个字段可以安心表示「历史最近」。
   *  之前它只统计在场者，导致「始终报最后活动时间」这个承诺在后端就落空了。）
   */
  lastSeenAt: string | null;
  /** 装了我们依赖的那个 skill 的 agent 才算「胜任」（在场 ≠ 胜任）。 */
  equipped: boolean;
  skills: DeclaredSkill[];
}

interface AgentRow {
  id: string; studio_id: string; cli_name: string; cli_version: string | null;
  skill_name: string | null; skill_version: string | null; capabilities_json: string;
  registered_at: string; last_seen_at: string;
}

function requiredText(value: unknown, label: string): string {
  const text = String(value || '').trim();
  if (!text) throw new InvalidCommandError(label + ' is required.');
  if (text.length > 160) throw new InvalidCommandError(label + ' is too long.');
  return text;
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function normalizeSkills(input: DeclaredSkill[] | undefined): DeclaredSkill[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((skill) => ({ name: String(skill?.name || '').trim().slice(0, 120), ...(skill?.version ? { version: String(skill.version).trim().slice(0, 40) } : {}) }))
    .filter((skill) => skill.name)
    .slice(0, 50);
}

function mapAgent(row: AgentRow): StudioAgent {
  return {
    id: row.id, studioId: row.studio_id, cliName: row.cli_name, cliVersion: row.cli_version,
    skillName: row.skill_name, skillVersion: row.skill_version,
    capabilities: parseRecord(row.capabilities_json),
    lastSeenAt: row.last_seen_at, registeredAt: row.registered_at
  };
}

/**
 * 登记/续报一次在场。**一个 CLI 只占一行**——重复登记是「心跳」，不是新增。
 *
 * 唯一键是 `(studio_id, cli_name)` 而不是带上 skill：`skill_name` 可为空，
 * 而 SQLite 在唯一约束里把每个 NULL 当作互不相等，按 skill 分身份会让
 * 「先不带技能登记、后带技能登记」产生两行幽灵（v41 修的就是这个）。
 * 申报的技能清单整体存进 `capabilities_json`，主技能落到列上供状态卡直接显示。
 */
export function registerStudioAgent(db: StudioDatabase, input: RegisterAgentInput): StudioAgent {
  const studioId = requiredText(input.studioId, 'studioId');
  const cliName = requiredText(input.cliName, 'cliName');
  const skills = normalizeSkills(input.skills);
  const primary = skills[0] || null;
  const timestamp = input.now || nowIso();
  return withTransaction(db, () => {
    const existing = db.prepare('SELECT id FROM studio_agents WHERE studio_id = ? AND cli_name = ?').get(studioId, cliName) as { id: string } | undefined;
    const capabilities = JSON.stringify({ skills, ...(input.capabilities || {}) });
    if (existing) {
      // 「申报了就覆盖，没申报就保持原样」——**续报不等于撤回**。
      // 一次不带技能的心跳如果顺手把 `capabilities_json` 也写掉，`skills` 会变空、
      // 状态卡就在「已装载 / 未申报」之间来回跳（`skill_name` 列还留着，两处会不一致）。
      const cliVersion = input.cliVersion ? String(input.cliVersion).slice(0, 40) : null;
      if (skills.length > 0) db.prepare('UPDATE studio_agents SET cli_version = ?, skill_name = ?, skill_version = ?, capabilities_json = ?, last_seen_at = ? WHERE id = ?')
        .run(cliVersion, primary.name, primary.version || null, capabilities, timestamp, existing.id);
      else db.prepare('UPDATE studio_agents SET cli_version = ?, last_seen_at = ? WHERE id = ?')
        .run(cliVersion, timestamp, existing.id);
    }
    else db.prepare('INSERT INTO studio_agents (id, studio_id, cli_name, cli_version, skill_name, skill_version, capabilities_json, registered_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(createId('agent'), studioId, cliName, input.cliVersion ? String(input.cliVersion).slice(0, 40) : null, primary?.name || null, primary?.version || null, capabilities, timestamp, timestamp);
    return mapAgent(db.prepare('SELECT * FROM studio_agents WHERE studio_id = ? AND cli_name = ?').get(studioId, cliName) as unknown as AgentRow);
  });
}

/**
 * 续报「我还活着」。
 *
 * 与 `registerStudioAgent` 的区别：**不新增、不改申报**，只把 `last_seen_at` 推到现在。
 * 用在「agent 刚刚跟 daemon 说过话」的地方——它持有并续租请求租约时就明确在场，
 * 那一刻没有任何理由显示它已经走了（实测踩过：续了租，在场卡却说「2 小时 40 分前」）。
 * 没登记过的 agent 不在这里凭空建档（在场必须先登记，这是 4.6 的约定）。
 */
export function touchStudioAgent(db: StudioDatabase, input: { studioId: string; cliName: string; now?: string }): void {
  const cliName = String(input.cliName || '').trim();
  if (!cliName) return;
  db.prepare('UPDATE studio_agents SET last_seen_at = ? WHERE studio_id = ? AND cli_name = ?')
    .run(input.now || nowIso(), input.studioId, cliName);
}

export function listStudioAgents(db: StudioDatabase, input: { studioId: string }): StudioAgent[] {
  return (db.prepare('SELECT * FROM studio_agents WHERE studio_id = ? ORDER BY last_seen_at DESC, cli_name').all(input.studioId) as unknown as AgentRow[]).map(mapAgent);
}

/**
 * 在场判定：最后活动时间在阈值内（默认 15 分钟）。**有记录 ≠ 在场**——agent 崩了也要能看出来。
 * `requiredSkill` 用来回答「在场 ≠ 胜任」：有人在，但没申报 daoge-pic。
 * 同时给出 `lastSeenAt`，界面**始终报「最后活动时间」**，不让人只靠一个二元状态判断。
 */
export function agentPresence(db: StudioDatabase, input: { studioId: string; now?: string; offlineAfterMs?: number; requiredSkill?: string }): AgentPresence {
  const now = input.now || nowIso();
  const offlineAfterMs = Number.isFinite(input.offlineAfterMs) ? Number(input.offlineAfterMs) : DEFAULT_AGENT_OFFLINE_AFTER_MS;
  const requiredSkill = String(input.requiredSkill || 'daoge-pic');
  const agents = listStudioAgents(db, { studioId: input.studioId });
  const presentAgents = agents.filter((agent) => Number.isFinite(Date.parse(agent.lastSeenAt)) && Date.parse(now) - Date.parse(agent.lastSeenAt) <= offlineAfterMs);
  // 最近活动时间**不过滤在场**：离线也要说得出「多久前还在」。
  const latestSeenAt = agents.reduce<string | null>((latest, agent) => (latest === null || agent.lastSeenAt > latest ? agent.lastSeenAt : latest), null);
  const skills: DeclaredSkill[] = [];
  for (const agent of agents) {
    const declared = Array.isArray(agent.capabilities.skills) ? agent.capabilities.skills as DeclaredSkill[] : [];
    for (const skill of declared) if (skill?.name && !skills.some((item) => item.name === skill.name)) skills.push({ name: String(skill.name), ...(skill.version ? { version: String(skill.version) } : {}) });
  }
  const equipped = skills.some((skill) => skill.name === requiredSkill);
  return {
    present: presentAgents.length > 0,
    offlineAfterMs,
    agents: presentAgents,
    lastSeenAt: latestSeenAt,
    equipped,
    skills
  };
}
