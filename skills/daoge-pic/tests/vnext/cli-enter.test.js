const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { createProject } = require('../../dist/vnext/domain/studio-commands');
const { parseCommand, usage, usageFull, projectSummaries, resolveProjectSelection, enterStudio, skillReferenceSection } = require('../../dist/vnext/cli/daoge');

/**
 * 「连接」必须是一步，而不是五步。
 *
 * 之前 agent 要连上 Studio 并进入一个项目，得自己串起 agent-register / open / session /
 * session-context / request-list，每一步都是一次模型往返；而「进入项目：美女写真」根本没有
 * 可用的 CLI —— session-context 只吃 projectId，传名字只会 Project not found。这里钉死
 * 两件事：enter 一步做完连接，项目名解析确定性且绝不瞎猜。
 */

test('enter is a first-class one-shot command and project-list exposes discovery', () => {
  const root = path.join(os.tmpdir(), 'daoge-pic-enter-workspace');
  const parsed = parseCommand(['enter', '--workspace', root, '--conversation', 'conv-1', '--project', '美女写真', '--cli', 'omp', '--cli-version', '1.0.0', '--skill', 'daoge-pic', '--skill-version', '6.0.0']);
  assert.equal(parsed.action, 'enter');
  assert.deepEqual(parsed.enter, { conversation: 'conv-1', project: '美女写真', cli: 'omp', cliVersion: '1.0.0', skill: 'daoge-pic', skillVersion: '6.0.0' });
  assert.equal(parsed.force, false);
  assert.throws(() => parseCommand(['enter', '--workspace', root]), /需要 --conversation/);
  // 速览只给命令名；全签名在 usageFull / `--help --full`。
  assert.match(usage(), /daoge enter  # /);
  assert.match(usage(), /daoge project-list  # /);
  assert.match(usageFull(), /daoge enter --workspace <path> .*--conversation <文本>/);
});

test('project resolution never guesses between同名项目', () => {
  const projects = [
    { id: 'project_a', name: '美女写真', status: 'active' },
    { id: 'project_b', name: '日系写真', status: 'active' }
  ];
  assert.deepEqual(resolveProjectSelection(projects, 'project_a'), { resolution: 'matched', matched: projects[0], candidates: [] });
  assert.equal(resolveProjectSelection(projects, '美女写真').matched.id, 'project_a', '精确项目名要命中');
  assert.equal(resolveProjectSelection(projects, '美女').matched.id, 'project_a', '唯一的包含匹配可以命中');
  assert.equal(resolveProjectSelection(projects, '').resolution, 'not-requested');
  assert.equal(resolveProjectSelection(projects, '不存在的项目').resolution, 'not-found');

  const ambiguous = resolveProjectSelection(projects, '写真');
  assert.equal(ambiguous.resolution, 'ambiguous', '多个项目都叫「写真」时不许替用户选');
  assert.equal(ambiguous.matched, null);
  assert.equal(ambiguous.candidates.length, 2);

  const duplicates = resolveProjectSelection([...projects, { id: 'project_c', name: '美女写真', status: 'active' }], '美女写真');
  assert.equal(duplicates.resolution, 'ambiguous');
  assert.equal(duplicates.candidates.length, 2);
});

test('project resolution prefers the active project over an archived同名 project', () => {
  const projects = [
    { id: 'project_archived', name: '鉴权表复验临时项目', status: 'archived' },
    { id: 'project_active', name: '鉴权表复验临时项目', status: 'active' },
    { id: 'project_old', name: '日系写真与高端网红自拍', status: 'archived' }
  ];
  // 真实场景：本机的 Studio 里同一个名字的 active/archived 各有一个。旧规则会在这里
  // 判成 ambiguous，让用户为一个早就不用的项目再确认一次 —— 归档项目不该制造歧义。
  const sameName = resolveProjectSelection(projects, '鉴权表复验临时项目');
  assert.equal(sameName.resolution, 'matched');
  assert.equal(sameName.matched.id, 'project_active');

  // 唯一归档命中仍然可以用：用户就是点名了它。
  const onlyArchived = resolveProjectSelection(projects, '日系写真与高端网红自拍');
  assert.equal(onlyArchived.resolution, 'matched');
  assert.equal(onlyArchived.matched.id, 'project_old');

  // 两个 active 才算歧义；候选把 active 排前面，让「选哪个」这件事一眼可判。
  const ambiguous = resolveProjectSelection([
    { id: 'project_a1', name: '短剧出海', status: 'active' },
    { id: 'project_a2', name: '短剧出海', status: 'active' },
    { id: 'project_a3', name: '短剧出海（旧）', status: 'archived' }
  ], '短剧出海');
  assert.equal(ambiguous.resolution, 'ambiguous');
  assert.deepEqual(ambiguous.candidates.map((project) => project.id), ['project_a1', 'project_a2']);

  const archivedAmbiguous = resolveProjectSelection([
    { id: 'project_z1', name: '旧项目甲', status: 'archived' },
    { id: 'project_z2', name: '旧项目甲', status: 'archived' }
  ], '旧项目甲');
  assert.equal(archivedAmbiguous.resolution, 'ambiguous');
  assert.equal(archivedAmbiguous.candidates.length, 2);

  // 精确名没命中、包含匹配落在同一分档规则上。
  const partial = resolveProjectSelection(projects, '复验临时');
  assert.equal(partial.resolution, 'matched');
  assert.equal(partial.matched.id, 'project_active');
});

test('projectSummaries drops malformed rows', () => {
  assert.deepEqual(
    projectSummaries({ projects: [{ id: 'p1', name: 'A', status: 'active' }, { id: '', name: 'B' }, null, 'x'] }),
    [{ id: 'p1', name: 'A', status: 'active' }]
  );
  assert.deepEqual(projectSummaries(undefined), []);
});

test('enterStudio connects, resolves the project by name, binds context, and reads the queue in one call', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-enter-'));
  const initialized = initializeStudio({ workspaceRoot });
  const started = await startLocalStudioService({ hardenAccess: false, workspaceRoot, ssePollMs: 20 });
  try {
    const project = createProject(started.service.db, { studioId: initialized.manifest.studioId, name: '美女写真', idempotencyKey: 'enter-project' }).value;
    const record = { pid: process.pid, url: started.url, capability: started.access.bearerToken, workspaceRoot, heartbeatAt: new Date().toISOString() };
    const opened = [];
    const result = await enterStudio(record, { conversation: 'conv-enter', project: '美女写真', cli: 'omp', cliVersion: '1.0.0', skill: 'daoge-pic', skillVersion: '6.0.0' }, false, async (url) => { opened.push(url); });
    assert.equal(result.workbench.opened, true);
    assert.equal(opened.length, 1, '只有 opener 持有者才真的调用浏览器');
    assert.equal(result.projectResolution, 'matched');
    assert.equal(result.project.id, project.id);
    assert.equal(result.session.projectId, project.id, '进入项目 = 会话上下文绑定了该项目');
    assert.equal(result.agent.skillName, 'daoge-pic');
    assert.equal(result.agent.skillVersion, '6.0.0');
    // 命中时不再回传整个项目目录（约 1.7 KB），只给计数；未命中才给候选与全量。
    assert.equal(result.projects, undefined);
    assert.equal(result.projectCount, 1);
    assert.equal(Array.isArray(result.pendingRequests), true);
    assert.equal(result.pendingRequestCount, 0);
    assert.equal(result.contextBound, true, '这次调用真的写了会话上下文 —— agent 据此汇报「已进入」');
    assert.equal(result.conversationSource, 'flag');
    assert.equal(result.build.staleBuild, false, '同一个 dist 的 daemon 必须被认成当前构建');
    assert.equal(result.build.daemonBuildId, result.build.cliBuildId);

    // 同一个 conversation 再连一次：复用同一个会话，绝不新建。
    const again = await enterStudio(record, { conversation: 'conv-enter', project: project.id }, false, async () => {});
    assert.equal(again.session.id, result.session.id);
    assert.equal(again.project.id, project.id);
    assert.equal(again.conversationSource, 'flag');

    // 项目名解析不到时给候选，而不是把整次连接砸掉。
    const missing = await enterStudio(record, { conversation: 'conv-enter-2', project: '写真是' }, false, async () => {});
    assert.equal(missing.projectResolution, 'not-found');
    assert.equal(missing.project, null);
    assert.equal(Array.isArray(missing.projects), true);
    // 没有绑定就必须说没有绑定：session.projectId 是新会话的指针（这里的会话是新的，所以为空），
    // agent 不能只读 session.projectId 就汇报「已进入某个项目」。
    assert.equal(missing.contextBound, false);
    assert.equal(missing.session.projectId, null);
  } finally {
    await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('效率命令与速览：round-status / plan --challenge / reference --section / --help 速览', () => {
  const rs = parseCommand(['round-status', '--workspace', '/tmp/ws', '--round', 'r1', '--session', 's1']);
  assert.equal(rs.action, 'round-status');
  assert.deepEqual(rs.roundStatus, { roundId: 'r1', sessionId: 's1' });

  // 写计划 + 建挑战合并成一次调用；sessionId 只喂给挑战，不能混进 plan 请求体。
  const plan = parseCommand(['plan', '--workspace', '/tmp/ws', '--round', 'r1', '--version', '2', '--plan', '{}', '--session', 's1', '--challenge', 'true']);
  assert.deepEqual(plan.planChallenge, { roundId: 'r1', sessionId: 's1' });
  assert.deepEqual(plan.request.body, { expectedVersion: 2, plan: {} });
  const noSession = parseCommand(['plan', '--workspace', '/tmp/ws', '--round', 'r1', '--version', '2', '--plan', '{}', '--challenge', 'true']);
  assert.equal(noSession.planChallenge.sessionId, '', '缺 --session 时由 main fail-loud');

  const ref = parseCommand(['reference', 'startup', '--section', 'enter 返回字段']);
  assert.equal(ref.referenceTopic, 'startup');
  assert.equal(ref.referenceSection, 'enter 返回字段');

  const body = fs.readFileSync(path.join(__dirname, '../../references/startup.md'), 'utf8');
  const section = skillReferenceSection(body, 'enter 返回字段');
  assert.ok(section.length < body.length / 2, '只取一节必须明显短于整份附录');
  assert.match(section, /contextBound/);
  assert.throws(() => skillReferenceSection(body, '不存在的节'), /未找到章节/);

  assert.ok(usage().length < usageFull().length, '速览必须短于全签名');
  assert.match(usageFull(), /daoge round-status --workspace <path>/);
});
