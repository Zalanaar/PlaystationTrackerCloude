// F11: у игры-сервиса нет конца — вместо «осталось ≈ 31 ч HLTB» строка «наиграно 89 ч · запуск 14 июл. 2026».
import { formatDayMonth, formatPlayTime } from '../format';

export function serviceLine(playSeconds: number | null | undefined, lastPlayedAt: string | null | undefined): string {
  const played = formatPlayTime(playSeconds ?? 0);
  const last = formatDayMonth(lastPlayedAt ?? null, true);
  const parts = [played ? `наиграно ${played}` : 'не запускалась', last ? `запуск ${last}` : null].filter(Boolean);
  return parts.join(' · ');
}
