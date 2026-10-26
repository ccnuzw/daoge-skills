# DOCS 数组格式规范（完整版）

## 🚨 关键警告：字段名必须准确

**当前 DG-OS 生成的错误**（导致 undefined）：
```javascript
{
  "version": "概览",        // ← 这个不是 phase！version 是版本标识（如 "V1", "概览"）
  "accentSoft": "#dcefeb"   // ❌ 错误！应该是 soft
  // ❌ 缺少 phase 字段
  // ❌ 缺少 goal 字段
}
```

**正确的格式**：
```javascript
{
  id: "doc-001",
  version: "概览",          // ✅ 版本标识（显示在左上角标签）
  phase: "项目概览",        // ✅ 必需！阶段名称（显示在版本标签旁边）
  accent: "#087d75",
  soft: "#dcefeb",          // ✅ 不是 accentSoft
  title: "Git提交信息规范",
  file: "../01-项目概览/Git提交信息规范.md",
  goal: "定义 DGOS 项目的 Git 提交信息规范"  // ✅ 必需！显示在章节数下方
}
```

**验证方法**：
```bash
# 检查是否有 undefined
grep "undefined" docs/90-参考资料/产品文档浏览器-文档数据.js

# 检查是否有 accentSoft（应该是 soft）
grep "accentSoft" docs/90-参考资料/产品文档浏览器-文档数据.js
```

---

## ⚠️ 关键问题
### 必需字段（8 个）

每个文档对象**必须**包含以下字段：

```javascript
{
  id: "doc-001",           // 必需：唯一标识符
  version: "V1",           // 必需：版本标识（如 "V1", "00", "EV"）
  phase: "产品",           // 必需：阶段名称（如 "产品", "架构", "功能"）
  accent: "#2f7d4f",       // 必需：主题色
  soft: "#e1f0e8",         // 必需：浅色背景
  title: "V1 产品需求",    // 必需：文档标题
  file: "../02-产品与版本/当前版本/V1-产品需求.md",  // 必需：相对路径
  goal: "账户、API Key、模型调用、用量与余额的最小闭环"  // 必需：文档目标
}

## ⚠️ 常见错误：字段名错误

**错误的字段名**（会导致 undefined）：
```javascript
{
  "accentSoft": "#dcefeb"  // ❌ 错误！应该是 soft
  // 缺少 phase              // ❌ 错误！必需字段
  // 缺少 goal               // ❌ 错误！必需字段
}
```

**正确的字段名**：
```javascript
{
  phase: "产品",           // ✅ 必需
  soft: "#dcefeb",         // ✅ 不是 accentSoft
  goal: "文档目标"         // ✅ 必需
}
```
```

### 字段说明

| 字段 | 类型 | 显示位置 | 示例值 | 说明 |
|------|------|---------|--------|------|
| `id` | string | 文档列表、URL | "v1", "doc-001" | 唯一标识，用于导航 |
| `version` | string | 文档头部标签 | "V1", "00", "EV" | 版本标识，显示在左上角 |
| `phase` | string | 文档头部 | "产品", "架构", "功能" | **显示在版本标签旁边** |
| `accent` | string | 主题色 | "#2f7d4f" | 文档头部的强调色 |
| `soft` | string | 背景色 | "#e1f0e8" | 文档列表项的浅色背景 |
| `title` | string | 文档头部标题 | "V1 产品需求" | 主标题 |
| `file` | string | 文档头部、加载 | "../02-产品与版本/..." | 相对于 HTML 文件的路径 |
| `goal` | string | 文档头部底部 | "账户、API Key..." | **显示在章节数下方** |

### 缺少字段的后果

| 缺少字段 | 显示效果 | 严重程度 |
|---------|---------|---------|
| `phase` | 文档头部显示 **undefined** | ⚠️ 中等 |
| `goal` | 文档头部底部显示 **undefined** | ⚠️ 中等 |
| `accent` | 样式异常 | ⚠️ 中等 |
| `soft` | 列表项无背景色 | ⚠️ 低 |
| `id` | 无法导航 | ❌ 严重 |
| `version` | 标签为空 | ❌ 严重 |
| `title` | 标题为空 | ❌ 严重 |
| `file` | 无法加载内容 | ❌ 严重 |

---

## Agent 生成 DOCS 数组的步骤

### 第一步：扫描所有文档

```bash
find docs/ -name "*.md" -type f | grep -v "90-参考资料"
```

### 第二步：为每个文档提取信息

**从文件路径提取**：
```javascript
// 文件：docs/02-产品与版本/当前版本/V1-产品需求.md

// id：使用序号或从文件名提取
id: "v1"  // 或 "doc-001"

// version：从路径或文件名提取
// 如果路径包含 "V1"、"V2" → version = "V1", "V2"
// 如果是版本路线图 → version = "00"
// 如果是演进矩阵 → version = "EV"
version: "V1"

// phase：从目录名提取
// "01-项目概览" → "概览"
// "02-产品与版本" → "产品"
// "03-功能规格" → "功能"
// "04-技术架构" → "架构"
phase: "产品"

// file：相对路径（相对于 HTML 文件）
file: "../02-产品与版本/当前版本/V1-产品需求.md"
```

**从文档内容提取**：
```javascript
// 读取文档
const content = read("docs/02-产品与版本/当前版本/V1-产品需求.md");

// title：第一个 # 标题
// # V1 产品需求 → title = "V1 产品需求"
const titleMatch = content.match(/^#\s+(.+?)$/m);
title: titleMatch ? titleMatch[1] : "未命名文档"

// goal：提取目标说明
// 方法 1：查找"目标"章节
const goalMatch = content.match(/##\s*(?:目标|核心目标|文档目标)\s*\n+([\s\S]{0,200}?)\n/);
// 方法 2：查找前几段
// 方法 3：提取第一段摘要
goal: extractGoal(content)
```

**分配颜色**：
```javascript
// 根据目录分配颜色
const colorMap = {
  '01-项目概览': { accent: '#087d75', soft: '#dcefeb' },
  '02-产品与版本': { accent: '#4056a1', soft: '#e6e9f6' },
  '03-功能规格': { accent: '#2f7d4f', soft: '#e1f0e8' },
  '04-技术架构': { accent: '#a96810', soft: '#f6ead6' },
  '05-测试与发布': { accent: '#aa2d4d', soft: '#f4dde4' },
  '06-决策记录': { accent: '#7c3aed', soft: '#ede9fe' },
  '90-参考资料': { accent: '#69707a', soft: '#f1eee7' },
  '99-历史归档': { accent: '#69707a', soft: '#f1eee7' }
};

// 从路径提取目录
// docs/02-产品与版本/... → '02-产品与版本'
const dir = extractDirectory(filePath);
const colors = colorMap[dir] || { accent: '#087d75', soft: '#dcefeb' };
accent: colors.accent
soft: colors.soft
```

### 第三步：提取 goal 的方法

```javascript
function extractGoal(content) {
  // 方法 1：查找"目标"章节（最准确）
  const goalSection = content.match(/##\s*(?:目标|核心目标|文档目标|产品目标)\s*\n+([\s\S]{0,300}?)(?=\n##|$)/);
  if (goalSection) {
    let goal = goalSection[1].trim();
    // 去掉列表标记和多余空行
    goal = goal.replace(/^[-*]\s+/gm, '').replace(/\n+/g, ' ').trim();
    // 限制长度
    return goal.substring(0, 150);
  }
  
  // 方法 2：查找"定位"章节
  const positionSection = content.match(/##?\s*定位\s*\n+([\s\S]{0,200}?)(?=\n##|$)/);
  if (positionSection) {
    return positionSection[1].trim().substring(0, 150);
  }
  
  // 方法 3：提取第一段（跳过标题后的第一段文本）
  const firstParagraph = content.match(/^#[^\n]+\n+([^\n#]{20,})/);
  if (firstParagraph) {
    return firstParagraph[1].trim().substring(0, 150);
  }
  
  // 方法 4：默认值
  return "文档目标待补充";
}
```

---

## 示例：DG-OS 的 DOCS 数组

```javascript
const DOCS = [
  // 版本路线图
  {
    id: "index",
    version: "00",
    phase: "版本",
    accent: "#4056a1",
    soft: "#e6e9f6",
    title: "DGOS 版本路线图",
    file: "../02-产品与版本/版本路线图.md",
    goal: "版本编号、范围边界、依赖关系和进入条件"
  },
  
  // 功能演进矩阵
  {
    id: "evolution",
    version: "EV",
    phase: "演进",
    accent: "#a96810",
    soft: "#f6ead6",
    title: "DGOS 功能演进矩阵",
    file: "../02-产品与版本/功能演进矩阵.md",
    goal: "能力主线的跨版本演进路径"
  },
  
  // V1 文档
  {
    id: "v1",
    version: "V1",
    phase: "产品",
    accent: "#2f7d4f",
    soft: "#e1f0e8",
    title: "V1 最小闭环",
    file: "../02-产品与版本/当前版本/V1-产品需求.md",
    goal: "Provider 适配、Skills 管理、MCP 支持、模块热更新、统一设计"
  },
  
  // 功能规格
  {
    id: "fr-001",
    version: "V1",
    phase: "功能",
    accent: "#2f7d4f",
    soft: "#e1f0e8",
    title: "V1-FR-001：Provider 适配框架",
    file: "../03-功能规格/V1/01-底层能力/01-Provider适配框架.md",
    goal: "支持 OpenAI、Claude、Gemini 等主流 Provider，统一调用接口"
  },
  
  // 架构文档
  {
    id: "arch-overview",
    version: "V1",
    phase: "架构",
    accent: "#a96810",
    soft: "#f6ead6",
    title: "V1 总体架构",
    file: "../04-技术架构/V1-总体架构.md",
    goal: "Rust + Tauri 技术栈，模块化设计，本地优先"
  },
  
  // 决策记录
  {
    id: "decisions",
    version: "V1",
    phase: "决策",
    accent: "#7c3aed",
    soft: "#ede9fe",
    title: "V1 冻结决策",
    file: "../06-决策记录/V1-冻结决策.md",
    goal: "影响范围、协议和架构的一致性决策记录"
  }
];
```

---

## 检查清单

生成 DOCS 数组后，验证：

### 必需字段检查
- [ ] 每个文档有 id
- [ ] 每个文档有 version（不为空）
- [ ] 每个文档有 phase（不为空）
- [ ] 每个文档有 accent 和 soft
- [ ] 每个文档有 title（不为空）
- [ ] 每个文档有 file（路径正确）
- [ ] 每个文档有 goal（不为空，不是 undefined）

### 特殊文档检查
- [ ] 有 id="evolution" 的演进矩阵文档
- [ ] 有 id="index" 或版本路线图文档
- [ ] 版本文档（v1, v2, v4-v8）的 id 正确

### 运行时检查
```bash
# 检查是否有 undefined
grep "undefined" docs/90-参考资料/产品文档浏览器.html

# 检查 goal 字段
grep -A 10 "const DOCS = \[" docs/90-参考资料/产品文档浏览器.html | grep "goal:"
```

---

## 常见错误

### 错误 1：phase 显示 undefined

**原因**：生成 DOCS 时缺少 phase 字段

**修复**：
```javascript
// ❌ 错误
{ id: "v1", version: "V1", title: "...", file: "...", goal: "..." }

// ✅ 正确
{ id: "v1", version: "V1", phase: "产品", title: "...", file: "...", goal: "..." }
```

### 错误 2：goal 显示 undefined

**原因**：
1. 生成 DOCS 时没有提取 goal
2. goal 字段值是 undefined

**修复**：
```javascript
// 使用 extractGoal 函数提取
goal: extractGoal(content) || "文档目标待补充"

// 或者简单的默认值
goal: "详见文档内容"
```

### 错误 3：goal 提取不准确

**原因**：文档格式不统一

**解决**：
- 优先使用"目标"章节
- 其次使用"定位"章节
- 最后使用第一段
- 兜底使用默认值

---

## 总结

✅ **DOCS 数组的 8 个必需字段**：
1. id - 唯一标识
2. version - 版本标识
3. **phase** - 阶段名称（易漏）
4. accent - 主题色
5. soft - 背景色
6. title - 文档标题
7. file - 文件路径
8. **goal** - 文档目标（易漏）

⚠️ **最容易漏掉的字段**：
- phase（显示在版本标签旁边）
- goal（显示在章节数下方）

✅ **验证方法**：
- 静态检查：grep "undefined" 生成的 HTML
- 浏览器检查：打开文档，看头部是否有 undefined
