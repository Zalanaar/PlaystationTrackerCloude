'use client';

import { useState } from 'react';
import type { GameItem } from '@/server/collection/types';
import { cssUrl } from '../format';
import { PlatinumIcon, StatusGlyph } from '../icons';
import { Cover } from './Cover';
import type { GameActions } from './GameCard';
import { hasTrophyData, heroAriaLabel, heroFacts, heroLabel, heroLayout, heroProgress, miniMeta } from './hero';

/** Арт hero: `bannerUrl`, а если его нет или он не загрузился, размытая обложка (§4.4). */
function HeroArt({ game, banner, onBannerError }: { game: GameItem; banner: string | null; onBannerError: (url: string) => void }) {
  const cover = cssUrl(game.coverUrl) ? game.coverUrl : null;
  return (
    <>
      <span className="ps-artbg" data-blur={!banner || undefined}>
        {banner ? (
          // eslint-disable-next-line @next/next/no-img-element -- внешний арт PSN, оптимизация next/image не нужна
          <img src={banner} alt="" loading="eager" fetchPriority="high" decoding="async" referrerPolicy="no-referrer" onError={() => onBannerError(banner)} />
        ) : cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- внешняя обложка PSN
          <img src={cover} alt="" loading="eager" decoding="async" referrerPolicy="no-referrer" />
        ) : null}
      </span>
      <span className="ps-hero__scrim" />
      {!banner && <span className="ps-hero__cover"><Cover url={game.coverUrl} title={game.title} /></span>}
    </>
  );
}

function HeroMain({ game, total, now, actions }: { game: GameItem; total: number; now: number; actions: GameActions }) {
  const facts = heroFacts(game, now);
  const progress = heroProgress(game);
  const plat = game.trophies?.platinumEarned === true;
  const [failed, setFailed] = useState<string | null>(null);
  const banner = game.bannerUrl && failed !== game.bannerUrl ? game.bannerUrl : null;
  const noBanner = !banner;
  return (
    <article className="ps-hero__main" data-nobanner={noBanner || undefined} data-platinum={plat || undefined} data-status="playing">
      <HeroArt game={game} banner={banner} onBannerError={setFailed} />
      <span className="ps-hero__tag ps-hero__label"><StatusGlyph status="playing" size={16} /><span>{heroLabel(total)}</span></span>
      {plat && <span className="ps-hero__plat" title="Платина получена"><PlatinumIcon size={20} /></span>}
      <div className="ps-hero__info">
        <h2 className="ps-hero__title" title={game.title}>{game.title}</h2>
        <dl className="ps-hero__facts">
          {facts.map((f) => (
            <div key={f.id}>
              <dt>{f.label}</dt>
              <dd className="num" data-muted={f.muted || undefined} title={f.title}>{f.value}</dd>
            </div>
          ))}
        </dl>
        {progress !== null && (
          <div className="ps-hero__prog">
            <span className="ps-hero__bar" role="progressbar" aria-label="Прогресс трофеев" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <i style={{ width: `${progress}%` }} />
            </span>
            <span className="ps-hero__pct num">{progress}%</span>
          </div>
        )}
      </div>
      <button type="button" className="ps-hero__hit" aria-label={heroAriaLabel(game)} onClick={() => actions.open(game)} />
    </article>
  );
}

function Mini({ game, now, actions }: { game: GameItem; now: number; actions: GameActions }) {
  const { time, ago } = miniMeta(game, now);
  const t = game.trophies;
  const show = hasTrophyData(game) && t;
  return (
    <button
      type="button" className="ps-hero__mini" data-platinum={t?.platinumEarned || undefined} onClick={() => actions.open(game)}
      aria-label={`Открыть: ${game.title}${t?.platinumEarned ? ', платина получена' : ''}`}
    >
      <Cover url={game.coverUrl} title={game.title} className="ps-hero__thumb" />
      <span className="ps-hero__mtx">
        <span className="ps-hero__mt" title={game.title}>
          {t?.platinumEarned && <PlatinumIcon size={14} className="ps-hero__mplat" />}
          <span>{game.title}</span>
        </span>
        {time && <span className="ps-hero__mm num">{time}</span>}
        {ago && <span className="ps-hero__mm ps-hero__mm--3 num">{ago}</span>}
        {show && (
          <span className="ps-hero__mtr">
            <span className="ps-hero__mbar" aria-hidden="true"><i style={{ width: `${t.progress}%` }} /></span>
            <span className="ps-hero__mn num">{t.earned}/{t.defined}</span>
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * «Играю сейчас» (design-system §4.4): hero первой игры + компактные карточки остальных.
 * Десктоп: сетка hero + боковая колонка 3 карточки с прокруткой. Мобильный: вертикальный hero и трек со snap (CSS).
 * Одна и та же разметка во всех темах; блок скрыт, если игр нет.
 */
export function PlayingHero({ games, count, now, actions }: { games: GameItem[]; count: number; now: number; actions: GameActions }) {
  const [atEnd, setAtEnd] = useState(false);
  if (!games.length) return null;
  const [first, ...rest] = games;
  const layout = heroLayout(games.length);
  return (
    <section className="ps-hero" aria-label="Играю сейчас" data-side={layout.side || undefined}>
      <HeroMain game={first} total={Math.max(count, games.length)} now={now} actions={actions} />
      {layout.side && (
        <div className="ps-hero__rest">
          <p className="ps-hero__more">Играю ещё {rest.length}</p>
          <div className="ps-hero__sidewrap" data-scrolls={layout.scrolls || undefined} data-end={atEnd || undefined}>
            <ul
              className="ps-hero__side" aria-label="Другие игры, в которые играю"
              onScroll={layout.scrolls ? (e) => {
                const el = e.currentTarget;
                setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 4 || el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
              } : undefined}
            >
              {rest.map((g) => <li key={g.id}><Mini game={g} now={now} actions={actions} /></li>)}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
