const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation, confirmRoundPlan } = require('../../dist/vnext/domain/studio-commands');
const { getAssetImpact, importStudioAsset, setReviewDecision } = require('../../dist/vnext/domain/assets');
const { createDelivery, exportDelivery, getDelivery, prepareDelivery } = require('../../dist/vnext/domain/deliveries');
const { providerStatus } = require('../../dist/vnext/studio/provider-config');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');


test('recovers a committed delivery directory before its idempotency receipt is written', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-journal-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '交付恢复项目', idempotencyKey: 'journal-project' }).value;
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const created = createDelivery(db, { projectId: project.id, name: '交付恢复', assetIds: [asset.id], idempotencyKey: 'journal-delivery' });
    const prepared = prepareDelivery(db, { deliveryId: created.id, idempotencyKey: 'journal-ready' });
    const exported = exportDelivery(db, initialized.paths, { deliveryId: prepared.id, idempotencyKey: 'journal-original' });
    const stored = db.prepare('SELECT manifest_json FROM deliveries WHERE id = ?').get(created.id);
    const directoryPath = path.relative(workspaceRoot, exported.directory).split(path.sep).join('/');
    db.prepare("UPDATE deliveries SET status = 'ready', manifest_json = ? WHERE id = ?").run(JSON.stringify({ assetIds: [asset.id] }), created.id);
    db.prepare('DELETE FROM command_receipts WHERE idempotency_key = ?').run('journal-recovery');
    db.prepare('INSERT INTO delivery_export_journal (idempotency_key, delivery_id, studio_id, directory_path, manifest_json, files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('journal-recovery', created.id, initialized.manifest.studioId, directoryPath, stored.manifest_json, JSON.stringify(fs.readdirSync(exported.directory).sort()), new Date().toISOString());
    const recovered = exportDelivery(db, initialized.paths, { deliveryId: created.id, idempotencyKey: 'journal-recovery' });
    assert.equal(recovered.delivery.status, 'exported');
    assert.equal(fs.existsSync(path.join(recovered.directory, 'manifest.json')), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM delivery_export_journal').get().total, 0);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('exports managed assets with a contact sheet and redacted creative record', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  fs.writeFileSync(initialized.paths.providerEnvPath, 'IMAGE_PROVIDER=openai-images\nOPENAI_BASE_URL=https://private-provider.example.test/v1\nOPENAI_API_KEY=super-secret-key\nOPENAI_MODEL=fixture-model\n');
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '品牌交付项目', idempotencyKey: 'project' }).value;
    const task = createTaskDraft(db, { projectId: project.id, name: '主视觉', idempotencyKey: 'task' }).value;
    const round = createRoundDraft(db, { taskId: task.id, purpose: 'exploration', idempotencyKey: 'round' }).value;
    const prepared = prepareRoundForConfirmation(db, { roundId: round.id, expectedVersion: round.version, plan: { operation: 'generate', itemCount: 1, prompt: 'delivery evidence prompt' }, idempotencyKey: 'prepare' }).value;
    confirmRoundPlan(db, { roundId: round.id, expectedVersion: prepared.version, idempotencyKey: 'confirm' });
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const delivery = createDelivery(db, { projectId: project.id, name: '首轮交付', assetIds: [asset.id], includeCreativeRecord: true, idempotencyKey: 'delivery' });
    assert.equal(delivery.status, 'draft');
    const deliveryReady = prepareDelivery(db, { deliveryId: delivery.id, idempotencyKey: 'delivery-ready' });
    const exported = exportDelivery(db, initialized.paths, { deliveryId: deliveryReady.id, idempotencyKey: 'export' });
    assert.equal(exported.delivery.status, 'exported');
    assert.deepEqual(getAssetImpact(db, initialized.manifest.studioId, asset.id), { relationCount: 2, reviewCount: 1, deliveryCount: 1 });
    assert.ok(fs.existsSync(path.join(exported.directory, 'contact-sheet.html')));
    assert.ok(fs.existsSync(path.join(exported.directory, 'manifest.json')));
    const record = fs.readFileSync(path.join(exported.directory, 'creative-record.json'), 'utf8');
    assert.match(record, /delivery evidence prompt/);
    assert.equal(record.includes('super-secret-key'), false);
    assert.equal(record.includes('https:\/\/private-provider.example.test\/v1'), false);
    assert.equal(fs.readdirSync(exported.directory).some((file) => file.endsWith('.png')), true);
    const defaultDelivery = createDelivery(db, { projectId: project.id, name: '默认交付', assetIds: [asset.id], idempotencyKey: 'default-delivery' });
    const defaultPrepared = prepareDelivery(db, { deliveryId: defaultDelivery.id, idempotencyKey: 'default-ready' });
    const defaultExport = exportDelivery(db, initialized.paths, { deliveryId: defaultPrepared.id, idempotencyKey: 'default-export' });
    assert.equal(fs.existsSync(path.join(defaultExport.directory, 'creative-record.json')), false);
    const defaultManifest = fs.readFileSync(path.join(defaultExport.directory, 'manifest.json'), 'utf8');
    const defaultContactSheet = fs.readFileSync(path.join(defaultExport.directory, 'contact-sheet.html'), 'utf8');
    assert.equal(defaultManifest.includes(asset.id), false);
    assert.equal(defaultContactSheet.includes(asset.id), false);
    assert.equal(fs.readdirSync(defaultExport.directory).some((file) => file.includes(asset.id)), false);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('P1 delivery drafts require a project-scoped keep review and freeze that decision before export', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-draft-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '草稿交付项目', idempotencyKey: 'draft-project' }).value;
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id, source: { note: '选片来源' } });
    assert.throws(() => createDelivery(db, { projectId: project.id, name: '不合格草稿', assetIds: [asset.id], idempotencyKey: 'draft-rejected' }), /keep review/);
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const draft = createDelivery(db, { projectId: project.id, name: '可审阅草稿', assetIds: [asset.id], idempotencyKey: 'draft-create' });
    assert.equal(draft.status, 'draft');
    assert.throws(() => exportDelivery(db, initialized.paths, { deliveryId: draft.id, idempotencyKey: 'draft-export' }), /prepared/);
    const prepared = prepareDelivery(db, { deliveryId: draft.id, idempotencyKey: 'draft-ready' });
    assert.equal(prepared.status, 'ready');
    assert.equal(getDelivery(db, draft.id).items[0].review.decision, 'keep');
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'reject' });
    const exported = exportDelivery(db, initialized.paths, { deliveryId: draft.id, idempotencyKey: 'draft-final-export' });
    assert.equal(exported.delivery.status, 'exported');
    const manifest = fs.readFileSync(path.join(exported.directory, 'manifest.json'), 'utf8');
    assert.equal(manifest.includes(asset.id), false);
    assert.equal(getDelivery(db, draft.id).items[0].review.decision, 'keep');
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
