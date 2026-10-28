import { describe, expect, it, vi } from 'vitest';
import played from './__fixtures__/played-games.json';
import trophyTitles from './__fixtures__/trophy-titles.json';
import trophyData from './__fixtures__/trophies.json';
import { decryptToken, encryptToken } from './crypto';
import { PsnError, classifyPsnError, safeErr } from './errors';
import { mapEarnedTrophy, mapPlayedTitle, mapPlayedTitles, mapProfile, mapTrophyDef, pickBanner, mapTrophyTitle, parseIsoDuration } from './mapping';
import { connectPsn } from './client';
import { fakeApi, freshState } from '@/server/sync/test-helpers';

describe('parseIsoDuration', () => {
  it('разбирает часы, минуты, секунды', () => {
    expect(parseIsoDuration('PT228H56M33S')).toBe(228 * 3600 + 56 * 60 + 33);
    expect(parseIsoDuration('PT7H')).toBe(7 * 3600);
    expect(parseIsoDuration('PT45M10S')).toBe(2710);
    expect(parseIsoDuration('PT0S')).toBe(0);
  });
  it('дни, дробные секунды, мусор', () => {
    expect(parseIsoDuration('P1DT1H')).toBe(90000);
    expect(parseIsoDuration('PT0.6S')).toBe(1);
    expect(parseIsoDuration('abc')).toBe(0);
    expect(parseIsoDuration(undefined)).toBe(0);
    expect(parseIsoDuration('PT999999999H')).toBe(2_147_483_647);
  });
});

describe('mapPlayedTitle', () => {
  const t = (i: number) => played.titles[i];
  it('маппит игру PS4', () => {
    const g = mapPlayedTitle(t(0));
    expect(g).toMatchObject({
      titleId: 'CUSA00001_00',
      conceptId: '1001',
      name: 'Alpha Quest™',
      category: 'ps4_game',
      genres: ['ACTION', 'ADVENTURE'],
      playDurationSeconds: 37805,
      playCount: 14,
      imageUrl: 'https://img.example/alpha.png',
    });
    expect(g?.lastPlayedAt?.toISOString()).toBe('2026-10-01T21:30:00.120Z');
  });
  it('localizedName в приоритете, картинка из concept.media при пустом imageUrl', () => {
    const g = mapPlayedTitle(t(5));
    expect(g?.name).toBe('Эпсилон');
    expect(g?.imageUrl).toBe('https://img.example/eps-concept.jpg');
    expect(g?.category).toBe('pspc_game');
  });
  it('не-игры отбрасываются по category', () => {
    expect(mapPlayedTitle(t(6))).toBeNull();
    const r = mapPlayedTitles(played.titles);
    expect(r.games).toHaveLength(6);
    expect(r.skipped).toBe(1);
  });
  it('устойчив к мусору', () => {
    expect(mapPlayedTitle(null)).toBeNull();
    expect(mapPlayedTitle({ category: 'ps4_game' })).toBeNull();
    const g = mapPlayedTitle({ titleId: 'X', name: 'N', category: 'ps4_game', playDuration: 5, lastPlayedDateTime: 'не дата' });
    expect(g).toMatchObject({ playDurationSeconds: 0, lastPlayedAt: null, genres: [], conceptId: null });
  });
  it('дубли titleId схлопываются', () => {
    const a = { ...t(0), playDuration: 'PT1H' };
    const b = { ...t(0), playDuration: 'PT2H' };
    const r = mapPlayedTitles([a, b]);
    expect(r.games).toHaveLength(1);
    expect(r.games[0].playDurationSeconds).toBe(7200);
  });
});

describe('mapTrophyTitle / трофеи', () => {
  it('маппит сет', () => {
    const s = mapTrophyTitle(trophyTitles.trophyTitles[1]);
    expect(s).toMatchObject({ npCommunicationId: 'NPWR00003_00', npServiceName: 'trophy2', progress: 100, platform: 'PS5' });
    expect(s?.earned.platinum).toBe(1);
    expect(s?.lastUpdatedAt?.toISOString()).toBe('2026-09-14T20:00:00.000Z');
  });
  it('earned: дата только у полученных, rate в формате numeric(5,2)', () => {
    const e = trophyData.NPWR00001_00.earned.map(mapEarnedTrophy);
    expect(e[0]).toMatchObject({ trophyId: 0, type: 'gold', earned: true, rarity: 2, earnedRate: '12.30' });
    expect(e[0]?.earnedAt?.toISOString()).toBe('2026-09-30T20:00:00.000Z');
    expect(e[1]).toMatchObject({ earned: false, earnedAt: null });
    expect(mapEarnedTrophy({ trophyId: 1, trophyType: 'wood' })).toBeNull();
    expect(mapEarnedTrophy({ trophyId: 1, trophyType: 'bronze', earned: false, earnedDateTime: '2026-01-01T00:00:00Z' })?.earnedAt).toBeNull();
  });
  it('defs: пустое имя скрытого трофея = null', () => {
    expect(mapTrophyDef(trophyData.NPWR00001_00.defs[2])).toMatchObject({ hidden: true, name: null, detail: null });
  });
});

describe('crypto', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  it('шифрует и расшифровывает, шифртекст не содержит исходник', () => {
    const enc = encryptToken('secret-refresh-token', key);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('secret-refresh-token');
    expect(decryptToken(enc, key)).toBe('secret-refresh-token');
    expect(encryptToken('secret-refresh-token', key)).not.toBe(enc); // случайный IV
  });
  it('подмена данных и чужой ключ отвергаются', () => {
    const enc = encryptToken('abc', key);
    const parts = enc.split(':');
    parts[3] = Buffer.from('zzz').toString('base64url');
    expect(() => decryptToken(parts.join(':'), key)).toThrow();
    expect(() => decryptToken(enc, Buffer.alloc(32, 9).toString('base64'))).toThrow();
    expect(() => decryptToken('garbage', key)).toThrow();
    expect(() => encryptToken('x', Buffer.alloc(16).toString('base64'))).toThrow();
  });
});

describe('safeErr / classifyPsnError', () => {
  it('вырезает известные секреты, Bearer, JWT и длинные токены', () => {
    const npsso = 'N'.repeat(10) + 'pssoValue';
    const jwt = 'eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl';
    const long = 'a1B2'.repeat(12);
    const m = safeErr(new Error(`fail npsso=${npsso} Bearer abc.def ${jwt} tok=${long} ok`), [npsso]);
    expect(m).not.toContain(npsso);
    expect(m).not.toContain('eyJ');
    expect(m).not.toContain(long);
    expect(m).not.toContain('abc.def');
    expect(m).toContain('ok');
  });
  it('обрезает до 500 символов', () => {
    expect(safeErr(new Error('x '.repeat(1000))).length).toBeLessThanOrEqual(500);
  });
  it('классификация', () => {
    const c = (m: string) => classifyPsnError(new Error(m)).reason;
    expect(c('Too Many Requests')).toBe('rate_limited');
    expect(c('Unexpected token \'T\', "Too Many Requests" is not valid JSON')).toBe('rate_limited');
    expect(c('Is your NPSSO code valid?')).toBe('npsso_invalid');
    expect(c('Access denied')).toBe('access_denied');
    expect(c('User not found')).toBe('access_denied');
    expect(c('Unauthorized')).toBe('auth_expired');
    expect(c('Access token expired')).toBe('auth_expired');
    expect(c('fetch failed')).toBe('psn_unavailable');
    expect(c('Unexpected token < in JSON')).toBe('psn_unavailable');
    expect(c('???')).toBe('psn_unavailable');
    const e = new PsnError('timeout', 'x');
    expect(classifyPsnError(e)).toBe(e);
    expect(classifyPsnError(new Error('429')).retryable).toBe(true);
    expect(classifyPsnError(new Error('Access denied')).retryable).toBe(false);
  });
  it('узкие паттерны: числа внутри JSON-тела и «access token» сами по себе не дают статус', () => {
    const c = (m: string) => classifyPsnError(new Error(m)).reason;
    // 404/401/403/429 внутри id и произвольных полей GraphQL-ответа
    expect(c(JSON.stringify({ data: null, extra: { id: 'NPWR40412_00', n: 404, code: 401 } }))).toBe('psn_unavailable');
    expect(c(JSON.stringify({ data: { titleId: 'PPSA04011_00', forbidden: true, privacy: 'x' } }))).toBe('psn_unavailable');
    // а message в errors[] учитывается
    expect(c(JSON.stringify({ errors: [{ message: 'Access denied' }] }))).toBe('access_denied');
    expect(c(JSON.stringify({ errors: [{ message: 'Unauthorized' }] }))).toBe('auth_expired');
    expect(c(JSON.stringify({ error: { message: 'Too Many Requests' } }))).toBe('rate_limited');
    // числа как часть слов/идентификаторов вне JSON
    expect(c('request id a4040b failed')).toBe('psn_unavailable');
    expect(c('status 401')).toBe('auth_expired');
    // «access token» без признака отказа
    expect(c('Failed to parse access token response')).toBe('psn_unavailable');
    expect(c('access token missing in cache')).toBe('psn_unavailable');
    expect(c('Invalid access token')).toBe('auth_expired');
    expect(c('The access token has expired')).toBe('auth_expired');
    // слово npsso как часть другого слова не считается
    expect(c('somenpssoish failure')).toBe('psn_unavailable');
  });
});

describe('connectPsn (клиент на фейковом psn-api)', () => {
  const mk = (state = freshState(), over: Partial<Parameters<typeof connectPsn>[0]> = {}) => {
    const sleeps: number[] = [];
    let clock = 0;
    const getAccessToken = vi.fn(async () => 'tok-1');
    const deps = {
      getAccessToken,
      onlineId: 'Target',
      delayMs: 300,
      api: fakeApi(state),
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
      ...over,
    };
    return { state, sleeps, getAccessToken, connect: () => connectPsn(deps) };
  };

  it('собирает все страницы и фильтрует не-игры', async () => {
    const { connect, state } = mk();
    const psn = await connect();
    const r = await psn.getPlayedGames();
    expect(r.games.map((g) => g.titleId)).toEqual(['CUSA00001_00', 'PPSA00002_00', 'PPSA00003_00', 'CUSA00005_00', 'PPSA00006_00', 'PCSA00007_00']);
    expect(r.skipped).toBe(1);
    expect(state.calls.played).toBe(3); // 7 тайтлов по 3 на страницу
  });

  it('держит паузу между запросами', async () => {
    const { connect, sleeps } = mk();
    const psn = await connect();
    await psn.getTrophySets();
    await psn.getTrophySets();
    expect(sleeps.every((s) => s <= 300)).toBe(true);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it('повторяет на 429 с backoff и в итоге возвращает данные', async () => {
    const { connect, state, sleeps } = mk();
    const psn = await connect();
    state.failOn.set('titles', { error: new Error('Too Many Requests'), times: 2 });
    const sets = await psn.getTrophySets();
    expect(sets).toHaveLength(5);
    expect(sleeps).toContain(1000);
    expect(sleeps).toContain(2000);
  });

  it('после исчерпания повторов бросает rate_limited', async () => {
    const { connect, state } = mk();
    const psn = await connect();
    state.failOn.set('titles', { error: new Error('429 Too Many Requests'), times: 99 });
    await expect(psn.getTrophySets()).rejects.toMatchObject({ reason: 'rate_limited' });
    expect(state.calls.titles).toBe(4); // 1 + 3 повтора
  });

  it('access_denied не повторяется', async () => {
    const { connect, state } = mk();
    const psn = await connect();
    state.failOn.set('played', { error: new Error('Access denied'), times: 99 });
    await expect(psn.getPlayedGames()).rejects.toMatchObject({ reason: 'access_denied' });
    expect(state.calls.played).toBe(1);
  });

  it('401 в середине: один refresh токена и повтор', async () => {
    const { connect, state, getAccessToken } = mk();
    const psn = await connect();
    state.failOn.set('titles', { error: new Error('Unauthorized'), times: 1 });
    expect(await psn.getTrophySets()).toHaveLength(5);
    expect(getAccessToken).toHaveBeenLastCalledWith(true);
    // второй 401 подряд не зацикливается
    state.failOn.set('titles', { error: new Error('Unauthorized'), times: 5 });
    await expect(psn.getTrophySets()).rejects.toMatchObject({ reason: 'auth_expired' });
  });

  it('ошибка не содержит токена', async () => {
    const { connect, state } = mk(undefined, { getAccessToken: async () => 'SuperSecretToken12345' });
    const psn = await connect();
    state.failOn.set('titles', { error: new Error('bad SuperSecretToken12345 here'), times: 9 });
    await expect(psn.getTrophySets()).rejects.toSatisfy((e: Error) => !e.message.includes('SuperSecretToken12345'));
  });

  it('неизвестный профиль = access_denied', async () => {
    const state = freshState();
    const api = fakeApi(state);
    (api as unknown as { getProfileFromUserName: unknown }).getProfileFromUserName = async () => ({ profile: {} });
    await expect(connectPsn({ getAccessToken: async () => 't', onlineId: 'x', delayMs: 0, api })).rejects.toMatchObject({ reason: 'access_denied' });
  });

  it('findTrophySets: по titleId, несколько сетов, пустые игры без ключа; больше 5 нельзя', async () => {
    const { connect } = mk();
    const psn = await connect();
    const m = await psn.findTrophySets(['CUSA00001_00', 'PPSA00003_00', 'CUSA00005_00']);
    expect(m.get('CUSA00001_00')?.map((s) => s.npCommunicationId)).toEqual(['NPWR00001_00']);
    expect(m.get('PPSA00003_00')?.map((s) => s.npCommunicationId)).toEqual(['NPWR00003_00', 'NPWR00004_00']);
    expect(m.has('CUSA00005_00')).toBe(false);
    await expect(psn.findTrophySets(['1', '2', '3', '4', '5', '6'])).rejects.toThrow();
  });

  it('трофеи и определения читаются постранично', async () => {
    const { connect, state } = mk();
    const psn = await connect();
    const ref = { npCommunicationId: 'NPWR00001_00', npServiceName: 'trophy' as const };
    const e = await psn.getEarnedTrophies(ref);
    const d = await psn.getTrophyDefinitions(ref);
    expect(e).toHaveLength(4);
    expect(d).toHaveLength(4);
    expect(state.calls.earned).toBe(2);
  });
});

describe('pickBanner (правило выбора баннера)', () => {
  const img = (type: string, url = `https://img.example/${type}.jpg`, extra: object = {}) => ({ url, format: 'UNKNOWN', type, ...extra });
  it('приоритет типов: 16:9 > hub > 4:3 > фон > скриншот', () => {
    const all = [img('SCREENSHOT'), img('BACKGROUND'), img('FOUR_BY_THREE_BANNER'), img('GAMEHUB_COVER_ART'), img('SIXTEEN_BY_NINE_BANNER')];
    expect(pickBanner(all)).toContain('SIXTEEN_BY_NINE_BANNER');
    expect(pickBanner(all.slice(0, 4))).toContain('GAMEHUB_COVER_ART');
    expect(pickBanner(all.slice(0, 3))).toContain('FOUR_BY_THREE_BANNER');
    expect(pickBanner(all.slice(0, 2))).toContain('BACKGROUND');
  });
  it('квадратные, логотипы и портреты не берутся', () => {
    expect(pickBanner([img('MASTER'), img('LOGO'), img('PORTRAIT_BANNER'), img('STORE_ICON')])).toBeNull();
  });
  it('без типа из списка: любое с width > height', () => {
    expect(pickBanner([img('MASTER', 'https://a/sq.jpg', { width: 100, height: 100 }), img('OTHER', 'https://a/wide.jpg', { width: 1920, height: 1080 })])).toBe('https://a/wide.jpg');
  });
  it('мусор и пустые url', () => {
    expect(pickBanner(undefined)).toBeNull();
    expect(pickBanner([null, 5, { type: 'FOUR_BY_THREE_BANNER', url: '' }, { type: 'FOUR_BY_THREE_BANNER' }])).toBeNull();
  });
  it('только https: http, чужие схемы и мусор отбрасываются (BUG-P9-2)', () => {
    expect(pickBanner([img('FOUR_BY_THREE_BANNER', 'http://a/x.jpg')])).toBeNull();
    expect(pickBanner([img('SIXTEEN_BY_NINE_BANNER', 'javascript:alert(1)'), img('BACKGROUND', 'https://a/bg.jpg')])).toBe('https://a/bg.jpg');
    const p = mapProfile({ profile: { onlineId: 'X', avatarUrls: [{ size: 'xl', avatarUrl: 'http://a/xl.png' }, { size: 'm', avatarUrl: 'https://a/m.png' }] } });
    expect(p?.avatarUrl).toBe('https://a/m.png');
  });
  it('фикстура: Epsilon берёт FOUR_BY_THREE_BANNER, у остальных null', () => {
    expect(mapPlayedTitle(played.titles[5])?.bannerUrl).toBe('https://img.example/eps-concept.jpg');
    expect(mapPlayedTitle(played.titles[0])?.bannerUrl).toBeNull();
  });
});

describe('mapProfile', () => {
  const raw = {
    profile: {
      onlineId: 'Artem_PS',
      avatarUrls: [
        { size: 'm', avatarUrl: 'https://a/m.png' },
        { size: 'xl', avatarUrl: 'https://a/xl.png' },
        { size: 's', avatarUrl: 'https://a/s.png' },
      ],
      trophySummary: { level: 312, progress: 47, tier: 7, earnedTrophies: { bronze: 2800, silver: 1100, gold: 410, platinum: 38 } },
    },
  };
  it('берёт самый крупный аватар и сводку трофеев', () => {
    expect(mapProfile(raw)).toEqual({
      onlineId: 'Artem_PS',
      avatarUrl: 'https://a/xl.png',
      trophyLevel: 312,
      trophyProgress: 47,
      trophyTier: 7,
      earned: { platinum: 38, gold: 410, silver: 1100, bronze: 2800 },
    });
  });
  it('нет trophySummary и avatarUrls: поля null, профиль есть', () => {
    expect(mapProfile({ profile: { onlineId: 'X' } })).toEqual({
      onlineId: 'X', avatarUrl: null, trophyLevel: null, trophyProgress: null, trophyTier: null, earned: null,
    });
  });
  it('мусор: отрицательные и нечисловые значения = null, progress режется до 100, неполные счётчики = null', () => {
    const p = mapProfile({ profile: { onlineId: 'X', avatarUrls: 'x', trophySummary: { level: -1, progress: 500, tier: 'a', earnedTrophies: { platinum: 1 } } } });
    expect(p).toMatchObject({ avatarUrl: null, trophyLevel: null, trophyProgress: 100, trophyTier: null, earned: null });
  });
  it('нет onlineId или не объект = null', () => {
    expect(mapProfile(null)).toBeNull();
    expect(mapProfile({ profile: {} })).toBeNull();
    expect(mapProfile({})).toBeNull();
  });
});
