# spec-docs-pro 生成文档浏览器 - 完整指南索引


## 🚨 开始前必读：最常见的错误

**问题**：生成的浏览器文档头部显示 undefined

```
概览
undefined          ← phase 字段缺失
docs/01-项目概览/Git提交信息规范.md
```

**原因**：DOCS 数组字段错误
- ❌ 字段名 `accentSoft` 应该是 `soft`
- ❌ 缺少 `phase` 字段（显示在版本标签旁）
- ❌ 缺少 `goal` 字段（显示在章节数下方）

**解决**：生成 DOCS 前必读 `DOCS_ARRAY_FORMAT.md`

---

## 🚀 快速开始（推荐首次使用）

**如果你是第一次使用 spec-docs-pro**，建议先阅读：
```bash
read skill://spec-docs-pro/templates/QUICK_START.md
```

**快速开始指南包含**：
- ✅ 5 分钟快速流程
- ✅ 必需文档清单
- ✅ 常见问题快速修复
- ✅ 默认演进矩阵示例
- ✅ 颜色分配规则

**适用场景**：标准项目（10-30 个功能），已有基础文档

---

## 🎯 目标

为任何符合 spec-docs-pro 规范的项目生成**完全定制化**的产品文档浏览器。

浏览器包含 5 个视图：
1. **总览** - 项目统计、版本链路、关键决策
2. **阅读** - Markdown 文档渲染
3. **图谱** - 5 个 SVG 架构可视化图表

4. **功能演进** - 跨版本能力演进矩阵
5. **时间线** - 单功能完整版本演进历程

---

## 📚 必读文档清单（按顺序）

### 第一优先级：避免格式错误

**1. DATA_FORMAT_SPEC.md** ⚠️ 关键
- DECISIONS 必须是 `{accent, text}` 格式
- 数据文件必须用 `window.{项目名}_XXX`
- FEATURE_BROWSER_DATA 的必需字段
- 常见错误对照表

**如果不读这个，会导致**：
- ❌ 右侧口径显示 undefined
- ❌ 时间线显示"未分配阶段"
- ❌ 文档内容无法加载

### 第二优先级：理解整体结构

**2. TUZAI_STRUCTURE_REFERENCE.md** 📋
- 完整的 6 个数据结构（不是 5 个）
- TUZAI 完整示例
- DG-OS 对照示例

### 第三优先级：生成流程

**3. mode-4-pure-agent.md** 🔧
- 4 步生成流程
- 如何探索项目文档
- 如何提取版本、决策、能力主线
- 如何生成 HTML 和数据文件

### 第四优先级：特殊视图

**4. TIMELINE_GENERATION_GUIDE.md** ⏱️ 最复杂
- 时间线的核心机制（动态从演进矩阵提取）
- extractEvolutionStages 函数逻辑
- 演进矩阵文档格式要求
- 为什么显示"未分配阶段"

**5. MAP_VIEW_GENERATION.md** 🗺️
- 图谱视图生成步骤
- 从架构文档提取信息
- DG-OS 产品全景图示例

**6. SVG_GENERATION_GUIDE.md** 🎨
- 5 个 SVG 图表的生成模式
- 辅助函数和颜色映射
- 布局规则

---

## ✅ 完整生成检查清单

### 数据完整性（6 个数据结构）

#### HTML 中的 4 个数据
- [ ] **DOCS 数组** ⚠️ 容易出错
  - 包含所有文档
  - 有 evolution 项（id 必须是 "evolution"）
  - **每个文档有完整的 8 个字段**：id, version, **phase**, accent, **soft** (不是 accentSoft), title, file, **goal**
  - **phase 和 goal 不能缺少**，否则文档头部显示 undefined
  - file 是相对路径（../02-产品与版本/...）
  
- [ ] **DECISIONS 数组**
  - 格式：`[{accent, text}, ...]`
  - 不是 `{id, title, category}`
  - 10-20 条关键决策
- [ ] **FEATURE_TRACKS 对象**
  - 格式：`{track_key: {title, overview, accent}, ...}`
  - 包含项目的所有能力主线
  - title 必须匹配演进矩阵文档中的章节标题
  
- [ ] **FEATURE_TIMELINE_VERSIONS 数组**
  - 格式：`[{id, label, kind}, ...]`
  - 包含所有版本（V1-V8 + 后续）
  - kind: current/planned/history/gate

#### 数据文件中的 2 个数据
- [ ] **window.{项目名}_DOC_BROWSER_DATA**
  - Object.freeze({...})
  - 键是 DOCS 中的 id
  - 值是 Markdown 文档内容
  

3. **数据完整性**
   - [ ] FEATURE_BROWSER_DATA 有所有功能
   - [ ] 每个功能的 track 值在 FEATURE_TRACKS 中存在
   - [ ] DOCS 数组有 evolution 项
   - [ ] 章节标题包含 FEATURE_TRACKS 的 title

**详细诊断**：参见 `TIMELINE_UNDEFINED_STAGES.md`

- [ ] 5 个 SVG 函数已生成
  - renderProductArchitectureSvg()
  - renderCoreFlowSvg()
  - renderVersionRoadmapSvg()
  - renderDataDomainSvg()
  - renderRiskHeatmapSvg()
- [ ] SVG 包含项目实际组件（不是 TUZAI 的）
- [ ] 项目名称已替换（不是 TUZAI）

### 功能验证

- [ ] **总览视图**
  - 统计数据正确
  - 版本链路显示
  - 右侧口径不是 undefined
  
- [ ] **阅读视图**
  - 文档能加载
  - Markdown 正常渲染
  - 章节导航可用
  
- [ ] **图谱视图**
  - 5 个图表能显示
  - 内容是项目专属的
  
- [ ] **功能演进视图**
  - 能点击查看
  - 显示演进矩阵内容
  
- [ ] **时间线视图**
  - 能选择功能
  - V1 显示实现状态
  - V2-V8 显示阶段（不是"未分配"）
  - 能看到增量说明

---

## 🚨 常见错误和解决方法

### 错误 1：右侧口径显示 undefined

**原因**：DECISIONS 格式错误

**错误格式**：
```javascript
{id: "D001", title: "...", category: "..."}
```

**正确格式**：
```javascript
{accent: "#2f7d4f", text: "..."}
```

### 错误 2：时间线显示"未分配阶段"

**可能原因**：
1. FEATURE_BROWSER_DATA 为空或缺少
2. 功能的 track 不在 FEATURE_TRACKS 中
3. 演进矩阵文档格式不对
4. track.title 与演进矩阵章节标题不匹配

**解决**：
- 检查 window.DGOS_FEATURE_BROWSER_DATA 是否存在
- 检查 track 值是否匹配
- 检查演进矩阵文档格式

### 错误 3：文档内容无法加载

**原因**：数据文件变量名错误

**错误**：
```javascript
const DOC_BROWSER_DATA = {...}  // 缺少 window 和项目前缀
```

**正确**：
```javascript
window.DGOS_DOC_BROWSER_DATA = Object.freeze({...})
```

### 错误 4：图谱显示 TUZAI 的内容

**原因**：SVG 函数没有重新生成，仍然是模板中的硬编码

**解决**：
- 读取 SVG_GENERATION_GUIDE.md
- 从架构文档提取项目组件
- 生成项目专属的 SVG 函数

### 错误 5：功能演进点击无效

**原因**：DOCS 数组缺少 evolution 项

**解决**：
```javascript
{
  id: "evolution",  // ← 必须是这个 id
  version: "EV",
  title: "功能演进矩阵",
  file: "../02-产品与版本/功能演进矩阵.md"
}
```

---

## 📝 生成流程摘要

### 第一步：探索项目文档（15-20 分钟）

```bash
# 3. 决策记录
read docs/06-决策记录/V1-冻结决策.md
# 提取：## D001 标题（ADR 格式）或列表项

# 4. 能力主线
read docs/02-产品与版本/功能演进矩阵.md
# 提取：## {能力}演进 章节标题

# 5. 功能规格
find docs/03-功能规格 -name "*.md"
# 为每个功能生成元数据

# 6. 架构文档
read docs/04-技术架构/总体架构.md
read docs/04-技术架构/V1-数据模型.md
# 用于生成图谱
```

### 第二步：生成 HTML 数据（5-10 分钟）

1. DOCS 数组（所有文档）
2. DECISIONS 数组（正确格式：accent + text）
3. FEATURE_TRACKS 对象（能力主线）
4. FEATURE_TIMELINE_VERSIONS 数组（版本）

### 第三步：生成数据文件（10-15 分钟）

1. window.{项目名}_DOC_BROWSER_DATA（文档内容）
2. window.{项目名}_FEATURE_BROWSER_DATA（功能数组）

### 第四步：生成 SVG 函数（15-20 分钟）⚠️ **必须动态生成**

**图谱视图必须动态生成，不能使用模板的硬编码 TUZAI 数据！**

1. 读取 SVG_GENERATION_GUIDE.md（SVG 生成模式）
2. 读取 MAP_VIEW_GENERATION.md（图谱生成流程）
3. 从架构文档提取组件和关系
4. 生成 5 个 SVG 函数：
   - renderProductArchitectureSvg() - 从总体架构.md 提取组件
   - renderCoreFlowSvg() - 从服务边界提取流程
   - renderVersionRoadmapSvg() - 从 FEATURE_TIMELINE_VERSIONS 生成
   - renderDataDomainSvg() - 从数据模型.md 提取表
   - renderRiskHeatmapSvg() - 从高风险功能提取
5. 替换模板中的对应函数

**注意**：
- ✅ 总览视图的统计会自动从 state.docs 计算（模板已有）
- ⚠️ 但图谱的 5 个 SVG 必须重新生成（不能用模板的）
### 第五步：验证结果（5 分钟）

- 检查所有 5 个视图
- 验证数据完整性
- 确认无硬编码的 TUZAI 数据

**总时间**：50-70 分钟

---

## 🎯 成功标准

生成的浏览器应该：

✅ **完全定制化**
- 项目名称正确
- 所有数据来自实际项目
- 无 TUZAI 硬编码数据

✅ **功能完整**
- 5 个视图全部可用
- 时间线能选择功能并显示演进
- 图谱显示项目专属架构

✅ **数据准确**
- 决策来自实际决策文档
- 功能列表完整
- 版本信息正确

✅ **格式正确**
- DECISIONS 使用 {accent, text}

---

## 🔍 第五步：验证生成结果（必须）

**生成完成后，必须进行功能验证，不能盲目交付！**

### 读取验证指南

```bash
read skill://spec-docs-pro/templates/VERIFICATION_GUIDE.md
```

### 验证清单

#### 自动验证（推荐）

使用 `browser` 工具打开浏览器，自动验证所有功能：
- ✅ 总览视图（统计、决策不是 undefined）
- ✅ 图谱视图（5 个 SVG 图表）
- ✅ 功能演进视图（能点击查看）
- ✅ 时间线视图（能选择功能，不是"未分配阶段"）
- ✅ 文档阅读（内容正常加载）

#### 静态检查（最低要求）

如果不能使用浏览器，至少进行静态检查：
```bash
# 1. 检查文件大小
ls -lh docs/90-参考资料/产品文档浏览器*

# 2. 检查项目名称（不应有 TUZAI）
grep -c "TUZAI" docs/90-参考资料/产品文档浏览器.html

# 3. 检查 DECISIONS 格式
grep -A 3 "const DECISIONS" docs/90-参考资料/产品文档浏览器.html

# 4. 检查功能数据
grep "FEATURE_BROWSER_DATA" docs/90-参考资料/产品文档浏览器-文档数据.js

# 5. 检查 SVG 函数
grep -c "function render.*Svg()" docs/90-参考资料/产品文档浏览器.html
```

### 验证报告

生成验证报告，明确列出：
- ✅ 通过的功能
- ❌ 失败的功能
- 🔧 修复建议

**如果验证失败，必须修复后再交付！**
- 数据文件使用 window.{项目名}_XXX
- FEATURE_BROWSER_DATA 有所有必需字段

---

**按照这个指南，Agent 应该能生成和 TUZAI 样例一样完整的产品文档浏览器！** 🚀
