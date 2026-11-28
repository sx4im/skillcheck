import { describe, expect, it } from 'vitest';
import { redactSecrets, sanitizeTerminal, stringifySafe } from '../src/core/security/output.js';

describe('output boundaries', () => {
  it('removes terminal controls from untrusted fields and preserves multiline text', () => {
    const input = 'before\x1b]0;title\x07\x1b[31mred\x1b[0m\x1b]8;;https://example.test\x1b\\link\x1b]8;;\x1b\\\r\nafter';
    expect(sanitizeTerminal(input)).toBe('beforeredlink\nafter');
  });

  it('masks provider credentials and authorization values without disclosing them', () => {
    const values = ['sk-test12345', 'chk_live_test12345', 'nvapi-test12345', 'AIzaTest12345', 'gsk_test12345'];
    const redacted = redactSecrets(values.join(' ') + '\nAuthorization: Basic pretend\nBearer opaque-token');
    for (const value of [...values, 'pretend', 'opaque-token']) expect(redacted).not.toContain(value);
    expect(redacted.match(/\[REDACTED\]/g)).toHaveLength(7);
  });

  it('redacts key values in JSON while preserving its data structure', () => {
    const data = { transcript: ['ok', 'sk-test12345'], Authorization: 'custom-credential' };
    expect(JSON.parse(stringifySafe(data))).toEqual({
      transcript: ['ok', '[REDACTED]'], Authorization: '[REDACTED]'
    });
  });
});
