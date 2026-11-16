'use client';

import type { GameItem } from '@/server/collection/types';
import { cssUrl, formatDayMonth, formatPlayTime, PSN_W, psnImageUrl } from '../format';
import { completionInfo } from './filters';
import type { GameActions } from './GameCard';

/** Подпись карточки «Недавно в коллекции»: дата завершения и наигранное время (как на карточке хроники). */
export function recentMeta(game: Pick<GameItem, 'status' | 'completedAt' | 'droppedAt' | 'playSeconds'>): string {
  const done = completionInfo(game);
  return [done ? formatDayMonth(done.iso) : null, formatPlayTime(game.playSeconds)].filter(Boolean).join(' · ');
}

/**
 * Айдентика тем, шаг 5: карточка-герой из последней игры хроники, когда блока «Играю» нет.
 * Разметка одна во всех темах, видна только в теме ps5 (CSS): в остальных display none, картинка lazy и не грузится.
 * Высота фиксированная (как у скелета), поэтому появление карточки не сдвигает страницу.
 */
export function RecentHero({ game, actions }: { game: GameItem; actions: GameActions }) {
  // только обложка: в облегчённых данных `/` у игр хроники нет баннера (slim.test)
  const art = cssUrl(game.coverUrl) && game.coverUrl ? psnImageUrl(game.coverUrl, PSN_W.large) : null;
  const meta = recentMeta(game);
  return (
    <section className="ps-recent" aria-label="Недавно в коллекции" data-testid="recent-hero">
      <button type="button" className="ps-recent__card" aria-label={`Открыть: ${game.title}`} onClick={() => actions.open(game)}>
        <span className="ps-artbg">
          {/* eslint-disable-next-line @next/next/no-img-element -- внешний арт PSN */}
          {art && <img src={art} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
        </span>
        {/* от 768 px (t199u): обложка рядом с подписью, как карточка активности; на телефоне скрыта CSS */}
        {/* eslint-disable-next-line @next/next/no-img-element -- внешний арт PSN */}
        {art && <img className="ps-recent__cover" src={art} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
        <span className="ps-recent__scrim">
          <span className="ps-recent__k">Недавно в коллекции</span>
          <span className="ps-recent__t">{game.title}</span>
          {meta && <span className="ps-recent__m num">{meta}</span>}
        </span>
      </button>
    </section>
  );
}

/** Скелет той же высоты: пока нет данных и «Играю» не ожидается (виден тоже только в ps5). */
export function RecentHeroSkeleton() {
  return <div className="ps-recent ps-recent--sk" aria-hidden="true"><span className="ps-skeleton ps-recent__sk" /></div>;
}
