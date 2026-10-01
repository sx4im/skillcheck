export type ShellType = 'bash' | 'zsh' | 'fish';

const COMMANDS = [
  { name: 'check', desc: 'A/B check an agent skill against an unprompted baseline' },
  { name: 'watch', desc: 'Hot-reload and re-evaluate a skill automatically on save' },
  { name: 'demo', desc: 'Instant 5-second simulated benchmark (zero keys required)' },
  { name: 'matrix', desc: 'Benchmark a skill across multiple models side-by-side' },
  { name: 'hook', desc: 'Install or execute the git pre-commit regression guard' },
  { name: 'setup', desc: 'Connect via Skillcheck Cloud or Bring Your Own Key (BYOK)' },
  { name: 'logout', desc: 'Remove saved API keys and provider configurations' },
  { name: 'eval', desc: 'Full evaluation emitting machine-readable JSON' },
  { name: 'verify', desc: 'Re-grade a saved result file to confirm reproducibility' },
  { name: 'corpus', desc: 'Batch-check every skill declared in a corpus manifest' },
  { name: 'rot', desc: 'Re-score saved benchmark results against the current model' },
  { name: 'help', desc: 'Show general help or command-specific usage' },
  { name: 'version', desc: 'Print installed version' }
];

const GLOBAL_OPTIONS = [
  '--tasks',
  '--trials',
  '--concurrency',
  '--runner',
  '--grader',
  '--generator',
  '--models',
  '--output',
  '--explain',
  '--clipboard',
  '--json',
  '--help',
  '--version'
];

export function detectShell(envShell = process.env.SHELL ?? ''): ShellType {
  const lower = envShell.toLowerCase();
  if (lower.includes('zsh')) return 'zsh';
  if (lower.includes('fish')) return 'fish';
  return 'bash';
}

function generateBashCompletion(): string {
  const cmdNames = COMMANDS.map((c) => c.name).join(' ');
  const optNames = GLOBAL_OPTIONS.join(' ');

  return `#!/usr/bin/env bash
# Skillcheck Bash completion script
_skillcheck_completions() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  local commands="${cmdNames}"
  local options="${optNames}"

  if [[ "\${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "\${options}" -- "\${cur}") )
    return 0
  fi

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
    return 0
  fi

  # Default to markdown and directory completions for paths
  COMPREPLY=( $(compgen -f -X '!*.md' -- "\${cur}") $(compgen -d -- "\${cur}") )
}
complete -o filenames -F _skillcheck_completions skillcheck
`;
}

function generateZshCompletion(): string {
  const cmdEntries = COMMANDS.map((c) => `'${c.name}:${c.desc.replace(/'/g, "\\'")}'`).join('\n    ');
  const optEntries = GLOBAL_OPTIONS.map((o) => `'${o}[${o.slice(2)} option]'`).join('\n    ');

  return `#compdef skillcheck
# Skillcheck Zsh completion script

_skillcheck() {
  local -a commands
  commands=(
    ${cmdEntries}
  )

  local -a options
  options=(
    ${optEntries}
  )

  _arguments -C \\
    '1: :->command' \\
    '*: :->args' && return 0

  case $state in
    command)
      _describe -t commands 'skillcheck commands' commands
      ;;
    args)
      _arguments \\
        $options \\
        '*:file:_files -g "*.md(-.)"'
      ;;
  esac
}

_skillcheck "$@"
`;
}

function generateFishCompletion(): string {
  const lines: string[] = [
    '# Skillcheck Fish completion script',
    'complete -c skillcheck -f'
  ];

  for (const cmd of COMMANDS) {
    lines.push(`complete -c skillcheck -n "__fish_use_subcommand" -a "${cmd.name}" -d "${cmd.desc.replace(/"/g, '\\"')}"`);
  }

  for (const opt of GLOBAL_OPTIONS) {
    lines.push(`complete -c skillcheck -l "${opt.slice(2)}"`);
  }

  lines.push('complete -c skillcheck -a "(__fish_complete_suffix .md)"');
  return lines.join('\n') + '\n';
}

export function generateCompletionScript(shell: ShellType): string {
  if (shell === 'zsh') return generateZshCompletion();
  if (shell === 'fish') return generateFishCompletion();
  return generateBashCompletion();
}
