# 文档浏览器生成后验证指南

生成浏览器后，**必须进行完整的功能验证**，确保所有功能可用。

## 🎯 验证策略

### 方案 A：使用浏览器自动化（推荐）

使用 `browser` 工具打开浏览器并验证功能。

### 方案 B：静态检查 + 手工验证

检查代码和数据，然后请用户手工验证。

---

## ✅ 完整验证清单

### 第一阶段：文件完整性检查

**验证文件存在**：
```bash
ls -lh docs/90-参考资料/产品文档浏览器.html
ls -lh docs/90-参考资料/产品文档浏览器-文档数据.js
```

**检查文件大小**：
- HTML 文件：应该在 100-120KB 左右
- 数据文件：根据项目大小，通常 500KB-1MB

---

### 第二阶段：数据结构验证

#### 1. 检查 HTML 中的 4 个数据

```bash
# 检查 DOCS 数组
grep -n "const DOCS = \[" docs/90-参考资料/产品文档浏览器.html

# 检查 DECISIONS 数组
grep -n "const DECISIONS = \[" docs/90-参考资料/产品文档浏览器.html

# 检查 FEATURE_TRACKS 对象
grep -n "const FEATURE_TRACKS = {" docs/90-参考资料/产品文档浏览器.html

# 检查 FEATURE_TIMELINE_VERSIONS 数组
grep -n "const FEATURE_TIMELINE_VERSIONS = \[" docs/90-参考资料/产品文档浏览器.html
```

**验证要点**：
```javascript
// 读取并验证
const html = read("docs/90-参考资料/产品文档浏览器.html");

// 1. DOCS 数组检查
// - 必须包含 evolution 项
// - 至少 10+ 个文档
const docsMatch = html.match(/const DOCS = \[([\s\S]*?)\];/);
if (!docsMatch || !docsMatch[0].includes('"evolution"')) {
  console.error("❌ DOCS 数组缺少 evolution 项");
}

// 2. DECISIONS 格式检查
// - 必须是 {accent, text} 格式
// - 不能是 {id, title, category}
const decisionsMatch = html.match(/const DECISIONS = \[([\s\S]*?)\];/);
if (decisionsMatch && decisionsMatch[0].includes('"id":') || decisionsMatch[0].includes('"category":')) {
  console.error("❌ DECISIONS 格式错误，应该是 {accent, text}");
}
if (!decisionsMatch || !decisionsMatch[0].includes('"accent":') || !decisionsMatch[0].includes('"text":')) {
  console.error("❌ DECISIONS 缺少必需字段 accent 或 text");
}

// 3. FEATURE_TRACKS 检查
// - 必须有至少 3 个能力主线
const tracksMatch = html.match(/const FEATURE_TRACKS = \{([\s\S]*?)\};/);
if (!tracksMatch) {
  console.error("❌ 缺少 FEATURE_TRACKS");
}

// 4. 项目名称检查
// - 不能是 TUZAI（除非项目真的叫 TUZAI）
if (html.includes('window.TUZAI_') && 项目名 !== 'TUZAI') {
  console.error("❌ 项目名称未替换，仍然是 TUZAI");
}
```

#### 2. 检查数据文件中的 2 个数据

```bash
# 检查文档内容数据
grep -n "window\..*_DOC_BROWSER_DATA" docs/90-参考资料/产品文档浏览器-文档数据.js

# 检查功能数据
grep -n "window\..*_FEATURE_BROWSER_DATA" docs/90-参考资料/产品文档浏览器-文档数据.js
```

**验证要点**：
```javascript
const dataFile = read("docs/90-参考资料/产品文档浏览器-文档数据.js");

// 1. 检查变量名
if (!dataFile.includes(`window.${项目名}_DOC_BROWSER_DATA`)) {
  console.error(`❌ 数据文件缺少 window.${项目名}_DOC_BROWSER_DATA`);
}
if (!dataFile.includes(`window.${项目名}_FEATURE_BROWSER_DATA`)) {
  console.error(`❌ 数据文件缺少 window.${项目名}_FEATURE_BROWSER_DATA`);
}

// 2. 检查 Object.freeze
if (!dataFile.includes('Object.freeze')) {
  console.warn("⚠️ 数据未使用 Object.freeze 冻结");
}

// 3. 检查功能数据不为空
const featureMatch = dataFile.match(/FEATURE_BROWSER_DATA = Object\.freeze\(\[([\s\S]*?)\]\)/);
if (!featureMatch || featureMatch[1].trim() === '') {
  console.error("❌ FEATURE_BROWSER_DATA 为空");
}
```

---

### 第三阶段：浏览器功能验证

使用 `browser` 工具打开并验证：

```javascript
// 打开浏览器
const tab = await browser.open({
  url: `file://${绝对路径}/docs/90-参考资料/产品文档浏览器.html`,
  relay: true  // 使用用户的 Chrome
});

// 等待加载
await tab.wait(2000);

// 验证清单
const results = {
  overview: false,
  map: false,
  evolution: false,
  timeline: false,
  decisions: false,
  docs: false,
  features: false
};

// 1. 检查加载状态
const loadStatus = await tab.run(() => {
  const status = document.getElementById('loadStatus')?.textContent;
  return status;
});

console.log(`📊 加载状态：${loadStatus}`);
if (loadStatus.includes('失败')) {
  console.error('❌ 浏览器加载失败');
  return results;
}

// 2. 验证总览视图
console.log('\n🔍 验证总览视图...');
await tab.click('[data-view="overview"]');
await tab.wait(500);

const overviewCheck = await tab.run(() => {
  // 检查统计卡片
  const stats = document.querySelectorAll('.stats .stat-block');
  if (stats.length < 4) return '缺少统计卡片';
  
  // 检查右侧决策
  const decisions = document.querySelectorAll('.side-decisions li');
  if (decisions.length === 0) return '右侧决策为空';
  if (decisions[0]?.textContent === 'undefined') return '决策显示 undefined';
  
  // 检查版本链路
  const versionButtons = document.querySelectorAll('[data-doc^="v"]');
  if (versionButtons.length === 0) return '缺少版本链路';
  
  return 'ok';
});

if (overviewCheck === 'ok') {
  console.log('✅ 总览视图正常');
  results.overview = true;
} else {
  console.error(`❌ 总览视图异常：${overviewCheck}`);
}

// 3. 验证图谱视图
console.log('\n🔍 验证图谱视图...');
await tab.click('[data-view="map"]');
await tab.wait(500);

const mapCheck = await tab.run(() => {
  const svgs = document.querySelectorAll('.map-stack svg');
  if (svgs.length < 5) return `只有 ${svgs.length} 个图表，应该有 5 个`;
  
  // 检查是否包含项目名称（不是 TUZAI）
  const mapContent = document.querySelector('.map-stack')?.textContent || '';
  if (mapContent.includes('TUZAI') && !mapContent.includes('${项目名}')) {
    return '图谱仍然显示 TUZAI 数据';
  }
  
  return 'ok';
});

if (mapCheck === 'ok') {
  console.log('✅ 图谱视图正常（5 个 SVG 图表）');
  results.map = true;
} else {
  console.error(`❌ 图谱视图异常：${mapCheck}`);
}

// 4. 验证功能演进视图
console.log('\n🔍 验证功能演进视图...');
await tab.click('[data-view="evolution"]');
await tab.wait(500);

const evolutionCheck = await tab.run(() => {
  const article = document.querySelector('.article');
  if (!article) return '缺少文章内容';
  if (article.textContent.length < 100) return '内容太短';
  
  // 检查是否有表格（演进矩阵应该有表格）
  const tables = article.querySelectorAll('table');
  if (tables.length === 0) return '缺少演进表格';
  
  return 'ok';
});

if (evolutionCheck === 'ok') {
  console.log('✅ 功能演进视图正常');
  results.evolution = true;
} else {
  console.error(`❌ 功能演进视图异常：${evolutionCheck}`);
}

// 5. 验证时间线视图（关键）
console.log('\n🔍 验证时间线视图...');
await tab.click('[data-view="feature-timeline"]');
await tab.wait(500);

const timelineCheck = await tab.run(() => {
  // 检查功能选择器
  const featureSelect = document.querySelector('.feature-selector select');
  if (!featureSelect) return '缺少功能选择器';
  
  const options = featureSelect.querySelectorAll('option');
  if (options.length < 2) return `只有 ${options.length} 个功能，应该至少有 10 个`;
  
  // 检查功能摘要
  const summary = document.querySelector('.feature-summary');
  if (!summary) return '缺少功能摘要';
  if (summary.textContent.includes('undefined')) return '功能摘要包含 undefined';
  
  // 检查里程碑
  const milestones = document.querySelectorAll('.feature-milestone');
  if (milestones.length === 0) return '缺少里程碑';
  
  // 检查是否显示"未分配阶段"
  const emptyStages = document.querySelectorAll('.empty-stage');
  const totalMilestones = milestones.length;
  const emptyCount = emptyStages.length;
  
  if (emptyCount > totalMilestones * 0.7) {
    return `太多"未分配阶段"（${emptyCount}/${totalMilestones}），可能数据提取失败`;
  }
  
  // 检查 V1 里程碑
  const v1Milestone = Array.from(milestones).find(m => 
    m.textContent.includes('V1') && m.classList.contains('current')
  );
  if (!v1Milestone) return '缺少 V1 当前版本里程碑';
  
  return 'ok';
});

if (timelineCheck === 'ok') {
  console.log('✅ 时间线视图正常');
  results.timeline = true;
} else {
  console.error(`❌ 时间线视图异常：${timelineCheck}`);
}

// 6. 验证文档列表
console.log('\n🔍 验证文档列表...');
const docsCheck = await tab.run(() => {
  const docButtons = document.querySelectorAll('.doc-list button');
  if (docButtons.length < 10) return `只有 ${docButtons.length} 个文档`;
  return 'ok';
});

if (docsCheck === 'ok') {
  console.log('✅ 文档列表正常');
  results.docs = true;
} else {
  console.error(`❌ 文档列表异常：${docsCheck}`);
}

// 7. 测试文档阅读功能
console.log('\n🔍 测试文档阅读...');
await tab.run(() => {
  const firstDoc = document.querySelector('.doc-list button');
  if (firstDoc) firstDoc.click();
});
await tab.wait(500);

const readerCheck = await tab.run(() => {
  const article = document.querySelector('.article');
  if (!article) return '文档内容未加载';
  if (article.textContent.length < 50) return '文档内容太短';
  
  // 检查大纲
  const outline = document.querySelectorAll('.outline-item');
  if (outline.length === 0) return '缺少章节大纲';
  
  return 'ok';
});

if (readerCheck === 'ok') {
  console.log('✅ 文档阅读正常');
} else {
  console.error(`❌ 文档阅读异常：${readerCheck}`);
}

// 关闭浏览器
await tab.close();

// 输出验证报告
console.log('\n' + '='.repeat(60));
console.log('📊 验证报告');
console.log('='.repeat(60));
console.log(`总览视图：${results.overview ? '✅ 通过' : '❌ 失败'}`);
console.log(`图谱视图：${results.map ? '✅ 通过' : '❌ 失败'}`);
console.log(`功能演进：${results.evolution ? '✅ 通过' : '❌ 失败'}`);
console.log(`时间线：${results.timeline ? '✅ 通过' : '❌ 失败'}`);
console.log(`文档列表：${results.docs ? '✅ 通过' : '❌ 失败'}`);
console.log('='.repeat(60));

const allPassed = Object.values(results).every(v => v);
if (allPassed) {
  console.log('🎉 所有功能验证通过！');
} else {
  console.log('⚠️ 部分功能验证失败，请检查上述错误');
}

return results;
```

---

### 第四阶段：演进矩阵格式验证

**时间线视图依赖演进矩阵，必须验证格式**：

```javascript
// 读取演进矩阵文档
const evolutionDoc = read("docs/02-产品与版本/功能演进矩阵.md");

// 检查每个能力主线
const tracks = Object.values(FEATURE_TRACKS);
const issues = [];

tracks.forEach(track => {
  // 检查章节存在
  const sectionRegex = new RegExp(`##\\s+.*${track.title}`, 'm');
  if (!sectionRegex.test(evolutionDoc)) {
    issues.push(`❌ 缺少章节：${track.title}`);
    return;
  }
  
  // 提取章节内容
  const sectionMatch = evolutionDoc.match(
    new RegExp(`##\\s+.*${track.title}[\\s\\S]*?(?=##|$)`, 'm')
  );
  
  if (sectionMatch) {
    const section = sectionMatch[0];
    
    // 检查是否有表格
    if (!section.includes('|')) {
      issues.push(`⚠️ ${track.title} 章节缺少表格`);
    }
    
    // 检查表格列数
    const tableRows = section.match(/^\|.*\|$/gm);
    if (tableRows && tableRows.length > 0) {
      const firstRow = tableRows[0];
      const cols = firstRow.split('|').filter(c => c.trim()).length;
      if (cols < 5) {
        issues.push(`⚠️ ${track.title} 表格列数不足（需要 5 列，实际 ${cols} 列）`);
      }
    }
  }
});

if (issues.length === 0) {
  console.log('✅ 演进矩阵格式正确');
} else {
  console.log('⚠️ 演进矩阵格式问题：');
  issues.forEach(issue => console.log(issue));
}
```

---

## 📋 简化验证流程（如果无法使用浏览器）

如果不能使用 `browser` 工具，进行静态检查：

```bash
# 1. 文件存在性
echo "检查文件..."
ls -lh docs/90-参考资料/产品文档浏览器.html
ls -lh docs/90-参考资料/产品文档浏览器-文档数据.js

# 2. 检查项目名称
echo "检查项目名称..."
grep -c "TUZAI" docs/90-参考资料/产品文档浏览器.html
# 如果结果不是 0，说明还有 TUZAI 残留

# 3. 检查 DECISIONS 格式
echo "检查 DECISIONS 格式..."
grep -A 3 "const DECISIONS = \[" docs/90-参考资料/产品文档浏览器.html | head -10
# 检查是否有 accent 和 text

# 4. 检查功能数据
echo "检查功能数据..."
grep -c "FEATURE_BROWSER_DATA" docs/90-参考资料/产品文档浏览器-文档数据.js
# 结果应该是 1

# 5. 检查 SVG 函数
echo "检查 SVG 函数..."
grep -c "function render.*Svg()" docs/90-参考资料/产品文档浏览器.html
# 结果应该是 5
```

**然后请用户手工验证**：
```
✅ 文件已生成，请在浏览器中打开验证：

file:///.../docs/90-参考资料/产品文档浏览器.html

【验证清单】
□ 总览视图能显示，右侧决策不是 undefined
□ 图谱视图有 5 个图表
□ 功能演进视图能点击查看
□ 时间线视图能选择功能，不是全部"未分配阶段"
□ 文档能正常阅读

如果有问题，请告诉我具体现象。
```

---

## 🎯 验证流程集成到生成过程

**在 instructions.md 或生成指南中添加**：

```markdown
### 第五步：验证生成结果（必须）

生成完成后，**必须验证所有功能**：

1. **运行自动验证**（如果可以使用 browser）
   ```javascript
   // 执行上述浏览器验证代码
   ```

2. **进行静态检查**
   - 检查文件大小
   - 检查数据格式
   - 检查项目名称

3. **生成验证报告**
   - 列出通过的项
   - 列出失败的项
   - 给出修复建议

4. **如果验证失败**
   - 不要直接交付
   - 分析失败原因
   - 修复问题
   - 重新验证

5. **向用户报告**
   - 成功：列出所有通过的功能
   - 失败：说明问题和修复方法
```

---

## 关键点

✅ **必须验证，不能盲目生成**
✅ **优先使用浏览器自动化验证**
✅ **至少要进行静态检查**
✅ **验证失败必须修复，不能交付**
✅ **给用户明确的验证报告**

---

这样 Agent 生成后会自动验证，确保交付的浏览器真正可用！
