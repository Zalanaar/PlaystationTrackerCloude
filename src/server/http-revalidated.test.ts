import { describe, expect, it } from 'vitest';
import { okRevalidated } from './http';

describe('okRevalidated (Фаза 47)', () => {
  it('200 с ETag и private, no-cache; совпавший If-None-Match = 304 без тела', async () => {
    const r1 = okRevalidated(new Request('http://x/api/stats'), { a: 1 });
    expect(r1.status).toBe(200);
    expect(r1.headers.get('cache-control')).toBe('private, no-cache');
    expect(r1.headers.get('vary')).toBe('Cookie');
    const etag = r1.headers.get('etag')!;
    expect(etag).toMatch(/^W\/".+"$/);
    expect(await r1.json()).toEqual({ ok: true, data: { a: 1 } });
    const r2 = okRevalidated(new Request('http://x/api/stats', { headers: { 'If-None-Match': `"other", ${etag}` } }), { a: 1 });
    expect(r2.status).toBe(304);
    expect(await r2.text()).toBe('');
    expect(r2.headers.get('etag')).toBe(etag);
  });

  it('другие данные = другой ETag и полный ответ', () => {
    const e1 = okRevalidated(new Request('http://x'), { a: 1 }).headers.get('etag')!;
    const r = okRevalidated(new Request('http://x', { headers: { 'If-None-Match': e1 } }), { a: 2 });
    expect(r.status).toBe(200);
    expect(r.headers.get('etag')).not.toBe(e1);
  });
});
