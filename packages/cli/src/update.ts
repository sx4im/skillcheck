import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { updateCachePath } from './config.js';
import {
  printUpdateApplied,
  printUpdateAvailable,
  printUpdateFailed,
  printUpdateSkipped,
  promptText
} from './ui.js';
import { currentVersion } from './version.js';

export { currentVersion } from './version.js';

const PKG_NAME = '@sx4im/skillcheck';
// Only hit the registry once a day; in between we decide from the cached result.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Never let the version check delay startup — a slow/offline registry is ignored.
const FETCH_TIMEOUT_MS = 1500;

interface UpdateCache {
  lastCheck?: number;
  latest?: string;
  /** A version the user explicitly declined, so we don't nag again for that one. */
  skipped?: string;
}

function coreParts(version: string): number[] {
  const core = version.split('-')[0] ?? version; // drop any prerelease suffix
  return core.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

// True if `latest` is a strictly newer release than `current` (major.minor.patch).
export function isNewerVersion(latest: string, current: string): boolean {
  const a = coreParts(latest);
  const b = coreParts(current);
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) {
      return left > right;
    }
  }
  return false;
}

async function fetchLatestVersion(): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    if (!response.ok) {
      return undefined;
    }
    const data = (await response.json()) as { version?: unknown };
    return typeof data.version === 'string' ? data.version : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function loadCache(): UpdateCache {
  try {
    const parsed = JSON.parse(readFileSync(updateCachePath(), 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as UpdateCache) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: UpdateCache): void {
  try {
    const filePath = updateCachePath();
    mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    writeFileSync(filePath, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // A non-writable config dir must never break the CLI; just skip caching.
  }
}

// Run the global install. Inherits stdio so the user sees npm's own progress.
// On Windows npm is npm.cmd, which spawnSync only resolves through a shell.
function runGlobalUpdate(): boolean {
  const result = spawnSync('npm', ['install', '-g', `${PKG_NAME}@latest`], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  return result.status === 0;
}

async function promptAndUpdate(current: string, latest: string): Promise<void> {
  printUpdateAvailable(current, latest);
  const answer = (await promptText('Update now? [Y/n] ')).trim().toLowerCase();
  if (answer === '' || answer === 'y' || answer === 'yes') {
    if (runGlobalUpdate()) {
      printUpdateApplied(latest);
    } else {
      printUpdateFailed();
    }
    return;
  }
  // Remember the decline so we don't ask again until a newer version ships.
  saveCache({ ...loadCache(), skipped: latest });
  printUpdateSkipped(latest);
}

// If a newer version is on npm, tell the user and offer to update — the way Codex
// and Gemini CLIs do. Safe to call unconditionally: it no-ops for non-interactive
// sessions, CI, or when SKILLCHECK_NO_UPDATE_CHECK=1, and never throws.
export async function maybeNotifyUpdate(): Promise<void> {
  try {
    if (process.env.SKILLCHECK_NO_UPDATE_CHECK === '1' || process.env.CI) {
      return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return;
    }

    const current = currentVersion();
    const cache = loadCache();
    const now = Date.now();

    let latest = cache.latest;
    const stale = !cache.lastCheck || now - cache.lastCheck > CHECK_INTERVAL_MS || !latest;
    if (stale) {
      const fetched = await fetchLatestVersion();
      // Throttle either way so an offline run doesn't retry the registry every time.
      saveCache({ ...cache, lastCheck: now, ...(fetched ? { latest: fetched } : {}) });
      if (!fetched) {
        return;
      }
      latest = fetched;
    }

    if (!latest || !isNewerVersion(latest, current)) {
      return;
    }
    if (loadCache().skipped === latest) {
      return; // user already declined this exact version
    }

    await promptAndUpdate(current, latest);
  } catch {
    // The update check is a courtesy; it must never interrupt the real command.
  }
}
