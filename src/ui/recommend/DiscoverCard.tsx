'use client';

import Link from '@/ui/IntentLink'; // Пакет 6: без предзагрузки по экрану, по намерению
import { useState } from 'react';
import { Icon } from '../icons';
import type { DiscoverItem } from './api';
import { REASON_TITLE, releaseYear, scoreLine } from './discover-model';
import { genresLine } from './model';
import { OWN_BUTTON } from './owned-model';

export type DiscoverBusy = null | 'plan' | 'hide';

function Media({ item, wide, eager }: { item: DiscoverItem; wide: boolean; eager: boolean }) {
  const [bad, setBad] = useState(false);
  const url = item.coverUrl && !bad ? item.coverUrl : null;
  const letter = <span className="ps-rec__letter" aria-hidden="true">{item.title.trim().charAt(0).toUpperCase()}</span>;
  /* eslint-disable @next/next/no-img-element -- внешние обложки RAWG, оптимизация next/image не нужна */
  if (wide) {
    return (
      <span className="ps-rec__media">
        {url
          ? <img className="ps-rec__banner" src={url} alt="" decoding="async" loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => setBad(true)} />
          : letter}
      </span>
    );
  }
  return url
    ? <img className="ps-rec__cover" src={url} alt="" decoding="async" loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => setBad(true)} />
    : <span className="ps-rec__cover ps-rec__cover--empty">{letter}</span>;
  /* eslint-enable @next/next/no-img-element */
}

/** Карточка «У тебя нет» (спека Фазы 31, 12.2). Название и обложка не кликабельны: игры нет в библиотеке. */
export function DiscoverCard({
  item, index, total, wide, planned, busy, leaving, hideHint, onPlan, onHide, onOwn,
}: {
  item: DiscoverItem; index: number; total: number; wide: boolean; planned: boolean; busy: DiscoverBusy; leaving: boolean;
  hideHint: string; onPlan: () => void; onHide: () => void; onOwn: () => void;
}) {
  const year = releaseYear(item.releaseDate);
  const genres = genresLine(item.genres);
  const score = scoreLine(item.metacritic, item.rating);
  const disabled = busy !== null;
  return (
    <li
      className="ps-panel ps-rec-panel ps-rec ps-rec--discover" aria-label={`Игра ${index + 1} из ${total}: ${item.title}`}
      aria-busy={busy !== null || undefined} data-wide={wide || undefined} data-leaving={leaving || undefined} data-testid="discover-card" data-ext={item.externalId} tabIndex={-1}
    >
      <div className="ps-rec__top">
        <div className="ps-rec__mediabox"><Media item={item} wide={wide} eager={index < 3} /></div>
        <div className="ps-rec__info">
          <h3 className="ps-rec__name ps-rec__name--plain" title={item.title}>{item.title}</h3>
          <p className="ps-rec__meta">
            {year && <><Icon name="calendar" size={12} /><span className="num ps-rec__hours-v">{year}</span></>}
            {item.platforms.map((p) => <span key={p} className="ps-rec__chip">{p}</span>)}
          </p>
          {genres && <p className="ps-rec__genres">{genres}</p>}
          {score && <p className="ps-rec__score">{score}</p>}
          <p className="ps-rec__reason" title={REASON_TITLE[item.reason.source]}>{item.reason.text}</p>
        </div>
      </div>
      <p className="ps-rec__source">
        <a
          href={item.rawgUrl ?? 'https://rawg.io'} target="_blank" rel="noopener noreferrer"
          aria-label={`Открыть «${item.title}» на RAWG (новая вкладка)`}
        >
          Данные: RAWG<Icon name="external-link" size={12} />
        </a>
      </p>
      <div className="ps-rec__actions">
        {planned ? (
          <>
            <button type="button" className="ps-btn ps-btn--ghost ps-rec__start ps-rec__planned" disabled aria-disabled="true" aria-label={`Уже в Плане: ${item.title}`}>
              <Icon name="check" size={16} />Уже в Плане
            </button>
            <Link href="/roadmap" className="ps-rec__planlink">Открыть План</Link>
          </>
        ) : (
          <button type="button" className="ps-btn ps-btn--primary ps-rec__start" disabled={disabled} aria-label={`В План: ${item.title}`} onClick={onPlan}>
            {busy === 'plan' ? <span className="ps-rec__spin" aria-hidden="true" /> : <Icon name="plus" size={16} />}
            {busy === 'plan' ? 'Добавляю…' : 'В План'}
          </button>
        )}
        <button type="button" className="ps-btn ps-btn--ghost ps-rec__hide" disabled={disabled} title={hideHint} aria-label={`Не интересно: ${item.title}`} onClick={onHide}>
          {busy === 'hide' ? <span className="ps-rec__spin" aria-hidden="true" /> : <Icon name="thumbs-down" size={16} />}
          {busy === 'hide' ? 'Скрываю…' : 'Не интересно'}
        </button>
        <button
          type="button" className="ps-btn ps-btn--ghost ps-rec__own" disabled={disabled} aria-haspopup="dialog"
          aria-label={`Уже есть или проходил: «${item.title}»`} onClick={onOwn}
        >
          <Icon name="library" size={16} />{OWN_BUTTON}
        </button>
      </div>
    </li>
  );
}
