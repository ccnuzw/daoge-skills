const test = require('node:test');
const assert = require('node:assert/strict');

const { ROUTE_AUTHORIZATION_RULES, findRouteAuthorizationRule } = require('../../dist/vnext/api/route-authorization');

/**
 * 运行控制的角色分治（规格书 §2.2 / 方案 4.9 / 施工单 0.3 第 5 条）。
 *
 * 「会花钱、会起停进程、会改凭据 → bearer；人的闸门 → cookie」。
 * 暂停 / 取消是**止损**：不花钱、减少支出，必须开给 cookie（原登记防的是 agent 自作主张，
 * 结果防住了人）。重试 / 恢复 / 未知结案会**重新花钱**，保持 bearer，界面走队列。
 *
 * 这一组先写桩：现在 pause / cancel 仍是 bearer，红是预期的。
 */

function actorOf(ruleId) {
  const rule = ROUTE_AUTHORIZATION_RULES.find((item) => item.id === ruleId);
  assert.ok(rule, '鉴权表里必须有规则 ' + ruleId);
  return rule.actor;
}

test('暂停与取消是止损动作：不再被 bearer 独占，人（cookie）也能直接止损', () => {
  // 修的是真实缺陷：这两条原本登记为 bearer，而界面按钮走 cookie → 必然 403，失败还被静默吞掉。
  // 按规格书 §2.2 的判据「其余一律默认两者皆可，不登记」，正确实现是**移出鉴权表**：
  // 既让 cookie 能用，又不删掉 agent 的止损能力，且不让 cookie-only 端点变成两个。
  assert.equal(findRouteAuthorizationRule('/api/runs/run_1/pause', 'POST'), null, '暂停不该再被独占（两者皆可）');
  assert.equal(findRouteAuthorizationRule('/api/runs/run_1/cancel', 'POST'), null, '取消不该再被独占（两者皆可）');
});

test('重试 / 恢复 / 未知结案会重新花钱，保持 bearer', () => {
  assert.equal(actorOf('runs.retry'), 'bearer');
  assert.equal(actorOf('runs.resume'), 'bearer');
  assert.equal(actorOf('runs.outcomes-resolve'), 'bearer');
});

test('确认闸门仍是唯一只能由真人完成的端点', () => {
  const cookieRules = ROUTE_AUTHORIZATION_RULES.filter((rule) => rule.actor === 'cookie').map((rule) => rule.id);
  assert.deepEqual(cookieRules, ['rounds.confirm'], 'cookie 专属（bearer 永不可用）的端点始终只有确认这一条（规格书 §2.3）');
  assert.equal(findRouteAuthorizationRule('/api/rounds/rnd_1/confirm', 'POST').actor, 'cookie');
});
