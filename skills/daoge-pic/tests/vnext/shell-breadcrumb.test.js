const test = require('node:test');
const assert = require('node:assert/strict');

const { readFrontendSource } = require('./source-text');

/**
 * G14 · 面包屑（顶栏）的守卫（界面宪法 §5.2 / 批 B B2）。
 *
 * 判据：**只读路径 + 点开切换**；**顶栏不放动作**（新建/导出这类一律离开这一行）。
 * 面包屑是「我在哪」的答案，不是第三个导航栏。
 */

function breadcrumbRegion() {
  const frontend = readFrontendSource();
  const marker = frontend.indexOf('data-region="breadcrumb"');
  if (marker === -1) assert.fail('面包屑尚未实现：前端里找不到 data-region="breadcrumb"');
  // 精确取**包住标记的那个 <nav>…</nav>**——右侧的会话恢复区是兄弟节点，不算在面包屑里。
  const open = frontend.lastIndexOf('<nav', marker);
  const close = frontend.indexOf('</nav>', marker);
  assert.ok(open !== -1 && close !== -1, '面包屑应当是一个 <nav> 元素');
  return frontend.slice(open, close);
}

test('面包屑存在，且三段（项目 / 任务 / 批次）都能点开切换', () => {
  const block = breadcrumbRegion();
  for (const label of ['项目', '任务', '批次']) {
    assert.ok(block.includes(label), '面包屑缺少一段：' + label);
  }
  assert.ok((block.match(/<button/g) || []).length >= 3, '三段都要是可点开的（button），不是常驻 select');
});

test('顶栏不放动作：面包屑里没有命令按钮、没有「新建」', () => {
  const block = breadcrumbRegion();
  assert.equal(block.includes('command-button'), false, '面包屑里不该出现命令按钮（动作离开这一行）');
  assert.equal(block.includes('新建'), false, '面包屑里不该出现「新建」（D1：新建批次去画布工具条与空白双击）');
});

test('未读完成在顶栏有位置（I7：出完了叫我，不许丢）', () => {
  const frontend = readFrontendSource();
  assert.match(frontend, /noticeTitle\(/, '标题未读的呈现必须仍在（completion-notice-model）');
  assert.match(frontend, /unreadCompletions/, '未读完成的计数必须仍在');
});
