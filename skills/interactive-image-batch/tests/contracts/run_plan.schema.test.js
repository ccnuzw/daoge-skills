const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRunPlan } = require('../../src/domain/run_plan');
const { makeTempDir, writeJson } = require('../helpers/workspace_v2_test_utils');
const path = require('path');

test('run_plan contract describes task, readiness and prompt plan', () => {
  const outputDir = makeTempDir();
  const taskSpec = path.join(outputDir, 'task_spec.json');
  const prompts = path.join(outputDir, 'prompts.json');
  writeJson(taskSpec, { content_brief: '高端人物海报', width: 1024, height: 1536, batch_size: 2 });
  writeJson(prompts, [{ title: 'A' }, { title: 'B' }]);
  const plan = buildRunPlan({ outputDir, taskSpecFile: taskSpec, promptsFile: prompts });
  assert.equal(plan.schemaVersion, 2);
  assert.equal(plan.task.id, 'portrait');
  assert.equal(plan.readiness.canRun, true);
  assert.equal(plan.promptPlan.promptCount, 2);
});

test('run_plan uses materials file directory as base when materialBaseDir is omitted', () => {
  const outputDir = makeTempDir();
  const taskSpec = path.join(outputDir, 'normalized', 'task_spec.normalized.json');
  const materialsFile = path.join(outputDir, 'source', 'task_spec.json');
  writeJson(taskSpec, { content_brief: '高端人物海报', width: 1024, height: 1536, batch_size: 2 });
  writeJson(materialsFile, {
    content_brief: '高端人物海报',
    reference_images: [{ title: '人物参考', path: 'relative.png' }],
  });
  const plan = buildRunPlan({ outputDir, taskSpecFile: taskSpec, materialsFile });
  assert.equal(plan.materials.baseDir, path.dirname(materialsFile));
  assert.equal(plan.materials.references[0].baseDir, path.dirname(materialsFile));
});
