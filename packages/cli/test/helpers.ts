import type { NvidiaConfig } from '../src/adapters/nvidia-nim.js';

export const PASS_MARKER = 'SKILL_PASS_MARKER';

export const testNvidiaConfig: NvidiaConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  generatorModel: 'meta/llama-3.1-70b-instruct',
  runnerModel: 'meta/llama-3.1-70b-instruct',
  graderModel: 'meta/llama-3.1-70b-instruct'
};

export class FakeNvidiaNimClient {
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
