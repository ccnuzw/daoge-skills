#!/usr/bin/env node

/**
 * 文档浏览器生成器 - 升级版
 * 使用 TUZAI 样例的精美模板生成交互式 HTML 浏览器
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_ROOT = path.join(process.cwd(), 'docs');
const OUTPUT_HTML = path.join(DOCS_ROOT, '90-参考资料/产品文档浏览器.html');
const OUTPUT_DATA = path.join(DOCS_ROOT, '90-参考资料/产品文档浏览器-文档数据.js');
const TEMPLATE_PATH = path.join(__dirname, '../templates/browser-template.html');

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
      // 递归扫描子目录
      results.push(...scanDocs(fullPath, baseDir));
    } else if (item.isFile() && item.name.endsWith('.md')) {
      // 读取文件内容
      const content = fs.readFileSync(fullPath, 'utf-8');
      
      // 提取标题（第一个 # 标题）
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
 * 构建文档树结构
 */
function buildDocTree(docs) {
  const tree = {};

  for (const doc of docs) {
    const parts = doc.path.split(path.sep);
    let current = tree;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = { __children: {} };
      }
      current = current[part].__children;
    }

    const filename = parts[parts.length - 1];
    current[filename] = doc;
  }

  return tree;
}

/**
 * 生成数据 JS 文件
 */
function generateDataFile(docs) {
  // 创建文档数据对象
  const docData = {};
  
  for (const doc of docs) {
    // 使用路径作为 key（去掉 .md 扩展名）
    const key = doc.path.replace(/\.md$/, '').replace(/\\/g, '/');
    docData[key] = doc.content;
  }

  // 生成 JS 文件
  const jsContent = `// 生成时间: ${new Date().toISOString()}
// 文档数量: ${docs.length}

window.TUZAI_DOC_BROWSER_DATA = Object.freeze(${JSON.stringify(docData, null, 2)});
`;

  return jsContent;
}

/**
 * 生成 HTML 文件
 */
function generateHTML(docs, projectName = '产品文档') {
  // 读取模板
  let template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  
  // 替换项目名称
  template = template.replace(/TUZAI/g, projectName);
  template = template.replace(/PRD Viewer/g, `${projectName}浏览器`);
  
  // 构建 DOCS 数组用于导航
  const docsArray = docs.map((doc, index) => {
    // 提取目录信息
    const parts = doc.path.split(path.sep);
    const dirName = parts[0] || '其他';
    
    // 简单的分类颜色
    const colors = {
      '01-项目概览': { accent: '#087d75', soft: '#dcefeb' },
      '02-产品与版本': { accent: '#4056a1', soft: '#e6e9f6' },
      '03-功能规格': { accent: '#2f7d4f', soft: '#e1f0e8' },
      '04-技术架构': { accent: '#a96810', soft: '#f6ead6' },
      '05-公共资产': { accent: '#aa2d4d', soft: '#f4dde4' },
      '06-决策记录': { accent: '#087d75', soft: '#dcefeb' },
      '默认': { accent: '#69707a', soft: '#f1eee7' }
    };
    
    const color = colors[dirName] || colors['默认'];
    
    return {
      id: `doc-${index}`,
      version: String(index + 1).padStart(2, '0'),
      phase: dirName.replace(/^\d+-/, ''),
      accent: color.accent,
      soft: color.soft,
      title: doc.title,
      file: doc.path.replace(/\\/g, '/'),
      goal: '' // 可以从文档中提取
    };
  });

  // 将 DOCS 数组插入到模板中
  const docsArrayStr = JSON.stringify(docsArray, null, 6);
  template = template.replace(
    /const DOCS = \[[\s\S]*?\];/,
    `const DOCS = ${docsArrayStr};`
  );

  return template;
}

/**
 * 主函数
 */
function main() {
  console.log('🚀 开始生成文档浏览器...\n');

  // 检查 docs 目录
  if (!fs.existsSync(DOCS_ROOT)) {
    console.error('❌ 错误：docs/ 目录不存在');
    process.exit(1);
  }

  // 检查模板
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error('❌ 错误：浏览器模板不存在');
    console.error(`   期望位置: ${TEMPLATE_PATH}`);
    process.exit(1);
  }

  console.log('📂 扫描文档...');
  const docs = scanDocs(DOCS_ROOT);
  console.log(`   找到 ${docs.length} 个文档\n`);

  if (docs.length === 0) {
    console.warn('⚠️  警告：未找到任何 markdown 文档');
    process.exit(0);
  }

  // 确保输出目录存在
  const outputDir = path.dirname(OUTPUT_HTML);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 生成数据文件
  console.log('📝 生成数据文件...');
  const dataContent = generateDataFile(docs);
  fs.writeFileSync(OUTPUT_DATA, dataContent, 'utf-8');
  console.log(`   ✅ ${OUTPUT_DATA}\n`);

  // 生成 HTML 文件
  console.log('🎨 生成 HTML 浏览器...');
  
  // 尝试从 README 或项目名称获取项目名
  let projectName = '产品文档';
  const readmePath = path.join(DOCS_ROOT, '01-项目概览/README.md');
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, 'utf-8');
    const match = readme.match(/^#\s+(.+?)文档/m);
    if (match) {
      projectName = match[1].trim();
    }
  }

  const htmlContent = generateHTML(docs, projectName);
  fs.writeFileSync(OUTPUT_HTML, htmlContent, 'utf-8');
  console.log(`   ✅ ${OUTPUT_HTML}\n`);

  // 统计信息
  const htmlSize = (fs.statSync(OUTPUT_HTML).size / 1024).toFixed(1);
  const dataSize = (fs.statSync(OUTPUT_DATA).size / 1024).toFixed(1);
  
  console.log('📊 生成完成：');
  console.log(`   HTML: ${htmlSize} KB`);
  console.log(`   数据: ${dataSize} KB`);
  console.log(`   文档: ${docs.length} 个\n`);

  console.log('🎉 文档浏览器生成成功！');
  console.log(`\n打开浏览器访问: file://${OUTPUT_HTML}\n`);
}

// 执行
main();
