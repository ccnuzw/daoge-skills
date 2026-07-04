const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs, readJson, ensureDir } = require('./script_utils');
const { resolveStarterIntentCopy } = require('./entry_state_shared');

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

const STARTER_SHORTLIST_INTENTS = new Set([
  'portrait',
  'studio',
  'ecommerce',
  'packaging',
  'cinematic',
  'oralboard',
]);

function shortlistStarterExamples(examples) {
  return starterExamples(examples).filter((item) =>
    STARTER_SHORTLIST_INTENTS.has(String(item.starter_intent || '').trim().toLowerCase())
  );
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
  const starters = shortlistStarterExamples(examples);
  const lines = starters.map((item) => {
    const intentCopy = resolveStarterIntentCopy(item.starter_intent, item);
    return [
      item.id,
      item.name,
      item.starter_intent || 'unspecified',
      item.difficulty || 'unspecified',
      item.starter_reason || item.description || '',
      intentCopy.label,
      intentCopy.commandHint,
      intentCopy.summary,
    ].join('\t');
  });
  console.log(lines.join('\n'));
}

function runPrepare(exampleId, outputDir, entryMode = 'example') {
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
    '--emit-optional-pages', 'mainline-only',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const summary = JSON.parse(stdout);
  const catalogFile = catalogPath();
  const entryStateFile = path.join(finalOutputDir, 'entry_state.json');
  execFileSync(process.execPath, [
    path.join(__dirname, 'build_entry_state.js'),
    '--catalog-file', catalogFile,
    '--selected-id', match.id,
    '--entry-mode', entryMode,
    '--runtime-mode', 'local-batch-runner',
    '--optional-page-mode', 'mainline-only',
    '--output-dir', finalOutputDir,
    '--output-file', entryStateFile,
  ], {
    stdio: 'ignore',
  });
  console.log(JSON.stringify({
    selectedExample: {
      id: match.id,
      name: match.name,
      category: match.category,
      taskTypeLabel: resolveStarterIntentCopy(match.starter_intent, match).label,
      taskIntent: match.starter_intent,
      template_id: match.template_id,
      template_variant: match.template_variant,
      maintainer: {
        template_id: match.template_id,
        template_variant: match.template_variant,
      },
    },
    entryState: entryStateFile,
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
    runPrepare(match.id, args['output-dir'], 'intent');
    return;
  }

  if (!args['example-id']) {
    throw new Error('Missing required flag: --example-id (or use --list true / --starter true / --intent <name>)');
  }

  runPrepare(String(args['example-id']).trim(), args['output-dir'], 'example');
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
