'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import type { GameStatusValue } from '@/server/collection/types';
import { EmptyState } from '../EmptyState';
import { Icon } from '../icons';
import { useIsMobile, useNow, useViewportWidth } from '../primitives/hooks';
import { ProfileCard, ProfileRow, ProfileRowSkeleton, ProfileSkeleton } from '../profile/ProfileCard';
import { AnchorsSkeleton, CollectionResultsSkeleton, HeroSkeleton } from '../skeletons';
import { useSync } from '../sync/SyncProvider';
import { buttonLabel } from '../sync/status';
import type { ViewMode } from '../tokens';
import { BlockHead } from './Chronicle';
import { FilterBar, MobileChips, MobileSearch } from './FilterBar';
import { effectiveView, filtersToUrl, parseFilters, resetFilters, type Filters } from './filters';
import type { GameActions } from './GameCard';
import { GameDialog } from './GameDialog';
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
import { useStatusBackup } from './list/useStatusBackup';
import { NearPlatinum, NearPlatinumSkeleton } from './NearPlatinum';
import { PlayingHero } from './PlayingHero';
import { ResetAllDialog } from './ResetAllDialog';
import { RestoreBackupDialog } from './RestoreBackupDialog';
import { StatLine } from './StatLine';
import { storeView, useStoredView } from './view';
import { useTourCardAnchors } from '../tour/anchors';
import { InboxStrip } from '../inbox/InboxStrip';
import { useInbox } from '../inbox/useInbox';

export function CollectionView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const stored = useStoredView();
  const view: ViewMode = effectiveView(filters, stored);
  const filtersKey = filtersToUrl({ ...filters, view: null }).toString();
  const now = useNow();
  const sync = useSync();
  const width = useViewportWidth();
  const isMobile = useIsMobile();

  const rootRef = useRef<HTMLDivElement>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useTourCardAnchors(rootRef, selectMode);
  const data = useCollectionData(filters, filtersKey, () => setSelected(new Set()));
  const { summary, summaryFailed, pool, loading, error, filtersRef, poolRef, loadAll, loadMore, refresh } = data;
  // raw = всё загруженное с сервера (для подгрузки и счётчиков «осталось»)
  const raw = useMemo(() => pool?.items ?? [], [pool]);

  const game = useOpenGame(raw);
  const { setOpen, setLinked, link, openId, ctx, openGame, openGameCard } = game;
  const m = useGameMutations({
    poolRef, setPool: data.setPool, setOpen, refresh, selected, setSelected, setSelectMode, linkIdRef: game.linkIdRef, closeLinkRef: game.closeLinkRef,
  });
  const { setStatus, setHidden, setDate, bulk, bulkHidden, replaceGames } = m;
  const { backup, resetOpen, setResetOpen, restoreOpen, setRestoreOpen, restoreFromMenu, resetAll } = useStatusBackup(refresh);

  // ---------- URL ----------
  const setFilters = useCallback((p: Partial<Filters>) => {
    // база: последнее запрошенное состояние, а не фильтры текущего рендера: два вызова в один кадр не теряются
    const next = { ...filtersRef.current, ...p };
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
  const withStatus = summary ? summary.counts.all - summary.counts.none : null;
  // только чистая хроника: без поиска, статуса и платины (спека A.1)
  const inbox = useInbox(chronicleMode && filters.status === 'all' && !filters.q.trim() && !filters.platinum);
  // пока полоса показывает чип «Проверить статусы», старый check-chip не рендерим (спека A.2)
  const rawCheckCount = useCheckCount() ?? 0;
  const checkCount = inbox.showsCheck ? 0 : rawCheckCount;
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

  const barProps = {
    filters, view, counts: pool ? counts : null, platinumCount: summary ? summary.totals.platinumEarned : null, onChange: setFilters, onView: setView,
    onReset: () => setFilters(resetFilters(filters)), selectMode, onSelect: () => (selectMode ? exitSelect() : setSelectMode(true)),
    canSelect: shownGames.length > 0, onHidden: (v: boolean) => { exitSelect(); setFilters({ hidden: v, status: 'all' }); }, onResetAll: () => setResetOpen(true),
    backup, onRestoreBackup: () => setRestoreOpen(true),
  };

  return (
    <div ref={rootRef} className="ps-collection" data-tour-page="collection" data-tour-ready={String(!!pool || !!error || !loading)}>
      <div className="ps-pagehead ps-pagehead--coll">
        <div className="ps-pagehead__main">
          <h1 id="coll-title" className="ps-h1 ps-h1--coll" tabIndex={-1}>Коллекция</h1>
          <StatLine totals={summary?.totals ?? null} loading={!summary && !pool} />
          {checkCount > 0 && !unsortedShown && <p className="ps-pagehead__check"><CheckChip n={checkCount} /></p>}
        </div>
        {!summary
          ? (!pool ? (isMobile ? <ProfileRowSkeleton /> : <ProfileSkeleton />) : null)
          : isMobile ? <ProfileRow profile={summary.profile ?? null} /> : <ProfileCard profile={summary.profile ?? null} />}
      </div>

      {isMobile && <MobileSearch {...barProps} />}

      <InboxStrip ctl={inbox} />

      {chronicleMode && blocks.includes('playing') && (pool ? <PlayingHero games={playing} count={shownCount(counts.playing, playing)} now={now} actions={actions} /> : !error && <HeroSkeleton />)}

      {isMobile ? <MobileChips {...barProps} /> : <FilterBar {...barProps} />}

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
            {nearShown && (summary ? <NearPlatinum items={near} onOpen={openGameCard} /> : !summaryFailed && <NearPlatinumSkeleton />)}
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
              </Fragment>
            ))}
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

      <GameDialog
        game={openGame} stub={openId !== null && !openGame ? { id: openId, title: '', coverUrl: null } : null}
        initialTab={link.tab === 'trophies' ? 'trophies' : undefined} onNotFound={link.notFound} onLoaded={setLinked}
        startEditing={ctx?.edit ?? false} now={now} onClose={() => { setOpen(null); link.close(); }}
        onStatus={(g, s) => void setStatus(g, s)} onDate={(g, k, iso) => void setDate(g, k, iso)}
        onHidden={(g, h) => void setHidden(g, h)} onGameChanged={(g) => replaceGames([g])}
        onNotDuplicate={(g) => { replaceGames([g]); refresh(); }}
      />

      <RestoreBackupDialog open={restoreOpen} backup={backup} onClose={() => setRestoreOpen(false)} onConfirm={restoreFromMenu} />
      <ResetAllDialog open={resetOpen} count={withStatus} onClose={() => setResetOpen(false)} onConfirm={resetAll} />
    </div>
  );
}
