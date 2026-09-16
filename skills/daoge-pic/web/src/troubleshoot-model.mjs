// 疑难处理页的纯逻辑。
//
// 为什么单独成模块：这个页面上**唯一会算错的地方**就是把后端给的清单折成
// 「现在有多少东西、多大」。放进 JSX 就只能靠肉眼核对，抽出来才能真跑单测。
//
// ⚠️ 分类只认目录前缀，**不认 manifest 的 category**：交付文件在清单里和素材
// 共用 category: 'media'（见 src/vnext/api/server.ts 的 exportedDeliveryBackupEntries），
// 只有路径前缀能把它们分开。下面两个前缀是系统约定（assets.ts 的受管路径与
// 交付导出的固定目录），改约定就要同步改这里和它的测试。

export const ASSET_DIRECTORY_PREFIX = 'daoge-assets/';
export const DELIVERY_DIRECTORY_PREFIX = 'daoge-deliveries/';

const SIZE_UNITS = ['字节', 'KB', 'MB', 'GB', 'TB'];

/**
 * 把字节数说成人话。
 * 0、负数、NaN 一律给「0 字节」而不是空串 —— 页面上宁可显示 0，也不要留一块空白让人猜。
 * @param {unknown} bytes
 */
export function formatDataSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 字节';
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < SIZE_UNITS.length - 1) { size /= 1024; unit += 1; }
  // 字节级没有小数；整数不要小数（「1.0 GB」只是噪音）；10 以上也取整（「10.4 MB」不如「10 MB」好读）。
  const rounded = unit === 0 || size >= 10 || Number.isInteger(size) ? String(Math.round(size)) : size.toFixed(1);
  return rounded + ' ' + SIZE_UNITS[unit];
}

/**
 * 把一份备份清单折成页面要用的几个数。缺字段、结构不对都不抛，给全 0。
 * @param {{ entries?: unknown }} [manifest]
 */
export function summarizeBackupManifest(manifest) {
  const entries = Array.isArray(manifest?.entries) ? manifest.entries : [];
  const summary = { assetCount: 0, deliveryCount: 0, studioFileCount: 0, fileCount: 0, totalBytes: 0 };
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    summary.fileCount += 1;
    const bytes = Number(entry.byteSize);
    if (Number.isFinite(bytes) && bytes > 0) summary.totalBytes += bytes;
    const entryPath = typeof entry.path === 'string' ? entry.path : '';
    if (entryPath.startsWith(DELIVERY_DIRECTORY_PREFIX)) summary.deliveryCount += 1;
    else if (entryPath.startsWith(ASSET_DIRECTORY_PREFIX)) summary.assetCount += 1;
    else summary.studioFileCount += 1;
  }
  return summary;
}

/**
 * 一句话说清这个 Studio 现在有多少东西。
 * @param {ReturnType<typeof summarizeBackupManifest>} summary
 */
export function troubleshootSummaryLine(summary) {
  if (!summary || !summary.fileCount) return '这份清单是空的：这个 Studio 里还没有任何素材或交付。';
  const parts = [];
  if (summary.assetCount) parts.push(summary.assetCount + ' 个素材');
  if (summary.deliveryCount) parts.push(summary.deliveryCount + ' 份已交付文件');
  const head = parts.length ? parts.join('、') : summary.fileCount + ' 个文件';
  return '这个 Studio 现在有 ' + head + '，加起来 ' + formatDataSize(summary.totalBytes) + '。';
}

/**
 * 清单落盘的文件名。
 * 用英文与日期：不同系统对中文文件名的编码处理不一致，下载后容易变成乱码。
 * @param {Date} [at]
 */
export function backupManifestFileName(at = new Date()) {
  const date = at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date(0);
  const stamp = String(date.getFullYear())
    + String(date.getMonth() + 1).padStart(2, '0')
    + String(date.getDate()).padStart(2, '0');
  return 'daoge-pic-backup-manifest-' + stamp + '.json';
}

/**
 * 要写进下载文件的内容。缩进过，方便人直接打开看。
 * @param {unknown} manifest
 */
export function backupManifestPayload(manifest) {
  return JSON.stringify(manifest ?? null, null, 2);
}
