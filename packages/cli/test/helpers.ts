import type { ProviderConfig } from '../src/adapters/types.js';

export const PASS_MARKER = 'SKILL_PASS_MARKER';

export const testProviderConfig: ProviderConfig = {
  provider: 'nvidia',
  apiKey: 'test-key',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  timeoutMs: 120000,
  requestDelayMs: 0,
  maxAttempts: 1,
  maxRetryDelayMs: 1000,
  generatorModel: 'meta/llama-3.1-70b-instruct',
  runnerModel: 'meta/llama-3.1-70b-instruct',
  graderModel: 'meta/llama-3.1-70b-instruct'
};

export class FakeOpenAiCompatClient {
  constructor(
    public config: unknown,
    public options?: unknown
  ) {}

  async complete(request: { messages: Array<{ role: string; content: string }> }) {
    const system = request.messages.find((m) => m.role === 'system')?.content ?? '';
    const user = request.messages.find((m) => m.role === 'user')?.content ?? '';
    const withSkill = /skill instructions/i.test(system);
    const usage = { promptTokens: withSkill ? 100 : 20, completionTokens: 5, totalTokens: withSkill ? 105 : 25 };

    if (/evaluation tasks/i.test(system)) {
      const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i + 1}`, prompt: `Task ${i + 1}`, criterion: `Crit ${i + 1}` }));
      return { content: JSON.stringify({ tasks }), model: 'fake', usage };
    }
    if (/blind evaluator/i.test(system)) {
      const score = user.includes(PASS_MARKER) || user.includes('SKILL_PASS') ? 1 : 0;
      return { content: JSON.stringify({ score, reason: 'g' }), model: 'fake', usage };
    }

    let pass = withSkill;
    if (/HELP/.test(user)) pass = withSkill;
    else if (/HURT/.test(user)) pass = !withSkill;
    else if (/SAME/.test(user)) pass = false;

    return { content: pass ? `${PASS_MARKER} the task is handled` : 'baseline', model: 'fake', usage };
  }
}

// Variant whose task generator returns a DIFFERENT task set on every call (the
// real LLM behavior that breaks naive hash-based resume). Counts calls per
// role so tests can assert the generator was not re-invoked on --resume, and
// can throw mid-run to simulate an interrupted evaluation.
export class ShiftingGeneratorClient extends FakeOpenAiCompatClient {
  static generateCalls = 0;
  static otherCalls = 0;
  static failAfterCalls = Number.POSITIVE_INFINITY;

  static reset() {
    ShiftingGeneratorClient.generateCalls = 0;
    ShiftingGeneratorClient.otherCalls = 0;
    ShiftingGeneratorClient.failAfterCalls = Number.POSITIVE_INFINITY;
  }

  async complete(request: { messages: Array<{ role: string; content: string }> }) {
    const system = request.messages.find((m) => m.role === 'system')?.content ?? '';
    if (/evaluation tasks/i.test(system)) {
      ShiftingGeneratorClient.generateCalls += 1;
      if (ShiftingGeneratorClient.generateCalls + ShiftingGeneratorClient.otherCalls > ShiftingGeneratorClient.failAfterCalls) {
        throw new Error('simulated interruption');
      }
      const n = ShiftingGeneratorClient.generateCalls;
      const tasks = Array.from({ length: 8 }, (_, i) => ({
        id: `t${i + 1}`,
        prompt: `Task ${i + 1} from generation ${n}`,
        criterion: `Criterion ${i + 1}`
      }));
      return {
        content: JSON.stringify({ tasks }),
        model: 'fake',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
      };
    }
    ShiftingGeneratorClient.otherCalls += 1;
    if (ShiftingGeneratorClient.generateCalls + ShiftingGeneratorClient.otherCalls > ShiftingGeneratorClient.failAfterCalls) {
      throw new Error('simulated interruption');
    }
    return super.complete(request);
  }
}

export class OutOfOrderMockClient extends FakeOpenAiCompatClient {
  async complete(request: { messages: Array<{ role: string; content: string }> }) {
    const system = request.messages.find((m) => m.role === 'system')?.content ?? '';
    const withSkill = /skill instructions/i.test(system);
    // Add artificial delay to with_skill so no_skill resolves first under concurrency
    if (withSkill) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return super.complete(request);
  }
}
