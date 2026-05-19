const path = require('path');
const { parseArgs, readJson, writeJson } = require('./script_utils');

const REQUIRED_FIELDS = ['index', 'title', 'requestMode', 'status'];
const VALID_STATUSES = new Set(['success', 'needs_review', 'failed']);

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function validateItems(items) {
  const errors = [];
  const warnings = [];

  items.forEach((item, index) => {
    const label = `item[${index}]`;
    REQUIRED_FIELDS.forEach((field) => {
      if (!hasValue(item[field])) {
        errors.push(`${label} missing required field: ${field}`);
      }
    });

    const status = String(item.status || '').trim();
    if (status && !VALID_STATUSES.has(status)) {
      errors.push(`${label} has invalid status: ${status}`);
    }

    if ((status === 'success' || status === 'needs_review') && !hasValue(item.output)) {
      errors.push(`${label} requires output when status=${status}`);
    }

    if (status === 'failed' && !hasValue(item.error)) {
      warnings.push(`${label} should provide error when status=failed`);
    }
  });

  return { errors, warnings };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['results-file']) throw new Error('Missing required flag: --results-file');

  const resultsFile = path.resolve(args['results-file']);
  const outputFile = args['output-file'] ? path.resolve(args['output-file']) : null;
  const parsed = readJson(resultsFile);
  const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : null);

  if (!items) {
    throw new Error(`Results file must be a JSON array or { items: [] }: ${resultsFile}`);
  }

  const { errors, warnings } = validateItems(items);
  const result = {
    ok: errors.length === 0,
    resultsFile,
    itemCount: items.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
  };

  if (outputFile) writeJson(outputFile, result);
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
