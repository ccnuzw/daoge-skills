const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readFrontendSource, readSource } = require('./source-text');

/**
 * 创作手册（Studio 学习中心）—— 2026-09-20 标准修订后的守卫。
 *
 * 新标准（刀哥委托）：这是一本**给创作者看**的手册，不是系统规格书。
 *   ① 覆盖同一条创作动线：建立项目 → 提出需求 → 生成运行 → 选片评审 → 资产交付；
 *      且**步骤名用产品词**（刀哥二稿）：「拿出去 / 看出图 / 挑图」这类口语步骤名退场；
 *   ② 每个主题都要能直接上手：「界面上怎么做」+「回对话怎么说」+ 至少三条要点；
 *   ③ 说人话：工程词退场；躲不开的术语首次出现给即时解释（名词表兜底）；
 *   ④ 产品事实保留（状态图例、成果 keep、ZIP、冻结、重试、就这么出…），但用人话写。
 */

test('创作手册覆盖同一条创作动线，且每个主题都能直接上手', async () => {
  const { LEARNING_FILTERS, LEARNING_PHASES, LEARNING_TOPICS } = await import('../../web/src/learning-center-content.mjs');
  const ids = new Set(LEARNING_TOPICS.map((topic) => topic.id));
  for (const required of ['projects', 'sessions', 'provider', 'plans', 'preflight', 'runs', 'history', 'assets', 'references', 'lineage', 'library', 'delivery', 'recovery', 'safety', 'shortcuts']) {
    assert.equal(ids.has(required), true, '缺主题：' + required);
  }
  assert.equal(ids.size, LEARNING_TOPICS.length, '主题 id 不许重复');
  assert.deepEqual(LEARNING_PHASES.map((phase) => phase.id), ['projects', 'plans', 'runs', 'assets', 'delivery'], '动线五步：建立项目 → 提出需求 → 生成运行 → 选片评审 → 资产交付');
  assert.equal(LEARNING_FILTERS.some((item) => item.id === 'assets'), true);
  for (const topic of LEARNING_TOPICS) {
    assert.ok(topic.kicker && topic.title && topic.summary, topic.id + ' 缺「标题 / 摘要」');
    assert.ok(topic.studio && topic.conversation, topic.id + ' 必须同时给「界面上怎么做」与「回对话怎么说」');
    assert.ok(Array.isArray(topic.checkpoints) && topic.checkpoints.length >= 3, topic.id + ' 的要点少于 3 条');
    assert.ok(['start', 'create', 'assets', 'delivery', 'safety'].includes(topic.group), topic.id + ' 的分组不在动线里');
  }
});

test('创作手册说人话：工程词退场', async () => {
  const { LEARNING_TOPICS } = await import('../../web/src/learning-center-content.mjs');
  const text = LEARNING_TOPICS.map((topic) => [topic.title, topic.summary, topic.studio, topic.conversation, ...topic.checkpoints].join(' ')).join('\n');
  for (const jargon of ['daemon', 'SSE', 'SQLite', 'Canary', 'write-only', 'Provider.db', 'studio.db', '预检', '端点', '脱敏']) {
    assert.doesNotMatch(text, new RegExp(jargon.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&')), '手册正文里还有工程词：' + jargon);
  }
  assert.doesNotMatch(text, /v5\.1[0-9]/, '手册里还留着旧版本号');
});

test('创作手册用产品词：口语步骤名退场（拿出去 / 看出图 / 挑图）', async () => {
  const { LEARNING_PHASES, LEARNING_TOPICS } = await import('../../web/src/learning-center-content.mjs');
  // 步骤名就是界面与产品文档里的词（资产交付是交付页的名字，生成运行是运行的名字）
  assert.deepEqual(LEARNING_PHASES.map((phase) => phase.label), ['建立项目', '提出需求', '生成运行', '选片评审', '资产交付']);
  const text = LEARNING_TOPICS.map((topic) => [topic.kicker, topic.title, topic.summary, topic.studio, topic.conversation, ...topic.checkpoints].join(' ')).join('\n');
  for (const colloquial of ['拿出去', '看出图', '挑图']) assert.doesNotMatch(text, new RegExp(colloquial), '手册里还有口语步骤名：' + colloquial);
  // 页面骨架（标题 / 搜索提示 / 使用边界）同样用产品词
  const chrome = readSource('web/src/learning-center.jsx');
  assert.match(chrome, /title="从提出需求到资产交付"/);
  assert.doesNotMatch(chrome, /拿出去/);
  assert.match(chrome, /比如：选片、交付、快捷键/);
  assert.match(chrome, /对话决定做什么，界面呈现过程与结果/);
});

test('离线策略专题整体退场（一页对照表不是创作者要的）', () => {
  const content = readSource('web/src/learning-center-content.mjs') + readSource('web/src/learning-center.jsx');
  assert.doesNotMatch(content, /offline-strategy|离线策略/);
  assert.equal(fs.existsSync(path.join(__dirname, '../../web/src/offline-strategy-model.mjs')), false, 'offline-strategy-model.mjs 必须随专题一起退场');
});

test('创作手册保留产品事实（人话版）', async () => {
  const { LEARNING_TOPICS } = await import('../../web/src/learning-center-content.mjs');
  const topicText = (id) => {
    const topic = LEARNING_TOPICS.find((item) => item.id === id);
    assert.ok(topic, `missing learning topic: ${id}`);
    return [topic.title, topic.summary, topic.studio, topic.conversation, ...topic.checkpoints].join(' ');
  };

  // 说一句 → 回执 → 确认（人的闸门）
  assert.match(topicText('plans'), /就这么出/);
  assert.match(topicText('plans'), /改一下/);
  assert.match(topicText('plans'), /不会出图、不会花钱/);
  // 核算不花钱
  assert.match(topicText('preflight'), /不产生费用|不出图/);
  assert.match(topicText('preflight'), /重新核算/);
  // 出图过程：暂停/取消/补图/完成提醒
  assert.match(topicText('runs'), /暂停或取消/);
  assert.match(topicText('runs'), /重试这 N 张/);
  assert.match(topicText('runs'), /出完了叫我/);
  // 出图记录：显式选择
  assert.match(topicText('history'), /先选择一次出图/);
  assert.match(topicText('history'), /短 ID/);
  // 挑图：状态图例五态 + 只 keep 进交付 + 快捷键
  const assets = topicText('assets');
  assert.match(assets, /状态图例/);
  assert.match(assets, /成果 keep/);
  assert.match(assets, /不采用/);
  assert.match(assets, /交付冻结/);
  assert.match(assets, /全选本页/);
  // 参考与衍生：跨项目边界 + 新批次
  assert.match(topicText('references'), /明确共享/);
  assert.match(topicText('references'), /衍生属于新批次/);
  // 画布：三视角 + 编辑模式
  assert.match(topicText('lineage'), /全局 \/ 按图片 \/ 按交付/);
  assert.match(topicText('lineage'), /编辑模式/);
  // 交付：三阶段 + ZIP + 冻结
  const delivery = topicText('delivery');
  assert.match(delivery, /准备/);
  assert.match(delivery, /导出/);
  assert.match(delivery, /ZIP/);
  assert.match(delivery, /冻结/);
  // 安全：密钥只写 + 确认只能人点
  const safety = topicText('safety');
  assert.match(safety, /只写不回显/);
  assert.match(safety, /计划确认只能由你亲手提交/);
  // 生成服务：不会自动联网
  assert.match(topicText('provider'), /不会联网/);
});

test('learning center only deep-links to Studio-global views', () => {
  const source = readFrontendSource();
  const content = readSource('web/src/learning-center-content.mjs');
  assert.match(source, /<LearningCenter onDismiss=\{dismissGuide\} onNavigate=\{\([^)]*\) => navigateRoute\(\{ view: [^}]+ \}\)\} \/>/);
  assert.match(content, /action: 'projects'/);
  assert.doesNotMatch(content, /action: 'library'/);
  assert.doesNotMatch(content, /action: 'runs'/);
  assert.doesNotMatch(content, /action: 'deliveries'/);
});