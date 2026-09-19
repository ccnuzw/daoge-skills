'use strict';

/**
 * 测试读源码的统一入口。
 *
 * 前端目前没有渲染级测试（没有 jsdom / testing-library），所以一大堆测试是靠
 * 「在源码里搜这个字符串」来证明某个能力存在。这种断言本身没问题，问题在于
 * 它把**源码的物理形态**也一起锁死了：加一段 JSDoc、换一次格式、把代码挪到
 * 另一个文件，测试就红，而这三件事都不该改变「这个能力存不存在」这个结论。
 *
 * 这个模块把「读源码」这件事收口，只保留语义、去掉物理形态：
 *   - 去掉块注释（字符串感知），这样补类型标注 / 写说明不会打断断言；
 *   - `readFrontendSource()` 返回**整个前端代码**而不是单个文件，这样把
 *     main.jsx 拆成多个模块时，断言仍然成立 —— 它问的本来就是
 *     「这个能力在前端里有没有」，不是「它在不在 main.jsx 里」。
 *
 * 刻意**不压平空白**：有一批断言是按缩进定位结构的（例如
 * `/\r?\n    <\/div>\r?\n    \{menuOpen && …/`），压平了反而会打断它们。
 * 换行与缩进目前不是改动税的主要来源，等哪天上了格式化工具再说。
 *
 * 用法：
 *   const { readFrontendSource, readSource, readStyles } = require('../support/source-text');
 *   assert.match(readFrontendSource(), /全选本页/);
 */

const fs = require('node:fs');
const path = require('node:path');

const SKILL_ROOT = path.resolve(__dirname, '../..');
const FRONTEND_DIR = path.join(SKILL_ROOT, 'web/src');
const FRONTEND_EXTENSIONS = new Set(['.js', '.jsx', '.mjs']);
const STYLESHEET = 'web/src/styles.css';

/**
 * 去掉 `/* … *\/` 块注释。逐个字符串地扫，避免把字符串里的 `/*` 当成注释开头。
 * 不碰 `//` 行注释：JS 的正则字面量里经常出现 `//`（例如匹配行注释用的
 * `/^\s*\/\/.*$/`），无字符串的扫描器一碰就把它切断。补 JSDoc 用的是块注释，
 * 处理它就足够消掉绝大部分「加了注释测试就红」的改动税。
 */
function stripBlockComments(source) {
  let out = '';
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      out += char;
      if (char === '\\') { out += next; index += 1; } else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; out += char; continue; }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 1;
      out += ' ';
      continue;
    }
    out += char;
  }
  return out;
}

function normalizeSource(source) {
  return stripBlockComments(source).replace(/\r\n/g, '\n');
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** 前端源码文件（.js/.jsx/.mjs，不含 .d.ts 与样式表），按路径排序保证结果稳定。 */
function frontendFiles() {
  return walk(FRONTEND_DIR)
    .filter((file) => FRONTEND_EXTENSIONS.has(path.extname(file)))
    .sort();
}

let frontendCache = null;

/**
 * 整个前端的源码（去注释 + 压空白后拼成一份）。
 * 用来断言「某个能力在前端里存在」，而不断言它在哪个文件里 —— 拆文件不会让它失效。
 */
function readFrontendSource() {
  if (frontendCache === null) frontendCache = frontendFiles().map((file) => normalizeSource(fs.readFileSync(file, 'utf8'))).join('\n');
  return frontendCache;
}

/** 单个文件，相对 skill 根目录（例如 `web/src/main.jsx`、`src/vnext/api/server.ts`）。 */
function readSource(relativePath) {
  return normalizeSource(fs.readFileSync(path.join(SKILL_ROOT, relativePath), 'utf8'));
}

/**
 * 样式表**不是一个文件**了（批 A A1 起 `styles.css` 是分层汇聚入口）。
 * 这里按真实层叠顺序拼接：tokens → base → primitives → components → organisms → templates → surfaces。
 * 未知的新层按文件名字典序追加在最后——保证 `readStyles()` 永远看得到全部样式，
 * 而不是只看到入口那三行 @import（否则一堆样式断言会静默失效）。
 */
const STYLE_LAYER_ORDER = [
  'web/src/tokens',
  'web/src/styles/base.css',
  'web/src/styles/primitives.css',
  'web/src/styles/components.css',
  'web/src/styles/organisms.css',
  'web/src/styles/templates.css',
  'web/src/styles/surfaces'
];

function styleFiles() {
  const files = [];
  const seen = new Set();
  const pushFile = (relative) => {
    const full = path.join(SKILL_ROOT, relative);
    if (!seen.has(full) && fs.existsSync(full) && fs.statSync(full).isFile()) { seen.add(full); files.push(full); }
  };
  const walk = (relative) => {
    const full = path.join(SKILL_ROOT, relative);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isFile()) { pushFile(relative); return; }
    for (const entry of fs.readdirSync(full, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = relative + '/' + entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.css')) pushFile(child);
    }
  };
  for (const layer of STYLE_LAYER_ORDER) walk(layer);
  // 兜底：未被上面规则覆盖到的样式文件（新增层）也要进结果。
  const walkUnknown = (relative) => {
    const full = path.join(SKILL_ROOT, relative);
    if (!fs.existsSync(full)) return;
    for (const entry of fs.readdirSync(full, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = relative + '/' + entry.name;
      if (entry.isDirectory()) { if (child === 'web/src/styles/surfaces') continue; walkUnknown(child); continue; }
      if (!entry.name.endsWith('.css')) continue;
      if (/^web\/src\/(tokens|styles)\//.test(child)) continue;
      pushFile(child);
    }
  };
  walkUnknown('web/src');
  return files;
}

function readStyles() {
  return styleFiles().map((file) => normalizeSource(fs.readFileSync(file, 'utf8'))).join('\n');
}

/** 目标文件存在吗——给「已规划但还没实现」的守卫用（避免它们为了存在性判断去裸读前端源码）。 */
function webSourceExists(relativePath) {
  return fs.existsSync(path.join(SKILL_ROOT, relativePath));
}

module.exports = {
  FRONTEND_DIR,
  SKILL_ROOT,
  STYLESHEET,
  styleFiles,
  webSourceExists,
  frontendFiles,
  normalizeSource,
  readFrontendSource,
  readSource,
  readStyles,
  stripBlockComments
};
