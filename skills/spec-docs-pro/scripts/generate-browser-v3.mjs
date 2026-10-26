#!/usr/bin/env node

/**
 * 文档浏览器生成器 - 增强版 v2.0
 * 新增功能：
 * - 动态生成版本演进图谱（SVG）
 * - 动态生成数据域关系图
 * - 动态生成功能演进矩阵可视化
 * - 动态生成风险热区图
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_ROOT = path.join(process.cwd(), 'docs');
const OUTPUT_HTML = path.join(DOCS_ROOT, '90-参考资料/产品文档浏览器.html');
const OUTPUT_DATA = path.join(DOCS_ROOT, '90-参考资料/产品文档浏览器-文档数据.js');
const TEMPLATE_PATH = path.join(__dirname, '../templates/browser-template-full.html');

/**
 * 扫描目录下所有 markdown 文件
 */
function scanDocs(dir, baseDir = dir) {
  const results = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (item.isDirectory()) {
      results.push(...scanDocs(fullPath, baseDir));
    } else if (item.isFile() && item.name.endsWith('.md')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const titleMatch = content.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : item.name.replace('.md', '');
      
      results.push({
        path: relativePath,
        title: title,
        content: content
      });
    }
  }

  return results;
}

/**
 * 从版本路线图中提取版本信息
 */
function extractVersions(docs) {
  const versionDoc = docs.find(d => 
    d.path.includes('版本路线图') || 
    d.path.includes('版本总览') ||
    d.title.includes('版本路线图')
  );
  
  if (!versionDoc) return [];

  const versions = [];
  const lines = versionDoc.content.split('\n');
  const versionRegex = /^##\s+(V\d+)[\s:：](.+)/;
  
  for (const line of lines) {
    const match = line.match(versionRegex);
    if (match) {
      versions.push({
        id: match[1],
        name: match[2].trim()
      });
    }
  }

  return versions;
}

/**
 * 从功能规格中提取功能列表
 */
function extractFeatures(docs) {
  const features = [];
  const featureDocs = docs.filter(d => 
    d.path.includes('03-功能规格') && 
    !d.path.includes('README') &&
    !d.path.includes('功能开发流程')
  );

  for (const doc of featureDocs) {
    const idMatch = doc.content.match(/(V\d+-FR-\d+)/);
    if (!idMatch) continue;

    const id = idMatch[1];
    let risk = 'standard';
    if (doc.content.includes('高风险') || doc.content.includes('需要独立技术设计')) {
      risk = 'high';
    }

    const versionMatch = id.match(/V(\d+)/);
    const version = versionMatch ? `V${versionMatch[1]}` : 'V1';

    features.push({
      id,
      title: doc.title,
      version,
      risk,
      path: doc.path
    });
  }

  return features;
}

/**
 * 从数据模型文档中提取表关系
 */
function extractDataRelationships(docs) {
  const dataModelDoc = docs.find(d => 
    d.path.includes('数据模型') || 
    d.path.includes('data-model') ||
    d.title.includes('数据模型')
  );
  
  if (!dataModelDoc) return [];
  
  const relationships = [];
  const content = dataModelDoc.content;
  
  // 从 Mermaid ER 图中提取关系
  const mermaidMatch = content.match(/```mermaid\s+erDiagram([\s\S]*?)```/);
  if (mermaidMatch) {
    const mermaidContent = mermaidMatch[1];
    const relationRegex = /(\w+)\s+([\|\}o]{2}--[\|\{o]{2})\s+(\w+)\s*:\s*(\w+)/g;
    let match;
    while ((match = relationRegex.exec(mermaidContent)) !== null) {
      relationships.push({
        from: match[1],
        to: match[3],
        type: match[2],
        label: match[4]
      });
    }
  }
  
  return relationships;
}

/**
 * 从功能演进矩阵中提取演进数据
 */
function extractFeatureEvolution(docs) {
  const evolutionDoc = docs.find(d => 
    d.path.includes('功能演进') || 
    d.title.includes('功能演进')
  );
  
  if (!evolutionDoc) return [];
  
  const evolutions = [];
  const content = evolutionDoc.content;
  const lines = content.split('\n');
  
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line.startsWith('|') && line.includes('能力主线') && lines[i + 1]?.includes('---')) {
      inTable = true;
      i++;
      continue;
    }
    
    if (inTable && line.startsWith('|')) {
      if (line.includes('---')) continue;
      
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 4) {
        evolutions.push({
          capability: cells[0],
          v1: cells[1] || '',
          v2: cells[2] || '',
          v3: cells[3] || ''
        });
      }
    }
    
    if (inTable && !line.startsWith('|')) {
      break;
    }
  }
  
  return evolutions;
}

/**
 * 生成版本演进 SVG
 */
function generateVersionTimelineSVG(versions, features) {
  if (versions.length === 0) return '';

  const width = 900;
  const height = 200 + versions.length * 80;
  const boxWidth = 160;
  const boxHeight = 60;
  const gap = 40;
  const startX = 50;
  const startY = 100;

  let svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <text x="${width / 2}" y="40" text-anchor="middle" style="font-size: 18px; font-weight: 700;">版本演进路线图</text>
  <text x="${width / 2}" y="65" text-anchor="middle" style="font-size: 12px; fill: #69707a;">按时间顺序展示产品版本规划</text>
`;

  const lineX = startX + boxWidth / 2;
  svg += `<line x1="${lineX}" y1="${startY}" x2="${lineX}" y2="${startY + (versions.length - 1) * (boxHeight + gap)}" stroke="#c6c1b5" stroke-width="2" />`;

  versions.forEach((version, index) => {
    const y = startY + index * (boxHeight + gap);
    svg += `<rect x="${startX}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="8" fill="#e6e9f6" stroke="#4056a1" stroke-width="2" />`;
    svg += `<text x="${startX + boxWidth / 2}" y="${y + 28}" text-anchor="middle" style="font-size: 14px; font-weight: 600;">${version.id} ${version.name}</text>`;
    
    const versionFeatures = features.filter(f => f.version === version.id);
    svg += `<text x="${startX + boxWidth / 2}" y="${y + 48}" text-anchor="middle" style="font-size: 11px; fill: #69707a;">${versionFeatures.length} 个功能</text>`;
    
    if (index < versions.length - 1) {
      const arrowY = y + boxHeight + gap / 2;
      svg += `<polygon points="${lineX},${arrowY - 5} ${lineX - 5},${arrowY - 12} ${lineX + 5},${arrowY - 12}" fill="#4056a1" />`;
    }
  });

  svg += '</svg>';
  return svg;
}

/**
 * 生成风险热区图 SVG
 */
function generateRiskHeatmapSVG(features) {
  if (features.length === 0) return '';

  const highRisk = features.filter(f => f.risk === 'high').length;
  const standard = features.filter(f => f.risk === 'standard').length;

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300">
  <text x="300" y="30" text-anchor="middle" style="font-size: 18px; font-weight: 700;">功能风险分布</text>
  
  <rect x="100" y="80" width="180" height="140" rx="8" fill="#f4dde4" stroke="#aa2d4d" stroke-width="2" />
  <text x="190" y="110" text-anchor="middle" style="font-size: 14px; font-weight: 600;">高风险功能</text>
  <text x="190" y="150" text-anchor="middle" style="font-size: 24px; font-weight: 700; fill: #aa2d4d;">${highRisk}</text>
  
  <rect x="320" y="80" width="180" height="140" rx="8" fill="#e1f0e8" stroke="#2f7d4f" stroke-width="2" />
  <text x="410" y="110" text-anchor="middle" style="font-size: 14px; font-weight: 600;">标准功能</text>
  <text x="410" y="150" text-anchor="middle" style="font-size: 24px; font-weight: 700; fill: #2f7d4f;">${standard}</text>
  
  <text x="300" y="260" text-anchor="middle" style="font-size: 11px; fill: #69707a;">高风险占比：${((highRisk / features.length) * 100).toFixed(1)}%</text>
</svg>`;
}

/**
 * 生成数据域关系图 SVG
 */
function generateDataRelationshipSVG(relationships) {
  if (relationships.length === 0) return '';
  
  const tables = new Set();
  relationships.forEach(rel => {
    tables.add(rel.from);
    tables.add(rel.to);
  });
  
  const tableArray = Array.from(tables);
  const cols = Math.ceil(Math.sqrt(tableArray.length));
  const boxWidth = 120;
  const boxHeight = 50;
  const gapX = 40;
  const gapY = 60;
  const startX = 50;
  const startY = 80;
  
  const width = startX * 2 + cols * boxWidth + (cols - 1) * gapX;
  const height = startY + Math.ceil(tableArray.length / cols) * (boxHeight + gapY) + 50;
  
  const tablePositions = {};
  tableArray.forEach((table, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    tablePositions[table] = {
      x: startX + col * (boxWidth + gapX),
      y: startY + row * (boxHeight + gapY),
      cx: startX + col * (boxWidth + gapX) + boxWidth / 2,
      cy: startY + row * (boxHeight + gapY) + boxHeight / 2
    };
  });
  
  let svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <text x="${width / 2}" y="40" text-anchor="middle" style="font-size: 18px; font-weight: 700;">数据域关系图</text>
  <text x="${width / 2}" y="60" text-anchor="middle" style="font-size: 12px; fill: #69707a;">从数据模型文档自动生成</text>
`;
  
  relationships.forEach(rel => {
    const from = tablePositions[rel.from];
    const to = tablePositions[rel.to];
    if (from && to) {
      svg += `<line x1="${from.cx}" y1="${from.cy}" x2="${to.cx}" y2="${to.cy}" stroke="#69707a" stroke-width="1.5" />`;
    }
  });
  
  tableArray.forEach(table => {
    const pos = tablePositions[table];
    svg += `<rect x="${pos.x}" y="${pos.y}" width="${boxWidth}" height="${boxHeight}" rx="6" fill="#e6e9f6" stroke="#4056a1" stroke-width="2" />`;
    svg += `<text x="${pos.cx}" y="${pos.cy + 5}" text-anchor="middle" style="font-family: monospace; font-size: 12px; font-weight: 600;">${table.toLowerCase()}</text>`;
  });
  
  svg += '</svg>';
  return svg;
}

/**
 * 生成功能演进矩阵 SVG
 */
function generateFeatureEvolutionSVG(evolutions) {
  if (evolutions.length === 0) return '';
  
  const width = 800;
  const rowHeight = 50;
  const headerHeight = 80;
  const height = headerHeight + Math.min(evolutions.length, 10) * rowHeight + 50;
  
  let svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <text x="${width / 2}" y="30" text-anchor="middle" style="font-size: 18px; font-weight: 700;">功能演进矩阵</text>
  <text x="${width / 2}" y="50" text-anchor="middle" style="font-size: 12px; fill: #69707a;">从功能演进矩阵文档自动生成（前10项）</text>
`;
  
  const colWidths = [200, 180, 180, 180];
  const colHeaders = ['能力主线', 'V1', 'V2', 'V3'];
  
  svg += `<rect x="20" y="${headerHeight}" width="${colWidths.reduce((a, b) => a + b)}" height="40" fill="#4056a1" />`;
  
  let colX = 20;
  colHeaders.forEach((header, i) => {
    svg += `<text x="${colX + colWidths[i] / 2}" y="${headerHeight + 25}" text-anchor="middle" style="font-size: 14px; font-weight: 600; fill: #ffffff;">${header}</text>`;
    colX += colWidths[i];
  });
  
  evolutions.slice(0, 10).forEach((evo, rowIndex) => {
    const y = headerHeight + 40 + rowIndex * rowHeight;
    const bgColor = rowIndex % 2 === 0 ? '#ffffff' : '#f9fafb';
    
    svg += `<rect x="20" y="${y}" width="${colWidths.reduce((a, b) => a + b)}" height="${rowHeight}" fill="${bgColor}" />`;
    
    const cells = [evo.capability, evo.v1, evo.v2, evo.v3];
    colX = 20;
    cells.forEach((cell, i) => {
      const text = cell.length > 20 ? cell.substring(0, 20) + '...' : cell;
      svg += `<text x="${colX + 10}" y="${y + rowHeight / 2 + 4}" style="font-size: 11px;">${text}</text>`;
      colX += colWidths[i];
    });
  });
  
  svg += '</svg>';
  return svg;
}

/**
 * 生成数据文件
 */
function generateDataFile(docs) {
  const docData = {};
  for (const doc of docs) {
    const key = doc.path.replace(/\.md$/, '').replace(/\\/g, '/');
    docData[key] = doc.content;
  }

  return `// 生成时间: ${new Date().toISOString()}
// 文档数量: ${docs.length}

window.TUZAI_DOC_BROWSER_DATA = Object.freeze(${JSON.stringify(docData, null, 2)});
`;
}

/**
 * 生成 HTML 文件
 */
function generateHTML(docs, projectName, charts) {
  let template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  
  template = template.replace(/TUZAI/g, projectName);
  template = template.replace(/PRD Viewer/g, `${projectName}浏览器`);
  
  // 插入图表（如果模板中有占位符）
  if (charts.versionTimeline && template.includes('<!-- VERSION_TIMELINE_PLACEHOLDER -->')) {
    template = template.replace('<!-- VERSION_TIMELINE_PLACEHOLDER -->', charts.versionTimeline);
  }
  if (charts.riskHeatmap && template.includes('<!-- RISK_HEATMAP_PLACEHOLDER -->')) {
    template = template.replace('<!-- RISK_HEATMAP_PLACEHOLDER -->', charts.riskHeatmap);
  }
  if (charts.dataRelationships && template.includes('<!-- DATA_RELATIONSHIP_PLACEHOLDER -->')) {
    template = template.replace('<!-- DATA_RELATIONSHIP_PLACEHOLDER -->', charts.dataRelationships);
  }
  if (charts.featureEvolution && template.includes('<!-- FEATURE_EVOLUTION_PLACEHOLDER -->')) {
    template = template.replace('<!-- FEATURE_EVOLUTION_PLACEHOLDER -->', charts.featureEvolution);
  }
  
  const docsArray = docs.map((doc, index) => {
    const parts = doc.path.split(path.sep);
    const dirName = parts[0] || '其他';
    
    const colors = {
      '01-项目概览': { accent: '#087d75', soft: '#dcefeb' },
      '02-产品与版本': { accent: '#4056a1', soft: '#e6e9f6' },
      '03-功能规格': { accent: '#2f7d4f', soft: '#e1f0e8' },
      '04-技术架构': { accent: '#a96810', soft: '#f6ead6' },
      '05-测试与发布': { accent: '#aa2d4d', soft: '#f4dde4' },
      '06-决策记录': { accent: '#7c3aed', soft: '#ede9fe' }
    };
    
    const color = colors[dirName] || { accent: '#69707a', soft: '#f1eee7' };
    
    return {
      id: `doc-${index}`,
      phase: dirName.replace(/^\d+-/, ''),
      accent: color.accent,
      soft: color.soft,
      title: doc.title,
      file: doc.path.replace(/\\/g, '/')
    };
  });

  template = template.replace(
    /const DOCS = \[[\s\S]*?\];/,
    `const DOCS = ${JSON.stringify(docsArray, null, 2)};`
  );

  return template;
}

/**
 * 主函数
 */
function main() {
  console.log('🚀 开始生成文档浏览器（增强版 v2.0）...\n');

  if (!fs.existsSync(DOCS_ROOT)) {
    console.error('❌ 错误：docs/ 目录不存在');
    process.exit(1);
  }

  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error('❌ 错误：浏览器模板不存在');
    process.exit(1);
  }

  console.log('📂 扫描文档...');
  const docs = scanDocs(DOCS_ROOT);
  console.log(`   找到 ${docs.length} 个文档\n`);

  if (docs.length === 0) {
    console.warn('⚠️  警告：未找到任何 markdown 文档');
    process.exit(0);
  }

  console.log('🔍 分析版本演进...');
  const versions = extractVersions(docs);
  console.log(`   找到 ${versions.length} 个版本\n`);

  console.log('📊 提取功能列表...');
  const features = extractFeatures(docs);
  console.log(`   找到 ${features.length} 个功能`);
  console.log(`   - 高风险：${features.filter(f => f.risk === 'high').length} 个`);
  console.log(`   - 标准：${features.filter(f => f.risk === 'standard').length} 个\n`);

  console.log('🔗 提取数据关系...');
  const dataRelationships = extractDataRelationships(docs);
  console.log(`   找到 ${dataRelationships.length} 个表关系\n`);

  console.log('📈 提取功能演进...');
  const featureEvolution = extractFeatureEvolution(docs);
  console.log(`   找到 ${featureEvolution.length} 个能力演进\n`);

  console.log('🎨 生成图表...');
  const charts = {
    versionTimeline: generateVersionTimelineSVG(versions, features),
    riskHeatmap: generateRiskHeatmapSVG(features),
    dataRelationships: generateDataRelationshipSVG(dataRelationships),
    featureEvolution: generateFeatureEvolutionSVG(featureEvolution)
  };
  console.log('   ✅ 图表生成完成\n');

  const outputDir = path.dirname(OUTPUT_HTML);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('📝 生成数据文件...');
  const dataContent = generateDataFile(docs);
  fs.writeFileSync(OUTPUT_DATA, dataContent, 'utf-8');
  console.log(`   ✅ ${OUTPUT_DATA}\n`);

  console.log('🎨 生成 HTML 浏览器...');
  const htmlContent = generateHTML(docs, '产品文档', charts);
  fs.writeFileSync(OUTPUT_HTML, htmlContent, 'utf-8');
  console.log(`   ✅ ${OUTPUT_HTML}\n`);

  const htmlSize = (fs.statSync(OUTPUT_HTML).size / 1024).toFixed(1);
  const dataSize = (fs.statSync(OUTPUT_DATA).size / 1024).toFixed(1);
  
  console.log('✨ 生成完成！\n');
  console.log('📊 统计信息：');
  console.log(`   - 文档数量：${docs.length} 个`);
  console.log(`   - 版本数量：${versions.length} 个`);
  console.log(`   - 功能数量：${features.length} 个`);
  console.log(`   - 表关系：${dataRelationships.length} 个`);
  console.log(`   - 能力演进：${featureEvolution.length} 个`);
  console.log(`   - HTML 大小：${htmlSize} KB`);
  console.log(`   - 数据大小：${dataSize} KB`);
  console.log('\n💡 打开浏览器访问：');
  console.log(`   file://${OUTPUT_HTML}\n`);
}

main();
