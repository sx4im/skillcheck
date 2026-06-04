import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hashJson } from './hash.js';

export class JsonCache {
  constructor(private readonly rootDir = '.cache/skillcheck') {}

  async getOrSet<T>(namespace: string, keyParts: unknown, factory: () => Promise<T>): Promise<T> {
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
