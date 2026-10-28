import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHltbRun } from './api';
import { HltbCallError } from './hltbRun';

afterEach(() => vi.unstubAllGlobals());

describe('fetchHltbRun', () => {
  it('передаёт signal в fetch; отмена в полёте даёт AbortError, а не HltbCallError', async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_res, rej) => {
      seen = init.signal as AbortSignal;
      seen.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const ac = new AbortController();
    const p = fetchHltbRun({}, ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toBe(ac.signal);
  });

  it('400 since_in_future: reason доходит до HltbCallError', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: false, error: { code: 'invalid_request', message: 'x', details: { reason: 'since_in_future' } } }), { status: 400 }));
    const e = await fetchHltbRun({ recheckNotFound: true, since: 'x' }).catch((x) => x);
    expect(e).toBeInstanceOf(HltbCallError);
    expect(e).toMatchObject({ status: 400, code: 'invalid_request', reason: 'since_in_future' });
  });

  it('без отмены сетевой сбой остаётся сбоем', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fail'); });
    await expect(fetchHltbRun({})).rejects.toMatchObject({ status: 0, code: 'network' });
  });
});
