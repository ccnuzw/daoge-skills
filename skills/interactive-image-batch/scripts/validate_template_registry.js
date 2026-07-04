const fs = require('fs');
const path = require('path');
const { parseArgs, writeJson } = require('./script_utils');

const REQUIRED_TEMPLATE_FIELDS = [
  'id',
  'name',
  'tier',
  'family',
  'category',
  'description',
  'triggers',
  'required_focus',
  'ask_fields',
  'required_slot_fields',
  'prompt_sections',
  'quality_rules',
  'default_negative_terms',
  'anti_patterns',
];

const REQUIRED_DOC_SECTIONS = [
  '适用范围',
  '不适用范围',
  '必问字段',
  '推荐字段',
  '模板变体',
  '推荐 variant_axes',
  '自动补全建议',
  '强约束',
  '反模式',
];

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function readText(filePath) {
  return fs.readFileSync(path.resolve(filePath), 'utf8');
}

function normalizeReportPath(filePath, skillRoot) {
  if (!filePath) return null;
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(path.resolve(skillRoot), absolutePath);
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath.replace(/\\/g, '/');
  }
  return path.basename(absolutePath);
}

function collectDocSections(markdownText) {
  return markdownText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('## '))
    .map((line) => line.replace(/^##\s+/, '').trim());
}

function validateTemplateShape(template) {
  const errors = [];
  const warnings = [];

  REQUIRED_TEMPLATE_FIELDS.forEach((field) => {
    if (!(field in template)) {
      errors.push(`missing required field: ${field}`);
      return;
    }
    if (Array.isArray(template[field]) && template[field].length === 0) {
      warnings.push(`field is present but empty: ${field}`);
      return;
    }
    if (!Array.isArray(template[field]) && String(template[field] || '').trim() === '') {
      warnings.push(`field is present but blank: ${field}`);
    }
  });

  const id = String(template.id || '').trim();
  if (id && !/^[a-z0-9-]+$/.test(id)) {
    warnings.push('id should prefer kebab-case');
  }
  if (ensureArray(template.prompt_sections).length < 3) {
    warnings.push('prompt_sections is unusually short');
  }

  return { errors, warnings };
}

function validateTemplateDoc(skillRoot, template) {
  const templateDoc = String(template.template_doc || '').trim();
  if (!templateDoc) {
    return {
      exists: false,
      errors: ['missing template_doc'],
      warnings: [],
      sections: [],
      missingSections: [...REQUIRED_DOC_SECTIONS],
      path: null,
    };
  }

  const fullPath = path.resolve(skillRoot, templateDoc);
  if (!fs.existsSync(fullPath)) {
    return {
      exists: false,
      errors: [`template_doc not found: ${templateDoc}`],
      warnings: [],
      sections: [],
      missingSections: [...REQUIRED_DOC_SECTIONS],
      path: fullPath,
    };
  }

  const text = readText(fullPath);
  const sections = collectDocSections(text);
  const missingSections = REQUIRED_DOC_SECTIONS.filter((section) => !sections.includes(section));
  const warnings = [];
  if (missingSections.length) warnings.push(`template_doc missing sections: ${missingSections.join(', ')}`);

  return {
    exists: true,
    errors: [],
    warnings,
    sections,
    missingSections,
    path: fullPath,
  };
}

function validateExampleCatalog(skillRoot, catalogPath, templates) {
  const reportPath = normalizeReportPath(catalogPath, skillRoot);
  if (!fs.existsSync(catalogPath)) {
    return {
      ok: true,
      catalogPath: reportPath,
      exampleCount: 0,
      errorCount: 0,
      warningCount: 1,
      errors: [],
      warnings: [`examples catalog not found: ${reportPath}`],
      templateExampleCounts: {},
      variantExampleCounts: {},
    };
  }

  const registryById = new Map(templates.map((template) => [String(template.id || '').trim(), template]));
  const templateExampleCounts = {};
  const variantExampleCounts = {};
  const errors = [];
  const warnings = [];
  let examples = [];

  try {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    examples = ensureArray(catalog.examples);
  } catch (error) {
    return {
      ok: false,
      catalogPath: reportPath,
      exampleCount: 0,
      errorCount: 1,
      warningCount: 0,
      errors: [`failed to read examples catalog: ${error.message || error}`],
      warnings: [],
      templateExampleCounts,
      variantExampleCounts,
    };
  }

  examples.forEach((example, index) => {
    const label = String(example.id || `example[${index}]`).trim();
    const templateId = String(example.template_id || '').trim();
    const variantId = String(example.template_variant || '').trim();
    const exampleFile = String(example.example_file || '').trim();
    if (!templateId) {
      errors.push(`${label} missing template_id`);
      return;
    }
    const template = registryById.get(templateId);
    if (!template) {
      errors.push(`${label} references unknown template_id: ${templateId}`);
      return;
    }

    templateExampleCounts[templateId] = (templateExampleCounts[templateId] || 0) + 1;
    const variantSet = new Set(ensureArray(template.variants).map((item) => String(item.id || '').trim()).filter(Boolean));
    if (variantId) {
      const variantKey = `${templateId}/${variantId}`;
      variantExampleCounts[variantKey] = (variantExampleCounts[variantKey] || 0) + 1;
      if (!variantSet.has(variantId)) {
        errors.push(`${label} references unknown template_variant: ${templateId}/${variantId}`);
      }
    } else {
      warnings.push(`${label} missing template_variant`);
    }

    if (!exampleFile) {
      warnings.push(`${label} missing example_file`);
      return;
    }
    const examplePath = path.resolve(skillRoot, exampleFile);
    if (!fs.existsSync(examplePath)) {
      errors.push(`${label} example_file not found: ${normalizeReportPath(examplePath, skillRoot)}`);
    }
  });

  const sortedTemplateExampleCounts = Object.fromEntries(
    Object.entries(templateExampleCounts).sort((a, b) => a[0].localeCompare(b[0]))
  );
  const sortedVariantExampleCounts = Object.fromEntries(
    Object.entries(variantExampleCounts).sort((a, b) => a[0].localeCompare(b[0]))
  );

  return {
    ok: errors.length === 0,
    catalogPath: reportPath,
    exampleCount: examples.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
    templateExampleCounts: sortedTemplateExampleCounts,
    variantExampleCounts: sortedVariantExampleCounts,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const registryPath = path.resolve(args['registry-file'] || path.join(__dirname, '..', 'references', 'template_registry_zh.json'));
  const skillRoot = path.resolve(args['skill-root'] || path.join(__dirname, '..'));
  const catalogPath = path.resolve(args['catalog-file'] || path.join(skillRoot, 'references', 'examples', 'examples.catalog.json'));
  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(registryPath), 'template_registry_validation_report.json'));
  const registryReportPath = normalizeReportPath(registryPath, skillRoot);
  const skillRootReportPath = '.';

  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const templates = ensureArray(registry.templates);
  const catalogValidation = validateExampleCatalog(skillRoot, catalogPath, templates);
  const report = {
    registryPath: registryReportPath,
    skillRoot: skillRootReportPath,
    templateCount: templates.length,
    ok: true,
    errorCount: 0,
    warningCount: 0,
    catalogValidation,
    templates: [],
  };

  const seenIds = new Set();

  templates.forEach((template) => {
    const id = String(template.id || '').trim() || '(missing-id)';
    const shape = validateTemplateShape(template);
    const doc = validateTemplateDoc(skillRoot, template);
    const errors = [...shape.errors, ...doc.errors];
    const warnings = [...shape.warnings, ...doc.warnings];

    if (seenIds.has(id)) errors.push(`duplicate template id: ${id}`);
    seenIds.add(id);

    report.templates.push({
      id,
      tier: String(template.tier || '').trim(),
      family: String(template.family || '').trim(),
      category: String(template.category || '').trim(),
      templateDoc: String(template.template_doc || '').trim() || null,
      docPath: normalizeReportPath(doc.path, skillRoot),
      docExists: doc.exists,
      docSections: doc.sections,
      missingDocSections: doc.missingSections,
      catalogExampleCount: Number(catalogValidation.templateExampleCounts[id] || 0),
      errors,
      warnings,
      ok: errors.length === 0,
    });

    report.errorCount += errors.length;
    report.warningCount += warnings.length;
  });

  report.errorCount += catalogValidation.errorCount;
  report.warningCount += catalogValidation.warningCount;
  report.ok = report.errorCount === 0;
  writeJson(outputPath, report);
  console.log(JSON.stringify({
    outputPath,
    ok: report.ok,
    templateCount: report.templateCount,
    errorCount: report.errorCount,
    warningCount: report.warningCount,
  }, null, 2));

  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

module.exports = {
  collectDocSections,
  ensureArray,
  normalizeReportPath,
  validateExampleCatalog,
  validateTemplateDoc,
  validateTemplateShape,
};
