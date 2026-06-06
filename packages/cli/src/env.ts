import dotenv from 'dotenv';
import { getConfiguredApiUrl, getConfiguredToken } from './config.js';

dotenv.config();

const DEFAULT_MODEL = 'qwen/qwen3-next-80b-a3b-instruct';

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

function resolveApiKey(proxyUrl: string | undefined): string {
  const nvidiaApiKey = readEnv('NVIDIA_API_KEY');
  if (nvidiaApiKey) {
    return nvidiaApiKey;
  }

  const proxyApiKey = getConfiguredToken();
  if (proxyUrl) {
    return proxyApiKey ?? 'skillcheck-cloud';
  }

  throw new Error('Skillcheck Cloud is not connected for this workspace. Set SKILLCHECK_API_URL or try again later.');
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

  const requestDelayMs = Number(process.env.NVIDIA_REQUEST_DELAY_MS?.trim() || 5000);
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

  const proxyUrl = getConfiguredApiUrl();

  return {
    apiKey: resolveApiKey(proxyUrl),
    baseUrl: proxyUrl ?? readEnv('NVIDIA_BASE_URL') ?? 'https://integrate.api.nvidia.com/v1',
    timeoutMs,
    requestDelayMs,
    maxAttempts,
    maxRetryDelayMs,
    generatorModel: resolveModel('GENERATOR'),
    graderModel: resolveModel('GRADER'),
    runnerModel: resolveModel('RUNNER')
  };
}
