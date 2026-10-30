import { PlatinumIcon } from '../../icons';
import type { Tile } from '../details';

export function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className="ps-gd__tiles">
      {tiles.map((x) => (
        <div
          key={x.id} className="ps-gd__tile" data-tile={x.id} data-state={x.id === 'platinum' ? x.state : undefined} data-muted={x.muted || undefined}
          role={x.id === 'platinum' ? 'group' : undefined} aria-label={x.id === 'platinum' ? x.aria : undefined}
        >
          <dt>{x.label}</dt>
          <dd className="ps-gd__tv num">
            {x.id === 'platinum' && x.state !== 'unknown' && <PlatinumIcon size={24} className="ps-gd__tplat" />}
            <span>{x.value}</span>
          </dd>
          {x.id === 'trophies' && x.progress !== null && (
            <span className="ps-gd__tbar" aria-hidden="true"><i style={{ width: `${x.progress}%` }} /></span>
          )}
          {x.sub && <span className="ps-gd__ts" title={x.sub}>{x.sub}</span>}
        </div>
      ))}
    </dl>
  );
}
