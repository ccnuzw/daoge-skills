// config 面（生成服务设置）的人话副本。
//
// 这一面**刻意保留技术名词** —— 你要照着服务商文档填地址、填密钥、对型号，
// 把「Base URL」翻成「网址」反而让人不知道该抄哪一栏。
// 但保留不等于放任：每个术语旁边必须有一句人话（副标题 / 提示 / 名词表），
// 而且技术细节要收在折叠区里，不占主路径。
//
// 与 terminology.mjs 的分工：terminology.mjs 管「哪些词不许出现在创作者面」，
// 这里管「留在配置面的这些词，各自怎么翻译成人话」。两份都被守卫测试读。

// 面板顶部的一句话导语：先说这是干什么的，再让人往下填。
export const CONFIG_FACE_INTRO = '这里设置的是「让谁帮你画图」。填一次地址、密钥和模型，之后每次出图都用这一组。';

// 表单字段的人话提示，渲染在输入框下方（key 与表单字段对应）。
export const CONFIG_FIELD_HINTS = Object.freeze({
  name: '给这一组起个自己认得出的名字，随便起',
  provider: '选哪家服务来出图',
  model: '用哪个模型出图；也可以点「获取模型」让它列出来给你挑',
  baseUrl: '这家服务的网址入口，照抄服务商给你的那串地址',
  apiKey: '调用这家服务的密钥；填进去之后就再也显示不出来了',
  trustMode: '决定你的密钥允许发到哪一类网址上',
  limits: '一次最多出几张、最多等多久、失败重试几次；留空就用默认值'
});

// 名词表：术语 → 人话。渲染在折叠面板里，视觉上与主路径隔离。
// 守卫要求：这里的每个术语必须真的在 provider-settings.jsx 里出现过（不解释不存在的词）。
export const CONFIG_TERM_GLOSSARY = Object.freeze([
  ['Provider', '帮你出图的那家外部服务，比如 OpenAI、Gemini'],
  ['Profile', '一组完整的连接信息（服务 + 地址 + 密钥 + 模型），可以存很多组，随时切换'],
  ['Base URL', '这家服务的网址入口'],
  ['API Key', '调用这家服务的密钥，只写不回显'],
  ['端点', '上面那个网址的另一套叫法'],
  ['端点信任模式', '你的密钥允许发到哪一类网址：官方 / 公开兼容 / 本机代理 / 企业内网'],
  ['Descriptor', '这份服务自己申报的能力清单（支持哪些功能）'],
  ['Adapter', '本系统对接这份服务的方式'],
  ['毫秒', '1000 毫秒 = 1 秒'],
  ['write-only', '只能写入，写进去之后不会再显示出来']
]);

// 折叠面板的标题与说明。
export const CONFIG_GLOSSARY_COPY = Object.freeze({
  summary: '这些名词是什么意思',
  note: '设置里出现的都是技术名词，照着服务商文档填就行；不确定的先看这里。',
  foldLabel: '辅助信息'
});

export function configFieldHint(key) {
  return CONFIG_FIELD_HINTS[key] || '';
}
