const test = require('node:test');
const assert = require('node:assert/strict');

const { readFrontendSource, readSource } = require('./source-text');

/**
 * G24–G27 · 三面归位（界面批 D）。
 *
 * G24 资产后台：挑图/评审不许在资产页；但「去交付」（A4 发起挂选中）**不许收回**。
 * G25 交付步骤条：仅在有草稿时展开；无草稿只有一行 + 去选图；历史仍同屏。
 * G26 资料三页：页头之后同一个「页内筛选」位（data-block="page-filter"）。
 * G27 疑难/设置：narrow 已在注册表；设置宽度不新增裸 px（沿用 token/断点）。
 */
test('G24 资产页是后台：没有评审动作，但「去交付」不许收回', () => {
  // 批 E（E1.6b）迁移：外壳 JSX 搬去 app/workbench-shell.jsx——源断言读「main + 壳」两处。
  const main = readFrontendSource();  // 批 E（E1.6c）：同上
  // 批 E（第 9 批）迁移：选择条搬去 app/asset-surfaces.jsx——断言跟着家走（源级守卫的正确姿势）。
  const surface = readSource('web/src/app/asset-surfaces.jsx');
  const stripStart = surface.indexOf('function AssetSelectionStrip');
  const stripEnd = surface.indexOf('function ListPager');
  const strip = surface.slice(stripStart, stripEnd > stripStart ? stripEnd : undefined);
  assert.doesNotMatch(surface, /CreativeActionLauncher/, '资产面（条与卡）都不许复制画布的评审启动器');
  assert.doesNotMatch(surface, /onReject/, '资产面不许有评审决定（onReject）');
  assert.doesNotMatch(surface, /<span>不采用<\/span>/, '「不采用」只许作为状态词出现，不许是按钮');
  assert.doesNotMatch(strip, /预览挑图/, '资产页不许有挑图入口');
  assert.match(strip, /放大查看/, '查看入口改叫「放大查看」');
  assert.match(strip, /去交付/, 'A4：发起挂选中——「去交付」不许收回本页');
  assert.match(strip, /打包下载/, '打包下载仍在');
  assert.match(strip, /清空当前选片/, '清空仍在');
  // 查看器只读：入口来自 assets/trash 时不开评审
  assert.match(main, /readOnly = false/, '查看器要有只读开关');
  assert.match(main, /readOnly=\{routeView === 'assets' \|\| routeView === 'trash'\}/, '资产/回收站入口必须是只读');
  assert.match(main, /const canReview = !readOnly && typeof onToggleDeliverable === 'function'/, '只读时不许解锁评审键');
  assert.match(main, /\{readOnly \? <p [^>]*>挑图与评审在创作平台；这里只做查看。<\/p> : /, '只读时动作条换成一句说明');
  assert.match(main, /!asset\.deletedAt && !readOnly && <label/, '只读时不渲染「选为成果」勾选');
  // 画布的评审仍在（不许一起删掉）
  assert.match(readSource('web/src/creative-lineage-canvas.jsx'), /onReject/, '画布评审必须原样保留');
});

test('G25 交付步骤条仅在有草稿时展开，历史仍同屏', () => {
  const delivery = readSource('web/src/creator-delivery.jsx');
  assert.match(delivery, /const stepsOpen = selectedCount > 0 \|\| deliveryCreating \|\| frozen;/, '步骤条开合必须有明确判据');
  assert.match(delivery, /\{stepsOpen \? <ol data-block="delivery-steps">/, '步骤条按需展开');
  assert.match(delivery, /data-block="delivery-idle"/, '无草稿时是一行摘要');
  assert.match(delivery, /还没有草稿/, '摘要要说清「还没有草稿」');
  assert.match(delivery, /去选图/, '摘要里要有去选图');
  assert.match(delivery, /<CreatorDeliveryFlow[\s\S]{0,1200}CreatorDeliveryHistory/, '历史必须与交付流同屏（同一页里）');
});

test('G26 资料三页共用同一个页内筛选位', () => {
  const files = [
    ['web/src/creative-library.jsx', 'library-toolbar'],
    ['web/src/shared-assets.jsx', 'shared-assets-filter'],
    ['web/src/learning-center.jsx', 'learning-filter-bar']
  ];
  for (const [file, cls] of files) {
    const source = readSource(file);
    const i = source.indexOf('data-block="page-filter"');
    assert.ok(i > 0, file + ' 必须有 data-block="page-filter"');
    const header = source.indexOf('<PageHeader');
    assert.ok(header > 0 && header < i, file + ' 的筛选位必须在页头之后');
    assert.ok(source.indexOf(cls) < i + 400 && source.indexOf(cls) > i - 400, file + ' 的筛选位要落在自己的筛选容器上');
  }
  assert.match(readSource('web/src/shared-assets.jsx'), /过滤共享素材/, '共享素材要有页内搜索');
  assert.match(readSource('web/src/shared-assets.jsx'), /没有匹配的共享素材/, '过滤为空要有自己的说法（不许冒充「还没有共享素材」）');
});

test('G27 疑难与设置：narrow 档 + 不新增裸宽度', async () => {
  const { VIEW_LAYOUTS } = await import('../../web/src/workbench-navigation-model.mjs');
  assert.equal(VIEW_LAYOUTS.troubleshoot, 'narrow');
  assert.equal(VIEW_LAYOUTS.library, 'narrow');
  assert.equal(VIEW_LAYOUTS['shared-assets'], 'narrow');
  assert.equal(VIEW_LAYOUTS.guide, 'narrow');
  const styles = readSource('web/src/styles/surfaces/workbench.css');
  const bareWidths = [];
  for (const match of styles.matchAll(/(max-)?width:\s*(\d{3,})px/g)) {
    if (!match[1] && styles.slice(Math.max(0, match.index - 260), match.index).includes('.provider-settings')) bareWidths.push(match[0]);
  }
  assert.deepEqual(bareWidths, [], '设置版心宽度不许写死三位数 px（max-width 的阅读宽度不受此限）');
});
