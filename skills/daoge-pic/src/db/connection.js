const fs = require('fs');
const path = require('path');

function loadSqlite() {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function emitWarningWithoutSqliteNoise(warning, ...args) {
    const text = String(warning && warning.message ? warning.message : warning);
    if (text.includes('SQLite is an experimental feature')) return false;
    return originalEmitWarning.call(this, warning, ...args);
  };
  try {
    return require('node:sqlite');
  } catch (error) {
    const wrapped = new Error([
      '当前 Node.js 不支持 node:sqlite，不能打开 DAOGE 数据库。',
      '下一步：请升级到包含 node:sqlite 的 Node.js 版本，或继续使用 prepare/execute/review 的旧 JSON 与 workspace HTML 兼容入口。',
      `原始错误：${error.message}`,
    ].join('\n'));
    wrapped.code = 'SQLITE_UNAVAILABLE';
    throw wrapped;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function openDatabase(dbPath) {
  const absolutePath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(absolutePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return db;
}

function projectDbPath(outputDir) {
  return path.join(path.resolve(outputDir), 'daoge.db');
}

function closeDatabase(db) {
  if (db && typeof db.close === 'function') db.close();
}

module.exports = { openDatabase, projectDbPath, loadSqlite, closeDatabase };
