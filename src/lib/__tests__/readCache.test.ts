import { afterEach, describe, expect, it, vi } from 'vitest';
import { dataRevision } from '../../composables/sync/state';
import { cached, forgetReads, peek, peekAll, resetReadCache } from '../readCache';

const query = <T>(key: string, value: T) => ({ key, fetch: vi.fn(() => Promise.resolve(value)) });

describe('detail-page read cache (preloaded data must be the data the page shows)', () => {
  afterEach(() => {
    resetReadCache();
    dataRevision.value = 0;
  });

  it('reads once per data revision and hands the settled value to the next page mount', async () => {
    const heart = query('heart', [1, 2, 3]);
    await cached(heart);
    await cached(heart);
    expect(heart.fetch).toHaveBeenCalledTimes(1);
    expect(peek(heart)).toEqual({ value: [1, 2, 3], fresh: true });
  });

  it('after a sync lands, still hands out the last result at once (marked stale) and re-reads on the next load', async () => {
    const heart = query('heart', 64);
    await cached(heart);
    dataRevision.value += 1;
    expect(peek(heart)).toEqual({ value: 64, fresh: false });
    const reread = cached(heart);
    expect(peek(heart)).toEqual({ value: 64, fresh: false });
    await reread;
    expect(heart.fetch).toHaveBeenCalledTimes(2);
    expect(peek(heart)).toEqual({ value: 64, fresh: true });
  });

  it('does not keep failures (the next open retries) and only peeks a complete set', async () => {
    const broken = { key: 'broken', fetch: vi.fn(() => Promise.reject(new Error('busy'))) };
    await expect(cached(broken)).rejects.toThrow('busy');
    await expect(cached(broken)).rejects.toThrow('busy');
    expect(broken.fetch).toHaveBeenCalledTimes(2);
    const ok = query('ok', 'x');
    await cached(ok);
    expect(peekAll([ok, broken] as const)).toBeNull();
    expect(peekAll([ok] as const)).toEqual(['x']);
  });
  it('a background batch of far records does not push out the page that was just opened (least-recently-used eviction)', async () => {
    const opened = query('workout_detail:recent', 'recent');
    await cached(opened);
    for (let index = 0; index < 30; index += 1) await cached(query(`far:${index}`, index));
    expect(peek(opened)).not.toBeNull(); // 页面挂载时看了一眼：算用过，挪到队尾
    for (let index = 30; index < 70; index += 1) await cached(query(`far:${index}`, index));
    expect(peek(opened)?.value).toBe('recent');
    expect(peek(query('far:0', 0))).toBeNull();
  });

  it('never evicts a read that is still in flight, and forgets device reads on demand', async () => {
    let finish: (value: string) => void = () => undefined;
    const slow = { key: 'slow', fetch: vi.fn(() => new Promise<string>((resolve) => { finish = resolve; })) };
    const pending = cached(slow);
    for (let index = 0; index < 60; index += 1) await cached(query(`far:${index}`, index));
    finish('done');
    await pending;
    expect(peek(slow)?.value).toBe('done');
    const device = query('device_profile:zepp:1', { name: 'old' });
    await cached(device);
    forgetReads('device_profile:', 'workout_device:');
    expect(peek(device)).toBeNull();
  });
});
