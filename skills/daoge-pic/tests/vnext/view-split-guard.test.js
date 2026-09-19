const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { SKILL_ROOT, frontendFiles, normalizeSource } = require('./source-text');

// 「条件渲染被拆成文本」是第 9 批（界面批 E）拆视图时真实发生过的事故形态：
// split 工具把 `return cond ? <X/> : null` 包成了 `return <>cond ? <X/> : null</>`，
// 于是创作平台、项目总览、任务三屏上直接渲染出「selectedProject ?」和「: null」两段源码文字。
// 真机冒烟没拦住它——这条守卫把事故形态钉死：片段里不许出现条件表达式残骸。
const CONDITION_TEXT_IN_FRAGMENT = /<>\s*[A-Za-z_$][A-Za-z0-9_$.]*\s*(\?|&&)/;
const ORPHAN_NULL_CLOSER = /:\s*null\s*<\/>/;

test('视图源码不得留下「条件渲染拆成文本」的拆分残骸', () => {
  const violations = [];
  for (const file of frontendFiles()) {
    const source = normalizeSource(fs.readFileSync(file, 'utf8'));
    const relative = path.relative(SKILL_ROOT, file);
    const condition = CONDITION_TEXT_IN_FRAGMENT.exec(source);
    if (condition) violations.push(relative + ' — 片段内条件残骸：' + condition[0].slice(0, 60));
    const orphan = ORPHAN_NULL_CLOSER.exec(source);
    if (orphan) violations.push(relative + ' — ": null</>" 残骸');
  }
  assert.deepEqual(violations, [], '条件渲染被拆成文本（会直接渲染到界面上）：\n' + violations.join('\n'));
});