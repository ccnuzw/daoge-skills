const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizePromptMaterials } = require('../../src/domain/material_resolver');
const { makeTempDir, writeJson, writeTinyPng } = require('../helpers/workspace_v2_test_utils');

test('material resolver keeps material issues local when prompt indexes repeat', () => {
  const tempDir = makeTempDir();
  const promptsFile = path.join(tempDir, 'prompts.json');
  writeTinyPng(path.join(tempDir, 'refs', 'ok.png'));
  writeJson(promptsFile, [
    { index: 1, generation_prompt: 'first', reference_images: ['refs/missing.png'] },
    { index: 1, generation_prompt: 'second', reference_images: ['refs/ok.png'] },
  ]);
  const result = normalizePromptMaterials(JSON.parse(fs.readFileSync(promptsFile, 'utf8')), { promptsFile });
  assert.equal(result.prompts[0].materialIssues.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(result.prompts[1], 'materialIssues'), false);
});

test('material resolver treats stat errors as unavailable material', () => {
  const tempDir = makeTempDir();
  const promptsFile = path.join(tempDir, 'prompts.json');
  const imagePath = path.join(tempDir, 'refs', 'unstable.png');
  writeTinyPng(imagePath);
  writeJson(promptsFile, [{ generation_prompt: 'first', reference_images: ['refs/unstable.png'] }]);
  const originalStatSync = fs.statSync;
  fs.statSync = (candidate) => {
    if (path.resolve(candidate) === imagePath) throw new Error('stat failed');
    return originalStatSync(candidate);
  };
  try {
    const result = normalizePromptMaterials(JSON.parse(fs.readFileSync(promptsFile, 'utf8')), { promptsFile });
    assert.equal(result.prompts[0].materialIssues.length, 1);
    assert.match(result.prompts[0].materialIssues[0].message, /缺少参考图/);
  } finally {
    fs.statSync = originalStatSync;
  }
});
