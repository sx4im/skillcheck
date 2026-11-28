export const commandUsage = {
  compose: 'compose <target-skill> --with <path1,path2|dir> [--tasks N] [--trials K] [--compare-isolated] [--json|--markdown] [--output FILE]',
  route: 'route <path> [--against DIR] [--queries N] [--json] [--output FILE]',
  audit: 'audit <path> [--dynamic] [--tasks N] [--format terminal|json|sarif] [--output FILE]',
  fix: 'fix <path> [--dry-run|--write] [--recheck]',
  doctor: 'doctor [--ping]'
};

export type BuiltinCommand = keyof typeof commandUsage;

export function isBuiltinCommand(command: string | undefined): command is BuiltinCommand {
  return command !== undefined && Object.hasOwn(commandUsage, command);
}
