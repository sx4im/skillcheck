import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getConfiguredApiUrl, loadUserConfig, normalizeApiUrl, saveUserConfig, userConfigPath } from '../src/config.js';

const originalEnv = { ...process.env };

function isolateConfig(): string {
  process.env = { ...originalEnv };
  delete process.env.SKILLCHECK_API_URL;
  delete process.env.SKILLCHECK_CONFIG;
  const dir = mkdtempSync(path.join(tmpdir(), 'skillcheck-config-test-'));
  process.env.SKILLCHECK_CONFIG_DIR = dir;
  return dir;
}

describe('user config', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('normalizes root API URLs to an OpenAI-compatible v1 base URL', () => {
    expect(normalizeApiUrl('https://api.example.com')).toBe('https://api.example.com/v1');
    expect(normalizeApiUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
  });

  it('rejects non-http API URLs', () => {
    expect(() => normalizeApiUrl('ftp://api.example.com')).toThrow(/https/);
  });

  it('saves and reads the configured API URL', () => {
    isolateConfig();
    const filePath = saveUserConfig({ apiUrl: 'https://api.example.com/v1' });

    expect(filePath).toBe(userConfigPath());
    expect(loadUserConfig().apiUrl).toBe('https://api.example.com/v1');
    expect(getConfiguredApiUrl()).toBe('https://api.example.com/v1');
  });

  it('lets environment override saved config', () => {
    isolateConfig();
    saveUserConfig({ apiUrl: 'https://saved.example.com/v1' });
    process.env.SKILLCHECK_API_URL = 'https://env.example.com/v1';

    expect(getConfiguredApiUrl()).toBe('https://env.example.com/v1');
  });

  // The old hosts now redirect to www.skillcheck.page, and redirects strip the
  // Authorization header in Node's fetch, so stale URLs would authenticate as
  // "no key". They must be migrated, not followed.
  it('migrates saved configs pointing at the legacy vercel.app host', () => {
    isolateConfig();
    saveUserConfig({ apiUrl: 'https://dashboard-skillcheck.vercel.app/api' });

    expect(getConfiguredApiUrl()).toBe('https://www.skillcheck.page/api');
  });

  it('migrates the apex domain to www (apex redirects too)', () => {
    isolateConfig();
    process.env.SKILLCHECK_API_URL = 'https://skillcheck.page/api';

    expect(getConfiguredApiUrl()).toBe('https://www.skillcheck.page/api');
  });

  it('leaves self-hosted URLs untouched', () => {
    isolateConfig();
    saveUserConfig({ apiUrl: 'https://my-fork.vercel.app/api' });

    expect(getConfiguredApiUrl()).toBe('https://my-fork.vercel.app/api');
  });
});
