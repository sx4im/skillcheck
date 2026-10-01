import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProviderConfig, ProviderType } from './adapters/types.js';
import { DEFAULT_PROVIDER_BASE_URLS, DEFAULT_PROVIDER_MODELS } from './adapters/providers.js';
import { DEFAULT_CLOUD_API_URL, getConfiguredApiUrl, getConfiguredToken, loadUserConfig } from './config.js';

// The current directory's .env is convenient for API keys, but it must never
// decide where those keys are sent. A cloned repo could ship a .env that
// redirects the saved config file itself (SKILLCHECK_CONFIG_DIR,
// XDG_CONFIG_HOME, SKILLCHECK_CONFIG) at an attacker-written config.json
// whose apiUrl captures the shell's real key, and a deny-list of known-bad
// variables cannot cover every future redirect. So only an explicit allow-list
// of credential and tuning variables is accepted from the file; everything
// else is ignored. Shell exports and the saved user config are unaffected, as
// is any variable set in the real environment.
const DOTENV_ALLOW_LIST: ReadonlyArray<RegExp> = [
  // Provider API keys and the hosted-cloud token/key.
  /^(OPENAI|ANTHROPIC|GEMINI|GOOGLE|GROQ|MISTRAL|OPENROUTER|NVIDIA)_API_KEY$/,
  /^SKILLCHECK_(TOKEN|API_KEY)$/,
  // Model selection: SKILLCHECK_MODEL plus per-provider role overrides
  // (<PROVIDER>_{GENERATOR,GRADER,RUNNER}_MODEL).
  /^SKILLCHECK_MODEL$/,
  /^(OPENAI|ANTHROPIC|GEMINI|GROQ|MISTRAL|OPENROUTER|NVIDIA|SKILLCHECK)_(GENERATOR|GRADER|RUNNER)_MODEL$/,
  // Timeout and retry tuning.
  /^(NVIDIA|SKILLCHECK)_(TIMEOUT_MS|REQUEST_DELAY_MS|MAX_ATTEMPTS|MAX_RETRY_DELAY_MS)$/
];

function loadProjectEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }
  let parsed: Record<string, string>;
  try {
    parsed = dotenv.parse(readFileSync(envPath, 'utf8'));
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!DOTENV_ALLOW_LIST.some((pattern) => pattern.test(key))) {
      continue;
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadProjectEnv();

const DEFAULT_MODEL = 'openai/gpt-oss-120b';

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function resolveActiveProvider(): { provider: ProviderType; apiKey: string; baseUrl: string } {
  // 1. Direct NVIDIA key (legacy direct mode - highest priority)
  const nvidiaApiKey = readEnv('NVIDIA_API_KEY');
  if (nvidiaApiKey) {
    return {
      provider: 'nvidia',
      apiKey: nvidiaApiKey,
      baseUrl: readEnv('NVIDIA_BASE_URL') ?? DEFAULT_PROVIDER_BASE_URLS.nvidia
    };
  }

  // 2. Explicit provider set via SKILLCHECK_PROVIDER
  const explicitProvider = readEnv('SKILLCHECK_PROVIDER') as ProviderType | undefined;
  if (explicitProvider) {
    const keyEnv = `${explicitProvider.toUpperCase()}_API_KEY`;
    const urlEnv = `${explicitProvider.toUpperCase()}_BASE_URL`;
    const apiKey = readEnv(keyEnv) ?? readEnv('SKILLCHECK_PROVIDER_KEY');
    if (apiKey) {
      return {
        provider: explicitProvider,
        apiKey,
        baseUrl: readEnv(urlEnv) ?? DEFAULT_PROVIDER_BASE_URLS[explicitProvider] ?? DEFAULT_CLOUD_API_URL
      };
    }
  }

  // 3. Saved user config BYOK provider OR hosted cloud mode (SKILLCHECK_TOKEN / saved token / SKILLCHECK_API_URL)
  const userConfig = loadUserConfig();
  if (userConfig.provider && userConfig.providerKey && userConfig.provider !== 'cloud') {
    return {
      provider: userConfig.provider,
      apiKey: userConfig.providerKey,
      baseUrl: userConfig.providerBaseUrl ?? DEFAULT_PROVIDER_BASE_URLS[userConfig.provider]
    };
  }

  const proxyUrl = getConfiguredApiUrl();
  const proxyApiKey = getConfiguredToken();
  if (proxyUrl || proxyApiKey) {
    return {
      provider: 'cloud',
      apiKey: proxyApiKey ?? 'skillcheck-cloud',
      baseUrl: proxyUrl ?? DEFAULT_CLOUD_API_URL
    };
  }

  // 4. Other provider env keys (when no hosted token/proxy is configured)
  const envProviders: { provider: ProviderType; keyEnv: string; urlEnv: string }[] = [
    { provider: 'openai', keyEnv: 'OPENAI_API_KEY', urlEnv: 'OPENAI_BASE_URL' },
    { provider: 'anthropic', keyEnv: 'ANTHROPIC_API_KEY', urlEnv: 'ANTHROPIC_BASE_URL' },
    { provider: 'gemini', keyEnv: 'GEMINI_API_KEY', urlEnv: 'GEMINI_BASE_URL' },
    { provider: 'gemini', keyEnv: 'GOOGLE_API_KEY', urlEnv: 'GEMINI_BASE_URL' },
    { provider: 'groq', keyEnv: 'GROQ_API_KEY', urlEnv: 'GROQ_BASE_URL' },
    { provider: 'mistral', keyEnv: 'MISTRAL_API_KEY', urlEnv: 'MISTRAL_BASE_URL' },
    { provider: 'openrouter', keyEnv: 'OPENROUTER_API_KEY', urlEnv: 'OPENROUTER_BASE_URL' }
  ];

  for (const ep of envProviders) {
    const apiKey = readEnv(ep.keyEnv);
    if (apiKey) {
      return {
        provider: ep.provider,
        apiKey,
        baseUrl: readEnv(ep.urlEnv) ?? DEFAULT_PROVIDER_BASE_URLS[ep.provider]
      };
    }
  }

  throw new Error(
    'Skillcheck Cloud is not connected. Run `skillcheck setup` to connect your API key, or set SKILLCHECK_TOKEN (hosted) / NVIDIA_API_KEY (direct). Self-hosted proxies use SKILLCHECK_API_URL.'
  );
}

function resolveModel(provider: ProviderType, role: 'GENERATOR' | 'GRADER' | 'RUNNER'): string {
  const providerPrefix = provider.toUpperCase();
  const userConfig = loadUserConfig();

  const roleKey = role === 'GENERATOR' ? 'generatorModel' : role === 'RUNNER' ? 'runnerModel' : 'graderModel';
  const configModel = userConfig[roleKey];

  return (
    readEnv(`${providerPrefix}_${role}_MODEL`) ??
    readEnv(`NVIDIA_${role}_MODEL`) ??
    readEnv(`SKILLCHECK_${role}_MODEL`) ??
    readEnv('SKILLCHECK_MODEL') ??
    configModel ??
    DEFAULT_PROVIDER_MODELS[provider] ??
    DEFAULT_MODEL
  );
}

// loadProviderConfig always populates every field below; the base interface
// keeps them optional for hand-built configs (tests, direct construction).
type ResolvedProviderConfig = ProviderConfig &
  Required<Pick<ProviderConfig, 'baseUrl' | 'timeoutMs' | 'requestDelayMs' | 'maxAttempts' | 'maxRetryDelayMs'>>;

export function loadProviderConfig(): ResolvedProviderConfig {
  const active = resolveActiveProvider();

  const timeoutMs = Number(process.env.NVIDIA_TIMEOUT_MS?.trim() || process.env.SKILLCHECK_TIMEOUT_MS?.trim() || 120000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Request timeout must be a positive number when set');
  }

  const requestDelayMs = Number(process.env.NVIDIA_REQUEST_DELAY_MS?.trim() || process.env.SKILLCHECK_REQUEST_DELAY_MS?.trim() || 750);
  if (!Number.isFinite(requestDelayMs) || requestDelayMs < 0) {
    throw new Error('Request delay must be a non-negative number when set');
  }

  const maxAttempts = Number(process.env.NVIDIA_MAX_ATTEMPTS?.trim() || process.env.SKILLCHECK_MAX_ATTEMPTS?.trim() || 8);
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error('Retry attempt budget must be a positive integer when set');
  }

  const maxRetryDelayMs = Number(process.env.NVIDIA_MAX_RETRY_DELAY_MS?.trim() || process.env.SKILLCHECK_MAX_RETRY_DELAY_MS?.trim() || 60000);
  if (!Number.isFinite(maxRetryDelayMs) || maxRetryDelayMs <= 0) {
    throw new Error('Retry delay cap must be a positive number when set');
  }

  return {
    provider: active.provider,
    apiKey: active.apiKey,
    baseUrl: active.baseUrl,
    timeoutMs,
    requestDelayMs,
    maxAttempts,
    maxRetryDelayMs,
    generatorModel: resolveModel(active.provider, 'GENERATOR'),
    graderModel: resolveModel(active.provider, 'GRADER'),
    runnerModel: resolveModel(active.provider, 'RUNNER')
  };
}

