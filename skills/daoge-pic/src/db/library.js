const os = require('os');
const path = require('path');
const { ensureDir } = require('../shared/workspace');
const { openDatabase, closeDatabase } = require('./connection');

function daogeHome() {
  return path.join(os.homedir(), '.daoge');
}

function libraryDbPath() {
  return path.join(daogeHome(), 'library.db');
}

function openLibraryDatabase() {
  ensureDir(daogeHome());
  ensureDir(path.join(daogeHome(), 'app'));
  ensureDir(path.join(daogeHome(), 'cache'));
  const db = openDatabase(libraryDbPath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS recent_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      db_path TEXT NOT NULL,
      last_opened_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_recent_projects_last_opened ON recent_projects(last_opened_at DESC);
  `);
  return db;
}

function registerProject(project) {
  const db = openLibraryDatabase();
  const ts = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO recent_projects (id, name, root_path, db_path, last_opened_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_path) DO UPDATE SET
        name = excluded.name,
        db_path = excluded.db_path,
        last_opened_at = excluded.last_opened_at,
        updated_at = excluded.updated_at
    `).run(project.id, project.name, path.resolve(project.rootPath), project.dbPath, ts, ts, ts);
    return project.id;
  } finally {
    closeDatabase(db);
  }
}

function listRecentProjects(limit = 20) {
  const db = openLibraryDatabase();
  try {
    return db.prepare('SELECT * FROM recent_projects ORDER BY last_opened_at DESC LIMIT ?').all(Number(limit || 20));
  } finally {
    closeDatabase(db);
  }
}

module.exports = { daogeHome, libraryDbPath, openLibraryDatabase, registerProject, listRecentProjects };
