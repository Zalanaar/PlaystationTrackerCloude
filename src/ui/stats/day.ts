// П11.1 «Дневник дня»: подписи. Чистые функции.
import type { DayResponse } from '@/server/stats/day';
import { plural } from '../format';
import { summaryParts } from '../trophies/model';
import { formatMinutes } from './activity';

/** Строка-итог дня: «1 ч 35 м · 2 игры · +3 трофея · пройдена 1». Пусто = ничего не было. */
export function daySummary(d: DayResponse): string {
  const p: string[] = [];
  if (d.minutes > 0) p.push(formatMinutes(d.minutes));
  if (d.games.length) p.push(`${d.games.length} ${plural(d.games.length, ['игра', 'игры', 'игр'])}`);
  if (d.trophies.counts.total) p.push(`+${d.trophies.counts.total} ${plural(d.trophies.counts.total, ['трофей', 'трофея', 'трофеев'])}`);
  const done = d.finished.filter((f) => f.kind === 'completed').length;
  const dropped = d.finished.length - done;
  if (done) p.push(`${plural(done, ['пройдена', 'пройдены', 'пройдено'])} ${done}`);
  if (dropped) p.push(`${plural(dropped, ['брошена', 'брошены', 'брошено'])} ${dropped}`);
  return p.join(' · ');
}

/** Текст пустого дня: снимков не было (синк не шёл / до первого / будущее) или день известен, но игры не было. */
export function dayEmptyText(d: DayResponse): string {
  if (d.date > d.today) return 'Этот день ещё не наступил.';
  return d.known ? 'В этот день игры не было.' : 'Нет данных о часах за этот день: снимка не было (до первого синка или синк пропущен).';
}

/** Разбивка трофеев по типам без «+N» («1 платина · 2 бронзы»). */
export const trophyTypesLine = (d: DayResponse): string => summaryParts(d.trophies.counts).slice(1).join(' · ');

/** «год назад», «2 года назад», «5 лет назад». */
export function yearsAgo(date: string, today: string): string {
  const n = Number(today.slice(0, 4)) - Number(date.slice(0, 4));
  return n === 1 ? 'год назад' : `${n} ${plural(n, ['год', 'года', 'лет'])} назад`;
}

/** Строка «В этот день»: до двух игр по минутам и платины по названию; остальное — счётчиками в итоге. */
export function onThisDayLine(d: DayResponse): string {
  const p: string[] = d.games.slice(0, 2).map((g) => g.title);
  if (d.games.length > 2) p.push(`ещё ${d.games.length - 2}`);
  const plat = d.trophies.items.filter((t) => t.type === 'platinum').map((t) => `платина «${t.game?.title ?? t.name ?? 'трофей'}»`);
  return [...p, ...plat].join(', ');
}
