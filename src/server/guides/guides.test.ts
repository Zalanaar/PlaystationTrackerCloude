// F2-B (пакет 3): индекс гайдов PowerPyx — ключ названия, разбор, детект челленджа, недельное обновление без затирания,
// точное сопоставление на 208 реальных названиях, своя ссылка и «Не тот гайд».
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { guideKey } from '@/shared/guide-key';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { lookupKeys } from './aliases';
import { getGameGuide, normalizeGuideUrl, parseGuideBody, setGameGuide } from './game-guide';
import { checkIndexResponse, MIN_INDEX_ROWS, parseGuideIndex } from './powerpyx';
import { findGuide, pickGuide, refreshGuideIndex } from './store';
import fixture from './__fixtures__/powerpyx-match-2026-11-03.json';

const ALIASED = new Set(['Resident Evil Village', 'Resident Evil Requiem', "Assassin's Creed Black Flag Resynced", 'METAL GEAR SOLID Δ: SNAKE EATER']);
const row = (title: string, slug: string, wiki = false) =>
  `<tr><td class="column-1"><a href="https://www.powerpyx.com/${slug}-trophy-guide-roadmap/">${title}</a>${wiki ? ` | <a href="https://www.powerpyx.com/${slug}-wiki-strategy-guide/">Wiki</a>` : ''}</td><td class="column-2">2026-01-01</td></tr>`;
const page = (n: number, title = 'Trophy Guides') =>
  `<html><head><title>${title}</title></head><body><table><tr><th class="column-1">Game</th></tr>${Array.from({ length: n }, (_, i) => row(`Game ${i}`, `game-${i}`)).join('')}${row('New Game &#8211; Remake', 'new-game', true)}</table></body></html>`;
const res = (body: string, init: ResponseInit = { status: 200 }) => new Response(body, init);

describe('guideKey и алиасы', () => {
  it('нормализация: знаки ™ ®, римские цифры, платформа/издание, скобки', () => {
    expect(guideKey('Little Nightmares III')).toBe(guideKey('Little Nightmares 3'));
    expect(guideKey('Grand Theft Auto V (PlayStation®5)')).toBe(guideKey('Grand Theft Auto 5'));
    expect(guideKey('LEGO® Batman™: Legacy of the Dark Knight')).toBe('lego batman legacy dark knight');
    expect(guideKey('Assassin’s Creed')).toBe(guideKey("Assassin's Creed"));
    expect(guideKey('™')).toBe('');
  });
  it('алиасы: RE 8/9, AC 4, MGS Δ; без алиаса — один ключ', () => {
    expect(lookupKeys('Resident Evil Village')).toEqual(['resident evil village', 'resident evil 8 village']);
    expect(lookupKeys('METAL GEAR SOLID Δ: SNAKE EATER')[1]).toBe(guideKey('Metal Gear Solid 3 Delta: Snake Eater (Remake)'));
    expect(lookupKeys('Hades')).toEqual(['hades']);
    expect(lookupKeys('')).toEqual([]);
  });
});

describe('разбор индекса и детект челленджа', () => {
  it('гайд + вики, сущности, DLC и чужие ссылки пропускаются', () => {
    const html = `<table>${row('A Plague Tale: Requiem', 'apt', true)}${row('Some DLC Pack', 'dlc')}` +
      `<tr><td class="column-1"><a href="https://evil.example/x/">Evil</a></td></tr>${row('Assassin&#8217;s Creed &amp; Co', 'ac')}</table>`;
    const e = parseGuideIndex(html);
    expect(e.map((x) => [x.title, x.kind])).toEqual([['A Plague Tale: Requiem', 'trophy'], ['A Plague Tale: Requiem', 'wiki'], ['Assassin’s Creed & Co', 'trophy']]);
    expect(e[0].url).toBe('https://www.powerpyx.com/apt-trophy-guide-roadmap/');
    expect(e[0].titleKey).toBe(guideKey('A Plague Tale: Requiem'));
  });
  it('челлендж «One moment», cf-mitigated, мало строк — не каталог', () => {
    expect(checkIndexResponse(new Headers(), page(600, 'One moment, please...'))).toEqual({ ok: false, outcome: 'challenge' });
    expect(checkIndexResponse(new Headers({ 'cf-mitigated': 'challenge' }), page(600))).toEqual({ ok: false, outcome: 'challenge' });
    expect(checkIndexResponse(new Headers(), page(MIN_INDEX_ROWS - 2))).toEqual({ ok: false, outcome: 'too_few' });
    const ok = checkIndexResponse(new Headers(), page(MIN_INDEX_ROWS));
    expect(ok.ok && ok.entries.length).toBe(MIN_INDEX_ROWS + 2);
  });
  it('pickGuide: ключ важнее алиаса, вики того же названия', () => {
    const rows = [
      { id: 3, title: 'B', titleKey: 'alias', url: 'u3', kind: 'trophy' },
      { id: 2, title: 'A', titleKey: 'self', url: 'u2', kind: 'trophy' },
      { id: 4, title: 'A', titleKey: 'self', url: 'w2', kind: 'wiki' },
    ];
    expect(pickGuide(rows, ['self', 'alias'])).toEqual({ title: 'A', url: 'u2', wikiUrl: 'w2' });
    expect(pickGuide(rows.slice(0, 1), ['self', 'alias'])).toEqual({ title: 'B', url: 'u3', wikiUrl: null });
    expect(pickGuide([], ['x'])).toBeNull();
  });
});

describe('БД: снимок, обновление, сопоставление', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(async () => { await t.close(); });
  beforeEach(async () => { await t.reset(); });

  const count = async () => Number((await t.pg.execute(sql`select count(*)::int as n from guide_index`)).rows[0].n);
  const runs = async () => (await t.pg.execute(sql`select outcome, rows from guide_index_runs order by id`)).rows;

  it('сид миграции: ≥500 гайдов; точное совпадение на 208 названиях — ровно ожидаемые + алиасы, префиксы никогда', async () => {
    expect(await count()).toBeGreaterThan(MIN_INDEX_ROWS);
    for (const [lib, pp] of fixture.exact) {
      const m = await findGuide(t.db, lib);
      expect(m, lib).not.toBeNull();
      expect(guideKey(m!.title), lib).toBe(guideKey(pp));
    }
    for (const lib of [...fixture.prefix, ...fixture.none]) {
      const m = await findGuide(t.db, lib);
      if (ALIASED.has(lib)) expect(m, lib).not.toBeNull();
      else expect(m, lib).toBeNull();
    }
    expect((await findGuide(t.db, 'Resident Evil Village'))?.title).toBe('Resident Evil 8 Village');
    expect((await findGuide(t.db, 'Resident Evil Village'))?.wikiUrl).toMatch(/^https:\/\/www\.powerpyx\.com\//);
  });

  it('свежий снимок (<7 дней) — без запроса; старый — один запрос; челлендж не затирает; повтор не раньше 20 ч', async () => {
    let calls = 0;
    const seedAt = new Date('2026-11-03T07:46:00Z');
    const before = await count();
    const f = (r: () => Response) => (async () => { calls++; return r(); }) as unknown as typeof fetch;
    expect(await refreshGuideIndex(t.db, f(() => res(page(600))), new Date(seedAt.getTime() + 6 * 86_400_000))).toBe('skipped_fresh');
    expect(calls).toBe(0);
    const d8 = new Date(seedAt.getTime() + 8 * 86_400_000);
    expect(await refreshGuideIndex(t.db, f(() => res(page(600, 'One moment, please...'))), d8)).toBe('challenge');
    expect(await count()).toBe(before);
    expect(await refreshGuideIndex(t.db, f(() => res(page(600))), new Date(d8.getTime() + 3600_000))).toBe('skipped_recent_attempt');
    expect(calls).toBe(1);
    const d9 = new Date(d8.getTime() + 86_400_000);
    expect(await refreshGuideIndex(t.db, f(() => res('', { status: 403, headers: { 'cf-mitigated': 'challenge' } })), d9)).toBe('challenge');
    const d10 = new Date(d9.getTime() + 86_400_000);
    expect(await refreshGuideIndex(t.db, (async () => { throw new Error('net'); }) as unknown as typeof fetch, d10)).toBe('network_error');
    expect(await count()).toBe(before);
    const d11 = new Date(d10.getTime() + 86_400_000);
    expect(await refreshGuideIndex(t.db, f(() => res(page(600))), d11)).toBe('ok');
    expect(await count()).toBe(602);
    expect((await findGuide(t.db, 'New Game – Remake'))?.wikiUrl).toBe('https://www.powerpyx.com/new-game-wiki-strategy-guide/');
    expect(await findGuide(t.db, 'Resident Evil Village')).toBeNull(); // снимок заменён целиком
    expect(await refreshGuideIndex(t.db, f(() => res(page(600))), new Date(d11.getTime() + 2 * 86_400_000))).toBe('skipped_fresh');
    expect((await runs()).map((r) => r.outcome)).toEqual(['challenge', 'challenge', 'network_error', 'ok']);
  });

  it('своя ссылка и «Не тот гайд»: дубль пишет на главную, изоляция по пользователю', async () => {
    // снимок мог замениться в тесте обновления: нужная строка каталога — явно
    await t.pg.execute(sql`insert into guide_index (source, title, title_key, url, kind) values ('powerpyx', 'Resident Evil 8 Village', 'resident evil 8 village', 'https://www.powerpyx.com/resident-evil-8-village-trophy-guide-roadmap/', 'trophy') on conflict do nothing`);
    await t.pg.execute(sql`insert into allowed_users (id, email, role, status) overriding system value values (2, 'b@example.com', 'member', 'active') on conflict do nothing`);
    const ins = async (userId: typeof TEST_USER, titleId: string, name: string, dup: number | null = null) =>
      (await t.db.insert(schema.games).values({ userId, titleId, name, category: 'ps5_native_game', lastSeenAt: new Date(), duplicateOfGameId: dup }).returning({ id: schema.games.id }))[0].id;
    const main = await ins(TEST_USER, 'CUSA1', 'Resident Evil Village');
    const dup = await ins(TEST_USER, 'PPSA1', 'Resident Evil Village', main);
    const other = await ins(TEST_USER_2, 'CUSA1', 'Resident Evil Village');

    const g0 = await getGameGuide(t.db, TEST_USER, dup);
    expect(g0).toMatchObject({ override: null, dismissed: false, match: { title: 'Resident Evil 8 Village' } });

    const r1 = await setGameGuide(t.db, TEST_USER, dup, { dismissed: true });
    expect(r1.gameId).toBe(main);
    expect(r1.guide).toEqual({ match: null, override: null, dismissed: true });
    const r2 = await setGameGuide(t.db, TEST_USER, main, { override: 'https://example.com/guide' });
    expect(r2.guide).toEqual({ match: null, override: 'https://example.com/guide', dismissed: true });
    // другой пользователь не затронут
    expect((await getGameGuide(t.db, TEST_USER_2, other)).dismissed).toBe(false);
    await expect(getGameGuide(t.db, TEST_USER_2, main)).rejects.toThrow();
    const r3 = await setGameGuide(t.db, TEST_USER, main, { override: null, dismissed: false });
    expect(r3.guide.match?.title).toBe('Resident Evil 8 Village');
    // CHECK: только https
    await expect(t.pg.execute(sql`update games set guide_url_override = 'http://x.y' where id = ${main}`)).rejects.toThrow();
  });
});

describe('тело PUT /api/games/{id}/guide', () => {
  it('валидация ссылки и полей', () => {
    expect(normalizeGuideUrl(' https://psnprofiles.com/guide/1 ')).toBe('https://psnprofiles.com/guide/1');
    expect(normalizeGuideUrl('http://x.com')).toBeNull();
    expect(normalizeGuideUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeGuideUrl('https://a b.com')).toBeNull();
    expect(normalizeGuideUrl('https://localhost/')).toBeNull();
    expect(normalizeGuideUrl(`https://x.com/${'a'.repeat(500)}`)).toBeNull();
    expect(parseGuideBody({ override: '' })).toEqual({ ok: true, value: { override: null } });
    expect(parseGuideBody({ dismissed: true })).toEqual({ ok: true, value: { dismissed: true } });
    expect(parseGuideBody({}).ok).toBe(false);
    expect(parseGuideBody({ dismissed: 'yes' }).ok).toBe(false);
    expect(parseGuideBody({ override: 'ftp://x' }).ok).toBe(false);
    expect(parseGuideBody({ other: 1 }).ok).toBe(false);
    expect(parseGuideBody([]).ok).toBe(false);
  });
});
