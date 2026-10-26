# 图谱视图 SVG 生成指南

通过分析 TUZAI 的 5 个 SVG 图表，提取了可复用的生成模式。

## SVG 生成模式

### 通用结构

每个 SVG 图表都遵循相同的结构：

```javascript
function render{Name}Svg() {
  return `
    <svg viewBox="0 0 {width} {height}" role="img" aria-label="{项目名} {图表名}">
      <defs>
        <!-- 箭头标记、阴影滤镜等 -->
      </defs>
      
      <!-- 背景 -->
      <rect width="{width}" height="{height}" rx="8" fill="#fbfaf7"></rect>
      
      <!-- 标题 -->
      <text x="36" y="38" font-size="18" font-weight="760" fill="#1d1f22">{标题}</text>
      <text x="36" y="62" font-size="12" fill="#69707a">{副标题说明}</text>
      
      <!-- 连接线（箭头） -->
      <g stroke="#69707a" stroke-width="1.6" fill="none" marker-end="url(#arrow-main)">
        <path d="M{x1} {y1} H{x2}"></path>
        <!-- 更多连接 -->
      </g>
      
      <!-- 组件卡片 -->
      <g filter="url(#card-shadow)">
        <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{color}" stroke="{border}"></rect>
        <text x="{cx}" y="{cy}" text-anchor="middle" font-size="13" font-weight="700">{名称}</text>
        <text x="{cx}" y="{cy+20}" text-anchor="middle" font-size="11" fill="#69707a">{说明1}</text>
        <!-- 更多说明 -->
      </g>
      
      <!-- 图例 -->
      <g class="legend-row">
        <line ...></line>
        <text ...>图例说明</text>
      </g>
    </svg>
  `;
}
```

---

## 1. 产品全景图（Architecture）

**目的**：展示系统整体架构和数据流

**从哪里提取信息**：
- 读取 `docs/04-技术架构/总体架构.md` 或 `docs/04-技术架构/V1-总体架构.md`
- 提取关键组件、服务、数据流

**生成步骤**：

```javascript
// 1. 读取架构文档
const archDoc = await read("docs/04-技术架构/总体架构.md");

// 2. 提取组件（通过章节标题或列表）
const components = extractComponents(archDoc);
// 示例：["Provider 适配框架", "Skills 管理", "MCP 管理", "模块系统", "本地存储"]

// 3. 分层（数据面 vs 控制面，或 前端 vs 后端）
const layers = {
  frontend: ["AI 工作台", "系统设置"],
  backend: ["Provider 适配框架", "Skills 管理", "MCP 管理"],
  system: ["模块系统", "本地存储", "权限管理"]
};

// 4. 生成 SVG
function renderProductArchitectureSvg() {
  const width = 960;
  const height = 520;
  
  // 布局：将组件分配到网格位置
  const positions = layoutComponents(layers, width, height);
  
  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${项目名} 产品全景">
      ${renderDefs()}
      ${renderBackground(width, height)}
      ${renderTitle("产品全景", "系统核心组件和数据流关系")}
      ${renderLayers(layers, positions)}
      ${renderConnections(positions)}
      ${renderLegend()}
    </svg>
  `;
}
```

**关键要素**：
- 矩形卡片：`<rect>` + `<text>`
- 箭头连接：`<path>` + `marker-end`
- 分层背景：大矩形框区分不同层次
- 颜色：数据面用青色，控制面用蓝色

---

## 2. 调用闭环图（Core Flow）

**目的**：展示核心业务流程的完整链路

**从哪里提取信息**：
- 读取 `docs/04-技术架构/服务与领域边界.md`
- 或从架构文档中提取"核心流程"章节

**生成步骤**：

```javascript
// 1. 识别核心流程步骤
const coreFlow = [
  { name: "用户发起", component: "前端界面" },
  { name: "请求处理", component: "HTTP 服务" },
  { name: "Provider 调用", component: "Provider 适配框架" },
  { name: "结果返回", component: "响应" }
];

// 2. 生成横向流程图
function renderCoreFlowSvg() {
  return `
    <svg viewBox="0 0 960 280" role="img" aria-label="${项目名} 调用闭环">
      ${renderDefs()}
      ${renderBackground(960, 280)}
      ${renderTitle("核心调用闭环", "从用户请求到响应的完整链路")}
      
      <!-- 步骤卡片 -->
      <g>
        ${coreFlow.map((step, i) => `
          <rect x="${100 + i * 200}" y="120" width="160" height="80" rx="8" 
                fill="${getStepColor(i)}" stroke="${getStepBorder(i)}"></rect>
          <text x="${180 + i * 200}" y="150" text-anchor="middle" 
                font-size="14" font-weight="700">${step.name}</text>
          <text x="${180 + i * 200}" y="175" text-anchor="middle" 
                font-size="11" fill="#69707a">${step.component}</text>
        `).join('')}
      </g>
      
      <!-- 箭头连接 -->
      <g stroke="#69707a" stroke-width="2" marker-end="url(#arrow-main)">
        ${coreFlow.slice(0, -1).map((step, i) => `
          <path d="M${260 + i * 200} 160 H${300 + i * 200}"></path>
        `).join('')}
      </g>
    </svg>
  `;
}
```

---

## 3. 版本路线图（Version Roadmap）

**目的**：展示版本演进关系

**从哪里提取信息**：
- 已有数据：`FEATURE_TIMELINE_VERSIONS` 数组
- 读取 `docs/02-产品与版本/版本路线图.md`

**生成步骤**：

```javascript
// 使用现成的版本数据
const versions = FEATURE_TIMELINE_VERSIONS;

function renderVersionRoadmapSvg() {
  return `
    <svg viewBox="0 0 960 540" role="img" aria-label="${项目名} 版本路线图">
      ${renderDefs()}
      ${renderBackground(960, 540)}
      ${renderTitle("版本路线图", "各版本的范围边界和依赖关系")}
      
      <!-- V1 当前版本 -->
      <rect x="100" y="120" width="200" height="100" rx="8" 
            fill="#dcefeb" stroke="#087d75" stroke-width="2"></rect>
      <text x="200" y="155" text-anchor="middle" font-size="16" font-weight="760" 
            fill="#087d75">V1</text>
      <text x="200" y="180" text-anchor="middle" font-size="12" fill="#69707a">
        ${versions.find(v => v.kind === 'current')?.label || 'V1'}
      </text>
      
      <!-- V2-V8 规划版本 -->
      ${versions.filter(v => v.kind === 'planned').map((v, i) => `
        <rect x="${100 + (i % 3) * 240}" y="${260 + Math.floor(i / 3) * 140}" 
              width="200" height="100" rx="8" 
              fill="#e1f0e8" stroke="#2f7d4f"></rect>
        <text x="${200 + (i % 3) * 240}" y="${295 + Math.floor(i / 3) * 140}" 
              text-anchor="middle" font-size="14" font-weight="760">${v.label}</text>
      `).join('')}
      
      <!-- 依赖箭头 -->
      <g stroke="#69707a" stroke-width="1.5" marker-end="url(#arrow)">
        <path d="M200 220 V260"></path>
        <!-- 更多依赖关系 -->
      </g>
    </svg>
  `;
}
```

---

## 4. 数据域关系图（Data Domain）

**目的**：展示关键数据表和关系

**从哪里提取信息**：
- 读取 `docs/04-技术架构/V1-数据模型.md`
- 提取表名和关系

**生成步骤**：

```javascript
// 1. 提取数据表
const dataModels = extractDataModels("docs/04-技术架构/V1-数据模型.md");
// 示例：
// [
//   { name: "users", domain: "用户域", tables: ["users", "user_sessions"] },
//   { name: "providers", domain: "Provider 域", tables: ["provider_configs"] },
//   ...
// ]

// 2. 生成关系图
function renderDataDomainSvg() {
  return `
    <svg viewBox="0 0 960 380" role="img" aria-label="${项目名} 数据域关系">
      ${renderDefs()}
      ${renderBackground(960, 380)}
      ${renderTitle("关键数据域", "核心数据表和关系")}
      
      <!-- 数据域卡片 -->
      <g>
        ${dataModels.map((domain, i) => `
          <rect x="${100 + i * 220}" y="120" width="180" height="80" rx="8"
                fill="${getDomainColor(domain)}" stroke="${getDomainBorder(domain)}"></rect>
          <text x="${190 + i * 220}" y="150" text-anchor="middle" 
                font-size="14" font-weight="700">${domain.name}</text>
          <text x="${190 + i * 220}" y="175" text-anchor="middle" 
                font-size="11" fill="#69707a">${domain.tables.join(' / ')}</text>
        `).join('')}
      </g>
      
      <!-- 关系箭头 -->
      <g stroke="#69707a" stroke-width="1.4" marker-end="url(#arrow)">
        <!-- 根据外键关系自动生成 -->
      </g>
    </svg>
  `;
}
```

---

## 5. 风险热区图（Risk Heatmap）

**目的**：展示项目风险点

**从哪里提取信息**：
- 读取 `docs/06-决策记录/V1-冻结决策.md`
- 或从功能规格中标记为"高风险"的功能

**生成步骤**：

```javascript
// 1. 提取风险点
const risks = [
  { name: "计费一致性", level: "high", area: "用量/余额/结算" },
  { name: "权限边界", level: "high", area: "用户/Key/角色" },
  { name: "数据同步", level: "medium", area: "本地/远程" },
  { name: "协议兼容", level: "low", area: "Provider 适配" }
];

// 2. 生成热力图
function renderRiskHeatmapSvg() {
  return `
    <svg viewBox="0 0 960 340" role="img" aria-label="${项目名} 风险热区">
      ${renderDefs()}
      ${renderBackground(960, 340)}
      ${renderTitle("风险热区", "需要重点关注的领域")}
      
      <g>
        ${risks.map((risk, i) => `
          <rect x="${70 + (i % 4) * 212}" y="${92 + Math.floor(i / 4) * 120}" 
                width="170" height="78" rx="8"
                fill="${getRiskColor(risk.level)}" 
                stroke="${getRiskBorder(risk.level)}"></rect>
          <text x="${155 + (i % 4) * 212}" y="${122 + Math.floor(i / 4) * 120}" 
                text-anchor="middle" font-size="15" font-weight="760">${risk.name}</text>
          <text x="${155 + (i % 4) * 212}" y="${146 + Math.floor(i / 4) * 120}" 
                text-anchor="middle" font-size="12" fill="#69707a">${risk.area}</text>
        `).join('')}
      </g>
    </svg>
  `;
}
```

---

## 辅助函数

```javascript
// 通用定义（箭头、阴影）
function renderDefs() {
  return `
    <defs>
      <marker id="arrow-main" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
        <path d="M0,0 L9,3 L0,6 Z" fill="#69707a"></path>
      </marker>
      <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#1d1f22" flood-opacity="0.08"></feDropShadow>
      </filter>
    </defs>
  `;
}

// 背景
function renderBackground(width, height) {
  return `<rect width="${width}" height="${height}" rx="8" fill="#fbfaf7"></rect>`;
}

// 标题
function renderTitle(title, subtitle) {
  return `
    <text x="36" y="38" font-size="18" font-weight="760" fill="#1d1f22">${title}</text>
    <text x="36" y="62" font-size="12" fill="#69707a">${subtitle}</text>
  `;
}

// 颜色映射
const COLORS = {
  provider: { fill: "#dcefeb", stroke: "#087d75" },
  skills: { fill: "#e6e9f6", stroke: "#4056a1" },
  mcp: { fill: "#e1f0e8", stroke: "#2f7d4f" },
  module: { fill: "#f6ead6", stroke: "#a96810" },
  design: { fill: "#f4dde4", stroke: "#aa2d4d" },
  identity: { fill: "#dcefeb", stroke: "#087d75" },
  storage: { fill: "#e6e9f6", stroke: "#4056a1" },
  default: { fill: "#ffffff", stroke: "#dedbd2" }
};

// 风险颜色
const RISK_COLORS = {
  high: { fill: "#f4dde4", stroke: "#aa2d4d" },
  medium: { fill: "#f6ead6", stroke: "#a96810" },
  low: { fill: "#e1f0e8", stroke: "#2f7d4f" }
};
```

---

## Agent 生成流程

**第一步：读取架构文档**
```bash
read docs/04-技术架构/总体架构.md
read docs/04-技术架构/V1-数据模型.md
read docs/04-技术架构/服务与领域边界.md
```

**第二步：提取关键信息**
- 组件列表（从章节标题或列表）
- 数据表（从数据模型文档）
- 核心流程（从架构描述）
- 风险点（从高风险功能或决策）

**第三步：生成 5 个 SVG 函数**
- 根据提取的信息填充模板
- 自动布局组件位置
- 生成连接线

**第四步：插入到浏览器模板**
- 替换模板中的 5 个 `render*Svg()` 函数
- 确保函数名匹配：`renderProductArchitectureSvg`、`renderCoreFlowSvg` 等

---

## 简化方案

如果项目架构文档不完整，可以：

1. **使用通用默认图**：展示通用的前端-后端-数据库架构
2. **只生成版本路线图**：这个可以从 FEATURE_TIMELINE_VERSIONS 直接生成
3. **显示提示信息**：`"图谱需要完善架构文档后生成"`

---

## 关键点

✅ **SVG 不是魔法**：
- 就是矩形 + 文本 + 连接线
- 布局是网格（100, 120, 140 等固定位置）
- 颜色有规律（用 COLORS 映射）

✅ **Agent 完全可以生成**：
- 读取架构文档 → 提取组件/流程/数据
- 使用模板 → 填充位置和文本
- 组装 SVG 代码

✅ **不需要完美**：
- TUZAI 的图是手工调整的
- Agent 生成的可能布局不完美
- 但功能完整，信息准确就够了
