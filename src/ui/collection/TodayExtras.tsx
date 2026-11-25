'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { GameItem } from '@/server/collection/types';
import { fetchStatusHints } from './api';
import { Cover, THUMB_W } from './Cover';
import type { GameActions } from './GameCard';
import type { HintItem } from '../triage/hints';

/** П.3 (t281u): «Разбор N» рядом со строкой «Сегодня». После синка с новыми играми — точка, ссылка открывает очередь. */
export function TodayTriageLink({ count, fresh }: { count: number; fresh: boolean }) {
  if (count <= 0) return null;
  const n = count > 99 ? '99+' : String(count);
  return (
    <Link
      href="/triage"
      className="ps-today__triage"
      data-fresh={fresh || undefined}
      data-testid="today-triage"
      aria-label={fresh ? `Разбор: ${n}, есть новые игры` : `Разбор: ${n}`}
    >
      {fresh && <i className="ps-today__dot" aria-hidden="true" />}
      <span>Разбор</span> <b className="num">{n}</b>
    </Link>
  );
}

/**
 * П.10 (t281u): 1–2 подсказки смены статуса после синка прямо в «Сегодня». Ничего не применяется само:
 * тап открывает окно игры, статус меняется вручную. «Все» — режим проверки в «Разборе».
 */
export function TodayHints({ total, actions, max = 2 }: { total: number; actions: GameActions; max?: number }) {
  const [items, setItems] = useState<HintItem[] | null>(null);
  useEffect(() => {
    if (total <= 0) return;
    let alive = true;
    fetchStatusHints().then((r) => { if (alive) setItems(r.items.slice(0, max)); }, () => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [total, max]);
  if (total <= 0) return null;
  // t282u: подсказки теперь на виду над карточками — пока грузятся, место держит скелет (без сдвига ленты)
  if (!items) { const rows = Math.min(total, max); return <div className="ps-skeleton ps-thints-sk" aria-hidden="true" style={{ height: rows * 61 + 10 + (total > rows ? 45 : 0) }} />; }
  if (items.length === 0) return null;
  return (
    <section className="ps-thints" aria-label="Подсказки статусов" data-testid="today-hints">
      <ul className="ps-thints__list">
        {items.map((h) => (
          <li key={`${h.gameId}-${h.rule}`}>
            <button type="button" className="ps-thints__it" onClick={() => actions.open(h.game as GameItem)} data-testid="today-hint">
              <Cover url={h.game.coverUrl} title={h.game.title} className="ps-thints__cv" w={THUMB_W} />
              <span className="ps-thints__tx">
                <span className="ps-thints__t">{h.game.title}</span>
                <span className="ps-thints__q">{h.question}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {total > items.length && <Link href="/triage?mode=check" className="ps-thints__all">Все подсказки: <b className="num">{total}</b></Link>}
    </section>
  );
}
