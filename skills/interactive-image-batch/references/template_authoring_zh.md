# 模板设计总规范

本文件是 `interactive-image-batch` 的模板设计总规范。

它不是某个具体模板的使用说明，也不是运行时脚本说明，而是整个模板体系的上位约束，用来回答四个问题：

1. 什么任务应该抽象成模板
2. 模板文件应该怎么写
3. 模板如何登记到 `template_registry_zh.json`
4. 模板如何和 `task_spec.json`、`prompt_strategy.json`、`prompt_slots.json`、`prompts.generated.json` 对齐

这份文档的目标不是追求“模板越多越好”，而是确保模板体系具备：

- 可复用
- 可维护
- 可解释
- 可验证
- 可扩展

---

## 1. 模板在本 skill 里的角色

在 `interactive-image-batch` 中，模板不是“现成 prompt 文案集合”，而是一个写作契约和规划约束层。

模板负责定义：

- 这个任务类型最重要的画面关注点是什么
- 这个任务进入对话后优先要问什么
- 最终 prompt 应该按什么结构组织
- 哪些字段必须显式出现
- 哪些变体轴适合做矩阵化分发
- 哪些默认补全是安全的
- 哪些常见错误必须主动避免

模板不直接负责：

- 决定用户真实意图
- 代替 `task_spec.json`
- 代替 `prompt_strategy.json`
- 直接生成最终全部 prompt
- 决定执行 API 走哪条 transport path

一句话说，模板是“任务类型的结构化经验包”，不是运行时本体。

---

## 2. 什么时候应该新建模板

满足以下任一条件时，优先考虑新建模板，而不是继续塞进通用逻辑：

1. 某类任务已经重复出现至少 3 次，并且有稳定共性。
2. 某类任务的必问字段明显不同于现有模板。
3. 某类任务的 prompt 结构顺序明显不同于现有模板。
4. 某类任务的质量判断标准和反模式明显不同于现有模板。
5. 某类任务需要稳定复用一组 `variant_axes`。
6. 某类任务需要单独的 `autofill_policy` 才能稳定出图。

典型适合建模板的任务：

- 品牌海报
- 详情页组图
- 社媒九宫格
- A/B 投放素材
- 电影式分镜
- 口播分镜板

不建议单独建模板的情况：

- 只是换一个行业词
- 只是同模板下的一个轻微风格变体
- 只是一次性需求
- 只是场景词不同，但结构、质量门槛、字段需求都没变

判断标准很简单：

如果差异主要发生在“内容值”层，应该通过 `task_spec`、`strategy`、`variant_axes` 解决。
如果差异发生在“结构规则”层，才应该建模板。

---

## 3. 什么时候不该新建模板

以下情况优先扩展现有模板，而不是新建：

1. 只是新增一个模板变体 `variant`
2. 只是新增一组默认 `variant_axes`
3. 只是新增一组 `autofill_policy.rules`
4. 只是想补一个行业示例
5. 只是想给老模板多加几条 `quality_rules`

推荐动作：

- 变体差异：优先写到模板文档的“模板变体”
- 轻量扩展：优先更新 `template_registry_zh.json`
- 行业示例：优先新增 `references/examples/` 或在模板文档里补充例子

模板数量失控会直接导致：

- 检测命中混乱
- 维护成本暴涨
- 文档重复
- 模板边界模糊

所以默认原则是：先扩已有模板，扩不动再新建。

---

## 4. references 目录约定

模板体系相关文件按以下职责拆分：

- `references/template_authoring_zh.md`
  - 模板设计总规范
- `references/template_registry_zh.json`
  - 模板注册中心
- `references/templates/<category>/<template>.md`
  - 单模板详细文档
- `references/examples/`
  - 示例输入或示例结构，不承担模板契约职责

不要把以下内容写进 `SKILL.md`：

- 某个模板的全部字段解释
- 大段模板正文
- 大量模板特例
- 每个模板的反模式列表

这些应当留在：

- `template_authoring_zh.md`
- `template_registry_zh.json`
- `references/templates/*`

---

## 5. 模板体系三层结构

模板体系应稳定保持三层：

### 第一层：注册层

位置：

- `references/template_registry_zh.json`

职责：

- 告诉系统有哪些模板
- 每个模板属于哪个分类
- 触发词是什么
- 必需字段是什么
- 推荐 section 顺序是什么
- 质量规则和反模式是什么

### 第二层：文档层

位置：

- `references/templates/<category>/<template>.md`

职责：

- 向代理解释这个模板到底怎么用
- 解释这个模板适用于哪些任务
- 说明必问字段、推荐变体、自动补全建议、反模式

### 第三层：运行时映射层

位置：

- `scripts/daoge.js prepare`
- `src/domain/prompt_builder.js`
- `src/domain/material_resolver.js`
- `src/contracts/index.js`

职责：

- 读取模板注册信息
- 将模板规则注入到 `prompt_strategy` / `prompt_slots` / `prompt_draft_bundle`
- 在预检阶段检查模板要求是否被满足

约束：

模板逻辑的事实来源应优先来自注册层和文档层，运行时脚本只消费，不应重新发明一套平行规则。

---

## 6. 单模板文件的标准结构

每个模板文档建议遵循以下结构：

```markdown
# 模板名称

一句话用途描述。

## 适用范围

## 不适用范围

## 必问字段

## 推荐字段

## 模板变体

## 推荐 variant_axes

## 自动补全建议

## 强约束

## 反模式
```

说明：

- `适用范围` 必须写，避免模板滥用。
- `不适用范围` 强烈建议写，避免和相邻模板重叠。
- `必问字段` 要和注册表中的 `ask_fields` 保持同方向。
- `推荐 variant_axes` 应和注册表中的 `default_variant_axes` 对齐。
- `自动补全建议` 应和注册表中的 `autofill_policy` 对齐。
- `反模式` 必须面向真实错误，不要写空泛废话。

如果模板很复杂，可以附加：

- `推荐结构`
- `推荐构图`
- `推荐节奏`
- `行业适配说明`
- `示例 brief`

但不要把模板文档写成运行手册或脚本说明。

---

## 7. 注册表字段设计原则

`template_registry_zh.json` 是模板检测和运行时消费的主入口。

每个模板对象至少应回答下面几个问题：

- 我是谁
- 我处在哪个职责层级
- 我属于哪个维护家族
- 我属于哪一类
- 我如何被命中
- 我最关心什么
- 我应该先问用户什么
- 我最终 prompt 应该按什么 section 写
- 我有哪些常见错误
- 我有哪些默认变体轴和自动补全规则

### 必备字段

- `id`
- `name`
- `tier`
- `family`
- `category`
- `description`
- `triggers`
- `required_focus`
- `ask_fields`
- `required_slot_fields`
- `prompt_sections`
- `quality_rules`
- `default_negative_terms`
- `anti_patterns`

### 强烈建议字段

- `template_doc`
- `variants`
- `default_variant_axes`
- `autofill_policy`

### 字段职责说明

#### `triggers`

用于模板命中，不用于承担完整语义理解。

规则：

- 尽量写任务意图词，而不是泛词
- 不要只写超弱词
- 尽量同时包含中文和英文常见词
- 不要堆砌几十个近义词

#### `required_focus`

用于表达这个模板的核心关注点。

它主要服务于：

- prompt 写作优先级
- 预检解读
- 模板解释性输出

不要把它写成字段名清单，要写成真实关注点。

#### `ask_fields`

用于对话补参优先级。

规则：

- 写用户语言，不要写机器字段名
- 只列真正影响结果的大项
- 不要把所有可能字段都列进去

#### `required_slot_fields`

用于约束 `prompt_slots.json` 在该模板下至少要有的结构字段。

规则：

- 必须是 slot 层会实际承载的字段
- 只列模板真正依赖的结构值
- 不要把所有可选字段都标成 required

#### `prompt_sections`

这是模板最关键的字段之一。

它定义最终 prompt 的逻辑组织顺序，而不是 UI 展示顺序。

规则：

- section 名称应稳定、可复用
- 同一类模板应尽量复用相似 section 词表
- 不要一模板发明一套完全不同的命名体系，除非确有必要

#### `quality_rules`

用于预检和最终写作自检。

好规则应满足：

- 可判断
- 可解释
- 和该模板强相关

坏规则例子：

- 画面要高级
- 要更好看
- 要有感觉

好规则例子：

- 全身海报必须说明裁切规则，不能高概率裁脚
- 口播分镜板必须优先保证同一主持人连续性

#### `default_negative_terms`

用于提供模板级默认负向词。

规则：

- 优先放模板长期稳定需要排除的问题
- 不要混入一次性业务限制
- 不要和用户排除项冲突

#### `anti_patterns`

用于描述“这类任务最常见的错误成图方式”。

它比 `quality_rules` 更偏错误案例，而不是正向要求。

写法要求：

- 具体
- 可观察
- 面向高频失败模式

---

## 8. 模板文档和注册表如何分工

两者不要重复造轮子。

推荐分工：

- 注册表负责结构化、短字段、可被脚本读取
- 模板文档负责解释、示例、边界、经验总结

例如：

- `required_slot_fields` 放注册表
- 为什么这些字段重要，放模板文档
- `prompt_sections` 放注册表
- 每个 section 该怎么理解，放模板文档
- `anti_patterns` 核心条目放注册表
- 具体失败案例说明放模板文档

如果某条规则只存在于模板文档，不存在于注册表，而运行时又依赖它，这就是设计缺陷。

---

## 9. 模板变体设计原则

变体 `variants` 用于表示“同一模板下的不同稳定子模式”。

适合做变体的情况：

- 联名主 KV vs 产品主视觉
- 单变量 A/B 测试 vs 多变量测试
- 单张整板分镜 vs 多张拆分分镜

不适合做变体的情况：

- 只是换一个颜色
- 只是换一个场景词
- 只是一次性业务偏好

规则：

- 一个模板的变体应共享同一套任务本质
- 变体数保持克制，默认不超过 4 到 6 个
- 变体名称要反映差异方向，而不是泛标签

---

## 10. variant_axes 设计原则

`variant_axes` 是你这个 skill 相比轻量 prompt skill 最有价值的能力之一。

它的职责不是“看起来很专业”，而是控制大批量任务中的结构化变化，避免大规模撞图。

适合做成 `variant_axes` 的字段：

- `camera_language`
- `lighting`
- `mood`
- `gesture`
- `exposure_signal`
- `grid_role`
- `story_beat`
- `detail_page_role`
- `ad_test_hypothesis`

不适合做成 `variant_axes` 的情况：

- 只是一次性的随机词
- 不会进入最终 prompt 文本
- 对成图差异几乎没有影响
- 无法被 batch 级平衡策略控制

设计规则：

1. 一个轴必须对应明确的差异维度。
2. 一个轴的选项必须彼此可区分。
3. 一个轴最好能映射到最终 prompt 的可见表述。
4. 对于大批量任务，优先选择可做 `within-batch` 平衡的轴。
5. 不要为了“变化”而引入会破坏任务一致性的轴。

---

## 11. autofill_policy 设计原则

`autofill_policy` 用于安全、可解释地补齐 slot 中缺失但又经常需要的字段。

适合自动补全的字段：

- `lighting`
- `mood`
- `composition`
- 某些模板稳定使用的 `camera_language`

不适合自动补全的字段：

- `content_brief`
- `output_mode`
- 核心主体身份
- 关键商业意图
- 明显影响用户意图的品牌或产品信息

规则：

1. 自动补全只能补风格化空位，不能替用户做核心内容决策。
2. 能用对话问清的关键字段，不要偷懒交给 autofill。
3. autofill 最好配合 `mark_sources`，让预检能说明字段来源。
4. autofill 值应当稳定、安全、与模板高度相关。

---

## 12. 模板如何与 task spec 对齐

模板不是脱离上下文独立工作的。

模板必须和 `task_spec.normalized.json` 对齐以下内容：

- `content_brief`
- `output_mode`
- `style_requirements`
- `variation_requirements`
- `text_policy`
- `storyboard_plan`

规则：

1. 模板不能覆盖用户已明确的任务目标。
2. 模板可以约束组织方式，但不能改写用户核心需求。
3. 如果模板和 `task_spec` 明显冲突，应优先暴露冲突，而不是静默套模板。

例如：

- 用户要“口播分镜板”，不能套成“品牌海报”
- 用户要“详情页组图”，不能只因为出现“广告感”就强行套主 KV 模板

---

## 13. 模板如何与 prompt strategy 对齐

模板决定结构边界，`prompt_strategy` 决定分布策略。

模板应为 strategy 提供：

- 推荐 `template_variant`
- 推荐 `variant_axes`
- 推荐 `required_slot_fields`
- 推荐质量门槛

但模板不直接负责：

- family 分布比例
- grade 分布比例
- scene_pool 具体配比
- batch 级排布策略

这些属于 `prompt_strategy.json` 的职责。

---

## 14. 模板如何与 prompt slots 对齐

模板最终要落实到 `prompt_slots.json` 上。

如果某模板声明了：

- `required_slot_fields`
- `default_variant_axes`
- `autofill_policy`

那么 slot 层至少要做到：

1. 必填结构字段有值
2. 变体轴结果被写入 slot
3. 自动补全字段可追溯

换句话说，模板不能只在检测时存在，最后却没有体现在 slot 上。

---

## 15. 模板如何与最终 prompt 写作对齐

最终 `generation_prompt` 的写作应遵循：

- `prompt_sections`
- `required_focus`
- `quality_rules`
- `default_negative_terms`

模板真正生效的标志不是“命中了某个 id”，而是最终 prompt 文本里能看出该模板的结构痕迹。

如果检测到了模板，但最终 prompt 仍然像通用 prompt，一般说明：

- 模板 sections 没被消费
- slot 字段太稀
- draft 层没有保留模板结构
- final prompt writing 没按模板顺序写

---

## 16. 命名规范

### 模板分类目录

用稳定、宽口径、可扩展的英文目录名，例如：

- `poster-and-campaigns`
- `product-visuals`
- `social-campaigns`
- `performance-creatives`
- `cinematic-sequences`

### 模板 id

规则：

- 小写 kebab-case
- 表达任务本质，不表达一次性业务词
- 不要使用过短或过泛 id

好例子：

- `campaign-poster`
- `detail-page-set`
- `oral-storyboard-board`

坏例子：

- `poster1`
- `finance`
- `new-template`

---

## 17. 模板准入检查清单

新增模板前，先自检以下问题：

1. 它和现有模板的边界是否清楚？
2. 它的触发词是否足够区分？
3. 它的必问字段是否真的不同？
4. 它的 `prompt_sections` 是否有稳定结构价值？
5. 它的 `quality_rules` 是否能被清楚解释？
6. 它的 `anti_patterns` 是否来自真实失败模式？
7. 它是否需要单独的 `variant_axes` 或 `autofill_policy`？
8. 它是否已经有对应的模板文档和注册表项？

有 3 项答不上来，就先不要建。

---

## 18. 模板更新而非新建的检查清单

当你想改模板时，先判断动作属于哪类：

- 只改触发词：更新注册表
- 只改说明和边界：更新模板文档
- 只改 autofill：更新注册表并复核预检
- 只改示例：更新模板文档或 examples
- 结构顺序变了：同时更新注册表和模板文档

不要出现：

- 文档改了，注册表没改
- 注册表改了，模板文档还在说旧逻辑
- 运行时偷偷依赖了一个文档里才有的隐藏规则

---

## 19. 推荐的新增模板流程

推荐流程：

1. 先确认这是不是结构层差异，而不是内容层差异。
2. 在 `references/templates/<category>/` 下创建模板文档。
3. 在 `template_registry_zh.json` 添加模板项。
4. 检查 `detect_daoge_mode.js` 是否需要补类别候选逻辑。
5. 用一个最小 `task_spec + prompt_strategy` 跑通检测与 prepare。
6. 检查模板字段是否真正落到了 `prompt_slots` 和 `prompt_draft_bundle`。
7. 检查预检输出是否体现该模板的质量规则。

### 行业派生模板规则

如果某份模板文档只是对通用模板做行业化补充，而不是新的基础任务类型，应优先作为“派生模板文档”存在，而不是直接加入注册表主链。

适用条件：

- 任务本质与现有基础模板相同
- 差异主要来自行业词汇、信息图层、场景语义、灯光语义
- 不需要新的主链触发逻辑
- 不需要独立的检测分类

例如：

- `oral-storyboard-board` 是基础模板
- `finance-oral-storyboard` 可以是财经行业化派生文档

这类文档应明确写清：

- 它依附于哪个基础模板
- 它补充的是哪一类行业语义
- 它不直接进入注册表主链的原因

---

## 20. 推荐的模板演进方向

未来模板体系的演进，优先做这些事：

- 提高模板边界清晰度
- 统一 section 词表
- 提高 `variant_axes` 的可控性
- 提高 autofill 的可解释性
- 给模板选择增加更强的“为什么命中”输出

优先级低的事：

- 盲目增加模板数量
- 给每个行业都单独建模板
- 往模板文档里塞大量 prompt 成品

---

## 21. 和现有 references 的关系

这份文档与现有 references 的关系如下：

- `task_spec.md`
  - 负责运行前的用户需求契约
- `prompt_strategy.md`
  - 负责批量分发与变化控制策略
- `prompt_bundle_generation.md`
  - 负责从 slot 到最终 prompt item 的生成纪律
- `final_prompt_writing.md`
  - 负责最终 prompt 文本润色与收口
- `template_authoring_zh.md`
  - 负责模板本身应该如何被设计、登记、维护和演进

它们不是替代关系，而是分层关系。

---

## 22. 最终原则

模板系统的目标不是让代理“看起来懂很多模板”，而是让它在复杂任务里稳定地做对三件事：

1. 选对结构
2. 问对问题
3. 写对 prompt

如果一个模板做不到这三点，它就不是资产，而是噪音。
