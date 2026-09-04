const fs = require('node:fs');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation, confirmRoundPlan } = require('../../dist/vnext/domain/studio-commands');
const { assetFilePath, getAssetImpact, importStudioAsset, setReviewDecision } = require('../../dist/vnext/domain/assets');
const { createDelivery, exportDelivery, exportDeliveryAsync, getDelivery, openDeliveryExportFile, prepareDelivery } = require('../../dist/vnext/domain/deliveries');
const { configureProvider } = require('./provider-test-helper');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

function frozenFileSnapshots(directory) {
  return fs.readdirSync(directory).sort().map((name) => {
    const bytes = fs.readFileSync(path.join(directory, name));
    return { name, contentHash: createHash('sha256').update(bytes).digest('hex'), byteSize: bytes.length };
  });
}


test('recovers a committed delivery directory before its idempotency receipt is written', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-journal-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '交付恢复项目', idempotencyKey: 'journal-project' }).value;
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const created = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '交付恢复', assetIds: [asset.id], idempotencyKey: 'journal-delivery' });
    const prepared = prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: created.id, idempotencyKey: 'journal-ready' });
    const exported = exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: prepared.id, idempotencyKey: 'journal-original' });
    const stored = db.prepare('SELECT manifest_json FROM deliveries WHERE id = ?').get(created.id);
    const directoryPath = path.relative(workspaceRoot, exported.directory).split(path.sep).join('/');
    db.prepare("UPDATE deliveries SET status = 'ready', manifest_json = ? WHERE id = ?").run(JSON.stringify({ assetIds: [asset.id] }), created.id);
    db.prepare('DELETE FROM command_receipts WHERE studio_id = ? AND idempotency_key = ?').run(initialized.manifest.studioId, 'journal-recovery');
    db.prepare('INSERT INTO delivery_export_journal (idempotency_key, delivery_id, studio_id, directory_path, manifest_json, files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('journal-recovery', created.id, initialized.manifest.studioId, directoryPath, stored.manifest_json, JSON.stringify(frozenFileSnapshots(exported.directory)), new Date().toISOString());
    const recovered = exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: created.id, idempotencyKey: 'journal-recovery' });
    assert.equal(recovered.delivery.status, 'exported');
    assert.equal(fs.existsSync(path.join(recovered.directory, 'manifest.json')), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM delivery_export_journal').get().total, 0);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects a same-Studio export key for another delivery without replacing its journal entry', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-journal-conflict-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: 'journal conflict', idempotencyKey: 'journal-conflict-project' }).value;
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const first = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: 'first', assetIds: [asset.id], idempotencyKey: 'journal-conflict-first' });
    const second = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: 'second', assetIds: [asset.id], idempotencyKey: 'journal-conflict-second' });
    prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: first.id, idempotencyKey: 'journal-conflict-first-ready' });
    prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: second.id, idempotencyKey: 'journal-conflict-second-ready' });
    db.prepare('INSERT INTO delivery_export_journal (studio_id, idempotency_key, delivery_id, directory_path, manifest_json, files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(initialized.manifest.studioId, 'shared-export-key', first.id, 'daoge-deliveries/missing', '{}', '[]', new Date().toISOString());
    assert.throws(() => exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: second.id, idempotencyKey: 'shared-export-key' }), /different delivery export/);
    assert.equal(db.prepare('SELECT delivery_id FROM delivery_export_journal WHERE studio_id = ? AND idempotency_key = ?').get(initialized.manifest.studioId, 'shared-export-key').delivery_id, first.id);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
test('concurrent export keys for one delivery converge on one frozen delivery', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-concurrent-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '并发导出', idempotencyKey: 'concurrent-project' }).value;
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const draft = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '同一交付', assetIds: [asset.id], idempotencyKey: 'concurrent-delivery' });
    prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'concurrent-ready' });
    const [first, second] = await Promise.all([
      exportDeliveryAsync(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'concurrent-export-a' }),
      exportDeliveryAsync(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'concurrent-export-b' })
    ]);
    assert.equal(first.delivery.status, 'exported');
    assert.equal(second.delivery.status, 'exported');
    assert.equal(first.directory, second.directory);
    assert.equal(fs.existsSync(path.join(first.directory, 'manifest.json')), true);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});


test('exports managed assets with a contact sheet and redacted creative record', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-'));
  const initialized = initializeStudio({ workspaceRoot });
  configureProvider(initialized, { name: 'Delivery Provider', baseUrl: 'https://private-provider.example.test/v1', apiKey: 'super-secret-key', model: 'fixture-model' });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '品牌交付项目', idempotencyKey: 'project' }).value;
    const task = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '主视觉', idempotencyKey: 'task' }).value;
    const round = createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'round' }).value;
    const prepared = prepareRoundForConfirmation(db, { studioId: initialized.manifest.studioId, roundId: round.id, expectedVersion: round.version, plan: { operation: 'generate', itemCount: 1, prompt: 'delivery evidence prompt' }, idempotencyKey: 'prepare' }).value;
    confirmRoundPlan(db, { studioId: initialized.manifest.studioId, roundId: round.id, expectedVersion: prepared.version, idempotencyKey: 'confirm' });
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const delivery = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '首轮交付', assetIds: [asset.id], includeCreativeRecord: true, idempotencyKey: 'delivery' });
    assert.equal(delivery.status, 'draft');
    const deliveryReady = prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: delivery.id, idempotencyKey: 'delivery-ready' });
    const exported = exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: deliveryReady.id, idempotencyKey: 'export' });
    assert.equal(exported.delivery.status, 'exported');
    assert.deepEqual(getAssetImpact(db, initialized.manifest.studioId, asset.id), { relationCount: 2, reviewCount: 1, deliveryCount: 1 });
    assert.ok(fs.existsSync(path.join(exported.directory, 'contact-sheet.html')));
    assert.ok(fs.existsSync(path.join(exported.directory, 'manifest.json')));
    const record = fs.readFileSync(path.join(exported.directory, 'creative-record.json'), 'utf8');
    assert.match(record, /delivery evidence prompt/);
    assert.equal(record.includes('super-secret-key'), false);
    assert.equal(record.includes('https:\/\/private-provider.example.test\/v1'), false);
    assert.equal(fs.readdirSync(exported.directory).some((file) => file.endsWith('.png')), true);
    const defaultDelivery = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '默认交付', assetIds: [asset.id], idempotencyKey: 'default-delivery' });
    const defaultPrepared = prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: defaultDelivery.id, idempotencyKey: 'default-ready' });
    const defaultExport = exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: defaultPrepared.id, idempotencyKey: 'default-export' });
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
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '草稿交付项目', idempotencyKey: 'draft-project' }).value;
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id, source: { note: '选片来源' } });
    assert.throws(() => createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '不合格草稿', assetIds: [asset.id], idempotencyKey: 'draft-rejected' }), /keep review/);
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const draft = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '可审阅草稿', assetIds: [asset.id], idempotencyKey: 'draft-create' });
    assert.equal(draft.status, 'draft');
    assert.throws(() => exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'draft-export' }), /prepared/);
    const prepared = prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'draft-ready' });
    assert.equal(prepared.status, 'ready');
    assert.equal(getDelivery(db, initialized.manifest.studioId, draft.id).items[0].review.decision, 'keep');
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'reject' });
    const exported = exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'draft-final-export' });
    assert.equal(exported.delivery.status, 'exported');
    const manifest = fs.readFileSync(path.join(exported.directory, 'manifest.json'), 'utf8');
    assert.equal(manifest.includes(asset.id), false);
    assert.equal(getDelivery(db, initialized.manifest.studioId, draft.id).items[0].review.decision, 'keep');
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('replaced delivery journal files are quarantined and rebuilt before export finalizes', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-corrupt-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '交付校验', idempotencyKey: 'corrupt-project' }).value;
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const draft = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '冻结文件', assetIds: [asset.id], idempotencyKey: 'corrupt-delivery' });
    prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'corrupt-ready' });
    const original = exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'corrupt-original' });
    const stored = db.prepare('SELECT manifest_json FROM deliveries WHERE id = ?').get(draft.id);
    const snapshots = frozenFileSnapshots(original.directory);
    db.prepare("UPDATE deliveries SET status = 'ready' WHERE id = ?").run(draft.id);
    db.prepare('INSERT INTO delivery_export_journal (idempotency_key, delivery_id, studio_id, directory_path, manifest_json, files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('corrupt-recovery', draft.id, initialized.manifest.studioId, path.relative(workspaceRoot, original.directory).split(path.sep).join('/'), stored.manifest_json, JSON.stringify(snapshots), new Date().toISOString());
    fs.appendFileSync(path.join(original.directory, '001.png'), Buffer.from('replaced'));
    const recovered = exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'corrupt-recovery' });
    assert.equal(recovered.delivery.status, 'exported');
    assert.deepEqual(fs.readFileSync(path.join(recovered.directory, '001.png')), png);
    assert.equal(fs.readdirSync(initialized.paths.deliveriesRoot).some((name) => name.startsWith('.quarantine-delivery-export_')), true);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM events WHERE entity_id = ? AND event_type = 'delivery.export_recovery_rejected'").get(draft.id).total, 1);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('idempotent delivery export replay rejects missing, extra, and replaced frozen files', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-replay-integrity-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '重放完整性', idempotencyKey: 'replay-project' }).value;
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const draft = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '重放冻结集', assetIds: [asset.id], idempotencyKey: 'replay-delivery' });
    prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'replay-ready' });
    const input = { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'replay-export' };
    const exported = exportDelivery(db, initialized.paths, input);
    assert.deepEqual(exportDelivery(db, initialized.paths, input).files, exported.files);
    const manifestPath = path.join(exported.directory, 'manifest.json');
    const manifestBytes = fs.readFileSync(manifestPath);
    fs.rmSync(manifestPath);
    assert.throws(() => exportDelivery(db, initialized.paths, input), /frozen file set/);
    fs.writeFileSync(manifestPath, manifestBytes);
    fs.writeFileSync(path.join(exported.directory, 'injected.txt'), 'not frozen');
    assert.throws(() => exportDelivery(db, initialized.paths, input), /frozen file set/);
    fs.rmSync(path.join(exported.directory, 'injected.txt'));
    fs.writeFileSync(path.join(exported.directory, '001.png'), Buffer.alloc(png.length, 0x41));
    assert.throws(() => exportDelivery(db, initialized.paths, input), /identity/);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('an opened delivery file streams its verified inode after a same-size pathname replacement', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-inode-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  let opened;
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: 'inode', idempotencyKey: 'inode-project' }).value;
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const draft = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: 'inode', assetIds: [asset.id], idempotencyKey: 'inode-delivery' });
    prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'inode-ready' });
    const exported = exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'inode-export' });
    const manifest = JSON.parse(db.prepare('SELECT manifest_json FROM deliveries WHERE id = ?').get(draft.id).manifest_json);
    const entry = manifest.files[0];
    opened = openDeliveryExportFile(initialized.paths, { directoryPath: manifest.exportDirectory, name: entry.file, contentHash: entry.contentHash, byteSize: entry.byteSize, mediaType: entry.mediaType });
    const filePath = path.join(exported.directory, entry.file);
    fs.renameSync(filePath, filePath + '.verified');
    fs.writeFileSync(filePath, Buffer.alloc(png.length, 0x42));
    const chunks = [];
    for await (const chunk of opened.createReadStream()) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), png);
  } finally {
    if (opened) opened.close();
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('contact sheet escapes every hostile HTML text character in delivery names', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-html-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: 'HTML', idempotencyKey: 'html-project' }).value;
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const hostile = 'A&B <tag> "quote" \'apostrophe\'';
    const draft = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: hostile, assetIds: [asset.id], idempotencyKey: 'html-delivery' });
    prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'html-ready' });
    const exported = exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'html-export' });
    const html = fs.readFileSync(path.join(exported.directory, 'contact-sheet.html'), 'utf8');
    assert.equal(html.includes(hostile), false);
    assert.match(html, /A&amp;B &lt;tag&gt; &quot;quote&quot; &#39;apostrophe&#39;/);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('delivery export rejects same-size source mutation before committing any image bytes', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-source-mutation-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: 'mutation', idempotencyKey: 'mutation-project' }).value;
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const draft = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: 'mutation', assetIds: [asset.id], idempotencyKey: 'mutation-delivery' });
    prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'mutation-ready' });
    const mutated = Buffer.from(png);
    mutated[20] ^= 0xff;
    fs.writeFileSync(assetFilePath(initialized.paths, asset), mutated);
    assert.throws(() => exportDelivery(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'mutation-export' }), /hash|identity|content type/);
    assert.equal(getDelivery(db, initialized.manifest.studioId, draft.id).status, 'ready');
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM delivery_export_journal WHERE delivery_id = ?').get(draft.id).total, 0);
    assert.deepEqual(fs.readdirSync(path.join(initialized.paths.cacheDir, 'staging')), []);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('asynchronous delivery export yields while snapshotting, copying, and validating a large image', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-async-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: 'async delivery', idempotencyKey: 'async-project' }).value;
    const largePng = Buffer.alloc(8 * 1024 * 1024, 0);
    png.copy(largePng);
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: largePng, mediaType: 'image/png', targetType: 'project', targetId: project.id });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep' });
    const draft = createDelivery(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: 'async export', assetIds: [asset.id], idempotencyKey: 'async-delivery' });
    prepareDelivery(db, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'async-ready' });
    let eventLoopTurned = false;
    const exporting = exportDeliveryAsync(db, initialized.paths, { studioId: initialized.manifest.studioId, deliveryId: draft.id, idempotencyKey: 'async-export' });
    setImmediate(() => { eventLoopTurned = true; });
    const exported = await exporting;
    assert.equal(exported.delivery.status, 'exported');
    assert.equal(eventLoopTurned, true);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
