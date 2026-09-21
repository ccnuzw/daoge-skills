const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SKILL_ROOT, readSource } = require('./source-text');

/**
 * 协议与制品版本必须四处一致（规格书 §1 / 方案 10.2 / 10.3-1 / 施工单 0.3 第 7 条）。
 *
 * 大版本升级 = 制品 6.0.0 + 协议 3.0.0（请求队列是协议级新能力）。
 * 版本号散落在至少五处，漏一处就是「假升级」——守卫把它们钉在一起。
 *
 * 先写桩：现在全是 2.0.0 / 5.14.2，红是预期的。
 */

const EXPECTED_ARTIFACT = '6.1.1';
const EXPECTED_PROTOCOL = 'daoge-pic-skill-protocol/3.1.0';
const EXPECTED_RUNTIME_COMPATIBILITY = '>=6.0.0 <7.0.0';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, relativePath), 'utf8'));
}

test('制品版本升到 6.1.1，协议声明保持 3.1.0', () => {
  assert.equal(readJson('package.json').version, EXPECTED_ARTIFACT);
  const declaration = readJson('protocol-version.json');
  assert.equal(declaration.version, '3.1.0');
  assert.equal(declaration.runtimeCompatibility, EXPECTED_RUNTIME_COMPATIBILITY);
});

test('协议版本号的四处硬编码同步改成 3.1.0', () => {
  // 前端把协议头拼成「名字 + 版本常量」，所以这里锁的是两段都在、且常量值正确。
  // 批 E（第 9 批）迁移：协议头拼接随 api 请求口搬到 app/api.js。
  assert.match(readSource('web/src/app/api.js'), /'daoge-pic-skill-protocol\/'\s*\+\s*WORKBENCH_PROTOCOL_VERSION/, '前端协议头必须由名字与版本常量拼成');
  const frontendProtocol = readSource('web/src/version-negotiation-model.mjs');
  assert.match(frontendProtocol, /PROTOCOL_NAME = 'daoge-pic-skill-protocol'/, '协议名必须来自共享常量');
  assert.match(frontendProtocol, /WORKBENCH_PROTOCOL_VERSION = '3\.1\.0'/, '前端协议版本必须是 3.1.0');
  assert.match(readSource('SKILL.md'), new RegExp(EXPECTED_PROTOCOL.replace(/[/.]/g, '\\$&')), 'SKILL.md 必须声明 ' + EXPECTED_PROTOCOL);
  // 打包冒烟不拼整串头，它断言的是「清单里的协议版本号」——所以这里只锁版本号。
  assert.match(readSource('scripts/package-smoke.js'), /protocolManifest\.version !== '3\.1\.0'/, 'scripts/package-smoke.js 必须把协议版本钉在 3.1.0');
  // 测试助手也硬编码了协议头，漏了它一批接口测试会以最难看的方式坏。
  assert.match(readSource('tests/vnext/local-studio-test-helper.js'), /daoge-pic-skill-protocol\/3\.1\.0/);
  // SKILL.md 的运行时兼容范围同步。
  assert.match(readSource('SKILL.md'), />=6\.0\.0 <7\.0\.0/);
});
