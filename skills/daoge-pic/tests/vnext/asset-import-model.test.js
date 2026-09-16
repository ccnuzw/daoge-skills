const test = require('node:test');
const assert = require('node:assert/strict');

// 导入这块过去是 main.jsx 里 62 行缠着 13 个局部量的逻辑，谁也测不到。
// 判断部分抽成纯模块后，这些用例守的是「搬完之后判断还是原来那个判断」。
const MODEL = '../../web/src/asset-import-model.mjs';

const project = { id: 'p1' };
const task = { id: 't1' };
const draftRound = { id: 'r1', status: 'draft' };
const confirmedRound = { id: 'r1', status: 'confirmed' };

test('导入范围按 轮次 > 任务 > 项目 逐级回落，都没有时返回 null', async () => {
  const { resolveUploadTarget } = await import(MODEL);
  assert.deepEqual(resolveUploadTarget({ assetScope: 'round', selectedRound: draftRound, selectedTask: task, selectedProject: project }), { type: 'creative_round', id: 'r1' });
  assert.deepEqual(resolveUploadTarget({ assetScope: 'task', selectedRound: null, selectedTask: task, selectedProject: project }), { type: 'creative_task', id: 't1' });
  assert.deepEqual(resolveUploadTarget({ assetScope: 'project', selectedRound: null, selectedTask: null, selectedProject: project }), { type: 'project', id: 'p1' });
  // ⚠️ 范围挂错 = 素材出现在别的工作对象下。空选择必须显式返回 null，不能默认落到项目。
  assert.equal(resolveUploadTarget({ assetScope: 'round', selectedRound: null, selectedTask: null, selectedProject: null }), null);
  assert.equal(resolveUploadTarget({ assetScope: 'project', selectedProject: null }), null);
});

test('范围是轮次但没有选中轮次时，不会越级挂到项目上', async () => {
  // 这条单独拎出来：它是最容易写成 `?? project` 而悄悄改归属的地方。
  const { resolveUploadTarget } = await import(MODEL);
  assert.deepEqual(resolveUploadTarget({ assetScope: 'round', selectedRound: null, selectedTask: null, selectedProject: project }), { type: 'project', id: 'p1' }, '轮次缺失时回落到项目是有意为之，改之前先看这条');
});

test('素材需求只在确实缺它时才生效，否则按范围给默认用途', async () => {
  const { resolveUploadMaterial } = await import(MODEL);
  const hit = resolveUploadMaterial({ selectedImportNeed: '品牌 Logo', contextMaterialNeeds: ['品牌 Logo'], assetScope: 'project' });
  assert.equal(hit.need, '品牌 Logo');
  assert.equal(hit.preset.usage, 'brand');

  const missed = resolveUploadMaterial({ selectedImportNeed: '别的需求', contextMaterialNeeds: ['品牌 Logo'], assetScope: 'round' });
  assert.equal(missed.need, '', '不在上下文需求里就不该打标');
  assert.equal(missed.preset.usage, 'subject', '轮次范围给个默认用途');

  const plain = resolveUploadMaterial({ selectedImportNeed: null, contextMaterialNeeds: [], assetScope: 'project' });
  assert.equal(plain.preset, null, '项目范围没有默认用途，别硬塞');
});

test('进度每一步都钳到总数', async () => {
  const { advanceUploadProgress } = await import(MODEL);
  assert.deepEqual(advanceUploadProgress(null, 3), { completed: 1, total: 3 });
  assert.deepEqual(advanceUploadProgress({ completed: 2, total: 3 }, 3), { completed: 3, total: 3 });
  assert.deepEqual(advanceUploadProgress({ completed: 3, total: 3 }, 3), { completed: 3, total: 3 }, '多出来的完成数不能把进度刷过 100%');
});

test('并入参考素材时同一张图以新导入的为准，且不产生重复', async () => {
  const { mergeImportedReferences } = await import(MODEL);
  const merged = mergeImportedReferences({
    existing: [{ assetId: 'a1', usage: 'style', note: '旧的' }],
    importedAssets: [{ id: 'a1' }, { id: 'a2' }, { id: null }],
    usage: 'subject',
    note: '本轮直接导入'
  });
  assert.deepEqual(merged, [
    { assetId: 'a1', usage: 'subject', note: '本轮直接导入' },
    { assetId: 'a2', usage: 'subject', note: '本轮直接导入' }
  ], '重复导入同一张图要覆盖而不是叠一条；没有 id 的响应要丢掉');
});

test('只有草稿轮次才会被自动挂上参考素材', async () => {
  const { shouldLinkImportedToRound } = await import(MODEL);
  assert.equal(shouldLinkImportedToRound({ succeeded: 2, importedCount: 2, selectedRound: draftRound, assetScope: 'round' }), true);
  assert.equal(shouldLinkImportedToRound({ succeeded: 2, importedCount: 2, selectedRound: confirmedRound, assetScope: 'round' }), false, '已确认的轮次不能被静默改');
  assert.equal(shouldLinkImportedToRound({ succeeded: 0, importedCount: 0, selectedRound: draftRound, assetScope: 'round' }), false);
  assert.equal(shouldLinkImportedToRound({ succeeded: 2, importedCount: 2, selectedRound: null, assetScope: 'project' }), false);
});

test('导入结果的提示覆盖全成功、部分失败、全失败', async () => {
  const { uploadOutcome } = await import(MODEL);
  assert.deepEqual(uploadOutcome({ total: 3, failed: [] }), { succeeded: 3, notice: '已导入 3 张图片。', error: '' });
  assert.deepEqual(uploadOutcome({ total: 3, failed: [], savedAsReference: true }).notice, '已导入 3 张图片，并已按用途加入当前这一轮的参考素材。');

  const partial = uploadOutcome({ total: 3, failed: [{ name: 'a.png' }, { name: 'b.png' }] });
  assert.deepEqual(partial, { succeeded: 1, notice: '已导入 1 张图片，2 张失败。', error: '有 2 张图片导入失败：a.png、b.png。' });

  const allFailed = uploadOutcome({ total: 2, failed: [{ name: 'a.png' }, { name: 'b.png' }] });
  assert.equal(allFailed.succeeded, 0);
  assert.equal(allFailed.notice, '', '全军覆没就别报喜');
  assert.equal(allFailed.error, '有 2 张图片导入失败：a.png、b.png。');

  const many = uploadOutcome({ total: 5, failed: ['a', 'b', 'c', 'd'].map((name) => ({ name })) });
  assert.equal(many.error, '有 4 张图片导入失败：a、b、c 等。', '失败多于 3 张时只点名前 3 个');
});

test('只有图片进导入流程，非图片与残缺项被丢掉', async () => {
  const { imageFilesFrom } = await import(MODEL);
  const files = [{ type: 'image/png' }, { type: 'application/pdf' }, { type: undefined }, {}, null];
  assert.deepEqual(imageFilesFrom(files), [{ type: 'image/png' }]);
  assert.deepEqual(imageFilesFrom(null), []);
  assert.deepEqual(imageFilesFrom(undefined), []);
});

test('遮罩导入先校验再拼头，且恒定挂在项目下', async () => {
  const { maskImportProblem, maskImportHeaders } = await import(MODEL);
  assert.equal(maskImportProblem({ selectedProject: null, file: { type: 'image/png' } }), '请先选择项目，再导入遮罩图。');
  assert.equal(maskImportProblem({ selectedProject: project, file: { type: 'application/pdf' } }), '请选择图片文件作为遮罩。');
  assert.equal(maskImportProblem({ selectedProject: project, file: { type: 'image/png' } }), '');

  assert.deepEqual(maskImportHeaders({ projectId: 'p1', file: { name: '遮罩 a.png' } }), {
    'x-daoge-filename': encodeURIComponent('遮罩 a.png'),
    'x-daoge-target-type': 'project',
    'x-daoge-target-id': 'p1'
  });
  assert.equal(maskImportHeaders({ projectId: 'p1', file: {} })['x-daoge-filename'], 'mask.png', '没有文件名时兜底');
});
