'use client';

import { useId, useState } from 'react';
import { Icon } from '../icons';
import { barPercent, genresLine, hoursSourceText, hoursText, maxAbs, scoreText, signedContribution, SOURCE_TEXT } from './model';
import type { RecommendItem } from './api';

export type CardBusy = null | 'start' | 'hide';

function Media({ item, wide, eager }: { item: RecommendItem; wide: boolean; eager: boolean }) {
  const { name, imageUrl, bannerUrl } = item.game;
  const [bad, setBad] = useState<string[]>([]);
  const fail = (u: string) => setBad((l) => [...l, u]);
  const banner = wide && bannerUrl && !bad.includes(bannerUrl) ? bannerUrl : null;
  const cover = imageUrl && !bad.includes(imageUrl) ? imageUrl : null;
  const letter = <span className="ps-rec__letter" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>;
  /* eslint-disable @next/next/no-img-element -- внешние обложки PSN, оптимизация next/image не нужна */
  if (!wide) {
    return cover
      ? <img className="ps-rec__cover" src={cover} alt="" decoding="async" loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => fail(cover)} />
      : <span className="ps-rec__cover ps-rec__cover--empty">{letter}</span>;
  }
  return (
    <span className="ps-rec__media">
      {banner ? (
        <img className="ps-rec__banner" src={banner} alt="" decoding="async" loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => fail(banner)} />
      ) : cover ? (
        <>
          <img className="ps-rec__blur" src={cover} alt="" decoding="async" loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => fail(cover)} />
          <img className="ps-rec__sharp" src={cover} alt="" decoding="async" loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => fail(cover)} />
        </>
      ) : letter}
    </span>
  );
  /* eslint-enable @next/next/no-img-element */
}

export function RecCard({
  item, index, total, wide, open, busy, locked, hideHint, onToggle, onOpenGame, onStart, onHide,
}: {
  item: RecommendItem; index: number; total: number; wide: boolean; open: boolean;
  busy: CardBusy; locked: boolean; hideHint: string;
  onToggle: () => void; onOpenGame: () => void; onStart: () => void; onHide: () => void;
}) {
  const { game, signals, reason } = item;
  const whyId = useId();
  const genres = genresLine(game.genres);
  const hours = hoursText(game.hours);
  const src = hoursSourceText(game.hoursSource);
  const max = maxAbs(signals.map((s) => s.contribution));
  const source = SOURCE_TEXT[reason.source];
  const disabled = busy !== null || locked;

  const info = (
    <>
      <h3 className="ps-rec__name">
        <button type="button" className="ps-rec__namebtn" title={game.name} onClick={onOpenGame}>{game.name}</button>
      </h3>
      {genres && <p className="ps-rec__genres">{genres}</p>}
      <p className="ps-rec__hours">
        {hours ? (
          <>
            <Icon name="clock" size={12} />
            <span className="num ps-rec__hours-v">{hours}</span>
            {src && <small>{src}</small>}
          </>
        ) : <small>Длительность неизвестна</small>}
      </p>
      <p className="ps-rec__reason">{reason.text}</p>
    </>
  );

  return (
    <li className="ps-panel ps-rec-panel ps-rec" aria-label={`Рекомендация ${index + 1} из ${total}: ${game.name}`} aria-busy={busy !== null || undefined} data-wide={wide || undefined}>
      <div className="ps-rec__top">
        <button type="button" className="ps-rec__mediabtn" tabIndex={-1} aria-hidden="true" onClick={onOpenGame}>
          <Media item={item} wide={wide} eager={index < 3} />
        </button>
        <div className="ps-rec__info">{info}</div>
      </div>

      {signals.length > 0 && (
        <div className="ps-rec__why">
          <button type="button" className="ps-rec__whybtn" aria-expanded={open} aria-controls={whyId} onClick={onToggle}>
            <Icon name="chevron-down" size={14} className="ps-rec__chev" />
            <span className="ps-rec__whyt">Почему эта игра</span>
            <small className="ps-rec__src" title={source.title}>{source.label}</small>
          </button>
          <div className="ps-rec__whybody" id={whyId} data-open={open || undefined}>
            <div className="ps-rec__whyin">
              <ul className="ps-rec__sigs">
                <li className="ps-rec__srcnote"><Icon name="info" size={12} /><small>{source.title}</small></li>
                {signals.map((s) => (
                  <li key={s.key} className="ps-rec__sig" data-signal={s.key}>
                    <span className="ps-rec__siglabel">{s.label}</span>
                    <span className="num ps-rec__sigval">{signedContribution(s.contribution)}</span>
                    <span className="ps-rec__bar" role="presentation">
                      <span className="ps-rec__barfill" data-neg={s.contribution < 0 || undefined} style={{ width: `${barPercent(s.contribution, max)}%` }} />
                    </span>
                  </li>
                ))}
                <li className="ps-rec__total"><small>Итоговый балл: <span className="num">{scoreText(item.score)}</span></small></li>
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="ps-rec__actions">
        <button type="button" className="ps-btn ps-btn--primary ps-rec__start" disabled={disabled} aria-label={`Начать играть: ${game.name}`} onClick={onStart}>
          {busy === 'start' && <span className="ps-rec__spin" aria-hidden="true" />}
          {busy === 'start' ? 'Запускаю…' : 'Начать играть'}
        </button>
        <button type="button" className="ps-btn ps-btn--ghost ps-rec__hide" disabled={disabled} title={hideHint} aria-label={`Не интересно: ${game.name}`} onClick={onHide}>
          {busy === 'hide' ? <span className="ps-rec__spin" aria-hidden="true" /> : <Icon name="thumbs-down" size={16} />}
          {busy === 'hide' ? 'Скрываю…' : 'Не интересно'}
        </button>
      </div>
    </li>
  );
}

export function RecSkeleton({ wide }: { wide: boolean }) {
  return (
    <li className="ps-panel ps-rec-panel ps-rec ps-rec--sk" aria-hidden="true" data-wide={wide || undefined}>
      <div className="ps-rec__top">
        {wide ? <div className="ps-skeleton ps-rec__sk-media" /> : <div className="ps-skeleton ps-rec__sk-cover" />}
        <div className="ps-rec__info">
          <div className="ps-skeleton ps-rec__sk-l" style={{ height: 20, width: '70%' }} />
          <div className="ps-skeleton ps-rec__sk-l" style={{ height: 14, width: '50%' }} />
          <div className="ps-skeleton ps-rec__sk-l" style={{ height: 14, width: '40%' }} />
          <div className="ps-skeleton ps-rec__sk-l" style={{ height: 14 }} />
          <div className="ps-skeleton ps-rec__sk-l" style={{ height: 14, width: '85%' }} />
        </div>
      </div>
      <div className="ps-skeleton" style={{ height: 36 }} />
    </li>
  );
}
