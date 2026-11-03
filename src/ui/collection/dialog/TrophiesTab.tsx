'use client';

import { useId, useMemo, useState } from 'react';
import type { GameTrophyItem } from '@/server/collection/types';
import { formatDayMonth } from '../../format';
import { Icon, PlatinumIcon } from '../../icons';
import {
  filterTrophies, formatRate, HIDDEN_DETAIL, HIDDEN_TITLE, isDlcTrophy, isMaskable, isMasked, REVEAL_HINT, rarityLabel, raritySegments, sortTrophies, TROPHY_FILTERS, TROPHY_PAGE, TROPHY_SORTS,
  TROPHY_TYPE_LABELS, trophyAria, trophyCounts, trophySections, trophyTitle, visibleTrophyCount, type TrophyFilter, type TrophySort,
} from '../trophies';
import type { DetailsState } from '../useGameDetails';

export function TrophiesTab({ state, onRetry }: { state: DetailsState; onRetry: () => void }) {
  const [filter, setFilter] = useState<TrophyFilter>('all');
  const [sort, setSort] = useState<TrophySort>('game');
  const [shown, setShown] = useState(TROPHY_PAGE);
  const sortId = useId();
  const list = useMemo(() => (state.kind === 'ok' ? state.data.trophyList : []), [state]);
  const counts = useMemo(() => trophyCounts(list), [list]);
  const groups = useMemo(() => (state.kind === 'ok' ? state.data.trophyGroups ?? [] : []), [state]);
  // Пакет 5: основная игра, затем дополнения; сортировка — внутри раздела
  const rows = useMemo(() => trophySections(sortTrophies(filterTrophies(list, filter), sort), list, groups).flatMap((x) => x.items), [list, filter, sort, groups]);
  const secId = useId();
  const hasDlc = useMemo(() => list.some(isDlcTrophy), [list]);

  if (state.kind === 'loading') {
    return (
      <div aria-busy="true" aria-label="Загрузка трофеев">
        <div className="ps-gd__ctl" aria-hidden="true">
          <div className="ps-seg ps-seg--off">{TROPHY_FILTERS.map((f) => <button key={f.id} type="button" disabled>{f.label}</button>)}</div>
        </div>
        <ul className="ps-trophies" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="ps-trophy ps-trophy--sk">
              <span className="ps-skeleton ps-trophy__sk-ic" />
              <span className="ps-trophy__sk-tx"><span className="ps-skeleton" /><span className="ps-skeleton" /></span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="ps-gd__state" role="alert">
        <Icon name="circle-alert" size={40} />
        <h3 className="ps-h2">Не удалось загрузить трофеи</h3>
        <p>Остальное окно работает по данным игры.</p>
        <button type="button" className="ps-btn ps-btn--primary" onClick={onRetry}>Повторить</button>
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div className="ps-gd__state">
        <Icon name="trophy" size={40} />
        <h3 className="ps-h2">Трофеев нет</h3>
        <p>У игры нет списка трофеев или он ещё не загружен из PSN.</p>
      </div>
    );
  }

  const count = visibleTrophyCount(rows.length, shown);
  const view = rows.slice(0, count);
  const countOf = (id: TrophyFilter) => counts[id];
  return (
    <>
      <div className="ps-gd__ctl">
        <div className="ps-seg" role="group" aria-label="Фильтр трофеев">
          {TROPHY_FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setShown(TROPHY_PAGE); }}>
              {f.label} <span className="num">{countOf(f.id)}</span>
            </button>
          ))}
        </div>
        <label className="ps-select ps-gd__sort">
          <span className="ps-sr" id={sortId}>Сортировка трофеев</span>
          <select aria-labelledby={sortId} value={sort} onChange={(e) => { setSort(e.target.value as TrophySort); setShown(TROPHY_PAGE); }}>
            {TROPHY_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <Icon name="chevron-down" size={14} />
        </label>
      </div>
      {rows.length === 0 ? (
        <div className="ps-gd__state">
          <Icon name="search-x" size={40} />
          <h3 className="ps-h2">Нет трофеев по фильтру</h3>
          <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setFilter('all')}>Показать все</button>
        </div>
      ) : (
        <>
          {(() => {
            const secs = trophySections(view, list, groups);
            if (!hasDlc) return <ul className="ps-trophies">{view.map((x) => <TrophyRow key={`${x.setId}:${x.trophyId}`} t={x} />)}</ul>;
            return secs.map((sec, i) => (
              <section key={sec.key} className="ps-trophies-sec" aria-labelledby={`${secId}-${i}`} data-dlc={sec.dlc || undefined} data-testid="trophy-section">
                <h3 className="ps-trophies-sec__h" id={`${secId}-${i}`}>
                  <span className="ps-trophies-sec__t">{sec.title}</span>{' '}
                  <span className="ps-trophies-sec__n num" aria-label={`получено ${sec.earned} из ${sec.total}`}>{sec.earned}/{sec.total}</span>
                </h3>
                <ul className="ps-trophies">{sec.items.map((x) => <TrophyRow key={`${x.setId}:${x.trophyId}`} t={x} />)}</ul>
              </section>
            ));
          })()}
          {count < rows.length && (
            <div className="ps-more">
              <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setShown(count + TROPHY_PAGE)}>Показать ещё {Math.min(TROPHY_PAGE, rows.length - count)}</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function TypeIcon({ type }: { type: GameTrophyItem['type'] }) {
  return type === 'platinum'
    ? <PlatinumIcon size={16} className="ps-trophy__type" />
    : <span className="ps-trophy__type" data-type={type} title={TROPHY_TYPE_LABELS[type]}><Icon name="trophy" size={16} /></span>;
}

function RarityMeter({ rarity, rate }: { rarity: number | null; rate: number | null }) {
  const label = rarityLabel(rarity);
  if (!label) return <span className="ps-rar ps-rar--none">Редкость неизвестна</span>;
  const filled = raritySegments(rarity);
  const pct = formatRate(rate);
  return (
    <span className="ps-rar" data-r={rarity}>
      <b>{label}</b>
      {pct && <span className="ps-rar__pct num">{pct}</span>}
      <span className="ps-rar__seg" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} data-on={i < filled || undefined} />)}</span>
    </span>
  );
}

function TrophyIcon({ t, masked }: { t: GameTrophyItem; masked: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  // замаскированный: заглушка того же размера (48/44), без картинки: иконка не подсказывает трофей, сдвига нет
  if (masked || !t.iconUrl || failed === t.iconUrl) {
    return (
      <span className="ps-trophy__ic ps-trophy__ic--empty" data-locked={!t.earned || undefined} data-masked={masked || undefined} aria-hidden="true">
        {masked ? <Icon name="lock" size={20} /> : <Icon name="trophy" size={20} />}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- иконки трофеев с CDN PSN
    <img
      className="ps-trophy__ic" data-locked={!t.earned || undefined} src={t.iconUrl} alt="" loading="lazy" decoding="async"
      referrerPolicy="no-referrer" onError={() => setFailed(t.iconUrl)}
    />
  );
}

function TrophyRow({ t }: { t: GameTrophyItem }) {
  const [revealed, setRevealed] = useState(false);
  const detId = useId();
  const maskable = isMaskable(t);
  const masked = isMasked(t, revealed);
  const name = (
    <>
      <TypeIcon type={t.type} />
      <span>{masked ? HIDDEN_TITLE : trophyTitle(t)}</span>
      {isDlcTrophy(t) && <span className="ps-trophy__dlc" title="Трофей дополнения: платине не мешает">DLC</span>}
      {t.hidden && <span className="ps-trophy__hidtag" title="Скрытый трофей: PSN не показывает его до получения">Скрытый</span>}
    </>
  );
  const detText = masked ? (maskable ? REVEAL_HINT : HIDDEN_DETAIL) : (t.detail ?? '');
  return (
    <li
      className="ps-trophy" data-type={t.type} data-dlc={isDlcTrophy(t) || undefined} data-earned={t.earned || undefined} data-masked={masked || undefined}
      aria-label={trophyAria(t, masked)}
    >
      <TrophyIcon t={t} masked={masked} />
      {maskable ? (
        // касание показывает/прячет текст; кнопка — вся текстовая колонка (тап-зона >= 44), высота строки не меняется (кламп 2/3 строки)
        <button
          type="button" className="ps-trophy__tx ps-trophy__reveal" aria-expanded={!masked} aria-controls={detId} data-testid="trophy-reveal"
          aria-label={masked ? 'Показать скрытый трофей' : 'Спрятать скрытый трофей'} onClick={() => setRevealed((v) => !v)}
        >
          <span className="ps-trophy__name">{name}</span>
          <span id={detId} className="ps-trophy__det" data-muted={masked || undefined}>{detText}</span>
        </button>
      ) : (
        <div className="ps-trophy__tx">
          <p className="ps-trophy__name">{name}</p>
          <p className="ps-trophy__det" title={t.detail ?? undefined} data-muted={masked || undefined}>{detText}</p>
        </div>
      )}
      <div className="ps-trophy__meta">
        <RarityMeter rarity={t.rarity} rate={t.earnedRate} />
        <span className="ps-trophy__date" data-earned={t.earned || undefined}>
          {t.earned ? (formatDayMonth(t.earnedAt, true) ?? 'получен') : 'Не получено'}
        </span>
      </div>
    </li>
  );
}
