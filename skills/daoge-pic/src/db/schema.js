const crypto = require('crypto');

const CURRENT_SCHEMA_VERSION = 3;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT,
  provider TEXT,
  model TEXT,
  dry_run INTEGER NOT NULL DEFAULT 0,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  needs_review_count INTEGER NOT NULL DEFAULT 0,
  source_path TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_runs_project_created ON runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_phase ON runs(phase);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  prompt_index TEXT,
  title TEXT,
  prompt_text TEXT NOT NULL,
  negative_prompt TEXT,
  params_json TEXT,
  source_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_run_index ON prompts(run_id, prompt_index);
CREATE INDEX IF NOT EXISTS idx_prompts_run ON prompts(run_id);

CREATE TABLE IF NOT EXISTS run_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  prompt_id TEXT,
  item_index TEXT,
  title TEXT,
  status TEXT NOT NULL,
  output_path TEXT,
  error TEXT,
  request_mode TEXT,
  batch_number INTEGER,
  raw_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY(prompt_id) REFERENCES prompts(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_items_run_index ON run_items(run_id, item_index);
CREATE INDEX IF NOT EXISTS idx_run_items_status ON run_items(status);
CREATE TRIGGER IF NOT EXISTS trg_prompts_run_immutable_when_used
BEFORE UPDATE OF run_id ON prompts
WHEN EXISTS (SELECT 1 FROM run_items WHERE run_items.prompt_id = OLD.id AND run_items.run_id <> NEW.run_id)
BEGIN
  SELECT RAISE(ABORT, 'prompts.run_id cannot change while run_items reference prompt');
END;
CREATE TRIGGER IF NOT EXISTS trg_run_items_prompt_same_run_insert
BEFORE INSERT ON run_items
WHEN NEW.prompt_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM prompts WHERE prompts.id = NEW.prompt_id AND prompts.run_id = NEW.run_id)
BEGIN
  SELECT RAISE(ABORT, 'run_items.prompt_id must reference prompt in same run');
END;
CREATE TRIGGER IF NOT EXISTS trg_run_items_prompt_same_run_update
BEFORE UPDATE OF prompt_id, run_id ON run_items
WHEN NEW.prompt_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM prompts WHERE prompts.id = NEW.prompt_id AND prompts.run_id = NEW.run_id)
BEGIN
  SELECT RAISE(ABORT, 'run_items.prompt_id must reference prompt in same run');
END;

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  user_status TEXT,
  user_state TEXT NOT NULL DEFAULT 'normal',
  title TEXT NOT NULL,
  path TEXT,
  thumb_path TEXT,
  thumb_status TEXT NOT NULL DEFAULT 'missing',
  mime TEXT,
  size_bytes INTEGER,
  width INTEGER,
  height INTEGER,
  sha256 TEXT,
  notes TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_project_file_identity ON assets(project_id, path, sha256, kind) WHERE path IS NOT NULL AND sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_project_path_kind ON assets(project_id, path, kind) WHERE path IS NOT NULL AND sha256 IS NULL;
CREATE INDEX IF NOT EXISTS idx_assets_project_kind_status ON assets(project_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_assets_sha ON assets(sha256);

CREATE TABLE IF NOT EXISTS run_assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  role TEXT NOT NULL,
  source_prompt_id TEXT,
  source_run_item_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY(source_prompt_id) REFERENCES prompts(id) ON DELETE SET NULL,
  FOREIGN KEY(source_run_item_id) REFERENCES run_items(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_assets_unique ON run_assets(run_id, asset_id, role);
CREATE INDEX IF NOT EXISTS idx_run_assets_asset ON run_assets(asset_id);
CREATE INDEX IF NOT EXISTS idx_run_assets_prompt ON run_assets(source_prompt_id);

CREATE TABLE IF NOT EXISTS asset_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_links_unique ON asset_links(project_id, source_type, source_id, target_type, target_id, relation);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  asset_id TEXT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  recommended_action TEXT,
  rerunnable INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status);
CREATE INDEX IF NOT EXISTS idx_issues_run ON issues(run_id);

CREATE TABLE IF NOT EXISTS selections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  state TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_selections_asset ON selections(project_id, asset_id);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_project_name ON tags(project_id, name);

CREATE TABLE IF NOT EXISTS asset_tags (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_tags_unique ON asset_tags(project_id, asset_id, tag_id);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_exports_project_kind ON exports(project_id, kind);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT,
  result_json TEXT,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON jobs(project_id, status);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  dedupe_key TEXT,
  message TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_events_project_created ON events(project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe_key ON events(dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_project_key ON settings(project_id, key);
`;

function stableId(parts) {
  return crypto.createHash('sha1').update(parts.filter((part) => part != null).join('|')).digest('hex').slice(0, 16);
}

function columnNames(db, table) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  } catch {
    return [];
  }
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function ensureColumn(db, table, name, sql) {
  if (!columnNames(db, table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${sql};`);
}

function insertMigration(db, version, name) {
  const existing = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version);
  if (!existing) {
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      version,
      name,
      new Date().toISOString()
    );
  }
}

function createV3CoreTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      prompt_index TEXT,
      title TEXT,
      prompt_text TEXT NOT NULL,
      negative_prompt TEXT,
      params_json TEXT,
      source_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS run_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      prompt_id TEXT,
      item_index TEXT,
      title TEXT,
      status TEXT NOT NULL,
      output_path TEXT,
      error TEXT,
      request_mode TEXT,
      batch_number INTEGER,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY(prompt_id) REFERENCES prompts(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      user_status TEXT,
      user_state TEXT NOT NULL DEFAULT 'normal',
      title TEXT NOT NULL,
      path TEXT,
      thumb_path TEXT,
      thumb_status TEXT NOT NULL DEFAULT 'missing',
      mime TEXT,
      size_bytes INTEGER,
      width INTEGER,
      height INTEGER,
      sha256 TEXT,
      notes TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS run_assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role TEXT NOT NULL,
      source_prompt_id TEXT,
      source_run_item_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY(source_prompt_id) REFERENCES prompts(id) ON DELETE SET NULL,
      FOREIGN KEY(source_run_item_id) REFERENCES run_items(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      asset_id TEXT,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      recommended_action TEXT,
      rerunnable INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE SET NULL
    );
  `);
}

function migrateV2ToV3(db) {
  if (!tableExists(db, 'prompts') || columnNames(db, 'assets').includes('thumb_status')) return;
  const ts = new Date().toISOString();
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DROP INDEX IF EXISTS idx_prompts_project_index;
    DROP INDEX IF EXISTS idx_prompts_run;
    DROP INDEX IF EXISTS idx_run_items_run_index;
    DROP INDEX IF EXISTS idx_run_items_status;
    DROP INDEX IF EXISTS idx_assets_project_path;
    DROP INDEX IF EXISTS idx_assets_project_kind_status;
    DROP INDEX IF EXISTS idx_assets_origin_run;
    DROP INDEX IF EXISTS idx_assets_sha;
    DROP INDEX IF EXISTS idx_issues_project_status;
    DROP INDEX IF EXISTS idx_issues_run;
    DROP TABLE IF EXISTS run_assets;
    ALTER TABLE prompts RENAME TO prompts_v2;
    ALTER TABLE run_items RENAME TO run_items_v2;
    ALTER TABLE assets RENAME TO assets_v2;
    ALTER TABLE issues RENAME TO issues_v2;
  `);
  createV3CoreTables(db);
  db.exec(`
    INSERT OR IGNORE INTO prompts (
      id, project_id, run_id, prompt_index, title, prompt_text, negative_prompt,
      params_json, source_path, created_at, updated_at
    )
    SELECT
      prompts_v2.id,
      prompts_v2.project_id,
      COALESCE(prompts_v2.run_id, (
        SELECT runs.id FROM runs WHERE runs.project_id = prompts_v2.project_id ORDER BY runs.created_at DESC LIMIT 1
      )),
      prompts_v2.prompt_index,
      prompts_v2.title,
      prompts_v2.prompt_text,
      prompts_v2.negative_prompt,
      prompts_v2.params_json,
      prompts_v2.source_path,
      prompts_v2.created_at,
      prompts_v2.updated_at
    FROM prompts_v2
    WHERE COALESCE(prompts_v2.run_id, (
      SELECT runs.id FROM runs WHERE runs.project_id = prompts_v2.project_id ORDER BY runs.created_at DESC LIMIT 1
    )) IS NOT NULL;

    INSERT OR IGNORE INTO run_items (
      id, project_id, run_id, prompt_id, item_index, title, status, output_path,
      error, request_mode, batch_number, raw_json, created_at, updated_at
    )
    SELECT
      run_items_v2.id,
      run_items_v2.project_id,
      run_items_v2.run_id,
      CASE
        WHEN prompts.id IS NOT NULL AND prompts.run_id = run_items_v2.run_id THEN prompts.id
        ELSE NULL
      END,
      run_items_v2.item_index,
      run_items_v2.title,
      run_items_v2.status,
      run_items_v2.output_path,
      run_items_v2.error,
      run_items_v2.request_mode,
      run_items_v2.batch_number,
      run_items_v2.raw_json,
      run_items_v2.created_at,
      run_items_v2.updated_at
    FROM run_items_v2
    LEFT JOIN prompts ON prompts.id = run_items_v2.prompt_id;

    INSERT OR IGNORE INTO assets (
      id, project_id, kind, status, user_status, user_state, title, path, thumb_path,
      thumb_status, mime, size_bytes, width, height, sha256, notes, metadata_json,
      created_at, updated_at
    )
    SELECT
      id, project_id, kind, status, user_status, user_state, title, path, thumb_path,
      CASE WHEN thumb_path IS NULL OR thumb_path = '' THEN 'missing' ELSE 'ready' END,
      mime, size_bytes, width, height, sha256, notes, metadata_json, created_at, updated_at
    FROM assets_v2;

    INSERT OR IGNORE INTO issues (
      id, project_id, run_id, asset_id, type, severity, status, title, message,
      recommended_action, rerunnable, metadata_json, resolved_at, created_at, updated_at
    )
    SELECT
      issues_v2.id,
      issues_v2.project_id,
      COALESCE(issues_v2.run_id, (
        SELECT runs.id FROM runs WHERE runs.project_id = issues_v2.project_id ORDER BY runs.created_at DESC LIMIT 1
      )),
      issues_v2.asset_id,
      issues_v2.type,
      issues_v2.severity,
      issues_v2.status,
      issues_v2.title,
      issues_v2.message,
      issues_v2.recommended_action,
      issues_v2.rerunnable,
      issues_v2.metadata_json,
      issues_v2.resolved_at,
      issues_v2.created_at,
      issues_v2.updated_at
    FROM issues_v2
    WHERE COALESCE(issues_v2.run_id, (
      SELECT runs.id FROM runs WHERE runs.project_id = issues_v2.project_id ORDER BY runs.created_at DESC LIMIT 1
    )) IS NOT NULL;
  `);
  const oldAssets = db.prepare(`
    SELECT id, project_id, kind, origin_run_id, origin_prompt_id, created_at, updated_at
    FROM assets_v2
    WHERE origin_run_id IS NOT NULL
  `).all();
  const insertRunAsset = db.prepare(`
    INSERT OR IGNORE INTO run_assets (
      id, project_id, run_id, asset_id, role, source_prompt_id, source_run_item_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  oldAssets.forEach((asset) => {
    insertRunAsset.run(
      `run_asset_${stableId([asset.project_id, asset.origin_run_id, asset.id, asset.kind])}`,
      asset.project_id,
      asset.origin_run_id,
      asset.id,
      asset.kind,
      asset.origin_prompt_id || null,
      null,
      asset.created_at || ts,
      asset.updated_at || ts
    );
  });
  db.exec(`
    DROP TABLE prompts_v2;
    DROP TABLE run_items_v2;
    DROP TABLE assets_v2;
    DROP TABLE issues_v2;
    PRAGMA foreign_keys = ON;
  `);
}

function ensureV3IndexesAndColumns(db) {
  if (tableExists(db, 'assets')) ensureColumn(db, 'assets', 'thumb_status', "thumb_status TEXT NOT NULL DEFAULT 'missing'");
  if (tableExists(db, 'jobs')) {
    ensureColumn(db, 'jobs', 'error', 'error TEXT');
    ensureColumn(db, 'jobs', 'started_at', 'started_at TEXT');
    ensureColumn(db, 'jobs', 'completed_at', 'completed_at TEXT');
  }
  db.exec(`
    DROP INDEX IF EXISTS idx_prompts_project_index;
    DROP INDEX IF EXISTS idx_assets_project_path;
    DROP INDEX IF EXISTS idx_assets_origin_run;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prompts_run_index ON prompts(run_id, prompt_index);
    CREATE INDEX IF NOT EXISTS idx_prompts_run ON prompts(run_id);
    DROP TRIGGER IF EXISTS trg_prompts_run_immutable_when_used;
    CREATE TRIGGER IF NOT EXISTS trg_prompts_run_immutable_when_used
    BEFORE UPDATE OF run_id ON prompts
    WHEN EXISTS (SELECT 1 FROM run_items WHERE run_items.prompt_id = OLD.id AND run_items.run_id <> NEW.run_id)
    BEGIN
      SELECT RAISE(ABORT, 'prompts.run_id cannot change while run_items reference prompt');
    END;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_run_items_run_index ON run_items(run_id, item_index);
    CREATE INDEX IF NOT EXISTS idx_run_items_status ON run_items(status);
    DROP TRIGGER IF EXISTS trg_run_items_prompt_same_run_insert;
    DROP TRIGGER IF EXISTS trg_run_items_prompt_same_run_update;
    CREATE TRIGGER IF NOT EXISTS trg_run_items_prompt_same_run_insert
    BEFORE INSERT ON run_items
    WHEN NEW.prompt_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM prompts WHERE prompts.id = NEW.prompt_id AND prompts.run_id = NEW.run_id)
    BEGIN
      SELECT RAISE(ABORT, 'run_items.prompt_id must reference prompt in same run');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_run_items_prompt_same_run_update
    BEFORE UPDATE OF prompt_id, run_id ON run_items
    WHEN NEW.prompt_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM prompts WHERE prompts.id = NEW.prompt_id AND prompts.run_id = NEW.run_id)
    BEGIN
      SELECT RAISE(ABORT, 'run_items.prompt_id must reference prompt in same run');
    END;
    DROP INDEX IF EXISTS idx_assets_project_sha_kind;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_project_file_identity ON assets(project_id, path, sha256, kind) WHERE path IS NOT NULL AND sha256 IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_project_path_kind ON assets(project_id, path, kind) WHERE path IS NOT NULL AND sha256 IS NULL;
    CREATE INDEX IF NOT EXISTS idx_assets_project_kind_status ON assets(project_id, kind, status);
    CREATE INDEX IF NOT EXISTS idx_assets_sha ON assets(sha256);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_run_assets_unique ON run_assets(run_id, asset_id, role);
    CREATE INDEX IF NOT EXISTS idx_run_assets_asset ON run_assets(asset_id);
    CREATE INDEX IF NOT EXISTS idx_run_assets_prompt ON run_assets(source_prompt_id);
    CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status);
    CREATE INDEX IF NOT EXISTS idx_issues_run ON issues(run_id);
  `);
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const latestBefore = db.prepare('SELECT max(version) AS version FROM schema_migrations').get()?.version || 0;
  if (latestBefore > 0 && latestBefore < 3) migrateV2ToV3(db);
  db.exec(SCHEMA_SQL);
  const eventColumns = db.prepare('PRAGMA table_info(events)').all().map((column) => column.name);
  if (!eventColumns.includes('dedupe_key')) {
    db.exec('ALTER TABLE events ADD COLUMN dedupe_key TEXT;');
  }
  ensureV3IndexesAndColumns(db);
  db.exec(`
    DROP INDEX IF EXISTS idx_events_dedupe;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe_key ON events(dedupe_key) WHERE dedupe_key IS NOT NULL;
  `);
  insertMigration(db, CURRENT_SCHEMA_VERSION, latestBefore > 0 ? 'workbench_schema_v3' : 'initial_workbench_schema');
}

module.exports = { CURRENT_SCHEMA_VERSION, initializeSchema };
