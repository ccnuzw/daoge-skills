const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { createProject, createTaskDraft, createRoundDraft } = require('../../dist/vnext/domain/studio-commands');
const { getCanvasLayout, saveCanvasLayout } = require('../../dist/vnext/domain/canvas-layouts');

/**
 * 系统引用线的投影（方案 4.3 第三刀，施工单 A8 的投影式收口）。
 *
 * `creative_rounds.parent_round_id` 是「衍生自」这条关系的**唯一事实源**；画布本来就
 * 在渲染期从它算线。A8 把这层关系**投影**进 `canvas_links`（像搜索索引是事实的人话投影），
 * 因此它必须：由后端派生、标 `system`、不覆盖用户手动连线、且**不做自动成组**
 *（折叠之后批次节点本身就是组，B3 已定）。
 */

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-canvas-links-'));
}

function setup() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const studioId = initialized.manifest.studioId;
  const project = createProject(db, { studioId, name: '谱系项目', idempotencyKey: 'project' }).value;
  const task = createTaskDraft(db, { studioId, projectId: project.id, name: '任务', idempotencyKey: 'task' }).value;
  const parent = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'parent' }).value;
  const child = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'refinement', parentRoundId: parent.id, idempotencyKey: 'child' }).value;
  const orphan = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'variation', idempotencyKey: 'orphan' }).value;
  const otherTask = createTaskDraft(db, { studioId, projectId: project.id, name: '别的任务', idempotencyKey: 'task-2' }).value;
  const otherRound = createRoundDraft(db, { studioId, taskId: otherTask.id, purpose: 'exploration', idempotencyKey: 'other-round' }).value;
  return { workspaceRoot, initialized, db, studioId, project, task, parent, child, orphan, otherRound };
}

function dispose(fixture) {
  closeStudioDatabase(fixture.db);
  fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}

function roundNode(roundId, index) {
  return { entityType: 'round', entityId: roundId, x: 300, y: 100 + index * 160, width: 220, height: 120 };
}

test('保存布局时按 parent_round_id 自动补写系统引用线，且不覆盖手动连线', () => {
  const fixture = setup();
  try {
    const saved = saveCanvasLayout(fixture.db, {
      studioId: fixture.studioId,
      projectId: fixture.project.id,
      nodes: [roundNode(fixture.parent.id, 0), roundNode(fixture.child.id, 1)],
      groups: [],
      links: [{ id: 'manual-link-1', sourceType: 'round', sourceId: fixture.parent.id, targetType: 'round', targetId: fixture.child.id, linkType: 'alternative', label: '备选' }]
    });
    const system = saved.links.filter((link) => link.metadata?.system === 'round_parent');
    assert.equal(system.length, 1, '恰好一条系统引用线');
    assert.deepEqual([system[0].sourceType, system[0].sourceId, system[0].targetType, system[0].targetId, system[0].linkType], ['round', fixture.parent.id, 'round', fixture.child.id, 'reference']);
    assert.equal(system[0].label, '衍生自');
    assert.equal(saved.links.some((link) => link.id === 'manual-link-1'), true, '用户手动连线必须保留');
    assert.equal(saved.groups.length, 0, '不做自动成组（折叠节点本身就是组）');

    // 幂等：再存一次不会重复，也不会漂移。
    const resaved = saveCanvasLayout(fixture.db, { studioId: fixture.studioId, projectId: fixture.project.id, nodes: [roundNode(fixture.parent.id, 0), roundNode(fixture.child.id, 1)], groups: [], links: [{ id: 'manual-link-1', sourceType: 'round', sourceId: fixture.parent.id, targetType: 'round', targetId: fixture.child.id, linkType: 'alternative', label: '备选' }] });
    assert.equal(resaved.links.filter((link) => link.metadata?.system === 'round_parent').length, 1, '重复保存不产生重复系统线');
  } finally {
    dispose(fixture);
  }
});

test('父批次不在画布上就不画系统线（端点必须都在这一张布局里）', () => {
  const fixture = setup();
  try {
    const saved = saveCanvasLayout(fixture.db, { studioId: fixture.studioId, projectId: fixture.project.id, nodes: [roundNode(fixture.child.id, 0)], groups: [], links: [] });
    assert.equal(saved.links.length, 0, '父批次不在画布，不应出现只有一端的关系');
    const orphanSaved = saveCanvasLayout(fixture.db, { studioId: fixture.studioId, projectId: fixture.project.id, nodes: [roundNode(fixture.orphan.id, 0)], groups: [], links: [] });
    assert.equal(orphanSaved.links.length, 0, '没有父批次的批次不产生系统线');
  } finally {
    dispose(fixture);
  }
});

test('系统引用线只属于当前项目，不会把别的任务/项目的批次连进来', () => {
  const fixture = setup();
  try {
    const saved = saveCanvasLayout(fixture.db, { studioId: fixture.studioId, projectId: fixture.project.id, nodes: [roundNode(fixture.parent.id, 0), roundNode(fixture.child.id, 1), roundNode(fixture.otherRound.id, 2)], groups: [], links: [] });
    const system = saved.links.filter((link) => link.metadata?.system === 'round_parent');
    assert.equal(system.length, 1);
    assert.equal(system.some((link) => link.sourceId === fixture.otherRound.id || link.targetId === fixture.otherRound.id), false, '无父批次的批次不应被连进来');
  } finally {
    dispose(fixture);
  }
});

test('画布读取时能拿到系统线，但它是只读投影（GET 与 SAVE 一致）', () => {
  const fixture = setup();
  try {
    saveCanvasLayout(fixture.db, { studioId: fixture.studioId, projectId: fixture.project.id, nodes: [roundNode(fixture.parent.id, 0), roundNode(fixture.child.id, 1)], groups: [], links: [] });
    const loaded = getCanvasLayout(fixture.db, { studioId: fixture.studioId, projectId: fixture.project.id });
    assert.equal(loaded.links.filter((link) => link.metadata?.system === 'round_parent').length, 1);
  } finally {
    dispose(fixture);
  }
});
