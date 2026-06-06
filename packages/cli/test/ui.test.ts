import { describe, expect, it } from 'vitest';
import { sanitizeCliError } from '../src/ui.js';

describe('sanitizeCliError', () => {
  it('surfaces a clean upgrade message for quota / 402 errors', () => {
    const message = sanitizeCliError(
      new Error("402 You've used all 10 free Skillcheck runs. Upgrade to keep going at https://app.example/app.html")
    );
    expect(message).toContain('free Skillcheck runs');
    expect(message).toContain('Upgrade');
    expect(message.startsWith('402')).toBe(false);
    expect(message).not.toContain('not connected');
  });

  it('maps auth errors to a friendly connect message', () => {
    expect(sanitizeCliError(new Error('401 Unauthorized: invalid api key'))).toMatch(/not connected/i);
  });

  it('scrubs provider branding from generic errors', () => {
    expect(sanitizeCliError(new Error('NVIDIA NIM request timeout'))).toContain('Skillcheck Cloud');
    expect(sanitizeCliError(new Error('NVIDIA NIM request timeout'))).not.toContain('NVIDIA');
  });
});
