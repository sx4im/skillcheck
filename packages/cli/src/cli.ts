import { NvidiaNimClient } from './adapters/nvidia-nim.js';
import { runM0Gate } from './m0/run.js';

function printHelp(): void {
  console.log(`skillcheck

Usage:
  skillcheck m0

M0 is the hardcoded spike required before the PRD allows M1 work.`);
}

export async function main(argv: string[]): Promise<void> {
  const command = argv[2];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'm0') {
    const report = await runM0Gate((config) => new NvidiaNimClient(config));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.passed ? 0 : 1;
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}
