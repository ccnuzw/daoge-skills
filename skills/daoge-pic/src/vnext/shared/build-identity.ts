import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 构建身份：回答「这个进程跑的是不是当前这份安装」。
 *
 * 为什么需要它：协议版本和运行时版本都是**区间**（`>=3.0.0 <4.0.0` / `>=6.0.0 <7.0.0`），
 * 所以一个还在跑昨天代码的 daemon 在版本检查里永远是「兼容」的。2026-09-20 的实测里，
 * agent 为了证明「daemon 跑的是旧代码」花了 14 分钟：`ps lstart` 对比 dist mtime、翻 git 历史、
 * 拿 backup manifest 当探针 —— 全是因为没有任何**事实**可读。这里提供那个事实。
 *
 * 身份 = `dist/vnext` 全部文件（按相对路径排序）的内容哈希。进程一旦启动就固定，
 * 因为进程**不可能**加载新代码：即使之后 dist 被重建，这个进程仍然只认启动时那一份。
 * 所以缓存不是优化、而是语义的一部分。
 */
let cached: { root: string; id: string } | null = null;

function listBuildFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
    }
  };
  walk(root, '');
  return files.sort();
}

export function buildIdFromDistRoot(distRoot: string): string {
  const root = path.resolve(distRoot);
  if (cached && cached.root === root) return cached.id;
  const hash = crypto.createHash('sha256');
  for (const relative of listBuildFiles(root)) {
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, relative)));
    hash.update('\0');
  }
  const id = hash.digest('hex').slice(0, 16);
  cached = { root, id };
  return id;
}

/** 本进程加载的那份 dist。CLI 与 daemon 都从同一个根算，因此身份可比。 */
export function currentDistRoot(): string {
  return path.resolve(__dirname, '..');
}

export function currentBuildId(): string {
  return buildIdFromDistRoot(currentDistRoot());
}