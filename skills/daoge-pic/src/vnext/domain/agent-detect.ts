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
  name: string;
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

const CLI_TARGETS: ReadonlyArray<{ name: string; home: string; skills: string }> = [
  { name: 'workbuddy', home: '.workbuddy', skills: '.workbuddy/skills' },
  { name: 'codex', home: '.codex', skills: '.codex/skills' },
  { name: 'claude', home: '.claude', skills: '.claude/skills' }
];
const SHARED_SKILLS = '.agents/skills';

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
  const skillsContain = (skillsPath: string): boolean => safely(() => probe.listDirectory(skillsPath).includes(requiredSkill), false);
  const clis: DetectedAgentCli[] = CLI_TARGETS.map((target) => {
    const homePath = path.join(homeRoot, target.home);
    const skillsPath = path.join(homeRoot, target.skills);
    const homeExists = safely(() => probe.directoryExists(homePath), false);
    const skillsExists = safely(() => probe.directoryExists(skillsPath), false);
    const onPath = pathEntries.some((entry) => safely(() => probe.fileExists(path.join(entry, target.name)), false));
    const hasDaogePic = skillsExists && skillsContain(skillsPath);
    return { name: target.name, onPath, homePath, homeExists, skillsPath, skillsExists, hasDaogePic };
  });
  const sharedSkillsPath = path.join(homeRoot, SHARED_SKILLS);
  const sharedExists = safely(() => probe.directoryExists(sharedSkillsPath), false);
  const sharedHasDaogePic = sharedExists && skillsContain(sharedSkillsPath);
  return {
    scannedAt: input.now || nowIso(),
    homeRoot,
    clis,
    shared: { skillsPath: sharedSkillsPath, exists: sharedExists, hasDaogePic: sharedHasDaogePic },
    installedCount: clis.filter((cli) => cli.onPath || cli.homeExists || cli.skillsExists).length,
    anyDaogePic: sharedHasDaogePic || clis.some((cli) => cli.hasDaogePic)
  };
}