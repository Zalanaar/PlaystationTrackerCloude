'use client';

import type { GameItem } from '@/server/collection/types';
import { Icon } from '../icons';
import { rangeText } from '../roadmap/model';
import { RemainingMeter } from './RemainingMeter';
import type { NextUp } from './nextUp';

/** D-P3: одна главная кнопка страницы «Бэклог» — следующая игра по плану (/roadmap). Строки списка остаются с тихими ▶. */
export function NextUpCard({ next, game, onPlay, onOpen }: { next: NextUp; game: GameItem; onPlay: () => void; onOpen: () => void }) {
  return (
    <section className="ps-nextup" aria-labelledby="h-bl-nextup" data-testid="bl-nextup">
      <p className="ps-nextup__cap" id="h-bl-nextup">
        Следующая по плану<span className="num"> · {rangeText(next.from, next.to)}</span>
      </p>
      <button type="button" className="ps-nextup__title" onClick={onOpen}>{game.title}</button>
      <RemainingMeter duration={game.duration} playedSeconds={game.playSeconds} variant="row" hideBar />
      <button type="button" className="ps-btn ps-btn--primary ps-nextup__play" aria-label={`Начать играть по плану: ${game.title}`} onClick={onPlay}>
        <Icon name="play" size={16} />Начать играть
      </button>
      {next.then && (
        <p className="ps-nextup__then">Затем по плану: {next.then.title}<span className="num"> · {rangeText(next.then.from, next.then.to)}</span></p>
      )}
    </section>
  );
}
