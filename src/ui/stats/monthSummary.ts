// П11.4 мини-итоги месяца в «Играх месяца»: часы, трофеи, главная игра месяца. Чистая функция по ответу /api/stats.
import type { PlayedGroup, StatsResponse } from '@/server/stats/types';
import { plural } from '../format';
import { hoursText } from './model';

export type MonthSummaryPart = { key: 'hours' | 'trophies' | 'top'; text: string };

/** Части строки; пусто = нечего сказать (нет часов, трофеев и игры с часами). */
export function monthSummary(data: StatsResponse, g: PlayedGroup): MonthSummaryPart[] {
  const parts: MonthSummaryPart[] = [];
  const sameYear = data.period.year === g.year && data.period.type !== 'all';
  const hours = sameYear ? data.hours.byMonth[g.monthNumber - 1] ?? null : null;
  const est = sameYear ? (data.hours.estimatedByMonth[g.monthNumber - 1] ?? 0) > 0 : false;
  if (hours !== null && hours > 0) parts.push({ key: 'hours', text: `${est ? '≈ ' : ''}${hoursText(hours)} за месяц` });
  const t = sameYear ? data.trophies.byMonth.find((x) => x.month === g.monthNumber) : undefined;
  if (t && t.total > 0) {
    const plat = t.platinum > 0 ? `, ${t.platinum} ${plural(t.platinum, ['платина', 'платины', 'платин'])}` : '';
    parts.push({ key: 'trophies', text: `${t.total} ${plural(t.total, ['трофей', 'трофея', 'трофеев'])}${plat}` });
  }
  const top = [...g.items].sort((a, b) => b.hours - a.hours)[0];
  const title = top ? data.played.games[String(top.gameId)]?.title : undefined;
  if (top && title && top.hours > 0 && g.items.filter((i) => i.hours > 0).length > 1) {
    const share = hours && hours > 0 ? Math.round((top.hours / hours) * 100) : null;
    parts.push({ key: 'top', text: `больше всего — ${title} (${hoursText(top.hours)}${share !== null && share <= 100 ? `, ${share}%` : ''})` });
  }
  return parts;
}
