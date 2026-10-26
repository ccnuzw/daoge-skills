# 时间线"未分配阶段"问题诊断指南

## 🚨 问题现象

时间线视图中，所有版本都显示：
```
当前未分配阶段
该主责能力在此版本没有明确的阶段变化。
```

## 🔍 根本原因（两个）

### 原因 1：FEATURE_TRACKS 格式错误

**错误格式**（DG-OS 当前）：
```javascript
window.DGOS_FEATURE_TRACKS = {
  "provider": {
    "label": "Provider 能力",       // ❌ 错误！应该是 title
    "accent": "#2f7d4f",
    "versions": ["V1", "V4", "V5"]  // ❌ 多余！不需要这个字段
    // ❌ 缺少 overview 字段
  }
}
```

**正确格式**（TUZAI 标准）：
```javascript
const FEATURE_TRACKS = {
  provider: {
    title: "Provider 能力演进",      // ✅ 必需！用于匹配演进矩阵章节
    overview: "Provider 能力",       // ✅ 必需！用于跨版本总览表
    accent: "#087d75"
  }
}
```

**为什么会导致"未分配"**：
```javascript
// extractEvolutionStages 函数
const track = FEATURE_TRACKS[feature.track];
const sectionStart = lines.findIndex(line => 
  /^##\s+/.test(line) && line.includes(track.title)  // ← 找不到 title
);
if (sectionStart < 0) return [];  // ← 返回空数组
```

### 原因 2：演进矩阵文档格式错误

**错误格式**（DG-OS 当前）：
```markdown
## 3. Provider 能力演进

### 3.1 V1 基础适配（必须）

**用户价值**：能够配置和使用 AI 模型

**核心行为**：
- 配置 Provider...
- Provider 列表管理...
```

**问题**：
- ❌ 没有 Markdown 表格
- ❌ 用的是层级结构（3.1, 3.2）+ 段落描述
- ❌ extractEvolutionStages 找不到表格，返回空数组

**正确格式**（TUZAI 标准）：
```markdown
## 4. 身份、API Key 与权限演进

| 阶段 | 用户可感知变化 | 依赖与边界 | 完成判定 | 状态与来源 |
|------|---------------|-----------|---------|-----------|
| V1 账户与个人 Key | 用户可注册登录；管理员独立登录... | 用户、Key、账号和号池所有权必须隔离 | 身份、生命周期验收通过 | 当前版本：[功能 01～03] |
| V2 Key 稳定性控制 | 用户可配置每分钟请求限制 | 只增强 V1 个人 Key | Key 限流在多实例下生效 | 规划：[V2 稳定网关] |
| V4 轻量企业控制 | Key 可关联项目标签、预算上限 | 不创建企业组织 | Key 预算和 IP 白名单生效 | 规划：[V4 商业支付] |
```

**为什么必须是表格**：
```javascript
// extractEvolutionStages 函数
const tableStart = lines.findIndex((line, index) => 
  index > sectionStart && index < end && isTableStart(lines, index)
);
if (tableStart < 0) return [];  // ← 找不到表格，返回空数组

// isTableStart 检查
function isTableStart(lines, index) {
  return /^\s*\|.*\|\s*$/.test(lines[index]) &&       // 表格行
         /^\s*\|[\s:|-]+\|\s*$/.test(lines[index + 1]); // 分隔符
}
```

---


---

## ⚠️ 重要：源文档格式验证

**在生成浏览器之前，Agent 必须验证源文档格式**：

```bash
# 检查演进矩阵是否使用表格格式
grep "^|" docs/02-产品与版本/功能演进矩阵.md | wc -l
```

**如果返回值很少（< 10），说明源文档格式错误！**

### 当前 DG-OS 的问题

**源文档使用了错误的格式**：
- 使用层级结构（### 3.1, ### 3.2）
- 使用段落描述（**用户价值**、**核心行为**）
- 没有使用 5 列 Markdown 表格

**extractEvolutionStages 函数无法提取数据**：
```javascript
// 函数会找不到表格，返回空数组
const tableStart = lines.findIndex((line, index) => 
  index > sectionStart && index < end && isTableStart(lines, index)
);
if (tableStart < 0) return [];  // ← 返回空数组 → 显示"未分配"
```

### Agent 应该如何处理

**检测到源文档格式错误时**：

1. ✅ 停止生成
2. ✅ 提示用户：
   ```
   ⚠️ 演进矩阵文档格式不符合要求
   
   当前文档使用了层级结构（### 3.1）而不是表格。
   时间线视图需要 5 列 Markdown 表格才能工作。
   
   请参考：
   - TUZAI 演进矩阵格式（正确示例）
   - TIMELINE_GENERATION_GUIDE.md 第二步
   ```
3. ✅ 提供修复建议或转换服务

**不要**：
- ❌ 假设文档格式正确
- ❌ 忽略问题继续生成
- ❌ 尝试自动修复（可能理解错误）

## ✅ 修复方法

### 修复 1：更新 FEATURE_TRACKS

```javascript
window.DGOS_FEATURE_TRACKS = {
  provider: {
    title: "Provider 能力演进",      // 匹配演进矩阵的 "## 3. Provider 能力演进"
    overview: "Provider 能力",
    accent: "#2f7d4f"
  },
  skills: {
    title: "Skills 能力演进",        // 匹配演进矩阵的 "## 4. Skills 能力演进"
    overview: "Skills 能力",
    accent: "#4056a1"
  },
  // ... 其他能力主线
};
```

### 修复 2：重写演进矩阵文档为表格格式

**每个能力主线章节必须包含表格**：

```markdown
## 3. Provider 能力演进

| 阶段 | 增量说明 | 依赖 | 完成判定 | 状态来源 |
|------|---------|------|---------|---------|
| V1 基础适配 | 支持 OpenAI、Claude、Gemini，统一接口 | Provider 接口规范 | 至少支持 3 种 Provider | [V1 实现状态](当前版本/V1-实现状态.md) |
| V2 高级特性 | 流式响应、函数调用、错误重试 | V1 基础适配 | 流式完整可用 | V2 开发计划 |
| V4 企业级 | 负载均衡、降级策略 | V2 高级特性 | 生产环境验证 | V4 需求文档 |
```

**表格必须有 5 列**：
1. 阶段 - 如 "V1 基础适配", "V2 高级特性"
2. 增量说明 - 这个阶段新增的功能
3. 依赖 - 依赖哪些功能或门禁
4. 完成判定 - 达到什么结果算完成
5. 状态来源 - 链接到相关文档

---

## 🎯 Skill 更新要点

### 1. FEATURE_TRACKS 必须有 3 个字段

```javascript
{
  title: "XXX 能力演进",    // 必需，用于匹配章节
  overview: "XXX 能力",     // 必需，用于总览表
  accent: "#颜色"           // 必需
}
```

### 2. 演进矩阵必须用表格格式

- 每个能力主线章节下必须有 Markdown 表格
- 表格必须有 5 列
- 阶段名称必须包含版本号（V1, V2, V4...）

### 3. 章节标题必须匹配

```javascript
// FEATURE_TRACKS
title: "Provider 能力演进"

// 演进矩阵
## 3. Provider 能力演进   ← 必须包含 title 的文本
```

---

## 📋 验证清单

生成后检查：

- [ ] FEATURE_TRACKS 有 title 字段（不是 label）
- [ ] FEATURE_TRACKS 有 overview 字段
- [ ] FEATURE_TRACKS 没有多余的 versions 字段
- [ ] 演进矩阵每个章节有 5 列表格
- [ ] 表格第一列是阶段名称（包含版本号）
- [ ] 章节标题包含 FEATURE_TRACKS 的 title

---

## 🔍 调试方法

```javascript
// 在浏览器控制台测试
const feature = state.features[0];
const track = FEATURE_TRACKS[feature.track];

console.log('Track:', track);
console.log('Track title:', track.title);  // 必须有值

const doc = state.docs.find(item => item.id === "evolution");
const stages = extractEvolutionStages(feature.track);

console.log('Extracted stages:', stages);  // 不应该是空数组
```

如果 stages 是空数组，检查：
1. track.title 是否有值
2. 演进矩阵是否有匹配的章节
3. 章节是否有表格
4. 表格是否有 5 列
