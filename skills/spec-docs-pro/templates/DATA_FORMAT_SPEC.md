# 关键数据格式规范（必须遵守）

基于 TUZAI 标准浏览器对比，以下是**必须严格遵守**的数据格式。

## ⚠️ 最常见错误：DOCS 数组字段缺失

**问题现象**：文档头部显示 undefined
```
产品
undefined          ← phase 字段缺失
docs/02-产品与版本/当前版本/V1-产品需求.md
V1-产品需求
661 行
45 章节
undefined          ← goal 字段缺失
```

**原因**：DOCS 数组必须有 8 个字段，缺少任何一个都会导致 undefined

**必读**：详见 `DOCS_ARRAY_FORMAT.md`

**关键点**：
- ✅ 字段名是 `soft`，不是 `accentSoft`
- ✅ 必须有 `phase` 字段（显示在版本标签旁）
- ✅ 必须有 `goal` 字段（显示在章节数下方）
- ✅ file 是相对路径 `../02-产品与版本/...`

---

## 1. DECISIONS 数组格式
✅ **正确格式**：
```javascript
const DECISIONS = [
  { 
    accent: "#2f7d4f",  // 必须：颜色代码
    text: "使用 Rust + Tauri 而非 Node.js + Electron"  // 必须：决策文本
  },
  { 
    accent: "#087d75", 
    text: "使用 SQLite 而非 PostgreSQL" 
  }
  // ...
];
```

**字段说明**：
- `accent`: 必须，字符串，颜色代码（如 "#2f7d4f"）
- `text`: 必须，字符串，决策内容（不要 id 和 category）

**颜色分配规则**：
- V1/当前相关 → `#2f7d4f` (绿色)
- V2 相关 → `#a96810` (琥珀色)
- 技术架构 → `#087d75` (青色)
- 支付/计费 → `#aa2d4d` (玫瑰色)
- 其他 → `#4056a1` (靛蓝色)

---

## 2. 数据文件变量名

❌ **错误**（浏览器找不到数据）：
```javascript
// 产品文档浏览器-文档数据.js
const DOC_BROWSER_DATA = { ... };
const FEATURE_BROWSER_DATA = [ ... ];
```

✅ **正确**：
```javascript
// 产品文档浏览器-文档数据.js

// 文档内容数据
window.DGOS_DOC_BROWSER_DATA = Object.freeze({
  "doc-001": "# 文档内容...",
  // ...
});

// 功能数据数组
window.DGOS_FEATURE_BROWSER_DATA = Object.freeze([
  {
    id: "V1-FR-001",
    title: "Provider 适配框架",
    track: "provider",
    trackName: "Provider 能力",
    domain: "底层能力",
    goal: "支持 OpenAI、Claude、Gemini...",
    file: "../03-功能规格/V1/01-底层能力/01-Provider适配框架.md"
  },
  // ...
]);
```

**关键点**：
1. 必须挂载到 `window` 对象
2. 必须使用项目前缀（DGOS、TUZAI 等）
3. 必须使用 `Object.freeze()` 冻结数据
4. 变量名必须是：`window.{项目名}_DOC_BROWSER_DATA` 和 `window.{项目名}_FEATURE_BROWSER_DATA`

---


## 3. FEATURE_BROWSER_DATA 字段格式

### title 字段（重要）

**错误格式**（DG-OS 当前）：
```javascript
{
  "id": "V1-FR-001",
  "title": "V1-FR-001：Provider 适配框架"  // ❌ 包含了 id
}
```
**显示效果**：下拉选项会重复显示 ID
```
V1-FR-001 · V1-FR-001：Provider 适配框架
            ^^^^^^^^^ 重复！
```

**正确格式**：
```javascript
{
  "id": "V1-FR-001",
  "title": "Provider 适配框架"  // ✅ 只有功能名称
}
```
**显示效果**：
```
V1-FR-001 · Provider 适配框架  ✅ 清晰
```

**原因**：代码会自动添加 id
```javascript
// 模板代码
${escapeHtml(item.id)} · ${escapeHtml(item.title)}
```

---

## 4. HTML 中的数据引用

**HTML 中的 state 初始化必须匹配数据文件的变量名**：

```javascript
const state = {
  docs: [],
  features: Array.isArray(window.DGOS_FEATURE_BROWSER_DATA) 
    ? window.DGOS_FEATURE_BROWSER_DATA 
    : [],
  // ...
};

async function loadDoc(doc) {
  let content = window.DGOS_DOC_BROWSER_DATA?.[doc.id];
  // ...
}
```

如果 HTML 中是 `window.DGOS_FEATURE_BROWSER_DATA`，数据文件也必须是 `window.DGOS_FEATURE_BROWSER_DATA`。

---

## 5. FEATURE_BROWSER_DATA 必需字段

```javascript
[
  {
    id: "V1-FR-001",        // 必须：功能编号
    title: "Provider 适配框架",  // 必须：功能标题
    track: "provider",      // 必须：能力主线 key（对应 FEATURE_TRACKS）
    trackName: "Provider 能力",  // 必须：能力主线显示名
    domain: "底层能力",     // 必须：功能领域
    goal: "支持多种 Provider...",  // 必须：功能目标
    file: "../03-功能规格/V1/...",  // 必须：文档路径
    
    // 可选字段（TUZAI 有，DG-OS 可以简化）
    number: "001",          // 可选：编号（从 id 提取）
    dependencies: "",       // 可选：依赖说明
    implementation: {}      // 可选：实现状态
  }
]
```

**如果缺少必需字段，时间线视图会显示"未分配阶段"或无法选择功能。**

---

## 6. 项目名称替换规则

**模板中的所有 TUZAI 引用必须替换为项目名**：

```javascript
// HTML 中
window.TUZAI_DOC_BROWSER_DATA → window.DGOS_DOC_BROWSER_DATA
window.TUZAI_FEATURE_BROWSER_DATA → window.DGOS_FEATURE_BROWSER_DATA

// 数据文件中
window.TUZAI_DOC_BROWSER_DATA → window.DGOS_DOC_BROWSER_DATA
window.TUZAI_FEATURE_BROWSER_DATA → window.DGOS_FEATURE_BROWSER_DATA

// Title
<title>TUZAI 产品文档浏览器</title> → <title>DGOS 产品文档浏览器</title>

// 品牌标识
<div class="brand-mark">T</div> → <div class="brand-mark">D</div>
```

---

## 7. 常见错误对照表

| 问题现象 | 原因 | 解决方法 |
|---------|------|---------|
| 右侧"关键口径"显示 undefined | DECISIONS 格式错误（用了 id/title/category） | 改为 accent/text 格式 |
| 时间线显示"未分配阶段" | 缺少 FEATURE_BROWSER_DATA | 生成功能数据数组 |
| 时间线无法选择功能 | FEATURE_BROWSER_DATA 为空或格式错误 | 检查数据文件和字段 |
| 文档内容无法加载 | DOC_BROWSER_DATA 变量名错误 | 检查 window 前缀和项目名 |
| 功能演进点击无效 | 演进矩阵文档 id 不对或内容格式问题 | 检查 DOCS 数组中的 evolution 项 |
| 图谱显示旧数据 | 图表数据硬编码在模板中 | **必须动态生成**，读取 MAP_VIEW_GENERATION.md 和 SVG_GENERATION_GUIDE.md |
| 总览显示硬编码内容 | 统计数据或可视化未从实际项目计算 | **必须从实际数据动态生成**（总览的统计功能已在模板中，Agent只需确保数据正确） |
| 文档头部显示 undefined | DOCS 数组缺少 phase 或 goal 字段 | **检查 DOCS_ARRAY_FORMAT.md**，确保 8 个必需字段完整 |

---

## 8. 完整的数据生成检查清单

生成浏览器后，必须验证：

### HTML 文件检查
- [ ] `<title>` 是项目名，不是 TUZAI
- [ ] DOCS 数组有所有文档
- [ ] DECISIONS 数组使用 `{accent, text}` 格式
- [ ] FEATURE_TRACKS 对象有项目的能力主线
- [ ] FEATURE_TIMELINE_VERSIONS 数组有项目的版本
- [ ] `window.{项目名}_DOC_BROWSER_DATA` 引用正确
- [ ] `window.{项目名}_FEATURE_BROWSER_DATA` 引用正确

### 数据文件检查
- [ ] 文件名是 `产品文档浏览器-文档数据.js`
- [ ] 定义了 `window.{项目名}_DOC_BROWSER_DATA`
- [ ] 定义了 `window.{项目名}_FEATURE_BROWSER_DATA`
- [ ] 使用了 `Object.freeze()`
- [ ] 文档数据是对象（key-value）
- [ ] 功能数据是数组
- [ ] 功能数组有必需的 7 个字段

### 功能验证
- [ ] 右侧"关键口径"能正常显示（不是 undefined）
- [ ] 时间线能选择功能（有下拉列表）
- [ ] 时间线显示功能信息（不是"未分配阶段"）
- [ ] 文档内容能正常加载
- [ ] 功能演进视图能显示

---

## 9. Agent 生成时的关键步骤

**第一步：生成 DECISIONS 时**
```javascript
// ❌ 不要这样
const decisions = [];
| 图谱显示旧数据 | 图表数据硬编码在模板中 | **必须**动态生成，参考 MAP_VIEW_GENERATION.md |
| 总览显示硬编码数据 | 统计和可视化未从实际数据计算 | **必须**从 state.docs 动态计算 |

// ✅ 应该这样
const decisions = [];
decisions.push({
  accent: getColorForDecision(extractedTitle),  // 根据内容判断颜色
  text: extractedTitle  // 直接用标题文本
});
```

**第二步：生成数据文件时**
```javascript
// 文件开头注释
// DG-OS 产品文档浏览器 - 文档数据
// 本文件由 spec-docs-pro 自动生成

// 文档内容
window.DGOS_DOC_BROWSER_DATA = Object.freeze({
  // ...
});

// 功能数据
window.DGOS_FEATURE_BROWSER_DATA = Object.freeze([
  // ...
]);
```

**第三步：替换 HTML 中的项目名时**
```javascript
// 全局替换
template = template.replace(/TUZAI/g, "DGOS");
template = template.replace(/window\.TUZAI_/g, "window.DGOS_");
```

---

这些是**必须严格遵守**的格式规范，任何偏差都会导致浏览器功能异常。
