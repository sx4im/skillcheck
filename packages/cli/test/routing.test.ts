import { describe, expect, it, vi } from 'vitest';
import type { CompletionRequest } from '../src/providers/types.js';
import { evaluateRouting, validateRoutingSkill } from '../src/core/routing/index.js';
import type { NormalizedSkill } from '../src/types.js';

const invoiceDescription = 'Review payment invoice discrepancies. Use when checking payment invoice totals.';
const competitorDescription = 'Find invoice disputes. Use when investigating disputed invoice amounts.';

function skill(name: string, description: string, body = '# Review workflow\nReconcile invoices against payment records.'): NormalizedSkill {
  return {
    name,
    sourcePath: `${name}/SKILL.md`,
    format: 'SKILL.md',
    instructions: `---\nname: ${name}\ndescription: >-\n  ${description}\n---\n${body}\n`,
    domain: description,
    assets: [],
    versionHash: name,
    toolDependent: false
  };
}

const target = skill('invoice-review', invoiceDescription);
const other = skill('invoice-disputes', competitorDescription);
const models = { generatorModel: 'generator', runnerModel: 'selector' };

function mockClient(answer: (request: CompletionRequest) => unknown) {
  return {
    complete: vi.fn(async (request: CompletionRequest) => ({ content: JSON.stringify(answer(request)), model: request.model }))
  };
}

const goodQueries = { positive: ['Check payment invoice totals', 'Review payment discrepancies'], negative: ['Archive receipts', 'Sort bills'] };
const suggested = 'Review invoice totals against payment records. Use when reconciling payments. Avoid when investigating disputes.';

function selector(request: CompletionRequest) {
  const lines = String(request.messages.find(({ role }) => role === 'user')?.content).split('\n');
  const query = lines[1];
  const catalog = JSON.parse(lines.at(-2)!) as { name: string; id: string }[];
  const listedTarget = catalog.find(({ name }) => name === 'invoice-review')?.id;
  const listedOther = catalog.find(({ name }) => name === 'invoice-disputes')?.id;
  if (listedOther && query === 'Review disputed invoice amounts') {
    return { selection: listedOther };
  }
  return { selection: /^(Check payment invoice totals|Review payment discrepancies|Review disputed invoice amounts|Reconcile payment invoice totals)$/.test(query) ? listedTarget : null };
}

describe('route', () => {
  it('requires frontmatter name and a description with an explicit trigger', () => {
    expect(validateRoutingSkill(target)).toEqual([]);
    expect(validateRoutingSkill(skill('Invalid_Name', 'short'))).toHaveLength(3);
    expect(validateRoutingSkill({ ...target, instructions: 'name: invoice-review\n' })).toHaveLength(2);
    expect(validateRoutingSkill(skill('x'.repeat(65), `${invoiceDescription} ${'x'.repeat(1_024)}`))).toHaveLength(2);
  });

  it('scores lexical and selector routing against balanced labeled queries', async () => {
    const client = mockClient((request) => request.model === 'generator' ? goodQueries : selector(request));
    const report = await evaluateRouting({ target, against: [], queries: 4, models }, client);

    expect(report).toMatchObject({
      verdict: 'PASS', queryCount: 4,
      bm25: { hitAt1: 1, precision: 1, falseTriggerRate: 0, interference: 0, accuracy: 1 },
      llm: { hitAt1: 1, precision: 1, falseTriggerRate: 0, interference: 0, accuracy: 1 }
    });
    expect(report.descriptionDiff).toBeUndefined();
    expect(JSON.stringify(client.complete.mock.calls[0])).toContain('Reconcile invoices against payment records');
  });

  it('attributes target misses to competitors and proposes an applicable contrastive frontmatter patch', async () => {
    const client = mockClient((request) => {
      if (request.model === 'selector') return selector(request);
      if (String(request.messages[0]?.content).includes('contrastive')) return { description: suggested };
      return { positive: ['Check payment invoice totals', 'Review disputed invoice amounts', 'Reconcile payment invoice totals'], negative: ['Archive receipts', 'Sort bills'] };
    });
    const report = await evaluateRouting({ target, against: [other], queries: 5, models }, client);

    expect(report.verdict).toBe('FAIL');
    expect(report.bm25).toMatchObject({ hitAt1: 2 / 3, accuracy: 0.8, interference: 1 / 3, falseTriggerRate: 0 });
    expect(report.llm).toMatchObject({ hitAt1: 2 / 3, accuracy: 0.8, interference: 1 / 3, falseTriggerRate: 0 });
    expect(report.descriptionDiff).toContain(`-  ${invoiceDescription}`);
    expect(report.descriptionDiff).toContain(`+description: ${JSON.stringify(suggested)}`);
    expect(report.descriptionDiff).toContain('@@');
  });

  it('measures near-miss false triggers independently from positive hit rate', async () => {
    const client = mockClient((request) => {
      if (request.model === 'selector') return selector(request);
      if (String(request.messages[0]?.content).includes('contrastive')) return { description: suggested };
      return { ...goodQueries, negative: ['Archive payment invoice records', 'Sort bills'] };
    });
    const report = await evaluateRouting({ target, against: [target], queries: 4, models }, client);
    expect(report.verdict).toBe('FAIL');
    expect(report.bm25).toMatchObject({ hitAt1: 1, precision: 2 / 3, falseTriggerRate: 0.5, interference: 0 });
    expect(report.llm).toMatchObject({ hitAt1: 1, precision: 1, falseTriggerRate: 0 });
  });

  it('rejects malformed input without contacting a model', async () => {
    const client = mockClient(() => null);
    await expect(evaluateRouting({ target: skill('Uppercase', invoiceDescription), against: [], queries: 4, models }, client)).rejects.toThrow(/name/i);
    await expect(evaluateRouting({ target, against: [], queries: 1, models }, client)).rejects.toThrow(/quer/i);
    expect(client.complete).not.toHaveBeenCalled();
  });

  it('rejects malformed query batches and selector responses', async () => {
    await expect(evaluateRouting({ target, against: [], queries: 4, models }, mockClient(() => ({ ...goodQueries, negative: ['archive receipts', 'Archive receipts'] })))).rejects.toThrow(/queries/i);
    const unknownId = mockClient((request) => request.model === 'generator' ? goodQueries : { selection: 'outside-catalog' });
    await expect(evaluateRouting({ target, against: [], queries: 4, models }, unknownId)).rejects.toThrow(/selection/i);
  });

  it('reports malformed competitors that cannot participate in routing', async () => {
    const client = mockClient((request) => request.model === 'generator' ? goodQueries : selector(request));
    const report = await evaluateRouting({ target, against: [skill('legacy', 'too short')], queries: 4, models }, client);
    expect(report.verdict).toBe('PASS');
    expect(report.issues).toEqual([expect.stringContaining('legacy')]);
  });
});
