import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashJson } from './hash.js';

export class JsonCache {
  constructor(
    private readonly rootDir = '.cache/skillcheck',
    private readonly enabled = true
  ) {}

  /**
   * A cache that never reads or writes: every `getOrSet` calls its factory.
   * Used by `verify`, which must independently re-query the model rather than
   * replay the original run's cached outputs (otherwise verification is a
   * tautology on the machine that produced the result).
   */
  static disabled(): JsonCache {
    return new JsonCache(undefined, false);
  }

  async getOrSet<T>(namespace: string, keyParts: unknown, factory: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return factory();
    }

    const key = hashJson(keyParts);
    const dir = path.join(this.rootDir, namespace);
    const file = path.join(dir, `${key}.json`);

    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const value = await factory();
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(value, null, 2));
    return value;
  }
}
