import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_NAME = '@sx4im/skillcheck';

// Find this package's own package.json by name, walking up from the compiled
// module. Works the same whether running from dist/ (published) or source
// (dev/tsx). Lives in its own module so both ui.ts (banner version) and
// update.ts (update check) can use it without importing each other.
function readSelfPackage(): { version?: string } {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === PKG_NAME) {
        return pkg;
      }
    } catch {
      // keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return {};
}

// Memoized: the banner asks for the version on every picker redraw, and the
// answer can't change mid-process.
let cachedVersion: string | undefined;

export function currentVersion(): string {
  if (cachedVersion === undefined) {
    const version = readSelfPackage().version;
    cachedVersion = typeof version === 'string' && version ? version : '0.0.0';
  }
  return cachedVersion;
}
