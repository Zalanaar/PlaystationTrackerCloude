// Вид блока «История игры» (Фаза 34, спека design-system 12, контракт 26). Чистые функции без React.
import { weekStartOf } from '@/shared/week';
import type { GameHistory } from '@/server/collection/types';
import { formatDayMonth, formatPlayTime, formatShortDate, plural } from '../format';

export type HistoryBar = {
  weekStart: string;
  /** Высота колонки в процентах области графика (0 = столбца нет). */
  totalPct: number;
  /** Секунды реальной / оценочной части: пропорции внутри колонки (flex-grow). */
  realSec: number;
  estSec: number;
  mark: 'platinum' | 'trophy' | null;
  /** Колонка недели первого снимка: слева пунктир «первый синк». */
  syncStart: boolean;
  title: string;
};

export type HistoryView = {
  bars: HistoryBar[];
  showHours: boolean;
  hasEstimate: boolean;
  hasPlatinum: boolean;
  hasTrophies: boolean;
  syncLabel: string | null;
  axisStart: string;
  axisEnd: string;
  truncated: boolean;
  summary: string;
};

const iso = (date: string) => `${date}T12:00:00+03:00`;

/** «4 мая» или «4 мая 2025». */
const dayLabel = (date: string, withYear: boolean): string => formatDayMonth(iso(date), withYear) ?? date;

const timeText = (sec: number) => formatPlayTime(sec) ?? 'меньше минуты';

/** null, если рисовать нечего (нет истории или недель). */
export function historyView(h: GameHistory | null | undefined): HistoryView | null {
  if (!h || h.weeks.length === 0) return null;
  const max = Math.max(0, ...h.weeks.map((w) => w.seconds));
  const weeks = h.weeks;
  const first = weeks[0].weekStart;
  const last = weeks[weeks.length - 1].weekStart;
  const crossYear = first.slice(0, 4) !== last.slice(0, 4);
  const syncWeek = h.firstSnapshotDate ? weekStartOf(h.firstSnapshotDate) : null;
  const syncVisible = syncWeek !== null && weeks.some((w) => w.weekStart === syncWeek);
  const showHours = h.hasHours && max > 0;
  const bars = weeks.map((w): HistoryBar => {
    const parts = [w.seconds > 0 ? `${timeText(w.seconds)}${w.estimatedSeconds > 0 ? ` (из них оценка ${timeText(w.estimatedSeconds)})` : ''}` : 'без часов'];
    if (w.trophies > 0) parts.push(`трофеев ${w.trophies}${w.platinum ? ', платина' : ''}`);
    return {
      weekStart: w.weekStart,
      totalPct: showHours && w.seconds > 0 ? (w.seconds / max) * 100 : 0,
      realSec: w.seconds - w.estimatedSeconds,
      estSec: w.estimatedSeconds,
      mark: w.platinum ? 'platinum' : w.trophies > 0 ? 'trophy' : null,
      syncStart: syncVisible && w.weekStart === syncWeek,
      title: `Неделя с ${dayLabel(w.weekStart, false)}: ${parts.join(', ')}`,
    };
  });
  const peak = weeks.reduce((a, w) => (w.seconds > a.seconds ? w : a), weeks[0]);
  const plat = weeks.find((w) => w.platinum);
  const summary = [
    `Часы по неделям: ${weeks.length} ${plural(weeks.length, ['неделя', 'недели', 'недель'])}`,
    ...(showHours ? [`больше всего ${timeText(peak.seconds)} на неделе с ${dayLabel(peak.weekStart, false)}`] : ['часов нет, только трофеи']),
    ...(plat ? [`платина получена на неделе с ${dayLabel(plat.weekStart, false)}`] : []),
  ].join(', ') + '.';
  return {
    bars,
    showHours,
    hasEstimate: h.hasEstimate,
    hasPlatinum: weeks.some((w) => w.platinum),
    hasTrophies: weeks.some((w) => w.trophies > 0),
    syncLabel: syncVisible && h.firstSnapshotDate ? dayLabel(h.firstSnapshotDate, false) : null,
    axisStart: `${h.truncated ? '… ' : ''}${dayLabel(first, crossYear)}`,
    axisEnd: dayLabel(last, crossYear),
    truncated: h.truncated,
    summary,
  };
}

/** «Играл 14 дней, последний раз 6 июн.»; части опускаются, если данных нет. null = строки нет. */
export function historyLine(h: GameHistory | null | undefined, lastPlayedAt: string | null | undefined, now: number): { played: string | null; last: string | null } | null {
  const days = h?.playedDays ?? null;
  const played = days !== null && days > 0 ? `${days} ${plural(days, ['день', 'дня', 'дней'])}` : null;
  const last = lastPlayedAt ? formatShortDate(lastPlayedAt, now) : null;
  return played || last ? { played, last } : null;
}
