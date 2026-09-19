const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 界面 ↔ 后台的版本协商（方案 9.4，施工单 E5）。
 *
 * 大版本切换期最难看的方式是「新界面连旧 daemon（或反之），每个请求神秘失败」。
 * 所以进门先握一次手，不兼容给人话。握手请求**不能带协议头**——否则会先被
 * 对方的版本检查拦下，读不到对方版本。
 */

async function model() {
  return import('../../web/src/version-negotiation-model.mjs');
}

test('同名同主版本才算兼容；不一致时说人话，且分得清谁旧', async () => {
  const { negotiateStudioVersion, PROTOCOL_NAME } = await model();
  const ok = negotiateStudioVersion({ protocol: { name: PROTOCOL_NAME, version: '3.4.0', runtimeVersion: '6.2.0' } });
  assert.equal(ok.compatible, true, '同主版本的次版本/补丁差异不算不兼容');

  const daemonBehind = negotiateStudioVersion({ protocol: { name: PROTOCOL_NAME, version: '2.0.0', runtimeVersion: '5.14.2' } });
  assert.equal(daemonBehind.compatible, false);
  assert.equal(daemonBehind.reason, 'daemon-behind');
  assert.match(daemonBehind.message, /重启|升级/, '后台太旧要给「重启/升级」的动作');

  const frontendBehind = negotiateStudioVersion({ protocol: { name: PROTOCOL_NAME, version: '4.0.0', runtimeVersion: '7.0.0' } });
  assert.equal(frontendBehind.compatible, false);
  assert.equal(frontendBehind.reason, 'frontend-behind');
  assert.match(frontendBehind.message, /刷新/, '界面太旧（缓存）要给「刷新」的动作');

  const wrongName = negotiateStudioVersion({ protocol: { name: 'something-else', version: '3.0.0' } });
  assert.equal(wrongName.compatible, false);
  assert.equal(wrongName.reason, 'protocol-name');

  const unknown = negotiateStudioVersion(null);
  assert.equal(unknown.compatible, false);
  assert.equal(unknown.reason, 'unknown');
  assert.ok(unknown.message.length > 0);
});

test('握手请求不带协议头、走同源 cookie', async () => {
  const { versionProbeRequest } = await model();
  const request = versionProbeRequest();
  assert.equal(request.method, 'GET');
  assert.equal(request.credentials, 'same-origin');
  assert.equal(Object.keys(request.headers).some((key) => key.toLowerCase() === 'x-daoge-skill-protocol'), false, '握手请求不能带协议头，否则读不到对方版本');
});

test('接线到位：授权之后先握手，界面自己那份协议版本是唯一来源', () => {
  // 批 E（E1.6b）迁移：外壳 JSX 搬去 app/workbench-shell.jsx——源断言读「main + 壳」两处。
  const main = readSource('web/src/main.jsx') + '\n' + readSource('web/src/app/workbench-shell.jsx');
  assert.match(main, /StudioVersionGate/, '必须有版本协商闸门');
  assert.match(main, /versionProbeRequest\(/, '握手必须走不带协议头的请求');
  assert.match(main, /if \(authorized\) return <StudioVersionGate \/>/, '授权通过后先协商再渲染');
  // 协议版本只在一处声明；请求头从它取，而不是再写一遍字面量。
  // 批 E（E1.6）迁移：请求口搬去 app/api.js——协议头断言跟着走。
  assert.doesNotMatch(readSource('web/src/app/api.js'), /'x-daoge-skill-protocol': 'daoge-pic-skill-protocol\/3\.0\.0'/, '请求头不能再硬编码协议版本');
  assert.match(readSource('web/src/app/api.js'), /'daoge-pic-skill-protocol\/'\s*\+\s*WORKBENCH_PROTOCOL_VERSION/, '请求头必须从共享常量取协议版本');
  assert.match(readSource('web/src/app/api.js'), /import \{[^}]*WORKBENCH_PROTOCOL_VERSION[^}]*\}/, '请求头必须从共享常量取协议版本');
});
