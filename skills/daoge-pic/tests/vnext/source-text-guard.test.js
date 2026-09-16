const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { frontendFiles, normalizeSource, readFrontendSource, readSource, stripBlockComments } = require('./source-text');

// source-text-exempt: 这个守卫要读 tests/ 里别的测试文件去找违规者，那是测试代码不是前端源码。
//
// 前端现在没有渲染级测试，于是有一大批测试靠「在源码里搜这个串」证明能力存在。
// 这种断言本身合理，但它顺带把源码的**物理形态**也锁死了：补一段 JSDoc、把代码
// 挪到另一个文件，都会让一堆无关的测试变红。tests/vnext/source-text.js 就是为此收口的
// 一层 —— 这条用例守的是「这个收口别被绕过去」。

const TESTS = path.join(__dirname);
const SKILL_ROOT = path.resolve(__dirname, '../..');

function testFiles() {
  return fs.readdirSync(TESTS).filter((name) => name.endsWith('.test.js')).map((name) => path.join(TESTS, name));
}

/**
 * 某个测试文件可以不走 source-text —— 但它必须当场写明为什么。
 * 写法：`source-text-exempt: 理由`。空着不算数。
 */
const EXEMPT = /source-text-exempt:\s*(\S[^\n]*)/;

/** 取 `readFileSync(` 第一个实参的原文。按括号配对截断，避免把整行尾巴都算进来。 */
function firstArgument(source, openParen) {
  let depth = 0;
  let out = '';
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') { depth += 1; continue; }
    if (char === ')') { depth -= 1; if (depth === 0) break; continue; }
    if (char === ',' && depth === 1) break;
    out += char;
  }
  return out;
}

/**
 * 文件里指向前端源码的变量名。
 * 只看同一行挡不住 `const MAIN = path.join(__dirname, '../../web/src/main.jsx')` 再
 * `readFileSync(MAIN)` 的写法 —— 实测有人这么绕过去过。这里把这类变量认出来。
 * 跑两遍是为了接住二级变量（`const X = path.join(SRC, 'y')` 派生出来的下一个）。
 */
function frontendPathVariables(source) {
  const known = new Set();
  for (let pass = 0; pass < 2; pass += 1) {
    for (const match of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n;]*)/g)) {
      const [, name, expression] = match;
      if (known.has(name)) continue;
      const borrowed = [...known].some((other) => new RegExp('\\b' + other + '\\b').test(expression));
      if (/web\/src/.test(expression) || borrowed) known.add(name);
    }
  }
  return known;
}

test('测试不许绕过 source-text 读前端源码，路径藏在变量里也算', () => {
  // 判定收紧到「这次读取的目标确实是前端源码」为止：读 .gitignore / tsconfig /
  // docs / src/vnext 这些跟 web/src 无关的文件不该在这里被拦，否则守卫自己就成了改动税。
  const offenders = [];
  for (const file of testFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    if (EXEMPT.test(source)) continue;
    const variables = frontendPathVariables(source);
    for (const match of source.matchAll(/readFileSync\s*\(/g)) {
      const argument = firstArgument(source, match.index + match[0].length - 1);
      const throughVariables = [...variables].filter((name) => new RegExp('\\b' + name + '\\b').test(argument));
      if (!/web\/src/.test(argument) && throughVariables.length === 0) continue;
      const line = source.slice(0, match.index).split('\n').length;
      const how = /web\/src/.test(argument) ? '直接' : '经变量 ' + throughVariables.join('、');
      offenders.push(path.basename(file) + ':' + line + ' ' + how + '读前端源码');
    }
  }
  assert.deepEqual(offenders, [], '直接读源码会把「补注释 / 挪文件」重新变成改动税，请用 readFrontendSource() / readSource() / readStyles()');
});

test('去注释只处理块注释，且不会碰字符串里的内容', () => {
  assert.equal(stripBlockComments('const a = 1; /* 去掉 */ const b = 2;'), 'const a = 1;   const b = 2;');
  assert.equal(stripBlockComments("const a = '/* 不是注释 */';"), "const a = '/* 不是注释 */';");
  assert.equal(stripBlockComments('const a = `/* 也不是 */`;'), 'const a = `/* 也不是 */`;');
  assert.equal(stripBlockComments('const re = /^\\s*\\/\\/.*$/;'), 'const re = /^\\s*\\/\\/.*$/;', '行注释要留着：正则字面量里常有 //，扫掉会把表达式切断');
});

test('readFrontendSource 覆盖前端全部代码文件，且不含类型声明与样式表', () => {
  // ⚠️ path.relative 在 Windows 上返回 `web\src\…`（反斜杠），下面的断言与错误消息都按 `/` 写，
  // 所以先归一到 POSIX 分隔符 —— 否则第一个文件就会让这条断言在 Windows 上必红。
  // 归一不影响下面的顺序断言：排序发生在绝对路径上，前缀相同，转换后顺序不变。
  const files = frontendFiles().map((file) => path.relative(SKILL_ROOT, file).split(path.sep).join('/'));
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
