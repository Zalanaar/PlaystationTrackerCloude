'use client';

import type { StatsGenreGame } from '@/server/stats/types';
import { Cover, THUMB_W } from '../collection/Cover';
import { HoverCard } from '../primitives/HoverCard';
import { GENRE_POP_THUMBS, GENRE_SHEET_THUMBS, genreGames, genreSubtitle, type GenreBar } from './model';

/**
 * Строка бара жанра с поповером игр (design-system §4.17.1). Нет игр в словаре: строка не интерактивна, поповера нет.
 * Десктоп: hover/focus, до 12 миниатюр + «+N». Мобильный: bottom sheet, сетка 4 колонки, до 16 с названиями.
 */
export function GenreRow({
  bar, games, onOpenGame,
}: { bar: GenreBar; games: Readonly<Record<string, StatsGenreGame>>; onOpenGame: (g: StatsGenreGame) => void }) {
  const row = (
    <>
      <span className="ps-st-genres__n">{bar.label}</span>
      <span className="ps-st-genres__bar" aria-hidden="true"><i style={{ width: `${bar.widthPct}%` }} /></span>
      <span className="ps-st-genres__v ps-num">{bar.text}</span>
    </>
  );
  const total = genreGames(bar.gameIds, games, 0).total;
  if (total === 0) {
    return <li aria-label={`${bar.label}: ${bar.text}`}><div className="ps-st-genres__row">{row}</div></li>;
  }
  const sub = genreSubtitle(bar.value, total);
  return (
    <li>
      <HoverCard
        label={`Игры жанра ${bar.label}`} sheetTitle={`${bar.label}`} className="ps-st-genres__hc"
        trigger={(p) => (
          <button type="button" className="ps-st-genres__row ps-st-genres__row--btn" aria-label={`${bar.label}: ${bar.text} ч. Игры жанра: ${total}`} {...p}>{row}</button>
        )}
      >
        {({ closeToTrigger, sheet }) => {
          const { shown, rest } = genreGames(bar.gameIds, games, sheet ? GENRE_SHEET_THUMBS : GENRE_POP_THUMBS);
          return (
            <div className="ps-gp" data-sheet={sheet || undefined}>
              <p className="ps-gp__head">
                {!sheet && <b>{bar.label}</b>}
                <span className="num">{sub}</span>
              </p>
              <ul className="ps-gp__grid">
                {shown.map((g) => (
                  <li key={g.id}>
                    <button
                      type="button" className="ps-gp__thumb" title={g.title} aria-label={g.title}
                      onClick={() => { closeToTrigger(); onOpenGame(g); }}
                    >
                      <Cover url={g.coverUrl} title={g.title} className="ps-gp__cover" w={THUMB_W} />
                      {sheet && <span className="ps-gp__name">{g.title}</span>}
                    </button>
                  </li>
                ))}
                {rest > 0 && <li className="ps-gp__more num" aria-label={`Ещё ${rest}`}>+{rest}</li>}
              </ul>
            </div>
          );
        }}
      </HoverCard>
    </li>
  );
}
