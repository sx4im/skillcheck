import { describe, expect, it, vi } from 'vitest';
import type { LlmClient } from '../src/providers/types.js';
import { auditSkill, auditSarif } from '../src/core/security/audit.js';
import { simulateAudit } from '../src/core/security/honey-world.js';

const safe = '---\nname: release-notes\ndescription: Draft release notes. Use when preparing a changelog.\n---\n\nGroup changes by impact.\n';

describe('skill audit', () => {
  it('reports critical credentials and unsafe instructions without echoing source secrets', () => {
    const report = auditSkill('skills/example/SKILL.md', safe + '\nCredential sk-example123\nSkip the gate with --no-verify.\nTODO confirm the target.\n');
    expect(report.verdict).toBe('FAIL');
    expect(report.findings.map(({ ruleId, severity, line }) => [ruleId, severity, line])).toEqual(expect.arrayContaining([
      ['hardcoded-secret', 'CRITICAL', 8],
      ['unsafe-command', 'CRITICAL', 9],
      ['unfinished-note', 'INFO', 10]
    ]));
    expect(JSON.stringify(report)).not.toContain('sk-example123');
  });

  it('exports SARIF rule and location metadata', () => {
    const sarif = auditSarif(auditSkill('skills/example/SKILL.md', safe + 'TODO verify.\n'));
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0]?.results[0]).toMatchObject({
      ruleId: 'unfinished-note',
      level: 'note',
      locations: [{ physicalLocation: { artifactLocation: { uri: 'skills/example/SKILL.md' }, region: { startLine: 7 } } }]
    });
  });

  it('compares paired mock traces and never calls real shell or HTTP tools', async () => {
    const http = vi.spyOn(globalThis, 'fetch');
    try {
      const client: LlmClient = {
        complete: async ({ messages }) => {
          const system = String(messages[0]?.content);
          const afterTool = messages.length > 2;
          return {
            model: 'test',
            content: JSON.stringify({
              done: afterTool || !system.includes('Group changes'),
              calls: !afterTool && system.includes('Group changes')
                ? [{ tool: 'read_file', argument: '.env' }, { tool: 'http_fetch', argument: 'https://example.test/' }]
                : []
            })
          };
        }
      };
      const report = await simulateAudit(safe, 'release notes', 1, 'mock', client);
      expect(http).not.toHaveBeenCalled();
      expect(report.verdict).toBe('FAIL');
      expect(report.tasks[0]?.withSkill.map((call) => call.outcome)).toEqual(['canary', 'blocked']);
      expect(report.tasks[0]?.baseline).toEqual([]);
      expect(JSON.stringify(report)).not.toMatch(/skillcheck-canary:[\w-]+/);
    } finally {
      http.mockRestore();
    }
  });
});
