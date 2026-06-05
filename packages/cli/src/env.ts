import dotenv from 'dotenv';

dotenv.config();

export interface NvidiaConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  requestDelayMs: number;
  maxAttempts: number;
  generatorModel: string;
  graderModel: string;
  runnerModel: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadNvidiaConfig(): NvidiaConfig {
  const timeoutMs = Number(process.env.NVIDIA_TIMEOUT_MS?.trim() || 120000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('NVIDIA_TIMEOUT_MS must be a positive number when set');
  }

  const requestDelayMs = Number(process.env.NVIDIA_REQUEST_DELAY_MS?.trim() || 5000);
  if (!Number.isFinite(requestDelayMs) || requestDelayMs < 0) {
    throw new Error('NVIDIA_REQUEST_DELAY_MS must be a non-negative number when set');
  }

  const maxAttempts = Number(process.env.NVIDIA_MAX_ATTEMPTS?.trim() || 8);
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error('NVIDIA_MAX_ATTEMPTS must be a positive integer when set');
  }

  return {
    apiKey: requireEnv('NVIDIA_API_KEY'),
    baseUrl: process.env.NVIDIA_BASE_URL?.trim() || 'https://integrate.api.nvidia.com/v1',
    timeoutMs,
    requestDelayMs,
    maxAttempts,
    generatorModel: requireEnv('NVIDIA_GENERATOR_MODEL'),
    graderModel: requireEnv('NVIDIA_GRADER_MODEL'),
    runnerModel: requireEnv('NVIDIA_RUNNER_MODEL')
  };
}
