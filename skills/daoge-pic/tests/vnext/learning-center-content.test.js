const test = require('node:test');
const assert = require('node:assert/strict');

test('learning center covers every core Studio domain with structured guidance', async () => {
  const { LEARNING_FILTERS, LEARNING_PHASES, LEARNING_TOPICS } = await import('../../web/src/learning-center-content.mjs');
  const ids = new Set(LEARNING_TOPICS.map((topic) => topic.id));
  for (const required of ['projects', 'sessions', 'provider', 'plans', 'preflight', 'runs', 'history', 'assets', 'references', 'library', 'delivery', 'recovery', 'safety']) assert.equal(ids.has(required), true);
  assert.equal(ids.size, LEARNING_TOPICS.length);
  assert.equal(LEARNING_FILTERS.some((item) => item.id === 'assets'), true);
  assert.deepEqual(LEARNING_PHASES.map((phase) => phase.id), ['projects', 'plans', 'runs', 'assets', 'delivery']);
  for (const topic of LEARNING_TOPICS) {
    assert.ok(topic.summary && topic.studio && topic.conversation);
    assert.ok(Array.isArray(topic.checkpoints) && topic.checkpoints.length >= 3);
    assert.ok(['start', 'create', 'assets', 'delivery', 'safety'].includes(topic.group));
  }
});

test('learning center matches the stable session, Provider, preflight, history, asset, and delivery contracts', async () => {
  const { LEARNING_TOPICS } = await import('../../web/src/learning-center-content.mjs');
  const topicText = (id) => {
    const topic = LEARNING_TOPICS.find((item) => item.id === id);
    assert.ok(topic, `missing learning topic: ${id}`);
    return [topic.title, topic.summary, topic.studio, topic.conversation, ...topic.checkpoints].join(' ');
  };

  const sessions = topicText('sessions');
  assert.match(sessions, /共享唯一 daemon 与 Workbench/);
  assert.match(sessions, /独立 Studio Session/);
  assert.match(sessions, /新打开与安全复用/);

  const provider = topicText('provider');
  assert.match(provider, /Provider\.db/);
  assert.match(provider, /只写/);
  assert.match(provider, /不会自动连接 Provider/);
  assert.match(provider, /明确发起“连接测试”/);

  const safety = topicText('safety');
  assert.match(safety, /不进入 studio\.db、事件、日志、导出或诊断/);
  assert.doesNotMatch(safety, /密钥不进入数据库/);

  const preflight = topicText('preflight');
  assert.match(preflight, /1\.\.1000/);
  assert.match(preflight, /默认 4/);
  assert.match(preflight, /串行使用 1/);
  assert.match(preflight, /queue 和 run 阶段不能另改/);
  assert.match(preflight, /计划、Profile 版本或并发变化时必须重新预检/);

  const history = topicText('history');
  assert.match(history, /明确选择/);
  assert.match(history, /活跃运行和最新运行都不会被静默/);
  assert.match(history, /刷新和 SSE 重连/);

  assert.match(topicText('projects'), /名称搜索、生命周期筛选和有界分页/);
  const assets = topicText('assets');
  assert.match(assets, /默认每页 24 张/);
  assert.match(assets, /16、24、32、48、64、96/);
  assert.match(assets, /一次导入多张图片/);
  assert.match(assets, /全选本页/);

  const delivery = topicText('delivery');
  assert.match(delivery, /全选或取消全选交付图片/);
  assert.match(delivery, /ZIP/);
});
const fs = require('node:fs');
const path = require('node:path');

test('learning center only deep-links to Studio-global views', () => {
  const skillRoot = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const content = fs.readFileSync(path.join(skillRoot, 'web/src/learning-center-content.mjs'), 'utf8');
  assert.match(source, /<LearningCenter onDismiss=\{dismissGuide\} onNavigate=\{\([^)]*\) => navigateRoute\(\{ view: [^}]+ \}\)\} \/>/);
  assert.match(content, /action: 'projects'/);
  assert.match(content, /action: 'library'/);
  assert.doesNotMatch(content, /action: 'runs'/);
  assert.doesNotMatch(content, /action: 'deliveries'/);
});
