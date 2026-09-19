const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 失败「原因 → 建议」的守卫（方案 9.7 · 施工单 C2）。
 *
 * 4.10 定了失败**怎么说**；9.7 再往前一步：把「原因 → 建议」落成**机器可查**的一份映射，
 * agent 接重试单时查表就行，不必每次重新判断。
 *
 * ⚠️ 判据必须**复用**既有归因（`failure-copy-model` 那套系统/我的信号），
 * **不许另造第三套关键词**——两套关键词迟早互相打架。
 */

function adviceModule() {
  try {
    return require('../../dist/vnext/skill/failure-advice');
  } catch (error) {
    assert.fail('失败建议模块尚未实现：src/vnext/skill/failure-advice.ts（' + error.code + '）');
  }
}

test('三类常见失败各给一条可执行的建议', () => {
  const mod = adviceModule();
  if (typeof mod.failureAdvice !== 'function') assert.fail('尚未实现：failure-advice 的 failureAdvice');
  const quota = mod.failureAdvice({ status: 'blocked', summary: 'insufficient quota, please check billing' });
  assert.match(quota.advice, /额度|充值|余额/, '额度问题要指向充值');
  const moderation = mod.failureAdvice({ status: 'blocked', summary: 'content policy violation' });
  assert.match(moderation.advice, /换|改|描述/, '审核拒绝要指向换说法');
  const network = mod.failureAdvice({ status: 'failed', summary: 'fetch failed: network timeout' });
  assert.match(network.advice, /等|稍后|再试/, '网络问题要让等一等');
});

test('建议与归因口径一致：系统的问题不劝用户改描述', () => {
  const mod = adviceModule();
  const system = mod.failureAdvice({ status: 'failed', summary: '502 server error' });
  assert.equal(/改一改|换个说法|调整描述/.test(system.advice), false, '系统的问题不该让用户改描述');
  const unknown = mod.failureAdvice({ status: 'failed', summary: 'something odd' });
  assert.equal(typeof unknown.advice, 'string');
  assert.equal(unknown.advice.length > 0, true);
});

test('未知输入不抛错，给的是合法答案（「原因没写明」也是答案）', () => {
  const mod = adviceModule();
  assert.doesNotThrow(() => mod.failureAdvice({}));
  assert.doesNotThrow(() => mod.failureAdvice(null));
});

test('词表与前端判据对拍：两套关键词不许各说各话', async () => {
  const mod = adviceModule();
  const frontend = await import('../../web/src/failure-copy-model.mjs');
  assert.deepEqual([...mod.SYSTEM_SIGNALS].sort(), [...frontend.SYSTEM_SIGNALS].sort(), '系统信号两份必须一致');
  assert.deepEqual([...mod.MY_SIGNALS].sort(), [...frontend.MY_SIGNALS].sort(), '「我的问题」信号两份必须一致');
  assert.deepEqual([...mod.DISK_SIGNALS].sort(), [...frontend.DISK_SIGNALS].sort(), '磁盘签名两份必须一致');
});