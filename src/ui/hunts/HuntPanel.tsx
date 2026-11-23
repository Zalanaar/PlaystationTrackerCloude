'use client';
import Link from '@/ui/IntentLink';
import type { HuntGame, HuntTrophy, HuntsView } from '@/shared/hunts';
import { Cover, THUMB_W } from '../collection/Cover';
import { Icon } from '../icons';
import { gameProgressLine, HUNT_TITLE, trophyName } from './model';
import '../styles/hunts.css';

export function HuntPanel({
  data, onUnpinGame, onUnpinTrophy,
}: {
  data: HuntsView;
  onUnpinGame?: () => void;
  onUnpinTrophy?: (t: HuntTrophy) => void;
}) {
  return (
    <section className="ps-hunt" data-testid="hunt-now" aria-labelledby="hunt-now-title">
      <h2 id="hunt-now-title" className="ps-hunt__h"><Icon name="bookmark" size={16} />{HUNT_TITLE}</h2>
      {data.game && <HuntGameRow g={data.game} onUnpin={onUnpinGame} />}
      {data.trophies.length > 0 && (
        <ul className="ps-hunt__list">
          {data.trophies.map((t) => (
            <li key={`${t.setId}:${t.trophyId}`}>
              <div className="ps-hunt__t">
                <Link href={`/?game=${t.gameId}&tab=trophies`} className="ps-hunt__t" data-testid="hunt-trophy">
                  {t.iconUrl
                    ? <img className="ps-hunt__ic" src={t.iconUrl} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" />
                    : <span className="ps-hunt__ic" aria-hidden="true" />}
                  <span className="ps-hunt__tx">
                    <span className="ps-hunt__nm">{trophyName(t)}</span>
                    <span className="ps-hunt__meta">{t.gameTitle}</span>
                  </span>
                </Link>
                {onUnpinTrophy && (
                  <button type="button" className="ps-hunt__unpin" data-testid="hunt-unpin-trophy" aria-label="Убрать из охоты" onClick={() => onUnpinTrophy(t)}>
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HuntGameRow({ g, onUnpin }: { g: HuntGame; onUnpin?: () => void }) {
  return (
    <div className="ps-hunt__game" data-testid="hunt-game">
      <Link href={`/?game=${g.id}&tab=trophies`} className="ps-hunt__game">
        <Cover url={g.coverUrl} title={g.title} className="ps-hunt__ic" w={THUMB_W} />
        <span className="ps-hunt__tx">
          <span className="ps-hunt__nm">{g.title}</span>
          <span className="ps-hunt__meta">{gameProgressLine(g)}</span>
          <span className="ps-hunt__bar" aria-hidden="true"><i style={{ width: `${g.progress}%` }} /></span>
        </span>
      </Link>
      {onUnpin && (
        <button type="button" className="ps-hunt__unpin" data-testid="hunt-unpin-game" aria-label="Не охотиться за платиной" onClick={onUnpin}>
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}
