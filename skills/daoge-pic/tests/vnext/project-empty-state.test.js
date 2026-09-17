const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 首屏三形态的守卫（方案 4.7）。
 *
 * 方案里点名的那个错：**三种场景共用了一句「还没有匹配项目。」**——
 * 那是搜索无结果的说法。全新用户第一次打开，会以为是自己操作错了。
 * 判定的优先级也是这个方案的一半：**先分「有没有项目」这个大前提**，
 * 才轮到「搜不到 / 筛不到」。全新用户哪怕带着默认筛选，也必须看到「建第一个项目」。
 */

test('三形态的判定与文案：三句话必须各不相同', async () => {
  const { projectEmptyState } = await import('../../web/src/project-empty-state-model.mjs');
  const firstRun = projectEmptyState({ hasAnyProject: false, hasQuery: false, hasStatusFilter: true });
  const noSearch = projectEmptyState({ hasAnyProject: true, hasQuery: true, hasStatusFilter: true });
  const noFilterMatch = projectEmptyState({ hasAnyProject: true, hasQuery: false, hasStatusFilter: true });

  // ① 全新用户优先于一切 —— 他连容器都没有，搜索与筛选都是不存在的语境。
  assert.equal(firstRun.kind, 'first-run');
  assert.equal(projectEmptyState({ hasAnyProject: false, hasQuery: true, hasStatusFilter: false }).kind, 'first-run', '全新用户不看搜索与筛选');

  // ② 搜不到 / 筛不到是两回事，给的话也不同。
  assert.equal(noSearch.kind, 'no-search-match');
  assert.equal(noFilterMatch.kind, 'no-filter-match');

  // ③ 三句话必须各不相同（守卫的核心断言——共用一句话就是方案点名的那个错）。
  const copies = [firstRun, noSearch, noFilterMatch].map((state) => state.title + '|' + state.body);
  assert.equal(new Set(copies).size, 3, '三句话必须各不相同：' + JSON.stringify(copies));

  // ④ 只有首运行带「新建项目」的行动入口——那是他此刻唯一该做的事。
  assert.equal(firstRun.cta, '新建项目');
  assert.equal(noSearch.cta, undefined, '搜不到时给的是「换词」，不是再弹一个新建');
  assert.equal(noFilterMatch.cta, undefined);
});

test('接线：ProjectIndex 的空态必须走这个模型', () => {
  const main = readSource('web/src/main.jsx');
  assert.match(main, /project-empty-state-model\.mjs/, 'main.jsx 必须用这个模型');
  // 那句三场景共用的话不许再出现在源码里。
  assert.doesNotMatch(readSource('web/src/main.jsx'), /还没有匹配项目/, '共用一句话的旧空态必须消失');
});
