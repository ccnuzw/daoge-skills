const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { initializeStudio } = require('../dist/vnext/studio/workspace');
const { appendStudioEvent, closeStudioDatabase, openStudioDatabase, studioSchemaVersion, withTransaction } = require('../dist/vnext/studio/database');
const { claimRunItems } = require('../dist/vnext/runner/run-commands');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-perf-'));
}

function measure(operation) {
  const start = performance.now();
  const value = operation();
  return { value, milliseconds: Number((performance.now() - start).toFixed(2)) };
}

function seedQueue(db, itemCount) {
  const timestamp = '2026-01-01T00:00:00.000Z';
  db.prepare("INSERT INTO projects (id, studio_id, name, status, created_at, updated_at) VALUES ('bench-project', (SELECT id FROM studios LIMIT 1), 'Bench', 'active', ?, ?)").run(timestamp, timestamp);
  db.prepare("INSERT INTO creative_tasks (id, project_id, name, intent_json, status, created_at, updated_at) VALUES ('bench-task', 'bench-project', 'Bench', '{}', 'active', ?, ?)").run(timestamp, timestamp);
  db.prepare("INSERT INTO creative_rounds (id, task_id, purpose, plan_json, status, created_at, updated_at) VALUES ('bench-round', 'bench-task', 'exploration', '{}', 'active', ?, ?)").run(timestamp, timestamp);
  db.prepare("INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, execution_concurrency, concurrency_source, version, created_at, updated_at) VALUES ('bench-run', 'bench-round', 'queued', '{}', '{}', 1000, 'explicit', 1, ?, ?)").run(timestamp, timestamp);
  const insert = db.prepare("INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, created_at, updated_at) VALUES (?, 'bench-run', ?, 'pending', '{}', ?, ?, ?)");
  withTransaction(db, () => {
    for (let sequence = 1; sequence <= itemCount; sequence += 1) insert.run('bench-item-' + sequence, sequence, 'bench-request-' + sequence, timestamp, timestamp);
  });
}

function runQueueBenchmark(itemCount) {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    const opened = measure(() => {
      db = openStudioDatabase(initialized.paths, initialized.manifest);
      return true;
    });
    seedQueue(db, itemCount);
    const claimed = measure(() => claimRunItems(db, { workerId: 'bench-worker', limit: 1000, globalLimit: 1000, leaseMs: 30_000, now: new Date('2026-02-01T00:00:00.000Z') }));
    return { itemCount, openMilliseconds: opened.milliseconds, claimMilliseconds: claimed.milliseconds, claimed: claimed.value.length, rssMiB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)) };
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const workspaceRoot = temporaryWorkspace();
let db;
try {
  const initialized = initializeStudio({ workspaceRoot });
  db = openStudioDatabase(initialized.paths, initialized.manifest);
  const events = measure(() => {
    withTransaction(db, () => {
      for (let index = 0; index < 2000; index += 1) appendStudioEvent(db, { studioId: initialized.manifest.studioId, entityType: 'bench', entityId: 'bench', eventType: 'bench.event', payload: { index } });
    });
  });
  console.log(JSON.stringify({ schemaVersion: studioSchemaVersion(db), eventRetention: { count: 2000, milliseconds: events.milliseconds }, queues: [1000, 10000, 100000].map(runQueueBenchmark) }, null, 2));
} finally {
  closeStudioDatabase(db);
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}
