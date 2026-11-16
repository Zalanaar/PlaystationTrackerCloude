'use client';

// П8.2: части историй «Итогов» — фон слайда (размытая обложка или мозаика), крупное анимированное число, карточка-сводка года.
import { useEffect, useState, type CSSProperties } from 'react';
import type { WrappedResponse } from '@/server/wrapped/types';
import { Cover } from '../collection/Cover';
import { cssUrl } from '../format';
import { bigNumberCqw, slideMosaic, summaryTiles, type YearSummary } from './look';
import { bestRatingText, counterValue, hoursText, slideCover, COUNTER_MS, type StorySlideId } from './model';

export function Backdrop({ data, id }: { data: WrappedResponse; id: StorySlideId }) {
  const c = slideCover(id, data);
  const url = cssUrl(c?.url);
  const mosaic = url ? [] : slideMosaic(id, data).map((u) => cssUrl(u)).filter((u): u is string => !!u);
  return (
    <div className="ps-story__bg" aria-hidden="true" data-art={url ? 'cover' : mosaic.length ? 'mosaic' : undefined}>
      {url && <div className="ps-story__art" style={{ backgroundImage: url }} />}
      {mosaic.length > 0 && (
        <div className="ps-story__mosaic" data-n={mosaic.length}>
          {mosaic.map((u) => <span key={u} style={{ backgroundImage: u }} />)}
        </div>
      )}
      <div className="ps-story__tint" />
      <div className="ps-story__shade" />
      <div className="ps-story__scrim" />
    </div>
  );
}

/**
 * Крупное число с отсчётом от нуля (ease-out, COUNTER_MS); при reduced-motion сразу итог.
 * Размер шрифта по длине итоговой строки (bigNumberCqw), чтобы «2 840,5» помещалось в ширину сцены.
 * Скринридеру — только итог (`sr`), анимированные цифры aria-hidden.
 */
export function CountUp({ target, rm, format = (n) => String(Math.round(n)), sr, approx, className }: {
  target: number; rm: boolean; format?: (n: number) => string; sr?: string; approx?: boolean; className?: string;
}) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (rm) return;
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const e = now - t0;
      setV(counterValue(e, target));
      if (e < COUNTER_MS) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, rm]);
  const final = format(target);
  const shown = rm ? final : format(v);
  return (
    <span className={`ps-story__num ps-num ${className ?? ''}`} style={{ '--big-cqw': `${bigNumberCqw((approx ? '≈' : '') + final)}cqw` } as CSSProperties}>
      <span className="ps-sr">{sr ?? `${approx ? 'примерно ' : ''}${final}`}</span>
      {approx && <span className="ps-story__approx" aria-hidden="true">≈</span>}
      {/* ширина по итоговому значению: цифры отсчёта не двигают соседей */}
      <span className="ps-story__digits" aria-hidden="true" data-final={final}><span>{shown}</span></span>
    </span>
  );
}

export const hoursFormat = (n: number) => hoursText(n);

/** Финальный слайд: карточка-сводка года (часы, пройдено, платины, трофеи, игра года, топ-3). */
export function SummaryCard({ s }: { s: YearSummary }) {
  const tiles = summaryTiles(s);
  const goty = s.gameOfYear;
  return (
    <section className="ps-sum" aria-label={s.scope === 'all' ? 'Сводка за всё время' : `Сводка ${s.year}`} data-testid="story-summary">
      <p className="ps-sum__k">{s.scope === 'all' ? 'Всё время' : `Итоги ${s.year}`}{s.nick ? ` · ${s.nick}` : ''}</p>
      <ul className="ps-sum__tiles">
        {tiles.map((t) => (
          <li key={t.key} data-key={t.key}><b className="ps-num" data-long={t.value.replace(/\s/g, '').length > 5 || undefined}>{t.value}</b><span>{t.label}</span></li>
        ))}
      </ul>
      {goty && (
        <div className="ps-sum__goty">
          <span className="ps-sum__cv"><Cover url={goty.coverUrl} title={goty.title} /></span>
          <span className="ps-sum__gt">
            <small>{s.scope === 'all' ? 'Игра №1' : 'Игра года'}{goty.reason === 'rating' && goty.rating !== null ? ` · ${bestRatingText(goty.rating)}` : ''}</small>
            <b>{goty.title}</b>
          </span>
        </div>
      )}
      {s.top3.length > 1 && (
        <ol className="ps-sum__top">
          {s.top3.map((g, i) => (
            <li key={g.id}><span className="ps-num">{i + 1}</span><b>{g.title}</b>{g.hours !== null && <small className="ps-num">{g.estimated ? '≈ ' : ''}{hoursText(g.hours)} ч</small>}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
