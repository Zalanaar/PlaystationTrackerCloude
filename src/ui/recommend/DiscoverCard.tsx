'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '../icons';
import type { DiscoverItem } from './api';
import { isUpcoming, platformsLine, releaseText } from './model';

export type DiscoverBusy = null | 'plan' | 'hide';

function Media({ item, wide, eager }: { item: DiscoverItem; wide: boolean; eager: boolean }) {
  const [bad, setBad] = useState(false);
  const url = item.coverUrl && !bad ? item.coverUrl : null;
  const letter = <span className="ps-rec__letter" aria-hidden="true">{item.title.trim().charAt(0).toUpperCase()}</span>;
  const cls = wide ? 'ps-rec__media' : 'ps-rec__cover ps-rec__cover--empty';
  /* eslint-disable @next/next/no-img-element -- внешние обложки RAWG, оптимизация next/image не нужна */
  if (wide) {
    return (
      <span className={cls}>
        {url
          ? <img className="ps-rec__banner" src={url} alt="" decoding="async" loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => setBad(true)} />
          : letter}
      </span>
    );
  }
  return url
    ? <img className="ps-rec__cover" src={url} alt="" decoding="async" loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onError={() => setBad(true)} />
    : <span className={cls}>{letter}</span>;
  /* eslint-enable @next/next/no-img-element */
}

/** Карточка режима «Новое от ИИ» (спека 15.3). Название и обложка не кликабельны: игры нет в библиотеке. */
export function DiscoverCard({
  item, index, total, wide, planned, busy, leaving, nowMs, hideHint, onPlan, onHide,
}: {
  item: DiscoverItem; index: number; total: number; wide: boolean; planned: boolean; busy: DiscoverBusy; leaving: boolean; nowMs: number;
  hideHint: string; onPlan: () => void; onHide: () => void;
}) {
  const release = releaseText(item.releaseDate);
  const platforms = platformsLine(item.platforms);
  const disabled = busy !== null;
  return (
    <li
      className="ps-panel ps-rec-panel ps-rec ps-rec--discover" aria-label={`Новая игра ${index + 1} из ${total}: ${item.title}`}
      aria-busy={busy !== null || undefined} data-wide={wide || undefined} data-leaving={leaving || undefined}
    >
      <div className="ps-rec__top">
        <div className="ps-rec__mediabox"><Media item={item} wide={wide} eager={index === 0} /></div>
        <div className="ps-rec__info">
          <h3 className="ps-rec__name ps-rec__name--plain" title={item.title}>{item.title}</h3>
          <p className="ps-rec__date">
            {release ? (
              <>
                <Icon name="calendar" size={12} />
                <span className="num ps-rec__hours-v">Выход: {release}</span>
                {isUpcoming(item.releaseDate, nowMs) && <small>ещё не вышла</small>}
              </>
            ) : <small>Дата выхода не объявлена</small>}
          </p>
          {platforms && <p className="ps-rec__genres">{platforms}</p>}
          <p className="ps-rec__reason">{item.reason}</p>
        </div>
      </div>
      <p className="ps-rec__source">
        Подобрано ИИ, данные{' '}
        <a href="https://rawg.io" target="_blank" rel="noopener noreferrer" aria-label="Данные: RAWG (откроется в новой вкладке)">
          RAWG<Icon name="external-link" size={12} />
        </a>
      </p>
      <div className="ps-rec__actions">
        {planned ? (
          <>
            <button type="button" className="ps-btn ps-btn--ghost ps-rec__start ps-rec__planned" disabled aria-disabled="true" aria-label={`Уже в плане: ${item.title}`}>
              <Icon name="check" size={16} />Уже в плане
            </button>
            <Link href="/roadmap" className="ps-rec__planlink">Открыть план</Link>
          </>
        ) : (
          <button type="button" className="ps-btn ps-btn--primary ps-rec__start" disabled={disabled} aria-label={`В план: ${item.title}`} onClick={onPlan}>
            {busy === 'plan' ? <span className="ps-rec__spin" aria-hidden="true" /> : <Icon name="plus" size={16} />}
            {busy === 'plan' ? 'Добавляю…' : 'В план'}
          </button>
        )}
        <button type="button" className="ps-btn ps-btn--ghost ps-rec__hide" disabled={disabled} title={hideHint} aria-label={`Не интересно: ${item.title}`} onClick={onHide}>
          {busy === 'hide' ? <span className="ps-rec__spin" aria-hidden="true" /> : <Icon name="thumbs-down" size={16} />}
          {busy === 'hide' ? 'Скрываю…' : 'Не интересно'}
        </button>
      </div>
    </li>
  );
}
