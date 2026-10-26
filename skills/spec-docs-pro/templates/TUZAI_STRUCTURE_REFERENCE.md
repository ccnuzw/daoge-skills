# TUZAI 完整浏览器结构参考

通过对比 TUZAI 完整浏览器和 DG-OS 生成的浏览器，发现的关键结构。

## 完整的 6 个数据结构

### HTML 文件中（4 个）

```javascript
// 1. 文档导航数组
const DOCS = [
  { id, version, phase, accent, soft, title, file, goal },
  // ...
];

// 2. 决策记录数组
const DECISIONS = [
  { accent, text },
  // ...
];

// 3. 能力主线映射
const FEATURE_TRACKS = {
  identity: { title, overview, accent },
  protocol: { title, overview, accent },
  // ...
};

// 4. 版本里程碑数组
const FEATURE_TIMELINE_VERSIONS = [
  { id, label, kind },
  // ...
];
```

### 数据文件中（2 个）

**文件名**：`产品文档浏览器-文档数据.js`

```javascript
// 5. 文档内容数据（Object）
window.TUZAI_DOC_BROWSER_DATA = Object.freeze({
  "index": "# 版本路线图\n\n...",
  "v1": "# V1 产品需求\n\n...",
  // ... 所有文档的完整内容
});

// 6. 功能数据数组（Array）⚠️ 关键！
window.TUZAI_FEATURE_BROWSER_DATA = Object.freeze([
  {
    id: "V1-FR-001",
    number: "001",
    title: "用户注册",
    track: "identity",
    trackName: "身份、API Key 与权限",
    domain: "身份与权限",
    goal: "让新用户使用唯一邮箱创建平台账户...",
    dependencies: "平台数据库、统一错误响应...",
    implementation: { /* 实现状态 */ },
    file: "../03-功能规格/V1/01-身份与权限/01-用户注册.md"
  },
  // ... TUZAI V1 有 36 个功能
]);
```

## 为什么需要第 6 个数据？

**功能演进视图（Evolution）**：
- ✅ 直接渲染"功能演进矩阵.md"文档
- ✅ 不依赖 FEATURE_BROWSER_DATA
- ✅ 已经在 DOCS 数组中

**时间线视图（Timeline）**：
- ❌ 需要 FEATURE_BROWSER_DATA 来查询具体功能
- ❌ 需要功能的 id、title、track、goal 等元数据
- ❌ 如果没有这个数据，时间线视图无法使用

**代码依赖**：
```javascript
// renderFeatureTimeline 函数
const feature = state.features.find(item => item.id === state.activeFeatureId);
if (!feature) return;  // ← 如果没有数据，直接返回

// state 初始化
const state = {
  features: Array.isArray(window.TUZAI_FEATURE_BROWSER_DATA) 
    ? window.TUZAI_FEATURE_BROWSER_DATA 
    : [],  // ← 从这里获取数据
  // ...
};
```

## DG-OS 示例数据

**DG-OS V1 有 10 个功能**：

```javascript
window.DGOS_FEATURE_BROWSER_DATA = Object.freeze([
  {
    id: "V1-FR-001",
    title: "Provider 适配框架",
    track: "provider",
    trackName: "Provider 能力",
    domain: "底层能力",
    goal: "支持 OpenAI、Claude、Gemini 等主流 Provider",
    file: "../03-功能规格/V1/01-底层能力/01-Provider适配框架.md"
  },
  {
    id: "V1-FR-002",
    title: "Skills 管理系统",
    track: "skills",
    trackName: "Skills 能力",
    domain: "底层能力",
    goal: "Skills 注册、列表、启用/禁用",
    file: "../03-功能规格/V1/01-底层能力/02-Skills管理系统.md"
  },
  {
    id: "V1-FR-003",
    title: "MCP 管理系统",
    track: "mcp",
    trackName: "MCP 能力",
    domain: "底层能力",
    goal: "MCP 服务注册和管理",
    file: "../03-功能规格/V1/01-底层能力/03-MCP管理系统.md"
  },
  {
    id: "V1-FR-004",
    title: "模块系统与热更新",
    track: "module",
    trackName: "模块系统",
    domain: "底层能力",
    goal: "Module Federation 实现模块热加载、版本管理",
    file: "../03-功能规格/V1/01-底层能力/04-模块系统与热更新.md"
  },
  {
    id: "V1-FR-005",
    title: "统一设计系统",
    track: "design",
    trackName: "设计系统",
    domain: "底层能力",
    goal: "统一主题、组件、样式规范",
    file: "../03-功能规格/V1/01-底层能力/05-统一设计系统.md"
  },
  {
    id: "V1-FR-006",
    title: "AI 工作台",
    track: "workbench",
    trackName: "AI 工作台",
    domain: "应用模块",
    goal: "对话界面、Provider 选择",
    file: "../03-功能规格/V1/02-应用模块/01-AI工作台.md"
  },
  {
    id: "V1-FR-007",
    title: "系统设置",
    track: "module",
    trackName: "模块系统",
    domain: "应用模块",
    goal: "通用配置、主题切换",
    file: "../03-功能规格/V1/02-应用模块/02-系统设置.md"
  },
  {
    id: "V1-FR-008",
    title: "本地用户管理",
    track: "identity",
    trackName: "身份管理",
    domain: "系统功能",
    goal: "本地用户创建和管理",
    file: "../03-功能规格/V1/03-系统功能/01-本地用户管理.md"
  },
  {
    id: "V1-FR-009",
    title: "模块权限管理",
    track: "permission",
    trackName: "权限系统",
    domain: "系统功能",
    goal: "模块级权限控制",
    file: "../03-功能规格/V1/03-系统功能/02-模块权限管理.md"
  },
  {
    id: "V1-FR-010",
    title: "局域网协同",
    track: "collaboration",
    trackName: "局域网协同",
    domain: "系统功能",
    goal: "局域网访问、简单认证",
    file: "../03-功能规格/V1/03-系统功能/03-局域网协同.md"
  }
]);
```

## 能力主线映射规则

**根据功能标题或内容判断**：

| 关键词 | track | trackName |
|--------|-------|-----------|
| Provider | provider | Provider 能力 |
| Skills | skills | Skills 能力 |
| MCP | mcp | MCP 能力 |
| 模块、热更新 | module | 模块系统 |
| 设计系统、UI | design | 设计系统 |
| 用户、身份 | identity | 身份管理 |
| 权限 | permission | 权限系统 |
| 协同、局域网 | collaboration | 局域网协同 |
| 工作台 | workbench | AI 工作台 |
| 画布 | canvas | 无限画布 |
| 数据、存储 | storage | 数据存储 |
| 应用、生态 | ecosystem | 应用生态 |

## Agent 生成流程

1. **扫描功能规格文件**
   ```bash
   find docs/03-功能规格/V1 -name "*.md" -type f | grep -v "README\|追踪\|说明"
   ```

2. **读取每个文件**
   - 提取标题（第一个 # 标题）
   - 提取编号（V1-FR-001）
   - 提取目标（"核心目标"或"目标"章节）
   - 从路径提取领域（目录名）

3. **判断能力主线**
   - 根据标题关键词映射到 track
   - 设置对应的 trackName

4. **生成数据数组**
   - 组装完整的对象
   - 使用 Object.freeze() 冻结

5. **写入数据文件**
   - 放在 产品文档浏览器-文档数据.js 的最后
   - 或者单独一个文件（推荐）

## 文件组织

**TUZAI 方式**（推荐）：
```
docs/90-参考资料/
  ├── 产品文档浏览器.html                  (103 KB - 只有 HTML)
  └── 产品文档浏览器-文档数据.js            (518 KB - 两个数据)
```

**单文件方式**（不推荐，文件太大）：
```
docs/90-参考资料/
  └── 产品文档浏览器-单文件版.html          (800+ KB - 全部内容)
```

## 总结

✅ **必须生成的 6 个数据**：
1. DOCS
2. DECISIONS
3. FEATURE_TRACKS
4. FEATURE_TIMELINE_VERSIONS
5. DOC_BROWSER_DATA
6. **FEATURE_BROWSER_DATA** ⚠️ 容易漏掉

❌ **常见错误**：
- 只生成了前 5 个，漏掉第 6 个
- 导致时间线视图无法使用
- 功能演进视图正常（不依赖此数据）

✅ **正确做法**：
- Agent 必须扫描所有功能规格
- 为每个功能生成完整元数据
- 写入 FEATURE_BROWSER_DATA 数组
