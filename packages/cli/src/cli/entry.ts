import { printCommandHelpUi, printHelpUi } from '../ui/banner.js';
import { currentVersion } from '../version.js';
import { commandUsage, isBuiltinCommand } from './command-help.js';

export async function main(argv: string[]): Promise<void> {
  const command = argv[2];
  if (command === 'help' || argv.includes('--help') || argv.includes('-h')) {
    const target = command === 'help' ? argv[3] : command;
    if (isBuiltinCommand(target)) console.log('Usage: skillcheck ' + commandUsage[target]);
    else if (!target || !printCommandHelpUi(target)) printHelpUi();
    return;
  }
  if (command === 'version' || command === 'v' || argv.slice(2).some((arg) => arg === '--version' || arg === '-v')) {
    console.log(currentVersion());
    return;
  }
  if (isBuiltinCommand(command)) {
    const { runCommand } = await import('./commands.js');
    const status = await runCommand(command, argv);
    if (status !== 0) process.exitCode = status;
    return;
  }
  const { runLegacy } = await import('./legacy.js');
  await runLegacy(argv);
}
