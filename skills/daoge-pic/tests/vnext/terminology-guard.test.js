// 术语治理的守卫。断言刻意写得很死：一句话就只能是一句话，多一处手写副本就 fail。
// 为什么必须固化：A/B 两轮已经证明文案会在后续重构里被顺手改回去，只写文档守不住。
//
// 两个批次：
//   第一批 —— 边界免责句收成一句（9 处 → 1 处 + 确认出图那一句）。
//   第二批 —— 「收回」级术语从创作者面清出，术语单落成可 import 的模块。
//
// 注意：`require` 一个 .mjs 需要 Node ≥ 22.12（本仓库测试已在该版本以上运行）。
// 这样术语单只有一个来源 —— 测试与产品读的是同一份数据，不会各自漂移。

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const terminology = require('../../web/src/terminology.mjs');
const { CONFIG_FACE_FILES, DOC_FACE_FILES, TERM_LEVELS, TERM_SCOPES, TERMS, forbiddenInVisibleCopy, visibleCopyStrings } = terminology;

const SRC = path.join(__dirname, '../../web/src');
const DOC = path.join(__dirname, '../../docs/daoge_pic_terminology_zh.md');

const read = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');
const listSources = () => fs.readdirSync(SRC).filter((name) => /\.(jsx|mjs)$/.test(name));

// 「面向面」——一刀切会改坏东西，所以按面分文件。清单的唯一来源是术语单模块。
const CONFIG_FACE = [...CONFIG_FACE_FILES];
const DOC_FACE = [...DOC_FACE_FILES];
// 术语表自身就是这些词的持有者，不参与扫描。
const TERM_OWNERS = ['terminology.mjs'];
const CREATOR_FACE = listSources().filter((name) => !CONFIG_FACE.includes(name) && !DOC_FACE.includes(name) && !TERM_OWNERS.includes(name));


test('草稿边界句只有一个来源', () => {
  // 这句话此前在 9 个地方各写了一遍，用户要读 9 次才知道自己在哪一步。
  const handWritten = CREATOR_FACE.filter((name) => name !== 'boundary-copy.mjs' && read(name).includes('这一步只记草稿'));
  assert.deepEqual(handWritten, [], '这些文件手写了边界句副本，应改为 import DRAFT_BOUNDARY_COPY');

  const owner = read('boundary-copy.mjs');
  assert.match(owner, /export const DRAFT_BOUNDARY_COPY = '这一步只记草稿，不出图，也不产生费用。';/);
});

test('草稿阶段每个提示点都复用同一个常量', () => {
  const main = read('main.jsx');
  // 7 个弹窗各一处：4 处直接用默认句，3 处用「常量 + 各自独有的一句动作提示」拼接。
  assert.equal((main.match(/<ExecutionBoundaryNote/g) || []).length, 7);
  assert.equal((main.match(/<ExecutionBoundaryNote \/>/g) || []).length, 4);
  assert.equal((main.match(/DRAFT_BOUNDARY_COPY \+ '/g) || []).length, 3);
  assert.equal((main.match(/import \{ DRAFT_BOUNDARY_COPY \} from '\.\/boundary-copy\.mjs';/g) || []).length, 1);

  // 动作面板是第 8 处，同样复用常量，不再自带一整句工程话。
  const launcher = read('creative-action-launcher.jsx');
  assert.match(launcher, /import \{ DRAFT_BOUNDARY_COPY \} from '\.\/boundary-copy\.mjs';/);
  assert.match(launcher, /\{DRAFT_BOUNDARY_COPY\}/);
});

test('旧的工程话免责句不再回潮', () => {
  const RETIRED = [
    /仅写入 Studio 事实源/,
    /不调用 Provider/,
    /不会调用 Provider/,
    /不会启动生成/,
    /不会确认、预检、创建 Generation Run/,
    /不会确认计划、预检、创建 Generation Run/,
    /确认不会调用 Provider/
  ];
  for (const name of CREATOR_FACE) {
    const source = read(name);
    for (const pattern of RETIRED) assert.doesNotMatch(source, pattern, name + ' 仍含已退休的免责句：' + pattern);
  }
});

test('只有确认出图弹窗解释「确认之后会怎样」，且只用真实拿得到的事实', () => {
  const owners = listSources().filter((name) => read(name).includes('在此之前的所有操作都不会产生费用'));
  assert.deepEqual(owners, ['main.jsx']);

  const main = read('main.jsx');
  assert.equal((main.match(/function confirmationPlanSummary\(/g) || []).length, 1);
  assert.match(main, /先核算，再出图/);
  assert.match(main, /confirmationPlanSummary\(generationConfirmation\.round\)/);
  // 工程细节留在技术详情层，不许悄悄删掉：确认≠调用生成服务。
  assert.match(main, /note="确认会把这版计划绑定到当前 conversation 与计划哈希；确认本身不会调用生成服务/);
  // 不编承诺：时间与金额要等会话真正执行时才有依据，界面里不许出现预估话术。
  assert.doesNotMatch(main, /预计 ¥|预计¥|预计 \d+ 分钟/);
});

test('确认弹窗把工程细节放在人话之下', () => {
  const dialog = read('confirmation-dialog.jsx');
  assert.match(dialog, /note = ''/);
  assert.match(dialog, /className="confirmation-dialog-note"/);
  // note 是可选项：其余确认弹窗（归档 / 回收站 / Provider）不受影响。
  const styles = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
  assert.match(styles, /\.confirmation-dialog-copy \.confirmation-dialog-note \{/);
});

// ---------- 第二批：术语单 ----------

test('术语单自身结构自检', () => {
  // 三级 + 三面都不能少：少了「收回」就等于没有可执行的禁用规则。
  assert.deepEqual([...TERM_LEVELS], ['保留', '译好', '收回']);
  assert.deepEqual([...TERM_SCOPES], ['creator', 'config', 'doc']);

  const internals = TERMS.map((term) => term.internal);
  assert.deepEqual(internals, [...new Set(internals)], '术语单里有重复条目');

  for (const term of TERMS) {
    assert.ok(term.internal && term.level && term.scope, '缺字段：' + JSON.stringify(term));
    assert.ok(TERM_LEVELS.includes(term.level), term.internal + ' 的级别不在三级内：' + term.level);
    assert.ok(TERM_SCOPES.includes(term.scope), term.internal + ' 的面向面不在三面内：' + term.scope);
    // 「收回」必须给出人能看懂的说法 —— 否则只是把词藏起来，创作者仍然不知道那是什么。
    if (term.forbidInCreator) {
      assert.equal(term.level, '收回', term.internal + '：只有「收回」级才允许在创作者面禁用');
      assert.equal(term.scope, 'creator', term.internal + '：创作者面禁用词必须归在 creator 面');
      assert.ok(term.creator, term.internal + '：已禁用就必须给出替代说法');
    }
  }

  // 禁用清单必须与「收回」级一致，不允许两套口径。
  assert.deepEqual(forbiddenInVisibleCopy().sort(), TERMS.filter((term) => term.forbidInCreator).map((term) => term.internal).sort());
});

test('创作者面的可见文案里没有「收回」级术语', () => {
  const forbidden = forbiddenInVisibleCopy();
  const violations = [];
  for (const name of CREATOR_FACE) {
    for (const copy of visibleCopyStrings(read(name))) {
      const hits = forbidden.filter((word) => copy.includes(word));
      if (hits.length) violations.push(name + ' | ' + hits.join(',') + ' | ' + JSON.stringify(copy));
    }
  }
  assert.deepEqual(violations, [], '这些创作者面文案里还留着实现词，换成人话或下沉到技术详情层：\n' + violations.join('\n'));
});

test('扫描器只看可见文案，不看标识符与注释', () => {
  // 这条守的是「口径」本身：上一轮把 providerId / assetScope 这类标识符算进密度表，
  // 得出的数字是虚高的、也没法改。口径必须在测试里钉死。
  const sample = [
    '// 注释里的 Provider 不算',
    '/* 块注释里的 端点 也不算 */',
    "const providerId = 'x';",
    "const label = '生成服务配置';",
    'const node = <span>出图由后台队列执行</span>;'
  ].join('\n');
  const copy = visibleCopyStrings(sample);
  assert.deepEqual(copy, ['生成服务配置', '出图由后台队列执行']);
});

test('面清单里的文件都必须真实存在，避免清单腐烂', () => {
  for (const name of [...CONFIG_FACE, ...DOC_FACE]) {
    assert.ok(listSources().includes(name), '面清单里的文件已不存在：' + name);
  }
});

test('人读版术语单与模块一一对应（反向守卫，防单边漂移）', () => {
  const markdown = fs.readFileSync(DOC, 'utf8');
  // 表格首列写成 `内部词`，据此提取。
  const documented = [...markdown.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]);
  const internals = TERMS.map((term) => term.internal);
  const missing = internals.filter((term) => !documented.includes(term));
  const extra = documented.filter((term) => !internals.includes(term));
  assert.deepEqual(missing, [], 'docs/daoge_pic_terminology_zh.md 缺少这些条目：' + missing.join(','));
  assert.deepEqual(extra, [], 'docs/daoge_pic_terminology_zh.md 多出这些条目：' + extra.join(','));
  assert.equal(documented.length, internals.length, '人读版条目数与模块不一致');
  assert.equal(new Set(documented).size, documented.length, '人读版里有重复条目');
});

