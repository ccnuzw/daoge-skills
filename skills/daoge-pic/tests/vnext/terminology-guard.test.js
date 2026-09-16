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

const { readSource, readStyles } = require('./source-text');
const terminology = require('../../web/src/terminology.mjs');
const { CONFIG_FACE_FILES, DOC_FACE_FILES, TERM_LEVELS, TERM_SCOPES, TERMS, forbiddenInVisibleCopy, visibleCopyStrings } = terminology;

const SRC = path.join(__dirname, '../../web/src');
const DOC = path.join(__dirname, '../../docs/daoge_pic_terminology_zh.md');

const read = (name) => readSource('web/src/' + name);
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
  const styles = readStyles();
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

test('创作者面的可见文案里也没有「译好」级术语（技术详情层白名单除外）', () => {
  const translated = terminology.translatedInVisibleCopy();
  const allowed = [...terminology.ADVANCED_DETAILS_ALLOWED_COPY];
  const violations = [];
  for (const name of CREATOR_FACE) {
    for (const copy of visibleCopyStrings(read(name))) {
      if (allowed.includes(copy)) continue; // 技术详情层：逐条登记，不许整文件放行
      const hits = translated.filter((word) => copy.includes(word));
      if (hits.length) violations.push(name + ' | ' + hits.join(',') + ' | ' + JSON.stringify(copy));
    }
  }
  assert.deepEqual(violations, [], '这些创作者面文案还在用内部说法，换成术语单里的创作者说法：\n' + violations.join('\n'));
});

test('配置面专属术语不许出现在创作者面的可见文案里', () => {
  // 这条补的是一个「写了没人读」的字段：术语单给 Profile 标了 scope: 'config'，
  // 但守卫只读 forbidInCreator 和 level，scope 从头到尾没有任何断言在执行 ——
  // 结果是左侧栏挂着「请先创建并激活 Profile」，而测试全绿。
  const configOnly = terminology.configFaceTerms();
  assert.ok(configOnly.length > 0, 'scope: config 的术语一条都没有，检查术语单是不是被改坏了');

  const violations = [];
  for (const name of CREATOR_FACE) {
    for (const copy of visibleCopyStrings(read(name))) {
      const hits = configOnly.filter((word) => copy.includes(word));
      if (hits.length) violations.push(name + ' | ' + hits.join(',') + ' | ' + JSON.stringify(copy));
    }
  }
  assert.deepEqual(violations, [], '这些创作者面文案用了配置面专属术语，换成人话，或把它留在配置面：\n' + violations.join('\n'));
});

test('技术详情层白名单没有悄悄长成一整块', () => {
  const allowed = [...terminology.ADVANCED_DETAILS_ALLOWED_COPY];
  // 白名单只服务「技术详情」这一层：每条都必须是「预检」相关的短字符串，
  // 且总量有上限 —— 否则就说明有人在用白名单绕过治理。
  assert.ok(allowed.length <= 6, '技术详情白名单已经膨胀到 ' + allowed.length + ' 条，检查一下是不是整文件放行了');
  for (const copy of allowed) {
    assert.ok(copy.length <= 12, '白名单条目过长，不像技术详情层的短标签：' + copy);
    assert.ok(allowed.filter((item) => item === copy).length === 1, '白名单条目重复：' + copy);
  }
  // 白名单里的每一条都必须在源码里真的存在，防止留下失效条目。
  for (const copy of allowed) {
    const owners = listSources().filter((name) => read(name).includes(copy));
    assert.notDeepEqual(owners, [], '白名单条目在源码里已经找不到了：' + copy);
  }
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

// ---------- 第四批：config 面 ----------
// 这一面刻意保留术语（要照着服务商文档填地址、填密钥、对型号），
// 但保留必须付代价：顶部一句人话导语 + 每个字段一句人话 + 名词表折叠隔离。

test('config 面：留下的每个术语都在名词表里有一句人话', async () => {
  const { CONFIG_TERM_GLOSSARY, CONFIG_FIELD_HINTS, CONFIG_FACE_INTRO, CONFIG_GLOSSARY_COPY, configFieldHint } = await import('../../web/src/config-face-copy.mjs');
  const settings = read('provider-settings.jsx');

  const terms = CONFIG_TERM_GLOSSARY.map(([term]) => term);
  assert.equal(new Set(terms).size, terms.length, 'config 面名词表里有重复条目');
  for (const [term, plain] of CONFIG_TERM_GLOSSARY) {
    assert.ok(term && plain, 'config 面名词表条目不完整：' + term);
    assert.notEqual(plain, term, 'config 面名词表的人话就是术语本身：' + term);
    // 不许解释一个源码里已经不存在的词 —— 那只会让名词表慢慢变成一份谎言。
    assert.ok(settings.includes(term), 'provider-settings.jsx 里已经没有这个词了：' + term);
  }

  // 字段人话不能是死条目：每个 key 都必须在面板里真的被引用。
  for (const key of Object.keys(CONFIG_FIELD_HINTS)) {
    assert.ok(settings.includes("configFieldHint('" + key + "')"), 'CONFIG_FIELD_HINTS 里这条没有被用到：' + key);
    assert.ok(configFieldHint(key), 'CONFIG_FIELD_HINTS 里这条是空的：' + key);
  }

  assert.ok(CONFIG_FACE_INTRO.length > 10, 'config 面缺少顶部人话导语');
  assert.match(settings, /\{CONFIG_FACE_INTRO\}/);
  assert.ok(CONFIG_GLOSSARY_COPY.summary && CONFIG_GLOSSARY_COPY.note);
});

test('config 面：技术名词表与主路径视觉隔离（收在折叠区里）', () => {
  const settings = read('provider-settings.jsx');
  // 折叠 = 默认不占主路径。写成常显就等于把技术名词摊在创作者脸上。
  assert.match(settings, /<details className="provider-secondary-panel provider-glossary-panel">/);
  assert.match(settings, /provider-glossary-list/);
  // 面板在 idle 与表单两种模式下都挂 —— 填表的时候才是最需要查名词的时候。
  assert.match(settings, /<section className="provider-profile-panel">\s*\n\s*<ConfigGlossaryPanel \/>/);
  // 视觉隔离要有样式兜底，否则 details 只是个没有边界感的裸元素。
  const styles = readStyles();
  assert.match(styles, /\.provider-glossary-panel \{/);
  assert.match(styles, /\.provider-field-hint \{/);
  assert.match(styles, /\.provider-settings-plain \{/);
});

// ---------- 第五批：doc 面 ----------
// 手册要讲清系统怎么跑，术语必须留；但首次出现必须给解释，顶部再挂名词表兜底。

test('doc 面：名词表覆盖的术语都真的出现在手册正文里', async () => {
  const { DOC_TERM_GLOSSARY, DOC_GLOSSARY_COPY } = await import('../../web/src/doc-face-copy.mjs');
  const content = read('learning-center-content.mjs') + read('learning-center.jsx') + read('offline-strategy-model.mjs');

  const terms = DOC_TERM_GLOSSARY.map(([term]) => term);
  assert.equal(new Set(terms).size, terms.length, 'doc 面名词表里有重复条目');
  for (const [term, plain] of DOC_TERM_GLOSSARY) {
    assert.ok(term && plain, 'doc 面名词表条目不完整：' + term);
    assert.notEqual(plain, term, 'doc 面名词表的人话就是术语本身：' + term);
    assert.ok(content.includes(term), '手册正文里已经没有这个词了：' + term);
  }
  assert.ok(DOC_GLOSSARY_COPY.summary && DOC_GLOSSARY_COPY.note);
});

test('doc 面：名词表挂在手册顶部，且术语首次出现处有括注', async () => {
  const { DOC_TERM_GLOSSARY } = await import('../../web/src/doc-face-copy.mjs');
  const center = read('learning-center.jsx');
  assert.match(center, /<DocGlossaryPanel \/>/);
  assert.match(center, /from '\.\/doc-face-copy\.mjs'/);

  // 首次出现给解释 —— 抽查几个最容易让人卡住的词，必须带全角括号括注。
  // （daemon 的括注挂在 Workbench 那处，写作「daemon 是常驻本机的后台服务」，所以这里查 Workbench。）
  const content = read('learning-center-content.mjs');
  for (const term of ['Workbench', 'conversation', 'Canary', 'SQLite', 'Profile', 'API Key', '预检', 'write-only']) {
    assert.match(content, new RegExp(term.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&') + '（[^）]+）'), '手册里 ' + term + ' 首次出现没有括注解释');
  }
  // 括注不能只给名词表，正文也要有（二者互为兜底，不是二选一）。
  assert.ok(DOC_TERM_GLOSSARY.length >= 10, 'doc 面名词表条目太少，覆盖不住手册里的术语');
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

