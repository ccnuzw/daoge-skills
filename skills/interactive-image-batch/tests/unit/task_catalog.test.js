const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readJson, skillRoot } = require('../helpers/workspace_v2_test_utils');

test('task_catalog_zh exposes six user-first starter tasks', () => {
  const catalog = readJson(path.join(skillRoot, 'references', 'task_catalog_zh.json'));
  const ids = catalog.tasks.map((item) => item.id);
  ['portrait', 'studio', 'ecommerce', 'packaging', 'cinematic', 'oralboard'].forEach((id) => {
    assert.equal(ids.includes(id), true, `missing ${id}`);
  });
  catalog.tasks.forEach((task) => {
    assert.equal(typeof task.name, 'string');
    assert.equal(typeof task.plainSummary, 'string');
    assert.equal(Array.isArray(task.bestFor), true);
    assert.equal(Array.isArray(task.userNeeds), true);
    assert.match(task.startCommand, /^--intent /);
    assert.equal(typeof task.defaultStart, 'string');
    assert.equal(Object.prototype.hasOwnProperty.call(task, 'internalMapping'), false);
  });
  const text = JSON.stringify(catalog).toLowerCase();
  ['template', 'variant', 'manifest', 'registry', 'runtime', 'artifact', 'slot'].forEach((term) => {
    assert.equal(text.includes(term), false, `found ${term}`);
  });
});
