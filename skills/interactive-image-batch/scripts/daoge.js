#!/usr/bin/env node
require('../src/cli/daoge').main()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    console.error(String(error.message || error));
    process.exit(1);
  });
