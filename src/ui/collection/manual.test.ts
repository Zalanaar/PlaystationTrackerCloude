import { describe, expect, it } from 'vitest';
import {
  addedToastText, canSearch, classifySearchError, countNotPurchased, isGoneOrDone, manualAria, manualErrorText, manualMeta, manualPassesFilters, mergeBacklog,
  parseDuplicate, platformsText, rawgUrl, releaseMeta, searchReleaseText, setNotPurchased, truncate, visibleManual, type ManualGame,
} from './manual';
import { MATCH_PAGE, matchGameMeta, matchToast, visibleMatches } from '../inbox/match';

const TODAY = '2026-11-02';
const mg = (id: number, o: Partial<ManualGame> = {}): ManualGame => ({
  id, source: 'manual', kind: 'ps_backlog', externalSource: 'rawg', externalId: String(3000 + id), title: `Игра ${id}`, coverUrl: null, releaseDate: null,
  status: 'backlog', notPurchased: true, matchSuggestion: null, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...o,
});
const NO_FILTERS = { genres: [], duration: [], hltb: [], nb: false };

describe('дата релиза и мета', () => {
  it('будущая, прошедшая, только год, нет даты', () => {
    expect(releaseMeta('2026-11-12', TODAY)).toBe('Выйдет 12 нояб. 2026');
    expect(releaseMeta('2026-11-02', TODAY)).toBe('Вышла 2 нояб. 2026');
    expect(releaseMeta('2025-03-04', TODAY)).toBe('Вышла 4 мар. 2025');
    expect(releaseMeta('2026', TODAY)).toBe('Вышла в 2026');
    expect(releaseMeta(null, TODAY)).toBe('Дата не объявлена');
    expect(releaseMeta('мусор', TODAY)).toBe('Дата не объявлена');
  });
  it('после «Купил» мета «Ждём первый запуск»', () => {
    expect(manualMeta(mg(1, { releaseDate: '2026-11-12' }), TODAY)).toBe('Выйдет 12 нояб. 2026');
    expect(manualMeta(mg(1, { notPurchased: false, releaseDate: '2026-11-12' }), TODAY)).toBe('Ждём первый запуск');
  });
  it('aria-label карточки', () => {
    expect(manualAria(mg(1, { title: 'Hades' }), TODAY)).toBe('Hades, бэклог, не куплено, Дата не объявлена');
    expect(manualAria(mg(1, { title: 'Hades', notPurchased: false }), TODAY)).toBe('Hades, бэклог, Ждём первый запуск');
  });
  it('строка результата поиска', () => {
    expect(searchReleaseText('2026-11-12')).toBe('Релиз 12 нояб. 2026');
    expect(searchReleaseText('2027')).toBe('Релиз 2027');
    expect(searchReleaseText(null)).toBe('Дата не объявлена');
  });
  it('платформы: только PS5 и PS4', () => {
    expect(platformsText(['PC', 'PlayStation 4', 'PlayStation 5', 'Xbox One'])).toBe('PS5 · PS4');
    expect(platformsText(['PlayStation 4'])).toBe('PS4');
    expect(platformsText(['PC'])).toBe('');
  });
});

describe('поиск', () => {
  it('минимум 2 символа после trim', () => {
    expect(canSearch('')).toBe(false);
    expect(canSearch(' a ')).toBe(false);
    expect(canSearch('ab')).toBe(true);
  });
  it('сбои: лимит с resetAt, каталог не настроен, офлайн, прочее', () => {
    const e = (reason: string, extra: object = {}) => ({ status: 503, code: 'catalog_unavailable', details: { reason, ...extra } });
    expect(classifySearchError(e('rate_limited', { resetAt: '2026-12-01T21:00:00.000Z' }), true)).toEqual({ kind: 'quota', resetAt: '2026-12-01T21:00:00.000Z' });
    expect(classifySearchError(e('rate_limited'), true)).toEqual({ kind: 'quota', resetAt: null });
    expect(classifySearchError(e('no_key'), true)).toEqual({ kind: 'unavailable' });
    expect(classifySearchError(e('timeout'), true)).toEqual({ kind: 'error' });
    expect(classifySearchError(new Error('x'), true)).toEqual({ kind: 'error' });
    expect(classifySearchError(e('no_key'), false)).toEqual({ kind: 'offline' });
  });
  it('rawgUrl только по числовому id', () => {
    expect(rawgUrl({ externalId: '3328' })).toBe('https://rawg.io/games/3328');
    expect(rawgUrl({ externalId: 'a/b' })).toBeNull();
  });
});

describe('дубли и ошибки', () => {
  it('409 duplicate_game разбирается, остальное нет', () => {
    const d = { duplicate: 'library', game: { gameId: 5, name: 'Hades', imageUrl: null }, planned: null };
    expect(parseDuplicate({ status: 409, code: 'duplicate_game', details: d })).toEqual(d);
    expect(parseDuplicate({ status: 409, code: 'manual_limit' })).toBeNull();
    expect(parseDuplicate({ status: 409, code: 'duplicate_game', details: { duplicate: 'x' } })).toBeNull();
    expect(parseDuplicate(null)).toBeNull();
  });
  it('человеческие тексты ошибок', () => {
    expect(manualErrorText({ status: 409, code: 'manual_limit' }, 'f')).toContain('200');
    expect(manualErrorText({ status: 409, code: 'manual_status_locked' }, 'f')).toContain('Купил');
    expect(manualErrorText({ status: 503, code: 'db_unavailable' }, 'f')).toBe('База данных недоступна. Попробуй позже.');
    expect(manualErrorText(new Error('x'), 'Не удалось убрать. Повтори.')).toBe('Не удалось убрать. Повтори.');
  });
  it('404 и «уже решено» (409) считаются успехом, лимит и дубль нет', () => {
    expect(isGoneOrDone({ status: 404, code: 'not_found' })).toBe(true);
    expect(isGoneOrDone({ status: 409, code: 'whatever' })).toBe(true);
    expect(isGoneOrDone({ status: 409, code: 'manual_limit' })).toBe(false);
    expect(isGoneOrDone({ status: 500, code: 'x' })).toBe(false);
  });
});

describe('список Бэклога', () => {
  it('записи без данных попадают только в «без данных»', () => {
    expect(manualPassesFilters(NO_FILTERS)).toBe(true);
    expect(manualPassesFilters({ ...NO_FILTERS, genres: ['ACTION'] })).toBe(false);
    expect(manualPassesFilters({ ...NO_FILTERS, genres: ['ACTION', 'none'] })).toBe(true);
    expect(manualPassesFilters({ ...NO_FILTERS, duration: ['unknown'] })).toBe(true);
    expect(manualPassesFilters({ ...NO_FILTERS, duration: ['lt10'] })).toBe(false);
    expect(manualPassesFilters({ ...NO_FILTERS, hltb: ['not_found'] })).toBe(false);
    expect(manualPassesFilters({ ...NO_FILTERS, hltb: ['unchecked'] })).toBe(true);
  });
  it('чип «Не куплено» оставляет только записи с пометкой', () => {
    const list = [mg(1), mg(2, { notPurchased: false })];
    expect(visibleManual(list, NO_FILTERS).map((g) => g.id)).toEqual([1, 2]);
    expect(visibleManual(list, { ...NO_FILTERS, nb: true }).map((g) => g.id)).toEqual([1]);
    expect(visibleManual(list, { ...NO_FILTERS, duration: ['lt10'] })).toEqual([]);
    expect(countNotPurchased(list)).toBe(1);
    expect(countNotPurchased(null)).toBe(0);
  });
  it('порядок: после игр; при сортировке по названию на своём месте', () => {
    const games = [{ title: 'Альфа' }, { title: 'Дельта' }];
    const m = [mg(1, { title: 'Бета' }), mg(2, { title: 'Яблоко' })];
    expect(mergeBacklog(games, m, 'last_played', null).map((e) => e.game?.title ?? e.manual?.title)).toEqual(['Альфа', 'Дельта', 'Бета', 'Яблоко']);
    expect(mergeBacklog(games, m, 'title', null).map((e) => e.game?.title ?? e.manual?.title)).toEqual(['Альфа', 'Бета', 'Дельта', 'Яблоко']);
    expect(mergeBacklog([{ title: 'Дельта' }, { title: 'Альфа' }], m, 'title', 'desc').map((e) => e.game?.title ?? e.manual?.title)).toEqual(['Яблоко', 'Дельта', 'Бета', 'Альфа']);
  });
  it('локальные правки: пометка, удаление', () => {
    const l = [mg(1), mg(2)];
    expect(setNotPurchased(l, 1, false)[0].notPurchased).toBe(false);
    expect(l[0].notPurchased).toBe(true);
    expect(setNotPurchased(l, 1, false)[1].notPurchased).toBe(true);
  });
  it('тосты: одна игра с обрезкой, несколько числом', () => {
    expect(addedToastText(['Hades'])).toBe('Добавлено в бэклог: «Hades»');
    expect(addedToastText(['a', 'b', 'c'])).toBe('Добавлено в бэклог: 3');
    expect(truncate('x'.repeat(50)).length).toBe(40);
    expect(truncate('x'.repeat(50)).endsWith('…')).toBe(true);
  });
});

describe('«Это та игра?»', () => {
  const g = { gameId: 1, name: 'Hades II', imageUrl: null };
  it('мета игры библиотеки: дата запуска или часы', () => {
    const f = (h: number) => String(h);
    expect(matchGameMeta({ lastPlayedAt: '2026-10-05T10:00:00.000Z', hours: 3 }, f)).toBe('Последний запуск 5 окт.');
    expect(matchGameMeta({ lastPlayedAt: null, hours: 12 }, f)).toBe('Играл 12 ч');
    expect(matchGameMeta({ lastPlayedAt: null, hours: 0 }, f)).toBe('Нет данных о запуске');
  });
  it('тосты ответов', () => {
    expect(matchToast('yes', { title: 'Hades', game: { ...g, lastPlayedAt: null, hours: 0 } })).toBe('Игра связана: «Hades II»');
    expect(matchToast('no', { title: 'Hades', game: { ...g, lastPlayedAt: null, hours: 0 } })).toBe('Оставили как есть: «Hades»');
  });
  it('порциями по 10', () => {
    const list = Array.from({ length: 25 }, (_, i) => i);
    expect(visibleMatches(list, MATCH_PAGE)).toHaveLength(10);
    expect(visibleMatches(list, 20)).toHaveLength(20);
  });
});
