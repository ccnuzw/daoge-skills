const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { ROUTE_AUTHORIZATION_RULES, findRouteAuthorizationRule, assertRouteAuthorization } = require('../../dist/vnext/api/route-authorization');

const SERVER_SOURCE = fs.readFileSync(path.join(__dirname, '../../src/vnext/api/server.ts'), 'utf8');

/** 只认 Skill/CLI 的端点：[方法, 路径, 403 文案里必须出现的片段]。 */
const BEARER_ONLY = [
  ['GET', '/api/confirmed-templates', 'Confirmed templates require'],
  ['GET', '/api/confirmed-templates/tpl_1', 'Confirmed templates require'],
  ['POST', '/api/confirmed-templates', 'Confirmed template writes'],
  ['POST', '/api/confirmed-templates/tpl_1/archive', 'Confirmed template writes'],
  ['POST', '/api/confirmed-templates/tpl_1/rollback', 'Confirmed template writes'],
  ['POST', '/api/budget', 'Budget writes'],
  ['POST', '/api/backup/restore-dry-run', 'Backup restore dry-run'],
  ['POST', '/api/backup/restore', 'Backup restore requires'],
  ['POST', '/api/backup/upgrade-assess', 'Backup upgrade assessment'],
  ['POST', '/api/backup/rollback-point', 'Backup rollback point'],
  ['POST', '/api/shutdown', '关闭 Studio daemon'],
  ['POST', '/api/rounds/rnd_1/preflight', '预检'],
  ['POST', '/api/runs', '生成运行'],
  ['POST', '/api/runs/run_1/items/itm_1/reconcile', '对账'],
  ['POST', '/api/runs/run_1/outcomes/resolve', '运行控制'],
  ['POST', '/api/runs/run_1/retry', '运行控制'],
  ['POST', '/api/runs/run_1/resume', '运行恢复']
];

/** Workbench 必须能自己写的端点。这些绝不能被误伤成 bearer-only，否则界面按钮会永久 403。 */
const COOKIE_WRITABLE = [
  ['POST', '/api/projects'],
  ['POST', '/api/projects/prj_1/archive'],
  ['POST', '/api/projects/prj_1/tasks'],
  ['POST', '/api/tasks'],
  ['POST', '/api/tasks/tsk_1/rounds'],
  ['POST', '/api/rounds/derived'],
  ['PUT', '/api/rounds/rnd_1/draft-context'],
  ['POST', '/api/assets/import'],
  ['POST', '/api/assets/ast_1/review'],
  ['POST', '/api/assets/ast_1/trash'],
  ['POST', '/api/restart'],
  ['POST', '/api/providers'],
  ['POST', '/api/provider-models'],
  ['PUT', '/api/providers/prf_1'],
  ['POST', '/api/providers/prf_1/validate'],
  ['POST', '/api/providers/prf_1/test'],
  ['POST', '/api/providers/prf_1/models'],
  ['POST', '/api/providers/prf_1/activate'],
  ['POST', '/api/sessions/open'],
  ['POST', '/api/sessions/ses_1/context'],
  ['POST', '/api/deliveries'],
  ['POST', '/api/delivery-batches'],
  ['PUT', '/api/deliveries/dlv_1/items']
];

function rejection(method, pathname, authentication) {
  try {
    assertRouteAuthorization(pathname, method, authentication);
    return null;
  } catch (error) {
    return error;
  }
}

test('每条规则的样例路径都还能命中它自己（正则没有写坏或退化）', () => {
  for (const rule of ROUTE_AUTHORIZATION_RULES) {
    assert.ok(rule.methods.length > 0, rule.id + ' 至少要声明一个方法');
    assert.ok(rule.pattern.source.startsWith('^'), rule.id + ' 的正则必须从头锚定');
    assert.ok(rule.pattern.source.endsWith('$'), rule.id + ' 的正则必须锚到结尾');
    for (const method of rule.methods) {
      assert.equal(findRouteAuthorizationRule(rule.sample, method), rule, rule.id + ' 的样例 ' + method + ' ' + rule.sample + ' 没命中它自己');
    }
  }
});

test('规则 id 唯一，测试才能按 id 而不是按下标定', () => {
  const ids = ROUTE_AUTHORIZATION_RULES.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length, '重复的规则 id：' + ids.join(', '));
});

test('花钱、起停服务、改凭据的端点只认 Skill/CLI', () => {
  for (const [method, pathname, fragment] of BEARER_ONLY) {
    const rule = findRouteAuthorizationRule(pathname, method);
    assert.ok(rule, method + ' ' + pathname + ' 没有被任何规则覆盖');
    assert.equal(rule.actor, 'bearer', method + ' ' + pathname + ' 应该只认 Skill/CLI');
    assert.ok(rule.message.includes(fragment), rule.id + ' 的 403 文案缺少「' + fragment + '」：' + rule.message);

    const error = rejection(method, pathname, 'cookie');
    assert.ok(error, method + ' ' + pathname + ' 用 cookie 调用应当被拒');
    assert.equal(error.status, 403);
    assert.equal(error.code, 'forbidden');
    assert.equal(error.message, rule.message);

    assert.equal(rejection(method, pathname, 'bearer'), null, method + ' ' + pathname + ' 用 bearer 调用应当放行');
  }
});

test('止损动作（暂停 / 取消）不再被 bearer 独占：人也能直接止损', () => {
  // 这是修过的真实缺陷：界面按钮走 cookie，而这两条曾登记为 bearer → 点了必然 403，失败还被静默吞掉。
  for (const pathname of ['/api/runs/run_1/pause', '/api/runs/run_1/cancel']) {
    assert.equal(findRouteAuthorizationRule(pathname, 'POST'), null, pathname + ' 应当两者皆可（规格书 §2.2 判据）');
    assert.equal(rejection('POST', pathname, 'cookie'), null, pathname + ' 必须允许真人（cookie）直接止损');
    assert.equal(rejection('POST', pathname, 'bearer'), null, pathname + ' 也不该删掉 agent 的止损能力');
  }
});

test('Workbench 必须能写的端点没有被误伤成 bearer-only', () => {
  for (const [method, pathname] of COOKIE_WRITABLE) {
    assert.equal(findRouteAuthorizationRule(pathname, method), null, method + ' ' + pathname + ' 不该被鉴权表拦住');
    assert.equal(rejection(method, pathname, 'cookie'), null);
    assert.equal(rejection(method, pathname, 'bearer'), null);
  }
});

test('创作确认是唯一只能由真人完成的端点', () => {
  const cookieRules = ROUTE_AUTHORIZATION_RULES.filter((rule) => rule.actor === 'cookie');
  assert.deepEqual(cookieRules.map((rule) => rule.id), ['rounds.confirm']);

  const error = rejection('POST', '/api/rounds/rnd_1/confirm', 'bearer');
  assert.ok(error, '智能体令牌不能替用户确认');
  assert.equal(error.status, 403);
  assert.equal(error.message, '创作确认必须由已授权 Workbench 中的真实用户完成。');
  assert.equal(rejection('POST', '/api/rounds/rnd_1/confirm', 'cookie'), null);
});

test('server.ts 里不再有内联的按路由鉴权判断，唯一入口就是这张表', () => {
  // 这是本次收敛的硬约束：以前 24 处判断散在两个大 if 链里，新增端点时很容易忘记补，
  // 而「忘记补」的默认结果是「浏览器可写」。现在默认结果仍然是一样（未登记即两者皆可），
  // 但漏补会在这条断言上暴露成一次明确的决定，而不是悄悄发生。
  assert.equal(/authentication !== '(?:bearer|cookie)'/.test(SERVER_SOURCE), false, '发现内联的按路由鉴权判断；请改为往 ROUTE_AUTHORIZATION_RULES 加一条规则');
  const calls = SERVER_SOURCE.match(/assertRouteAuthorization\(/g) || [];
  assert.equal(calls.length, 1, 'assertRouteAuthorization 应只在请求完成认证后调用一次，实际 ' + calls.length + ' 次');
});
