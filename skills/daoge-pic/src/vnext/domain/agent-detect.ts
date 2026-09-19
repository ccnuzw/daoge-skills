import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nowIso } from '../shared/ids';

/**
 * Agent 侦查（方案 4.6-1 / 7.11.3 · 施工单 C1）。
 *
 * 只回答一个问题：**这台机器上装了哪些 agent CLI、里面有没有 daoge-pic**。
 *
 * 边界（划死，与 4.6 一致）：
 *   - 只读、不打扰——只在连接面板展开时列结果，不登记、不改宿主的 skills；
 *   - 「装在哪、在不在线、怎么唤起」归 Studio；「装了哪些 skill、怎么配」归宿主。
 *
 * 探针是可注入的：测试不需要真的碰宿主目录，跑测机器上恰好装了什么也不会把测试弄红。
 */
export const KNOWN_AGENT_CLIS = ['workbuddy', 'codex', 'claude'] as const;
export const REQUIRED_AGENT_SKILL = 'daoge-pic';

export interface AgentDetectProbe {
  directoryExists(target: string): boolean;
  fileExists(target: string): boolean;
  listDirectory(target: string): string[];
}

export interface DetectedAgentCli {
  /** 宿主 id（`--host` 的取值）。 */
  name: string;
  /** 面板显示名；命令名不是产品名时才与 `name` 不同（如 `agy` → Antigravity CLI）。 */
  label: string;
  /** 真正在 PATH 上找的命令（绝大多数等于 `name`）。 */
  command: string;
  /** 命令在 PATH 里找得到（可执行）。 */
  onPath: boolean;
  homePath: string;
  homeExists: boolean;
  skillsPath: string;
  skillsExists: boolean;
  /** 它的 skills 目录里有 daoge-pic（在场 ≠ 胜任的那半边）。 */
  hasDaogePic: boolean;
}

export interface AgentDetectionReport {
  scannedAt: string;
  homeRoot: string;
  clis: DetectedAgentCli[];
  shared: { skillsPath: string; exists: boolean; hasDaogePic: boolean };
  /** 有痕迹（命令 / 家目录 / skills 任一存在）的 CLI 数。 */
  installedCount: number;
  anyDaogePic: boolean;
}

/**
 * 认得的宿主：宿主 id + （可选的）显示名 + 命令候选 + 家目录候选 + skills 目录候选。
 *
 * 只收**既有命令又有确定的 skill 目录**的主流宿主——「装了哪些」可以只看命令，
 * 但「有没有 daoge-pic」必须有具体目录可查，否则就只能编。加一个宿主 = 加一行。
 *
 * 三条纪律：
 *   - `name` 是宿主 id，也是 `register-skill --host` 的取值，**默认等于命令名**；
 *   - 命令名不是产品名时补 `label`（面板显示用），`commands` 写出真正要查的二进制
 *     （`agy` 是 Antigravity CLI 的命令，用户认产品不认命令）；
 *   - 家目录只写**这个宿主自己**的目录。`~/.gemini` 这类被同厂其他产品共用的目录
 *     不许当证据：那会把「装了 IDE」报成「装了 CLI」。
 */
export interface AgentCliTarget {
  name: string;
  label?: string;
  commands?: readonly string[];
  homes: readonly string[];
  skills: readonly string[];
}

export const AGENT_CLI_TARGETS: ReadonlyArray<AgentCliTarget> = [
  { name: 'workbuddy', homes: ['.workbuddy'], skills: ['.workbuddy/skills'] },
  { name: 'codex', homes: ['.codex'], skills: ['.codex/skills'] },
  { name: 'claude', homes: ['.claude'], skills: ['.claude/skills'] },
  { name: 'opencode', homes: ['.config/opencode'], skills: ['.config/opencode/skills'] },
  // Gemini CLI 自己的目录是 `~/.gemini/commands` 与 `~/.gemini/skills`；`~/.gemini` 本体被 Antigravity 全家共用，不能当「装了它」的证据。
  { name: 'gemini', homes: ['.gemini/commands', '.gemini/skills'], skills: ['.gemini/skills'] },
  // Antigravity CLI（命令 `agy`）：只有 CLI 自己的目录算数；IDE 与 2.0 的 `~/.gemini/config`、`~/.gemini/antigravity` 不是这个 CLI。
  { name: 'agy', label: 'Antigravity CLI', homes: ['.gemini/antigravity-cli'], skills: ['.gemini/antigravity-cli/skills'] },
  { name: 'grok', homes: ['.grok'], skills: ['.grok/skills'] },
  // omp 的 user 级原生 skills 在 agent 目录下（profile 未切换时即 `~/.omp/agent/skills`）。
  { name: 'omp', homes: ['.omp'], skills: ['.omp/agent/skills'] },
  { name: 'pi', homes: ['.pi'], skills: ['.pi/agent/skills'] },
  { name: 'cursor-agent', homes: ['.cursor'], skills: ['.cursor/skills'] },
  { name: 'qwen', homes: ['.qwen'], skills: ['.qwen/skills'] },
  { name: 'kimi', homes: ['.kimi'], skills: ['.kimi/skills'] },
  { name: 'amp', homes: ['.config/amp'], skills: ['.config/amp/skills'] },
  { name: 'droid', homes: ['.factory'], skills: ['.factory/skills'] },
  { name: 'copilot', homes: ['.copilot'], skills: ['.copilot/skills'] }
];

/** 跨宿主共享的 skills 目录：主流宿主大多会读（装一次，多数能看见）。 */
export const AGENT_SHARED_SKILLS: ReadonlyArray<string> = ['.agents/skills', '.config/agents/skills'];

/** 装给「所有读共享目录的宿主」的伪宿主名（`register-skill --host agents`）——同时也是本模块的宿主拼写口径。 */
export const SHARED_SKILL_HOST = 'agents';

/** 宿主清单（帮助与报错共用一份）：共享伪宿主在前；命令名不是产品名时并排写清，免得用户照着拼。 */
export function skillHostChoices(): string[] {
  return [SHARED_SKILL_HOST, ...AGENT_CLI_TARGETS.map((target) => (target.label ? target.name + '（' + target.label + '）' : target.name))];
}

/** 某宿主把 skill 装到哪（相对 homeRoot）；未知宿主返回 null（不猜、不新建目录）。 */
export function skillHostDirectory(host: string): string | null {
  const name = String(host || '').trim();
  if (name === SHARED_SKILL_HOST) return AGENT_SHARED_SKILLS[0];
  return AGENT_CLI_TARGETS.find((target) => target.name === name)?.skills[0] ?? null;
}

/**
 * 真实探针。**任何一次探测失败都不许把整份报告打挂**——宿主目录权限、
 * 断链 symlink 都可能抛错，侦查的承诺是「静默」，不是「要么全有要么全无」。
 */
export function realAgentDetectProbe(): AgentDetectProbe {
  return {
    directoryExists(target: string): boolean {
      try { return fs.statSync(target).isDirectory(); } catch { return false; }
    },
    fileExists(target: string): boolean {
      try {
        if (!fs.statSync(target).isFile()) return false;
        fs.accessSync(target, fs.constants.X_OK);
        return true;
      } catch { return false; }
    },
    listDirectory(target: string): string[] {
      try { return fs.readdirSync(target); } catch { return []; }
    }
  };
}

function safely<T>(work: () => T, fallback: T): T {
  try { return work(); } catch { return fallback; }
}

/**
 * 扫已知的 agent 家目录、共享 skills 目录与 PATH，回报「装了哪些 CLI」。
 * **不做任何写入**，也不登记在场——登记是 agent 自己的动作（C2）。
 */
export function detectAgentClis(input: {
  homeRoot?: string;
  pathValue?: string;
  probe?: AgentDetectProbe;
  requiredSkill?: string;
  now?: string;
} = {}): AgentDetectionReport {
  const homeRoot = path.resolve(input.homeRoot || os.homedir());
  const pathValue = typeof input.pathValue === 'string' ? input.pathValue : (process.env.PATH || '');
  const probe = input.probe || realAgentDetectProbe();
  const requiredSkill = String(input.requiredSkill || REQUIRED_AGENT_SKILL).trim() || REQUIRED_AGENT_SKILL;
  const pathEntries = pathValue.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
  // 候选目录逐个看：第一个存在的用来展示，**任意一处**含 daoge-pic 都算这个宿主看得见。
  const scan = (relativePaths: readonly string[]): { path: string; exists: boolean; hasDaogePic: boolean } => {
    const candidates = relativePaths.map((relative) => path.join(homeRoot, relative));
    const existing = candidates.filter((candidate) => safely(() => probe.directoryExists(candidate), false));
    return {
      path: existing[0] || candidates[0],
      exists: existing.length > 0,
      hasDaogePic: existing.some((candidate) => safely(() => probe.listDirectory(candidate).includes(requiredSkill), false))
    };
  };
  const clis: DetectedAgentCli[] = AGENT_CLI_TARGETS.map((target) => {
    const home = scan(target.homes);
    const skills = scan(target.skills);
    const command = target.commands?.[0] || target.name;
    const onPath = pathEntries.some((entry) => safely(() => probe.fileExists(path.join(entry, command)), false));
    return { name: target.name, label: target.label || target.name, command, onPath, homePath: home.path, homeExists: home.exists, skillsPath: skills.path, skillsExists: skills.exists, hasDaogePic: skills.hasDaogePic };
  });
  const shared = scan(AGENT_SHARED_SKILLS);
  return {
    scannedAt: input.now || nowIso(),
    homeRoot,
    clis,
    shared: { skillsPath: shared.path, exists: shared.exists, hasDaogePic: shared.hasDaogePic },
    installedCount: clis.filter((cli) => cli.onPath || cli.homeExists || cli.skillsExists).length,
    anyDaogePic: shared.hasDaogePic || clis.some((cli) => cli.hasDaogePic)
  };
}