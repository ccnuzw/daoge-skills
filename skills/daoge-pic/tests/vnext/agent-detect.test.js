const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/**
 * C1 侦查的守卫（方案 4.6-1 / 7.11.3 · 施工单 C1）。
 *
 * 「侦查」只回答一个问题：这台机器上装了哪些 agent CLI、里面有没有 daoge-pic。
 * 它是**只读、不打扰**的——只在连接面板展开时才列结果，绝不登记、绝不改宿主目录。
 *
 * 判定全部走注入的探针（`probe`），所以测试不需要真的碰宿主目录，也不会
 * 因为跑测机器上恰好装了什么而变红。
 *
 * 夹具钉的是**路径身份**，不是拼写：探针和真实探针的 `fs.statSync` 一样按平台
 * 解析路径。侦查会把家目录根解析成绝对路径，win32 下 `/home/creator` 这类无盘符
 * 的根会补上当前盘符（`D:\home\creator`），夹具按原样比对就会把「侦查在这台机器上
 * 找不到家目录」误报成回归——v6.0.0 的 Windows CI 四个组合全栽在这里。
 */

/**
 * 认得的宿主名单（认得的理由：有确定的 user 级 skills 目录可查）。
 * 这张表是**契约**：加宿主是一次有意的改动，守卫要跟着改，不许悄悄漂移。
 */
const COVERED_HOSTS = ['workbuddy', 'codex', 'claude', 'opencode', 'gemini', 'agy', 'grok', 'omp', 'pi', 'cursor-agent', 'qwen', 'kimi', 'amp', 'droid', 'copilot'];

function requireDetectModule() {
  try {
    return require('../../dist/vnext/domain/agent-detect');
  } catch (error) {
    assert.fail('agent 侦查模块尚未实现：src/vnext/domain/agent-detect.ts（' + error.code + '）');
  }
}

function probeFor({ dirs = [], files = [], listings = {} } = {}) {
  const canonical = (value) => path.resolve(value);
  const dirSet = new Set(dirs.map(canonical));
  const fileSet = new Set(files.map(canonical));
  const listingSet = {};
  for (const [key, value] of Object.entries(listings)) listingSet[canonical(key)] = value;
  return {
    directoryExists: (value) => dirSet.has(canonical(value)),
    fileExists: (value) => fileSet.has(canonical(value)),
    listDirectory: (value) => listingSet[canonical(value)] || []
  };
}

test('侦查列出已装 CLI、已装 skill 与在 PATH 上的命令', () => {
  const { detectAgentClis } = requireDetectModule();
  const home = '/home/creator';
  const codexSkills = path.join(home, '.codex', 'skills');
  const sharedSkills = path.join(home, '.agents', 'skills');
  const binA = '/usr/local/bin';
  const binB = '/opt/bin';
  const report = detectAgentClis({
    homeRoot: home,
    pathValue: binA + path.delimiter + binB,
    probe: probeFor({
      dirs: [path.join(home, '.codex'), codexSkills, sharedSkills],
      files: [path.join(binA, 'codex'), path.join(binB, 'claude')],
      listings: { [codexSkills]: ['daoge-pic', 'other'], [sharedSkills]: ['daoge-pic'] }
    }),
    now: '2026-09-18T00:00:00.000Z'
  });
  assert.equal(report.scannedAt, '2026-09-18T00:00:00.000Z');
  const codex = report.clis.find((cli) => cli.name === 'codex');
  assert.equal(codex.onPath, true, 'codex 在 PATH 上');
  assert.equal(codex.homeExists, true);
  assert.equal(codex.hasDaogePic, true, '~/.codex/skills 里有 daoge-pic');
  const claude = report.clis.find((cli) => cli.name === 'claude');
  assert.equal(claude.onPath, true, 'claude 在 /opt/bin 上');
  assert.equal(claude.homeExists, false);
  assert.equal(claude.hasDaogePic, false);
  const workbuddy = report.clis.find((cli) => cli.name === 'workbuddy');
  assert.equal(workbuddy.onPath, false);
  assert.equal(report.shared.hasDaogePic, true, '~/.agents/skills 里有 daoge-pic');
  assert.equal(report.installedCount, 2, '装了的 CLI = codex + claude');
  assert.equal(report.anyDaogePic, true);
  assert.deepEqual(report.clis.map((cli) => cli.name), COVERED_HOSTS, '认得的宿主就是这张表——不许多、不许少');
  assert.equal(report.clis.every((cli) => typeof cli.label === 'string' && cli.label.length > 0 && typeof cli.command === 'string' && cli.command.length > 0), true, '每个宿主都有显示名与要查的命令');
  const antigravity = report.clis.find((cli) => cli.name === 'agy');
  assert.equal(antigravity.label, 'Antigravity CLI', '命令名不是产品名：面板上得说人话');
  assert.equal(antigravity.command, 'agy');
});

test('IDE 的数据目录不许当「装了 CLI」的证据（命令名与产品名也是两回事）', () => {
  const { detectAgentClis } = requireDetectModule();
  const home = path.resolve('/home/creator');
  const ideSkills = path.join(home, '.gemini', 'config', 'skills');
  const report = detectAgentClis({
    homeRoot: home,
    pathValue: '',
    probe: probeFor({
      dirs: [path.join(home, '.gemini'), path.join(home, '.gemini', 'antigravity'), path.join(home, '.gemini', 'antigravity-ide'), path.join(home, '.gemini', 'config'), ideSkills],
      listings: { [ideSkills]: ['daoge-pic'] }
    }),
    now: '2026-09-19T00:00:00.000Z'
  });
  const antigravity = report.clis.find((cli) => cli.name === 'agy');
  assert.equal(antigravity.homeExists, false, 'IDE / 2.0 的目录不是这个 CLI 的家');
  assert.equal(antigravity.hasDaogePic, false, 'IDE 那边装了 daoge-pic 也不等于 CLI 看得见');
  const gemini = report.clis.find((cli) => cli.name === 'gemini');
  assert.equal(gemini.homeExists, false, '~/.gemini 本体被 Antigravity 全家共用，不能当作装了 Gemini CLI');
  assert.equal(report.installedCount, 0, '一台 CLI 都没装时不许靠共用目录凑数');
});

test('主流宿主的目录按候选逐个查：XDG、agent 目录、本宿主自有目录都算数', () => {
  const { detectAgentClis } = requireDetectModule();
  // 报告里的路径是解析过的（win32 会补盘符），夹具根先解析好，比较的才是同一件事。
  const home = path.resolve('/home/creator');
  const opencodeSkills = path.join(home, '.config', 'opencode', 'skills');
  const ompSkills = path.join(home, '.omp', 'agent', 'skills');
  const piSkills = path.join(home, '.pi', 'agent', 'skills');
  const grokSkills = path.join(home, '.grok', 'skills');
  const grokAliases = path.join(home, '.config', 'agents', 'skills');
  const geminiCommands = path.join(home, '.gemini', 'commands');
  const report = detectAgentClis({
    homeRoot: home,
    pathValue: '/usr/local/bin',
    probe: probeFor({
      dirs: [path.join(home, '.config', 'opencode'), opencodeSkills, path.join(home, '.omp'), ompSkills, path.join(home, '.pi'), piSkills, path.join(home, '.grok'), grokSkills, grokAliases, geminiCommands],
      files: [path.join('/usr/local/bin', 'opencode'), path.join('/usr/local/bin', 'agy')],
      listings: {
        [opencodeSkills]: ['daoge-pic'],
        [ompSkills]: ['daoge-pic', 'other'],
        [piSkills]: ['other'],
        [grokAliases]: ['daoge-pic']
      }
    }),
    now: '2026-09-18T00:00:00.000Z'
  });
  const byName = (name) => report.clis.find((cli) => cli.name === name);
  assert.equal(byName('opencode').skillsPath, opencodeSkills, 'XDG 宿主装在 ~/.config/<name>/skills');
  assert.equal(byName('opencode').hasDaogePic, true);
  assert.equal(byName('omp').skillsPath, ompSkills, 'omp 的原生 user 级 skills 在 agent 目录下');
  assert.equal(byName('omp').hasDaogePic, true);
  assert.equal(byName('pi').homeExists, true, 'pi 有家目录但没装 daoge-pic');
  assert.equal(byName('pi').hasDaogePic, false);
  assert.equal(byName('grok').onPath, false, 'grok 命令不在 PATH 上');
  assert.equal(byName('grok').hasDaogePic, false, '~/.grok/skills 不存在，别把共享目录算到它头上');
  assert.equal(byName('agy').onPath, true, 'PATH 上找的是它的命令 agy');
  assert.equal(byName('gemini').homePath, geminiCommands, '候选里第一处存在的拿来展示（Gemini CLI 自有目录）');
  assert.equal(report.shared.skillsPath, grokAliases, '共享目录的第二个别名 ~/.config/agents/skills');
  assert.equal(report.shared.hasDaogePic, true);
});

test('什么都没装时侦查给空结果，而不是编造', () => {
  const { detectAgentClis } = requireDetectModule();
  const report = detectAgentClis({ homeRoot: '/home/nobody', pathValue: '', probe: probeFor(), now: '2026-09-18T00:00:00.000Z' });
  assert.equal(report.installedCount, 0);
  assert.equal(report.anyDaogePic, false);
  assert.deepEqual(report.clis.map((cli) => cli.name), COVERED_HOSTS, '一台都没装时也要把整张表报全（空结果不是空数组）');
  assert.equal(report.clis.every((cli) => !cli.onPath && !cli.homeExists && !cli.hasDaogePic), true);
});

test('探针抛错也不许把侦查整体打挂', () => {
  const { detectAgentClis } = requireDetectModule();
  const throwing = {
    directoryExists: () => { throw new Error('EACCES'); },
    fileExists: () => { throw new Error('EACCES'); },
    listDirectory: () => { throw new Error('EACCES'); }
  };
  const report = detectAgentClis({ homeRoot: '/root', pathValue: '/usr/bin', probe: throwing, now: '2026-09-18T00:00:00.000Z' });
  assert.equal(report.installedCount, 0);
  assert.deepEqual(report.clis.map((cli) => cli.name), COVERED_HOSTS);
});