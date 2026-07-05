const path = require('path');
const { parseArgs } = require('./workspace_v2_shared');
const { renderViewModelFile } = require('./render_workspace_page_v2');

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(args['output-dir'] || process.cwd());
  renderViewModelFile(
    args['view-model'] || path.join(outputDir, 'internal', 'view_models', 'prepare.json'),
    args['output-file'] || path.join(outputDir, 'workspace', 'prepare.html')
  );
}

if (require.main === module) main();
