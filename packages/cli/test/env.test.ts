import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadNvidiaConfig } from '../src/env.js';

const originalEnv = { ...process.env };

function resetProviderEnv(): void {
  process.env = { ...originalEnv };
  delete process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_BASE_URL;
  delete process.env.NVIDIA_GENERATOR_MODEL;
  delete process.env.NVIDIA_GRADER_MODEL;
  delete process.env.NVIDIA_RUNNER_MODEL;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SKILLCHECK_PROVIDER;
  delete process.env.SKILLCHECK_API_URL;
  delete process.env.SKILLCHECK_API_KEY;
  delete process.env.SKILLCHECK_TOKEN;
  delete process.env.SKILLCHECK_MODEL;
  delete process.env.SKILLCHECK_GENERATOR_MODEL;
  delete process.env.SKILLCHECK_GRADER_MODEL;
  delete process.env.SKILLCHECK_RUNNER_MODEL;
  process.env.SKILLCHECK_CONFIG_DIR = mkdtempSync(path.join(tmpdir(), 'skillcheck-config-test-'));
}

describe('loadNvidiaConfig', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses direct NVIDIA mode with default models', () => {
    resetProviderEnv();
    process.env.NVIDIA_API_KEY = 'nvidia-key';

    const config = loadNvidiaConfig();

    expect(config.apiKey).toBe('nvidia-key');
    expect(config.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
    expect(config.generatorModel).toBe('openai/gpt-oss-120b');
    expect(config.graderModel).toBe('openai/gpt-oss-120b');
    expect(config.runnerModel).toBe('openai/gpt-oss-120b');
  });

  it('uses hosted proxy mode without requiring NVIDIA_API_KEY', () => {
    resetProviderEnv();
    process.env.SKILLCHECK_API_URL = 'https://proxy.example.com/v1';
    process.env.SKILLCHECK_MODEL = 'proxy/default-model';

    const config = loadNvidiaConfig();

    expect(config.apiKey).toBe('skillcheck-cloud');
    expect(config.baseUrl).toBe('https://proxy.example.com/v1');
    expect(config.generatorModel).toBe('proxy/default-model');
    expect(config.graderModel).toBe('proxy/default-model');
    expect(config.runnerModel).toBe('proxy/default-model');
  });

  it('uses an optional workspace token when supplied', () => {
    resetProviderEnv();
    process.env.SKILLCHECK_API_URL = 'https://proxy.example.com/v1';
    process.env.SKILLCHECK_TOKEN = 'proxy-user-token';

    const config = loadNvidiaConfig();

    expect(config.apiKey).toBe('proxy-user-token');
  });

  it('falls back to the hosted cloud URL when only a token is configured', () => {
    // The documented headless flow: SKILLCHECK_TOKEN=… skillcheck check …
    // on a machine that never ran `skillcheck setup`.
    resetProviderEnv();
    process.env.SKILLCHECK_TOKEN = 'chk_live_token';

    const config = loadNvidiaConfig();

    expect(config.apiKey).toBe('chk_live_token');
    expect(config.baseUrl).toBe('https://www.skillcheck.page/api');
  });

  it('lets a direct NVIDIA key bypass a configured proxy URL', () => {
    resetProviderEnv();
    process.env.NVIDIA_API_KEY = 'nvidia-key';
    process.env.SKILLCHECK_API_URL = 'https://proxy.example.com/v1';
    process.env.SKILLCHECK_TOKEN = 'chk_live_token';

    const config = loadNvidiaConfig();

    expect(config.apiKey).toBe('nvidia-key');
    expect(config.baseUrl).toBe('https://integrate.api.nvidia.com/v1');
  });

  it('uses an actionable setup error when no provider is configured', () => {
    resetProviderEnv();

    expect(() => loadNvidiaConfig()).toThrow(/Skillcheck Cloud is not connected/);
    expect(() => loadNvidiaConfig()).toThrow(/skillcheck setup/);
    expect(() => loadNvidiaConfig()).toThrow(/SKILLCHECK_TOKEN/);
  });
});
