'use client';

import Link from '@/ui/IntentLink'; // Пакет 6: без предзагрузки по экрану, по намерению
import { Icon } from '../icons';
import { hideSeason } from '../wrapped/season';
import { useSeasonOffer } from '../wrapped/useSeason';

/** Баннер «Итоги года» (§8.1): декабрь и январь по МСК, пока не закрыт и есть данные за этот год. ✕ запоминается по году. */
export function WrappedBanner({ years }: { years: readonly number[] }) {
  const year = useSeasonOffer();
  if (year === null || !years.includes(year)) return null;
  return (
    <aside className="ps-wbanner" aria-label="Итоги года">
      <Icon name="sparkles" size={24} className="ps-wbanner__ic" />
      <div className="ps-wbanner__tx">
        <b>Итоги {year} готовы</b>
        <small>Часы, игры и трофеи года историей</small>
      </div>
      <Link href={`/wrapped?year=${year}`} className="ps-btn ps-btn--primary ps-wbanner__go">Смотреть</Link>
      <button type="button" className="ps-wbanner__x" aria-label="Скрыть" onClick={() => hideSeason(year)}>
        <Icon name="x" size={16} />
      </button>
    </aside>
  );
}
