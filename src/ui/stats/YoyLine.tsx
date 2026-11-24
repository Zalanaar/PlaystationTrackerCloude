'use client';

import { useEffect, useState } from 'react';
import type { StatsResponse } from '@/server/stats/types';
import { fetchStats } from '../collection/api';
import { formatNumber } from '../format';
import { hoursText, selectionToParams, type Selection, type Today } from './model';
import { buildYoy, signed, type YoyItem } from './yoy';

const val = (it: YoyItem, n: number) => (it.key === 'hours' ? hoursText(n) : formatNumber(n));

/**
 * П11.3 «Год к году»: строка под шапкой периода. Показывается, только если у прошлого года есть данные (`years`),
 * место под неё занято сразу (скелет), поэтому вёрстка не прыгает. Ответ прошлого года — тот же /api/stats (кэш 30 с).
 */
export function YoyLine({ data, sel, today }: { data: StatsResponse; sel: Selection; today: Today }) {
  const py = sel.year - 1;
  const show = sel.period !== 'all' && data.years.includes(py);
  const key = `${sel.period}-${sel.year}`;
  const [prev, setPrev] = useState<{ key: string; data: StatsResponse | null } | null>(null);

  useEffect(() => {
    if (!show) return;
    const ac = new AbortController();
    // yoy=1: сервер параметр не читает; метка, чтобы запрос сравнения отличался от выбора периода (журналы, моки e2e)
    const q = selectionToParams({ period: 'year', year: py, month: null });
    q.set('yoy', '1');
    fetchStats(q, ac.signal)
      .then((d) => { if (!ac.signal.aborted) setPrev({ key, data: d }); })
      .catch(() => { if (!ac.signal.aborted) setPrev({ key, data: null }); });
    return () => ac.abort();
  }, [show, py, key]);

  if (!show) return null;
  const p = prev && prev.key === key ? prev : null;
  let body;
  if (!p) {
    body = <p className="ps-yoy" data-testid="yoy" aria-busy="true"><span className="ps-yoy__sk ps-skeleton" aria-hidden="true" /></p>;
  } else {
    const y = p.data ? buildYoy(data, p.data, sel, today) : null;
    body = !y
      ? <p className="ps-yoy" data-testid="yoy">{p.data ? `За ${py} год сравнить не с чем.` : `Сравнение с ${py} годом не загрузилось.`}</p>
      : (
        <p className="ps-yoy" data-testid="yoy">
          <span className="ps-yoy__t">{y.title}:</span>
          {y.items.map((it) => (
            <span key={it.key} className="ps-yoy__i" data-trend={it.delta > 0 ? 'up' : it.delta < 0 ? 'down' : 'same'} title={`${val(it, it.cur)} против ${val(it, it.prev)}`}>
              {it.label} <b className="num">{signed(it.delta, (n) => val(it, n))}</b>
            </span>
          ))}
          {y.note && <span className="ps-yoy__n">({y.note})</span>}
        </p>
      );
  }
  return <div className="ps-yoy-slot">{body}</div>;
}
