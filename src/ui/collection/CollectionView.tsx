'use client';

import { useEverTrue } from '../useEverTrue';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollectionInitial, GameStatusValue } from '@/server/collection/types';
import { EmptyState } from '../EmptyState';
import { Icon } from '../icons';
import { useIsMobileOrUnknown, useNow, useViewportWidth } from '../primitives/hooks';
import { ProfileCard, ProfileRow, ProfileRowSkeleton, ProfileSkeleton } from '../profile/ProfileCard';
import { useFocusRescue } from '../primitives/useFocusRescue';
import { LoaderOverlay } from '../loader/LoaderOverlay';
import { AnchorsSkeleton, CollectionResultsSkeleton, FilterBarSkeleton, HeroSkeleton, MobileSearchSkeleton } from '../skeletons';
import { useSync } from '../sync/SyncProvider';
import { buttonLabel } from '../sync/status';
import type { ViewMode } from '../tokens';
import { BlockHead } from './Chronicle';
import { FilterBar, MobileChips, MobileSearch } from './FilterBar';
import { platinumChipCount } from './platinumCount';
import { effectiveView, filtersToUrl, otherBlockFilters, parseFilters, resetFilters, type Filters } from './filters';
import type { GameActions } from './GameCard';
import { BLOCK_TITLES, BULK_MAX, PAGE, scrollToId } from './list/pool';
import type { RenderCtx } from './list/renderCtx';
import { CheckChip, renderBlock } from './list/renderBlocks';
import { useCheckCount } from '../triage/useCheckCount';
import { moreBtn, renderGames } from './list/renderGames';
import { renderPlayed } from './list/renderChronicle';
import { SelectBar } from './list/SelectBar';
import { SyncProgress } from './list/SyncProgress';
import { useCollectionData } from './list/useCollectionData';
import { useCollectionLists } from './list/useCollectionLists';
import { useGameMutations } from './list/useGameMutations';
import { useOpenGame } from './list/useOpenGame';
import { usePageArt } from './list/usePageArt';
import { STATUSES_CHANGED_EVENT } from '../backup/StatusMenu';
import { NearPlatinum, NearPlatinumSkeleton } from './NearPlatinum';
import { PlayingHero } from './PlayingHero';
import { StatLine } from './StatLine';
import { storeView, useStoredView } from './view';
import { useTourCardAnchors } from '../tour/anchors';
import { InboxStrip } from '../inbox/InboxStrip';
import { useInbox } from '../inbox/useInbox';
import { mskDay } from '../inbox/model';
import { expectHero, heroHintCookie } from '@/shared/hero-hint';
import { formatLayoutHint, layoutHintCookie, type LayoutHint } from '@/shared/layout-hint';
import { useNearOpen } from './nearOpen';
import { useHeaderAction } from '../shell/headerActions';
import { platformCookie, type PlatformKey } from '@/shared/platform-filter';
import { useToast } from '../primitives/Toast';
import type { OtherPlatformGame } from '../other-platforms/api';
import { emitOtherAdded } from '../other-platforms/events';
import { addedToastText } from '../other-platforms/model';

// Диалоги — отдельными чанками (Фаза 47). Пакет 6: окно игры монтируется только после первого открытия, а чанк качается
// по намерению (первое касание/наведение/фокус внутри коллекции), а не сразу после гидрации: -~70 КБ JS на старте `/`.
const loadGameDialog = () => import('./GameDialog');
const GameDialog = dynamic(() => loadGameDialog().then((m) => m.GameDialog), { ssr: false });
let gameDialogWarm = false;
const warmGameDialog = () => {
  if (gameDialogWarm) return;
  gameDialogWarm = true;
  void loadGameDialog().catch(() => { gameDialogWarm = false; });
};
// Пакет 5: блок «Игры с других платформ» в самом низу хроники, своим чанком
const OtherPlatformsBlock = dynamic(() => import('../other-platforms/OtherPlatformsBlock').then((m) => m.OtherPlatformsBlock), { ssr: false });
// t160u: панель добавления открывается и без блока (шапка «+», меню «…»), поэтому живёт здесь; грузится по первому открытию
const AddOtherPlatformSheet = dynamic(() => import('../other-platforms/AddOtherPlatformSheet').then((m) => m.AddOtherPlatformSheet), { ssr: false });

/**
 * heroHint: подсказка из cookie, есть ли игры «Играю» (иначе скелет hero не рисуется, CLS).
 * initial (item 4): сводка и блоки хроники из серверного рендера — первый экран сразу в HTML. layout: подсказка раскладки для того же рендера.
 * platformDefault (F4): запомненная платформа из cookie; параметр URL главнее.
 */
export function CollectionView({ heroHint, initial, layout, platformDefault = null }: {
  heroHint?: boolean; initial?: CollectionInitial | null; layout?: LayoutHint; platformDefault?: PlatformKey | null;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // F4: запомненная платформа живёт и на клиенте: после «Все» cookie стёрт, а серверный prop ещё старый
  const [platDefault, setPlatDefault] = useState<PlatformKey | null>(platformDefault);
  const filters = useMemo(() => parseFilters(params, platDefault), [params, platDefault]);
  // D-P1: на телефоне поле поиска открывает кнопка шапки, строка видна, пока открыта или есть запрос
  const [searchOpen, setSearchOpen] = useState(false);
  useHeaderAction('search', () => setSearchOpen(true));
  const [addOther, setAddOther] = useState(false);
  const openAddOther = useCallback(() => setAddOther(true), []);
  useHeaderAction('add-other', openAddOther);
  const toast = useToast();
  const stored = useStoredView(layout?.view ?? null);
  const view: ViewMode = effectiveView(filters, stored);
  const filtersKey = filtersToUrl({ ...filters, view: null }).toString();
  const now = useNow(60_000, initial?.now ?? 0);
  const sync = useSync();
  const width = useViewportWidth(layout?.width);
  const nearOpen = useNearOpen(layout?.near);
  // null на сервере и при гидрации: там рисуем адаптивные скелеты, а не десктопную вёрстку (на телефоне она сдвигала страницу)
  const mobileMq = useIsMobileOrUnknown();
  const isMobile = mobileMq === true;

  const rootRef = useRef<HTMLDivElement>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useTourCardAnchors(rootRef, selectMode);
  useFocusRescue(rootRef);
  const data = useCollectionData(filters, filtersKey, () => setSelected(new Set()), initial);
  const { summary, summaryFailed, pool, loading, error, filtersRef, poolRef, loadAll, loadMore, refresh } = data;
  // raw = всё загруженное с сервера (для подгрузки и счётчиков «осталось»)
  const raw = useMemo(() => pool?.items ?? [], [pool]);

  const game = useOpenGame(raw, initial?.linkGame ?? null);
  const { setOpen, setLinked, link, openId, ctx, openGame, openGameCard } = game;
  const dialogEver = useEverTrue(openId !== null || openGame !== null);
  const m = useGameMutations({
    poolRef, setPool: data.setPool, setOpen, refresh, selected, setSelected, setSelectMode, linkIdRef: game.linkIdRef, closeLinkRef: game.closeLinkRef,
  });
  const { setStatus, setHidden, setDate, bulk, bulkHidden, replaceGames } = m;
  // сброс и откат статусов теперь в меню профиля (Фаза 48, п. 12): шапка сообщает событием, коллекция перечитывает данные
  useEffect(() => {
    const on = () => refresh();
    window.addEventListener(STATUSES_CHANGED_EVENT, on);
    return () => window.removeEventListener(STATUSES_CHANGED_EVENT, on);
  }, [refresh]);

  // ---------- URL ----------
  const setFilters = useCallback((p: Partial<Filters>) => {
    // база: последнее запрошенное состояние, а не фильтры текущего рендера: два вызова в один кадр не теряются
    const next = { ...filtersRef.current, ...p };
    if ('platform' in p && (p.platform ?? null) !== (filtersRef.current.platform ?? null)) {
      document.cookie = platformCookie(p.platform ?? null);
      setPlatDefault(p.platform ?? null);
    }
    filtersRef.current = next;
    const qs = filtersToUrl(next).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filtersRef, pathname, router]);

  const setView = useCallback((v: ViewMode) => {
    storeView(v);
    setFilters({ view: v });
  }, [setFilters]);

  const actions: GameActions = useMemo(() => ({
    open: (g, edit = false) => { setOpen({ id: g.id, edit, snapshot: g }); link.open(g.id); },
    setStatus: (g, s: GameStatusValue | null) => void setStatus(g, s),
    toggle: (g) => setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(g.id)) n.add(g.id);
      return n;
    }),
  }), [setStatus, link.open]); // eslint-disable-line react-hooks/exhaustive-deps -- link.open стабилен

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  // ---------- производные данные ----------
  const L = useCollectionLists({ filters, pool, raw, summary, now, view, width, selectMode, error });
  const {
    chronicleMode, counts, flat, blocks, byBlock, played, playedMode, density, cols, shownCount, shownGames, failedBlocks,
    empty, hiddenView, noData, hiddenEmpty, playing, near, nearShown, years, showAnchors,
  } = L;
  const summaryPlaying = summary ? summary.counts.playing : null;
  const heroExpected = expectHero(summaryPlaying, heroHint);
  // Запоминаем для следующего серверного рендера: есть ли что показать в hero
  useEffect(() => {
    if (summaryPlaying === null || (summaryPlaying > 0) === heroHint) return;
    document.cookie = heroHintCookie(summaryPlaying > 0);
  }, [summaryPlaying, heroHint]);
  // Раскладка для следующего серверного рендера (item 4): вид, «Ближе к платине», ширина. Пишем только после гидрации и при изменении.
  // только чистая хроника: без поиска, статуса и платины (спека A.1)
  const inbox = useInbox(
    chronicleMode && filters.status === 'all' && !filters.q.trim() && !filters.platinum,
    data.seeded && initial ? { data: initial.inbox, hidden: !!layout?.day && layout.day === mskDay(initial.now) } : undefined,
  );
  // пока полоса показывает чип «Проверить статусы», старый check-chip не рендерим (спека A.2)
  const rawCheckCount = useCheckCount() ?? 0;
  const checkCount = inbox.showsCheck ? 0 : rawCheckCount;
  // Раскладка для следующего серверного рендера (item 4): вид, «Ближе к платине», ширина, «скрыто сегодня». Пишем только после гидрации и при изменении.
  const layoutSent = useRef<string | null>(layout ? formatLayoutHint({ view: layout.view ?? '', near: layout.near ?? false, width: layout.width ?? 0, day: layout.day }) : null);
  const inboxHidden = inbox.hidden;
  useEffect(() => {
    if (mobileMq === null) return;
    const v = formatLayoutHint({ view: stored ?? '', near: nearOpen, width, day: inboxHidden ? mskDay(Date.now()) : null });
    if (v === layoutSent.current) return;
    layoutSent.current = v;
    document.cookie = layoutHintCookie(v);
  }, [mobileMq, stored, nearOpen, width, inboxHidden]);
  // Пакет 5: только чистая хроника (без поиска, статуса, платины, платформы и «Скрытых»)
  const otherShown = chronicleMode && !!pool && filters.status === 'all' && !filters.q.trim() && !filters.platinum && !filters.platform && !hiddenView;
  const loadingRef = useRef(loading);
  useEffect(() => { loadingRef.current = loading; });

  function closeAddOther(added: OtherPlatformGame[]) {
    setAddOther(false);
    // окно «Фильтры» или меню, откуда открыли, уже закрыто: фокус не теряем
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) document.getElementById('coll-title')?.focus({ preventScroll: true });
    });
    if (added.length === 0) return;
    emitOtherAdded(added);
    const text = addedToastText(added.map((a) => a.title));
    if (otherShown) {
      toast({ text, kind: 'info', ttl: 6000 });
      return;
    }
    // блок скрыт фильтрами: «Показать» возвращает чистую хронику и прокручивает к нему, когда он отрисуется
    toast({
      text: `${text}. Блок «Игры с других платформ» скрыт фильтрами.`, kind: 'info', ttl: 8000,
      action: { label: 'Показать', run: () => { setFilters(otherBlockFilters(filtersRef.current)); scrollWhenShown('other-platforms', () => loadingRef.current); } },
    });
  }
  const unsortedShown = chronicleMode && blocks.includes('unsorted') && (byBlock.unsorted?.length ?? 0) > 0;
  const run = sync.status?.run;
  const syncing = !!sync.status?.running;
  usePageArt(chronicleMode ? playing[0]?.coverUrl : null, isMobile);

  const renderCtx: RenderCtx = {
    view, density, cols, filters, actions, selectMode, selected, hiddenView, setFilters, setHidden, counts, forgotten: pool?.forgotten ?? 0, checkCount,
    more: data.more, loadMore, byBlock, chron: L.chron, played, isOpen: L.isOpen, toggle: L.toggle, isPlayedOpen: L.isPlayedOpen, togglePlayed: L.togglePlayed,
    rawLoaded: L.rawLoaded, shownCount, serviceFull: L.serviceFull, serviceOpen: L.serviceOpen, setServiceOpen: L.setServiceOpen,
    serviceRows: L.serviceRows, setServiceRows: L.setServiceRows,
  };

  function jump(e: React.MouseEvent, target: string, year?: number) {
    e.preventDefault();
    if (year !== undefined) L.expandYear(year);
    setTimeout(() => scrollToId(target), 30);
  }
  function jumpPlayed(e: React.MouseEvent, key: string) {
    e.preventDefault();
    L.expandPlayed(key);
    setTimeout(() => scrollToId(key === 'never' ? 'never' : `y${key}`), 30);
  }

  // блок, после которого на телефоне идёт «Ближе к платине»: хроника, иначе последний
  const nearAfter = blocks.includes('chronicle') ? 'chronicle' : blocks[blocks.length - 1];

  const barProps = {
    filters, view, counts: pool ? counts : null, platformCounts: summary?.platformCounts ?? null, platinumCount: platinumChipCount(summary ? summary.totals.platinumEarned : null, filters, pool), empty, onChange: setFilters, onView: setView,
    onAddOther: openAddOther,
    onReset: () => setFilters(resetFilters(filters)), selectMode, onSelect: () => (selectMode ? exitSelect() : setSelectMode(true)),
    canSelect: shownGames.length > 0, onHidden: (v: boolean) => { exitSelect(); setFilters({ hidden: v, status: 'all' }); },
  };

  return (
    <>
    <LoaderOverlay loading={loading && !error} blocking={!pool} contentRef={rootRef} />
    <div
      ref={rootRef} className="ps-collection" data-tour-page="collection" data-tour-ready={String(!!pool || !!error || !loading)}
      onPointerDownCapture={warmGameDialog} onPointerOverCapture={warmGameDialog} onFocusCapture={warmGameDialog} onTouchStartCapture={warmGameDialog}
    >
      <div className="ps-pagehead ps-pagehead--coll">
        <div className="ps-pagehead__main">
          <h1 id="coll-title" className="ps-h1 ps-h1--coll" tabIndex={-1}>Коллекция</h1>
          <StatLine totals={summary?.totals ?? null} loading={!summary && !pool} />
          {checkCount > 0 && !unsortedShown && <p className="ps-pagehead__check"><CheckChip n={checkCount} /></p>}
        </div>
        {!summary
          ? (!pool ? (mobileMq === null ? <><span className="ps-only-m"><ProfileRowSkeleton /></span><span className="ps-only-d"><ProfileSkeleton /></span></> : isMobile ? <ProfileRowSkeleton /> : <ProfileSkeleton />) : null)
          : mobileMq === null
            // сводка из HTML (item 4): до гидрации обе раскладки, CSS показывает нужную
            ? <><span className="ps-only-m"><ProfileRow profile={summary.profile ?? null} totals={summary.totals} /></span><span className="ps-only-d"><ProfileCard profile={summary.profile ?? null} /></span></>
            : isMobile ? <ProfileRow profile={summary.profile ?? null} totals={summary.totals} /> : <ProfileCard profile={summary.profile ?? null} />}
      </div>

      {mobileMq === null
        ? filters.q.trim() !== '' && <MobileSearchSkeleton />
        : isMobile && (searchOpen || filters.q !== '') && <MobileSearch {...barProps} autoFocus={searchOpen && filters.q === ''} onClose={() => setSearchOpen(false)} />}

      <InboxStrip ctl={inbox} />

      {chronicleMode && blocks.includes('playing') && (pool ? <PlayingHero games={playing} count={shownCount(counts.playing, playing)} now={now} actions={actions} /> : !error && heroExpected && <HeroSkeleton />)}

      {mobileMq === null ? <FilterBarSkeleton /> : isMobile ? <MobileChips {...barProps} /> : <FilterBar {...barProps} />}

      {playedMode && played.years.length + (played.never.length > 0 ? 1 : 0) > 1 && (
        <nav className="ps-anchors" aria-label="Годы">
          <span>Перейти:</span>
          {played.years.map((y) => <a key={y.year} href={`#y${y.year}`} onClick={(e) => jumpPlayed(e, String(y.year))}>{y.year}</a>)}
          {played.never.length > 0 && <a href="#never" onClick={(e) => jumpPlayed(e, 'never')}>Не запускались</a>}
        </nav>
      )}

      {showAnchors && (
        <nav className="ps-anchors" aria-label="Годы и блоки">
          <span>Перейти:</span>
          {years.map((y) => <a key={y} href={`#y${y}`} onClick={(e) => jump(e, `y${y}`, y)}>{y}</a>)}
          {(byBlock.backlog?.length ?? 0) > 0 && <a href="#backlog" onClick={(e) => jump(e, 'backlog')}>Бэклог</a>}
          {(byBlock.service?.length ?? 0) > 0 && <a href="#service" onClick={(e) => jump(e, 'service')}>Сервисы</a>}
          {(byBlock.unsorted?.length ?? 0) > 0 && <a href="#unsorted" onClick={(e) => jump(e, 'unsorted')}>Не разобрано</a>}
        </nav>
      )}

      {!pool && loading && chronicleMode && filters.status === 'all' && <AnchorsSkeleton />}

      <section aria-labelledby="coll-title" aria-busy={loading} className="ps-results" data-loading={(loading && !!pool) || undefined}>
        {!pool && loading ? (
          <CollectionResultsSkeleton list={view === 'list'} />
        ) : error && !pool ? (
          <EmptyState icon="circle-alert" role="alert" title="Что-то пошло не так" text="Не удалось загрузить коллекцию. Сохранённые данные не потеряны.">
            <button type="button" className="ps-btn ps-btn--primary" onClick={() => void loadAll(filters, PAGE)}>Обновить</button>
          </EmptyState>
        ) : hiddenEmpty ? (
          <EmptyState icon="eye-off" title="Скрытых игр нет" text="Здесь появятся игры, которые ты убрал из коллекции. Их можно вернуть в любой момент.">
            <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setFilters({ hidden: false, status: 'all' })}>К коллекции</button>
          </EmptyState>
        ) : noData ? (
          <EmptyState icon="cloud-download" title="Пока пусто" text="Данные из PSN ещё не загружены. Запусти первый синк, он займёт несколько минут.">
            {syncing && run ? (
              <SyncProgress />
            ) : (
              <button type="button" className="ps-btn ps-btn--primary" onClick={() => void sync.start()} disabled={sync.starting || sync.loading}>
                {sync.status ? buttonLabel(sync.status, sync.starting) : 'Синк сейчас'}
              </button>
            )}
          </EmptyState>
        ) : empty ? (
          <EmptyState icon="search-x" title="Ничего не найдено" text="Попробуй изменить запрос или фильтры.">
            <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setFilters(resetFilters(filters))}>Сбросить фильтры</button>
          </EmptyState>
        ) : chronicleMode ? (
          <div className="ps-blocks">
            {nearShown && (summary
              ? (mobileMq === null
                ? <span className="ps-only-d"><NearPlatinum items={near} onOpen={openGameCard} /></span>
                : !isMobile && <NearPlatinum items={near} onOpen={openGameCard} />)
              : !summaryFailed && !isMobile && <span className={mobileMq === null ? 'ps-only-d' : undefined}><NearPlatinumSkeleton /></span>)}
            {blocks.map((b) => (
              <Fragment key={b}>
                {failedBlocks.includes(b) && (
                  <p className="ps-inline-error ps-block-error" role="alert">
                    <Icon name="circle-alert" size={18} />
                    <span>Не удалось загрузить блок «{BLOCK_TITLES[b]}».</span>
                    <button type="button" className="ps-link" onClick={() => void loadAll(filtersRef.current, 0)}>Повторить</button>
                  </p>
                )}
                {renderBlock(renderCtx, b)}
                {/* D-P1: на телефоне «Ближе к платине» после хроники, первый экран отдаётся обложкам */}
                {b === nearAfter && mobileMq !== false && nearShown && (summary
                  ? <span className={mobileMq === null ? 'ps-only-m' : undefined}><NearPlatinum items={near} onOpen={openGameCard} collapsible serverOpen={layout?.near} /></span>
                  : !summaryFailed && <span className={mobileMq === null ? 'ps-only-m' : undefined}><NearPlatinumSkeleton collapsible /></span>)}
              </Fragment>
            ))}
            {otherShown && <OtherPlatformsBlock onAdd={openAddOther} />}
          </div>
        ) : (
          <div className="ps-block">
            {hiddenView ? (
              <>
                <BlockHead title="Скрытые игры" count={pool?.total ?? 0} icon={<Icon name="eye-off" size={18} />}>
                  <button type="button" className="ps-link ps-link--plain" onClick={() => setFilters({ hidden: false, status: 'all' })}>
                    К коллекции <Icon name="arrow-right" size={14} />
                  </button>
                </BlockHead>
                <p className="ps-block__note">Эти игры не показываются в коллекции, статистике и итогах. Синк их не возвращает.</p>
              </>
            ) : (
              <BlockHead title="Результаты" count={pool?.total ?? 0} />
            )}
            {playedMode ? renderPlayed(renderCtx) : renderGames(renderCtx, flat, { dateYear: true, withHeader: true })}
            {pool && moreBtn(renderCtx, null, pool.total - raw.length)}
          </div>
        )}
        {error && pool && (
          <p className="ps-inline-error" role="status">Не удалось обновить список. Показаны последние данные. <button type="button" className="ps-link" onClick={refresh}>Повторить</button></p>
        )}
      </section>

      {selectMode && (
        <SelectBar
          count={selected.size} total={shownGames.length} onAll={() => setSelected(new Set(shownGames.slice(0, BULK_MAX).map((g) => g.id)))}
          onPick={(s) => void bulk(s)} onCancel={exitSelect} hiddenView={hiddenView}
          onHide={() => void bulkHidden([...selected], !hiddenView)}
        />
      )}

      {dialogEver && <GameDialog
        game={openGame} stub={openId !== null && !openGame ? { id: openId, title: '', coverUrl: null } : null}
        initialTab={link.tab === 'trophies' ? 'trophies' : undefined} onNotFound={link.notFound} onLoaded={setLinked}
        startEditing={ctx?.edit ?? false} now={now} onClose={() => { setOpen(null); link.close(); }}
        onStatus={(g, s) => void setStatus(g, s)} onDate={(g, k, iso) => void setDate(g, k, iso)}
        onHidden={(g, h) => void setHidden(g, h)} onGameChanged={(g) => replaceGames([g])}
        onNotDuplicate={(g) => { replaceGames([g]); refresh(); }}
      />}

      {addOther && <AddOtherPlatformSheet onClose={closeAddOther} />}
    </div>
    </>
  );
}

/**
 * Ждёт, пока хроника догрузится под новые фильтры и узел (блок своим чанком) встанет на место, затем прокручивает к нему.
 * «На месте» = список не грузится и top узла не меняется 6 кадров подряд; сдаётся через 8 с.
 */
function scrollWhenShown(id: string, busy: () => boolean) {
  const until = Date.now() + 8000;
  let last = NaN;
  let still = 0;
  const tick = () => {
    const el = document.getElementById(id);
    const top = el ? el.getBoundingClientRect().top + window.scrollY : NaN;
    still = el && !busy() && top === last ? still + 1 : 0;
    last = top;
    if (still >= 6) { scrollToId(id); return; }
    if (Date.now() < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
