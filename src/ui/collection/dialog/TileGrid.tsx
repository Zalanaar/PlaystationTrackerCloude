import { PlatinumIcon } from '../../icons';
import type { Tile } from '../details';

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
            <span className="ps-gd__tv num" aria-hidden="true">{x.value}</span>
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
