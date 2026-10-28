'use client';

import type { NearPlatinumItem } from '@/server/collection/types';
import { Icon, PlatinumIcon } from '../icons';
import '../phase15.css';
import { Cover } from './Cover';
import { APPROX_HINT, anyApproximate, avgRarityText, isApproximate, nearAria, remainingGrades } from './nearPlatinum';

function Item({ item, onOpen }: { item: NearPlatinumItem; onOpen: (g: NearPlatinumItem['game']) => void }) {
  const { game, forecast: f } = item;
  const approx = isApproximate(f);
  return (
    <li>
      <button type="button" className="ps-near" aria-label={nearAria(game.title, f)} onClick={() => onOpen(game)}>
        <Cover url={game.coverUrl} title={game.title} className="ps-near__c" />
        <span className="ps-near__t">
          <b title={game.title}>{game.title}</b>
          <span className="ps-near__p">
            <span className="ps-near__bar" aria-hidden="true"><i style={{ width: `${f.progress}%` }} /></span>
            <span className="num">{approx && <span className="ps-approx" title={APPROX_HINT} aria-hidden="true">≈ </span>}{f.progress}%</span>
          </span>
          <span className="ps-near__s">
            Осталось {f.remaining.total}:
            {remainingGrades(f).map((g) => (
              <span key={g.grade} className="ps-near__g" data-grade={g.grade} aria-label={`${g.word}: ${g.n}`}><Icon name="trophy" size={14} /><span className="num">{g.n}</span></span>
            ))}
          </span>
          <span className="ps-near__s2">{avgRarityText(f)}</span>
        </span>
      </button>
    </li>
  );
}

/** «Ближе всего к платине» (п.8.2): до 5 игр по прогнозу платины. Сетка на десктопе, горизонтальный трек на мобильном. */
export function NearPlatinum({ items, onOpen }: { items: NearPlatinumItem[]; onOpen: (g: NearPlatinumItem['game']) => void }) {
  return (
    <section className="ps-block ps-nearblock" id="near-platinum" aria-labelledby="h-near">
      <div className="ps-block__head">
        <PlatinumIcon size={16} className="ps-nearblock__ico" />
        <h2 className="ps-h2" id="h-near">Ближе всего к платине</h2>
        <span className="ps-block__cnt ps-num">{items.length}</span>
        {anyApproximate(items) && (
          <span className="ps-block__act ps-nearblock__hint" title={APPROX_HINT}><Icon name="info" size={12} />Приблизительно</span>
        )}
      </div>
      <ul className="ps-near__list">{items.map((i) => <Item key={i.game.id} item={i} onOpen={onOpen} />)}</ul>
    </section>
  );
}

export function NearPlatinumSkeleton() {
  return (
    <section className="ps-block ps-nearblock" aria-hidden="true">
      <div className="ps-block__head"><div className="ps-skeleton ps-sk-year" /></div>
      <ul className="ps-near__list">{Array.from({ length: 5 }, (_, i) => <li key={i}><div className="ps-skeleton ps-near__sk" /></li>)}</ul>
    </section>
  );
}
