import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonCache } from '../src/cache.js';

describe('JsonCache', () => {
  it('reuses a stored value for the same key', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-cache-'));
    const cache = new JsonCache(cacheDir);
    let calls = 0;
    const factory = async () => {
      calls += 1;
      return calls;
    };

    const first = await cache.getOrSet('ns', { key: 1 }, factory);
    const second = await cache.getOrSet('ns', { key: 1 }, factory);

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(calls).toBe(1);
  });

  it('recomputes for different keys', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'skillcheck-cache-'));
    const cache = new JsonCache(cacheDir);
    let calls = 0;
    const factory = async () => {
      calls += 1;
      return calls;
    };

    await cache.getOrSet('ns', { key: 1 }, factory);
    await cache.getOrSet('ns', { key: 2 }, factory);

    expect(calls).toBe(2);
  });

  it('disabled() always calls the factory and never reuses a value', async () => {
    // This is what `verify` relies on: every call hits the model fresh.
    const cache = JsonCache.disabled();
    let calls = 0;
    const factory = async () => {
      calls += 1;
      return calls;
    };

    const first = await cache.getOrSet('ns', { key: 1 }, factory);
    const second = await cache.getOrSet('ns', { key: 1 }, factory);

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });
});
