import type { ReactNode } from 'react';
import { MonthChipsSkeleton } from './collection/MonthChips';
import { BacklogSubnav } from './shell/Subnav';

// Скелеты страниц (docs/design-system.md §8.4). Размеры по таблице; реальные контейнеры получают те же размеры через токены,
// поэтому подмена не сдвигает вёрстку (CLS <= 0.05). Статичная обвязка (подвкладки, h1) рендерится сразу.
// Reduced-motion: shimmer выключен в decor.css (.ps-skeleton).

/** Ширины чипов статусов у реального FilterBar (Все, Играю, Пройдено, Бэклог, Брошено, Отложено, Сервис, Не разобрано). */
const CHIP_W = [73, 107, 131, 109, 124, 131, 113, 158] as const;

const sk = (cls: string) => <span className={`ps-skeleton ${cls}`} />;

/** Корень скелета страницы: aria-busy и одна скрытая подпись «Загрузка…». Содержимое скрыто от скринридера. */
export function SkRoot({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={className} aria-busy="true">
      <p role="status" className="ps-sr">Загрузка…</p>
      <div aria-hidden="true" className="ps-sk-wrap">{children}</div>
    </div>
  );
}

/** Скелет hero «Играю»: 100% x --hero-box-h. */
export function HeroSkeleton() {
  return <div className="ps-skeleton ps-sk-hero2" aria-hidden="true" />;
}

/** Сетка скелет-карточек: обложка 3/4 + --sk-title-block. Рендерится максимум, лишние скрыты media-запросами по колонкам (12/10/8/6, плотно 20/16/12/6). */
export function CardGridSkeleton({ density = 'comfort' }: { density?: 'comfort' | 'dense' }) {
  return (
    <ul className="ps-grid ps-sk-grid" data-density={density} aria-hidden="true">
      {Array.from({ length: density === 'dense' ? 20 : 12 }, (_, i) => (
        <li key={i}>
          <div className="ps-skeleton ps-sk-cover" />
          {density === 'comfort' && <div className="ps-sk-title"><span className="ps-skeleton" /><span className="ps-skeleton" /></div>}
        </li>
      ))}
    </ul>
  );
}

/** Список скелет-строк (режим «Список»). */
export function RowsSkeleton({ n = 10 }: { n?: number }) {
  return <div className="ps-row-table" aria-hidden="true">{Array.from({ length: n }, (_, i) => <div key={i} className="ps-skeleton ps-sk-row" />)}</div>;
}

/** Строка «Перейти: годы и блоки» (по реальной разметке .ps-anchors). */
export function AnchorsSkeleton() {
  return <div className="ps-anchors ps-sk-anchors" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <span key={i} className="ps-skeleton" />)}</div>;
}

/** Хроника: заголовок года 140x32 + линия, полоса месяцев, сетка. Без hero (он на своём месте в странице). */
export function CollectionResultsSkeleton({ list = false }: { list?: boolean }) {
  return (
    <div className="ps-sk-results" aria-hidden="true">
      <div className="ps-sk-yearrow">{sk('ps-sk-year2')}</div>
      <MonthChipsSkeleton />
      {list ? <RowsSkeleton /> : <CardGridSkeleton />}
    </div>
  );
}

/** Коллекция целиком (Suspense и loading.tsx): StatLine, профиль, фильтры, hero, год, чипы месяцев, сетка. */
/** hero: false, когда по подсказке игр «Играю» нет (скелет hero не рисуем). */
export function CollectionPageSkeleton({ hero = true }: { hero?: boolean } = {}) {
  return (
    <SkRoot className="ps-collection">
      <div className="ps-pagehead ps-pagehead--coll">
        <div className="ps-pagehead__main">
          <h1 className="ps-h1 ps-h1--coll">Коллекция</h1>
          <span className="ps-skeleton ps-statline__sk" />
        </div>
        <div className="ps-skeleton ps-sk-profile" />
      </div>
      {hero && <HeroSkeleton />}
      <FilterBarSkeleton />
      <AnchorsSkeleton />
      <CollectionResultsSkeleton />
    </SkRoot>
  );
}

/** Мобильный поиск коллекции (виден только на мобильном, CSS). */
export function MobileSearchSkeleton() {
  return (
    <div className="ps-filters ps-filters--search ps-sk-m">
      <div className="ps-filters__srow"><span className="ps-skeleton ps-sk-msearch" /><span className="ps-skeleton ps-sk-fbtn" /></div>
    </div>
  );
}

/** Фильтры коллекции: десктопная строка и мобильные чипы, нужная видна по media-запросу (CSS). */
export function FilterBarSkeleton() {
  return (
    <>
      {/* десктоп: те же flex-блоки и ширины, что у FilterBar, поэтому перенос строк совпадает */}
      <div className="ps-filters ps-sk-d">
        <div className="ps-filters__row">
          <span className="ps-skeleton ps-sk-search" />
          <div className="ps-tabs">
            <div className="ps-tabs__grp">{CHIP_W.map((w, i) => <span key={i} className="ps-skeleton ps-sk-chip" style={{ width: w }} />)}</div>
            <span className="ps-tabs__sep" aria-hidden="true" />
            <span className="ps-skeleton ps-sk-chip" style={{ width: 118 }} />
          </div>
          <span className="ps-skeleton ps-sk-plat" />
          <span className="ps-skeleton ps-sk-sort" />
          <span className="ps-skeleton ps-sk-view" />
          <span className="ps-skeleton ps-sk-select" />
          <span className="ps-skeleton ps-sk-menu" />
        </div>
      </div>
      <div className="ps-filters ps-filters--chips ps-sk-m">
        <span className="ps-skeleton ps-sk-fbtn" />
        <div className="ps-tabs">{Array.from({ length: 7 }, (_, i) => <span key={i} className="ps-skeleton ps-sk-chip" style={{ width: 56 }} />)}</div>
      </div>
    </>
  );
}

/** Бэклог: StatLine 120x20, фильтры, сетка карточек. */
export function BacklogPageSkeleton({ subnav = true }: { /** false, когда подвкладки уже выведены страницей вне Suspense */ subnav?: boolean } = {}) {
  return (
    <>
      {subnav && <BacklogSubnav />}
      <SkRoot className="ps-collection">
        <div className="ps-pagehead ps-bl-pagehead"><h1 className="ps-h1 ps-h1--hdr">Бэклог</h1><span className="ps-skeleton ps-sk-stat120" /><div className="ps-bl-pagehead__tools"><span className="ps-skeleton ps-sk-bltool" /></div></div>
        <div className="ps-skeleton ps-sk-blfilters" />
        {/* место заголовка блока: BacklogView рисует его сразу, без него список прыгает при смене скелета */}
        <div className="ps-h2 ps-h2--icon ps-bl-h" aria-hidden="true">&nbsp;</div>
        <CardGridSkeleton />
      </SkRoot>
    </>
  );
}

/** План: настройки 100%x96, таймлайн около 244, очередь (заголовок + 5 строк). */
export function RoadmapPageSkeleton({ subnav = true }: { /** false, когда подвкладки уже выведены страницей вне Suspense */ subnav?: boolean } = {}) {
  return (
    <>
      {subnav && <BacklogSubnav />}
      <SkRoot className="ps-rm-page">
        <div className="ps-pagehead"><h1 className="ps-h1">План</h1></div>
        <div className="ps-rm">
          <div className="ps-rm-panel" data-area="set"><div className="ps-skeleton ps-rm-sk-set" /></div>
          <div className="ps-rm-panel" data-area="tl"><div className="ps-skeleton ps-rm-sk-tl" /></div>
          <div className="ps-rm-panel" data-area="queue">
            <div className="ps-skeleton ps-sk-qhead" />
            {Array.from({ length: 5 }, (_, i) => <div key={i} className="ps-skeleton ps-sk-qrow" />)}
          </div>
        </div>
      </SkRoot>
    </>
  );
}

/** Подскажи: сегмент режимов 220, сегмент времени 280, 6 карточек. */
export function RecommendPageSkeleton({ subnav = true }: { /** false, когда подвкладки уже выведены страницей вне Suspense */ subnav?: boolean } = {}) {
  return (
    <>
      {subnav && <BacklogSubnav />}
      <SkRoot className="ps-rec-page">
        <div className="ps-pagehead ps-rec-head"><h1 className="ps-h1">Подскажи</h1></div>
        <span className="ps-skeleton ps-sk-seg220" />
        <span className="ps-skeleton ps-sk-seg280" />
        <div className="ps-sk-reccards">{Array.from({ length: 6 }, (_, i) => <div key={i} className="ps-skeleton ps-sk-reccard" />)}</div>
      </SkRoot>
    </>
  );
}

/** Данные Статистики: заголовок периода (KPI-плиток в реальной странице нет, это строка счётчиков), часы и жанры, топ игр, трофеи, «Игры месяца». */
export function StatsDataSkeleton() {
  return (
    <div className="ps-st ps-sk-st" aria-busy="true" aria-hidden="true">
      <span className="ps-skeleton ps-sk-year2" />
      <div className="ps-st-grid">
        <div className="ps-st-panel ps-st-panel--hours"><div className="ps-skeleton ps-sk-ptitle" /><div className="ps-skeleton ps-sk-chart" /></div>
        <div className="ps-st-panel ps-st-panel--genres"><div className="ps-skeleton ps-sk-ptitle" />{Array.from({ length: 8 }, (_, i) => <div key={i} className="ps-skeleton ps-sk-grow" />)}</div>
      </div>
      <div className="ps-st-panel"><div className="ps-skeleton ps-sk-ptitle" />{Array.from({ length: 10 }, (_, i) => <div key={i} className="ps-skeleton ps-sk-toprow" />)}</div>
      <div className="ps-st-panel ps-st-panel--wide"><div className="ps-skeleton ps-sk-ptitle" /><div className="ps-skeleton ps-sk-troph" /><div className="ps-skeleton ps-sk-chart" /></div>
      <PlayedSkeleton />
    </div>
  );
}

/** «Игры месяца»: полоса чипов, строка месяца 140x20, 2 ряда dense-карточек. */
export function PlayedSkeleton() {
  return (
    <div className="ps-sk-played">
      <MonthChipsSkeleton />
      <span className="ps-skeleton ps-sk-monthrow" />
      <CardGridSkeleton density="dense" />
    </div>
  );
}

/** Статистика целиком: h1, кнопка Итоги, переключатель периода 240, данные. */
export function StatsPageSkeleton() {
  return (
    <SkRoot className="ps-stats-page">
      <div className="ps-pagehead ps-st-pagehead"><h1 className="ps-h1">Статистика</h1></div>
      <span className="ps-skeleton ps-sk-switch" />
      <StatsDataSkeleton />
    </SkRoot>
  );
}

/** Итоги: ссылка «Статистика», 3 карточки лет, кнопка. */
export function WrappedPageSkeleton() {
  return (
    <SkRoot className="ps-wrapped-page">
      <span className="ps-skeleton ps-sk-back" />
      <div className="ps-pagehead"><h1 className="ps-h1">Итоги</h1></div>
      <div className="ps-wrapped-years">{Array.from({ length: 3 }, (_, i) => <span key={i} className="ps-skeleton ps-wrapped-year" />)}</div>
      <span className="ps-skeleton ps-sk-btn200" />
    </SkRoot>
  );
}

/** Разбор: обложка 3:4, центр (название, 5 кнопок), очередь 220. */
export function TriagePageSkeleton() {
  return (
    <SkRoot className="ps-tri">
      <div className="ps-tri__grid ps-sk-tri">
        <span className="ps-skeleton ps-sk-tricover" />
        <div className="ps-sk-tricenter"><span className="ps-skeleton ps-sk-trititle" /><span className="ps-skeleton ps-sk-triacts" /></div>
        <span className="ps-skeleton ps-sk-triqueue" />
      </div>
    </SkRoot>
  );
}
