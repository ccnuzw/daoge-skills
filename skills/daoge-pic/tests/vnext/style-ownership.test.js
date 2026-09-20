const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SKILL_ROOT, readSource } = require('./source-text');

/**
 * G4 · 样式归属（界面批 E · E3）：**同一个选择器不许跨文件重复定义**。
 *
 * 判据：把 `web/src/styles/**\/*.css` 每个文件的顶层选择器收集起来，任何选择器
 * 只能出现在一个文件里。这样「覆盖式补丁」（后加载的文件偷偷改别人块的样式）
 * 在结构上不可能再发生——要改就改那个块自己。
 */
function stylesheetFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...stylesheetFiles(p));
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

function selectorsOf(text) {
  // 带媒体上下文收集：@media 里的覆盖与普通规则不算「重复定义」。
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '');
  const out = [];
  const mediaStack = [];
  let i = 0;
  while (i < clean.length) {
    const rest = clean.slice(i);
    const media = rest.match(/^\s*@media([^{]*)\{/);
    if (media) {
      mediaStack.push('@media' + media[1].trim());
      i += media[0].length;
      continue;
    }
    const close = rest.match(/^\s*\}/);
    if (close) {
      if (mediaStack.length) mediaStack.pop();
      i += close[0].length;
      continue;
    }
    const rule = rest.match(/^\s*([^{}@]+?)\s*\{/);
    if (rule) {
      const selector = rule[1].trim().replace(/\s+/g, ' ');
      out.push((mediaStack.join(' ') + ' ' + selector).trim());
      i += rule[0].length;
      // 跳过规则体（到配对的 }）
      let depth = 1;
      while (i < clean.length && depth > 0) {
        if (clean[i] === '{') depth += 1;
        else if (clean[i] === '}') depth -= 1;
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out;
}

test('G4：同一个选择器不许跨文件重复定义', () => {
  const root = path.join(SKILL_ROOT, 'web/src/styles');
  const owner = new Map();
  const dup = [];
  for (const file of stylesheetFiles(root)) {
    const rel = path.relative(SKILL_ROOT, file);
    for (const selector of selectorsOf(fs.readFileSync(file, 'utf8'))) {
      if (owner.has(selector) && owner.get(selector) !== rel) dup.push(selector + '（' + owner.get(selector) + ' 与 ' + rel + '）');
      else owner.set(selector, rel);
    }
  }
  assert.deepEqual(dup.slice(0, 10), [], '这些选择器跨文件重复定义：\n' + dup.slice(0, 10).join('\n'));
  assert.ok(owner.size > 200, '选择器总数太少了，解析器可能没工作：' + owner.size);
});

/**
 * G4 的第二条：**汇聚入口的加载顺序**。
 *
 * 级联顺序就是这里的字面顺序，两条都不能动：
 * 1. `responsive.css` 最后——它持有全部 @media 覆盖，而 @media 不带来优先级。
 * 2. 其余十一个块的顺序复现拆分前巨石文件的效果。G4 只查整条选择器，查不到
 *    逗号列表成员跨文件重复（`.project-task-list button`、`.error-strip` 这类），
 *    那些样式的成败就只看顺序。换顺序等于改渲染，所以这里钉死。
 */
const BLOCK_LOAD_ORDER = [
  'shell', 'info-pages', 'misc', 'assets', 'settings', 'runs', 'projects', 'viewer', 'delivery', 'dialogs', 'canvas', 'responsive'
];

test('G4：汇聚入口的顺序钉死（responsive.css 最后，其余复现巨石文件效果）', () => {
  const aggregator = readSource('web/src/styles/surfaces/workbench.css');
  const imports = [...aggregator.matchAll(/@import\s+'\.\.\/blocks\/([\w-]+)\.css'/g)].map((match) => match[1]);
  assert.deepEqual(imports, BLOCK_LOAD_ORDER, '汇聚入口的加载顺序改了就等于改渲染（' + imports.join(' → ') + '）：responsive.css 必须最后，否则 901px 档的 overflow-y:auto 会被 .work-surface 的 overflow:hidden 压住，右侧主功能区整片不可滚动');

  // 顺序钉死之外还得确保「文件没漏」：新增块必须显式登记，不能悄悄少加载一个。
  const onDisk = fs.readdirSync(path.join(SKILL_ROOT, 'web/src/styles/blocks')).filter((name) => name.endsWith('.css')).map((name) => name.replace(/\.css$/, '')).sort();
  assert.deepEqual(onDisk, [...BLOCK_LOAD_ORDER].sort(), 'web/src/styles/blocks 里的块与汇聚入口不一致');
});