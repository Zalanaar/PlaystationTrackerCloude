// П12.5 «У меня 2 часа»: подписи окна (без DOM и React).
import type { TimeFitItem } from '@/server/collection/time-fit';

export const TIME_OPTIONS = [
  { minutes: 60, label: '1 ч' },
  { minutes: 120, label: '2 ч' },
  { minutes: 180, label: '3 ч' },
  { minutes: 240, label: '4 ч' },
] as const;

/** 45 → «45 мин», 60 → «1 ч», 100 → «1 ч 40 мин», 1530 → «26 ч». */
export function minutesText(m: number): string {
  const v = Math.max(1, Math.round(m));
  if (v < 60) return `${v} мин`;
  const h = Math.floor(v / 60);
  const r = v % 60;
  if (h >= 10 || r === 0) return `${Math.round(v / 60)} ч`;
  return `${h} ч ${r} мин`;
}

export function fitMeta(i: TimeFitItem, minutes: number): string {
  const st = i.status === 'playing' ? 'Играю' : 'Бэклог';
  if (i.remainingMinutes === null) return `${st} · длительность неизвестна`;
  const left = `осталось ≈ ${minutesText(i.remainingMinutes)}`;
  if (i.remainingMinutes > minutes) return i.remainingMinutes <= Math.round(minutes * 1.15) ? `${st} · ${left}, впритык` : `${st} · ${left}`;
  return `${st} · ${left}`;
}

export const FIT_EMPTY = 'За это время пройти ничего не выйдет. Выбери больше времени или продолжи начатое.';
export const FIT_NONE = 'Ничего не помещается. Выбери больше времени или подтяни длительность с HLTB в меню страницы.';
export const FIT_HINT = 'Остаток — длительность (своя или HLTB) минус наигранное, с запасом 15%.';
