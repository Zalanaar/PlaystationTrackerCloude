'use client';

import Link from '@/ui/IntentLink'; // Пакет 6: без предзагрузки по экрану, по намерению
import { Icon } from '../icons';
import { useNow } from '../primitives/hooks';
import { hideSeason, seasonPreliminary } from '../wrapped/season';
import { useSeasonOffer } from '../wrapped/useSeason';
import type { WrappedSeason } from '@/shared/wrapped-season';
import { useTodayBits } from '../collection/TodayBlock';

type Props = {
  /** Годы с данными (Статистика): баннер только для них. Пока список не пришёл (пустой) или его нет (главная), не проверяем. */
  years?: readonly number[];
  /** П8.4: сезон, который нарисовал сервер (null = не рисовал), чтобы баннер не появлялся после гидрации (CLS 0). */
  ssr?: WrappedSeason | null;
  /** Главная: одна строка ~56 px (первый экран с «Играю» на 360x640 не уезжает), вся строка ведёт в Итоги. */
  compact?: boolean;
};

/** Баннер «Итоги года» (§8.1, П8.4): декабрь и январь по МСК, пока не закрыт. В декабре итоги «предварительно». ✕ запоминается по году. */
export function WrappedBanner({ years, ssr = null, compact = false }: Props) {
  const year = useSeasonOffer(ssr?.year ?? null);
  const now = useNow();
  const shown = year !== null && !(years && years.length > 0 && !years.includes(year));
  useTodayBits('wrapped', { wrapped: shown && compact ? `Итоги ${year}` : undefined });
  if (!shown) return null;
  // до гидрации времени нет: берём то, что посчитал сервер
  const preliminary = now ? seasonPreliminary(now) : (ssr?.preliminary ?? false);
  const pre = preliminary && <span className="ps-wbanner__pre">предварительно</span>;
  const close = (
    <button type="button" className="ps-wbanner__x" aria-label="Скрыть" onClick={() => hideSeason(year)}>
      <Icon name="x" size={16} />
    </button>
  );
  if (compact) {
    return (
      <aside className="ps-wbanner ps-wbanner--compact" aria-label="Итоги года" data-testid="wrapped-banner">
        <Link href={`/wrapped?year=${year}`} className="ps-wbanner__row">
          <Icon name="sparkles" size={20} className="ps-wbanner__ic" />
          <span className="ps-wbanner__tx">
            <b>Итоги {year} готовы</b>
            <small>{pre}<span className="ps-wbanner__rest">{preliminary ? 'до 31 дек' : 'Часы, игры и трофеи года'}</span></small>
          </span>
          <Icon name="chevron-right" size={16} className="ps-wbanner__chev" />
        </Link>
        {close}
      </aside>
    );
  }
  return (
    <aside className="ps-wbanner" aria-label="Итоги года" data-testid="wrapped-banner">
      <Icon name="sparkles" size={24} className="ps-wbanner__ic" />
      <div className="ps-wbanner__tx">
        <span className="ps-wbanner__head"><b>Итоги {year} готовы</b>{pre}</span>
        <small>{preliminary ? 'Год ещё идёт, цифры обновятся' : 'Часы, игры и трофеи года историей'}</small>
      </div>
      <Link href={`/wrapped?year=${year}`} className="ps-btn ps-btn--primary ps-wbanner__go">Смотреть</Link>
      {close}
    </aside>
  );
}
