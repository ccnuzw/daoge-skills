const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs, readJson, ensureDir } = require('./script_utils');

function catalogPath() {
  return path.resolve(__dirname, '..', 'references', 'examples', 'examples.catalog.json');
}

function loadCatalog() {
  const data = readJson(catalogPath());
  return Array.isArray(data.examples) ? data.examples : [];
}

function starterExamples(examples) {
  return examples.filter((item) => item.recommended_start === true);
}

function findStarterByIntent(examples, intent) {
  const normalized = String(intent || '').trim().toLowerCase();
  return starterExamples(examples).find((item) => String(item.starter_intent || '').trim().toLowerCase() === normalized) || null;
}

function listExamples(examples) {
  const lines = examples.map((item) => `${item.id}\t${item.name}\t${item.category}\t${item.description}`);
  console.log(lines.join('\n'));
}

function listStarterExamples(examples) {
  const starters = starterExamples(examples);
  const lines = starters.map((item) => `${item.id}\t${item.name}\t${item.starter_intent || 'unspecified'}\t${item.difficulty || 'unspecified'}\t${item.starter_reason || item.description || ''}`);
  console.log(lines.join('\n'));
}

function runPrepare(exampleId, outputDir) {
  const examples = loadCatalog();
  const match = examples.find((item) => item.id === exampleId);
  if (!match) {
    const known = examples.map((item) => item.id).join(', ');
    throw new Error(`Unknown example id: ${exampleId}. Available: ${known}`);
  }

  const skillRoot = path.resolve(__dirname, '..');
  const exampleFile = path.resolve(skillRoot, match.example_file);
  const finalOutputDir = path.resolve(outputDir || path.join(path.dirname(exampleFile), `${match.id}-demo-out`));
  ensureDir(finalOutputDir);

  const stdout = execFileSync(process.execPath, [
    path.join(__dirname, 'run_example_quickstart_prepare.js'),
    '--example-file', exampleFile,
    '--output-dir', finalOutputDir,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const summary = JSON.parse(stdout);
  console.log(JSON.stringify({
    selectedExample: {
      id: match.id,
      name: match.name,
      category: match.category,
      template_id: match.template_id,
      template_variant: match.template_variant,
    },
    ...summary,
  }, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const examples = loadCatalog();

  if (args.list === 'true' || args.list === true) {
    listExamples(examples);
    return;
  }

  if (args.starter === 'true' || args.starter === true) {
    listStarterExamples(examples);
    return;
  }

  if (args.intent) {
    const match = findStarterByIntent(examples, args.intent);
    if (!match) {
      const known = starterExamples(examples).map((item) => item.starter_intent).filter(Boolean).join(', ');
      throw new Error(`Unknown starter intent: ${args.intent}. Available: ${known}`);
    }
    runPrepare(match.id, args['output-dir']);
    return;
  }

  if (!args['example-id']) {
    throw new Error('Missing required flag: --example-id (or use --list true / --starter true / --intent <name>)');
  }

  runPrepare(String(args['example-id']).trim(), args['output-dir']);
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
