# ⚠️ 重要：图谱和总览必须动态生成

## 关键问题

**错误理解**：
- ❌ 图谱视图可以使用模板的硬编码 SVG
- ❌ 总览视图会自动正确显示

**正确理解**：
- ✅ 图谱视图的 5 个 SVG **必须**根据项目架构重新生成
- ✅ 总览视图的统计会自动计算，但要确保 DOCS 数据正确

---

## 图谱视图生成（必须）

### 为什么必须动态生成

模板中的 SVG 函数包含 TUZAI 的业务逻辑：
- 协议网关、Key 鉴权、供给路由（TUZAI 特有）
- 用户、订单、支付、账务（TUZAI 的数据域）
- OpenAI/Anthropic/Gemini 供应商（TUZAI 的架构）

**这些不适用于其他项目！**

### 必须做什么

**第四步：生成 SVG 函数**（不是可选）

1. **读取指南**
   ```bash
   read skill://spec-docs-pro/templates/SVG_GENERATION_GUIDE.md
   read skill://spec-docs-pro/templates/MAP_VIEW_GENERATION.md
   ```

2. **提取项目架构信息**
   ```bash
   # 组件列表
   read docs/04-技术架构/总体架构.md
   # 提取：Provider 适配框架、Skills 管理、MCP 管理、模块系统等
   
   # 数据模型
   read docs/04-技术架构/V1-数据模型.md
   # 提取：users, provider_configs, skills, modules 等表
   
   # 服务边界
   read docs/04-技术架构/服务与领域边界.md
   # 提取：核心调用流程
   ```

3. **生成 5 个 SVG 函数**
   - renderProductArchitectureSvg() - 项目组件架构
   - renderCoreFlowSvg() - 核心业务流程
   - renderVersionRoadmapSvg() - 版本演进（从 FEATURE_TIMELINE_VERSIONS）
   - renderDataDomainSvg() - 数据域关系
   - renderRiskHeatmapSvg() - 风险热区

4. **替换模板中的函数**
   - 找到模板中的 5 个函数位置
   - 用生成的函数替换
   - 确保函数名完全一致

### SVG 生成示例

**DG-OS 的产品架构图**（不是 TUZAI 的）：

```javascript
function renderProductArchitectureSvg() {
  return `
    <svg viewBox="0 0 960 520" role="img" aria-label="DGOS 产品全景">
      <!-- 标题 -->
      <text x="36" y="38" font-size="18" font-weight="760">DGOS 产品全景</text>
      <text x="36" y="62" font-size="12" fill="#69707a">本地优先 AI 应用开发框架</text>
      
      <!-- 前端层：AI 工作台、系统设置 -->
      <rect ...>AI 工作台</text>
      <rect ...>系统设置</text>
      
      <!-- 核心层：Provider、Skills、MCP、模块、设计 -->
      <rect ...>Provider 适配</text>
      <rect ...>Skills 管理</text>
      <rect ...>MCP 管理</text>
      <rect ...>模块系统</text>
      <rect ...>设计系统</text>
      
      <!-- 系统层：本地存储、用户、权限、协同 -->
      <rect ...>本地存储</text>
      <rect ...>用户管理</text>
      <rect ...>权限管理</text>
      <rect ...>局域网协同</text>
    </svg>
  `;
}
```

**注意**：
- 组件名称来自 DG-OS 实际架构
- 不是 TUZAI 的"协议网关"、"供给路由"
- 布局根据 DG-OS 的层次结构

---

## 总览视图（自动，但要确保数据正确）

### 总览视图的组成

**自动计算的部分**（模板已有）：
```javascript
// 这些会自动从 state.docs 计算
const totalLines = state.docs.reduce((sum, doc) => sum + doc.lines, 0);
const totalHeadings = state.docs.reduce((sum, doc) => sum + doc.headings.length, 0);
const deliveryDocs = state.docs.filter(doc => /^v\d/.test(doc.id));
```

**需要确保的部分**：
1. ✅ DOCS 数组完整（包含所有文档）
2. ✅ DECISIONS 数组格式正确（{accent, text}）
3. ✅ 版本文档有正确的 id（v1, v2, v4-v8）

### Agent 要做什么

**不需要修改总览视图的代码**（模板已正确实现）

**只需要确保数据正确**：
- DOCS 数组包含所有文档
- 每个文档有 lines 和 headings（loadDoc 会自动计算）
- DECISIONS 格式正确（右侧口径不会显示 undefined）

---

## 检查清单

### 图谱视图检查

生成后，验证：
- [ ] 5 个 SVG 函数已重新生成
- [ ] SVG 包含项目实际组件（不是 TUZAI 的）
- [ ] 函数名正确（render*Svg）
- [ ] 在浏览器中能显示 5 个图表
- [ ] 图表内容是项目专属的

### 总览视图检查

生成后，验证：
- [ ] 统计数据正确（文档数、行数、章节数）
- [ ] 版本链路显示（v1, v2, v4-v8）
- [ ] 右侧决策不是 undefined
- [ ] 当前入口显示正确

---

## 常见错误

### 错误 1：图谱显示 TUZAI 内容

**原因**：没有重新生成 SVG 函数，仍然使用模板的

**解决**：
```bash
# 1. 检查是否包含 TUZAI 关键词
grep "协议网关\|供给路由\|Key 鉴权" docs/90-参考资料/产品文档浏览器.html

# 2. 如果有，说明没有重新生成
# 3. 读取 SVG_GENERATION_GUIDE.md 和 MAP_VIEW_GENERATION.md
# 4. 重新生成 5 个 SVG 函数
```

### 错误 2：总览决策显示 undefined

**原因**：DECISIONS 格式错误

**解决**：
```javascript
// 错误格式
{id: "D001", title: "...", category: "..."}

// 正确格式
{accent: "#2f7d4f", text: "..."}
```

---

## 总结

✅ **总览视图**：
- 模板已正确实现自动统计
- Agent 只需确保 DOCS 和 DECISIONS 数据正确

⚠️ **图谱视图**：
- **必须**重新生成 5 个 SVG 函数
- **不能**使用模板的硬编码 TUZAI 数据
- 按照 SVG_GENERATION_GUIDE.md 从架构文档提取
- 生成项目专属的可视化

**这是生成完整浏览器的必要步骤，不是可选！**
