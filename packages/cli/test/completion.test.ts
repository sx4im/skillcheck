import { describe, expect, it } from 'vitest';
import { generateCompletionScript, detectShell } from '../src/completion.js';

describe('shell completions generator', () => {
  it('detects shell from environment path', () => {
    expect(detectShell('/bin/bash')).toBe('bash');
    expect(detectShell('/usr/bin/zsh')).toBe('zsh');
    expect(detectShell('/opt/homebrew/bin/fish')).toBe('fish');
    expect(detectShell('')).toBe('bash');
  });

  it('generates valid Bash completion script with all commands and flags', () => {
    const script = generateCompletionScript('bash');
    expect(script).toContain('_skillcheck_completions()');
    expect(script).toContain('complete -o filenames -F _skillcheck_completions skillcheck');
    expect(script).toContain('check');
    expect(script).toContain('demo');
    expect(script).toContain('matrix');
    expect(script).toContain('--tasks');
    expect(script).toContain('--clipboard');
  });

  it('generates valid Zsh completion script with command descriptions', () => {
    const script = generateCompletionScript('zsh');
    expect(script).toContain('#compdef skillcheck');
    expect(script).toContain('_arguments');
    expect(script).toContain('check:');
    expect(script).toContain('demo:');
    expect(script).toContain('--clipboard');
  });

  it('generates valid Fish completion script', () => {
    const script = generateCompletionScript('fish');
    expect(script).toContain('complete -c skillcheck');
    expect(script).toContain('check');
    expect(script).toContain('demo');
    expect(script).toContain('-l "clipboard"');
  });
});
