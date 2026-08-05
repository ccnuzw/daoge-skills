const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readJson, skillRoot } = require('../helpers/workspace_v2_test_utils');
const { inferTaskId, loadTaskCatalog, resolveTask } = require('../../src/shared/workspace');

test('task_catalog_zh exposes six user-first starter tasks', () => {
  const catalog = readJson(path.join(skillRoot, 'references', 'task_catalog_zh.json'));
  const ids = catalog.tasks.map((item) => item.id);
  ['portrait', 'studio', 'ecommerce', 'packaging', 'cinematic', 'oralboard'].forEach((id) => {
    assert.equal(ids.includes(id), true, `missing ${id}`);
  });
  catalog.tasks.forEach((task) => {
    assert.equal(typeof task.name, 'string');
    assert.equal(typeof task.plainSummary, 'string');
    assert.equal(Array.isArray(task.bestFor), true);
    assert.equal(Array.isArray(task.userNeeds), true);
    assert.match(task.startCommand, /^--intent /);
    assert.equal(typeof task.defaultStart, 'string');
    assert.equal(Object.prototype.hasOwnProperty.call(task, 'internalMapping'), false);
  });
  const text = JSON.stringify(catalog).toLowerCase();
  ['template', 'variant', 'manifest', 'registry', 'runtime', 'artifact', 'slot'].forEach((term) => {
    assert.equal(text.includes(term), false, `found ${term}`);
  });
});

test('resolveTask loads catalog from skill root by default', () => {
  const catalog = readJson(path.join(skillRoot, 'references', 'task_catalog_zh.json'));
  const expected = catalog.tasks.find((item) => item.id === 'ecommerce');
  const task = resolveTask({ intent: 'ecommerce' });
  assert.equal(task.id, 'ecommerce');
  assert.equal(task.title, expected.name);
  assert.equal(task.summary, expected.plainSummary);
});

test('resolveTask uses user brief as task title when no explicit title is provided', () => {
  const task = resolveTask({
    contentBrief: '宿主侧成功和复核导入验证',
    outputMode: 'host native validation',
  });
  assert.equal(task.title, '宿主侧成功和复核导入验证');
  assert.equal(task.summary, '宿主侧成功和复核导入验证');
});

test('resolveTask preserves registry-only task ids instead of falling back to portrait', () => {
  const task = resolveTask({
    intent: 'asset-prop-sheet',
    contentBrief: '游戏道具资产板，包含道具阵列和材质展示',
  });
  assert.equal(task.id, 'asset-prop-sheet');
  assert.equal(task.title, '游戏道具资产板，包含道具阵列和材质展示');
  assert.equal(task.name, '游戏道具资产板，包含道具阵列和材质展示');
});

test('inferTaskId keeps explicit taskId ahead of natural-language intent', () => {
  const taskId = inferTaskId({
    taskId: 'technical-diagram',
    intent: '想做一张人物主视觉海报',
    contentBrief: '支付系统节点和箭头方向',
  });
  assert.equal(taskId, 'technical-diagram');
});

test('loadTaskCatalog does not expose cache objects to caller mutation', () => {
  const first = loadTaskCatalog();
  first.push({ id: 'mutated-task' });
  first[0].id = 'mutated-portrait';
  first[1].bestFor.push('污染项');

  const second = loadTaskCatalog();
  assert.equal(second.some((item) => item.id === 'mutated-task'), false);
  assert.equal(second[0].id, 'portrait');
  assert.equal(second[1].bestFor.includes('污染项'), false);
});

test('inferTaskId recognizes common Chinese briefs beyond portrait fallback', () => {
  [
    ['无糖气泡水电商商品主图，白底平台安全区', 'ecommerce'],
    ['智能行李箱详情页五张图，卖点和材质细节', 'ecommerce'],
    ['端午茶叶礼盒包装概念图，外盒内盒套组', 'packaging'],
    ['咖啡新品上市 campaign 海报，预留标题区和 CTA 区', 'campaign-poster'],
    ['小红书九宫格社媒视觉，统一品牌色', 'social-grid'],
    ['科技播客主持人头像 profile，圆形裁切友好', 'avatar-profile-pack'],
    ['女性创业者棚拍人像，半身，官网创始人介绍', 'studio'],
    ['30 秒户外手表广告四格 storyboard', 'cinematic'],
    ['财经口播分镜板，主持人在演播厅讲解政策', 'oralboard'],
    ['支付系统技术流程图，包含网关风控节点和箭头', 'technical-diagram'],
    ['咖啡萃取方式信息图，对比时间研磨度和口感', 'infographic-board'],
    ['杭州三日旅行路线地图，标出每日路线颜色', 'map-route-board'],
    ['健身 App dashboard UI mockup，包含底部导航', 'ui-mockup-board'],
    ['论文 graphical abstract，水凝胶促进伤口愈合机制', 'academic-figure-board'],
    ['双语字体排版海报，强调大标题区', 'type-layout-poster'],
    ['对参考图做局部修改，只把背景改成清晨海边', 'image-edit'],
  ].forEach(([brief, expected]) => {
    assert.equal(inferTaskId({ contentBrief: brief }), expected, brief);
  });
});
