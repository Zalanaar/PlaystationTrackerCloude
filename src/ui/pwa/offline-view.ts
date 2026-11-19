// Пакет 7, п. 2: чистые функции экрана офлайн-просмотра (/offline с сохранённой копией).
import type { OfflineGame, OfflineSnapshot, OfflineStatus } from '@/shared/offline-snapshot';
import { formatHours, formatHoursApprox } from '../format';

export type OfflineTab = 'collection' | 'backlog' | 'stats';
export const OFFLINE_TABS: { id: OfflineTab; label: string }[] = [
  { id: 'collection', label: 'Коллекция' },
  { id: 'backlog', label: 'Бэклог' },
  { id: 'stats', label: 'Статистика' },
];

/** Вкладка по адресу, который открывали без сети (SW отдаёт /offline на любой закрытый адрес, URL остаётся прежним). */
export function tabFromPath(pathname: string): OfflineTab {
  if (pathname === '/backlog' || pathname.startsWith('/backlog/') || pathname === '/roadmap') return 'backlog';
  if (pathname === '/stats' || pathname.startsWith('/stats/') || pathname === '/wrapped') return 'stats';
  return 'collection';
}

const MONTHS = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
export const MONTHS_SHORT_NOM = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

/** «Данные на 16 нояб., 09:52» в поясе устройства (без «МСК»); другой год — с годом. */
export function asOfLabel(iso: string, nowMs: number, timeZone?: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'Данные на неизвестную дату';
  const parts = (ms: number) => {
    const f = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const o: Record<string, string> = {};
    for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return o;
  };
  const p = parts(t);
  const sameYear = p.year === parts(nowMs).year;
  return `Данные на ${Number(p.day)} ${MONTHS[Number(p.month) - 1]}${sameYear ? '' : ` ${p.year}`}, ${p.hour}:${p.minute}`;
}

/** F28: наиграно — «12 ч 30 м», от 100 ч «128 ч», «0 ч». */
export function hoursText(h: number | null | undefined): string {
  if (h === null || h === undefined || !Number.isFinite(h)) return '—';
  return formatHours(h);
}

/** F28: оценка (длительность бэклога) — «12 ч», до 10 ч «7 ч 30 м». */
export function approxText(h: number): string {
  return formatHoursApprox(h);
}

export function trophiesText(t: OfflineGame['trophies']): string | null {
  if (!t || t[1] <= 0) return null;
  return `${t[0]}/${t[1]}${t[2] ? ' · платина' : ''}`;
}

export type CollectionFilter = 'all' | OfflineStatus | 'none';
export const COLLECTION_FILTERS: { id: CollectionFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'playing', label: 'Играю' },
  { id: 'completed', label: 'Пройдено' },
  { id: 'backlog', label: 'Бэклог' },
  { id: 'dropped', label: 'Брошено' },
  { id: 'shelved', label: 'Отложено' },
];

export function filterGames(games: readonly OfflineGame[], f: CollectionFilter): OfflineGame[] {
  if (f === 'all') return games.filter((g) => g.status !== 'service');
  if (f === 'none') return games.filter((g) => g.status === null);
  return games.filter((g) => g.status === f);
}

export function filterCounts(games: readonly OfflineGame[]): Record<CollectionFilter, number> {
  const out = { all: 0, playing: 0, completed: 0, backlog: 0, dropped: 0, shelved: 0, service: 0, none: 0 } as Record<CollectionFilter, number>;
  for (const g of games) {
    if (g.status !== 'service') out.all += 1;
    out[g.status ?? 'none'] += 1;
  }
  return out;
}

/** Игры бэклога в сохранённом порядке; часы бэклога — сумма известных длительностей. */
export function backlogView(s: OfflineSnapshot): { items: OfflineGame[]; knownHours: number; unknown: number } {
  const byId = new Map(s.games.map((g) => [g.id, g]));
  const items = s.backlog.map((id) => byId.get(id)).filter((g): g is OfflineGame => !!g);
  let knownHours = 0;
  let unknown = 0;
  for (const g of items) {
    if (g.durationHours === null) unknown += 1;
    else knownHours += g.durationHours;
  }
  return { items, knownHours, unknown };
}
