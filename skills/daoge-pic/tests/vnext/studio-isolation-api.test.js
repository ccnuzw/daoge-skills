const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { requestJson } = require('./local-studio-test-helper');




function databaseCounts(db) {
  const tables = ['projects', 'creative_tasks', 'creative_rounds', 'round_plan_versions', 'dry_run_previews', 'generation_runs', 'run_items', 'events', 'command_receipts'];
  return Object.fromEntries(tables.map((table) => [table, db.prepare('SELECT COUNT(*) AS total FROM ' + table).get().total]));
}

test('public project, task, round, run, and run-item APIs reject foreign Studio IDs without side effects', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-studio-isolation-'));
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const db = started.service.db;
    const timestamp = '2026-01-01T00:00:00.000Z';
    db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('studio_foreign_matrix', workspaceRoot + '-foreign', initialized.manifest.schemaVersion, timestamp, timestamp);
    db.prepare('INSERT INTO projects (id, studio_id, name, description, status, version, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('project_foreign_matrix', 'studio_foreign_matrix', 'Foreign project', null, 'active', 1, timestamp, timestamp, null);
    db.prepare('INSERT INTO creative_tasks (id, project_id, task_type_id, name, intent_json, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('task_foreign_matrix', 'project_foreign_matrix', null, 'Foreign task', '{}', 'active', 1, timestamp, timestamp);
    db.prepare('INSERT INTO creative_rounds (id, task_id, parent_round_id, purpose, plan_json, plan_version, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('round_foreign_matrix', 'task_foreign_matrix', null, 'exploration', JSON.stringify({ operation: 'generate', itemCount: 1, prompt: 'foreign prompt' }), 1, 'active', 1, timestamp, timestamp);
    db.prepare('INSERT INTO round_plan_versions (id, round_id, plan_version, plan_json, state, created_at, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('plan_foreign_matrix', 'round_foreign_matrix', 1, '{}', 'confirmed', timestamp, timestamp);
    db.prepare('INSERT INTO dry_run_previews (id, round_id, plan_version, provider_snapshot_json, plan_snapshot_json, item_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('dryrun_foreign_matrix', 'round_foreign_matrix', 1, '{}', '{}', 1, timestamp);
    db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('run_foreign_matrix', 'round_foreign_matrix', 'paused', '{}', '{}', 1, timestamp, timestamp);
    db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, attempts, error_json, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('item_foreign_matrix', 'run_foreign_matrix', 1, 'outcome_unknown', '{"prompt":"foreign secret"}', 'request_foreign_matrix', 1, '{"code":"foreign"}', '{"assetId":"asset_foreign"}', timestamp, timestamp);
    const replayFixtures = [
      ['foreign-archive', 'projects.archive'],
      ['foreign-task', 'tasks.create_draft'],
      ['foreign-round', 'rounds.create_draft'],
      ['foreign-prepare', 'rounds.prepare_confirmation'],
      ['foreign-confirm', 'rounds.confirm_plan'],
      ['foreign-preflight', 'rounds.dry_run'],
      ['foreign-queue', 'runs.queue'],
      ['foreign-pause', 'runs.pause'],
      ['foreign-retry', 'runs.retry'],
      ['foreign-resume', 'runs.resume'],
      ['foreign-cancel', 'runs.cancel'],
      ['foreign-resolve', 'runs.resolve_unknown']
    ];
    const insertReceipt = db.prepare('INSERT INTO command_receipts (studio_id, idempotency_key, command_name, request_hash, response_json, created_at) VALUES (?, ?, ?, NULL, ?, ?)');
    for (const [idempotencyKey, commandName] of replayFixtures) insertReceipt.run(initialized.manifest.studioId, idempotencyKey, commandName, JSON.stringify({ replayedForeignEntity: true }), timestamp);

    const before = databaseCounts(db);
    const checks = [
      ['/api/projects/project_foreign_matrix/tasks', {}],
      ['/api/tasks/task_foreign_matrix/rounds', {}],
      ['/api/rounds/round_foreign_matrix/plan-versions', {}],
      ['/api/rounds/round_foreign_matrix/dry-runs', {}],
      ['/api/rounds/round_foreign_matrix/runs', {}],
      ['/api/runs/run_foreign_matrix/items', {}],
      ['/api/projects/project_foreign_matrix/archive', { method: 'POST', idempotencyKey: 'foreign-archive', body: {} }],
      ['/api/tasks', { method: 'POST', idempotencyKey: 'foreign-task', body: { projectId: 'project_foreign_matrix', name: 'Blocked' } }],
      ['/api/rounds', { method: 'POST', idempotencyKey: 'foreign-round', body: { taskId: 'task_foreign_matrix', purpose: 'exploration' } }],
      ['/api/rounds/round_foreign_matrix/prepare', { method: 'POST', idempotencyKey: 'foreign-prepare', body: { expectedVersion: 1, plan: {} } }],
      ['/api/rounds/round_foreign_matrix/confirm', { method: 'POST', idempotencyKey: 'foreign-confirm', body: { expectedVersion: 1 } }],
      ['/api/rounds/round_foreign_matrix/preflight', { method: 'POST', idempotencyKey: 'foreign-preflight', body: {} }],
      ['/api/runs', { method: 'POST', idempotencyKey: 'foreign-queue', body: { roundId: 'round_foreign_matrix', preflightId: 'dryrun_foreign_matrix' } }],
      ['/api/runs/run_foreign_matrix/pause', { method: 'POST', idempotencyKey: 'foreign-pause', body: {} }],
      ['/api/runs/run_foreign_matrix/retry', { method: 'POST', idempotencyKey: 'foreign-retry', body: { itemIds: ['item_foreign_matrix'] } }],
      ['/api/runs/run_foreign_matrix/resume', { method: 'POST', idempotencyKey: 'foreign-resume', body: {} }],
      ['/api/runs/run_foreign_matrix/cancel', { method: 'POST', idempotencyKey: 'foreign-cancel', body: {} }],
      ['/api/runs/run_foreign_matrix/outcomes/resolve', { method: 'POST', idempotencyKey: 'foreign-resolve', body: { itemIds: ['item_foreign_matrix'] } }]
    ];

    for (const [pathname, options] of checks) {
      const response = await requestJson(started, pathname, options);
      assert.equal(response.status, 404, pathname);
      assert.equal(response.body.error.code, 'not_found', pathname);
    }
    assert.deepEqual(databaseCounts(db), before);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
