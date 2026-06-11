import dotenv from 'dotenv';
import { DEFAULT_CLOUD_API_URL, getConfiguredApiUrl, getConfiguredToken } from './config.js';

dotenv.config();

// Default model for all three roles (generator / runner / grader).
// Chosen by live benchmark across the NIM catalog (2026-06): gpt-oss-120b is the
// only large model served from NIM's fast lane (≈1–5 s/call) AND reliable in
// strict JSON mode. MiniMax M2.7, DeepSeek V4, Qwen3-Next and Llama 3.3 70B all
// queued 60–110+ s per call; Qwen 3.5's NIM endpoint rejects response_format.
// nvidia/nemotron-3-nano-omni-30b-a3b-reasoning remains the low-latency
// alternative (sub-second calls, weaker grading/generation) via SKILLCHECK_MODEL.
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export interface NvidiaConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  requestDelayMs: number;
  maxAttempts: number;
  maxRetryDelayMs: number;
  generatorModel: string;
  graderModel: string;
  runnerModel: string;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

// Resolve which endpoint and credential this process talks to.
// Direct mode (NVIDIA_API_KEY) always bypasses the hosted proxy — even when a
// proxy URL was saved by an earlier `skillcheck setup`. Hosted mode works with
// just a token: the baked-in cloud URL is assumed, so the documented
// `SKILLCHECK_TOKEN=… skillcheck check …` flow works on a fresh machine.
function resolveEndpoint(): { apiKey: string; baseUrl: string } {
  const nvidiaApiKey = readEnv('NVIDIA_API_KEY');
  if (nvidiaApiKey) {
    return { apiKey: nvidiaApiKey, baseUrl: readEnv('NVIDIA_BASE_URL') ?? DEFAULT_NVIDIA_BASE_URL };
  }

  const proxyUrl = getConfiguredApiUrl();
  const proxyApiKey = getConfiguredToken();
  if (proxyUrl || proxyApiKey) {
    return { apiKey: proxyApiKey ?? 'skillcheck-cloud', baseUrl: proxyUrl ?? DEFAULT_CLOUD_API_URL };
  }

  throw new Error(
    'Skillcheck Cloud is not connected. Run `skillcheck setup` to connect your API key, or set SKILLCHECK_TOKEN (hosted) / NVIDIA_API_KEY (direct). Self-hosted proxies use SKILLCHECK_API_URL.'
  );
}

function resolveModel(role: 'GENERATOR' | 'GRADER' | 'RUNNER'): string {
  return (
    readEnv(`NVIDIA_${role}_MODEL`) ??
    readEnv(`SKILLCHECK_${role}_MODEL`) ??
    readEnv('SKILLCHECK_MODEL') ??
    DEFAULT_MODEL
  );
}

export function loadNvidiaConfig(): NvidiaConfig {
  const timeoutMs = Number(process.env.NVIDIA_TIMEOUT_MS?.trim() || 120000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Request timeout must be a positive number when set');
  }

  const requestDelayMs = Number(process.env.NVIDIA_REQUEST_DELAY_MS?.trim() || 750);
  if (!Number.isFinite(requestDelayMs) || requestDelayMs < 0) {
    throw new Error('Request delay must be a non-negative number when set');
  }

  const maxAttempts = Number(process.env.NVIDIA_MAX_ATTEMPTS?.trim() || 8);
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error('Retry attempt budget must be a positive integer when set');
  }

  const maxRetryDelayMs = Number(process.env.NVIDIA_MAX_RETRY_DELAY_MS?.trim() || 60000);
  if (!Number.isFinite(maxRetryDelayMs) || maxRetryDelayMs <= 0) {
    throw new Error('Retry delay cap must be a positive number when set');
  }

  const endpoint = resolveEndpoint();

  return {
    apiKey: endpoint.apiKey,
    baseUrl: endpoint.baseUrl,
    timeoutMs,
    requestDelayMs,
    maxAttempts,
    maxRetryDelayMs,
    generatorModel: resolveModel('GENERATOR'),
    graderModel: resolveModel('GRADER'),
    runnerModel: resolveModel('RUNNER')
  };
}
