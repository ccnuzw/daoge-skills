const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource, readFrontendSource } = require('./source-text');

/**
 * 「花动作走队列」的守卫（方案 4.9 / 规格书 §2.2 / 4.2 队列）。
 *
 * 这一条把两件**互相对称**的不变式钉在一起，因为它们必须同时成立：
 *   ① 会重新花钱的动作（重试 / 恢复）界面**不直调 bearer** —— 那是 agent 的身份；
 *   ② 但它们**必须真的有个去处** —— 写进共享请求队列，由 agent 接单执行。
 *
 * ⚠️ 为什么需要这一条：功能做完时 `run-control-queue` 只有「不许直调」那一半，
 * **对「有没有真的走队列」完全无感**——把 `requestRunAction` 删掉、退回「只弹一句
 * 回到会话」，测试照样全绿。这正是本项目栽过两次的坑：
 * **做完了，但没人拦它退回去**（与「守卫锁字面量 ≠ 路径可达」同型）。
 */

test('花动作走队列：重试 / 恢复有真实去处，且带结构化意图', () => {
  // 批 E（E1.6b）迁移：外壳 JSX 搬去 app/workbench-shell.jsx——源断言读「main + 壳」两处。
  const main = readSource('web/src/main.jsx') + '\n' + readSource('web/src/app/workbench-shell.jsx');
  // ① 必须存在一个「把运行动作交给会话」的实现（而不是只弹提示）。
  assert.match(main, /requestRunAction/, '必须有「把运行动作写进队列」的实现');
  // ② 它必须走队列（sendRequest），并且带上 agent 能精确执行的结构化意图。
  const block = main.slice(main.indexOf('const requestRunAction'), main.indexOf('const retryRunItemsByIds'));
  assert.match(block, /sendRequest\(/, '必须真的把请求送进队列');
  assert.match(block, /intent, runId: targetRunId, itemIds: uniqueIds/, '必须带 intent + runId + itemIds（否则 agent 要从一句话里猜）');
  // ③ 两个入口都要走它。
  assert.match(main, /retryRunItemsByIds[\s\S]{0,180}requestRunAction\('retry'/, '重试必须走队列');
  assert.match(main, /controlRun[\s\S]{0,900}requestRunAction\(action/, '恢复同样走队列（暂停/取消才是 cookie 直达）');
  // ④ 提交不了要有话说（不许静默失败）。
  assert.match(block, /setError\('没能把/, '送不进队列必须说出来');
  assert.match(block, /setNotice\('已把/, '送进去了也要说出来');
});

test('队列把结构化意图真正带过去：模型 → hook → 服务端', () => {
  // 模型要能构造它。
  const model = readSource('web/src/request-queue-model.mjs');
  assert.match(model, /intent/, 'context 模型必须认 intent');
  assert.match(model, /itemIds/, 'context 模型必须认 itemIds');
  // hook 要把它放进请求体（只带非空的，别塞 null）。
  const hook = readSource('web/src/use-request-queue.mjs');
  assert.match(hook, /body\.intent \? \{ intent: body\.intent \}/, 'intent 要真的进请求体');
  assert.match(hook, /body\.itemIds\.length \? \{ itemIds: body\.itemIds \}/, 'itemIds 要真的进请求体');
  // 服务端要接住并校验归属（跨 Studio 的运行/运行项不许被写进队列）。
  const server = readSource('src/vnext/api/server.ts');
  assert.match(server, /if \(runId\) this\.assertRunInStudio\(runId\)/, 'runId 必须校验归属');
  assert.match(server, /for \(const itemId of itemIds\) this\.assertRunItemInStudio\(itemId\)/, 'itemIds 必须逐个校验归属');
  assert.match(server, /intent, runId, itemIds \}/, '三者都要随条目落库（agent 从队列里读到的是带规格的条目）');
});

test('前端整体不许直调 bearer 的三个运行端点（与「走队列」是一件事的两面）', () => {
  const frontend = readFrontendSource();
  assert.doesNotMatch(frontend, /\/api\/runs\/[^\n]{0,120}\/(retry|resume)/, '重试/恢复不许直调（会 403，且拆掉闸门）');
  assert.doesNotMatch(frontend, /\/api\/runs\/[^\n]{0,120}\/outcomes\/resolve/, '未知结案不许直调');
  // 反过来：暂停 / 取消**必须**直调（止损，cookie 可做）。
  const main = readSource('web/src/main.jsx');
  assert.match(main, /pause: '\/pause'/, '暂停必须直调');
  assert.match(main, /cancel: '\/cancel'/, '取消必须直调');
});

test('队列契约：intent / runId / itemIds 真的落进 context（真跑一遍，不靠字符串）', () => {
  // ⚠️ 这里**必须真跑**：先前写成 `assert.match(queue, /intent: input\.intent/)`，
  // 结果把实现改成 `intent: null`（意图全丢、agent 接单后什么都看不到）时它**照样绿**——
  // 因为那个字符串在别处也存在。**字符串断言在这里是空断言。**
  const { buildRequestContext } = require('../../dist/vnext/domain/request-queue');
  const context = buildRequestContext({ intent: 'retry', runId: 'run_1', itemIds: ['itm_1', 'itm_2', 'itm_1'] });
  assert.equal(context.intent, 'retry', 'intent 必须真的留下来');
  assert.equal(context.runId, 'run_1', 'runId 必须真的留下来');
  assert.deepEqual(context.itemIds, ['itm_1', 'itm_2'], 'itemIds 要去重后留下来');
  // 空值不硬塞（别把 null 写进 context 假装有意图）。
  const empty = buildRequestContext({});
  assert.equal(empty.intent, null);
  assert.equal(empty.runId, null);
  assert.deepEqual(empty.itemIds, []);
});
