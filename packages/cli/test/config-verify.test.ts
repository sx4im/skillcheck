import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyCloudKey } from '../src/config.js';
import { verifyResult } from '../src/verify.js';

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

describe('verifyCloudKey', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts a valid key and surfaces plan + remaining runs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { valid: true, plan: 'free', email: 'a@b.c', runsUsed: 3, runsLimit: 10 })
    );
    const result = await verifyCloudKey('https://api.test/api', 'chk_live_x');
    expect(result).toMatchObject({ valid: true, reachable: true, plan: 'free', runsUsed: 3, runsLimit: 10 });
  });

  it('treats an unlimited (null) limit as a pro account', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, { valid: true, plan: 'pro', runsLimit: null }));
    const result = await verifyCloudKey('https://api.test/api', 'chk_live_x');
    expect(result.valid).toBe(true);
    expect(result.runsLimit).toBeNull();
  });

  it('reports a reachable rejection for a bad key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(401, { error: { message: 'nope' } }));
    const result = await verifyCloudKey('https://api.test/api', 'bad');
    expect(result).toMatchObject({ valid: false, reachable: true, message: 'nope' });
  });

  it('flags a missing key-check endpoint (old deployment) as unreachable, not rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(404, {}));
    const result = await verifyCloudKey('https://api.test/api', 'chk_live_x');
    expect(result.valid).toBe(false);
    expect(result.reachable).toBe(false);
    expect(result.message).toMatch(/key-check endpoint/i);
  });

  it('does not accept an oversized or malformed verification response', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ valid: true, padding: 'x'.repeat(2 * 1024 * 1024) }))
      .mockResolvedValueOnce(new Response('unexpected text'));
    for (let i = 0; i < 2; i += 1) {
      const result = await verifyCloudKey('https://api.test/api', 'chk_live_x');
      expect(result.valid).toBe(false);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns unreachable when the network call throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await verifyCloudKey('https://api.test/api', 'chk_live_x');
    expect(result).toMatchObject({ valid: false, reachable: false });
    expect(result.message).toMatch(/ECONNREFUSED/);
  });
});

describe('verifyResult validation', () => {
  it('refuses to verify a result that is missing reproducibility metadata', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-verify-'));
    const file = path.join(dir, 'result.json');
    await writeFile(file, JSON.stringify({ skill: {}, result: {}, config: {} }));
    await expect(verifyResult({ resultPath: file, sample: 1 })).rejects.toThrow(/cannot be verified/i);
  });

  it('reports malformed JSON and paths before contacting the provider', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'skillcheck-verify-'));
    const file = path.join(dir, 'result.json');
    await expect(verifyResult({ resultPath: file, sample: 1 })).rejects.toThrow(/read the result file/i);
    await writeFile(file, 'broken JSON');
    await expect(verifyResult({ resultPath: file, sample: 1 })).rejects.toThrow(/valid JSON/i);
    await writeFile(file, JSON.stringify({
      skill: { source: path.join(dir, 'missing.md') },
      config: { trials: 1 },
      result: { ci_pp: [-5, 10] },
      reproducibility: { task_suite_path: 'tasks.json' }
    }));
    await expect(verifyResult({ resultPath: file, sample: 1 })).rejects.toThrow(/referenced skill/i);
  });
});
