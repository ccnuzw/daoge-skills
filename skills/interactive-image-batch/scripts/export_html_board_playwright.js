#!/usr/bin/env node
const path = require('path');
const { chromium } = require('playwright');
const { parseArgs } = require('./script_utils');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['input-file']) throw new Error('Missing required flag: --input-file');
  if (!args['output-file']) throw new Error('Missing required flag: --output-file');

  const inputFile = path.resolve(args['input-file']);
  const outputFile = path.resolve(args['output-file']);
  const width = Number(args.width || 3840);
  const height = Number(args.height || 2160);
  const scale = Number(args.scale || 1);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });

  await page.goto(`file://${inputFile}`, { waitUntil: 'load' });
  const board = page.locator('.board');
  await board.waitFor({ state: 'visible' });
  await board.screenshot({
    path: outputFile,
  });

  await browser.close();
  console.log(outputFile);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
