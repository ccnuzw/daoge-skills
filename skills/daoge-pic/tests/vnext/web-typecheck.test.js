const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

// source-text-exempt: 这一组用例找的是 @ts-ignore 之类的逃逸注释，而 readSource() 会先把块注释剥掉
// —— 用它就等于把要抓的东西洗没了。这里必须读原始字节。
//
// 前端（web/src）是 JS + JSX，靠 tsconfig.web.json 的 checkJs 做渐进式类型检查。
// 这个守卫不跑 tsc（跑一次要十几秒，交给 `npm run typecheck:web` 卡在构建里），
// 它守的是「不能悄悄把检查关掉」：配置不能被降级，也不能用逃逸注释把错误埋掉。

const WEB_SRC = path.join(__dirname, '../../web/src');
const TSCONFIG = path.join(__dirname, '../../tsconfig.web.json');

/**
 * tsconfig 允许写注释（jsonc），但不能直接用正则删注释：include 里的 `web/src/**\/*`
 * 会被 `/*` 误判成注释开头。这里逐字符扫一遍，只在字符串外面才认注释。
 */
function stripJsonComments(source) {
  let out = '';
  let inString = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inString) {
      out += char;
      if (char === '\\') { out += next; index += 1; } else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; out += char; continue; }
    if (char === '/' && next === '/') { while (index < source.length && source[index] !== '\n') index += 1; continue; }
    if (char === '/' && next === '*') { index += 2; while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1; index += 1; continue; }
    out += char;
  }
  return out;
}

function readConfig() {
  return JSON.parse(stripJsonComments(fs.readFileSync(TSCONFIG, 'utf8')));
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

test('前端类型检查配置必须开着 checkJs 且覆盖整个 web/src', () => {
  const config = readConfig();
  assert.equal(config.compilerOptions.allowJs, true, 'allowJs 必须打开，否则 JS 文件根本不进检查');
  assert.equal(config.compilerOptions.checkJs, true, 'checkJs 必须打开，否则这个配置形同虚设');
  assert.equal(config.compilerOptions.noEmit, true, '前端不做类型 emit，产物仍由 vite 出');
  assert.deepEqual(config.include, ['web/src/**/*'], 'include 收窄会让新文件逃过检查');
});

test('前端类型检查的档位只能抬不能降', () => {
  // 抬档记录在 tsconfig.web.json 的注释里，这里锁住「当前档位」这个下界：
  // 想放松必须同时改这个数字和注释，review 时才会被看见。
  const config = readConfig();
  assert.equal(config.compilerOptions.strict, false, '当前档位是 strict=false；抬档时连这个断言一起改');
  assert.equal(config.compilerOptions.strictNullChecks, undefined, '严格空值检查还没抬上来，显式写 false 属于偷偷降档');
  assert.equal(config.compilerOptions.noImplicitAny, undefined, '隐式 any 检查还没抬上来，显式写 false 属于偷偷降档');
});

test('web/src 里不允许用逃逸注释把类型错误埋掉', () => {
  const offenders = [];
  for (const file of walk(WEB_SRC)) {
    if (!/\.(?:jsx?|mjs|ts)$/.test(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const [index, line] of source.split('\n').entries()) {
      if (/@ts-(?:ignore|expect-error|nocheck)/.test(line)) offenders.push(path.relative(WEB_SRC, file) + ':' + (index + 1) + ' ' + line.trim());
    }
  }
  assert.deepEqual(offenders, [], '类型错误要么真修，要么把类型写对；逃逸注释会让 checkJs 失去意义');
});

test('类型定义文件不许散落在各处，统一放在能被 tsconfig include 到的位置', () => {
  const declarations = walk(WEB_SRC).filter((file) => file.endsWith('.d.ts')).map((file) => path.basename(file));
  assert.ok(declarations.length <= 3, '.d.ts 只该用来声明全局契约，多了说明该补真正的类型：' + declarations.join(', '));
  for (const name of declarations) assert.match(name, /^[a-z0-9-]+\.d\.ts$/, '全局声明文件用小写中划线命名：' + name);
});
