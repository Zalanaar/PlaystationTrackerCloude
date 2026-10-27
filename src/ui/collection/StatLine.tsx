import type { CollectionSummaryResponse } from '@/server/collection/types';
import { formatNumber, plural } from '../format';

/** «214 игр · 1 928 ч · 35 платин» одной строкой. Нет данных до первого синка: строка скрыта. */
export function StatLine({ totals, loading }: { totals: CollectionSummaryResponse['totals'] | null; loading: boolean }) {
  if (!totals) return loading ? <span className="ps-statline__sk ps-skeleton" aria-hidden="true" /> : null;
  if (totals.games === 0) return null;
  const n = totals.platinumEarned;
  return (
    <p className="ps-statline ps-num" aria-label="Итоги коллекции">
      <b>{formatNumber(totals.games)}</b> {plural(totals.games, ['игра', 'игры', 'игр'])}
      <span className="ps-statline__dot" aria-hidden="true">·</span>
      <b>{formatNumber(totals.hours)}</b> ч
      <span className="ps-statline__dot" aria-hidden="true">·</span>
      <b>{formatNumber(n)}</b> {plural(n, ['платина', 'платины', 'платин'])}
    </p>
  );
}
