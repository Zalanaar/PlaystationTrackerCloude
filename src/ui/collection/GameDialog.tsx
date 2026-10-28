'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { GameDetailsResponse, GameItem, GameStatusValue, GameTrophyItem, PlatinumForecast } from '@/server/collection/types';
import { cssUrl, formatDate, formatDayMonth } from '../format';
import { Icon, PlatinumIcon, StatusGlyph } from '../icons';
import { StatusChip, StatusMenu, toKey } from '../status';
import { STATUS_META } from '../tokens';
import { Cover } from './Cover';
import { DurationEditor } from './DurationEditor';
import {
  artMode, DETAIL_TABS, detailSubtitle, detailTiles, doneLabel, lastPlayedText, nextTab, type ArtMode, type DetailTab, type Tile,
} from './details';
import { APPROX_NOTE, APPROX_TITLE, forecastView } from './forecast';
import { completionInfo, dateInputToIso, isoToDateInput } from './filters';
import {
  filterTrophies, formatRate, HIDDEN_DETAIL, platinumEarnedAt, rarityLabel, raritySegments, sortTrophies, TROPHY_FILTERS, TROPHY_PAGE, TROPHY_SORTS,
  TROPHY_TYPE_LABELS, trophyAria, trophyCounts, trophyTitle, visibleTrophyCount, type TrophyFilter, type TrophySort,
} from './trophies';
import { tintStyle } from './tint';
import { useGameDetails, type DetailsState } from './useGameDetails';

/** Минимум данных об игре, пока полный `GameItem` ещё не получен (открытие из поповера жанров). */
export type GameStub = { id: number; title: string; coverUrl: string | null };

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Окно игры (design-system §4.15): полноэкранный лист с артом, плитками цифр и вкладками «Обзор» / «Трофеи».
 * Данные шапки и плиток берутся из `game`; список трофеев и даты приходят из GET /api/games/{id}.
 */
export function GameDialog({
  game, stub, startEditing, now, onClose, onStatus, onDate, onHidden, onLoaded, onGameChanged,
}: {
  game: GameItem | null;
  /** Игра известна только по id и названию: шапка рисуется из stub, плитки появятся после загрузки */
  stub?: GameStub | null;
  startEditing: boolean;
  now: number;
  onClose: () => void;
  onStatus: (g: GameItem, s: GameStatusValue | null) => void;
  onDate: (g: GameItem, kind: 'completed' | 'dropped', iso: string) => void;
  /** Убрать из коллекции / вернуть (9.7). Нет обработчика = кнопки нет. */
  onHidden?: (g: GameItem, hidden: boolean) => void;
  /** Полный GameItem из деталей (для stub): родитель подставит его в `game` */
  onLoaded?: (g: GameItem) => void;
  /** Игра изменена внутри окна (ручная длительность, 16.5): родитель подставит её в список. Нет обработчика = блока длительности нет. */
  onGameChanged?: (g: GameItem) => void;
}) {
  const target = game ?? stub ?? null;
  if (!target || typeof document === 'undefined') return null;
  return createPortal(
    <Frame key={target.id} onClose={onClose} tint={game?.tint}>
      {(titleId) => (
        <Body
          key={`${target.id}:${startEditing}`} id={target.id} titleId={titleId} game={game} stub={stub ?? null} startEditing={startEditing} now={now}
          onClose={onClose} onStatus={onStatus} onDate={onDate} onHidden={onHidden} onLoaded={onLoaded} onGameChanged={onGameChanged}
        />
      )}
    </Frame>,
    document.body,
  );
}

/** Оболочка: role=dialog, блокировка прокрутки, focus trap, Esc, возврат фокуса. */
function Frame({ onClose, tint, children }: { onClose: () => void; tint?: string | null; children: (titleId: string) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, []);

  // Клавиши на уровне документа: фокус мог потеряться (нажатая кнопка исчезла из DOM), Esc и Tab всё равно должны работать.
  // События из вложенных порталов (sheet статуса) сюда не относятся: они сами обрабатывают Esc и Tab.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const root = ref.current;
      if (!root || e.defaultPrevented) return;
      const t = e.target;
      const inside = t instanceof Node && (root.contains(t) || t === document.body || t === document.documentElement);
      if (!inside) return;
      if (e.key === 'Escape') {
        if ((t as HTMLElement).tagName === 'SELECT') return;
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      const active = document.activeElement;
      const lost = !(active instanceof Node) || !root.contains(active) || active === root;
      if (e.shiftKey && (lost || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (lost || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={ref} className="ps-gd" style={tintStyle(tint)} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="ps-gd__scroll">{children(titleId)}</div>
    </div>
  );
}

/**
 * Арт шапки (спека 9.1 п.2.2): баннер; нет баннера или он не загрузился, есть обложка: размытая компактная лента; нет ничего: заливка темы.
 * Скрим и высота зависят от `data-art` родителя `.ps-gd__hero`.
 */
function Art({ mode, bannerUrl, coverUrl, loading, onBannerError }: {
  mode: ArtMode; bannerUrl: string | null; coverUrl: string | null; loading: boolean; onBannerError: () => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const src = mode === 'banner' ? bannerUrl : mode === 'blur' ? coverUrl : null;
  // уже закэшированная картинка может не прислать onLoad после гидратации
  const imgRef = (el: HTMLImageElement | null) => { if (el?.complete && el.naturalWidth > 0 && shown !== src) setShown(src); };
  return (
    <div className="ps-gd__art" aria-hidden="true" data-loading={loading || undefined}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element -- внешний арт и обложки PSN
        <img
          ref={imgRef} src={src} alt="" decoding="async" referrerPolicy="no-referrer" data-shown={shown === src || undefined}
          onLoad={() => setShown(src)} onError={() => { if (mode === 'banner') onBannerError(); }}
        />
      )}
    </div>
  );
}

function Body({
  id, titleId, game: gameProp, stub, startEditing, now, onClose, onStatus, onDate, onHidden, onLoaded, onGameChanged,
}: {
  id: number; titleId: string; game: GameItem | null; stub: GameStub | null; startEditing: boolean; now: number;
  onClose: () => void;
  onStatus: (g: GameItem, s: GameStatusValue | null) => void;
  onDate: (g: GameItem, kind: 'completed' | 'dropped', iso: string) => void;
  onHidden?: (g: GameItem, hidden: boolean) => void;
  onLoaded?: (g: GameItem) => void;
  onGameChanged?: (g: GameItem) => void;
}) {
  // перечитываем детали при смене статуса или даты (statusChangedAt)
  const refreshKey = `${gameProp?.status ?? ''}|${gameProp?.completedAt ?? ''}|${gameProp?.droppedAt ?? ''}`;
  const { state, retry } = useGameDetails(id, refreshKey);
  const details = state.kind === 'ok' ? state.data : null;
  const game = gameProp ?? details?.game ?? null;
  const [tab, setTab] = useState<DetailTab>('overview');
  const [bannerFailed, setBannerFailed] = useState<string | null>(null);
  const tabId = useId();
  const loadedCb = useRef(onLoaded);
  useEffect(() => { loadedCb.current = onLoaded; }, [onLoaded]);
  useEffect(() => {
    if (!gameProp && details) loadedCb.current?.(details.game);
  }, [gameProp, details]);

  if (state.kind === 'error' && state.notFound && !game) {
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
              <h2 id={titleId} className="ps-gd__title">{title}</h2>
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
              <StatusMenu value={game.status} onPick={(s) => onStatus(game, s)} label="Изменить статус">
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
          ? game && <Overview game={game} details={details} loading={state.kind === 'loading'} startEditing={startEditing} now={now} onStatus={onStatus} onDate={onDate} onHidden={onHidden} onGameChanged={onGameChanged} />
          : <TrophiesTab state={state} onRetry={retry} />}
      </div>
    </div>
  );
}

function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <dl className="ps-gd__tiles">
      {tiles.map((x) => (
        <div
          key={x.id} className="ps-gd__tile" data-tile={x.id} data-state={x.id === 'platinum' ? x.state : undefined} data-muted={x.muted || undefined}
          role={x.id === 'platinum' ? 'group' : undefined} aria-label={x.id === 'platinum' ? x.aria : undefined}
        >
          <dt>{x.label}</dt>
          <dd className="ps-gd__tv num">
            {x.id === 'platinum' && x.state !== 'unknown' && <PlatinumIcon size={24} className="ps-gd__tplat" />}
            <span>{x.value}</span>
          </dd>
          {x.id === 'trophies' && x.progress !== null && (
            <span className="ps-gd__tbar" aria-hidden="true"><i style={{ width: `${x.progress}%` }} /></span>
          )}
          {x.sub && <span className="ps-gd__ts" title={x.sub}>{x.sub}</span>}
        </div>
      ))}
    </dl>
  );
}

function Kv({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`ps-gd__kv ${className ?? ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** «Путь к платине» (спека п.8.1): прогресс, остаток по грейдам, редкость, DLC. Приблизительность по `approximate`. */
function PlatinumPath({ f }: { f: PlatinumForecast }) {
  const v = forecastView(f);
  const approx = v.approximate;
  return (
    <section className="ps-gd__sec ps-gd__fc" aria-labelledby="gd-fc-t" data-almost={v.almost || undefined}>
      <div className="ps-gd__fch">
        <PlatinumIcon size={20} className="ps-gd__fcicon" />
        <h3 id="gd-fc-t">Путь к платине</h3>
        <span className="ps-gd__fcpct num" aria-label={v.pctAria}>
          {approx && <span className="ps-approx" title={APPROX_TITLE} aria-hidden="true">≈ </span>}{v.pct}
        </span>
      </div>
      <div className="ps-gd__prog" role="progressbar" aria-label="Прогресс к платине" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.progress}>
        <i style={{ width: `${v.progress}%` }} />
      </div>
      <p className="ps-gd__fcs">{v.requiredText}</p>
      <div className="ps-gd__rem">
        <div>
          <span className="ps-gd__lbl">Осталось</span>
          <b className="ps-gd__remv">{v.remainingText}</b>
        </div>
        {v.grades.length > 0 && (
          <ul className="ps-gd__grades" aria-label="Осталось по типам">
            {v.grades.map((g) => (
              <li key={g.type} data-type={g.type} aria-label={g.label} title={g.label}><Icon name="trophy" size={14} /><span className="num">{g.count}</span></li>
            ))}
          </ul>
        )}
        {v.hiddenText && <span className="ps-gd__hid"><Icon name="eye-off" size={12} />{v.hiddenText}</span>}
        {v.almost && <span className="ps-gd__almost">Почти готово</span>}
      </div>
      <dl className="ps-gd__metrics">
        {v.metrics.map((m) => (
          <div key={m.id}>
            <dt>{m.label}</dt>
            <dd className="num" data-empty={m.empty || undefined}>
              {m.value}
              {m.segments !== null && (
                <span className="ps-rar__seg" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} data-on={i < (m.segments ?? 0) || undefined} />)}</span>
              )}
            </dd>
            <small>{m.sub || '\u00a0'}</small>
          </div>
        ))}
      </dl>
      {v.ratesNote && <p className="ps-gd__note">{v.ratesNote}</p>}
      {v.dlcText && <p className="ps-gd__note ps-gd__dlc">{v.dlcText}</p>}
      {approx && <p className="ps-gd__note ps-gd__approx"><Icon name="info" size={12} />{APPROX_NOTE}</p>}
    </section>
  );
}

function Overview({
  game, details, loading, startEditing, now, onStatus, onDate, onHidden, onGameChanged,
}: {
  game: GameItem; details: GameDetailsResponse | null; loading: boolean; startEditing: boolean; now: number;
  onStatus: (g: GameItem, s: GameStatusValue | null) => void;
  onDate: (g: GameItem, kind: 'completed' | 'dropped', iso: string) => void;
  onHidden?: (g: GameItem, hidden: boolean) => void;
  onGameChanged?: (g: GameItem) => void;
}) {
  const hintId = useId();
  const hidden = !!game.hiddenAt;
  const done = completionInfo(game);
  const [editing, setEditing] = useState(startEditing && !!done);
  const [value, setValue] = useState(isoToDateInput(done?.iso));
  const [err, setErr] = useState<string | null>(null);
  const today = isoToDateInput(new Date(now).toISOString());

  function save() {
    if (!done) return;
    const iso = dateInputToIso(value, now);
    if (!iso) {
      setErr('Укажи дату целиком.');
      return;
    }
    onDate(game, done.kind, iso);
    setEditing(false);
  }

  const skeleton = <span className="ps-skeleton ps-gd__sk-val" aria-hidden="true" />;
  const forecast = details?.platinumForecast ?? null;
  // пока детали грузятся, место под прогноз резервируем, если платина в игре есть и не получена
  const forecastPending = loading && !details && game.trophies?.platinumDefined === true && !game.trophies.platinumEarned;
  const dateOr = (iso: string | null | undefined) => (details ? (formatDayMonth(iso ?? null, true) ?? 'нет данных') : loading ? skeleton : 'нет данных');
  return (
    <>
      <div className="ps-gd__cols">
        <section className="ps-gd__sec" aria-labelledby="gd-s1">
          <h3 id="gd-s1">Статус и даты</h3>
          <dl>
            <Kv label="Статус"><span className="ps-gd__st"><StatusGlyph status={toKey(game.status)} size={16} />{STATUS_META[toKey(game.status)].label}</span></Kv>
            {done && (
              <Kv label={doneLabel(done.kind)} className={editing ? 'ps-gd__kv--edit' : undefined}>
                {editing ? (
                  <form className="ps-inline-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
                    <input type="date" className="ps-input" value={value} max={today} aria-label="Дата завершения" onChange={(e) => { setValue(e.target.value); setErr(null); }} />
                    <button type="submit" aria-label="Сохранить дату завершения" className="ps-btn ps-btn--primary">Сохранить</button>
                    <button type="button" className="ps-btn" onClick={() => setEditing(false)}>Отмена</button>
                    {err && <span role="alert" className="ps-field-error">{err}</span>}
                  </form>
                ) : (
                  <>
                    {formatDate(done.iso)}{' '}
                    <button type="button" className="ps-link" onClick={() => setEditing(true)}>Изменить</button>
                  </>
                )}
              </Kv>
            )}
            <Kv label="Статус изменён">{dateOr(details?.statusChangedAt)}</Kv>
          </dl>
        </section>
        <section className="ps-gd__sec" aria-labelledby="gd-s2">
          <h3 id="gd-s2">Запуски</h3>
          <dl>
            <Kv label="Первый запуск">{dateOr(details?.firstPlayedAt)}</Kv>
            <Kv label="Последний запуск">{lastPlayedText(game.lastPlayedAt, now)}</Kv>
            <Kv label="Платформа">PlayStation · {game.platform}</Kv>
            {game.genres.length > 0 && <Kv label="Жанры" className="ps-gd__kv--long">{game.genres.map((g) => g.label).join(', ')}</Kv>}
          </dl>
        </section>
      </div>

      {forecast ? <PlatinumPath f={forecast} /> : forecastPending && (
        <div className="ps-skeleton ps-gd__sk-fc" aria-hidden="true" />
      )}

      {onGameChanged && game.duration && <DurationEditor key={game.id} game={game} onChanged={onGameChanged} />}

      {(game.status !== null || onHidden || hidden) && (
        <section className="ps-gd__sec ps-gd__manage" aria-labelledby="gd-s4">
          <h3 id="gd-s4">Управление</h3>
          {hidden && <dl><Kv label="Убрана из коллекции">{formatDayMonth(game.hiddenAt ?? null, true)}</Kv></dl>}
          <div className="ps-gd__actions">
            {game.status !== null && (
              <button type="button" className="ps-btn ps-btn--ghost" onClick={() => onStatus(game, null)}>
                <Icon name="undo" size={16} />Сбросить статус
              </button>
            )}
            {onHidden && (hidden ? (
              <button type="button" className="ps-btn" onClick={() => onHidden(game, false)}>
                <Icon name="undo" size={16} />Вернуть в коллекцию
              </button>
            ) : (
              <button type="button" className="ps-btn ps-btn--ghost ps-btn--danger" aria-describedby={hintId} onClick={() => onHidden(game, true)}>
                <Icon name="eye-off" size={16} />Убрать из коллекции
              </button>
            ))}
          </div>
          {onHidden && !hidden && <p className="ps-detail__hint" id={hintId}>Игра не будет показываться нигде, синк её не вернёт.</p>}
        </section>
      )}
    </>
  );
}

// ---------- Трофеи ----------

function TrophiesTab({ state, onRetry }: { state: DetailsState; onRetry: () => void }) {
  const [filter, setFilter] = useState<TrophyFilter>('all');
  const [sort, setSort] = useState<TrophySort>('game');
  const [shown, setShown] = useState(TROPHY_PAGE);
  const sortId = useId();
  const list = useMemo(() => (state.kind === 'ok' ? state.data.trophyList : []), [state]);
  const counts = useMemo(() => trophyCounts(list), [list]);
  const rows = useMemo(() => sortTrophies(filterTrophies(list, filter), sort), [list, filter, sort]);

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
          <ul className="ps-trophies">
            {view.map((x) => <TrophyRow key={`${x.setId}:${x.trophyId}`} t={x} />)}
          </ul>
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

function TrophyIcon({ t }: { t: GameTrophyItem }) {
  const [failed, setFailed] = useState<string | null>(null);
  const secret = t.name === null;
  if (secret || !t.iconUrl || failed === t.iconUrl) {
    return (
      <span className="ps-trophy__ic ps-trophy__ic--empty" data-locked={!t.earned || undefined} aria-hidden="true">
        {secret ? <Icon name="eye-off" size={20} /> : <Icon name="trophy" size={20} />}
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
  const secret = t.name === null;
  return (
    <li className="ps-trophy" data-type={t.type} data-earned={t.earned || undefined} aria-label={trophyAria(t)}>
      <TrophyIcon t={t} />
      <div className="ps-trophy__tx">
        <p className="ps-trophy__name">
          <TypeIcon type={t.type} />
          <span>{trophyTitle(t)}</span>
          {t.hidden && t.earned && <Icon name="eye-off" size={12} className="ps-trophy__hid" />}
        </p>
        <p className="ps-trophy__det" title={t.detail ?? undefined} data-muted={secret || undefined}>{secret ? HIDDEN_DETAIL : (t.detail ?? '')}</p>
      </div>
      <div className="ps-trophy__meta">
        <RarityMeter rarity={t.rarity} rate={t.earnedRate} />
        <span className="ps-trophy__date" data-earned={t.earned || undefined}>
          {t.earned ? (formatDayMonth(t.earnedAt, true) ?? 'получен') : 'Не получено'}
        </span>
      </div>
    </li>
  );
}
