'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../collection/api';
import { Icon } from '../icons';
import { useToast } from '../primitives/Toast';
import { postPlanned } from '../roadmap/api';
import '../recommend.css';
import {
  deleteDiscoverDislike, DISCOVER_TIMEOUT_MS, fetchDiscover, fetchDiscoverDislikes, postDiscoverDislike,
  type DiscoverItem, type DiscoverResponse, type ExternalDislikeItem,
} from './api';
import { DiscoverCard, type DiscoverBusy } from './DiscoverCard';
import { HiddenBlock, type HiddenRow } from './HiddenBlock';
import {
  DEFAULT_TTL_DAYS, DISCOVER_NOTES, DISCOVER_STAGES, discoverView, generatedText, hiddenForText, pickUpdatedText,
  PROGRESS_DELAY_MS, shownTotalText, stageIndex,
} from './model';
import { RecSkeleton } from './RecCard';
import { useWide } from './useWide';

type Fatal = null | 'db' | 'other' | 'timeout';
type HiddenList = { items: ExternalDislikeItem[]; ttlDays: number; at: number };
const FADE_MS = 200;

function Progress({ elapsed, compact }: { elapsed: number; compact: boolean }) {
  return (
    <div className="ps-panel ps-rec-prog" data-compact={compact || undefined}>
      <span className="ps-rec-prog__bar" aria-hidden="true" />
      <p className="ps-rec-prog__stage">{DISCOVER_STAGES[stageIndex(elapsed)].text}</p>
      {!compact && <small className="ps-rec-prog__hint">Подбор делается один раз в сутки и сохраняется. Можно подождать или вернуться позже.</small>}
    </div>
  );
}

function StatePanel({ icon, title, children }: { icon: 'check' | 'info' | 'lightbulb' | 'circle-alert' | 'clock'; title: string; children: ReactNode }) {
  return (
    <div className="ps-panel ps-rec-panel ps-rec-empty">
      <span className="ps-rec-empty__ic"><Icon name={icon} size={40} /></span>
      <h2 className="ps-h3">{title}</h2>
      {children}
    </div>
  );
}

/** Режим «Новое от ИИ» (спека 15, контракт §19). Фильтрацию и подтверждение игр делает сервер, UI только показывает. */
export function DiscoverMode({ active, onBacklog }: { active: boolean; onBacklog: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const wide = useWide();
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [fatal, setFatal] = useState<Fatal>(null);
  const [refreshErr, setRefreshErr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [rev, setRev] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [busy, setBusy] = useState<ReadonlyMap<string, DiscoverBusy>>(new Map());
  const [plannedIds, setPlannedIds] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState<HiddenList | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(new Set());
  const [now] = useState(() => Date.now());
  const reqRef = useRef(0);
  const hidReq = useRef(0);
  const ctlRef = useRef<AbortController | null>(null);
  const startRef = useRef(0);
  const dataRef = useRef<DiscoverResponse | null>(null);
  const ttlRef = useRef(DEFAULT_TTL_DAYS);
  const latest = useRef<{ run: (refresh: boolean) => Promise<DiscoverResponse | null>; loadHidden: () => Promise<void>; plan: (it: DiscoverItem) => Promise<void>; hide: (it: DiscoverItem) => Promise<void> } | null>(null);

  /** Запрос подборки. `refresh=1` только по явному нажатию; остальные вызовы (возврат, скрытие, повтор) идут без него. */
  const run = useCallback(async (refresh: boolean): Promise<DiscoverResponse | null> => {
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    const my = ++reqRef.current;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, DISCOVER_TIMEOUT_MS);
    startRef.current = Date.now();
    setElapsed(0);
    setLoading(true);
    setRefreshing(refresh);
    try {
      const r = await fetchDiscover(refresh, ctl.signal);
      if (my !== reqRef.current) return null; // ушедший режим или устаревший запрос
      const first = dataRef.current === null;
      dataRef.current = r;
      setData(r);
      setFatal(null);
      setRefreshErr(false);
      setLeaving(new Set());
      setGone(new Set());
      setPlannedIds(new Set());
      if (refresh || first) setRev((n) => n + 1);
      if (refresh) {
        setAnnounce(pickUpdatedText(r.items.length));
        if (r.meta.cached && r.meta.refreshLeft === 0) toast({ text: 'Новая подборка недоступна: лимит обновлений на сегодня исчерпан' });
      }
      setLoading(false);
      setRefreshing(false);
      return r;
    } catch (e) {
      if (my !== reqRef.current) return null;
      if (e instanceof ApiError && e.status === 401) return null;
      setLoading(false);
      setRefreshing(false);
      if (dataRef.current) setRefreshErr(true);
      else setFatal(timedOut ? 'timeout' : e instanceof ApiError && (e.status === 503 || e.code === 'db_unavailable') ? 'db' : 'other');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }, [toast]);

  const loadHidden = useCallback(async () => {
    const my = ++hidReq.current;
    try {
      const r = await fetchDiscoverDislikes();
      if (my === hidReq.current) setHidden({ items: r.items, ttlDays: r.ttlDays, at: Date.now() });
    } catch { /* список скрытых вторичен: ошибка не ломает экран */ }
  }, []);

  const setBusyFor = (id: string, v: DiscoverBusy) => setBusy((m) => { const n = new Map(m); if (v) n.set(id, v); else n.delete(id); return n; });

  const plan = useCallback(async (it: DiscoverItem) => {
    setBusyFor(it.externalId, 'plan');
    try {
      await postPlanned({
        title: it.title, releaseDate: it.releaseDate, coverUrl: it.coverUrl, wantAtRelease: false, hoursManual: null,
        externalSource: 'rawg', externalId: it.externalId,
      });
      setPlannedIds((s) => new Set(s).add(it.externalId));
      toast({ text: `Добавлено в план: «${it.title}»`, ttl: 6000, action: { label: 'Открыть план', run: () => router.push('/roadmap') } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setBusyFor(it.externalId, null); return; }
      if (e instanceof ApiError && (e.status === 409 || e.code === 'planned_duplicate')) {
        setPlannedIds((s) => new Set(s).add(it.externalId));
        toast({ text: 'Эта игра уже в плане' });
      } else {
        toast({ alert: true, text: 'Не удалось добавить в план. Повтори', action: { label: 'Повторить', run: () => void latest.current?.plan(it) } });
      }
    }
    setBusyFor(it.externalId, null);
  }, [router, toast]);

  const refetchAll = useCallback(async () => {
    const [r] = await Promise.all([latest.current?.run(false) ?? Promise.resolve(null), latest.current?.loadHidden()]);
    return r;
  }, []);

  const undoHide = useCallback(async (externalId: string) => {
    try {
      await deleteDiscoverDislike(externalId);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) toast({ alert: true, text: 'Не удалось вернуть игру. Повтори' });
    }
    void refetchAll();
  }, [refetchAll, toast]);

  const hide = useCallback(async (it: DiscoverItem) => {
    setBusyFor(it.externalId, 'hide');
    try {
      await postDiscoverDislike(it);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        toast({ alert: true, text: 'Не удалось скрыть игру. Повтори', action: { label: 'Повторить', run: () => void latest.current?.hide(it) } });
      }
      setBusyFor(it.externalId, null);
      return;
    }
    toast({ text: `${hiddenForText(ttlRef.current)}: «${it.title}»`, ttl: 8000, action: { label: 'Отменить', run: () => void undoHide(it.externalId) } });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setLeaving((s) => new Set(s).add(it.externalId));
    setTimeout(() => { setGone((s) => new Set(s).add(it.externalId)); setBusyFor(it.externalId, null); }, reduce ? 0 : FADE_MS);
    void refetchAll();
  }, [refetchAll, toast, undoHide]);

  const restore = useCallback(async (externalId: string, name: string) => {
    setRestoring((s) => new Set(s).add(externalId));
    let ok = false;
    try {
      await deleteDiscoverDislike(externalId);
      ok = true;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) toast({ alert: true, text: 'Не удалось вернуть игру. Повтори' });
    }
    if (ok) {
      const r = await refetchAll();
      toast({ text: `«${name}» снова в подсказках${r && !r.items.some((i) => i.externalId === externalId) ? '. Появится в следующей подборке' : ''}` });
    }
    setRestoring((s) => { const n = new Set(s); n.delete(externalId); return n; });
  }, [refetchAll, toast]);

  useEffect(() => { latest.current = { run, loadHidden, plan, hide }; ttlRef.current = hidden?.ttlDays ?? DEFAULT_TTL_DAYS; });

  // запрос только пока режим выбран; уход из режима отменяет запрос (сервер дозапишет кэш)
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => { void latest.current?.run(false); void latest.current?.loadHidden(); }, 0);
    return () => {
      clearTimeout(t);
      ctlRef.current?.abort();
      reqRef.current += 1;
      setLoading(false);
      setRefreshing(false);
    };
  }, [active]);

  // этап долгой загрузки по времени с начала запроса
  useEffect(() => {
    if (!loading) return;
    const t = setInterval(() => setElapsed(Date.now() - startRef.current), 250);
    return () => clearInterval(t);
  }, [loading]);

  const items = useMemo(() => (data?.items ?? []).filter((i) => !gone.has(i.externalId)), [data, gone]);
  const hiddenRows = useMemo<HiddenRow[]>(
    () => (hidden?.items ?? []).map((h) => ({ key: h.externalId, name: h.title, imageUrl: h.coverUrl, expiresAt: h.expiresAt })),
    [hidden],
  );
  const ttlDays = hidden?.ttlDays ?? DEFAULT_TTL_DAYS;
  const meta = data?.meta ?? null;
  const view = data ? discoverView({ items, meta: data.meta }) : null;
  const initial = loading && !data;
  const progressOn = loading && elapsed >= PROGRESS_DELAY_MS && (initial || refreshing);
  const liveText = progressOn ? DISCOVER_STAGES[stageIndex(elapsed)].text : announce;

  const retry = () => { setFatal(null); void run(false); };
  const refreshNow = () => void run(true);
  const canRefresh = !!meta && meta.llm !== 'limit' && meta.refreshLeft > 0 && !loading;

  const refreshBtn = (kind: 'row' | 'panel') => {
    const left = meta?.refreshLeft ?? 0;
    const limited = meta?.llm === 'limit';
    const spent = !limited && left <= 0;
    const title = limited ? 'Дневной лимит ИИ исчерпан' : spent ? 'Обновить можно 3 раза в сутки. Лимит обновится завтра' : undefined;
    return (
      <button
        type="button" className={kind === 'panel' ? 'ps-btn ps-btn--primary' : 'ps-btn ps-btn--ghost ps-btn--sm ps-rec-refresh'}
        disabled={!canRefresh} title={title} onClick={refreshNow}
      >
        {refreshing ? <span className="ps-rec__spin" aria-hidden="true" /> : <Icon name="refresh" size={14} />}
        {refreshing ? 'Обновляю…' : 'Обновить подборку'}
        {kind === 'row' && !refreshing && !limited && meta && (
          spent ? <small className="ps-rec-refresh__left">· лимит на сегодня</small> : <small className="ps-rec-refresh__left">· осталось <span className="num">{left}</span></small>
        )}
      </button>
    );
  };

  const toBacklog = (kind: 'ghost' | 'plain') => (
    <button type="button" className={kind === 'ghost' ? 'ps-btn ps-btn--ghost' : 'ps-btn'} onClick={onBacklog}>Из бэклога</button>
  );

  // ---- центральные панели ----
  let panel: ReactNode = null;
  let showRow = false;
  const hiddenCount = hidden?.items.length ?? 0;
  if (fatal) {
    panel = (
      <StatePanel icon="circle-alert" title={fatal === 'db' ? 'Подборка пока недоступна' : 'Не удалось загрузить подборку'}>
        <p>{fatal === 'db' ? 'Не получилось обратиться к базе данных. Это временно.'
          : fatal === 'timeout' ? 'Подбор занял слишком много времени. Результат мог сохраниться: попробуй ещё раз.'
            : 'Проверь соединение и попробуй ещё раз.'}</p>
        <button type="button" className="ps-btn" onClick={retry}><Icon name="refresh" size={14} />Повторить</button>
      </StatePanel>
    );
  } else if (view === 'disabled') {
    panel = (
      <StatePanel icon="lightbulb" title="Режим пока не настроен">
        <p>Для подборки новинок нужно подключить ИИ-сервис в настройках сервера. Пока можно пользоваться режимом «Из бэклога».</p>
        {toBacklog('plain')}
      </StatePanel>
    );
  } else if (view === 'catalog') {
    panel = (
      <StatePanel icon="circle-alert" title="Каталог игр недоступен">
        <p>Не получилось сверить игры с каталогом RAWG: он не настроен или временно не отвечает. Ничего не показываю, чтобы не предлагать выдуманные названия.</p>
        <button type="button" className="ps-btn" disabled={loading} onClick={retry}><Icon name="refresh" size={14} />Повторить</button>
        {toBacklog('ghost')}
      </StatePanel>
    );
  } else if (view === 'limit') {
    panel = (
      <StatePanel icon="clock" title="На сегодня подборки закончились">
        <p>Дневной лимит ИИ исчерпан. Завтра он обновится, а пока доступен режим «Из бэклога».</p>
        {toBacklog('ghost')}
      </StatePanel>
    );
  } else if (view === 'error') {
    panel = (
      <StatePanel icon="circle-alert" title="Подборка пока недоступна">
        <p>ИИ сейчас не отвечает. Это временно, попробуй чуть позже.</p>
        <button type="button" className="ps-btn" disabled={loading} onClick={retry}><Icon name="refresh" size={14} />Повторить</button>
        {toBacklog('ghost')}
      </StatePanel>
    );
  } else if (view === 'filtered' || view === 'unverified') {
    const canAgain = (meta?.refreshLeft ?? 0) > 0;
    panel = view === 'filtered' ? (
      <StatePanel icon="check" title="Новых игр пока нет">
        <p>Все подобранные игры уже в твоей библиотеке, в плане или скрыты. {canAgain ? 'Можно обновить подборку.' : 'Обновить можно будет завтра.'}</p>
        {canAgain && refreshBtn('panel')}
      </StatePanel>
    ) : (
      <StatePanel icon="info" title="Не удалось подобрать игры">
        <p>Предложенные игры не нашлись в каталоге PlayStation. {canAgain ? 'Попробуй обновить подборку.' : 'Обновить можно будет завтра.'}</p>
        {canAgain && refreshBtn('panel')}
      </StatePanel>
    );
  } else if (view === 'cards') {
    showRow = true;
  }

  const note: ReactNode = view === 'cards' && !refreshErr
    ? (meta?.llm === 'limit' ? DISCOVER_NOTES.limit : meta?.llm === 'error' ? DISCOVER_NOTES.error : null)
    : null;
  const when = meta ? generatedText(meta.generatedAt, now) : null;
  const total = view === 'cards' && meta ? shownTotalText(meta.verified, meta.proposed, items.length) : null;

  return (
    <div className="ps-rec-mode" hidden={!active}>
      {(showRow || initial) && (
        <div className="ps-rec-pick">
          <span className="ps-rec-pick__when">{showRow ? when : null}</span>
          {showRow ? refreshBtn('row') : (
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-rec-refresh" disabled>
              <Icon name="refresh" size={14} />Обновить подборку
            </button>
          )}
        </div>
      )}
      <div className="ps-rec-sr" aria-live="polite">{liveText}</div>

      {progressOn && <Progress elapsed={elapsed} compact={!initial} />}

      {panel ?? (
        <>
          {refreshErr && (
            <div className="ps-rec-banner" role="status">
              <Icon name="info" size={16} />
              <span>Не удалось обновить подборку. Показана прежняя.</span>
              <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => { setRefreshErr(false); void run(false); }}>Повторить</button>
            </div>
          )}
          {note && <p className="ps-rec-note ps-rec-note--ic"><Icon name="info" size={12} />{note}</p>}
          <ol key={initial ? 'sk' : rev} className="ps-rec-list" aria-busy={loading || undefined} data-fade={!initial || undefined}>
            {initial
              ? Array.from({ length: wide ? 3 : 2 }, (_, i) => i).map((i) => <RecSkeleton key={i} wide={wide} />)
              : items.map((it, i) => (
                <DiscoverCard
                  key={it.externalId} item={it} index={i} total={items.length} wide={wide} nowMs={now}
                  planned={it.planned || plannedIds.has(it.externalId)} busy={busy.get(it.externalId) ?? null} leaving={leaving.has(it.externalId)}
                  hideHint={hiddenForText(ttlDays)} onPlan={() => void plan(it)} onHide={() => void hide(it)}
                />
              ))}
          </ol>
          {total && <p className="ps-rec-note">{total}</p>}
        </>
      )}

      {!fatal && hiddenCount > 0 && (
        <HiddenBlock
          id="rec-hidden-discover" items={hiddenRows} ttlDays={ttlDays} now={hidden?.at ?? now} open={hiddenOpen} busy={restoring}
          onToggle={() => setHiddenOpen((o) => !o)} onRestore={(key, name) => void restore(key, name)}
        />
      )}
    </div>
  );
}
