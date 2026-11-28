import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { providerFetch, readProviderJson } from './providers/transport.js';
import { isProviderType, type ProviderType } from './providers/types.js';
import { ConfigError, IoError } from './errors.js';
import { baseUrl, validateEndpoint } from './core/security/endpoint.js';
import { registerSecret, sanitizeTerminal } from './core/security/output.js';

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
  const base = baseUrl(apiUrl);
  registerSecret(token);
  let response: Response;
  try {
    response = await providerFetch(`${base}/key/verify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    return { valid: false, reachable: false, message: sanitizeTerminal(error instanceof Error ? error.message : String(error)) };
  }

  let data: Record<string, unknown> = {};
  try {
    const parsed = await readProviderJson(response, 'Cloud key verification');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
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
      ? sanitizeTerminal(errorRecord.message)
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
  const url = validateEndpoint(value.trim());
  if (url.pathname === '/') url.pathname = '/v1';
  return url.href.replace(/\/+$/, '');
}

const configFields = new Set([
  'apiUrl', 'token', 'provider', 'providerKey', 'providerBaseUrl', 'generatorModel', 'runnerModel', 'graderModel'
]);

function parseUserConfig(parsed: unknown): SkillcheckUserConfig {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError('Config must be a JSON object.');
  }
  const entry = parsed as Record<string, unknown>;
  if (Object.entries(entry).some(([key, value]) => !configFields.has(key) || typeof value !== 'string')) {
    throw new ConfigError('Config contains an unknown field or a non-string value.');
  }
  if (entry.provider !== undefined && !isProviderType(entry.provider)) {
    throw new ConfigError('Config has an unsupported provider.');
  }
  const config = entry as SkillcheckUserConfig;
  registerSecret(config.token);
  registerSecret(config.providerKey);
  if (config.apiUrl) validateEndpoint(config.apiUrl);
  if (config.providerBaseUrl) validateEndpoint(config.providerBaseUrl);
  return config;
}

export function loadUserConfig(): SkillcheckUserConfig {
  const file = userConfigPath();
  try {
    if (statSync(file).size > 64 * 1024) throw new ConfigError('Config exceeds 64 KiB.');
    return parseUserConfig(JSON.parse(readFileSync(file, 'utf8')));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {};
    if (cause instanceof ConfigError) throw cause;
    throw new ConfigError('Could not read the Skillcheck config as JSON: ' + file, { cause });
  }
}

export function saveUserConfig(config: SkillcheckUserConfig): string {
  const filePath = userConfigPath();
  const temporary = filePath + '.' + randomUUID() + '.tmp';
  try {
    mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    renameSync(temporary, filePath);
  } catch (cause) {
    rmSync(temporary, { force: true });
    throw new IoError('Could not save the Skillcheck config: ' + filePath, { cause });
  }
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
  const value = migrateLegacyApiUrl(process.env.SKILLCHECK_API_URL?.trim() || loadUserConfig().apiUrl);
  return value ? baseUrl(value) : undefined;
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
