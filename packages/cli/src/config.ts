import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { ProviderType } from './adapters/types.js';

export interface SkillcheckUserConfig {
  apiUrl?: string;
  token?: string;
  provider?: ProviderType;
  providerKey?: string;
  providerBaseUrl?: string;
  generatorModel?: string;
  runnerModel?: string;
  graderModel?: string;
}

// Skillcheck Cloud's hosted endpoints. The CLI ships with these baked in so a
// user only ever needs to paste their API key — never a URL. Both are
// overridable via env for self-hosted deployments. The previous
// dashboard-skillcheck.vercel.app domain permanently redirects here, so older
// CLI releases and saved configs keep working.
export const DEFAULT_CLOUD_API_URL = 'https://www.skillcheck.page/api';
export const DEFAULT_CLOUD_WEB_URL = 'https://www.skillcheck.page/app.html';
export const DEFAULT_CLOUD_PRICING_URL = 'https://www.skillcheck.page/#pricing';

export function cloudApiUrl(): string {
  return getConfiguredApiUrl() ?? DEFAULT_CLOUD_API_URL;
}

export function cloudWebUrl(): string {
  return process.env.SKILLCHECK_WEB_URL?.trim() || DEFAULT_CLOUD_WEB_URL;
}

// Where a user goes to add more runs once their free credits are gone.
export function cloudPricingUrl(): string {
  return process.env.SKILLCHECK_PRICING_URL?.trim() || DEFAULT_CLOUD_PRICING_URL;
}

export interface CloudKeyVerification {
  valid: boolean;
  plan?: string;
  email?: string;
  runsUsed?: number;
  runsLimit?: number | null;
  /** Distinguishes a rejected key (reachable, said no) from an unreachable cloud. */
  reachable: boolean;
  message?: string;
}

// Authenticate a pasted key against the hosted /key/verify endpoint. This does
// NOT consume a run. `reachable:false` means we never got a verdict (network
// down), so callers can treat it differently from an outright rejection.
export async function verifyCloudKey(apiUrl: string, token: string): Promise<CloudKeyVerification> {
  const base = apiUrl.trim().replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}/key/verify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}'
    });
  } catch (error) {
    return { valid: false, reachable: false, message: error instanceof Error ? error.message : String(error) };
  }

  let data: Record<string, unknown> = {};
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }

  if (response.ok && data.valid === true) {
    const limit = data.runsLimit;
    return {
      valid: true,
      reachable: true,
      plan: typeof data.plan === 'string' ? data.plan : undefined,
      email: typeof data.email === 'string' ? data.email : undefined,
      runsUsed: typeof data.runsUsed === 'number' ? data.runsUsed : undefined,
      runsLimit: typeof limit === 'number' ? limit : null
    };
  }

  // The key-check endpoint is missing — almost always an older deployment that
  // predates /api/key/verify. Don't reject a possibly-valid key; flag it as
  // "unavailable" so the user gets an actionable message instead of "rejected".
  if (response.status === 404 || response.status === 405) {
    return {
      valid: false,
      reachable: false,
      message: 'Skillcheck Cloud is missing the key-check endpoint (redeploy the dashboard so /api/key/verify ships).'
    };
  }

  const errorRecord = (data.error as Record<string, unknown> | undefined) ?? {};
  const message =
    typeof errorRecord.message === 'string'
      ? errorRecord.message
      : `The key was not accepted (HTTP ${response.status}).`;
  return { valid: false, reachable: true, message };
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

// Where the once-a-day "is there a newer version?" check caches its result, so the
// CLI doesn't hit the npm registry on every single run.
export function updateCachePath(): string {
  return path.join(configDir(), 'update-check.json');
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
      token: typeof record.token === 'string' ? record.token : undefined,
      provider: typeof record.provider === 'string' ? (record.provider as ProviderType) : undefined,
      providerKey: typeof record.providerKey === 'string' ? record.providerKey : undefined,
      providerBaseUrl: typeof record.providerBaseUrl === 'string' ? record.providerBaseUrl : undefined,
      generatorModel: typeof record.generatorModel === 'string' ? record.generatorModel : undefined,
      runnerModel: typeof record.runnerModel === 'string' ? record.runnerModel : undefined,
      graderModel: typeof record.graderModel === 'string' ? record.graderModel : undefined
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

// The hosted cloud moved from dashboard-skillcheck.vercel.app to
// www.skillcheck.page, and the apex domain redirects to www. Redirects strip
// the Authorization header in Node's fetch, so any saved config or env
// override still pointing at a legacy host would authenticate as "no key".
// Those URLs are migrated to the current host transparently.
const LEGACY_CLOUD_HOSTS = new Set(['dashboard-skillcheck.vercel.app', 'skillcheck.page']);

function migrateLegacyApiUrl(url: string | undefined): string | undefined {
  if (!url) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (LEGACY_CLOUD_HOSTS.has(parsed.hostname)) {
      parsed.hostname = 'www.skillcheck.page';
      return parsed.toString().replace(/\/+$/, '');
    }
  } catch {
    // Not parseable as a URL; leave it for downstream validation to report.
  }
  return url;
}

export function getConfiguredApiUrl(): string | undefined {
  return migrateLegacyApiUrl(process.env.SKILLCHECK_API_URL?.trim() || loadUserConfig().apiUrl);
}

export function getConfiguredToken(): string | undefined {
  return process.env.SKILLCHECK_TOKEN?.trim() || process.env.SKILLCHECK_API_KEY?.trim() || loadUserConfig().token;
}

export interface LogoutResult {
  /** True if a saved key was actually present and has now been removed. */
  removed: boolean;
  /** True if a key is still active via an environment variable (we can't clear that). */
  envOverride: boolean;
  path: string;
}

// Sign the user out of Skillcheck Cloud by deleting the saved API key. Any custom
// apiUrl is kept so a self-hosted deployment stays pointed at the right place; only
// the credential is dropped. A key set through SKILLCHECK_TOKEN/SKILLCHECK_API_KEY
// lives in the environment, not this file, so we can only tell the user about it.
export function logoutUser(): LogoutResult {
  const current = loadUserConfig();
  const removed = Boolean(current.token);
  const next: SkillcheckUserConfig = {};
  if (current.apiUrl) {
    next.apiUrl = current.apiUrl;
  }
  const path = saveUserConfig(next);
  const envOverride = Boolean(process.env.SKILLCHECK_TOKEN?.trim() || process.env.SKILLCHECK_API_KEY?.trim());
  return { removed, envOverride, path };
}
