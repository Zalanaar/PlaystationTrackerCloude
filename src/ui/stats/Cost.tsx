'use client';

import { useEffect, useId, useState } from 'react';
import Link from '@/ui/IntentLink';
import type { CostGame, CostStats } from '@/server/prices/prices';
import { formatNumber } from '../format';
import { fetchCost } from '../prices/api';
import { perHourText, rub } from '../prices/model';
import { gamesCount } from '../tags/model';
import { Panel } from './Panel';

function Rows({ title, items, testId }: { title: string; items: CostGame[]; testId: string }) {
  if (items.length === 0) return null;
  return (
    <div className="ps-cost__grp">
      <h4 className="ps-cost__h">{title}</h4>
      <ol className="ps-cost__list" data-testid={testId}>
        {items.map((g) => (
          <li key={g.id}>
            <Link href={`/?game=${g.id}`} className="ps-cost__row">
              <span className="ps-cost__t">{g.title}</span>
              <span className="ps-cost__m num">{g.perHour !== null ? perHourText(g.perHour) : ''}</span>
              <span className="ps-cost__d num">{g.price === 0 ? 'бесплатно' : rub(g.price)} · {formatNumber(g.hours)} ч</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * П13.3: «Стоимость часа» в «Всё время» — по играм, у которых указана цена покупки (окно игры).
 * Три цифры (потрачено, часов, час стоит), выгодные и дорогие за час, «куплены и почти не тронуты». Сбой — панели нет.
 */
export function CostPanel() {
  const id = useId();
  const [data, setData] = useState<CostStats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    fetchCost(ac.signal).then((r) => { if (!ac.signal.aborted) setData(r); }, () => { if (!ac.signal.aborted) setFailed(true); });
    return () => ac.abort();
  }, []);
  if (failed) return null;
  const sub = !data ? 'Загрузка…' : data.priced === 0 ? 'Цен пока нет' : `Игр с ценой покупки: ${formatNumber(data.priced)}`;
  return (
    <Panel title="Стоимость часа" labelId={`st-cost-${id}`} className="ps-cost" busy={!data} sub={sub}>
      {!data ? (
        <div className="ps-cost__kpis" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="ps-cost__kpi ps-skeleton" />)}
        </div>
      ) : data.priced === 0 ? (
        <p className="ps-cost__empty">Укажи цену покупки в окне игры («Цена покупки»), и здесь появится, во сколько обходится час игры и какие покупки окупились лучше всего.</p>
      ) : (
        <>
          <dl className="ps-cost__kpis">
            <div className="ps-cost__kpi"><dt>Потрачено</dt><dd className="num" data-testid="cost-total">{rub(data.total)}</dd></div>
            <div className="ps-cost__kpi"><dt>Наиграно</dt><dd className="num">{formatNumber(data.hours)} ч</dd></div>
            <div className="ps-cost__kpi"><dt>Час стоит</dt><dd className="num" data-testid="cost-per-hour">{data.perHour !== null ? perHourText(data.perHour) : '—'}</dd></div>
          </dl>
          <Rows title="Окупились лучше всего" items={data.best} testId="cost-best" />
          <Rows title="Дороже всего за час" items={data.worst} testId="cost-worst" />
          {data.idle.count > 0 && (
            <p className="ps-cost__idle" data-testid="cost-idle">
              Куплены, но сыграно меньше часа: {gamesCount(data.idle.count)} на {rub(data.idle.total)}.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
