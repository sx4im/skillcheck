import { describe, expect, it, vi } from 'vitest';
import type { CompletionRequest } from '../src/providers/types.js';
import { analyzeComposition, composeSkills } from '../src/core/compose/index.js';
import type { NormalizedSkill } from '../src/types.js';

function skill(name: string, description: string, body: string, tools?: string): NormalizedSkill {
  return {
    name,
    sourcePath: `${name}/SKILL.md`,
    format: 'SKILL.md',
    instructions: `---\nname: ${name}\ndescription: ${description}\n${tools ? `allowed-tools: ${tools}\n` : ''}---\n${body}`,
    domain: description,
    assets: [],
    versionHash: name,
    toolDependent: false
  };
}

const description = 'Review stale payment invoices. Use when checking payment invoice records.';
const target = skill('target', description, 'Always export invoices.\n' + 'invoice '.repeat(2_000), 'Read');
const existing = skill('existing', description, 'Never export invoices.', 'Write');
const models = { generatorModel: 'generator', runnerModel: 'runner', graderModel: 'grader' };

function modelClient(passWhen: (hasTarget: boolean, hasExisting: boolean) => boolean) {
  return {
    complete: vi.fn(async (request: CompletionRequest) => {
      const system = request.messages.find((message) => message.role === 'system')?.content;
      const user = request.messages.find((message) => message.role === 'user')?.content;
      const content = request.model === 'generator'
        ? JSON.stringify({ tasks: Array.from({ length: 4 }, (_, index) => ({
          prompt: `Check invoice ${index}.`, criterion: 'Totals are correct.'
        })) })
        : request.model === 'grader'
          ? JSON.stringify({ score: Number(String(user).includes('CORRECT_TOTAL')), reason: 'Checked.' })
          : passWhen(String(system).includes('name: target'), String(system).includes('name: existing'))
            ? 'CORRECT_TOTAL'
            : 'INCORRECT';
      return { content, model: request.model };
    })
  };
}

describe('compose', () => {
  it('flags the stack token budget, overlapping triggers, opposing directives, and disjoint tools', () => {
    const report = analyzeComposition(target, [existing]);

    expect(report.estimatedTokens).toBeGreaterThan(3_000);
    expect(report.warnings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'TOKEN_BUDGET', 'DESCRIPTION_OVERLAP', 'CONTRADICTORY_INSTRUCTIONS', 'ALLOWED_TOOLS_CONFLICT'
    ]));
  });

  it('ignores fenced examples and tool ordering when checking compatibility', () => {
    const reporting = skill('reporting', 'Create financial summaries. Use when reporting costs.', 'Always export reports.', 'Read Bash(git:*)');
    const backup = skill('backup', 'Archive local files. Use when making backups.', '```text\nNever export reports.\n```\nSave copies.', 'Bash(git:*) Read');

    expect(analyzeComposition(reporting, [backup]).warnings).toEqual([]);
  });

  it('grades all three arms blind on the same tasks and measures the marginal effect', async () => {
    const client = modelClient((hasTarget, hasExisting) => hasTarget && hasExisting);
    const report = await composeSkills({ target, stack: [existing], tasks: 2, trials: 2, compareIsolated: true, models }, client);

    expect(report).toMatchObject({
      tasks: 2, trials: 2, verdict: 'COMPATIBLE_HELPS', effectPp: 100, ciPp: [100, 100],
      passRates: { baseline: 0, treatment: 1, isolated: 0 }, isolatedEffect: { effectPp: 100, ciPp: [100, 100] }
    });
    const requests = client.complete.mock.calls.map(([request]) => request);
    const runner = requests.filter(({ model }) => model === 'runner');
    expect(runner).toHaveLength(12);
    for (const task of new Set(runner.map(({ messages }) => messages.at(-1)?.content))) {
      expect(runner.filter(({ messages }) => messages.at(-1)?.content === task)).toHaveLength(6);
    }
    const grader = requests.filter(({ model }) => model === 'grader');
    expect(grader).toHaveLength(12);
    expect(JSON.stringify(grader)).not.toMatch(/name: target|name: existing|Check invoice/);
  });

  it.each([
    { outcome: 'CONFLICTS_HARMS', effect: -100, passWhen: (hasTarget: boolean) => !hasTarget },
    { outcome: 'REDUNDANT_PLACEBO', effect: 0, passWhen: () => true }
  ])('reports the two-arm verdict $outcome', async ({ outcome, effect, passWhen }) => {
    const report = await composeSkills({ target, stack: [existing], tasks: 2, trials: 1, models }, modelClient(passWhen));
    expect(report.verdict).toBe(outcome);
    expect(report.effectPp).toBe(effect);
    expect(report.passRates.isolated).toBeUndefined();
  });

  it('rejects a repeated skill path before making requests', async () => {
    const client = modelClient(() => true);
    await expect(composeSkills({ target, stack: [existing, target], tasks: 2, trials: 1, models }, client)).rejects.toThrow(/duplicate/i);
    expect(client.complete).not.toHaveBeenCalled();
  });
});
