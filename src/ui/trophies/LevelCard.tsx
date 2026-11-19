'use client';

import { useEffect, useState } from 'react';
import type { LevelResponse } from '@/server/trophies/level-query';
import { cachedGet } from '../data/http';
import { Icon } from '../icons';
import { LEVEL_EMPTY, LEVEL_HINT, levelEta, levelGrade, levelMeta, levelNextText } from './level';

const URL_LEVEL = '/api/trophies/level';
const mskToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

/** Скелет той же высоты (loading.tsx и до ответа): блок не сдвигает ленту. */
export function LevelCardSkeleton() {
  return <div className="ps-tlevel ps-tlevel--sk" aria-hidden="true"><span className="ps-skeleton ps-tlevel__sk1" /><span className="ps-skeleton ps-tlevel__sk2" /></div>;
}

/** П12.3 «Уровень PSN» над лентой трофеев: уровень, полоса до следующего, прирост за 30 дней и год, прогноз по темпу. */
export function LevelCard({ initial }: { initial: LevelResponse | null }) {
  const [data, setData] = useState<LevelResponse | null>(initial);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    cachedGet<LevelResponse>(URL_LEVEL).then((r) => { if (alive) setData(r); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [initial]);

  if (!data && !failed) return <LevelCardSkeleton />;
  if (!data || data.level === null) {
    return <section className="ps-tlevel ps-tlevel--empty" aria-label="Уровень PSN" data-testid="tlevel"><p className="ps-tlevel__meta">{failed ? 'Не удалось загрузить уровень PSN' : LEVEL_EMPTY}</p></section>;
  }
  const next = levelNextText(data);
  const eta = levelEta(data, mskToday());
  const meta = levelMeta(data, mskToday());
  const bar = data.level >= 999 ? 100 : data.progress;
  return (
    <section className="ps-tlevel" aria-label="Уровень PSN" data-testid="tlevel">
      <div className="ps-tlevel__top">
        <span className="ps-tlevel__lv" data-grade={levelGrade(data.level)}>
          <Icon name="trophy" size={18} />
          <span>Ур. <b className="num" data-testid="tlevel-num">{data.level}</b></span>
        </span>
        {bar !== null && <span className="ps-tlevel__bar" role="progressbar" aria-label={`До уровня ${data.level + 1}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar}><i style={{ width: `${bar}%` }} /></span>}
        {next && <span className="ps-tlevel__next num" data-testid="tlevel-next">{next}</span>}
      </div>
      {/* F21: две строки вместо одной «шифровки»: когда следующий уровень и сколько набрано за год */}
      {eta && <p className="ps-tlevel__eta" data-testid="tlevel-eta" title={data.eta ? LEVEL_HINT : undefined}>{eta}</p>}
      {meta && <p className="ps-tlevel__meta" data-testid="tlevel-meta">{meta}</p>}
    </section>
  );
}
