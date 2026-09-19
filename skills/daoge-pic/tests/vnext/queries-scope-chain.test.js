const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 读侧拼链收口的守卫（方案 7.7.1 / 规格书 §3.2 · 施工单 X2 / 第 3 批 T1 补完）。
 *
 * 第 3 批把 **project 作用域**读侧迁到了 `assets.project_id`；但 `queries.ts` 里还有
 * **手写的多级 JOIN 链**。手写的风险不是「不好看」，而是**每一处都要靠人记得补
 * `studio_id` 谓词**——漏一处就是静默的跨租户读取。
 *
 * 所以这条守卫盯「又有人手写链」：凡是多级归属链，必须走 studio-scope 的
 * `joinInStudioSql` / `selectInStudioSql`。
 */

const CHAIN_PATTERN = /JOIN\s+creative_tasks\s+task\s+ON\s+task\.id\s*=\s*round\.task_id/i;

test('queries.ts 不再手写多级归属 JOIN 链（改走 studio-scope 的共享拼链）', () => {
  const source = readSource('src/vnext/domain/queries.ts');
  const offenders = source
    .split('\n')
    .map((line, index) => ({ line, index: index + 1 }))
    .filter((entry) => CHAIN_PATTERN.test(entry.line))
    .map((entry) => 'queries.ts:' + entry.index);
  assert.deepEqual(offenders, [], '发现手写的归属链；请改用 studio-scope 的 joinInStudioSql / selectInStudioSql');
  assert.match(source, /joinInStudioSql\(/, '列表查询要用 joinInStudioSql 拼链');
});