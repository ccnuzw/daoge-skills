const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource, readFrontendSource } = require('./source-text');

/**
 * 运行控制的两类分治，前端侧的守卫（规格书 §2.2 / 方案 4.9 / 施工单 0.3 第 10 条）。
 *
 * 「点了没用」的真缺陷：四条控制全部登记为 bearer，界面按钮走 cookie 必然 403，
 * 失败还被静默吞掉。本批的解法是两类分治：
 *   - 暂停 / 取消（止损）：开给 cookie，界面**直接调**，点了就生效；
 *   - 重试 / 恢复 / 未知结案（会重新花钱）：保持 bearer，界面**走队列**派给 agent。
 *
 * 本批先锁前半句（暂停/取消必须真的发请求）与「不许直调 bearer 那三条」；
 * 「重试走队列」的完整路径在三批补上。
 *
 * 先写桩：现在 controlRun 只弹一句「回到会话」，红是预期的。
 */

test('暂停 / 取消点了就生效：controlRun 必须真的发请求，而不是只提示', () => {
  // 批 E（E1.6b）迁移：外壳 JSX 搬去 app/workbench-shell.jsx——源断言读「main + 壳」两处。
  const main = readSource('web/src/main.jsx') + '\n' + readSource('web/src/app/workbench-shell.jsx');
  // 断言「意图」而不是某个整行的字面拼接：这两条路径必须真的存在、且以 POST 发出去。
  assert.match(main, /pause:\s*'\/pause'/, '必须存在暂停端点');
  assert.match(main, /cancel:\s*'\/cancel'/, '必须存在取消端点');
  assert.match(main, /\/api\/runs\/'\s*\+\s*encodeURIComponent\(targetRunId\)/, '必须按 runId 构造 /api/runs/:id/... 请求');
  assert.match(main, /method:\s*'POST',\s*idempotencyKey:\s*uniqueKey\('run-'\s*\+\s*action\)/, '暂停/取消必须以 POST 发出（cookie 直达）');
  // 反向：这两条不能再落到「回到会话」那句空提示上。
  assert.doesNotMatch(main, /暂停运行'\s*}\]|labels = \{ pause: '暂停运行', resume:[^}]*cancel: '取消运行', retry/, '暂停/取消不能与重试/恢复同属「只提示」的那一类');
});

test('重试 / 恢复 / 未知结案不许从界面直调 bearer 端点', () => {
  const frontend = readFrontendSource();
  assert.doesNotMatch(frontend, /\/api\/runs\/[^\n]{0,120}\/(retry|resume)/, '会重新花钱的动作必须走队列派给 agent，不能界面直调');
  assert.doesNotMatch(frontend, /\/api\/runs\/[^\n]{0,120}\/outcomes\/resolve/, '未知结案必须走队列');
});
