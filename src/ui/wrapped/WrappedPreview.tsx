'use client';

import type { WrappedResponse } from '@/server/wrapped/types';
import { formatNumber, plural } from '../format';
import { hoursText } from './model';

/**
 * D-P6: превью года на хабе Итогов — цифры из того же ответа /api/wrapped, что и история (без нового запроса).
 * Высота карточки фиксирована (название игры в одну строку), скелет той же высоты — без сдвига кнопки «Смотреть итоги».
 */
export function WrappedPreview({ data, year }: { data: WrappedResponse | null; year: number | null }) {
  if (!data) {
    return <div className="ps-wpreview ps-wpreview--sk ps-skeleton" aria-hidden="true" data-testid="wpreview-skeleton" />;
  }
  const y = data.year ?? year;
  if (data.mode === 'empty') {
    return (
      <section className="ps-wpreview" aria-labelledby="h-wpreview" data-testid="wpreview" data-empty="true">
        <p className="ps-wpreview__cap">Превью · твой год</p>
        <h2 className="ps-wpreview__y ps-num" id="h-wpreview">{y}</h2>
        <p className="ps-wpreview__empty">За этот год пока нет данных: часы и трофеи появятся после синхронизации.</p>
      </section>
    );
  }
  const h = data.hours;
  const hours = h.hasData && h.total !== null ? `${h.hasEstimate ? '≈ ' : ''}${hoursText(h.total)} ч` : '—';
  const done = data.finished.completed.count;
  const dropped = data.finished.dropped.count;
  const tr = data.trophies.counts;
  const best = data.bestGame?.hasData && data.bestGame.game ? data.bestGame : null;
  const top = data.topGames.items[0] ?? null;
  const pick = best
    ? { cap: 'Игра года', title: best.game!.title, side: best.rating !== null ? `★ ${best.rating}` : '' }
    : top ? { cap: 'Больше всего часов', title: top.game.title, side: `${top.estimated ? '≈ ' : ''}${hoursText(top.hours)} ч` } : null;
  return (
    <section className="ps-wpreview" aria-labelledby="h-wpreview" data-testid="wpreview">
      <p className="ps-wpreview__cap">Превью · твой год</p>
      <h2 className="ps-wpreview__y ps-num" id="h-wpreview">{y}</h2>
      <dl className="ps-wpreview__grid">
        <div><dt>в играх</dt><dd className="ps-num" data-testid="wpreview-hours">{hours}</dd></div>
        <div><dt>пройдено{dropped > 0 ? ` · ${formatNumber(dropped)} брошено` : ''}</dt><dd className="ps-num" data-testid="wpreview-done">{formatNumber(done)}</dd></div>
        <div><dt>{plural(tr.total, ['трофей', 'трофея', 'трофеев'])}</dt><dd className="ps-num" data-testid="wpreview-trophies">{formatNumber(tr.total)}</dd></div>
        <div><dt>{plural(tr.platinum, ['платина', 'платины', 'платин'])}</dt><dd className="ps-num" data-testid="wpreview-plat">{formatNumber(tr.platinum)}</dd></div>
      </dl>
      <div className="ps-wpreview__game" data-testid="wpreview-game">
        {pick ? (
          <>
            <p className="ps-wpreview__gcap">{pick.cap}</p>
            <p className="ps-wpreview__gt" title={pick.title}>{pick.title}</p>
            {pick.side && <span className="ps-wpreview__gs ps-num">{pick.side}</span>}
          </>
        ) : <p className="ps-wpreview__gcap">Игр с часами за год пока нет</p>}
      </div>
    </section>
  );
}
