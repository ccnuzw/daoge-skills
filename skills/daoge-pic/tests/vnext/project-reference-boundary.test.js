const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation, confirmRoundPlan } = require('../../dist/vnext/domain/studio-commands');
const { importStudioAsset, setStudioAssetShared } = require('../../dist/vnext/domain/assets');
const { configureProvider } = require('./provider-test-helper');
const { preflightRound } = require('../../dist/vnext/runner/run-commands');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-reference-boundary-'));
}

test('reference plans accept current-project or explicitly shared assets only', () => {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  const { status } = configureProvider(initialized, { model: 'gpt-image-2', apiKey: 'boundary-test-key' });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const studioId = initialized.manifest.studioId;
    const currentProject = createProject(db, { studioId, name: '当前项目', idempotencyKey: 'boundary-current-project' }).value;
    const currentTask = createTaskDraft(db, { studioId, projectId: currentProject.id, name: '当前任务', idempotencyKey: 'boundary-current-task' }).value;
    const otherProject = createProject(db, { studioId, name: '其他项目', idempotencyKey: 'boundary-other-project' }).value;
    const currentReference = importStudioAsset(db, initialized.paths, { studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: currentProject.id });
    const foreignReference = importStudioAsset(db, initialized.paths, { studioId, bytes: Buffer.concat([png, Buffer.from('foreign')]), mediaType: 'image/png', targetType: 'project', targetId: otherProject.id });
    const foreignMask = importStudioAsset(db, initialized.paths, { studioId, bytes: Buffer.concat([png, Buffer.from('mask')]), mediaType: 'image/png', targetType: 'project', targetId: otherProject.id });
    const plan = { operation: 'edit', itemCount: 1, prompt: '保留人物并调整背景', referenceAssetIds: [currentReference.id, foreignReference.id], maskAssetId: foreignMask.id };
    assert.throws(() => createRoundDraft(db, { studioId, taskId: currentTask.id, purpose: 'edit', plan, idempotencyKey: 'boundary-round-blocked' }), /当前项目或已明确共享/);
    const round = createRoundDraft(db, { studioId, taskId: currentTask.id, purpose: 'edit', idempotencyKey: 'boundary-round' }).value;
    db.prepare("UPDATE creative_rounds SET plan_json = ?, status = 'awaiting_confirmation' WHERE id = ?").run(JSON.stringify(plan), round.id);
    const historical = preflightRound(db, { studioId, roundId: round.id, providerStatus: status });
    assert.equal(historical.valid, false);
    assert.ok(historical.issues.some((issue) => issue.code === 'reference_asset_out_of_scope'));
    assert.ok(historical.issues.some((issue) => issue.code === 'mask_asset_out_of_scope'));

    assert.throws(() => prepareRoundForConfirmation(db, { studioId, roundId: round.id, plan, expectedVersion: round.version, idempotencyKey: 'boundary-prepare-blocked' }), /当前项目或已明确共享/);
    setStudioAssetShared(db, { studioId, assetId: foreignReference.id, shared: true });
    assert.throws(() => prepareRoundForConfirmation(db, { studioId, roundId: round.id, plan, expectedVersion: round.version, idempotencyKey: 'boundary-prepare-mask-blocked' }), /当前项目或已明确共享/);
    setStudioAssetShared(db, { studioId, assetId: foreignMask.id, shared: true });
    const prepared = prepareRoundForConfirmation(db, { studioId, roundId: round.id, plan, expectedVersion: round.version, idempotencyKey: 'boundary-prepare-shared' }).value;
    const confirmed = confirmRoundPlan(db, { studioId, roundId: round.id, expectedVersion: prepared.version, idempotencyKey: 'boundary-confirm' }).value;
    assert.equal(preflightRound(db, { studioId, roundId: confirmed.id, providerStatus: status }).valid, true);

    setStudioAssetShared(db, { studioId, assetId: foreignMask.id, shared: false });
    const revoked = preflightRound(db, { studioId, roundId: confirmed.id, providerStatus: status });
    assert.equal(revoked.valid, false);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
