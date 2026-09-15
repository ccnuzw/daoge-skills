const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

// 术语治理的守卫。第一批只管「边界免责句」这一件事，所以断言刻意写得很死：
// 收成一句就只能是一句，多一处手写副本就 fail。
// 为什么必须固化：A/B 两轮已经证明文案会在后续重构里被顺手改回去，只写文档守不住。

const SRC = path.join(__dirname, '../../web/src');

const read = (name) => fs.readFileSync(path.join(SRC, name), 'utf8');
const listSources = () => fs.readdirSync(SRC).filter((name) => /\.(jsx|mjs)$/.test(name));

// 「面向面」——一刀切会改坏东西，所以先按面分文件。
// config：配系统的地方（允许术语，但须配人话副标题 + 视觉隔离）
// doc：学系统的地方（允许术语，首次出现要给解释）
const CONFIG_FACE = ['provider-settings.jsx', 'provider-settings-model.mjs'];
const DOC_FACE = ['learning-center.jsx', 'learning-center-content.mjs', 'offline-strategy-model.mjs'];
const CREATOR_FACE = listSources().filter((name) => !CONFIG_FACE.includes(name) && !DOC_FACE.includes(name));

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
