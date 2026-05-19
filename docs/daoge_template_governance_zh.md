# DAOGE 模板治理说明

## 目的

这份文档用于沉淀 `skills/interactive-image-batch` 模板体系的治理结果，方便后续维护者快速理解：

1. 模板系统为什么改造成现在这样
2. 哪些文件是主链
3. 新增或修改模板时应该怎么做
4. 哪些问题以后不要再重复出现

这不是用户使用说明，而是维护说明。

---

## 当前模板治理结构

现在的模板体系分成五层：

1. `SKILL.md`
   - 只保留技能骨架、运行模式、主流程、引用地图
2. `references/template_authoring_zh.md`
   - 模板设计总规范
3. `references/template_registry_zh.json`
   - 模板注册主链
4. `references/templates/*`
   - 模板详细文档
5. 自动化治理脚本
   - `scripts/validate_template_registry.js`
   - `scripts/render_template_registry_report.js`
   - `scripts/run_smoke_tests.sh`

这五层的关系是：

- `SKILL.md` 负责指路
- `template_authoring_zh.md` 负责定规则
- `template_registry_zh.json` 负责主链入口
- `templates/*` 负责解释模板本身
- 自动化脚本负责防漂移

---

## 这次治理解决了什么问题

在治理前，模板体系存在几个典型问题：

1. `SKILL.md` 过重
   - 模板规则、执行细节、结构约束都堆在一个文件里
2. 模板文档不统一
   - 有些模板只有简短说明
   - 有些模板没有“不适用范围”或“强约束”
3. 注册表和文档脱节
   - 一部分模板没有 `template_doc`
4. 行业模板边界不清
   - 领域差异容易被误做成新的基础模板
5. 缺少自动化治理
   - 模板文档和注册表漂移只能靠人工发现

治理后，当前结果是：

- `SKILL.md` 已骨架化
- 主链模板均可回指到模板文档
- 模板文档骨架已统一到最小标准
- `finance-oral-storyboard` 这类文档被明确降级为行业派生模板
- 模板主链已有自动校验和可读报告

---

## 主链与派生模板的区分

这是后续最容易再犯错的地方。

### 主链模板

进入 `template_registry_zh.json` 的模板，必须满足：

- 它是一个基础任务类型
- 有独立的触发词
- 有独立的结构约束
- 有独立的 `prompt_sections`
- 有独立的质量门槛

例如：

- `campaign-poster`
- `cinematic-storyboard`
- `oral-storyboard-board`

### 派生模板文档

不进入注册表主链，只作为某个基础模板的行业化补充。

适用情况：

- 任务本质没变
- 差异主要在行业语义、镜头语义、信息图层
- 不需要独立检测分类

例如：

- `finance-oral-storyboard.md`
  - 依附于 `oral-storyboard-board`
  - 补充财经、券商、产业链、半导体、算力等行业语义

默认原则：

先做派生文档，除非真的需要新的基础模板。

---

## 当前模板治理产物

模板治理当前默认会产出三份文件：

1. `references/template_registry_validation_report.json`
2. `references/template_registry_report.md`
3. `references/template_registry_report.html`

用途分别是：

- JSON：脚本消费和结构化检查
- Markdown：代码审阅和文本归档
- HTML：快速人工浏览

如果这三份文件没有一起出现，说明模板治理链路没有完整跑通。

---

## 维护默认动作

以后改模板时，默认按这个顺序：

1. 改模板文档或注册表
2. 跑：

```bash
cd skills/interactive-image-batch
node scripts/validate_template_registry.js
node scripts/render_template_registry_report.js \
  --report-file references/template_registry_validation_report.json
```

3. 再跑：

```bash
skills/interactive-image-batch/scripts/run_smoke_tests.sh
```

如果统一 smoke 没跑绿，不要宣称模板治理完成。

---

## 后续不要再做的事

1. 不要把模板设计细节重新塞回 `SKILL.md`
2. 不要新增没有 `template_doc` 的主链模板
3. 不要把行业差异直接做成新的基础模板，除非先证明它有结构层差异
4. 不要只改文档不跑主链校验
5. 不要只跑单个测试，不跑统一 smoke

---

## 当前状态基线

截至本次治理完成，模板治理基线是：

- 模板主链数量：11
- 主链校验：0 error / 0 warning
- smoke tests：30/30 通过
- 统一维护入口：`skills/interactive-image-batch/scripts/run_smoke_tests.sh`

如果以后状态变差，优先回看：

- `references/template_authoring_zh.md`
- `references/template_registry_report.md`
- 本文档
