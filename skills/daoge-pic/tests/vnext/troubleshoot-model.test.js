const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODEL = '../../web/src/troubleshoot-model.mjs';
const COPY = '../../web/src/troubleshoot-copy.mjs';

test('清单摘要只靠目录前缀区分素材与交付', async () => {
  const { summarizeBackupManifest } = await import(MODEL);
  // 关键：交付文件在这份清单里和素材**共用 category: 'media'**（见 server.ts 的
  // exportedDeliveryBackupEntries）。谁要是改成按 category 分类，这条会先红。
  const summary = summarizeBackupManifest({
    entries: [
      { path: 'daoge-assets/a.png', category: 'media', byteSize: 100 },
      { path: 'daoge-assets/b.png', category: 'media', byteSize: 200 },
      { path: 'daoge-deliveries/out/1.png', category: 'media', byteSize: 300 },
      { path: 'daoge-studio/studio.db', category: 'database', byteSize: 50 },
      { path: 'daoge-studio/manifest.json', category: 'metadata', byteSize: 10 }
    ]
  });
  assert.deepEqual(summary, { assetCount: 2, deliveryCount: 1, studioFileCount: 2, fileCount: 5, totalBytes: 660 });
});

test('清单缺字段或结构不对都不抛，给全 0', async () => {
  const { summarizeBackupManifest, troubleshootSummaryLine } = await import(MODEL);
  const inputs = [undefined, null, {}, { entries: null }, { entries: '不是数组' }, { entries: [null, 42, 'x'] }];
  for (const input of inputs) {
    const summary = summarizeBackupManifest(input);
    assert.equal(summary.fileCount, 0, JSON.stringify(input));
    assert.equal(summary.totalBytes, 0, JSON.stringify(input));
    assert.equal(summary.assetCount, 0, JSON.stringify(input));
  }
  // 条目是对象、但字段不可用时：仍然算「一个文件」，只是进不了任何分类。
  // 数得出来比数不出来好 —— 页面宁可显示「1 个文件」，也不要静默吞掉一条。
  const oddEntry = summarizeBackupManifest({ entries: [{ path: 42, byteSize: 'abc' }] });
  assert.equal(oddEntry.fileCount, 1);
  assert.equal(oddEntry.studioFileCount, 1);
  assert.equal(oddEntry.totalBytes, 0);

  assert.match(troubleshootSummaryLine(summarizeBackupManifest({})), /还没有任何素材/);
});

test('体积格式化：边界与不可用输入', async () => {
  const { formatDataSize } = await import(MODEL);
  assert.equal(formatDataSize(0), '0 字节');
  assert.equal(formatDataSize(-5), '0 字节');
  assert.equal(formatDataSize('abc'), '0 字节');
  assert.equal(formatDataSize(undefined), '0 字节');
  assert.equal(formatDataSize(1), '1 字节');
  assert.equal(formatDataSize(1023), '1023 字节');
  assert.equal(formatDataSize(1024), '1 KB');
  assert.equal(formatDataSize(1536), '1.5 KB');
  assert.equal(formatDataSize(10 * 1024), '10 KB');
  assert.equal(formatDataSize(1024 * 1024), '1 MB');
  assert.equal(formatDataSize(1024 ** 3), '1 GB');
});

test('一句话摘要跟着数字走，不出现空档', async () => {
  const { summarizeBackupManifest, troubleshootSummaryLine } = await import(MODEL);
  const both = troubleshootSummaryLine(summarizeBackupManifest({ entries: [
    { path: 'daoge-assets/a.png', byteSize: 2048 },
    { path: 'daoge-deliveries/1.png', byteSize: 1024 }
  ] }));
  assert.match(both, /1 个素材、1 份已交付文件/);
  assert.match(both, /3 KB/);

  // 只有 Studio 自身文件时，不能拼出「这个 Studio 现在有 ，加起来 …」这种空档。
  const studioOnly = troubleshootSummaryLine(summarizeBackupManifest({ entries: [{ path: 'daoge-studio/studio.db', byteSize: 10 }] }));
  assert.match(studioOnly, /1 个文件/);
  assert.doesNotMatch(studioOnly, /有 ，/);
});

test('清单文件名用英文与日期，非法时间也不抛', async () => {
  const { backupManifestFileName } = await import(MODEL);
  assert.equal(backupManifestFileName(new Date(2026, 8, 16)), 'daoge-pic-backup-manifest-20260916.json');
  assert.match(backupManifestFileName(new Date('nope')), /^daoge-pic-backup-manifest-\d{8}\.json$/);
  assert.match(backupManifestFileName(), /^daoge-pic-backup-manifest-\d{8}\.json$/);
});

test('界面上写的 CLI 命令必须真实存在（防指引腐烂）', async () => {
  const { RECOVERY_STEPS } = await import(COPY);
  const cli = fs.readFileSync(path.join(__dirname, '../../src/vnext/cli/daoge.ts'), 'utf8');
  assert.ok(RECOVERY_STEPS.length >= 3, '恢复至少要覆盖「导出清单 → 预演 → 恢复」三步');
  for (const step of RECOVERY_STEPS) {
    const name = step.command.split(' ')[1];
    assert.ok(name && step.command.startsWith('daoge '), '命令要写成完整调用：' + step.command);
    // 命令表里的形如 `'backup-manifest': { summary: … }`。命令改名时这条先响，
    // 而不是等用户照着界面敲出一条不存在的命令。
    assert.ok(cli.includes("'" + name + "':"), '界面上这条命令在 CLI 命令表里不存在：' + name);
    assert.ok(step.purpose.length > 8, '每一步都要配一句人话：' + step.command);
  }
  // 命令里不许写死参数取值 —— 那是因机器而异的，写死了就会腐烂。
  for (const step of RECOVERY_STEPS) {
    assert.doesNotMatch(step.command, /--workspace\s|--source-root\s|@-|\/Users|\/tmp/, '命令里不应写死参数：' + step.command);
  }
});
