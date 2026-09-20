const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildIdFromDistRoot, currentBuildId } = require('../../dist/vnext/shared/build-identity');
const { daemonBuildStatus, resolveConversation, resolveWorkspaceRoot } = require('../../dist/vnext/cli/daoge');

/**
 * 连接事实：三件 CLI **不许猜**的东西 —— daemon 跑的是不是当前构建、正在说话的是哪个 conversation、
 * 稳定工作区在哪。它们都曾经要 agent 用 ps/git/时间戳/宿主目录去「考古」，
 * 这份文件把「事实从哪来」钉死。
 */

function withTemporaryRoot(prefix, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('build identity follows content, not the directory it happens to live in', () => {
  withTemporaryRoot('daoge-pic-build-a-', (first) => {
    withTemporaryRoot('daoge-pic-build-b-', (second) => {
      fs.writeFileSync(path.join(first, 'cli.js'), 'module.exports = 1;\n');
      fs.writeFileSync(path.join(second, 'cli.js'), 'module.exports = 1;\n');
      assert.equal(buildIdFromDistRoot(first), buildIdFromDistRoot(second), '内容相同的两份构建必须是同一个身份');
      assert.match(buildIdFromDistRoot(first), /^[0-9a-f]{16}$/);

      fs.writeFileSync(path.join(second, 'cli.js'), 'module.exports = 2;\n');
      assert.notEqual(buildIdFromDistRoot(first), buildIdFromDistRoot(second), '内容变了身份必须变');

      fs.writeFileSync(path.join(second, 'cli.js'), 'module.exports = 1;\n');
      fs.writeFileSync(path.join(second, 'extra.js'), 'module.exports = 1;\n');
      assert.notEqual(buildIdFromDistRoot(first), buildIdFromDistRoot(second), '多出一个文件也是另一个构建');
    });
  });

  // 这个进程加载的是哪份安装：CLI 与 daemon 用同一把尺子，才谈得上「同一个构建」。
  assert.equal(currentBuildId(), buildIdFromDistRoot(path.resolve(__dirname, '../../dist/vnext')));
});

test('a daemon that cannot prove its build is stale, not assumed fresh', async () => {
  const record = { pid: 1, url: 'http://127.0.0.1:1', capability: 'c'.repeat(43), workspaceRoot: '/tmp/ws', heartbeatAt: new Date().toISOString() };
  const reply = (data) => async () => ({ ok: true, json: async () => ({ ok: true, data }) });

  const same = await daemonBuildStatus(record, reply({ buildId: currentBuildId(), runtime: { providerConcurrency: { active: 0 } } }));
  assert.equal(same.staleBuild, false);
  assert.equal(same.daemonBuildId, same.cliBuildId);

  // 旧构建根本不报 buildId：那就是比本 CLI 老，不许假装它是新的。
  const silent = await daemonBuildStatus(record, reply({ protocol: { name: 'daoge-pic-skill-protocol', version: '3.0.0' } }));
  assert.equal(silent.daemonBuildId, null);
  assert.equal(silent.staleBuild, true);

  const others = await daemonBuildStatus(record, reply({ buildId: '0'.repeat(16), runtime: { providerConcurrency: { active: 3 } } }));
  assert.equal(others.staleBuild, true);
  assert.equal(others.activeRequests, 3, '在飞请求数是「能不能换进程」的依据');

  const unreachable = await daemonBuildStatus(record, async () => { throw new Error('connection refused'); });
  assert.equal(unreachable.staleBuild, true);

  let called = 0;
  const bare = await daemonBuildStatus({ ...record, capability: undefined }, async () => { called += 1; return { ok: true, json: async () => ({ ok: true, data: {} }) }; });
  assert.equal(called, 0, '没有 capability 就没有可谈的 daemon');
  assert.equal(bare.staleBuild, false);

  const absent = await daemonBuildStatus(null, async () => { throw new Error('should not be called'); });
  assert.deepEqual(absent, { cliBuildId: currentBuildId(), daemonBuildId: null, staleBuild: false, activeRequests: 0 });
});

test('conversation identity comes from the host, never from a guess', () => {
  assert.deepEqual(resolveConversation('01a0be24-ef65-74e7-8e77-74cfac1d9644'), { id: '01a0be24-ef65-74e7-8e77-74cfac1d9644', source: 'flag' });
  assert.deepEqual(resolveConversation('auto', { OMP_CONVERSATION_ID: 'host-conversation' }), { id: 'host-conversation', source: 'env:OMP_CONVERSATION_ID' });
  assert.deepEqual(
    resolveConversation('auto', { DAOGE_CONVERSATION_ID: 'explicit-host-conversation', OMP_CONVERSATION_ID: 'host-conversation' }),
    { id: 'explicit-host-conversation', source: 'env:DAOGE_CONVERSATION_ID' },
    '宿主自己的变量优先于宿主专用的变量'
  );
  assert.deepEqual(resolveConversation(undefined, { DAOGE_CONVERSATION_ID: 'only-env' }), { id: 'only-env', source: 'env:DAOGE_CONVERSATION_ID' });
  assert.throws(() => resolveConversation('auto', {}), /无法确定当前 conversation ID/);
  assert.throws(() => resolveConversation(undefined, {}), /CLI 不会替会话猜测身份/);
});

test('workspace discovery only accepts an existing Studio and never invents one', () => {
  withTemporaryRoot('daoge-pic-workspace-', (root) => {
    const nested = path.join(root, 'daoge-skills', 'skills', 'daoge-pic');
    fs.mkdirSync(nested, { recursive: true });
    assert.throws(() => resolveWorkspaceRoot(undefined, nested), /需要 --workspace/, '没有 Studio 的目录树不许被当成工作区');

    fs.mkdirSync(path.join(root, 'daoge-studio'), { recursive: true });
    fs.writeFileSync(path.join(root, 'daoge-studio', 'studio.json'), JSON.stringify({ schemaVersion: 1, studioId: 'studio_x', workspaceRoot: root }));
    assert.equal(resolveWorkspaceRoot(undefined, nested), root, '祖先里的 Studio 就是稳定工作区');
    assert.equal(resolveWorkspaceRoot(undefined, root), root);

    // 显式路径照旧说了算：发现逻辑只在没给参数时兜底。
    assert.equal(resolveWorkspaceRoot(path.join(root, 'daoge-studio')), path.join(root, 'daoge-studio'));
  });
});