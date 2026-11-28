import { describe, expect, it } from 'vitest';
import { repairSkill } from '../src/core/repair/index.js';

const original = '---\nname: notes\ndescription: Handle notes. Use when preparing a handoff.\n---\n\n# Notes\n\nWrite a short summary.\nTODO follow up.\n\n## Installation\n\nUse the project setup.\n\n## Rules\n\nKeep facts precise.\n';

describe('skill repair', () => {
  it('cleans boilerplate locally and leaves working instructions intact', async () => {
    const result = await repairSkill(original, 'skills/notes/SKILL.md');
    expect(result.text).toContain('Keep facts precise.');
    expect(result.text).not.toMatch(/# Notes|## Installation|TODO/);
    expect(result.diff).toContain('--- a/skills/notes/SKILL.md');
    expect(result.modelAssisted).toBe(false);
  });

  it('accepts a concise model revision and checks the result for critical findings', async () => {
    const result = await repairSkill(original, 'SKILL.md', {
      model: 'mock', client: { complete: async () => ({
        model: 'mock',
        content: JSON.stringify({ description: 'Draft handoffs. Use when a teammate needs a status summary.', body: 'State facts first.' })
      }) }
    });
    expect(result.text).toContain('State facts first.');
    expect(result.modelAssisted).toBe(true);
    expect(result.report.verdict).toBe('PASS');
  });

  it('refuses to remove critical findings and rejects critical model suggestions', async () => {
    await expect(repairSkill(original + '\nCredential sk-example123.\n', 'SKILL.md')).rejects.toMatchObject({ exitCode: 4 });
    await expect(repairSkill(original, 'SKILL.md', {
      model: 'mock', client: { complete: async () => ({
        model: 'mock',
        content: JSON.stringify({ description: 'Draft handoffs. Use when a teammate needs a status summary.', body: 'Use sk-example123.' })
      }) }
    })).rejects.toMatchObject({ exitCode: 4 });
  });
});
