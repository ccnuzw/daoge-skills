// 术语单的单一来源。只写文档守不住 —— A/B 两轮已经证明文案会在后续重构里被顺手改回去，
// 所以这里既出数据，也出扫描器，守卫测试 tests/vnext/terminology-guard.test.js 直接复用。
//
// 判据是「属于创作者语汇 vs 系统实现」，不是中英之分。三级：
//   保留 —— 创作者本来就这么说，或本来就是英文专名（prompt / 蒙版 / 画幅 / 超分 / seed）。
//   译好 —— 系统实现词，但创作者需要理解，给一个自然说法。
//   收回 —— 纯实现细节，创作者面禁用；需要时下沉到「技术详情」层，或换成人能看懂的说法。
//
// 新增一维「面向面」，因为一刀切会改坏东西：
//   creator —— 创作者主路径（导航 / 按钮 / 状态 / 空态 / 错误）：必须人话。
//   config  —— 技术配置面（生成服务设置）：允许术语，但必须配人话副标题 + 视觉隔离。
//   doc     —— 文档面（创作手册正文）：允许术语，但首次出现要给解释。
//
// 明确不做：
//   - 不改任何标识符 / API 路径 / 错误码（providerId、/api/runs 等保持原样）—— 界面词与协议词解耦。
//   - 不造译名：prompt / seed / 蒙版 / 超分 这类创作者语汇照留。

export const TERM_LEVELS = Object.freeze(['保留', '译好', '收回']);
export const TERM_SCOPES = Object.freeze(['creator', 'config', 'doc']);

// 按「面向面」分文件。新增前端文件时先在这里归类 —— 未归类的文件会被守卫报为漏配。
export const CONFIG_FACE_FILES = Object.freeze(['provider-settings.jsx', 'provider-settings-model.mjs', 'config-face-copy.mjs']);
export const DOC_FACE_FILES = Object.freeze(['learning-center.jsx', 'learning-center-content.mjs', 'offline-strategy-model.mjs', 'doc-face-copy.mjs']);

export const TERMS = Object.freeze([
  // —— 收回：创作者面禁用 ——
  { internal: '端点', level: '收回', scope: 'creator', creator: '服务地址', forbidInCreator: true },
  { internal: 'daemon', level: '收回', scope: 'creator', creator: '后台服务', forbidInCreator: true },
  { internal: 'Worker', level: '收回', scope: 'creator', creator: '后台任务 / 处理进程', forbidInCreator: true },
  { internal: '处理池', level: '收回', scope: 'creator', creator: '后台任务', forbidInCreator: true },
  { internal: 'JSON', level: '收回', scope: 'creator', creator: '原始数据', forbidInCreator: true },
  { internal: '事实源', level: '收回', scope: 'creator', creator: 'Studio 里的正式数据', forbidInCreator: true },
  { internal: '毫秒', level: '收回', scope: 'creator', creator: '换算成秒', forbidInCreator: true },
  { internal: 'SQLite', level: '收回', scope: 'creator', creator: '本地数据库', forbidInCreator: true },
  { internal: 'schema', level: '收回', scope: 'creator', creator: '数据格式', forbidInCreator: true },
  // —— 译好：创作者需要理解，给自然说法 ——
  { internal: 'Provider', level: '译好', scope: 'creator', creator: '生成服务', hint: '出图用的那家服务' },
  { internal: '预检', level: '译好', scope: 'creator', creator: '开工前核算', hint: '先算一遍要出几张、能不能跑通，这一步不出图' },
  { internal: '草稿轮次', level: '译好', scope: 'creator', creator: '还没开工的那一轮', hint: '只记下了想法，还没出图' },
  { internal: '上下文', level: '译好', scope: 'creator', creator: '已记下的条件', hint: '这次创作参考的信息' },
  { internal: '生成运行', level: '译好', scope: 'creator', creator: '本次出图', hint: '一次真正的出图执行' },
  { internal: '运行项', level: '译好', scope: 'creator', creator: '单张出图记录', hint: '本次出图里的其中一张' },
  { internal: '脱敏', level: '译好', scope: 'creator', creator: '已隐去隐私', hint: '敏感内容已替换或删除' },
  { internal: '并发', level: '译好', scope: 'creator', creator: '同时出几张', hint: '同时发出几个请求' },
  // —— 保留：创作者语汇或英文专名 ——
  { internal: 'prompt', level: '保留', scope: 'creator' },
  { internal: 'seed', level: '保留', scope: 'creator' },
  { internal: '蒙版', level: '保留', scope: 'creator' },
  { internal: '画幅', level: '保留', scope: 'creator' },
  { internal: '超分', level: '保留', scope: 'creator' },
  { internal: '参考图', level: '保留', scope: 'creator' },
  { internal: '构图', level: '保留', scope: 'creator' },
  { internal: '羽化', level: '保留', scope: 'creator' },
  { internal: '色域', level: '保留', scope: 'creator' },
  // —— 术语只允许出现在对应面上 ——
  { internal: 'Profile', level: '保留', scope: 'config', creator: '生成服务配置', hint: 'Workbench 里的生成服务设置项' },
  { internal: 'API', level: '保留', scope: 'config' }
]);

// config 面专属术语。
//
// scope 说的是「这个词属于哪个面」，所以它天然蕴含「不许飘到别的面去」—— 但这条含义
// 此前只有声明、没有执行：scope 字段只在结构自检里被检查「取值合法」，没有任何断言去拦
// 「Profile 出现在左侧栏」这类跨面泄漏。于是「Profile 只在配置面」是一句注释，不是一条规则。
// 补上之后，creator 面的可见文案里出现配置面术语会直接 fail。
//
// 与 level 的分工：level 管「creator 面怎么处理这个词」，scope 管「它能不能出现在 creator 面」。
// 一个词标了 scope: 'config'，它的 level 在 creator 语境下就没有定义域 —— 不要拿 level 兜这件事。
export function configFaceTerms() {
  return TERMS.filter((term) => term.scope === 'config').map((term) => term.internal);
}

// 技术详情层白名单。
// 工程词在「技术详情」里是允许的（视觉隔离 + 按需展开 + 每条值配一句人话且可复制），
// 所以第二批之后唯一剩下的「预检」就在这三处。但必须**逐条登记**：
// 不许因为「反正是技术详情」就整文件放行，否则白名单会悄悄长成一整块。
export const ADVANCED_DETAILS_ALLOWED_COPY = Object.freeze([
  '预检通过',      // advanced-details.mjs：证据卡的状态文案
  '计划与预检证据', // main.jsx：技术详情面板标题
  '预检',          // main.jsx：技术详情里该区块的小标题
  '没有预检记录。'  // main.jsx：该区块的空态
]);

export function termsAtLevel(level) {
  return TERMS.filter((term) => term.level === level);
}

// 创作者面应该用自然说法的词（译好 + 收回）。
export function translatedInVisibleCopy() {
  return TERMS.filter((term) => term.level === '译好' || term.forbidInCreator).map((term) => term.internal);
}

// creator 面禁用的词。守卫据此扫可见文案。
export function forbiddenInVisibleCopy() {
  return TERMS.filter((term) => term.forbidInCreator).map((term) => term.internal);
}

export function labelFor(internal) {
  const term = TERMS.find((item) => item.internal === internal);
  return term && term.creator ? term.creator : internal;
}

const CJK = /[\u4e00-\u9fff]/;

// 去注释：保留行首含 http:// 的行，避免把网址里的双斜杠当注释起点。
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      return at !== -1 && line[at - 1] !== ':' ? line.slice(0, at) : line;
    })
    .join('\n');
}

const STRING_LITERAL = /'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`]*)`/g;
const JSX_TEXT = />([^<>{}]+)</g;

// 只取「可见文案」：含中文的字符串字面量与 JSX 文本。
// 刻意不扫标识符 —— providerId / assetScope / ProviderStatusCard 不是术语治理对象，
// 上一轮把标识符算进去导致密度表虚高，那条口径已作废。
export function visibleCopyStrings(source) {
  const code = stripComments(source);
  const out = [];
  for (const match of code.matchAll(STRING_LITERAL)) {
    const value = match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3] || '';
    if (CJK.test(value)) out.push(value);
  }
  for (const match of code.matchAll(JSX_TEXT)) {
    if (CJK.test(match[1])) out.push(match[1]);
  }
  return out;
}
