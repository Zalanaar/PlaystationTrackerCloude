import type { ReactNode } from 'react';
import { PlatinumIcon } from '../../icons';
import type { Tile } from '../details';

/** F18: «45 ч 29 м» переносится целыми частями («45 ч» / «29 м»), а не обрезается на краю узкой плитки. */
export function valueParts(v: string): ReactNode {
  const m = /^(.+?\sч)\s+(\d+\s*м)$/.exec(v);
  if (!m) return v;
  return <><span className="ps-gd__tvp">{m[1]}</span> <span className="ps-gd__tvp">{m[2]}</span></>;
}

/**
 * D-P4: три метрики (часы, запуски, трофеи) одной строкой; платина — строкой внутри ячейки «Трофеи».
 * P2-2: список, а не `dl` с лишними узлами: у каждой ячейки читаемое имя «Трофеи: 12/40, 30%, платина не получена».
 */
export function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <ul className="ps-gd__tiles" role="list">
      {tiles.map((x) => {
        const plat = x.id === 'trophies' ? x.plat : null;
        const name = [x.value, x.sub, plat?.text].filter(Boolean).join(', ');
        return (
          <li key={x.id} className="ps-gd__tile" data-tile={x.id} data-muted={x.muted || undefined} aria-label={`${x.label}: ${name}`}>
            <span className="ps-gd__tl" aria-hidden="true">{x.label}</span>
            <span className="ps-gd__tv num" aria-hidden="true">{valueParts(x.value)}</span>
            {x.sub && <span className="ps-gd__ts" aria-hidden="true">{x.sub}</span>}
            {x.id === 'trophies' && x.progress !== null && (
              <span className="ps-gd__tbar" aria-hidden="true"><i style={{ width: `${x.progress}%` }} /></span>
            )}
            {plat && plat.state !== 'unknown' && (
              <span className="ps-gd__tplatl" data-state={plat.state} data-testid="platinum-line" aria-hidden="true">
                {plat.state === 'earned' && <PlatinumIcon size={16} className="ps-gd__tplat" />}
                {plat.text}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
