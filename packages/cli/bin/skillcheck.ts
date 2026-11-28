#!/usr/bin/env node
import { main } from '../src/cli/entry.js';
import { SkillcheckError } from '../src/errors.js';
import { sanitizeTerminal } from '../src/core/security/output.js';

main(process.argv).catch(async (error: unknown) => {
  const [, , command, ...options] = process.argv;
  const auditFormat = command === 'audit' && options.some((option, index) =>
    ['--format=json', '--format=sarif'].includes(option) ||
    (option === '--format' && ['json', 'sarif'].includes(options[index + 1] ?? '')));
  const message = sanitizeTerminal(error instanceof Error ? error.message : String(error));
  const debug = process.env.SKILLCHECK_DEBUG === '1' && error instanceof Error && error.stack
    ? sanitizeTerminal(error.stack) : undefined;
  if (process.argv.includes('--json') || auditFormat) {
    console.error(JSON.stringify({
      error: {
        code: error instanceof SkillcheckError ? error.code : 'RUNTIME_ERROR',
        message,
        retryable: error instanceof SkillcheckError && error.retryable,
        ...(debug ? { stack: debug } : {})
      }
    }));
  } else {
    const { formatFatalError } = await import('../src/ui/card.js');
    console.error(formatFatalError(error));
    if (debug) console.error(debug);
  }
  // A deliberate cancel (q / Ctrl+C in a menu) carries its own exit code (130)
  // so scripts can tell "user backed out" from "the check failed".
  const exitCode = (error as { exitCode?: unknown } | null)?.exitCode;
  process.exitCode = typeof exitCode === 'number' ? exitCode : 1;
});
