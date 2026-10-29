import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as catalogGet } from './catalog/search/route';
import { PUT as orderPut } from './order/route';
import { DELETE as plannedDelete, PATCH as plannedPatch } from './planned/[id]/route';
import { GET as plannedGet, POST as plannedPost } from './planned/route';
import { PUT as settingsPut } from './settings/route';

const json = { 'content-type': 'application/json' };
const evil = { ...json, origin: 'http://evil.example', host: 'x' };
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body: unknown, headers: Record<string, string> = json) =>
  new Request('http://x/api/roadmap', { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
const code = async (r: Response) => (await r.json()).error.code;

// Валидация идёт до обращения к БД: тесты не требуют DATABASE_URL.
describe('валидация API роадмапа (без БД)', () => {
  it('PUT settings', async () => {
    const bads: unknown[] = [{}, { year: 2026 }, { year: '2026', hoursPerWeek: 5 }, { year: 2026, hoursPerWeek: 0 }, { year: 2026, hoursPerWeek: -1 }, { year: 2026, hoursPerWeek: 169 },
      { year: 2026, hoursPerWeek: '5' }, { year: 2026.5, hoursPerWeek: 5 }, { year: 1999, hoursPerWeek: 5 }, { year: 2026, hoursPerWeek: 0.04 }, { year: 2026, hoursPerWeek: 5, extra: 1 }, '{bad', []];
    for (const b of bads) expect((await settingsPut(req('PUT', b))).status, JSON.stringify(b)).toBe(400);
    expect((await settingsPut(req('PUT', { year: 2026, hoursPerWeek: 5 }, {}))).status).toBe(400);
    expect((await settingsPut(req('PUT', { year: 2026, hoursPerWeek: 5 }, evil))).status).toBe(400);
  });

  it('POST planned', async () => {
    const bads: unknown[] = [{}, { title: '' }, { title: '   ' }, { title: 'x'.repeat(201) }, { title: 'A', releaseDate: '2026-02-30' }, { title: 'A', releaseDate: '01.02.2026' },
      { title: 'A', coverUrl: 'http://x/a.jpg' }, { title: 'A', coverUrl: 'javascript:alert(1)' }, { title: 'A', hoursManual: 0 }, { title: 'A', hoursManual: 1001 }, { title: 'A', hoursManual: '5' },
      { title: 'A', wantAtRelease: true }, { title: 'A', wantAtRelease: 'yes' }, { title: 'A', externalSource: 'rawg' }, { title: 'A', externalId: '1' }, { title: 'A', externalSource: 'igdb', externalId: '1' },
      { title: 'A', status: 'done' }];
    for (const b of bads) expect((await plannedPost(req('POST', b))).status, JSON.stringify(b)).toBe(400);
    const r = await plannedPost(req('POST', { title: 'A', wantAtRelease: true }));
    expect((await r.json()).error.details).toEqual({ reason: 'want_requires_release_date' });
    expect((await plannedPost(req('POST', { title: 'A' }, {}))).status).toBe(400);
    expect((await plannedPost(req('POST', { title: 'A' }, evil))).status).toBe(400);
  });

  it('GET planned: неизвестный status', async () => {
    const r = await plannedGet(new Request('http://x/api/roadmap/planned?status=zzz'));
    expect(r.status).toBe(400);
    expect(await code(r)).toBe('invalid_request');
  });

  it('PATCH / DELETE planned/{id}', async () => {
    expect((await plannedPatch(req('PATCH', { title: 'A' }), params('abc'))).status).toBe(400);
    expect((await plannedPatch(req('PATCH', { title: 'A' }), params('0'))).status).toBe(400);
    expect((await plannedPatch(req('PATCH', {}), params('1'))).status).toBe(400);
    expect((await plannedPatch(req('PATCH', { externalId: '5' }), params('1'))).status).toBe(400);
    expect((await plannedPatch(req('PATCH', { status: 'wat' }), params('1'))).status).toBe(400);
    expect((await plannedPatch(req('PATCH', { title: 'A' }, {}), params('1'))).status).toBe(400);
    expect((await plannedDelete(new Request('http://x', { method: 'DELETE' }), params('x'))).status).toBe(400);
    expect((await plannedDelete(new Request('http://x', { method: 'DELETE', headers: { origin: 'http://evil.example', host: 'x' } }), params('1'))).status).toBe(400);
  });

  it('PUT order', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1);
    for (const b of [{}, { gameIds: 'x' }, { gameIds: ids }, { gameIds: [1, 1] }, { gameIds: [0] }, { gameIds: [1.5] }, { gameIds: ['1'] }, { gameIds: [-1] }, [], '{bad']) {
      expect((await orderPut(req('PUT', b))).status, JSON.stringify(b)).toBe(400);
    }
    expect((await orderPut(req('PUT', { gameIds: [1] }, evil))).status).toBe(400);
  });
});

describe('GET /api/roadmap/catalog/search', () => {
  const saved = process.env.RAWG_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.RAWG_API_KEY;
    else process.env.RAWG_API_KEY = saved;
  });
  const get = (q: string) => catalogGet(new Request(`http://x/api/roadmap/catalog/search${q}`));

  it('короткий и длинный запрос = 400', async () => {
    for (const q of ['', '?q=', '?q=a', '?q=%20a%20', `?q=${'x'.repeat(101)}`]) expect((await get(q)).status, q).toBe(400);
  });

  it('нет ключа = 503 catalog_unavailable с понятным кодом, без утечек', async () => {
    delete process.env.RAWG_API_KEY;
    const r = await get('?q=hades');
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.error).toMatchObject({ code: 'catalog_unavailable', details: { reason: 'no_key' } });
  });

  it('playstation: мусор = 400, 1 уходит в RAWG как platforms', async () => {
    expect((await get('?q=hades&playstation=maybe')).status).toBe(400);
    process.env.RAWG_API_KEY = 'KEY_SECRET_XYZ';
    let seen = '';
    vi.stubGlobal('fetch', async (u: URL) => {
      seen = u.toString();
      return new Response(JSON.stringify({ results: [] }));
    });
    expect((await get('?q=hades&playstation=1')).status).toBe(200);
    expect(seen).toContain('platforms=187%2C18');
    vi.unstubAllGlobals();
  });

  it('с ключом: кандидаты в конверте; сбой RAWG = 503 без ключа в ответе', async () => {
    process.env.RAWG_API_KEY = 'KEY_SECRET_XYZ';
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ results: [{ id: 7, name: 'Hades II', released: '2026-05-01', platforms: [] }] })));
    const ok = await get('?q=hades');
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.candidates).toEqual([expect.objectContaining({ externalSource: 'rawg', externalId: '7', title: 'Hades II', releaseDate: '2026-05-01' })]);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed https://api.rawg.io/api/games?key=KEY_SECRET_XYZ');
    });
    const bad = await get('?q=hades');
    expect(bad.status).toBe(503);
    const text = await bad.text();
    expect(text).toContain('catalog_unavailable');
    expect(text).not.toContain('KEY_SECRET_XYZ');
    vi.unstubAllGlobals();
  });
});
