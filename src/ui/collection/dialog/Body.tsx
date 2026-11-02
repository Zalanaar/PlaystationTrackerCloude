'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { GameItem } from '@/server/collection/types';
import { cssUrl } from '../../format';
import { Icon, PlatinumIcon } from '../../icons';
import { StatusChip, StatusMenu } from '../../status';
import { Cover } from '../Cover';
import { artMode, DETAIL_TABS, detailSubtitle, detailTiles, nextTab, type DetailTab } from '../details';
import { platinumEarnedAt } from '../trophies';
import { linkedVersionsOf } from '../linked';
import { useGameDetails } from '../useGameDetails';
import { Art } from './Art';
import { Overview } from './Overview';
import { TileGrid } from './TileGrid';
import { TrophiesTab } from './TrophiesTab';
import type { DialogHandlers, GameStub } from './types';

export function Body({
  id, titleId, game: gameProp, stub, startEditing, now, onClose, onStatus, onDate, onHidden, onLoaded, onGameChanged, onNotDuplicate, initialTab, onNotFound,
}: {
  initialTab?: DetailTab; onNotFound?: () => void;
  id: number; titleId: string; game: GameItem | null; stub: GameStub | null; startEditing: boolean; now: number;
  onClose: () => void;
  onLoaded?: (g: GameItem) => void;
} & DialogHandlers) {
  // перечитываем детали при смене статуса или даты (statusChangedAt)
  const refreshKey = `${gameProp?.status ?? ''}|${gameProp?.completedAt ?? ''}|${gameProp?.droppedAt ?? ''}|${linkedVersionsOf(gameProp).map((v) => v.gameId).join(',')}`;
  const { state, retry } = useGameDetails(id, refreshKey);
  const details = state.kind === 'ok' ? state.data : null;
  const game = gameProp ?? details?.game ?? null;
  const [tab, setTab] = useState<DetailTab>(initialTab ?? 'overview');
  const [bannerFailed, setBannerFailed] = useState<string | null>(null);
  const tabId = useId();
  const loadedCb = useRef(onLoaded);
  useEffect(() => { loadedCb.current = onLoaded; }, [onLoaded]);
  useEffect(() => {
    if (!gameProp && details) loadedCb.current?.(details.game);
  }, [gameProp, details]);
  const missing = state.kind === 'error' && state.notFound && !game;
  const notFoundCb = useRef(onNotFound);
  useEffect(() => { notFoundCb.current = onNotFound; }, [onNotFound]);
  useEffect(() => {
    if (missing) notFoundCb.current?.();
  }, [missing]);

  if (missing && onNotFound) return null;
  if (state.kind === 'error' && !state.notFound && !game) {
    return (
      <div className="ps-gd__col">
        <div className="ps-gd__missing" role="alert">
          <Icon name="circle-alert" size={40} />
          <h2 id={titleId} className="ps-h2">Не удалось загрузить игру</h2>
          <p>Проверь соединение и попробуй ещё раз.</p>
          <div className="ps-gd__missing-act">
            <button type="button" className="ps-btn ps-btn--primary" onClick={retry}>Повторить</button>
            <button type="button" className="ps-btn" onClick={onClose}>Закрыть</button>
          </div>
        </div>
      </div>
    );
  }
  if (missing) {
    return (
      <div className="ps-gd__col">
        <div className="ps-gd__missing">
          <h2 id={titleId} className="ps-h2">Игра не найдена</h2>
          <p>Возможно, её уже убрали из базы. Обнови страницу.</p>
          <button type="button" className="ps-btn ps-btn--primary" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    );
  }

  const title = game?.title ?? stub?.title ?? '';
  const tiles = game ? detailTiles(game, now, details ? platinumEarnedAt(details.trophyList) : null) : null;
  const plat = game?.trophies?.platinumEarned === true;
  const t = game?.trophies;
  const coverUrl = game?.coverUrl ?? stub?.coverUrl ?? null;
  const hasCover = !!cssUrl(coverUrl);
  const bannerOk = !!game?.bannerUrl && !!cssUrl(game.bannerUrl) && bannerFailed !== game.bannerUrl;
  const mode = artMode(bannerOk, hasCover);

  function onTabKey(e: KeyboardEvent) {
    const n = nextTab(tab, e.key);
    if (!n) return;
    e.preventDefault();
    setTab(n);
    document.getElementById(`${tabId}-${n}`)?.focus();
  }

  return (
    <div className="ps-gd__col">
      <div className="ps-gd__closewrap">
        <button type="button" className="ps-gd__close" onClick={onClose} aria-label="Закрыть">
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="ps-gd__hero" data-art={mode} aria-busy={!game || undefined}>
        <div className="ps-gd__stage">
          <Art
            mode={mode} bannerUrl={game?.bannerUrl ?? null} coverUrl={hasCover ? coverUrl : null} loading={!game}
            onBannerError={() => setBannerFailed(game?.bannerUrl ?? null)}
          />
          <Cover url={coverUrl} title={title} className="ps-gd__cover" />
          <div className="ps-gd__tt">
            <div className="ps-gd__titlerow">
              <h2 id={titleId} className="ps-gd__title">
                {title || <><span className="ps-sr">Загрузка игры</span><span className="ps-skeleton ps-gd__sk-title" aria-hidden="true" /></>}
              </h2>
              {plat && <PlatinumIcon size={24} className="ps-gd__plat" title="Платина получена" />}
            </div>
            {game ? (
              <p className="ps-gd__sub" title={detailSubtitle(game)}>{detailSubtitle(game)}</p>
            ) : (
              <div className="ps-skeleton ps-gd__sk-sub" aria-hidden="true" />
            )}
          </div>
        </div>
        <div className="ps-gd__chips">
          {game && (
            <>
              <StatusMenu value={game.status} onPick={(s) => onStatus(game, s)} label="Изменить статус" triggerClassName="ps-gd__status">
                <StatusChip status={game.status} /><Icon name="chevron-down" size={14} />
              </StatusMenu>
              {game.hiddenAt && <span className="ps-gd__hiddenmark"><Icon name="eye-off" size={14} />Убрана из коллекции</span>}
            </>
          )}
        </div>
      </div>

      {tiles ? <TileGrid tiles={tiles} /> : <div className="ps-gd__tiles" aria-hidden="true">{[0, 1, 2, 3].map((i) => <div key={i} className="ps-skeleton ps-gd__sk-tile" />)}</div>}

      <div className="ps-tabs2" role="tablist" aria-label="Разделы игры" onKeyDown={onTabKey}>
        {DETAIL_TABS.map((x) => (
          <button
            key={x.id} id={`${tabId}-${x.id}`} type="button" role="tab" className="ps-tab2" aria-selected={tab === x.id} aria-controls={`${tabId}-p-${x.id}`}
            tabIndex={tab === x.id ? 0 : -1} onClick={() => setTab(x.id)}
          >
            {x.label}
            {x.id === 'trophies' && t && t.defined > 0 && <span className="ps-tab2__n num">{t.earned}/{t.defined}</span>}
          </button>
        ))}
      </div>

      <div id={`${tabId}-p-${tab}`} role="tabpanel" aria-labelledby={`${tabId}-${tab}`} className="ps-gd__panel" data-tab={tab} tabIndex={0}>
        {tab === 'overview'
          ? game && <Overview game={game} details={details} loading={state.kind === 'loading'} startEditing={startEditing} now={now} onStatus={onStatus} onDate={onDate} onHidden={onHidden} onGameChanged={onGameChanged} onNotDuplicate={onNotDuplicate} />
          : <TrophiesTab state={state} onRetry={retry} />}
      </div>
    </div>
  );
}
