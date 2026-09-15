const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { frontendFiles, normalizeSource, readFrontendSource, readSource, stripBlockComments } = require('./source-text');

// 前端现在没有渲染级测试，于是有一大批测试靠「在源码里搜这个串」证明能力存在。
// 这种断言本身合理，但它顺带把源码的**物理形态**也锁死了：补一段 JSDoc、把代码
// 挪到另一个文件，都会让一堆无关的测试变红。tests/vnext/source-text.js 就是为此收口的
// 一层 —— 这几个用例守的是「这个收口别被绕过去」。

const TESTS = path.join(__dirname);
const SKILL_ROOT = path.resolve(__dirname, '../..');

function testFiles() {
  return fs.readdirSync(TESTS).filter((name) => name.endsWith('.test.js')).map((name) => path.join(TESTS, name));
}

test('测试不许直接读前端源码，一律走 source-text 这一层', () => {
  const offenders = [];
  for (const file of testFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [index, line] of source.split('\n').entries()) {
      if (!/readFileSync/.test(line)) continue;
      if (!/web\/src/.test(line)) continue;
      offenders.push(path.basename(file) + ':' + (index + 1) + ' ' + line.trim());
    }
  }
  assert.deepEqual(offenders, [], '直接 readFileSync 会把「补注释 / 挪文件」重新变成改动税，请用 readFrontendSource() / readSource() / readStyles()');
});

test('去注释只处理块注释，且不会碰字符串里的内容', () => {
  assert.equal(stripBlockComments('const a = 1; /* 去掉 */ const b = 2;'), 'const a = 1;   const b = 2;');
  assert.equal(stripBlockComments("const a = '/* 不是注释 */';"), "const a = '/* 不是注释 */';");
  assert.equal(stripBlockComments('const a = `/* 也不是 */`;'), 'const a = `/* 也不是 */`;');
  assert.equal(stripBlockComments('const re = /^\\s*\\/\\/.*$/;'), 'const re = /^\\s*\\/\\/.*$/;', '行注释要留着：正则字面量里常有 //，扫掉会把表达式切断');
});

test('readFrontendSource 覆盖前端全部代码文件，且不含类型声明与样式表', () => {
  const files = frontendFiles().map((file) => path.relative(SKILL_ROOT, file));
  assert.ok(files.length >= 50, '前端文件应该有几十个，少了说明扫描规则漏了：' + files.length);
  for (const file of files) assert.match(file, /^web\/src\/.+\.(?:js|jsx|mjs)$/, file);
  assert.ok(!files.some((file) => file.endsWith('.d.ts')), '类型声明不是运行时代码，不该进断言范围');
  assert.ok(!files.some((file) => file.endsWith('.css')), '样式表单独用 readStyles()');
  assert.deepEqual(files, [...files].sort(), '文件顺序必须稳定，否则断言结果不可复现');
});

test('readFrontendSource 的结果与单文件读取一致，能扛住代码在文件之间搬家', () => {
  const blob = readFrontendSource();
  for (const file of frontendFiles()) {
    const relative = path.relative(SKILL_ROOT, file);
    const own = normalizeSource(fs.readFileSync(file, 'utf8'));
    assert.ok(blob.includes(own.replace(/\s+$/, '')), relative + ' 的内容必须出现在前端整体里');
  }
});

test('readSource 与 readFrontendSource 都吃过同一套规范化', () => {
  const main = readSource('web/src/main.jsx');
  assert.ok(readFrontendSource().includes(main.replace(/\s+$/, '')));
  assert.doesNotMatch(main, /@typedef/, 'JSDoc 必须被剥掉，否则补类型标注又会打断断言');
});
