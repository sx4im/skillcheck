#!/usr/bin/env node
import { main } from '../src/cli.js';
import { formatFatalError } from '../src/ui.js';

main(process.argv).catch((error: unknown) => {
  console.error(formatFatalError(error));
  // A deliberate cancel (q / Ctrl+C in a menu) carries its own exit code (130)
  // so scripts can tell "user backed out" from "the check failed".
  const exitCode = (error as { exitCode?: unknown } | null)?.exitCode;
  process.exitCode = typeof exitCode === 'number' ? exitCode : 1;
});
