# 时间线视图生成指南

时间线视图是最复杂的功能，它**动态从"功能演进矩阵.md"文档提取数据**，而不是硬编码。

## 核心机制

### 时间线的数据来源

**不是这样**（错误）：
```javascript
// ❌ 硬编码每个功能的每个版本阶段
const featureStages = {
  "V1-FR-001": {
    v1: { change: "...", dependencies: "..." },
    v2: { change: "...", dependencies: "..." },
    // ...
  }
};
```

**而是这样**（正确）：
```javascript
// ✅ 从"功能演进矩阵.md"动态提取
function extractEvolutionStages(trackId) {
  // 1. 读取演进矩阵文档
  const evolutionDoc = state.docs.find(item => item.id === "evolution");
  
  // 2. 找到该能力主线的章节
  //    如：## Provider 能力演进
  
  // 3. 提取该章节的表格
  //    | 阶段 | 增量说明 | 依赖 | 完成判定 | 状态来源 |
  //    | V1 基础适配 | 支持 OpenAI/Claude... | ... | ... | ... |
  //    | V2 高级特性 | 流式响应... | ... | ... | ... |
  
  // 4. 返回 stages 数组
  return stages;
}
```

---

## 演进矩阵文档的格式要求

### 必须包含的结构

**文件**：`docs/02-产品与版本/功能演进矩阵.md`

**结构**：

```markdown
# 功能演进矩阵

## 1. Provider 能力演进

### 能力主线说明
Provider 适配框架的跨版本演进...

### 演进详表

| 阶段 | 增量说明 | 依赖 | 完成判定 | 状态来源 |
|------|---------|------|---------|---------|
| V1 基础适配 | 支持 OpenAI、Claude、Gemini 等主流 Provider | Provider 接口规范 | 至少支持 3 种 Provider | V1 实现状态 |
| V2 高级特性 | 流式响应、函数调用 | V1 基础适配 | 流式完整可用 | V2 开发计划 |
| V4 企业级 | 负载均衡、降级策略 | V2 高级特性 | 生产环境验证 | V4 需求文档 |

## 2. Skills 能力演进

| 阶段 | 增量说明 | 依赖 | 完成判定 | 状态来源 |
|------|---------|------|---------|---------|
| V1 基础管理 | Skills 注册、列表、启用/禁用 | 本地存储 | 能管理 10+ Skills | V1 实现状态 |
| V2 高级能力 | Skills 市场、自动更新 | V1 基础管理 | 市场有 50+ Skills | V2 规划 |

...

## 3. 跨版本总览

| 能力主线 | V1 | V2 | V4 | V5 | V6 | V7 | V8 | 后续 |
|---------|----|----|----|----|----|----|----|----|
| Provider 能力 | 基础适配 | 高级特性 | 企业级 | - | - | - | - | AI 原生协议 |
| Skills 能力 | 基础管理 | 高级能力 | - | - | - | 市场生态 | - | 插件商店 |
| MCP 能力 | 协议适配 | 完整支持 | - | - | - | - | - | - |
...
```

---

## extractEvolutionStages 函数的完整逻辑

```javascript
function extractEvolutionStages(trackId) {
  // 1. 获取演进矩阵文档和能力主线信息
  const doc = state.docs.find(item => item.id === "evolution");
  const track = FEATURE_TRACKS[trackId];
  if (!doc || !track) return [];
  
  const lines = doc.content.replace(/\r\n/g, "\n").split("\n");
  
  // 2. 找到该能力主线的章节
  //    搜索：## Provider 能力演进
  const sectionStart = lines.findIndex(line => 
    /^##\s+/.test(line) && line.includes(track.title)
  );
  if (sectionStart < 0) return [];
  
  // 3. 找到章节结束位置（下一个 ## 标题）
  const sectionEnd = lines.findIndex((line, index) => 
    index > sectionStart && /^##\s+/.test(line)
  );
  const end = sectionEnd < 0 ? lines.length : sectionEnd;
  
  // 4. 找到演进详表（Markdown 表格）
  const tableStart = lines.findIndex((line, index) => 
    index > sectionStart && index < end && isTableStart(lines, index)
  );
  if (tableStart < 0) return [];
  
  // 5. 提取表格行
  const rows = [];
  for (let index = tableStart + 2; index < end && /^\s*\|.*\|\s*$/.test(lines[index]); index++) {
    const cells = lines[index].trim()
      .replace(/^\|/, "").replace(/\|$/, "")
      .split("|").map(cell => cell.trim());
    
    if (cells.length >= 5) {
      rows.push({
        stage: cells[0],        // 阶段（如"V1 基础适配"）
        change: cells[1],       // 增量说明
        dependencies: cells[2], // 依赖
        completion: cells[3],   // 完成判定
        source: cells[4],       // 状态来源
        sourceFile: doc.file
      });
    }
  }
  
  // 6. 提取"跨版本总览"表（补充未详细展开的版本）
  const overviewStart = lines.findIndex(line => /^\|\s*能力主线\s*\|/.test(line));
  if (overviewStart >= 0) {
    let index = overviewStart + 2;
    while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
      const cells = lines[index].trim()
        .replace(/^\|/, "").replace(/\|$/, "")
        .split("|").map(cell => cell.trim());
      
      // 找到该能力主线的行
      if (cells[0] === track.overview) {
        // 跨版本总览的列索引映射
        const columns = [
          ["v2", "V2", 2],    // V2 在第 3 列
          ["v4", "V4", 4],    // V4 在第 5 列
          ["v5", "V5", 5],
          ["v6", "V6", 6],
          ["v7", "V7", 7],
          ["v8", "V8", 8],
          ["future", "后续", 9]
        ];
        
        columns.forEach(([versionId, label, cellIndex]) => {
          const version = FEATURE_TIMELINE_VERSIONS.find(item => item.id === versionId);
          
          // 如果该版本在详表中没有，且总览有内容，则补充
          if (!cells[cellIndex] || stagesForVersion(rows, version).length) return;
          
          rows.push({
            stage: label === "后续" ? "后续独立增强" : `${label} 总览关联`,
            change: cells[cellIndex],
            dependencies: "对应能力详表尚未单独展开",
            completion: "该版本进入开发门禁后补充",
            source: "[跨版本总览](功能演进矩阵.md#3-跨版本总览)",
            sourceFile: doc.file,
            overview: true  // 标记为总览数据
          });
        });
        break;
      }
      index++;
    }
  }
  
  return rows;
}

// 辅助函数：判断是否是表格开始
function isTableStart(lines, index) {
  return /^\s*\|.*\|\s*$/.test(lines[index]) && 
         /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1]);
}

// 辅助函数：筛选某个版本的阶段
function stagesForVersion(stages, version) {
  if (version.id === "gate") {
    return stages.filter(stage => /^V1\s+发布门禁/.test(stage.stage));
  }
  if (version.id === "future") {
    return stages.filter(stage => /^后续/.test(stage.stage));
  }
  if (/^v[2-8]$/.test(version.id)) {
    const label = version.label; // "V2", "V3", ...
    return stages.filter(stage => 
      stage.stage === label || 
      stage.stage.startsWith(`${label} `)
    );
  }
  return [];
}
```

---

## renderFeatureMilestone 函数

为每个版本渲染一个里程碑卡片：

```javascript
function renderFeatureMilestone(feature, version, stages) {
  // V1 特殊处理：使用 FEATURE_BROWSER_DATA 中的 implementation
  if (version.id === "v1") {
    const implementation = feature.implementation || {
      key: "foundation",
      label: "状态待同步"
    };
    
    return `
      <article class="feature-milestone current">
        <div class="milestone-axis">
          <span class="milestone-dot"></span>
          <strong>V1</strong>
          <small>精确功能</small>
        </div>
        <div class="milestone-card">
          <span class="milestone-state current">当前版本</span>
          <span class="implementation-state ${implementation.key}">${implementation.label}</span>
          <h4>${escapeHtml(feature.title)}</h4>
          <p>${escapeHtml(feature.goal)}</p>
        </div>
      </article>
    `;
  }
  
  // V2-V8 和后续：从 stages 中筛选
  const versionStages = stagesForVersion(stages, version);
  
  if (versionStages.length === 0) {
    // 无阶段：显示"当前未分配"
    return `
      <article class="feature-milestone ${version.kind}">
        <div class="milestone-axis">
          <span class="milestone-dot"></span>
          <strong>${version.label}</strong>
          <small>待规划</small>
        </div>
        <div class="milestone-card empty">
          <span class="milestone-state ${version.kind}">
            ${version.kind === 'history' ? '历史或未规划' : '未来版本'}
          </span>
          <p class="empty-stage">当前未分配阶段</p>
        </div>
      </article>
    `;
  }
  
  // 有阶段：渲染每个阶段
  return versionStages.map(stage => `
    <article class="feature-milestone ${version.kind}">
      <div class="milestone-axis">
        <span class="milestone-dot"></span>
        <strong>${version.label}</strong>
        <small>${escapeHtml(stage.stage)}</small>
      </div>
      <div class="milestone-card">
        <span class="milestone-state ${version.kind}">
          ${version.kind === 'planned' ? '未来规划' : '历史版本'}
        </span>
        <h4>${escapeHtml(stage.stage)}</h4>
        <p><strong>增量：</strong>${escapeHtml(stage.change)}</p>
        ${stage.dependencies ? `<p><strong>依赖：</strong>${escapeHtml(stage.dependencies)}</p>` : ''}
        ${stage.completion ? `<p><strong>完成判定：</strong>${escapeHtml(stage.completion)}</p>` : ''}
        ${stage.source ? `<p class="stage-source">来源：${stage.source}</p>` : ''}
      </div>
    </article>
  `).join('');
}
```

---

## Agent 生成步骤

### 第一步：确保 FEATURE_BROWSER_DATA 完整

**每个功能必须有正确的字段格式**：

```javascript
{
  id: "V1-FR-001",
  title: "Provider 适配框架",        // ✅ 只有功能名称（不包含 id）
  track: "provider",                 // ← 关键！用于匹配能力主线
  trackName: "Provider 能力",
  domain: "底层能力",
  goal: "支持 OpenAI、Claude、Gemini 等主流 Provider",
  file: "../03-功能规格/V1/01-底层能力/01-Provider适配框架.md",
  
  // V1 实现状态（可选，但推荐）
  implementation: {
    key: "inprogress",      // foundation/inprogress/completed
    label: "开发中",
    backend: "70%",
    frontend: "50%",
    verification: "30%"
  }
}
```

**❌ 常见错误：title 包含 id**
```javascript
{
  id: "V1-FR-001",
  title: "V1-FR-001：Provider 适配框架"  // ❌ 会导致重复显示
}
// 显示效果：V1-FR-001 · V1-FR-001：Provider 适配框架
//                      ^^^^^^^^^ 重复！
```

**✅ 正确格式**
```javascript
{
  id: "V1-FR-001",
  title: "Provider 适配框架"  // ✅ 只有功能名称
}
// 显示效果：V1-FR-001 · Provider 适配框架  清晰！
```

### 第二步：验证演进矩阵文档格式 ⚠️ 关键

**在生成浏览器之前，必须验证源文档格式**：

```bash
# 检查演进矩阵是否有表格
grep "^|" docs/02-产品与版本/功能演进矩阵.md | wc -l
```

**如果返回 0 或很少，说明文档格式错误！**

**错误格式示例**（DG-OS 当前）：
```markdown
## 3. Provider 能力演进

### 3.1 V1 基础适配（必须）
**用户价值**：...
**核心行为**：...
```
❌ 这是层级结构 + 段落，不是表格！

**正确格式**：
```markdown
## 3. Provider 能力演进

| 阶段 | 增量说明 | 依赖 | 完成判定 | 状态来源 |
|------|---------|------|---------|---------|
| V1 基础适配 | 支持 OpenAI、Claude、Gemini | ... | ... | ... |
| V2 高级特性 | 流式响应、函数调用 | ... | ... | ... |
```
✅ 必须是 5 列 Markdown 表格！

**如果源文档格式错误，Agent 应该**：
1. 停止生成
2. 提示用户："演进矩阵文档格式不符合要求，必须使用 5 列表格格式"
3. 提供正确的格式示例
4. 建议用户参考 TUZAI 的演进矩阵格式

**不要**：
- ❌ 不要尝试自动修复源文档（可能理解错误）
- ❌ 不要忽略问题继续生成（时间线会不可用）
- ❌ 不要假设文档格式正确
- `renderFeatureMilestone(feature, version, stages)` 函数
- `isTableStart(lines, index)` 辅助函数

这些函数**已经在模板中**，不需要修改，但要确保没有被删除。

---

## 为什么会显示"当前未分配阶段" ⚠️ 关键

**最常见的两个根本原因**：

### ❌ 根本原因 1：FEATURE_TRACKS 格式错误

**错误格式**（当前 DG-OS）：
```javascript
{
  "label": "Provider 能力",       // ❌ 应该是 title
  "accent": "#2f7d4f",
  "versions": ["V1", "V4"]        // ❌ 多余字段
  // ❌ 缺少 overview 字段
}
```

**正确格式**：
```javascript
{
  title: "Provider 能力演进",      // ✅ 必需！用于匹配章节
  overview: "Provider 能力",       // ✅ 必需！
  accent: "#087d75"
}
```

### ❌ 根本原因 2：演进矩阵文档格式错误

**错误格式**（当前 DG-OS）：
```markdown
## 3. Provider 能力演进

### 3.1 V1 基础适配
**用户价值**：...
**核心行为**：...
```
❌ 没有表格！extractEvolutionStages 找不到表格返回空数组。

**正确格式**：
```markdown
## 3. Provider 能力演进

| 阶段 | 增量说明 | 依赖 | 完成判定 | 状态来源 |
|------|---------|------|---------|---------|
| V1 基础适配 | 支持 OpenAI... | ... | ... | ... |
| V2 高级特性 | 流式响应... | ... | ... | ... |
```
✅ 必须是 5 列表格！

**详细诊断**：参见 `TIMELINE_UNDEFINED_STAGES.md`

---


### 原因 3：FEATURE_BROWSER_DATA 为空或缺少

生成时间线视图后，验证：

### 数据完整性
- [ ] FEATURE_BROWSER_DATA 有所有功能
- [ ] 每个功能有 track 字段
- [ ] track 值在 FEATURE_TRACKS 中存在
- [ ] DOCS 数组有 evolution 项
- [ ] 演进矩阵文档存在且可读

### 格式正确性
- [ ] 演进矩阵有每个能力主线的章节
- [ ] 章节标题匹配 FEATURE_TRACKS[xxx].title
- [ ] 演进详表是 Markdown 表格格式
- [ ] 表格有 5 列（阶段、增量、依赖、完成、来源）
- [ ] 表格行以 | 开头和结尾

### 功能验证
- [ ] 能选择功能（下拉框有选项）
- [ ] 选择后显示功能摘要
- [ ] V1 里程碑显示实现状态
- [ ] V2-V8 里程碑显示阶段（不是"未分配"）
- [ ] 能看到增量说明、依赖、完成判定

---

## 示例：DG-OS 的演进矩阵

**文件**：`docs/02-产品与版本/功能演进矩阵.md`

```markdown
# DGOS 功能演进矩阵

## 1. Provider 能力演进

### 演进详表

| 阶段 | 增量说明 | 依赖 | 完成判定 | 状态来源 |
|------|---------|------|---------|---------|
| V1 基础适配 | 支持 OpenAI、Claude、Gemini，统一接口 | Provider 接口规范 | 至少支持 3 种 Provider | [V1 实现状态](当前版本/V1-实现状态.md) |
| V2 高级特性 | 流式响应、函数调用、错误重试 | V1 基础适配 | 流式完整可用，支持工具调用 | V2 开发计划 |
| V4 企业级 | 负载均衡、降级策略、多配置管理 | V2 高级特性 | 生产环境验证，支持 10+ Provider | V4 需求文档 |

## 2. Skills 能力演进

| 阶段 | 增量说明 | 依赖 | 完成判定 | 状态来源 |
|------|---------|------|---------|---------|
| V1 基础管理 | Skills 注册、列表、启用/禁用 | 本地存储 | 能管理 10+ Skills | [V1 实现状态](当前版本/V1-实现状态.md) |
| V2 高级能力 | Skills 市场、自动更新、版本管理 | V1 基础管理 | 市场有 50+ Skills | V2 规划 |

## 3. MCP 能力演进

| 阶段 | 增量说明 | 依赖 | 完成判定 | 状态来源 |
|------|---------|------|---------|---------|
| V1 协议适配 | MCP 服务注册和管理，标准协议支持 | MCP 协议规范 | 支持 5+ MCP 服务 | [V1 实现状态](当前版本/V1-实现状态.md) |
| V2 完整支持 | 资源浏览、工具调用、提示词管理 | V1 协议适配 | 通过 MCP 兼容性测试 | V2 规划 |

...（其他能力主线）

## 跨版本总览

| 能力主线 | V1 | V2 | V4 | V5 | V6 | V7 | V8 | 后续 |
|---------|----|----|----|----|----|----|----|----|
| Provider 能力 | 基础适配 | 高级特性 | 企业级 | - | - | - | - | AI 原生协议 |
| Skills 能力 | 基础管理 | 高级能力 | - | - | - | 市场生态 | - | 插件商店 |
| MCP 能力 | 协议适配 | 完整支持 | - | - | - | - | - | - |
| 模块系统 | Module Federation | 完整热更新 | - | 依赖管理 | - | - | - | 插件化架构 |
| 设计系统 | 统一 UI | 主题市场 | - | - | 多端适配 | - | - | - |
| 身份管理 | 本地用户 | - | 云端同步 | 企业 SSO | - | - | - | - |
| 权限系统 | 模块级 | - | 细粒度 | - | - | - | 企业策略 | - |
| 局域网协同 | HTTP 服务 | WebSocket | - | - | - | - | - | P2P 协同 |
```

---

## 关键点

✅ **时间线是动态的**：
- 不是硬编码每个功能的每个版本
- 而是从演进矩阵文档实时提取
- 修改演进矩阵，时间线自动更新

✅ **Agent 必须理解**：
- track 字段的作用（匹配能力主线）
- 演进矩阵的格式要求（章节 + 表格）
- extractEvolutionStages 的提取逻辑

✅ **生成时必须**：
- 确保 FEATURE_BROWSER_DATA 完整
- 确保演进矩阵格式正确
- 确保 track 匹配 FEATURE_TRACKS
- 确保提取函数存在于模板中
