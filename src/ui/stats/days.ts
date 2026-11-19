// F20 (аудит UX): режим «Месяц» — часы по дням выбранного месяца из суточной активности (ежедневные снимки).
import { formatMinutes } from './activity';

export type DayBar = { day: number; date: string; minutes: number | null; heightPct: number };
export type DaysModel = { bars: DayBar[]; totalMinutes: number; playedDays: number; best: DayBar | null; hasData: boolean };

const pad = (n: number) => String(n).padStart(2, '0');

/** Столбцы 1…N дней месяца; null — снимков за день нет (до начала учёта или в будущем). */
export function daysModel(days: readonly { date: string; minutes: number | null }[], year: number, month: number): DaysModel {
  const n = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDate = new Map(days.map((d) => [d.date, d.minutes]));
  const raw = Array.from({ length: n }, (_, i) => {
    const date = `${year}-${pad(month)}-${pad(i + 1)}`;
    return { day: i + 1, date, minutes: byDate.has(date) ? (byDate.get(date) ?? null) : null };
  });
  const max = Math.max(0, ...raw.map((d) => d.minutes ?? 0));
  const bars = raw.map((d) => ({ ...d, heightPct: max > 0 && d.minutes ? Math.max(2, Math.round((d.minutes / max) * 100)) : 0 }));
  const played = bars.filter((b) => (b.minutes ?? 0) > 0);
  const best = played.reduce<DayBar | null>((a, b) => (!a || (b.minutes ?? 0) > (a.minutes ?? 0) ? b : a), null);
  return {
    bars, totalMinutes: played.reduce((s, b) => s + (b.minutes ?? 0), 0), playedDays: played.length, best,
    hasData: bars.some((b) => b.minutes !== null),
  };
}

export const dayValueText = (m: number | null) => (m === null ? 'нет данных' : m === 0 ? 'не играл' : formatMinutes(m));
