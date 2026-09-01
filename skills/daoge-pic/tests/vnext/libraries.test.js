const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { listTaskTypes, createUserTaskType, createStyleKit, createBrandKit, listStyleKits, listBrandKits } = require('../../dist/vnext/domain/libraries');
const { importStudioAsset } = require('../../dist/vnext/domain/assets');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

test('seeds official task types and stores user kits with managed asset references', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-library-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const official = listTaskTypes(db, initialized.manifest.studioId);
    assert.ok(official.some((type) => type.id === 'campaign-poster' && type.source === 'official'));
    assert.ok(official.some((type) => type.id === 'cinematic-storyboard'));
    const custom = createUserTaskType(db, { studioId: initialized.manifest.studioId, name: '自定义商品序列', definition: { fields: ['frame_count', 'product'] }, idempotencyKey: 'custom-type' });
    assert.equal(custom.source, 'user');
    assert.equal(createUserTaskType(db, { studioId: initialized.manifest.studioId, name: '自定义商品序列', definition: { fields: ['frame_count', 'product'] }, idempotencyKey: 'custom-type' }).id, custom.id);
    assert.throws(() => createUserTaskType(db, { studioId: initialized.manifest.studioId, name: '忽略的重放名称', definition: {}, idempotencyKey: 'custom-type' }), /Idempotency key/);
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png' });
    const style = createStyleKit(db, { studioId: initialized.manifest.studioId, name: '冷调编辑风格', definition: { palette: ['#1c2534'], lighting: 'soft' }, assetIds: [asset.id], idempotencyKey: 'style' });
    const brand = createBrandKit(db, { studioId: initialized.manifest.studioId, name: '品牌约束', definition: { forbidden: ['watermark'], typography: 'reserved' }, assetIds: [asset.id], idempotencyKey: 'brand' });
    assert.deepEqual(listStyleKits(db, initialized.manifest.studioId)[0].assetIds, [asset.id]);
    assert.deepEqual(listBrandKits(db, initialized.manifest.studioId)[0].assetIds, [asset.id]);
    assert.equal(style.name, '冷调编辑风格');
    assert.equal(brand.name, '品牌约束');
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM events WHERE event_type IN ('style_kit.created', 'brand_kit.created')").get().total, 2);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('scopes user task types to their Studio while retaining global official task types', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-library-scope-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const secondStudioId = 'studio_task_type_scope_b';
  try {
    db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(secondStudioId, workspaceRoot + '-second', 17, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    const first = createUserTaskType(db, { studioId: initialized.manifest.studioId, name: '同名用户类型', definition: { studio: 'first' }, idempotencyKey: 'scope-first' });
    const second = createUserTaskType(db, { studioId: secondStudioId, name: '同名用户类型', definition: { studio: 'second' }, idempotencyKey: 'scope-second' });
    assert.throws(() => createUserTaskType(db, { studioId: initialized.manifest.studioId, name: '同名用户类型', definition: {}, idempotencyKey: 'scope-first-duplicate' }), /already exists/);
    const firstTypes = listTaskTypes(db, initialized.manifest.studioId);
    const secondTypes = listTaskTypes(db, secondStudioId);
    assert.equal(firstTypes.some((type) => type.id === first.id && type.studioId === initialized.manifest.studioId), true);
    assert.equal(firstTypes.some((type) => type.id === second.id), false);
    assert.equal(secondTypes.some((type) => type.id === second.id && type.studioId === secondStudioId), true);
    assert.equal(secondTypes.some((type) => type.id === first.id), false);
    assert.equal(firstTypes.some((type) => type.id === 'campaign-poster' && type.studioId === null), true);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
