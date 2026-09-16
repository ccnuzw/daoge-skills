const test = require('node:test');
const assert = require('node:assert/strict');

// 选片是一串串行写，每写一次都要回答「这次的返回值还算不算数」。这些语义过去
// 只能靠在 main.jsx 里搜字符串来「证明」存在，现在真跑一遍。
const MODEL = '../../web/src/selection-model.mjs';

test('过期的结果不许落地：切走项目或被更新的写顶掉都算过期', async () => {
  const { isSelectionWriteCurrent } = await import(MODEL);
  assert.equal(isSelectionWriteCurrent({ projectId: 'p1', currentProjectId: 'p1', epoch: 3, currentEpoch: 3 }), true);

  assert.equal(isSelectionWriteCurrent({ projectId: 'p1', currentProjectId: 'p2', epoch: 3, currentEpoch: 3 }), false, '项目切走了，结果不属于当前上下文');
  assert.equal(isSelectionWriteCurrent({ projectId: 'p1', currentProjectId: 'p1', epoch: 3, currentEpoch: 4 }), false, '已经有更新的写，旧结果必须丢弃');
});

test('解除 busy 只看项目，不看 epoch', async () => {
  const { shouldClearSelectionBusy } = await import(MODEL);
  assert.equal(shouldClearSelectionBusy({ projectId: 'p1', currentProjectId: 'p1' }), true);
  assert.equal(shouldClearSelectionBusy({ projectId: 'p1', currentProjectId: 'p2' }), false, '项目切走后切换那一侧会整体重置，这里不该再动');
  // ⚠️ 这条是刻意的：被顶掉的写（epoch 过期）仍要放人，否则 id 会永远卡在 busy。
  // 上面这个函数签名里根本没有 epoch，就是要让这个决定无处可改。
});

test('勾选与取消产生新的 id 集合，不改动原集合', async () => {
  const { nextSelectedIds } = await import(MODEL);
  const before = new Set(['a1']);
  const added = nextSelectedIds(before, ['a2'], true);
  assert.deepEqual([...added].sort(), ['a1', 'a2']);
  assert.deepEqual([...before], ['a1'], '原集合不许被就地改');

  assert.deepEqual([...nextSelectedIds(new Set(['a1', 'a2']), ['a1'], false)], ['a2']);
  assert.deepEqual([...nextSelectedIds(new Set(), ['a1', 'a1'], true)], ['a1'], '重复 id 由 Set 自然去重');
});

test('busy 集按批进出', async () => {
  const { nextBusySet } = await import(MODEL);
  const busy = nextBusySet(new Set(), ['a1', 'a2'], true);
  assert.deepEqual([...busy].sort(), ['a1', 'a2']);
  assert.deepEqual([...nextBusySet(busy, ['a1'], false)], ['a2']);
});

test('批量 id 按 500 分片，且先去重去空', async () => {
  const { chunkAssetIds, SELECTION_BATCH_SIZE } = await import(MODEL);
  assert.equal(SELECTION_BATCH_SIZE, 500);
  assert.deepEqual(chunkAssetIds([]), [], '空列表不分片');
  assert.deepEqual(chunkAssetIds(['a', 'a', '', null, 'b']), [['a', 'b']], '先去重去空');

  const ids = Array.from({ length: 1200 }, (_, index) => 'id' + index);
  const chunks = chunkAssetIds(ids);
  assert.deepEqual(chunks.map((chunk) => chunk.length), [500, 500, 200]);
  assert.deepEqual(chunks.flat(), ids, '分片不能丢 id 也不能重排');
});

test('分批提交保留最后一个非空结果，空响应不把已选清成空', async () => {
  const { latestSelection } = await import(MODEL);
  const first = { assets: [{ id: 'a1' }] };
  assert.equal(latestSelection(first, undefined), first, '空批次可能不返回 selection');
  assert.equal(latestSelection(first, null), first);
  const second = { assets: [{ id: 'a2' }] };
  assert.equal(latestSelection(first, second), second);
});

test('全选本页只改动状态不同的资产', async () => {
  const { selectionCandidates } = await import(MODEL);
  const assets = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
  const selectedIds = new Set(['a1']);
  assert.deepEqual(selectionCandidates(assets, selectedIds, true).map((a) => a.id), ['a2', 'a3'], '已选中的不再重复提交');
  assert.deepEqual(selectionCandidates(assets, selectedIds, false).map((a) => a.id), ['a1'], '取消时只动已选中的');
  assert.deepEqual(selectionCandidates(assets, new Set(['a1', 'a2', 'a3']), true), [], '全都已经是目标状态就一笔都不发');
  assert.deepEqual(selectionCandidates([], selectedIds, true), []);
});

test('补 keep 评审的清单只在勾选时产生，且跳过已有 keep 的', async () => {
  const { keepCandidateIds } = await import(MODEL);
  const assets = [{ id: 'a1', review: { decision: 'keep' } }, { id: 'a2', review: { decision: 'review' } }, { id: 'a3' }];
  assert.deepEqual(keepCandidateIds(assets, true), ['a2', 'a3'], '已经有 keep 的不用再补');
  assert.deepEqual(keepCandidateIds(assets, false), [], '取消时不涉及评审');
});

test('并入选片清单：勾选去重，取消移除，查不到的资产被丢掉', async () => {
  const { mergeSelectionAssets } = await import(MODEL);
  const current = [{ id: 'a1' }];

  assert.deepEqual(mergeSelectionAssets(current, [{ id: 'a1' }, { id: 'a2' }], true), [{ id: 'a1' }, { id: 'a2' }], '已有的不重复追加');
  assert.deepEqual(mergeSelectionAssets(current, [{ id: 'a2' }, undefined], true), [{ id: 'a1' }, { id: 'a2' }], '查不到的资产不能塞进去');
  assert.deepEqual(mergeSelectionAssets([{ id: 'a1' }, { id: 'a2' }], [{ id: 'a1' }], false), [{ id: 'a2' }]);
  assert.deepEqual(mergeSelectionAssets([], [], true), []);
});

test('选为成果：已选中的再点一次是取消，没有项目就什么都不做', async () => {
  const { deliverableIntent, needsKeepReview } = await import(MODEL);
  assert.equal(deliverableIntent({ hasProject: false, isSelected: false }), 'skip');
  assert.equal(deliverableIntent({ hasProject: true, isSelected: true }), 'deselect', '再点一次是取消，不是重复选');
  assert.equal(deliverableIntent({ hasProject: true, isSelected: false }), 'select');

  assert.equal(needsKeepReview({ review: { decision: 'keep' } }), false);
  assert.equal(needsKeepReview({ review: { decision: 'reject' } }), true);
  assert.equal(needsKeepReview({}), true, '没有评审记录的要补一条');
});

test('服务端返回的选片结果转成 id 集合，空结果给空集', async () => {
  const { selectionIdSet } = await import(MODEL);
  assert.deepEqual([...selectionIdSet({ assets: [{ id: 'a1' }, { id: 'a2' }] })], ['a1', 'a2']);
  assert.deepEqual([...selectionIdSet(undefined)], []);
  assert.deepEqual([...selectionIdSet({})], []);
});
