import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression tests for the cwd .env host-redirect hole: env.ts used to call
// dotenv.config() on the current directory, so a .env there could set
// OPENAI_BASE_URL (or any *_BASE_URL / SKILLCHECK_API_URL) and the user's real
// shell-provided key would be POSTed to that host.
//
// Each case re-imports ../src/env.js after vi.resetModules() so the
// module-level .env loading runs against the test's own cwd. A top-level
// import would bind to the repo checkout's cwd instead.
const ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'SKILLCHECK_PROVIDER',
  'SKILLCHECK_API_URL',
  'SKILLCHECK_TOKEN',
  'SKILLCHECK_CONFIG_DIR'
];

describe('cwd .env host-redirect protection', () => {
  let dir: string;
  let cwd: string;
  let saved: Record<string, string | undefined>;

  beforeEach(async () => {
    cwd = process.cwd();
    dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-dotenv-'));
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    // Isolate from the developer's real saved config so resolveActiveProvider
    // only sees what the test sets.
    process.env.SKILLCHECK_CONFIG_DIR = await mkdtemp(path.join(tmpdir(), 'skillcheck-cfg-'));
  });

  afterEach(async () => {
    process.chdir(cwd);
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    if (process.env.SKILLCHECK_CONFIG_DIR?.includes('skillcheck-cfg-')) {
      await rm(process.env.SKILLCHECK_CONFIG_DIR, { recursive: true, force: true });
    }
    await rm(dir, { recursive: true, force: true });
    vi.resetModules();
  });

  async function importEnv() {
    vi.resetModules();
    return import('../src/env.js');
  }

  it('ignores OPENAI_BASE_URL from the cwd .env so the shell key is never sent to a redirected host', async () => {
    await writeFile(path.join(dir, '.env'), 'OPENAI_BASE_URL=http://127.0.0.1:9/v1\n');
    process.env.SKILLCHECK_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-shell-key';
    process.chdir(dir);

    const { resolveActiveProvider } = await importEnv();
    const { provider, apiKey, baseUrl } = resolveActiveProvider();

    expect(provider).toBe('openai');
    expect(apiKey).toBe('sk-shell-key');
    expect(baseUrl).toBe('https://api.openai.com/v1');
  });

  it('ignores SKILLCHECK_API_URL from the cwd .env on the hosted path', async () => {
    await writeFile(path.join(dir, '.env'), 'SKILLCHECK_API_URL=http://127.0.0.1:9/api\n');
    process.env.SKILLCHECK_TOKEN = 'chk_test_token';
    process.chdir(dir);

    const { resolveActiveProvider } = await importEnv();
    const { provider, baseUrl } = resolveActiveProvider();

    expect(provider).toBe('cloud');
    expect(baseUrl).toBe('https://www.skillcheck.page/api');
  });

  it('still loads ordinary keys (e.g. OPENAI_API_KEY) from the cwd .env', async () => {
    await writeFile(path.join(dir, '.env'), 'OPENAI_API_KEY=sk-from-dotenv\n');
    process.env.SKILLCHECK_PROVIDER = 'openai';
    process.chdir(dir);

    const { resolveActiveProvider } = await importEnv();

    expect(resolveActiveProvider().apiKey).toBe('sk-from-dotenv');
  });

  it('does not print the dotenv injected-env banner', async () => {
    await writeFile(path.join(dir, '.env'), 'OPENAI_API_KEY=sk-from-dotenv\n');
    process.chdir(dir);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await importEnv();
      const written = errSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(written).not.toMatch(/injected env/);
    } finally {
      errSpy.mockRestore();
    }
  });
});
