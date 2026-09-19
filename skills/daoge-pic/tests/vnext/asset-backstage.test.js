const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readFrontendSource } = require('./source-text');

/**
 * 资产管理「退后台」的守卫（方案 7.11.1 / 7.11.5 · 施工单 H1）。
 *
 * 挑图已经回到画布、在批次旁边（4.8）；资产页因此退成**资产后台**（导入 / 整理 / 回收 / 共享）。
 * 这是「收」不是「删」——所以本守卫锁两件事：
 *   ① 页面**说清自己是干什么的**，并指出挑图去哪了（不让人白找）；
 *   ② 句子**只有一个来源**（别处手写副本会慢慢漂移成两种说法）。
 */

async function copyModule() {
  try {
    return await import('../../web/src/asset-backstage-copy.mjs');
  } catch (error) {
    assert.fail('资产后台文案模块尚未实现：web/src/asset-backstage-copy.mjs（' + error.code + '）');
  }
}

test('资产页说明自己是后台，并指出挑图在画布', async () => {
  const { ASSET_BACKSTAGE_COPY } = await copyModule();
  assert.equal(typeof ASSET_BACKSTAGE_COPY, 'string');
  assert.match(ASSET_BACKSTAGE_COPY, /资产后台/);
  assert.match(ASSET_BACKSTAGE_COPY, /导入|整理|回收/);
  assert.match(ASSET_BACKSTAGE_COPY, /画布/, '必须指出挑图去哪了');
  assert.equal(/状态码|错误码|outcome_unknown/.test(ASSET_BACKSTAGE_COPY), false, '不出现黑话');
});

test('资产页真的渲染它，且句子只有这一个来源', () => {
  const main = readFrontendSource('main.jsx');
  assert.match(main, /import \{ ASSET_BACKSTAGE_COPY \} from '\.\/asset-backstage-copy\.mjs';/);
  assert.match(main, /className="asset-backstage-note">\{ASSET_BACKSTAGE_COPY\}/, '资产页要把它渲染出来');
  // 防漂移：同一句话不许在 web/src 里手写第二遍。
  const root = path.join(__dirname, '..', '..', 'web', 'src');
  const offenders = [];
  for (const name of fs.readdirSync(root)) {
    if (!/\.(mjs|jsx)$/.test(name) || name === 'asset-backstage-copy.mjs') continue;
    if (fs.readFileSync(path.join(root, name), 'utf8').includes('这里是资产后台')) offenders.push(name);
  }
  assert.deepEqual(offenders, [], '这些文件手写了资产后台副本，应改为 import ASSET_BACKSTAGE_COPY');
});