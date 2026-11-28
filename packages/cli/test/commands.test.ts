import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import type { CompletionRequest } from '../src/providers/types.js';

const complete = vi.hoisted(() => vi.fn());
vi.mock('../src/providers/openai-compat.js', () => ({
  OpenAiCompatClient: class { complete = complete; }
}));

const skill = '---\nname: release-notes\ndescription: Draft release notes and changelogs. Use when preparing release notes.\n---\n\nGroup changes by impact.\n';
const companion = '---\nname: handoff\ndescription: Write internal handoffs. Use when transferring a project.\n---\n\nList owners.\n';

describe('command entry points with a mocked model', () => {
  let directory: string;
  let originalCwd: string;
  let previousStatus: number | undefined;
  let output: string[];
  let diagnostics: string[];

  beforeEach(async () => {
    previousStatus = process.exitCode as number | undefined;
    process.exitCode = 0;
    directory = await mkdtemp(path.join(tmpdir(), 'skillcheck-commands-'));
    originalCwd = process.cwd();
    process.chdir(directory);
    await writeFile('SKILL.md', skill);
    await mkdir('related');
    await writeFile(path.join('related', 'handoff.md'), companion);
    vi.stubEnv('SKILLCHECK_CONFIG', path.join(directory, 'config.json'));
    vi.stubEnv('NVIDIA_API_KEY', 'nvapi-testcredential');
    vi.stubEnv('SKILLCHECK_NO_UPDATE_CHECK', '1');
    complete.mockReset();
    diagnostics = [];
    output = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { output.push(String(chunk)); return true; });
    vi.spyOn(console, 'log').mockImplementation((line) => { output.push(String(line)); });
    vi.spyOn(console, 'error').mockImplementation((line) => { diagnostics.push(String(line)); });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.chdir(originalCwd);
    process.exitCode = previousStatus;
    await rm(directory, { recursive: true, force: true });
  });

  const run = (...args: string[]) => main(['node', 'skillcheck', ...args]);
  const result = (content: string) => ({ content, model: 'mock' });

  it('reports version and offline doctor diagnostics with masked provider precedence', async () => {
    await run('doctor');
    expect(output.join(' ')).toMatch(/Skillcheck \d+\.\d+\.\d+.*Node .*supported.*NVIDIA_API_KEY/);
    expect(output.join(' ')).not.toContain('nvapi-testcredential');
    expect(complete).not.toHaveBeenCalled();
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'mock' }] })));
    await run('doctor', '--ping');
    expect(request).toHaveBeenCalledOnce();
    expect(output).toContain('Provider ping · passed');
  });

  it.skipIf(process.platform === 'win32')('reports an insecure config mode with exit 1', async () => {
    await writeFile('config.json', '{}');
    await chmod('config.json', 0o644);
    await run('doctor');
    expect(output.join(' ')).toContain('0644');
    expect(process.exitCode).toBe(1);
  });

  it('writes static SARIF and emits a failing JSON audit without using the provider', async () => {
    await writeFile('SKILL.md', skill + 'Use sk-example123.\n');
    await run('audit', 'SKILL.md', '--format', 'sarif', '--output', 'artifacts/audit.sarif');
    const sarif = JSON.parse(await readFile('artifacts/audit.sarif', 'utf8'));
    expect(sarif.runs[0].results[0]).toMatchObject({ ruleId: 'hardcoded-secret', level: 'error' });
    expect(process.exitCode).toBe(4);
    await run('audit', 'SKILL.md', '--format=json', '--dynamic');
    expect(JSON.parse(output.join(''))).toMatchObject({ verdict: 'FAIL' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('runs paired mock audit traces and assigns exit 4 for a with-skill failure', async () => {
    complete.mockImplementation(async ({ messages }: CompletionRequest) => result(JSON.stringify({
      done: true,
      calls: String(messages[0]?.content).includes('Group changes')
        ? [{ tool: 'read_file', argument: '.env' }] : []
    })));
    await run('audit', 'SKILL.md', '--dynamic', '--tasks', '1');
    expect(output.join('')).toMatch(/baseline 0 · with skill 1/);
    expect(process.exitCode).toBe(4);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('previews a repair, checks it again, and changes the file only with --write', async () => {
    complete.mockResolvedValue(result(JSON.stringify({
      description: 'Draft release notes. Use when summarizing a new release.',
      body: 'List changes by impact.'
    })));
    await run('fix', 'SKILL.md', '--dry-run', '--recheck');
    expect(await readFile('SKILL.md', 'utf8')).toBe(skill);
    expect(output.join('')).toContain('+List changes by impact.');
    expect(diagnostics.join('')).toContain('PASS');
    await run('fix', 'SKILL.md', '--write');
    expect(await readFile('SKILL.md', 'utf8')).toContain('List changes by impact.');
    await expect(run('fix', 'SKILL.md', '--write', '--dry-run')).rejects.toMatchObject({ exitCode: 2 });
  });

  it('loads a stack directory and emits Markdown for paired and isolated arms', async () => {
    complete.mockImplementation(async ({ messages }: CompletionRequest) => {
      const system = String(messages[0]?.content);
      if (/evaluation tasks/i.test(system)) {
        return result(JSON.stringify({ tasks: [{ id: 't1', prompt: 'Draft release notes.', criterion: 'Report the change.' }] }));
      }
      if (/blind evaluator/i.test(system)) return result(JSON.stringify({ score: String(messages[1]?.content).includes('handled') ? 1 : 0, reason: 'mock' }));
      return result(system.includes('Group changes') ? 'handled' : 'baseline');
    });
    await run('compose', 'SKILL.md', '--with', 'related', '--compare-isolated', '--tasks', '1', '--trials', '1', '--markdown');
    expect(output.join('')).toMatch(/COMPATIBLE_HELPS.*100\.0 pp/);
    expect(output.join('')).toContain('Treatment compared with isolated');
    expect(complete).toHaveBeenCalledTimes(7);
  });

  it('runs both route selectors and saves a contrastive patch on failure', async () => {
    complete.mockImplementation(async ({ messages }: CompletionRequest) => {
      const system = String(messages[0]?.content);
      if (system.startsWith('Generate realistic')) {
        return result(JSON.stringify({ positive: ['draft release notes'], negative: ['write an internal handoff'] }));
      }
      if (system.startsWith('Write a contrastive')) {
        return result(JSON.stringify({ description: 'Draft public changelogs. Use when publishing release notes. Avoid when transferring ownership.' }));
      }
      return result(JSON.stringify({ selection: null }));
    });
    await run('route', 'SKILL.md', '--against', 'related', '--queries', '2', '--json', '--output', 'route.json');
    const report = JSON.parse(await readFile('route.json', 'utf8'));
    expect(report).toMatchObject({ verdict: 'FAIL', queryCount: 2, llm: { hitAt1: 0, falseTriggerRate: 0 } });
    expect(report.descriptionDiff).toContain('+++ b/SKILL.md');
    expect(process.exitCode).toBe(3);
  });

  it('rejects unknown options, missing values, and invalid format before using the provider', async () => {
    await expect(run('compose', 'SKILL.md')).rejects.toMatchObject({ exitCode: 2 });
    await expect(run('route', 'SKILL.md', '--against')).rejects.toMatchObject({ exitCode: 2 });
    await expect(run('route', 'SKILL.md', '--output=')).rejects.toMatchObject({ exitCode: 2 });
    await expect(run('audit', 'SKILL.md', '--format', 'xml')).rejects.toMatchObject({ exitCode: 2 });
    await expect(run('doctor', 'extra')).rejects.toMatchObject({ exitCode: 2 });
    expect(complete).not.toHaveBeenCalled();
  });
});
