const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SKILL_ROOT } = require('./source-text');

/**
 * G1 / G2 / G5 / G7 / G8 / G9（界面批 E · E4）。
 *
 * G1 版式：views/ 不得出现 max-width（宽度只由注册表的 layout 档决定）；
 * G2 断点：所有 CSS 只允许 1280 / 900 / 640 + prefers-reduced-motion；
 * G5 状态槽：views/ 与 canvas/ 不得渲染全宽状态条（那是壳的职责）；
 * G7 层依赖：只许向下（components → templates → views/canvas → app），不许反向；
 * G8 行数：薄壳与视图的上限（app 壳 ≤250、views ≤400、canvas 单文件 ≤1000）；
 * G9 焦点：凡定义 :hover 的选择器，同一文件里必须有它的 :focus-visible 版本。
 */

const SRC = path.join(SKILL_ROOT, 'web/src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else out.push(child);
  }
  return out;
}

const cssFiles = () => walk(path.join(SRC, 'styles')).filter((f) => f.endsWith('.css'));

test('G2：断点只有三档（1280 / 900 / 640）+ prefers-reduced-motion', () => {
  const allowed = new Set(['1280px', '900px', '640px']);
  const bad = [];
  for (const file of cssFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/@media\s*\(([^)]+)\)/g)) {
      const query = m[1].trim();
      const width = query.match(/max-width:\s*(\d+)px/);
      // 900 档的 min-width 对偶（901）是批 A 的既定写法，允许。
      if (width && !allowed.has(width[1] + 'px') && !(query.startsWith('min-width') && width[1] === '901')) bad.push(path.basename(file) + '：' + query);
      if (!width && !/^min-width/.test(query) && !query.includes('prefers-reduced-motion')) bad.push(path.basename(file) + '：' + query);
    }
  }
  assert.deepEqual([...new Set(bad)], [], '这些断点不在三档里：\n' + [...new Set(bad)].join('\n'));
});

test('G9：凡有 :hover 的选择器，同文件必有 :focus-visible 版本', () => {
  const missing = [];
  for (const file of cssFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/([^{}]+):hover[^{}]*\{/g)) {
      const selector = m[1].trim().split('}').pop().trim();
      const focus = selector.replace(/:hover/g, ':focus-visible');
      if (!text.includes(focus)) missing.push(path.basename(file) + '：' + selector.slice(0, 60));
    }
  }
  assert.deepEqual([...new Set(missing)], [], '这些悬停规则缺焦点配套：\n' + [...new Set(missing)].join('\n'));
});

test('G1：views/ 不得自写 max-width；G5：views/canvas 不得渲染状态条', () => {
  const views = walk(path.join(SRC, 'views')).filter((f) => f.endsWith('.jsx'));
  const canvas = walk(path.join(SRC, 'canvas')).filter((f) => f.endsWith('.jsx'));
  const widthOffenders = views.filter((f) => /max-width\s*:/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f));
  assert.deepEqual(widthOffenders, [], '页面宽度只能由注册表的 layout 档决定：' + widthOffenders.join('、'));
  const statusOffenders = [...views, ...canvas].filter((f) => fs.readFileSync(f, 'utf8').includes('data-region="status"')).map((f) => path.basename(f));
  assert.deepEqual(statusOffenders, [], '全宽状态条是壳的职责，视图不许自己渲染：' + statusOffenders.join('、'));
});

test('G7：层依赖只许向下（components → templates → views/canvas → app）', () => {
  // app/ 有两种身份：**共享面**（对话框/请求口/外壳件，属下层）与**壳三件**（App/Shell/Controller，属顶层）。
  const SHELL_TRIO = ['workbench-app.jsx', 'workbench-shell.jsx', 'workbench-controller.jsx'];
  const layerOf = (file) => {
    const rel = path.relative(SRC, file);
    for (const name of ['components', 'templates', 'views', 'canvas', 'app']) {
      if (rel.startsWith(name + path.sep)) {
        if (name === 'app' && SHELL_TRIO.includes(path.basename(file))) return 'shell';
        return name === 'app' ? 'shared' : name;
      }
    }
    return null;
  };
  const rank = { components: 0, shared: 1, templates: 1, views: 2, canvas: 2, shell: 3 };
  const bad = [];
  for (const file of walk(SRC).filter((f) => /\.(jsx|mjs|js)$/.test(f))) {
    const from = layerOf(file);
    if (!from) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/from '(?:\.\.\/)*((?:components|templates|views|canvas|app)\/[^']+)'/g)) {
      const base = m[1].split('/').pop();
      let to = m[1].split('/')[0];
      if (to === 'app') to = SHELL_TRIO.includes(base) ? 'shell' : 'shared';
      if (rank[to] > rank[from]) bad.push(path.relative(SRC, file) + ' → ' + m[1]);
    }
  }
  assert.deepEqual([...new Set(bad)], [], '这些 import 逆着层依赖：\n' + [...new Set(bad)].join('\n'));
});

test('G8：薄壳与视图的行数上限', () => {
  const lines = (file) => fs.readFileSync(file, 'utf8').split('\n').length;
  const app = path.join(SRC, 'app/workbench-app.jsx');
  assert.ok(lines(app) <= 250, 'App 壳必须 ≤250 行，现在 ' + lines(app));
  const views = walk(path.join(SRC, 'views')).filter((f) => f.endsWith('.jsx'));
  const big = views.filter((f) => lines(f) > 400).map((f) => path.basename(f) + '：' + lines(f));
  assert.deepEqual(big, [], 'views 必须 ≤400 行：' + big.join('、'));
  const canvas = walk(path.join(SRC, 'canvas')).filter((f) => f.endsWith('.jsx'));
  const huge = canvas.filter((f) => lines(f) > 1000).map((f) => path.basename(f) + '：' + lines(f));
  assert.deepEqual(huge, [], '画布单文件必须 ≤1000 行：' + huge.join('、'));
});