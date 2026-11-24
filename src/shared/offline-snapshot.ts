// Пакет 7, п. 2 + критика п.6: офлайн-просмотр. Общие константы и типы копии данных для экрана /offline
// (сервер, клиент, public/sw.js). Копия лежит в Cache Storage браузера под ключом OFFLINE_DATA_KEY в кэше
// OFFLINE_DATA_CACHE (префикс «ps-»: выход из аккаунта стирает все кэши «ps-*»). Один слот: только активный
// профиль; при смене профиля слот очищается. SW по-прежнему не кэширует закрытый HTML и /api.

/** Имя кэша копии. Не зависит от версии SW: обновление воркера копию не стирает. Держать в синхроне с public/sw.js. */
export const OFFLINE_DATA_CACHE = 'ps-data';
/** Синтетический адрес записи (не /api: SW и проверки кэша /api не пускают). */
export const OFFLINE_DATA_KEY = '/offline-data/snapshot.json';
/** Версия формата: при несовпадении копия игнорируется. */
/** v1 — коллекция/бэклог/статистика; v2 — плюс компактный план года. Старые копии v1 читаем, план тогда пустой. */
export const OFFLINE_SNAPSHOT_VERSION = 2;
/** Обновляем копию не чаще, чем раз в столько (при открытии приложения и возврате во вкладку). */
export const OFFLINE_REFRESH_MS = 10 * 60_000;

export type OfflineStatus = 'playing' | 'completed' | 'dropped' | 'backlog' | 'shelved' | 'service';

export type OfflineGame = {
  id: number;
  title: string;
  coverUrl: string | null;
  platform: string;
  status: OfflineStatus | null;
  hours: number;
  lastPlayedAt: string | null;
  completedAt: string | null;
  /** [получено, всего, платина получена] или null */
  trophies: [number, number, boolean] | null;
  /** длительность (ручная или HLTB), ч; null = неизвестно */
  durationHours: number | null;
};

export type OfflineSnapshot = {
  v: 1 | typeof OFFLINE_SNAPSHOT_VERSION;
  /** ISO UTC: когда сервер собрал копию («данные на …») */
  generatedAt: string;
  /** активный профиль, под которым собрана копия */
  profileId: number;
  onlineId: string | null;
  totals: { games: number; hours: number; trophiesEarned: number; platinumEarned: number };
  counts: { playing: number; completed: number; dropped: number; backlog: number; shelved: number };
  /** видимые игры коллекции, по последнему запуску (новые сверху) */
  games: OfflineGame[];
  /** id игр бэклога в порядке экрана «Бэклог» по умолчанию (по последней игре) */
  backlog: number[];
  stats: {
    year: number;
    completed: number;
    dropped: number;
    hours: number | null;
    platinum: number;
    /** часы по месяцам года (12 чисел или null) */
    hoursByMonth: (number | null)[];
    topByHours: { title: string; hours: number }[];
  };
  /** Компактный план года (v2). У копий v1 поля нет. */
  plan?: OfflinePlan;
};

export type OfflinePlanKind = 'release' | 'backlog' | 'planned';

export type OfflinePlanItem = {
  title: string;
  coverUrl: string | null;
  start: string;
  end: string;
  hours: number | null;
  kind: OfflinePlanKind;
};

export type OfflinePlan = {
  year: number;
  status: 'ok' | 'no_budget';
  hoursPerWeek: number | null;
  capacityHours: number;
  plannedHours: number;
  items: OfflinePlanItem[];
  notFit: number;
};

export function isOfflinePlan(x: unknown): x is OfflinePlan {
  if (!x || typeof x !== 'object') return false;
  const p = x as Partial<OfflinePlan>;
  return (p.status === 'ok' || p.status === 'no_budget') && typeof p.year === 'number' && Array.isArray(p.items);
}

export function isOfflineSnapshot(x: unknown): x is OfflineSnapshot {
  if (!x || typeof x !== 'object') return false;
  const o = x as Partial<OfflineSnapshot>;
  if ((o.v !== 1 && o.v !== 2) || typeof o.generatedAt !== 'string' || typeof o.profileId !== 'number') return false;
  if (!Array.isArray(o.games) || !Array.isArray(o.backlog) || !o.stats || !o.totals || !o.counts) return false;
  // v2 обязательно несёт план; v1 читаем без него (вкладка «План» пустая, пока копия не обновится онлайн).
  if (o.v === 2 && !isOfflinePlan(o.plan)) return false;
  return true;
}
