import { describe, expect, it } from 'vitest';
import {
  backlogSortId, backlogToApi, backlogToUrl, DEFAULT_BACKLOG, durationText, formatHours, hltbStatusText, hoursInputValue, parseBacklogFilters,
  genreCount, parseHoursInput, resetBacklogFilters, sourceLabel, toggleValue,
  moveBetweenLists, serviceToApi,
} from './backlog';

const p = (s: string) => new URLSearchParams(s);

describe('фильтры бэклога <-> URL', () => {
  it('пустой URL = умолчания', () => {
    expect(parseBacklogFilters(p(''))).toEqual(DEFAULT_BACKLOG);
    expect(backlogToUrl(DEFAULT_BACKLOG).toString()).toBe('');
  });
  it('круг: жанры (регистр), длительность, сортировка', () => {
    const f = parseBacklogFilters(p('genres=action,role_playing_games&duration=10_30,unknown&sort=duration&order=desc'));
    expect(f).toEqual({ genres: ['ACTION', 'ROLE_PLAYING_GAMES'], duration: ['10_30', 'unknown'], hltb: [], sort: 'duration', order: 'desc' });
    expect(backlogToUrl(f).toString()).toBe('genres=ACTION%2CROLE_PLAYING_GAMES&duration=10_30%2Cunknown&sort=duration&order=desc');
  });
  it('мусор и дубли отбрасываются', () => {
    const f = parseBacklogFilters(p('genres=ACTION,zzz,ACTION&duration=bad,lt10&sort=hours&order=up'));
    expect(f).toEqual({ genres: ['ACTION'], duration: ['lt10'], hltb: [], sort: 'last_played', order: null });
  });
  it('служебный жанр none: круг URL, любой регистр, сочетание с обычными, в query API', () => {
    const f = parseBacklogFilters(p('genres=NONE,horror,None'));
    expect(f.genres).toEqual(['none', 'HORROR']);
    expect(backlogToUrl(f).toString()).toBe('genres=none%2CHORROR');
    expect(backlogToApi(f, { limit: 300, offset: 0 }).get('genres')).toBe('none,HORROR');
  });
  it('счётчик жанра: нет ключа = 0, нет объекта = null', () => {
    expect(genreCount({ ACTION: 3, none: 1 }, 'ACTION')).toBe(3);
    expect(genreCount({ ACTION: 3 }, 'none')).toBe(0);
    expect(genreCount(null, 'ACTION')).toBeNull();
  });
  it('order по умолчанию не пишется', () => {
    expect(parseBacklogFilters(p('sort=duration&order=asc')).order).toBeNull();
    expect(backlogToUrl({ ...DEFAULT_BACKLOG, sort: 'duration', order: 'asc' }).toString()).toBe('sort=duration');
  });
  it('query API: статус backlog, жанры ИЛИ, бакеты, сортировка', () => {
    const q = backlogToApi({ genres: ['ACTION', 'HORROR'], duration: ['lt10', 'unknown'], hltb: [], sort: 'duration', order: null }, { limit: 300, offset: 0 });
    expect(q.get('status')).toBe('backlog');
    expect(q.get('genres')).toBe('ACTION,HORROR');
    expect(q.get('duration')).toBe('lt10,unknown');
    expect(q.get('sort')).toBe('duration');
    expect(q.has('order')).toBe(false);
  });
  it('без фильтров параметров genres/duration нет', () => {
    const q = backlogToApi(DEFAULT_BACKLOG, { limit: 300, offset: 300 });
    expect(q.has('genres') || q.has('duration')).toBe(false);
    expect(q.get('offset')).toBe('300');
  });
  it('toggleValue и сброс', () => {
    expect(toggleValue(['A'], 'B')).toEqual(['A', 'B']);
    expect(toggleValue(['A', 'B'], 'A')).toEqual(['B']);
    expect(resetBacklogFilters({ genres: ['ACTION'], duration: ['lt10'], hltb: [], sort: 'duration', order: 'desc' })).toEqual({ genres: [], duration: [], hltb: [], sort: 'duration', order: 'desc' });
  });
  it('id пункта сортировки', () => {
    expect(backlogSortId({ sort: 'duration', order: 'desc' })).toBe('duration_desc');
    expect(backlogSortId({ sort: 'duration', order: null })).toBe('duration');
  });
});

describe('показ длительности', () => {
  it('часы и прочерк', () => {
    expect(durationText({ hours: 12 })).toBe('≈ 12 ч');
    expect(durationText({ hours: 21.9 })).toBe('≈ 22 ч');
    expect(durationText({ hours: 7.5 })).toBe('≈ 7,5 ч');
    expect(durationText({ hours: null })).toBe('—');
    expect(durationText(undefined)).toBe('—');
    expect(formatHours(0.1)).toBe('0,1');
  });
  it('источник и статус HLTB', () => {
    expect(sourceLabel('manual')).toBe('вручную');
    expect(sourceLabel('hltb')).toBe('HLTB');
    expect(sourceLabel(null)).toBeNull();
    const h = { status: 'found' as const, id: 1, name: 'Hades', mainHours: 20, extraHours: null, checkedAt: null };
    expect(hltbStatusText(h)).toBe('Найдено: Hades');
    expect(hltbStatusText({ ...h, status: 'not_found', name: null })).toBe('На HLTB не найдено');
    expect(hltbStatusText({ ...h, status: 'unchecked', name: null })).toBe('Ещё не проверялось');
  });
});

describe('ручной ввод часов', () => {
  it('принимает запятую и точку, округляет до 0,1', () => {
    expect(parseHoursInput('12')).toBe(12);
    expect(parseHoursInput(' 12,5 ')).toBe(12.5);
    expect(parseHoursInput('0.14')).toBe(0.1);
    expect(parseHoursInput('1000')).toBe(1000);
  });
  it('отклоняет пустое, мусор и границы', () => {
    for (const bad of ['', ' ', 'abc', '-3', '0', '0,04', '1000,1', '1e3', '1,2,3']) expect(parseHoursInput(bad)).toBeNull();
  });
  it('значение поля', () => {
    expect(hoursInputValue(12.5)).toBe('12,5');
    expect(hoursInputValue(null)).toBe('');
  });
});

describe('фильтр hltb', () => {
  it('разбор URL, query API и сброс', async () => {
    const { parseBacklogFilters, backlogToUrl, backlogToApi, hasBacklogFilters, resetBacklogFilters, isNotOnHltb } = await import('./backlog');
    const f = parseBacklogFilters(new URLSearchParams('hltb=not_found,bad,not_found,unchecked&genres=ACTION'));
    expect(f.hltb).toEqual(['not_found', 'unchecked']);
    expect(backlogToUrl(f).toString()).toBe('genres=ACTION&hltb=not_found%2Cunchecked');
    expect(backlogToApi(f, { limit: 10, offset: 0 }).get('hltb')).toBe('not_found,unchecked');
    expect(hasBacklogFilters(parseBacklogFilters(new URLSearchParams('hltb=found')))).toBe(true);
    expect(resetBacklogFilters(f).hltb).toEqual([]);
    expect(isNotOnHltb({ hltb: { status: 'not_found', id: null, name: null, mainHours: null, extraHours: null, checkedAt: null } })).toBe(true);
    expect(isNotOnHltb(undefined)).toBe(false);
  });
});

describe('moveBetweenLists: блоки бэклога и сервиса', () => {
  type G = { id: number; status: 'backlog' | 'service' | 'playing' | null };
  const lists = { backlog: [{ id: 1, status: 'backlog' }, { id: 2, status: 'backlog' }] as G[], service: [{ id: 3, status: 'service' }] as G[] };
  it('бэклог -> сервис', () => {
    const r = moveBetweenLists(lists, lists.backlog[0], 'service');
    expect(r.lists.backlog.map((g) => g.id)).toEqual([2]);
    expect(r.lists.service.map((g) => g.id)).toEqual([1, 3]);
    expect(r.lists.service[0].status).toBe('service');
    expect([r.backlogDelta, r.serviceDelta]).toEqual([-1, 1]);
  });
  it('сервис -> бэклог и сервис -> без статуса', () => {
    const a = moveBetweenLists(lists, lists.service[0], 'backlog');
    expect(a.lists.backlog.map((g) => g.id)).toEqual([3, 1, 2]);
    expect(a.lists.service).toEqual([]);
    expect([a.backlogDelta, a.serviceDelta]).toEqual([1, -1]);
    const b = moveBetweenLists(lists, lists.service[0], null);
    expect(b.lists.backlog).toHaveLength(2);
    expect([b.backlogDelta, b.serviceDelta]).toEqual([0, -1]);
  });
  it('в другой статус игра покидает оба блока', () => {
    const r = moveBetweenLists(lists, lists.backlog[1], 'playing');
    expect(r.lists.backlog.map((g) => g.id)).toEqual([1]);
    expect(r.lists.service.map((g) => g.id)).toEqual([3]);
  });
  it('запрос сервиса без фильтров бэклога', () => {
    expect(serviceToApi(50).toString()).toBe('status=service&sort=last_played&limit=50&offset=0');
  });
});
