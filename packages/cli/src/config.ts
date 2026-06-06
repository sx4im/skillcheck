import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export interface SkillcheckUserConfig {
  apiUrl?: string;
  token?: string;
}

function configDir(): string {
  if (process.env.SKILLCHECK_CONFIG_DIR?.trim()) {
    return process.env.SKILLCHECK_CONFIG_DIR.trim();
  }
  if (process.env.XDG_CONFIG_HOME?.trim()) {
    return path.join(process.env.XDG_CONFIG_HOME.trim(), 'skillcheck');
  }
  return path.join(homedir(), '.config', 'skillcheck');
}

export function userConfigPath(): string {
  if (process.env.SKILLCHECK_CONFIG?.trim()) {
    return process.env.SKILLCHECK_CONFIG.trim();
  }
  return path.join(configDir(), 'config.json');
}

export function normalizeApiUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Skillcheck API URL cannot be empty.');
  }
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Skillcheck API URL must start with https:// or http://.');
  }
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = '/v1';
  }
  return url.toString().replace(/\/+$/, '');
}

export function loadUserConfig(): SkillcheckUserConfig {
  try {
    const parsed = JSON.parse(readFileSync(userConfigPath(), 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    return {
      apiUrl: typeof record.apiUrl === 'string' ? record.apiUrl : undefined,
      token: typeof record.token === 'string' ? record.token : undefined
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    return {};
  }
}

export function saveUserConfig(config: SkillcheckUserConfig): string {
  const filePath = userConfigPath();
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return filePath;
}

export function getConfiguredApiUrl(): string | undefined {
  return process.env.SKILLCHECK_API_URL?.trim() || loadUserConfig().apiUrl;
}

export function getConfiguredToken(): string | undefined {
  return process.env.SKILLCHECK_TOKEN?.trim() || process.env.SKILLCHECK_API_KEY?.trim() || loadUserConfig().token;
}
