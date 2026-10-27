// Чистое форматирование для UI. Даты показываем по Europe/Moscow (UTC+3 без перехода на летнее время).
const MSK_OFFSET_MS = 3 * 3600_000;
const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Компоненты даты в Москве. */
export function mskParts(ms: number): { y: number; m: number; d: number } {
  const x = new Date(ms + MSK_OFFSET_MS);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** «28 ч 17 мин», «6 мин», «5 ч». null, если игра не запускалась. */
export function formatPlayTime(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 60) return null;
  const total = Math.floor(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

/** «56 ч» для таблицы. */
export function formatHoursShort(hours: number): string {
  return `${formatNumber(Math.round(hours))} ч`;
}

/** Группы разрядов пробелом: «1 928». */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** ДД.ММ.ГГГГ по Москве. */
export function formatDate(iso: string | null | undefined): string | null {
  const t = parse(iso);
  if (t === null) return null;
  const p = mskParts(t);
  return `${pad(p.d)}.${pad(p.m)}.${p.y}`;
}

/** «5 октября 2026 г.» */
export function formatDateLong(iso: string | null | undefined): string | null {
  const t = parse(iso);
  if (t === null) return null;
  const p = mskParts(t);
  return `${p.d} ${MONTHS_GEN[p.m - 1]} ${p.y} г.`;
}

/** «12 окт.» в текущем году, иначе «12.10.2025». */
export function formatShortDate(iso: string | null | undefined, nowMs: number): string | null {
  const t = parse(iso);
  if (t === null) return null;
  const p = mskParts(t);
  if (p.y === mskParts(nowMs).y) return `${p.d} ${MONTHS_SHORT[p.m - 1]}`;
  return formatDate(iso);
}

function dayNumber(ms: number): number {
  return Math.floor((ms + MSK_OFFSET_MS) / 86_400_000);
}

/** «сегодня», «вчера», «N дн. назад», «N нед. назад», «N мес. назад», «N г. назад». */
export function relativeAgo(iso: string | null | undefined, nowMs: number): string | null {
  const t = parse(iso);
  if (t === null) return null;
  const days = dayNumber(nowMs) - dayNumber(t);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  if (days < 30) return `${Math.floor(days / 7)} нед. назад`;
  if (days < 365) return `${Math.floor(days / 30)} мес. назад`;
  return `${Math.floor(days / 365)} г. назад`;
}

/** Возраст синка для шапки: «только что», «5 мин назад», «3 ч назад», «2 дн. назад». */
export function syncAge(iso: string | null | undefined, nowMs: number): string | null {
  const t = parse(iso);
  if (t === null) return null;
  const min = Math.floor((nowMs - t) / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} ч назад`;
  return `${Math.floor(h / 24)} дн. назад`;
}

export const STALE_SYNC_HOURS = 36;

export function isSyncStale(iso: string | null | undefined, nowMs: number): boolean {
  const t = parse(iso);
  return t === null || nowMs - t > STALE_SYNC_HOURS * 3600_000;
}

/** Русское склонение: plural(19, ['запуск','запуска','запусков']). */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b === 1) return forms[0];
  if (b >= 2 && b <= 4) return forms[1];
  return forms[2];
}

export function launchesText(n: number): string {
  return `${n} ${plural(n, ['запуск', 'запуска', 'запусков'])}`;
}

/** Безопасный url() для inline-стиля `--hero-art`; не-http(s) отбрасывается. */
export function cssUrl(u: string | null | undefined): string | undefined {
  if (!u || !/^https?:\/\//i.test(u)) return undefined;
  return `url("${u.replace(/["\\\n\r]/g, encodeURIComponent)}")`;
}
