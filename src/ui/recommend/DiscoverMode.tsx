'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../collection/api';
import { Icon } from '../icons';
import { useToast, useToastDismiss } from '../primitives/Toast';
import { postPlanned } from '../roadmap/api';
import '../recommend.css';
import {
  deleteDiscoverDislike, deleteOwnedMark, fetchDiscover, fetchOwnedMarks, postDiscoverDislike, putOwnedMark,
  type DiscoverItem, type DiscoverResponse,
} from './api';
import { DiscoverCard, type DiscoverBusy } from './DiscoverCard';
import { discoverView, PARTIAL_NOTE, pickedText, STALE_NOTE } from './discover-model';
import { DEFAULT_TTL_DAYS, hiddenForText } from './model';
import { removedText, type PutBody } from './owned-model';
import { OwnedMarksSheet } from './OwnedMarksSheet';
import { OwnedSheet } from './OwnedSheet';
import { RecSkeleton } from './RecCard';
import { useWide } from './useWide';

type Fatal = null | 'db' | 'other';
const FADE_MS = 200;

function StatePanel({ icon, title, children }: { icon: 'check' | 'circle-alert' | 'clock'; title: string; children: ReactNode }) {
  return (
    <div className="ps-panel ps-rec-panel ps-rec-empty">
      <span className="ps-rec-empty__ic"><Icon name={icon} size={40} /></span>
      <h2 className="ps-h3">{title}</h2>
      {children}
    </div>
  );
}

/** Вкладка «У тебя нет» (спека Фазы 31, контракт «Фаза 30»). Состав подборки считает сервер, UI только показывает. */
export function DiscoverMode({ active, onBacklog }: { active: boolean; onBacklog: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const dismissToast = useToastDismiss();
  const removedToast = useRef<number | null>(null);
  const overlayOpen = useRef(false);
  const wide = useWide();
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [fatal, setFatal] = useState<Fatal>(null);
  const [refreshErr, setRefreshErr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ReadonlyMap<string, DiscoverBusy>>(new Map());
  const [plannedIds, setPlannedIds] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [ownedItem, setOwnedItem] = useState<DiscoverItem | null>(null);
  const [marksOpen, setMarksOpen] = useState(false);
  const [ownedCount, setOwnedCount] = useState<number | null>(null);
  const reqRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null>(null);
  const dataRef = useRef<DiscoverResponse | null>(null);
  const started = useRef(false);
  const latest = useRef<{ load: () => Promise<void>; plan: (it: DiscoverItem) => Promise<void>; hide: (it: DiscoverItem) => Promise<void> } | null>(null);

  const load = useCallback(async () => {
    const my = ++reqRef.current;
    setLoading(true);
    try {
      const r = await fetchDiscover();
      if (my !== reqRef.current) return;
      dataRef.current = r;
      setData(r);
      setFatal(null);
      setRefreshErr(false);
      setLeaving(new Set());
      setGone(new Set());
    } catch (e) {
      if (my !== reqRef.current) return;
      if (e instanceof ApiError && e.status === 401) return;
      if (dataRef.current) setRefreshErr(true);
      else setFatal(e instanceof ApiError && (e.status === 503 || e.code === 'db_unavailable') ? 'db' : 'other');
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
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
      toast({ text: `Добавлено в План: «${it.title}»`, ttl: 6000, action: { label: 'Открыть План', run: () => router.push('/roadmap') } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setBusyFor(it.externalId, null); return; }
      if (e instanceof ApiError && (e.status === 409 || e.code === 'planned_duplicate')) {
        setPlannedIds((s) => new Set(s).add(it.externalId));
        toast({ text: 'Эта игра уже в Плане' });
      } else {
        toast({ alert: true, text: 'Не удалось добавить в План. Повтори', action: { label: 'Повторить', run: () => void latest.current?.plan(it) } });
      }
    }
    setBusyFor(it.externalId, null);
  }, [router, toast]);

  const undoHide = useCallback(async (externalId: string) => {
    try {
      await deleteDiscoverDislike(externalId);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) toast({ alert: true, text: 'Не удалось вернуть игру. Повтори' });
    }
    void latest.current?.load();
  }, [toast]);

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
    toast({ text: `${hiddenForText(DEFAULT_TTL_DAYS)}: «${it.title}»`, ttl: 8000, action: { label: 'Отменить', run: () => void undoHide(it.externalId) } });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setLeaving((s) => new Set(s).add(it.externalId));
    setTimeout(() => {
      setGone((s) => new Set(s).add(it.externalId));
      setBusyFor(it.externalId, null);
    }, reduce ? 0 : FADE_MS);
  }, [toast, undoHide]);

  const bumpCount = useCallback((d: number) => setOwnedCount((n) => (n === null ? n : Math.max(0, n + d))), []);

  const openMarks = useCallback(() => setMarksOpen(true), []);

  // «Отменить» после «Уже есть»: удаляем отметку и перечитываем выдачу, карточка возвращается на место
  const undoOwned = useCallback(async (it: DiscoverItem) => {
    try {
      await deleteOwnedMark(it.externalId);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        toast({ alert: true, text: 'Не удалось вернуть. Открой «Отмеченные» и верни вручную.', action: { label: 'Открыть', run: openMarks } });
      }
      return;
    }
    bumpCount(-1);
    focusAfter.current = it.externalId;
    void latest.current?.load();
  }, [toast, openMarks, bumpCount]);

  const submitOwned = useCallback(async (it: DiscoverItem, body: PutBody): Promise<boolean> => {
    try {
      await putOwnedMark(body);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) return false;
    }
    // фокус после ухода карточки: следующая, иначе предыдущая, иначе сама вкладка
    const list = (dataRef.current?.items ?? []).filter((x) => x.externalId === it.externalId || !gone.has(x.externalId));
    const i = list.findIndex((x) => x.externalId === it.externalId);
    focusAfter.current = (list[i + 1] ?? list[i - 1])?.externalId ?? '';
    bumpCount(1);
    setOwnedItem(null);
    if (removedToast.current !== null) dismissToast(removedToast.current);
    removedToast.current = toast({ text: removedText(it.title), ttl: 8000, action: { label: 'Отменить', run: () => void undoOwned(it) } });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setLeaving((s) => new Set(s).add(it.externalId));
    setTimeout(() => {
      setGone((s) => new Set(s).add(it.externalId));
      void latest.current?.load();
    }, reduce ? 0 : FADE_MS);
    return true;
  }, [gone, toast, dismissToast, undoOwned, bumpCount]);

  useEffect(() => { latest.current = { load, plan, hide }; });
  useEffect(() => { overlayOpen.current = marksOpen || ownedItem !== null; }, [marksOpen, ownedItem]);

  // перенос фокуса после ухода или возвращения карточки (sheet вернул его на исчезнувшую кнопку)
  useEffect(() => {
    const id = focusAfter.current;
    if (id === null || loading) return;
    // открыт лист или диалог: фокус не трогаем, он в ловушке листа
    if (overlayOpen.current) { focusAfter.current = null; return; }
    const root = panelRef.current;
    if (!root) return;
    const target = id ? Array.from(root.querySelectorAll<HTMLElement>('[data-ext]')).find((el) => el.dataset.ext === id) : null;
    if (id && !target) return;
    focusAfter.current = null;
    (target ?? root).focus();
  }, [data, gone, loading]);

  // число отмеченных для ссылки «Отмеченные · N»
  useEffect(() => {
    if (!active) return;
    const ac = new AbortController();
    fetchOwnedMarks(ac.signal).then((r) => setOwnedCount(r.marks.length)).catch(() => { /* без числа ссылка просто «Отмеченные» */ });
    return () => ac.abort();
  }, [active]);

  // запрос при первом открытии вкладки
  useEffect(() => {
    if (!active || started.current) return;
    started.current = true;
    let fired = false;
    const t = setTimeout(() => { fired = true; void latest.current?.load(); }, 0);
    return () => { clearTimeout(t); if (!fired) started.current = false; };
  }, [active]);

  const items = useMemo(() => (data?.items ?? []).filter((i) => !gone.has(i.externalId)), [data, gone]);
  const meta = data?.meta ?? null;
  const view = data ? discoverView({ items, meta: data.meta }) : null;
  const initial = loading && !data;
  const retry = () => { setFatal(null); void load(); };

  const toBacklog = <button type="button" className="ps-btn ps-btn--ghost" onClick={onBacklog}>Из бэклога</button>;

  let panel: ReactNode = null;
  if (fatal) {
    panel = (
      <StatePanel icon="circle-alert" title={fatal === 'db' ? 'Подборка пока недоступна' : 'Не удалось загрузить подборку'}>
        <p>Это временно. Проверь соединение и попробуй ещё раз.</p>
        <button type="button" className="ps-btn" onClick={retry}><Icon name="refresh" size={14} />Повторить</button>
      </StatePanel>
    );
  } else if (view === 'catalog') {
    panel = (
      <StatePanel icon="circle-alert" title="Каталог игр недоступен">
        <p>RAWG не настроен или временно выключен. Ничего не показываю, чтобы не предлагать выдуманные игры.</p>
        {toBacklog}
      </StatePanel>
    );
  } else if (view === 'not_generated') {
    panel = (
      <StatePanel icon="clock" title="Подборка ещё не создана">
        <p>Она появляется после ночного синка. Загляни завтра, а пока можно выбрать игру из бэклога.</p>
        {toBacklog}
      </StatePanel>
    );
  } else if (view === 'no_candidates') {
    panel = (
      <StatePanel icon="check" title="Новых игр пока нет">
        <p>Все подобранные игры уже в твоей библиотеке, в Плане или скрыты. Новая подборка появится после ночного синка.</p>
      </StatePanel>
    );
  }

  const when = meta ? pickedText(meta.generatedAt) : null;
  const notes = view === 'cards' && meta ? [meta.stale ? STALE_NOTE : null, meta.partial ? PARTIAL_NOTE : null].filter((n): n is string => n !== null) : [];

  return (
    <div className="ps-rec-mode" role="tabpanel" id="rec-panel-discover" aria-labelledby="rec-tab-discover" hidden={!active} ref={panelRef} tabIndex={-1}>
      <div className="ps-rec-pick">
        {view === 'cards' && when && <span className="ps-rec-pick__when">{when}</span>}
        <button type="button" className="ps-own-link" aria-haspopup="dialog" onClick={openMarks}>
          <Icon name="library" size={14} />
          <span>Отмеченные{ownedCount ? <> · <span className="num">{ownedCount}</span></> : null}</span>
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
      {panel ?? (
        <>
          {refreshErr && (
            <div className="ps-rec-banner" role="status">
              <Icon name="info" size={16} />
              <span>Не удалось обновить подборку. Показана прежняя.</span>
              <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => { setRefreshErr(false); void load(); }}>Повторить</button>
            </div>
          )}
          {notes.map((n) => <p key={n} className="ps-rec-note"><Icon name="info" size={12} />{n}</p>)}
          <ol className="ps-rec-list" data-discover="" aria-busy={loading || undefined} data-fade={!initial || undefined}>
            {initial
              ? Array.from({ length: wide ? 3 : 2 }, (_, i) => i).map((i) => <RecSkeleton key={i} wide={wide} />)
              : items.map((it, i) => (
                <DiscoverCard
                  key={it.externalId} item={it} index={i} total={items.length} wide={wide}
                  planned={it.planned || plannedIds.has(it.externalId)} busy={busy.get(it.externalId) ?? null} leaving={leaving.has(it.externalId)}
                  hideHint={hiddenForText(DEFAULT_TTL_DAYS)} onPlan={() => void plan(it)} onHide={() => void hide(it)} onOwn={() => setOwnedItem(it)}
                />
              ))}
          </ol>
          {view === 'cards' && (
            <p className="ps-rec-note">
              Данные об играх: <a className="ps-rec-note__link" href="https://rawg.io" target="_blank" rel="noopener noreferrer">RAWG</a>
              {items.some((x) => x.catalog === 'wikidata') && (
                <>{' '}и <a className="ps-rec-note__link" href="https://www.wikidata.org" target="_blank" rel="noopener noreferrer">Wikidata</a> (запасной каталог, пока RAWG недоступен)</>
              )}
            </p>
          )}
        </>
      )}
      <OwnedSheet item={ownedItem} onClose={() => setOwnedItem(null)} onSubmit={submitOwned} />
      <OwnedMarksSheet open={marksOpen} onClose={() => setMarksOpen(false)} onCount={setOwnedCount} onChanged={() => void latest.current?.load()} />
    </div>
  );
}
