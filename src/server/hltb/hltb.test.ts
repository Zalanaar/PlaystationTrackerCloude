import { describe, expect, it } from 'vitest';
import { HltbError, createHltbClient, parseSearchResponse } from './client';
import { MATCH_THRESHOLD, dice, normalizeTitle, pickBest, searchTerm, secondsToHours, similarity, type HltbCandidate } from './normalize';

const c = (id: number, name: string, main: number | null = 10): HltbCandidate => ({ id, name, mainHours: main, extraHours: null });

describe('normalizeTitle', () => {
  it('регистр, знаки, ™®', () => {
    expect(normalizeTitle('The Witcher® 3: Wild Hunt')).toBe('the witcher 3 wild hunt');
    expect(normalizeTitle('Marvel’s Spider-Man™')).toBe('marvels spider man');
  });
  it('диакритика', () => {
    expect(normalizeTitle('God of War Ragnarök')).toBe('god of war ragnarok');
  });
  it('хвосты изданий и платформ вырезаются', () => {
    expect(normalizeTitle('Horizon Zero Dawn™ Complete Edition')).toBe('horizon zero dawn');
    expect(normalizeTitle('Control Ultimate Edition PS5')).toBe('control');
    expect(normalizeTitle('The Last of Us Part I Remastered')).toBe('the last of us part i');
    expect(normalizeTitle('Dark Souls: Remastered')).toBe('dark souls');
    expect(normalizeTitle('Fallout 4 Game of the Year Edition')).toBe('fallout 4');
  });
  it('римские цифры (кроме первого слова) -> арабские', () => {
    expect(normalizeTitle('Final Fantasy VII')).toBe('final fantasy 7');
    expect(normalizeTitle('Mass Effect III')).toBe('mass effect 3');
    expect(normalizeTitle('X-Men')).toBe('x men');
  });
  it('& -> and', () => {
    expect(normalizeTitle('Ratchet & Clank')).toBe('ratchet and clank');
  });
  it('пустое остаётся пустым, searchTerm не падает', () => {
    expect(normalizeTitle('™®')).toBe('');
    expect(searchTerm('™®')).toBe('™®');
  });
});

describe('схожесть и выбор', () => {
  it('dice: равные = 1, пустые = 0, разные < 1', () => {
    expect(dice('abc', 'abc')).toBe(1);
    expect(dice('', 'abc')).toBe(0);
    expect(dice('abc', 'xyz')).toBe(0);
  });
  it('точное совпадение после нормализации', () => {
    expect(similarity('Horizon Zero Dawn™ Complete Edition', 'Horizon Zero Dawn')).toBe(1);
  });
  it('выбирает лучшее, а не первое', () => {
    const best = pickBest('Hades', [c(1, 'Hades II'), c(2, 'Hades'), c(3, 'Hades Star')]);
    expect(best?.id).toBe(2);
  });
  it('другая часть серии не подходит', () => {
    expect(pickBest('God of War', [c(1, 'God of War II')])).toBeNull();
    expect(pickBest('Resident Evil 4', [c(1, 'Resident Evil 2'), c(2, 'Resident Evil 4')])?.id).toBe(2);
  });
  it('ниже порога = null (не привязываем чужую игру)', () => {
    expect(pickBest('Stray', [c(1, 'Stray Gods'), c(2, 'Strange Brigade')])).toBeNull();
    expect(pickBest('Что-то своё', [])).toBeNull();
    expect(MATCH_THRESHOLD).toBeGreaterThan(0.5);
  });
  it('при равенстве выигрывает более ранний в выдаче', () => {
    expect(pickBest('Doom', [c(7, 'DOOM'), c(8, 'Doom')])?.id).toBe(7);
  });
  it('секунды -> часы 0.1', () => {
    expect(secondsToHours(36000)).toBe(10);
    expect(secondsToHours(78840)).toBe(21.9);
    expect(secondsToHours(0)).toBeNull();
    expect(secondsToHours(null)).toBeNull();
    expect(secondsToHours('5')).toBeNull();
    expect(secondsToHours(100)).toBeNull();
  });
});

describe('разбор ответа HLTB', () => {
  it('нормальный ответ', () => {
    const r = parseSearchResponse({ data: [{ game_id: 2127, game_name: 'Hades', comp_main: 78840, comp_plus: 126000 }, { game_id: 3, game_name: 'X', comp_main: 0 }] });
    expect(r).toEqual([
      { id: 2127, name: 'Hades', mainHours: 21.9, extraHours: 35 },
      { id: 3, name: 'X', mainHours: null, extraHours: null },
    ]);
  });
  it('пустая выдача допустима, неожиданная форма = bad_response', () => {
    expect(parseSearchResponse({ data: [] })).toEqual([]);
    expect(() => parseSearchResponse({})).toThrow(HltbError);
    expect(() => parseSearchResponse({ data: [{ game_name: 'x' }] })).toThrow(HltbError);
    expect(() => parseSearchResponse('x')).toThrow(HltbError);
  });
});

describe('клиент (фейковый fetch)', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('init -> search с токеном и hp-полями в теле', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/init')) return json({ token: 'T', hpKey: 'k', hpVal: 'v' });
      return json({ data: [{ game_id: 1, game_name: 'Hades', comp_main: 36000 }] });
    }) as unknown as typeof fetch;
    const client = createHltbClient({ fetchImpl: f });
    expect(await client.search('hades')).toHaveLength(1);
    await client.search('hades');
    const post = calls.find((x) => x.init?.method === 'POST');
    const headers = post?.init?.headers as Record<string, string>;
    expect(headers['x-auth-token']).toBe('T');
    expect(JSON.parse(String(post?.init?.body)).k).toBe('v');
    expect(calls.filter((x) => x.url.includes('/init'))).toHaveLength(1); // токен переиспользован
  });

  it('первый эндпоинт 404 -> пробует следующий', async () => {
    const f = (async (url: string) => {
      if (url.includes('/api/find/init')) return new Response('nope', { status: 404 });
      if (url.includes('/init')) return json({ token: 'T' });
      return json({ data: [] });
    }) as unknown as typeof fetch;
    expect(await createHltbClient({ fetchImpl: f }).search('x')).toEqual([]);
  });

  it('403 везде = blocked; сеть = unavailable; таймаут = timeout; HTML = bad_response', async () => {
    const blocked = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    await expect(createHltbClient({ fetchImpl: blocked }).search('x')).rejects.toMatchObject({ code: 'blocked' });
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(createHltbClient({ fetchImpl: down }).search('x')).rejects.toMatchObject({ code: 'unavailable' });
    const slow = (async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    await expect(createHltbClient({ fetchImpl: slow }).search('x')).rejects.toMatchObject({ code: 'timeout' });
    const html = (async (url: string) => (url.includes('/init') ? json({ token: 'T' }) : new Response('<html>', { status: 200 }))) as unknown as typeof fetch;
    await expect(createHltbClient({ fetchImpl: html }).search('x')).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('сообщения ошибок не содержат тело ответа', async () => {
    const f = (async (url: string) => (url.includes('/init') ? json({ token: 'SECRET-TOKEN' }) : new Response('SECRET-BODY', { status: 500 }))) as unknown as typeof fetch;
    const e = await createHltbClient({ fetchImpl: f }).search('x').catch((x: unknown) => x);
    expect(String((e as Error).message)).not.toMatch(/SECRET/);
  });

  it('протухший токен: один повторный init', async () => {
    let inits = 0;
    let posts = 0;
    const f = (async (url: string, init?: RequestInit) => {
      if (url.includes('/init')) {
        inits++;
        return json({ token: `T${inits}` });
      }
      posts++;
      return (init?.headers as Record<string, string>)['x-auth-token'] === 'T1' ? new Response('', { status: 401 }) : json({ data: [] });
    }) as unknown as typeof fetch;
    expect(await createHltbClient({ fetchImpl: f }).search('x')).toEqual([]);
    expect([inits, posts]).toEqual([2, 2]);
  });

  it('диагностика: статусы и типы сбоев по каждому init, без тел и токенов', async () => {
    const f = (async (url: string) => {
      if (url.includes('/api/find/init')) return new Response('SECRET-BODY', { status: 404 });
      if (url.includes('/api/bleed/init')) return json({ nope: 'SECRET-TOKEN' });
      if (url.includes('/api/search/init')) return new Response('<html>SECRET', { status: 200 });
      return new Response('', { status: 500 }); // главная недоступна
    }) as unknown as typeof fetch;
    const e = (await createHltbClient({ fetchImpl: f }).search('x').catch((x: unknown) => x)) as HltbError;
    expect(e.code).toBe('unavailable');
    expect(e.message).toContain('init /api/find/init: 404; init /api/bleed/init: 200 no_token; init /api/search/init: not_json');
    expect(e.message).toContain('главная: недоступна');
    expect(e.message).not.toMatch(/SECRET/);
    expect(e.message.length).toBeLessThan(400);
  });

  it('диагностика: network и timeout различаются; при timeout разбор страницы пропускается', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const e1 = (await createHltbClient({ fetchImpl: down }).search('x').catch((x: unknown) => x)) as HltbError;
    expect(e1.message).toContain('init /api/find/init: network; init /api/bleed/init: network');
    const slow = (async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;
    const e2 = (await createHltbClient({ fetchImpl: slow }).search('x').catch((x: unknown) => x)) as HltbError;
    expect(e2.message).toContain('find/init: timeout');
    expect(e2.message).toContain('поиск пути пропущен');
  });

  it('после неудачи discovery повторных сетевых запросов в этом клиенте нет', async () => {
    let n = 0;
    const f = (async () => (n++, new Response('', { status: 404 }))) as unknown as typeof fetch;
    const c = createHltbClient({ fetchImpl: f });
    await c.search('x').catch(() => undefined);
    const after = n;
    await c.search('y').catch(() => undefined);
    expect(n).toBe(after);
  });

  it('новый путь из _app-скрипта главной: берётся, только если init вернул token', async () => {
    const f = (async (url: string) => {
      if (url.endsWith('/')) return new Response('<script src="/_next/static/chunks/pages/_app-abc123.js"></script>', { status: 200 });
      if (url.includes('_app-abc123.js')) return new Response('x=fetch("/api/ember/search".concat(a),{method:"POST"});y=fetch("/api/zzz/q")', { status: 200 });
      if (url.includes('/api/ember/init')) return json({ token: 'T' });
      if (url.includes('/init')) return new Response('', { status: 404 });
      if (url.includes('/api/ember')) return json({ data: [{ game_id: 7, game_name: 'Hades', comp_main: 3600 }] });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const r = await createHltbClient({ fetchImpl: f }).search('hades');
    expect(r[0].id).toBe(7);
  });

  it('скрипт без пути или чужой формат: ошибка с пометкой, без выдуманных запросов', async () => {
    const f = (async (url: string) => {
      if (url.endsWith('/')) return new Response('<script src="/_next/static/chunks/pages/_app-1.js"></script>', { status: 200 });
      if (url.includes('_app-1.js')) return new Response('nothing here', { status: 200 });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const e = (await createHltbClient({ fetchImpl: f }).search('x').catch((x: unknown) => x)) as HltbError;
    expect(e.message).toContain('_app: путь не найден');
  });

  it('основной путь /api/search/site: init и поиск идут по нему', async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      if (url.includes('/api/search/site/init')) return json({ token: 'T' });
      if (url.includes('/api/search/site')) return json({ data: [{ game_id: 3, game_name: 'Hades', comp_main: 3600 }] });
      return new Response('<html>', { status: 404 });
    }) as unknown as typeof fetch;
    expect((await createHltbClient({ fetchImpl: f }).search('hades'))[0].id).toBe(3);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toBe('https://howlongtobeat.com/api/search/site');
  });

  it('все пути 404: диагностика содержит /api/search/site/init: 404', async () => {
    const f = (async () => new Response('<html>SECRET', { status: 404 })) as unknown as typeof fetch;
    const e = (await createHltbClient({ fetchImpl: f }).search('x').catch((x: unknown) => x)) as HltbError;
    expect(e.message).toContain('init /api/search/site/init: 404; init /api/find/init: 404');
    expect(e.message).not.toMatch(/SECRET/);
  });

  it('реальная форма init {"token"} без hp-полей: токен в x-auth-token, UA одинаковый у init и search, hp в теле нет', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      if (url.includes('/init')) return json({ token: 'dGltZXxpcHx1YQ==' });
      return json({ data: [] });
    }) as unknown as typeof fetch;
    await createHltbClient({ fetchImpl: f }).search('x');
    const [a, b] = seen.map((x) => x.init?.headers as Record<string, string>);
    expect(a['user-agent']).toBeTruthy();
    expect(b['user-agent']).toBe(a['user-agent']);
    expect(b['x-auth-token']).toBe('dGltZXxpcHx1YQ==');
    expect(b['x-hp-key']).toBeUndefined();
    expect(Object.keys(JSON.parse(String(seen[1].init?.body)))).not.toContain('');
  });
});
