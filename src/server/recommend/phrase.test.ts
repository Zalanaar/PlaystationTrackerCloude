import { describe, expect, it, vi } from 'vitest';
import { getLlmEnv } from '@/server/env';
import { LLM_MAX_OUTPUT_TOKENS, SYSTEM_PROMPT, createProvider, factsOf, geminiProvider, groqProvider, isValidPhrase, LlmError, parsePhrases, requestPhrases, stableHash, templateReason, type LlmConfig, type PhraseFact, type PhraseProvider } from './phrase';
import type { ScoredItem } from './types';

const item = (id: number, o: Partial<ScoredItem> = {}, name = `Игра ${id}`): ScoredItem => ({
  game: { id, name, imageUrl: null, bannerUrl: null, genres: ['ACTION'], hours: 22.5, hoursSource: 'hltb' },
  score: 4.7,
  signals: [{ key: 'genre_affinity', label: 'Любимый жанр: Экшен, 120 ч', contribution: 2.4 }],
  topGenre: 'ACTION',
  ...o,
});
const facts: PhraseFact[] = [
  { id: 1, name: 'Hades', genres: ['Экшен'], hours: 22.5, signals: [] },
  { id: 2, name: 'Celeste', genres: ['Аркады'], hours: 8, signals: [] },
];
const SECRET = 'sk-SECRET-KEY-123';
const cfg = (provider: 'gemini' | 'groq'): LlmConfig => ({ provider, apiKey: SECRET, model: 'm' });
const jsonRes = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: 200, ...init });
const reasonsJson = (list: unknown) => JSON.stringify({ reasons: list });

describe('templateReason', () => {
  it('собирается из сильных сигналов и часов', () => {
    expect(templateReason(item(1))).toBe('Жанр «Экшен» тебе заходит, на прохождение уйдёт около 23 часов.');
    expect(templateReason(item(1, { signals: [] }))).toBe('На прохождение уйдёт около 23 часов.');
    const strong = item(1, { signals: [{ key: 'genre_affinity', label: '', contribution: 2.4 }, { key: 'platinum_close', label: '', contribution: 0.8 }, { key: 'waiting', label: '', contribution: 0.9 }] });
    expect(templateReason(strong)).toBe('Жанр «Экшен» тебе заходит, платина уже близко, давно ждёт в бэклоге, на прохождение уйдёт около 23 часов.');
  });
  it('склонение часов и пустые факты', () => {
    expect(templateReason(item(1, { game: { ...item(1).game, hours: 21 } }))).toContain('около 21 часа');
    expect(templateReason(item(1, { game: { ...item(1).game, hours: 11 } }))).toContain('около 11 часов');
    expect(templateReason(item(1, { game: { ...item(1).game, hours: 0.2 } }))).toContain('около 1 часа');
    expect(templateReason(item(1, { signals: [], game: { ...item(1).game, hours: null } }))).toBe('Лежит в бэклоге и ждёт своей очереди.');
  });
});

describe('stableHash (20.4)', () => {
  it('стабилен при малых сдвигах и меняется при существенных', () => {
    const a = stableHash(item(1));
    expect(stableHash(item(1, { signals: [{ key: 'genre_affinity', label: 'другая подпись', contribution: 2.3 }] }))).toBe(a);
    expect(stableHash(item(1, { signals: [{ key: 'genre_affinity', label: '', contribution: 1.2 }] }))).not.toBe(a);
    expect(stableHash(item(2))).not.toBe(a);
  });
  it('не зависит от waiting и duration_fit (давность и фильтр времени), порядка сигналов', () => {
    const base = item(1, { signals: [{ key: 'genre_affinity', label: '', contribution: 2.4 }, { key: 'platinum_close', label: '', contribution: 1.2 }] });
    const h = stableHash(base);
    const noisy = item(1, {
      signals: [
        { key: 'waiting', label: 'В бэклоге 5 мес.', contribution: 0.4 },
        { key: 'platinum_close', label: '', contribution: 1.2 },
        { key: 'duration_fit', label: 'Подходит по времени', contribution: 2 },
        { key: 'genre_affinity', label: '', contribution: 2.4 },
      ],
    });
    expect(stableHash(noisy)).toBe(h);
    const waitingOnly = item(1, { signals: [...base.signals, { key: 'waiting', label: '', contribution: 1 }] });
    expect(stableHash(waitingOnly)).toBe(h);
  });
  it('меняется от жанров, названия и целых часов; не от дробных долей часа', () => {
    const h = stableHash(item(1));
    expect(stableHash(item(1, { game: { ...item(1).game, genres: ['RACING'] } }))).not.toBe(h);
    expect(stableHash(item(1, { game: { ...item(1).game, hours: 30 } }))).not.toBe(h);
    expect(stableHash(item(1, { game: { ...item(1).game, hours: 22.9 } }))).toBe(stableHash(item(1, { game: { ...item(1).game, hours: 23.2 } })));
  });
});

describe('factsOf', () => {
  it('в LLM уходят только название, жанры RU, часы и подписи стабильных сигналов', () => {
    expect(factsOf([item(1)])).toEqual([{ id: 1, name: 'Игра 1', genres: ['Экшен'], hours: 22.5, signals: ['Любимый жанр: Экшен, 120 ч'] }]);
    const withWaiting = item(1, { signals: [{ key: 'waiting', label: 'В бэклоге 5 мес.', contribution: 0.4 }, { key: 'duration_fit', label: 'Подходит по времени', contribution: 1 }, ...item(1).signals] });
    expect(factsOf([withWaiting])[0].signals).toEqual(['Любимый жанр: Экшен, 120 ч']);
  });
});

describe('валидация фраз', () => {
  it('isValidPhrase: длина и ссылки', () => {
    expect(isValidPhrase('Хорошая фраза.')).toBe(true);
    expect(isValidPhrase('')).toBe(false);
    expect(isValidPhrase('   ')).toBe(false);
    expect(isValidPhrase('x'.repeat(401))).toBe(false);
    expect(isValidPhrase('x'.repeat(400))).toBe(true);
    for (const bad of ['Смотри https://evil.example', 'на www.site.ru есть', 'тут site.com', '[a](b)', '<b>жирно</b>']) expect(isValidPhrase(bad), bad).toBe(false);
    expect(isValidPhrase(42)).toBe(false);
  });

  it('isValidPhrase: обычный текст с точками и названия игр проходят', () => {
    for (const ok of ['Конец.', 'Хорошая игра. Берись сейчас.', 'Около 22 часов...', 'Версия 1.5 и v1.2, Ep.2 и No.1.', 'Игра Marvel\'s Spider-Man 2. Ждёт давно.', 'Dr. Mario и S.T.A.L.K.E.R. 2 подойдут.', 'Ждёт.Давно', 'Hades II: ждёт, а платина близко!'])
      expect(isValidPhrase(ok), ok).toBe(true);
  });

  it('parsePhrases: валидный JSON, в том числе в блоке ```', () => {
    const raw = reasonsJson([{ id: 1, text: 'Фраза один.' }, { id: 2, text: 'Фраза два.' }]);
    expect([...parsePhrases(raw, facts)]).toEqual([[1, 'Фраза один.'], [2, 'Фраза два.']]);
    expect(parsePhrases('```json\n' + raw + '\n```', facts).size).toBe(2);
    expect(parsePhrases(JSON.stringify([{ id: 1, text: 'Ок.' }]), facts).get(1)).toBe('Ок.');
  });

  it('parsePhrases: нарушение отбрасывает только эту игру', () => {
    const out = parsePhrases(
      reasonsJson([{ id: 1, text: 'Ок.' }, { id: 2, text: 'см. https://x.io' }, { id: 99, text: 'Чужой id' }, { id: '1', text: 'строка' }]),
      facts,
    );
    expect([...out]).toEqual([[1, 'Ок.']]);
  });

  it('parsePhrases: повторный id и упоминание другой игры отбрасываются', () => {
    expect(parsePhrases(reasonsJson([{ id: 1, text: 'Раз.' }, { id: 1, text: 'Два.' }, { id: 2, text: 'Три.' }]), facts).has(1)).toBe(false);
    const out = parsePhrases(reasonsJson([{ id: 1, text: 'Лучше, чем Celeste.' }, { id: 2, text: 'Хороша.' }]), facts);
    expect(out.has(1)).toBe(false);
    expect(out.get(2)).toBe('Хороша.');
  });

  it('parsePhrases: мусор = bad_response', () => {
    for (const raw of ['', 'не json', '{"x":1}', '"str"', 'null']) expect(() => parsePhrases(raw, facts), raw).toThrow(LlmError);
  });
});

describe('requestPhrases', () => {
  const provider = (complete: PhraseProvider['complete']): PhraseProvider => ({ name: 'groq', complete });

  it('успех', async () => {
    const out = await requestPhrases(provider(async () => reasonsJson([{ id: 1, text: 'Ок.' }])), facts);
    expect(out.get(1)).toBe('Ок.');
  });
  it('мусор и пустой результат = bad_response', async () => {
    await expect(requestPhrases(provider(async () => 'мусор'), facts)).rejects.toMatchObject({ code: 'bad_response' });
    await expect(requestPhrases(provider(async () => reasonsJson([{ id: 5, text: 'x' }])), facts)).rejects.toMatchObject({ code: 'bad_response' });
  });
  it('таймаут: зависший провайдер прерывается по signal', async () => {
    const hang = provider((_p, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))));
    await expect(requestPhrases(hang, facts, 20)).rejects.toMatchObject({ code: 'timeout' });
  });
  it('неожиданное исключение = network', async () => {
    await expect(requestPhrases(provider(async () => { throw new Error('boom'); }), facts)).rejects.toMatchObject({ code: 'network' });
  });
});

describe('провайдеры (мок fetch)', () => {
  const ctrl = () => new AbortController().signal;

  it('gemini: ключ в заголовке, не в URL; разбор ответа', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ candidates: [{ content: { parts: [{ text: 'RAW' }] } }] }));
    const text = await geminiProvider(cfg('gemini'), fetchMock as unknown as typeof fetch).complete({ system: 's', user: 'u' }, ctrl());
    expect(text).toBe('RAW');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(SECRET);
    expect(url).toContain('generativelanguage.googleapis.com');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(SECRET);
  });

  it('groq: Bearer и разбор choices', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ choices: [{ message: { content: 'RAW' } }] }));
    expect(await groqProvider(cfg('groq'), fetchMock as unknown as typeof fetch).complete({ system: 's', user: 'u' }, ctrl())).toBe('RAW');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${SECRET}`);
  });

  it('HTTP-ошибка, сеть, не тот формат: LlmError без ключа и тела в сообщении', async () => {
    const cases: [typeof fetch, string][] = [
      [(async () => new Response(`key ${SECRET} invalid`, { status: 401 })) as typeof fetch, 'http'],
      [(async () => { throw new TypeError(`fetch failed ${SECRET}`); }) as typeof fetch, 'network'],
      [(async () => jsonRes({ unexpected: true })) as typeof fetch, 'bad_response'],
      [(async () => new Response('<html>', { status: 200 })) as typeof fetch, 'bad_response'],
    ];
    for (const prov of ['gemini', 'groq'] as const) {
      for (const [f, code] of cases) {
        const err = await createProvider(cfg(prov), f).complete({ system: 's', user: 'u' }, ctrl()).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(LlmError);
        expect((err as LlmError).code).toBe(code);
        expect(String((err as LlmError).message)).not.toContain(SECRET);
      }
    }
  });

  it('abort во время fetch = timeout', async () => {
    const ac = new AbortController();
    const f = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    const p = geminiProvider(cfg('gemini'), f).complete({ system: 's', user: 'u' }, ac.signal);
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'timeout' });
  });

  it('полный путь через requestPhrases: фраза от groq доходит', async () => {
    const f = vi.fn(async () => jsonRes({ choices: [{ message: { content: reasonsJson([{ id: 1, text: 'Из groq.' }]) } }] }));
    const out = await requestPhrases(groqProvider(cfg('groq'), f as unknown as typeof fetch), facts);
    expect(out.get(1)).toBe('Из groq.');
  });
});

describe('getLlmEnv', () => {
  it('выключен без провайдера, ключа, с неизвестным провайдером и лимитом 0', () => {
    expect(getLlmEnv({})).toBeNull();
    expect(getLlmEnv({ LLM_PROVIDER: 'gemini' })).toBeNull();
    expect(getLlmEnv({ LLM_API_KEY: 'k' })).toBeNull();
    expect(getLlmEnv({ LLM_PROVIDER: 'openai', LLM_API_KEY: 'k' })).toBeNull();
    expect(getLlmEnv({ LLM_PROVIDER: 'groq', LLM_API_KEY: 'k', LLM_DAILY_LIMIT: '0' })).toBeNull();
  });
  it('лимит по умолчанию 20, зажим 0..200, модель с проверкой', () => {
    expect(getLlmEnv({ LLM_PROVIDER: 'Groq', LLM_API_KEY: ' k ' })).toEqual({ provider: 'groq', apiKey: 'k', model: null, dailyLimit: 20 });
    expect(getLlmEnv({ LLM_PROVIDER: 'gemini', LLM_API_KEY: 'k', LLM_DAILY_LIMIT: '9999' })!.dailyLimit).toBe(200);
    expect(getLlmEnv({ LLM_PROVIDER: 'gemini', LLM_API_KEY: 'k', LLM_DAILY_LIMIT: 'abc' })!.dailyLimit).toBe(20);
    expect(getLlmEnv({ LLM_PROVIDER: 'gemini', LLM_API_KEY: 'k', LLM_MODEL: 'gemini-x.1' })!.model).toBe('gemini-x.1');
    expect(getLlmEnv({ LLM_PROVIDER: 'gemini', LLM_API_KEY: 'k', LLM_MODEL: 'bad model?' })!.model).toBeNull();
  });
});

describe('лимит токенов и промпт', () => {
  it('потолок 2000 и промпт требует до 200 символов и один элемент на id', () => {
    expect(LLM_MAX_OUTPUT_TOKENS).toBe(2000);
    expect(SYSTEM_PROMPT).toContain('до 200 символов');
    expect(SYSTEM_PROMPT).toContain('ровно по одному элементу на каждый id');
  });
});

describe('обрезка ответа по токенам (контракт 20.4)', () => {
  const sig = () => new AbortController().signal;
  it('groq: finish_reason=length = LlmError truncated; stop проходит; maxTokens из аргумента', async () => {
    const bodies: Record<string, unknown>[] = [];
    const mk = (finish: string) => (async (_u: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: '{"games":[]}' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const c: LlmConfig = { provider: 'groq', apiKey: 'k', model: 'm' };
    await expect(groqProvider(c, mk('length')).complete({ system: 's', user: 'u' }, sig(), { maxTokens: 4000 })).rejects.toMatchObject({ name: 'LlmError', code: 'bad_response', detail: 'truncated' });
    expect(bodies[0].max_tokens).toBe(4000);
    await expect(groqProvider(c, mk('stop')).complete({ system: 's', user: 'u' }, sig())).resolves.toBe('{"games":[]}');
    expect(bodies[1].max_tokens).toBe(LLM_MAX_OUTPUT_TOKENS);
  });
  it('gemini: finishReason=MAX_TOKENS = truncated; maxOutputTokens из аргумента', async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = (async (_u: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"rea' }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(geminiProvider({ provider: 'gemini', apiKey: 'k', model: 'm' }, f).complete({ system: 's', user: 'u' }, sig(), { maxTokens: 3000 })).rejects.toMatchObject({ detail: 'truncated' });
    expect((bodies[0].generationConfig as { maxOutputTokens: number }).maxOutputTokens).toBe(3000);
  });
  it('requestPhrases: truncated пробрасывается как есть', async () => {
    const p: PhraseProvider = { name: 'groq', complete: async () => { throw new LlmError('bad_response', 'truncated'); } };
    await expect(requestPhrases(p, facts)).rejects.toMatchObject({ detail: 'truncated' });
  });
  it('requestPhrases по умолчанию просит 3000 токенов', async () => {
    let seen: unknown;
    const p: PhraseProvider = { name: 'groq', complete: async ({ user }, _s, opts) => { seen = opts; return reasonsJson((JSON.parse(user) as { games: { id: number }[] }).games.map((g) => ({ id: g.id, text: 'Ок.' }))); } };
    await requestPhrases(p, facts);
    expect(seen).toEqual({ maxTokens: 3000 });
  });
});
