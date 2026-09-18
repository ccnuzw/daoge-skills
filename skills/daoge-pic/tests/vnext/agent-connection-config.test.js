const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * C1 / C4 连接面板的守卫（方案 4.6 / 7.11.3 · 施工单 C1 + C4）。
 *
 * 守两件事：
 *   ① 侦查报告只做**展示翻译**——不因为报告缺字段就编造「已装」；
 *   ② 「怎么唤起 agent」的配置**收敛**（命令去空白、超时钳进合法区间），
 *      坏 storage 也不许抛错（隐私模式禁写是常态）。
 */

async function model() {
  return import('../../web/src/agent-connection-model.mjs');
}

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    dump: () => Object.fromEntries(map)
  };
}

test('唤起命令与催促超时都有合法默认，且坏输入被收敛', async () => {
  const { readAgentConnectionConfig, writeAgentConnectionConfig, normalizeAttentionMinutes, normalizeInvokeCommand, DEFAULT_ATTENTION_MINUTES, MAX_ATTENTION_MINUTES, MIN_ATTENTION_MINUTES } = await model();
  const storage = memoryStorage();
  const fresh = readAgentConnectionConfig(storage);
  assert.equal(fresh.attentionMinutes, DEFAULT_ATTENTION_MINUTES);
  assert.equal(typeof fresh.invokeCommand, 'string');

  const saved = writeAgentConnectionConfig(storage, { invokeCommand: '  codex  ', attentionMinutes: 9999 });
  assert.equal(saved.invokeCommand, 'codex');
  assert.equal(saved.attentionMinutes, MAX_ATTENTION_MINUTES);
  assert.equal(readAgentConnectionConfig(storage).invokeCommand, 'codex', '写进去要能读回来');

  assert.equal(normalizeAttentionMinutes(0), MIN_ATTENTION_MINUTES);
  assert.equal(normalizeAttentionMinutes('abc'), DEFAULT_ATTENTION_MINUTES);
  assert.equal(normalizeInvokeCommand(null), '');
});

test('storage 抛错时读取降级为默认、写入静默失败，不把界面打挂', async () => {
  const { readAgentConnectionConfig, writeAgentConnectionConfig, DEFAULT_ATTENTION_MINUTES } = await model();
  const hostile = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const config = readAgentConnectionConfig(hostile);
  assert.equal(config.attentionMinutes, DEFAULT_ATTENTION_MINUTES);
  assert.doesNotThrow(() => writeAgentConnectionConfig(hostile, { attentionMinutes: 5 }));
});

test('催促超时把分钟换算成毫秒，并同样钳位', async () => {
  const { queueAttentionThresholdMs } = await model();
  assert.equal(queueAttentionThresholdMs(2), 120000);
  assert.equal(queueAttentionThresholdMs(0), 60000, '低于下限钳到 1 分钟');
});

test('侦查摘要不编造：空报告说「没检测到」，有 daoge-pic 才说已装载', async () => {
  const { detectedCliSummary } = await model();
  const empty = detectedCliSummary({ clis: [], shared: { hasDaogePic: false }, installedCount: 0, anyDaogePic: false });
  assert.equal(empty.installedCount, 0);
  assert.match(empty.headline, /没检测到/);
  assert.match(empty.skillLine, /没找到/);

  const report = detectedCliSummary({
    installedCount: 2,
    anyDaogePic: true,
    shared: { hasDaogePic: false },
    clis: [
      { name: 'codex', onPath: true, homeExists: true, skillsExists: true, hasDaogePic: true },
      { name: 'claude', onPath: false, homeExists: true, skillsExists: false, hasDaogePic: false },
      { name: 'workbuddy', onPath: false, homeExists: false, skillsExists: false, hasDaogePic: false }
    ]
  });
  assert.equal(report.rows.length, 3);
  assert.equal(report.rows[0].installed, true);
  assert.equal(report.rows[2].installed, false);
  assert.equal(report.rows[1].installed, true, '有家目录也算装过');
  assert.match(report.headline, /2 个/);
  assert.match(report.skillLine, /已装载/);
});