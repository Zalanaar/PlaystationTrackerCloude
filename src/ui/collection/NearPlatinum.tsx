'use client';

import type { NearPlatinumItem } from '@/server/collection/types';
import { Icon, PlatinumIcon } from '../icons';
import { Cover } from './Cover';
import { storeNearOpen, useNearOpen } from './nearOpen';
import { APPROX_HINT, anyApproximate, avgRarityText, dlcLine, isApproximate, nearAria, remainingGrades } from './nearPlatinum';

function Item({ item, onOpen }: { item: NearPlatinumItem; onOpen: (g: NearPlatinumItem['game']) => void }) {
  const { game, forecast: f } = item;
  const approx = isApproximate(f);
  const dlc = dlcLine(f);
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
          {dlc && <span className="ps-near__dlc">{dlc}</span>}
        </span>
      </button>
    </li>
  );
}

/** Кнопка «Показать / Свернуть» в шапке блока (только мобильный). */
function NearToggle({ open }: { open: boolean }) {
  return (
    <button type="button" className="ps-link ps-block__act ps-nearblock__tgl" aria-expanded={open} aria-controls="near-list" data-testid="near-toggle" onClick={() => storeNearOpen(!open)}>
      {open ? 'Свернуть' : 'Показать'}
    </button>
  );
}

/**
 * «Ближе всего к платине» (п.8.2): до 5 игр по прогнозу платины. Сетка на десктопе, горизонтальный трек на мобильном.
 * collapsible (мобильный): по умолчанию свёрнут до шапки, чтобы первый экран занимали игры; выбор запоминается.
 */
export function NearPlatinum({ items, onOpen, collapsible = false }: { items: NearPlatinumItem[]; onOpen: (g: NearPlatinumItem['game']) => void; collapsible?: boolean }) {
  const stored = useNearOpen();
  const open = !collapsible || stored;
  return (
    <section className="ps-block ps-nearblock" id="near-platinum" aria-labelledby="h-near">
      <div className="ps-block__head">
        <PlatinumIcon size={16} className="ps-nearblock__ico" />
        <h2 className="ps-h2" id="h-near">Ближе всего к платине</h2>
        <span className="ps-block__cnt ps-num">{items.length}</span>
        {open && anyApproximate(items) && (
          <span className="ps-block__act ps-nearblock__hint" title={APPROX_HINT}><Icon name="info" size={12} />Приблизительно</span>
        )}
        {collapsible && <NearToggle open={open} />}
      </div>
      {open && <ul className="ps-near__list" id="near-list">{items.map((i) => <Item key={i.game.id} item={i} onOpen={onOpen} />)}</ul>}
    </section>
  );
}

/** collapsible: как у блока, свёрнутый скелет без списка (иначе сдвиг при загрузке сводки). */
export function NearPlatinumSkeleton({ collapsible = false }: { collapsible?: boolean }) {
  const stored = useNearOpen();
  const open = !collapsible || stored;
  return (
    <section className="ps-block ps-nearblock" aria-hidden="true">
      <div className="ps-block__head"><div className="ps-skeleton ps-sk-year" /></div>
      {open && <ul className="ps-near__list">{Array.from({ length: 5 }, (_, i) => <li key={i}><div className="ps-skeleton ps-near__sk" /></li>)}</ul>}
    </section>
  );
}
