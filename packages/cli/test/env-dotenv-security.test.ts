import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

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

// ---------------------------------------------------------------------------
// Allow-list regression tests. The *_BASE_URL / SKILLCHECK_API_URL deny-list
// did not stop a cwd .env from redirecting the *config file*
// (SKILLCHECK_CONFIG_DIR, XDG_CONFIG_HOME, SKILLCHECK_CONFIG) at an
// attacker-written config.json whose apiUrl captured the shell's real
// SKILLCHECK_TOKEN. Only an explicit allow-list of credential and tuning
// variables is accepted from the cwd .env now; shell exports and the saved
// user config are unaffected.
//
// Each redirect case resolves the provider exactly the way `skillcheck check`
// does, then performs the token-carrying request the CLI makes
// (verifyCloudKey POSTs `authorization: Bearer <token>` to
// `<baseUrl>/key/verify`) against a recording fetch mock. The case fails if
// any recorded request reaches the attacker host carrying the shell token.

const SHELL_TOKEN = 'chk_live_X';
const ATTACKER_URL = 'http://127.0.0.1:9/v1';
const DEFAULT_CLOUD_URL = 'https://www.skillcheck.page/api';

const ALLOWLIST_ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'GROQ_API_KEY',
  'SKILLCHECK_PROVIDER',
  'SKILLCHECK_API_URL',
  'SKILLCHECK_TOKEN',
  'SKILLCHECK_API_KEY',
  'SKILLCHECK_CONFIG',
  'SKILLCHECK_CONFIG_DIR',
  'SKILLCHECK_TIMEOUT_MS',
  'SKILLCHECK_RUNNER_MODEL',
  'XDG_CONFIG_HOME',
  'HOME'
];

describe('cwd .env allow-list (config-path redirect protection)', () => {
  let dir: string;
  let homeDir: string;
  let cwd: string;
  let saved: Record<string, string | undefined>;
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(async () => {
    cwd = process.cwd();
    dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-allowlist-'));
    homeDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-home-'));
    saved = {};
    for (const key of ALLOWLIST_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    // Point HOME at an empty dir so the fallback config path
    // (~/.config/skillcheck) cannot pick up the developer's real config file.
    process.env.HOME = homeDir;

    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 200, json: async () => ({ valid: false }) } as unknown as Response);

    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(cwd);
    fetchSpy.mockRestore();
    for (const key of ALLOWLIST_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(homeDir, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
    vi.resetModules();
  });

  async function importFresh() {
    vi.resetModules();
    const env = await import('../src/env.js');
    const config = await import('../src/config.js');
    return {
      resolveActiveProvider: env.resolveActiveProvider,
      loadProviderConfig: env.loadProviderConfig,
      verifyCloudKey: config.verifyCloudKey
    };
  }

  async function resolveAndVerify() {
    const { resolveActiveProvider, verifyCloudKey } = await importFresh();
    const { apiKey, baseUrl } = resolveActiveProvider();
    await verifyCloudKey(baseUrl, apiKey);
    return { apiKey, baseUrl };
  }

  function leakedToAttacker() {
    return fetchSpy.mock.calls.filter(([input, init]) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      return String(input).startsWith(ATTACKER_URL) && headers.authorization === `Bearer ${SHELL_TOKEN}`;
    });
  }

  it('SKILLCHECK_CONFIG_DIR redirect: the shell token never reaches the attacker host', async () => {
    const scDir = path.join(dir, '.sc');
    await mkdir(scDir, { recursive: true });
    await writeFile(path.join(scDir, 'config.json'), JSON.stringify({ apiUrl: ATTACKER_URL }));
    await writeFile(path.join(dir, '.env'), 'SKILLCHECK_CONFIG_DIR=./.sc\n');
    process.env.SKILLCHECK_TOKEN = SHELL_TOKEN;

    const { apiKey, baseUrl } = await resolveAndVerify();

    expect(apiKey).toBe(SHELL_TOKEN);
    expect(baseUrl).toBe(DEFAULT_CLOUD_URL);
    expect(leakedToAttacker()).toEqual([]);
  });

  it('XDG_CONFIG_HOME redirect: the shell token never reaches the attacker host', async () => {
    const xdgSkillDir = path.join(dir, 'x', 'skillcheck');
    await mkdir(xdgSkillDir, { recursive: true });
    await writeFile(path.join(xdgSkillDir, 'config.json'), JSON.stringify({ apiUrl: ATTACKER_URL }));
    await writeFile(path.join(dir, '.env'), 'XDG_CONFIG_HOME=./x\n');
    process.env.SKILLCHECK_TOKEN = SHELL_TOKEN;

    const { apiKey, baseUrl } = await resolveAndVerify();

    expect(apiKey).toBe(SHELL_TOKEN);
    expect(baseUrl).toBe(DEFAULT_CLOUD_URL);
    expect(leakedToAttacker()).toEqual([]);
  });

  it('SKILLCHECK_CONFIG redirect: the shell token never reaches the attacker host', async () => {
    await writeFile(path.join(dir, 'evil.json'), JSON.stringify({ apiUrl: ATTACKER_URL }));
    await writeFile(path.join(dir, '.env'), 'SKILLCHECK_CONFIG=./evil.json\n');
    process.env.SKILLCHECK_TOKEN = SHELL_TOKEN;

    const { apiKey, baseUrl } = await resolveAndVerify();

    expect(apiKey).toBe(SHELL_TOKEN);
    expect(baseUrl).toBe(DEFAULT_CLOUD_URL);
    expect(leakedToAttacker()).toEqual([]);
  });

  it('ignores an arbitrary unlisted variable from the cwd .env', async () => {
    await writeFile(path.join(dir, '.env'), 'SKILLCHECK_FUTURE_VAR=1\nTOTALLY_RANDOM_VAR=evil\n');
    await importFresh();

    expect(process.env.SKILLCHECK_FUTURE_VAR).toBeUndefined();
    expect(process.env.TOTALLY_RANDOM_VAR).toBeUndefined();
  });

  it('still loads allow-listed keys, models, and timeouts from the cwd .env', async () => {
    await writeFile(
      path.join(dir, '.env'),
      'GROQ_API_KEY=gsk-from-dotenv\nSKILLCHECK_RUNNER_MODEL=dotenv-runner\nSKILLCHECK_TIMEOUT_MS=5000\n'
    );
    process.env.SKILLCHECK_PROVIDER = 'groq';

    const { resolveActiveProvider, loadProviderConfig } = await importFresh();

    expect(resolveActiveProvider().apiKey).toBe('gsk-from-dotenv');
    const config = loadProviderConfig();
    expect(config.runnerModel).toBe('dotenv-runner');
    expect(config.timeoutMs).toBe(5000);
  });
});
