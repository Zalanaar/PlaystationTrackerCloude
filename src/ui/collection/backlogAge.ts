// П12.4 «Возраст бэклога»: подписи строки над списком и в строках вида «Список». Без DOM и React.
import type { BacklogAgeResponse } from '@/server/collection/backlog-age';
import { formatNumber } from '../format';

const DAY = 86_400_000;

/** «сегодня», «3 дн.», «5 нед.», «8 мес.», «1 г.», «2 г. 3 мес.». */
export function ageText(days: number): string {
  const d = Math.max(0, Math.floor(days));
  if (d < 1) return 'сегодня';
  if (d < 14) return `${d} дн.`;
  if (d < 61) return `${Math.floor(d / 7)} нед.`;
  const months = Math.floor(d / 30.44);
  if (d < 365) return `${Math.max(2, months)} мес.`;
  const y = Math.max(1, Math.floor(d / 365.25));
  const m = Math.max(0, Math.floor((d - y * 365.25) / 30.44));
  return m > 0 ? `${y} г. ${m} мес.` : `${y} г.`;
}

export const daysSince = (iso: string, now: number): number => Math.floor((now - Date.parse(iso)) / DAY);

/** «Половина игр ждёт дольше 8 мес. · дольше года — 12 · дольше всех — Cyberpunk 2077, 2 г. 3 мес.»; пустой бэклог — null. */
export function ageSummary(a: BacklogAgeResponse, now: number): string | null {
  const s = a.summary;
  if (s.count === 0 || s.medianDays === null) return null;
  const parts = [s.count === 1 ? `Ждёт ${ageText(s.medianDays)}` : `Половина игр ждёт дольше ${ageText(s.medianDays)}`];
  if (s.overYear > 0 && s.count > 1) parts.push(`дольше года — ${formatNumber(s.overYear)}`);
  if (s.oldest && s.count > 1) parts.push(`дольше всех — ${s.oldest.title.trim()}, ${ageText(daysSince(s.oldest.since, now))}`);
  return parts.join(' · ');
}

/** Карта id → «В бэклоге 8 мес.» / «Начата 2 г. назад» (отсчёт от первого запуска). */
export function ageMap(a: BacklogAgeResponse | null, now: number): Map<number, string> {
  const m = new Map<number, string>();
  if (!a) return m;
  for (const it of a.items) {
    const t = ageText(daysSince(it.since, now));
    m.set(it.gameId, it.source === 'played' ? (t === 'сегодня' ? 'Начата сегодня' : `Начата ${t} назад`) : t === 'сегодня' ? 'В бэклоге с сегодня' : `В бэклоге ${t}`);
  }
  return m;
}

export const AGE_HINT = 'Отсчёт от первого запуска, если игра начата раньше, иначе от перевода в «Бэклог»';
