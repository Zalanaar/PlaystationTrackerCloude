'use client';

import type { GameItem } from '@/server/collection/types';
import { formatPlayTime, relativeAgo } from '../format';
import { StatusGlyph } from '../icons';
import { Cover } from './Cover';
import type { GameActions } from './GameCard';

/** Лента «Играю»: десктоп ряд миниатюр, мобильный scroll-snap с элементом 220px (design-system §4.4). */
export function PlayingStrip({ games, count, now, actions }: { games: GameItem[]; count: number; now: number; actions: GameActions }) {
  if (!games.length) return null;
  return (
    <section className="ps-strip" aria-label="Играю">
      <div className="ps-strip__lbl">
        <StatusGlyph status="playing" size={16} />
        <span className="ps-strip__lbl-t">Играю</span>
        <span className="ps-strip__lbl-n num">{count}</span>
      </div>
      <span className="ps-strip__div" aria-hidden="true" />
      <ul className="ps-strip__track">
        {games.map((g) => {
          const meta = [formatPlayTime(g.playSeconds), relativeAgo(g.lastPlayedAt, now)].filter(Boolean).join(' · ');
          return (
            <li key={g.id}>
              <button type="button" className="ps-strip__item" onClick={() => actions.open(g)} aria-label={`Открыть: ${g.title}`}>
                <Cover url={g.coverUrl} title={g.title} className="ps-strip__thumb" />
                <span className="ps-strip__tx">
                  <span className="ps-strip__t" title={g.title}>{g.title}</span>
                  {meta && <span className="ps-strip__m num">{meta}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
