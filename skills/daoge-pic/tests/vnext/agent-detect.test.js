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
});

test('什么都没装时侦查给空结果，而不是编造', () => {
  const { detectAgentClis } = requireDetectModule();
  const report = detectAgentClis({ homeRoot: '/home/nobody', pathValue: '', probe: probeFor(), now: '2026-09-18T00:00:00.000Z' });
  assert.equal(report.installedCount, 0);
  assert.equal(report.anyDaogePic, false);
  assert.equal(report.clis.length, 3, '始终给出三个已知 CLI 的探测结论');
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
  assert.equal(report.clis.length, 3);
});