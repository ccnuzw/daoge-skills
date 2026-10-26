# 模式 4：生成文档浏览器（纯 Agent 实现）

## 核心理念

**你完全有能力自己生成文档浏览器，不需要脚本。**

你会：
1. 理解浏览器模板的结构
2. 读取并理解项目文档
3. 提取所有需要的数据
4. 生成定制化的 HTML 和数据文件

---

# 模式 4：生成文档浏览器（纯 Agent 实现）

## ⚠️ 关键：必须先读取数据格式规范

**在开始生成之前，必须先读取**：
```bash
read skill://spec-docs-pro/templates/DATA_FORMAT_SPEC.md
```

这份文档说明了：
- ✅ DECISIONS 必须使用 `{accent, text}` 格式（不是 id/title/category）
- ✅ 数据文件必须使用 `window.{项目名}_DOC_BROWSER_DATA` 格式
- ✅ 必须包含 FEATURE_BROWSER_DATA 数组
- ✅ 所有必需字段和常见错误

**如果不遵守这些格式，浏览器会出现**：
- ❌ 右侧口径显示 undefined
- ❌ 时间线显示"未分配阶段"
- ❌ 功能演进无法点击

---

## 第一步：理解浏览器模板

**读取模板**：
```bash
read skill://spec-docs-pro/templates/browser-template-full.html:1-100
read skill://spec-docs-pro/templates/browser-template-full.html:1550-1650
```

**理解结构**：

这是一个 2939 行的单页面应用，核心数据结构：

```javascript
// 1. 文档导航数组（你要生成）
const DOCS = [
  { 
    id: "doc-0",
    version: "V1", 
    phase: "闭环", 
    accent: "#2f7d4f",
    soft: "#e1f0e8",
    title: "V1 产品需求", 
    file: "../02-产品与版本/当前版本/V1-产品需求.md", 
    goal: "账户、API Key、..." 
  },
  // ...
];

// 2. 关键决策（你要从文档提取）
const DECISIONS = [
  { accent: "#2f7d4f", text: "决策内容" },
  // ...
];

// 3. 能力主线（你要从演进矩阵提取）
const FEATURE_TRACKS = {
  identity: { title: "...", overview: "...", accent: "#087d75" },
  // ...
};

// 4. 版本里程碑（你要从版本路线图提取）
const FEATURE_TIMELINE_VERSIONS = [
  { id: "v1", label: "V1", kind: "current" },
  // ...
];

// 5. 文档内容（在单独的 .js 文件中）
window.TUZAI_DOC_BROWSER_DATA = {
  "doc-0": "# 文档内容...",
  // ...
};

// 6. 功能数据（在单独的 .js 文件中）- 重要！
window.TUZAI_FEATURE_BROWSER_DATA = [
  {
    id: "V1-FR-001",
    title: "用户注册",
    track: "identity",
    trackName: "身份、API Key 与权限",
    domain: "身份与权限",
    goal: "让新用户使用唯一邮箱创建平台账户...",
    dependencies: "平台数据库、统一错误响应...",
    file: "../03-功能规格/V1/01-身份与权限/01-用户注册.md"
  },
  // ... 所有功能规格
];
```

**为什么需要第 6 个数据？**
- 功能演进视图（Evolution）需要从演进矩阵文档中提取数据（已经在 DOCS 中了）
- 时间线视图（Timeline）需要 FEATURE_BROWSER_DATA 来显示具体功能的演进
- 如果没有这个数据，时间线视图将无法使用

### 2.1 提取项目名称

```bash
# 读取项目概览
find docs/ -name "*项目概览*" -o -name "README.md" | grep "01-"
read docs/01-项目概览/项目概述.md:1-10
```

从第一个 `#` 标题提取，去掉"项目概览"等后缀。

示例：
- `# DG-OS 项目概述` → 项目名称 = "DG-OS"
- `# TUZAI产品文档` → 项目名称 = "TUZAI"

### 2.2 提取版本信息

```bash
# 读取版本路线图
find docs/ -name "*版本路线*"
read docs/02-产品与版本/版本路线图.md
```

提取所有 `## V数字` 标题：

```markdown
## V1: 最小闭环
## V2: 稳定网关  
## V3: 原多协议范围
...
```

判断版本状态：
- 包含"当前版本" / "正在开发" → `kind: "current"`
- 包含"历史" / "已废弃" / "归档" → `kind: "history"`  
- 包含"规划" / "后续" / "未来" → `kind: "planned"`

### 2.3 提取决策记录

```bash
# 读取决策文档
find docs/ -name "*决策*" -o -name "*冻结决策*"
read docs/06-决策记录/V1-冻结决策.md
```

**支持两种格式**：

**格式 A：ADR 格式**（标题式）
```markdown
## D001 使用 Rust + Tauri 而非 Node.js + Electron
## D002 使用 SQLite 而非 PostgreSQL
## D003 不使用 QuickJS/Node.js 作为 Skills/MCP 运行时
```

提取：只要标题部分（`##` 后面的文本）

**格式 B：列表格式**
```markdown
- V1 按 P1～P3 分阶段交付 Responses、Anthropic 和 Gemini 非流式入口
- 错误码采用双码体系：平台数字 code 为标准
```

提取：每个列表项

**限制**：10-20 条最关键的决策

### 2.4 提取能力主线

```bash

## ⚠️ 第一步：验证演进矩阵格式

**在提取数据之前，必须验证格式**：
```bash
# 检查是否使用表格格式
grep "^|" docs/02-产品与版本/功能演进矩阵.md | wc -l
# 如果返回值 < 10，说明格式错误！
```

**正确格式（时间线必需）**：
```markdown
## 3. Provider 能力演进

| 阶段 | 增量说明 | 依赖 | 完成判定 | 状态来源 |
|------|---------|------|---------|---------|
| V1 基础适配 | 支持 OpenAI、Claude... | ... | ... | ... |
```
✅ 每个能力主线章节必须有 5 列表格

**错误格式（会导致时间线不可用）**：
```markdown
### 3.1 V1 基础适配    ← ❌ 层级结构 + 段落
**用户价值**：...
```

**如果格式错误**：
- 停止生成
- 提示用户："演进矩阵必须使用 5 列表格格式"
- 提供正确模板：`skill://spec-docs-pro/templates/feature-evolution-matrix.md`

**如果没有演进矩阵文档**：
- 使用模板创建新文档
- 根据项目功能调整内容

---

## 第二步：提取能力主线

# 读取功能演进矩阵
find docs/ -name "*演进矩阵*" -o -name "*功能演进*"
read docs/02-产品与版本/功能演进矩阵.md
```

查找 `### XX演进` 标题：

```markdown
### 身份、API Key 与权限演进
### 模型协议与开发者调用演进
### 供给、模型资产与路由演进
```

生成映射：
```javascript
{
  identity: { 
    title: "身份、API Key 与权限演进",
    overview: "身份、API Key 与权限",
    accent: "#087d75"
  },
  // ...
}
```

**如果没有演进矩阵**：创建默认单主线
```javascript
{
  core: {
    title: "核心功能演进",
    overview: "核心功能", 
    accent: "#087d75"
  }
}
```

### 2.5 扫描所有文档

```bash
find docs/ -name "*.md" -type f
```

为每个文档生成 DOCS 数组项：
- `id`: doc-0, doc-1, ...
- `version`: 从路径提取（V1, V2...）或 "00"
- `phase`: 从目录名提取
- `accent`/`soft`: 根据目录分配颜色
- `title`: 从第一个 # 标题提取
- `file`: 相对路径
- `goal`: 从文档前几行提取（可选）

**目录颜色映射**：
```javascript
{

### 2.6 生成功能数据数组（重要！）

这是**时间线视图能否工作的关键**。

```bash
# 扫描所有功能规格文件
find docs/03-功能规格 -name "*.md" -type f | grep -E "V[0-9]"
```

为每个功能规格生成数据：

```javascript
window.DGOS_FEATURE_BROWSER_DATA = [
  {
    id: "V1-FR-001",              // 功能编号（从文件名或标题提取）
    title: "Provider 适配框架",   // 功能标题
    track: "provider",             // 所属能力主线（对应 FEATURE_TRACKS 的 key）
    trackName: "Provider 能力",    // 能力主线名称
    domain: "底层能力",            // 功能领域
    goal: "支持 OpenAI、Claude、Gemini 等主流 Provider",  // 功能目标
    dependencies: "",              // 依赖项（可选）
    file: "../03-功能规格/V1/01-底层能力/01-Provider适配框架.md"  // 文档路径
  },
  {
    id: "V1-FR-002",
    title: "Skills 管理系统",
    track: "skills",
    trackName: "Skills 能力",
    domain: "底层能力",
    goal: "Skills 注册、列表、启用/禁用",
    dependencies: "",
    file: "../03-功能规格/V1/01-底层能力/02-Skills管理系统.md"
  },
  // ... 所有功能规格（V1 有 10 个，TUZAI V1 有 36 个）
];
```

**提取规则**：
- `id`: 从文件名或文档第一个 # 标题提取（如 `# V1-FR-001：Provider 适配框架`）
- `title`: 去掉编号后的标题部分
- `track`: 根据功能内容判断属于哪个能力主线
- `domain`: 从目录名提取（如 `01-底层能力` → "底层能力"）
- `goal`: 从文档中提取核心目标（通常在"核心目标"或"目标"章节）
- `file`: 相对于 HTML 文件的路径

**能力主线映射示例**：
```javascript
// 根据功能标题或内容判断
if (title.includes("Provider")) → track = "provider"
if (title.includes("Skills")) → track = "skills"
if (title.includes("MCP")) → track = "mcp"
if (title.includes("模块") || title.includes("热更新")) → track = "module"
if (title.includes("设计系统") || title.includes("UI")) → track = "design"
if (title.includes("用户") || title.includes("身份")) → track = "identity"
if (title.includes("权限")) → track = "permission"
if (title.includes("协同") || title.includes("局域网")) → track = "collaboration"
// ...
```
  '01-项目概览': { accent: '#087d75', soft: '#dcefeb', phase: '概览' },
  '02-产品与版本': { accent: '#4056a1', soft: '#e6e9f6', phase: '版本' },
  '03-功能规格': { accent: '#2f7d4f', soft: '#e1f0e8', phase: '功能' },
  '04-技术架构': { accent: '#a96810', soft: '#f6ead6', phase: '架构' },
  '05-测试与发布': { accent: '#aa2d4d', soft: '#f4dde4', phase: '测试' },
  '06-决策记录': { accent: '#7c3aed', soft: '#ede9fe', phase: '决策' },
  '90-参考资料': { accent: '#69707a', soft: '#f1eee7', phase: '参考' },
  '99-历史归档': { accent: '#69707a', soft: '#f1eee7', phase: '历史' }
}
```

---

## 第三步：生成浏览器文件

### 3.1 生成 HTML 文件

```bash
# 读取模板
read skill://spec-docs-pro/templates/browser-template-full.html

# 替换数据：
# 1. TUZAI → 项目名称
# 2. const DOCS = [...] → 你生成的数组
# 3. const DECISIONS = [...] → 你提取的决策  
# 4. const FEATURE_TRACKS = {...} → 你提取的能力主线
# 5. const FEATURE_TIMELINE_VERSIONS = [...] → 你提取的版本

# 写入文件
write docs/90-参考资料/产品文档浏览器.html
```

### 3.2 生成数据文件

```javascript
// 读取所有文档内容
const docData = {};
for (const doc of DOCS) {
  // 读取文档
  const content = read(doc.file);
  docData[doc.id] = content;
}

// 生成数据文件
window.TUZAI_DOC_BROWSER_DATA = Object.freeze(docData);
```

写入：
```bash
write docs/90-参考资料/产品文档浏览器-文档数据.js
```

---

## 第四步：验证结果

```bash
# 1. 检查文件大小
ls -lh docs/90-参考资料/产品文档浏览器*

# 2. 验证项目名称
grep "<title>" docs/90-参考资料/产品文档浏览器.html

# 3. 抽查 DECISIONS（前 3 条）
read docs/90-参考资料/产品文档浏览器.html:2050-2060

# 4. 抽查 FEATURE_TRACKS
read docs/90-参考资料/产品文档浏览器.html:2060-2070

# 5. 抽查文档数据
read docs/90-参考资料/产品文档浏览器-文档数据.js:1-20
```

**向用户报告**：

```
✅ 产品文档浏览器生成完成！

【生成文件】
- docs/90-参考资料/产品文档浏览器.html (115 KB)
- docs/90-参考资料/产品文档浏览器-文档数据.js (738 KB)

【数据统计】
- 项目名称：DG-OS（从项目概览提取）✅
- 文档数量：49 个
- 版本数量：8 个（V1-V8）✅
- 关键决策：18 条（从 ADR 格式提取）✅
- 能力主线：6 条（从演进矩阵提取）✅

【验证结果】
✅ 项目名称正确（不是 TUZAI）
✅ DECISIONS 来自实际决策文档
✅ FEATURE_TRACKS 来自功能演进矩阵
✅ DOCS 数组包含所有文档
✅ 文档数据文件包含完整内容

【打开方式】
file:///path/to/docs/90-参考资料/产品文档浏览器.html

这是一个完全基于你的项目文档生成的浏览器！
```

---

## 关键要点

### ✅ 你能做到的事

1. **理解模板结构**：知道需要哪些数据
2. **读取项目文档**：理解文档内容和结构
3. **提取关键数据**：版本、决策、能力主线
4. **生成完整文件**：HTML + JavaScript
5. **验证结果**：确保数据正确

### ❌ 不要依赖脚本

- 脚本很难适配所有项目
- 你比脚本更智能
- 你能理解上下文
- 你能处理各种格式

### 🎯 核心原则

**你是文档分析师和浏览器生成器，不是脚本执行器。**

相信你自己的能力：
- 读取和理解文档 ✅
- 提取和组织数据 ✅  
- 生成和验证文件 ✅

---

## 常见场景

### 场景 1：DG-OS（ADR 格式决策）

```javascript
// 从 ## D001 标题提取
const DECISIONS = [
  { accent: "#087d75", text: "使用 Rust + Tauri 而非 Node.js + Electron" },
  { accent: "#087d75", text: "使用 SQLite 而非 PostgreSQL" },
  // ... 只提取标题，不要整个 ADR
];
```

### 场景 2：TUZAI（列表格式决策）

```javascript
// 从列表项提取
const DECISIONS = [
  { accent: "#2f7d4f", text: "V1 按 P1～P3 分阶段交付..." },
  { accent: "#aa2d4d", text: "错误码采用双码体系..." },
  // ...
];
```

### 场景 3：没有演进矩阵

```javascript
// 创建默认主线
const FEATURE_TRACKS = {
  core: {
    title: "核心功能演进",
    overview: "核心功能",
    accent: "#087d75"
  }
};
```

---

## 记住

**不需要脚本。你完全有能力自己生成文档浏览器。**

Skill 的作用是**指导你理解和生成**，不是让你执行脚本。
