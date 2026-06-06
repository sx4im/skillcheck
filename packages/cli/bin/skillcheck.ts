#!/usr/bin/env node
import { main } from '../src/cli.js';
import { formatFatalError } from '../src/ui.js';

main(process.argv).catch((error: unknown) => {
  console.error(formatFatalError(error));
  process.exitCode = 1;
});
