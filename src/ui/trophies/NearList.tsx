'use client';

import Link from '@/ui/IntentLink';
import type { NearListResponse } from '@/server/trophies/types';
import { Cover, THUMB_W } from '../collection/Cover';
import { APPROX_HINT, avgRarityText, dlcLine, isApproximate, nearAria, remainingGrades } from '../collection/nearPlatinum';
import { Icon } from '../icons';
import { NEAR_EMPTY } from './model';

/**
 * Пакет 6, п. 9: «Почти платина» — все игры с прогрессом к платине (блок на Коллекции показывает первые 5 из этого же порядка).
 * Строка ведёт в окно игры на вкладке «Трофеи».
 */
export function NearList({ data, busy }: { data: NearListResponse; busy: boolean }) {
  if (data.items.length === 0) return <p className="ps-tf__empty" data-testid="tnear-empty">{NEAR_EMPTY}</p>;
  return (
    <ul className="ps-tf__rows ps-tnear" data-busy={busy || undefined} aria-busy={busy || undefined}>
      {data.items.map(({ gameId, title, coverUrl, forecast: f }) => {
        const approx = isApproximate(f);
        const dlc = dlcLine(f);
        return (
          <li key={gameId} data-testid="tnear-row">
            <Link href={`/?game=${gameId}&tab=trophies`} className="ps-tf__row ps-tnear__row" aria-label={nearAria(title, f)}>
              <Cover url={coverUrl} title={title} className="ps-tnear__c" w={THUMB_W} />
              <span className="ps-tf__tx">
                <span className="ps-tf__nm" title={title}>{title}</span>
                <span className="ps-tnear__p">
                  <span className="ps-near__bar" aria-hidden="true"><i style={{ width: `${f.progress}%` }} /></span>
                  <span className="ps-near__s">
                    Осталось {f.remaining.total}:
                    {remainingGrades(f).map((g) => (
                      <span key={g.grade} className="ps-near__g" data-grade={g.grade}><Icon name="trophy" size={14} /><span className="num">{g.n}</span></span>
                    ))}
                  </span>
                </span>
                <span className="ps-tf__gm">{avgRarityText(f)}{dlc ? ` · ${dlc}` : ''}</span>
              </span>
              <span className="ps-tf__rate num" data-testid="tnear-progress">
                {approx && <span className="ps-approx" title={APPROX_HINT}>≈ </span>}{f.progress}%
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
