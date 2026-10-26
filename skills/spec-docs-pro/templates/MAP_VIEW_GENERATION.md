# 模式 4 补充：图谱视图生成

## 图谱视图（Map View）

图谱视图包含 5 个 SVG 可视化图表。这些图表**可以由 Agent 生成**。

### 必须先读取 SVG 生成指南

```bash
read skill://spec-docs-pro/templates/SVG_GENERATION_GUIDE.md
```

这份指南包含：
- ✅ 5 个图表的生成模式
- ✅ 如何从架构文档提取信息
- ✅ SVG 代码模板和辅助函数
- ✅ 布局和颜色规则

---

## 生成步骤

### 第一步：读取架构文档

```bash
# 总体架构
find docs/04-技术架构 -name "*总体架构*" -o -name "*架构*"
read docs/04-技术架构/总体架构.md
read docs/04-技术架构/V1-总体架构.md

# 数据模型
find docs/04-技术架构 -name "*数据模型*"
read docs/04-技术架构/V1-数据模型.md

# 服务边界
find docs/04-技术架构 -name "*服务*" -o -name "*领域*"
read docs/04-技术架构/服务与领域边界.md
```

### 第二步：提取架构信息

**从总体架构文档提取**：
- 系统组件列表（如：Provider 适配框架、Skills 管理、MCP 管理）
- 组件分层（前端、后端、系统层）
- 数据流和调用关系

**从数据模型文档提取**：
- 数据表名称
- 数据域分类（用户域、Provider 域、计费域等）
- 表之间的关系

**从功能规格提取风险**：
- 标记为"高风险"的功能
- 决策记录中提到的风险点

### 第三步：生成 5 个 SVG 函数

根据 SVG_GENERATION_GUIDE.md 中的模板，生成：

1. **renderProductArchitectureSvg()** - 产品全景图
2. **renderCoreFlowSvg()** - 调用闭环图
3. **renderVersionRoadmapSvg()** - 版本路线图（使用 FEATURE_TIMELINE_VERSIONS）
4. **renderDataDomainSvg()** - 数据域关系图
5. **renderRiskHeatmapSvg()** - 风险热区图

### 第四步：插入到浏览器 HTML

在 HTML 文件中，找到这 5 个函数的位置（通常在 `renderMap()` 后面），替换为生成的函数。

---

## 示例：DG-OS 的产品全景图

**基于 DG-OS 的架构文档生成**：

```javascript
function renderProductArchitectureSvg() {
  return `
    <svg viewBox="0 0 960 520" role="img" aria-label="DGOS 产品全景">
      <defs>
        <marker id="arrow-main" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
          <path d="M0,0 L9,3 L0,6 Z" fill="#69707a"></path>
        </marker>
        <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#1d1f22" flood-opacity="0.08"></feDropShadow>
        </filter>
      </defs>
      
      <rect width="960" height="520" rx="8" fill="#fbfaf7"></rect>
      
      <!-- 标题 -->
      <text x="36" y="38" font-size="18" font-weight="760" fill="#1d1f22">DGOS 产品全景</text>
      <text x="36" y="62" font-size="12" fill="#69707a">本地优先 AI 应用开发框架的核心组件和数据流</text>
      
      <!-- 前端层 -->
      <rect x="52" y="100" width="856" height="100" rx="8" fill="#ffffff" stroke="#dedbd2" stroke-dasharray="4 4"></rect>
      <text x="70" y="125" font-size="12" font-weight="700" fill="#69707a">前端层</text>
      
      <g filter="url(#card-shadow)">
        <rect x="80" y="140" width="150" height="50" rx="8" fill="#e1f0e8" stroke="#2f7d4f"></rect>
        <text x="155" y="165" text-anchor="middle" font-size="13" font-weight="700">AI 工作台</text>
        <text x="155" y="183" text-anchor="middle" font-size="11" fill="#69707a">对话/Provider</text>
      </g>
      
      <g filter="url(#card-shadow)">
        <rect x="250" y="140" width="150" height="50" rx="8" fill="#e6e9f6" stroke="#4056a1"></rect>
        <text x="325" y="165" text-anchor="middle" font-size="13" font-weight="700">系统设置</text>
        <text x="325" y="183" text-anchor="middle" font-size="11" fill="#69707a">配置/主题</text>
      </g>
      
      <!-- 核心层 -->
      <rect x="52" y="220" width="856" height="180" rx="8" fill="#ffffff" stroke="#dedbd2" stroke-dasharray="4 4"></rect>
      <text x="70" y="245" font-size="12" font-weight="700" fill="#69707a">核心能力层</text>
      
      <g filter="url(#card-shadow)">
        <rect x="80" y="270" width="150" height="110" rx="8" fill="#dcefeb" stroke="#087d75"></rect>
        <text x="155" y="295" text-anchor="middle" font-size="13" font-weight="700">Provider 适配</text>
        <text x="155" y="315" text-anchor="middle" font-size="11" fill="#69707a">OpenAI/Claude</text>
        <text x="155" y="333" text-anchor="middle" font-size="11" fill="#69707a">Gemini/通义</text>
        <text x="155" y="351" text-anchor="middle" font-size="11" fill="#69707a">统一接口</text>
      </g>
      
      <g filter="url(#card-shadow)">
        <rect x="250" y="270" width="130" height="110" rx="8" fill="#e6e9f6" stroke="#4056a1"></rect>
        <text x="315" y="295" text-anchor="middle" font-size="13" font-weight="700">Skills 管理</text>
        <text x="315" y="315" text-anchor="middle" font-size="11" fill="#69707a">工具注册</text>
        <text x="315" y="333" text-anchor="middle" font-size="11" fill="#69707a">能力扩展</text>
      </g>
      
      <g filter="url(#card-shadow)">
        <rect x="400" y="270" width="130" height="110" rx="8" fill="#e1f0e8" stroke="#2f7d4f"></rect>
        <text x="465" y="295" text-anchor="middle" font-size="13" font-weight="700">MCP 管理</text>
        <text x="465" y="315" text-anchor="middle" font-size="11" fill="#69707a">协议适配</text>
        <text x="465" y="333" text-anchor="middle" font-size="11" fill="#69707a">服务调用</text>
      </g>
      
      <g filter="url(#card-shadow)">
        <rect x="550" y="270" width="150" height="110" rx="8" fill="#f6ead6" stroke="#a96810"></rect>
        <text x="625" y="295" text-anchor="middle" font-size="13" font-weight="700">模块系统</text>
        <text x="625" y="315" text-anchor="middle" font-size="11" fill="#69707a">Module Federation</text>
        <text x="625" y="333" text-anchor="middle" font-size="11" fill="#69707a">热更新</text>
      </g>
      
      <g filter="url(#card-shadow)">
        <rect x="720" y="270" width="150" height="110" rx="8" fill="#f4dde4" stroke="#aa2d4d"></rect>
        <text x="795" y="295" text-anchor="middle" font-size="13" font-weight="700">设计系统</text>
        <text x="795" y="315" text-anchor="middle" font-size="11" fill="#69707a">统一 UI</text>
        <text x="795" y="333" text-anchor="middle" font-size="11" fill="#69707a">主题管理</text>
      </g>
      
      <!-- 系统层 -->
      <rect x="52" y="420" width="856" height="60" rx="8" fill="#ffffff" stroke="#dedbd2" stroke-dasharray="4 4"></rect>
      <text x="70" y="445" font-size="12" font-weight="700" fill="#69707a">系统层</text>
      
      <g filter="url(#card-shadow)">
        <rect x="80" y="450" width="140" height="40" rx="8" fill="#e6e9f6" stroke="#4056a1"></rect>
        <text x="150" y="474" text-anchor="middle" font-size="12" font-weight="700">本地存储</text>
      </g>
      
      <g filter="url(#card-shadow)">
        <rect x="240" y="450" width="140" height="40" rx="8" fill="#dcefeb" stroke="#087d75"></rect>
        <text x="310" y="474" text-anchor="middle" font-size="12" font-weight="700">用户管理</text>
      </g>
      
      <g filter="url(#card-shadow)">
        <rect x="400" y="450" width="140" height="40" rx="8" fill="#f4dde4" stroke="#aa2d4d"></rect>
        <text x="470" y="474" text-anchor="middle" font-size="12" font-weight="700">权限管理</text>
      </g>
      
      <g filter="url(#card-shadow)">
        <rect x="560" y="450" width="140" height="40" rx="8" fill="#e1f0e8" stroke="#2f7d4f"></rect>
        <text x="630" y="474" text-anchor="middle" font-size="12" font-weight="700">局域网协同</text>
      </g>
      
      <!-- 连接线 -->
      <g stroke="#69707a" stroke-width="1.6" fill="none" marker-end="url(#arrow-main)">
        <path d="M155 190 V270"></path>
        <path d="M325 190 V270"></path>
      </g>
      
      <g stroke="#69707a" stroke-width="1.4" fill="none" marker-end="url(#arrow-main)">
        <path d="M155 380 V450"></path>
        <path d="M315 380 V450"></path>
        <path d="M465 380 V450"></path>
        <path d="M625 380 V450"></path>
      </g>
    </svg>
  `;
}
```

---

## 简化方案

如果时间有限或架构文档不完整，可以：

### 方案 A：只生成版本路线图

其他 4 个图表显示提示："图谱功能需要完善架构文档"

### 方案 B：使用通用模板

生成通用的"前端-后端-数据库"三层架构图

### 方案 C：从 DOCS 数组生成

根据 DOCS 数组中的文档类型，自动组织成组件卡片

---

## 关键原则

1. **不追求完美**：布局可能不如手工调整，但信息准确即可
2. **可迭代**：第一次生成简单版本，后续可以改进
3. **复用模板**：使用固定的布局网格和颜色方案
4. **自动提取**：从文档中提取，而不是硬编码

---

## Agent 检查清单

生成图谱视图后，验证：

- [ ] 5 个 SVG 函数都已生成
- [ ] 函数名正确（renderProductArchitectureSvg 等）
- [ ] SVG 包含项目实际的组件名称（不是 TUZAI 的）
- [ ] 颜色和布局合理
- [ ] 图表能正常显示（打开浏览器检查）
