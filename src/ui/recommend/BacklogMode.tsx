'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ApiError, fetchSummary, putStatus } from '../collection/api';
import { GameDialog, type GameStub } from '../collection/GameDialog';
import type { GameItem } from '@/server/collection/types';
import { Icon, StatusGlyph } from '../icons';
import { useToast } from '../primitives/Toast';
import '../recommend.css';
import { deleteDislike, fetchDislikes, fetchRecommend, postDislike, type DislikeItem, type RecommendResponse } from './api';
import { HiddenBlock, type HiddenRow } from './HiddenBlock';
import { DEFAULT_TTL_DAYS, daysText, hiddenForText, llmNote, parseTime, pendingNote, REC_COUNT, recommendHref, TIME_OPTIONS, timeHintText, updatedText, type TimeValue } from './model';
import { RecCard, RecSkeleton, type CardBusy } from './RecCard';
import { useWide } from './useWide';

const SLOW_MS = 8000;
type Fatal = null | 'db' | 'other';
type HiddenList = { items: DislikeItem[]; ttlDays: number; at: number };

/** Режим «Из бэклога» экрана «Подскажи»: до 9 игр бэклога с причиной. Выбирает расчёт на сервере, UI только показывает (спека фазы 13). */
export function BacklogMode({ active, onCandidates, onTime }: { active: boolean; onCandidates: (n: number | null) => void; onTime: (t: TimeValue) => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const wide = useWide();
  const [time, setTimeState] = useState<TimeValue>(() => parseTime(params.get('time')));
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [fatal, setFatal] = useState<Fatal>(null);
  const [refreshErr, setRefreshErr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [rev, setRev] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [busy, setBusy] = useState<ReadonlyMap<number, CardBusy>>(new Map());
  const [hidden, setHidden] = useState<HiddenList | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(new Set());
  const [backlog, setBacklog] = useState<number | 'fail' | null>(null);
  const [now] = useState(() => Date.now());
  const [open, setOpen] = useState<{ id: number; game: GameItem | null; stub: GameStub | null } | null>(null);
  const reqRef = useRef(0);
  const hidReq = useRef(0);
  const ttlRef = useRef(DEFAULT_TTL_DAYS);
  const hidBtn = useRef<HTMLButtonElement | null>(null);
  const timeRef = useRef(time);
  const dataRef = useRef<RecommendResponse | null>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const latest = useRef<{ load: (t: TimeValue, retriedAny?: boolean) => Promise<void>; loadHidden: () => Promise<void>; start: (id: number, name: string) => Promise<void>; hide: (id: number, name: string) => Promise<void> } | null>(null);

  const setTime = useCallback((t: TimeValue) => {
    timeRef.current = t;
    onTime(t);
    setTimeState(t);
    router.replace(recommendHref(t), { scroll: false });
  }, [router, onTime]);

  const load = useCallback(async (t: TimeValue, retriedAny = false): Promise<void> => {
    const my = ++reqRef.current;
    setLoading(true);
    try {
      const r = await fetchRecommend(t);
      if (my !== reqRef.current) return; // ответ устаревшего запроса отбрасывается
      dataRef.current = r;
      setData(r);
      setFatal(null);
      setRefreshErr(false);
      setExpanded(new Set());
      setRev((n) => n + 1);
      setAnnounce(updatedText(r.items.length));
      setLoading(false);
    } catch (e) {
      if (my !== reqRef.current) return;
      if (e instanceof ApiError && e.status === 401) return;
      if (e instanceof ApiError && e.status === 400 && t !== 'any' && !retriedAny) {
        setTime('any');
        return void latest.current?.load('any', true);
      }
      setLoading(false);
      if (dataRef.current) setRefreshErr(true);
      else setFatal(e instanceof ApiError && (e.status === 503 || e.code === 'db_unavailable') ? 'db' : 'other');
    }
  }, [setTime]);

  // серверный список скрытых (§18.9); при сбое остаётся прежний, блок без него не показывается
  const loadHidden = useCallback(async () => {
    const my = ++hidReq.current;
    try {
      const r = await fetchDislikes();
      if (my === hidReq.current) setHidden({ items: r.items, ttlDays: r.ttlDays, at: Date.now() });
    } catch { /* список скрытых вторичен: ошибка не ломает экран */ }
  }, []);

  // первая загрузка и смена времени; неизвестное значение в URL заменяется на чистый адрес
  useEffect(() => {
    const raw = params.get('time');
    const t = setTimeout(() => {
      if (raw !== null && parseTime(raw) !== raw) router.replace(recommendHref(parseTime(raw)), { scroll: false });
      void load(timeRef.current);
      void loadHidden();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при монтировании: смена времени вызывает load из выбора сегмента
  }, []);

  const pick = useCallback((t: TimeValue) => {
    if (t === timeRef.current) return;
    setTime(t);
    void load(t);
  }, [load, setTime]);

  // «Подбор занимает дольше обычного…»
  useEffect(() => {
    if (!loading) { const t = setTimeout(() => setSlow(false), 0); return () => clearTimeout(t); }
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [loading]);

  // пустое состояние: различаем «бэклог пуст» и «все скрыты»
  const empty = data !== null && data.items.length === 0;
  useEffect(() => {
    if (!empty) return;
    let live = true;
    const t = setTimeout(() => {
      setBacklog(null);
      fetchSummary().then((s) => { if (live) setBacklog(s.counts.backlog); }).catch(() => { if (live) setBacklog('fail'); });
    }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [empty, rev]);

  const setBusyFor = (id: number, v: CardBusy) => setBusy((m) => { const n = new Map(m); if (v) n.set(id, v); else n.delete(id); return n; });
  const reload = useCallback(() => { void latest.current?.load(timeRef.current); void latest.current?.loadHidden(); }, []);

  const start = useCallback(async (id: number, name: string) => {
    setBusyFor(id, 'start');
    try {
      await putStatus(id, 'playing');
      toast({ text: `«${name}» теперь в «Играю»`, ttl: 6000, action: { label: 'К коллекции', run: () => router.push('/') } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setBusyFor(id, null); return; }
      if (e instanceof ApiError && e.status === 404) toast({ text: 'Игры уже нет в библиотеке' });
      else toast({ text: 'Не удалось начать игру. Повтори', action: { label: 'Повторить', run: () => void latest.current?.start(id, name) } });
      if (!(e instanceof ApiError && e.status === 404)) { setBusyFor(id, null); return; }
    }
    setBusyFor(id, null);
    reload();
  }, [reload, router, toast]);

  const undoHide = useCallback(async (id: number) => {
    try {
      await deleteDislike(id);
    } catch {
      toast({ text: 'Не удалось вернуть игру. Повтори' });
    }
    reload();
  }, [reload, toast]);

  const ttlDays = hidden?.ttlDays ?? DEFAULT_TTL_DAYS;

  const hide = useCallback(async (id: number, name: string) => {
    setBusyFor(id, 'hide');
    try {
      await postDislike(id);
      toast({ text: `${hiddenForText(ttlRef.current)}: «${name}»`, ttl: 8000, action: { label: 'Отменить', run: () => void undoHide(id) } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setBusyFor(id, null); return; }
      if (e instanceof ApiError && e.status === 404) toast({ text: 'Игры уже нет в библиотеке' });
      else { toast({ text: 'Не удалось скрыть игру. Повтори', action: { label: 'Повторить', run: () => void latest.current?.hide(id, name) } }); setBusyFor(id, null); return; }
    }
    setBusyFor(id, null);
    reload();
  }, [reload, toast, undoHide]);

  // «Вернуть» в блоке «Скрытые»: DELETE, затем перезапрос обоих списков
  const restore = useCallback(async (key: string, name: string) => {
    const id = Number(key);
    setRestoring((s) => new Set(s).add(key));
    try {
      await deleteDislike(id);
      toast({ text: `«${name}» снова в подсказках` });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setRestoring((s) => { const n = new Set(s); n.delete(key); return n; }); return; }
      toast({ text: 'Не удалось вернуть игру. Повтори' });
    }
    setRestoring((s) => { const n = new Set(s); n.delete(key); return n; });
    reload();
  }, [reload, toast]);

  const showHidden = () => {
    setHiddenOpen(true);
    document.getElementById('rec-hidden')?.scrollIntoView({ block: 'nearest' });
    hidBtn.current?.focus();
  };

  useEffect(() => { latest.current = { load, loadHidden, start, hide };
    ttlRef.current = ttlDays; });

  const openGame = (id: number, name: string, cover: string | null) => setOpen({ id, game: null, stub: { id, title: name, coverUrl: cover } });
  const dialogGame = open?.game ?? null;
  const setStatus = useCallback(async (g: GameItem, status: GameItem['status']) => {
    try {
      const r = await putStatus(g.id, status);
      setOpen((o) => (o && o.id === g.id ? { ...o, game: r.game } : o));
      toast({ text: 'Статус изменён' });
      reload();
    } catch (e) {
      toast({ text: e instanceof ApiError && e.status === 404 ? 'Игры уже нет в библиотеке' : 'Не удалось сменить статус. Повтори' });
    }
  }, [reload, toast]);

  // стрелки/Home/End выбирают и применяют (roving tabindex)
  const onRadioKey = (e: KeyboardEvent, i: number) => {
    const n = TIME_OPTIONS.length;
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to < 0) return;
    e.preventDefault();
    pick(TIME_OPTIONS[to].value);
    radios.current[to]?.focus();
  };

  const items = useMemo(() => data?.items ?? [], [data]);
  const hiddenRows = useMemo<HiddenRow[]>(() => (hidden?.items ?? []).map((h) => ({ key: String(h.game.id), name: h.game.name, imageUrl: h.game.imageUrl, expiresAt: h.expiresAt })), [hidden]);

  // подзаголовок «Из N игр бэклога…» рисует оболочка
  const cand = data && !empty ? data.meta.candidates : null;
  useEffect(() => { if (active) onCandidates(cand); }, [active, cand, onCandidates]);
  // возврат в режим: показываем прежний ответ и тихо перезапрашиваем
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current && dataRef.current) reload();
    wasActive.current = active;
  }, [active, reload]);
  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const note = data ? llmNote(data.meta.llm) : null;
  const pending = data ? pendingNote(data.meta.llmPending, data.meta.llm) : null;
  const initial = loading && !data;

  const retry = () => { setFatal(null); void load(timeRef.current); };

  const timeControl = (
    <div className="ps-rec-time">
      <div className="ps-seg ps-rec-seg" role="radiogroup" aria-label="Сколько времени есть">
        {TIME_OPTIONS.map((o, i) => (
          <button
            key={o.value} type="button" role="radio" aria-checked={time === o.value} tabIndex={time === o.value ? 0 : -1}
            aria-label={`${o.label}, ${o.hint}`} ref={(el) => { radios.current[i] = el; }}
            onClick={() => pick(o.value)} onKeyDown={(e) => onRadioKey(e, i)}
          >
            <span className="ps-rec-seg__t">{o.label}</span>
            <small className="ps-rec-seg__h">{o.hint}</small>
          </button>
        ))}
      </div>
      <p className="ps-rec-hint">
        <span>{timeHintText(time)}</span>
        {loading && data && <span className="ps-rec-busy"><span className="ps-rec__spin" aria-hidden="true" />Подбираю…</span>}
      </p>
    </div>
  );

  // ---- пусто / ошибка первой загрузки: панель по центру ----
  let panel: React.ReactNode = null;
  let showControl = true;
  if (fatal) {
    panel = (
      <div className="ps-panel ps-rec-panel ps-rec-empty" role="alert">
        <span className="ps-rec-empty__ic"><Icon name="circle-alert" size={40} /></span>
        <h2 className="ps-h3">{fatal === 'db' ? 'Подсказки пока недоступны' : 'Не удалось загрузить подсказки'}</h2>
        <p>{fatal === 'db' ? 'Не получилось обратиться к базе данных. Это временно.' : 'Проверь соединение и попробуй ещё раз.'}</p>
        <button type="button" className="ps-btn" onClick={retry}><Icon name="refresh" size={14} />Повторить</button>
      </div>
    );
  } else if (empty) {
    showControl = false;
    if (backlog === 0) {
      panel = (
        <div className="ps-panel ps-rec-panel ps-rec-empty">
          <StatusGlyph status="backlog" size={40} />
          <h2 className="ps-h3">В бэклоге пусто</h2>
          <p>Поставь играм статус «Бэклог» в коллекции, и я подскажу, с чего начать.</p>
          <Link href="/" className="ps-btn ps-btn--primary">К коллекции</Link>
        </div>
      );
    } else if (hidden && hidden.items.length > 0) {
      panel = (
        <div className="ps-panel ps-rec-panel ps-rec-empty">
          <span className="ps-rec-empty__ic"><Icon name="thumbs-down" size={40} /></span>
          <h2 className="ps-h3">Подсказывать нечего: все игры бэклога скрыты</h2>
          <p>Ты отметил их как неинтересные. Они вернутся сами через {daysText(ttlDays)} или раньше, если нажать «Вернуть».</p>
          <button type="button" className="ps-btn" onClick={showHidden}>Показать скрытые: {hidden.items.length}</button>
        </div>
      );
    } else if (typeof backlog === 'number') {
      panel = (
        <div className="ps-panel ps-rec-panel ps-rec-empty">
          <span className="ps-rec-empty__ic"><Icon name="thumbs-down" size={40} /></span>
          <h2 className="ps-h3">Подсказывать нечего: все игры бэклога скрыты</h2>
          <p>Ты отметил их как неинтересные. Новые игры в бэклоге появятся здесь сразу.</p>
          {hidden === null && (
            <>
              <p>Список скрытых игр пока не загрузился. Попробуй ещё раз, чтобы вернуть их.</p>
              <button type="button" className="ps-btn" onClick={() => void loadHidden()}><Icon name="refresh" size={14} />Повторить</button>
            </>
          )}
        </div>
      );
    } else if (backlog === 'fail') {
      panel = (
        <div className="ps-panel ps-rec-panel ps-rec-empty">
          <h2 className="ps-h3">Подсказать пока нечего</h2>
          <p>В бэклоге нет игр, которые можно предложить.</p>
          <Link href="/" className="ps-btn ps-btn--primary">К коллекции</Link>
        </div>
      );
    } else {
      panel = <div className="ps-panel ps-rec-panel ps-rec-empty" aria-busy="true"><div className="ps-skeleton ps-rec-empty__sk" aria-hidden="true" /></div>;
    }
  }

  return (
    <div className="ps-rec-mode" hidden={!active}>
      {showControl && timeControl}
      <div className="ps-rec-sr" aria-live="polite">{announce}</div>

      {panel ?? (
        <>
          {refreshErr && (
            <div className="ps-rec-banner" role="status">
              <Icon name="info" size={16} />
              <span>Не удалось обновить подсказки. Показаны прежние.</span>
              <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => { setRefreshErr(false); reload(); }}>Повторить</button>
            </div>
          )}
          <ol key={initial ? 'sk' : rev} className="ps-rec-list" aria-busy={loading || undefined} data-fade={!initial || undefined}>
            {initial
              ? Array.from({ length: wide ? REC_COUNT : 3 }, (_, i) => i).map((i) => <RecSkeleton key={i} wide={wide} />)
              : items.map((it, i) => (
                <RecCard
                  key={it.game.id} item={it} index={i} total={items.length} wide={wide}
                  open={expanded.has(it.game.id)} busy={busy.get(it.game.id) ?? null} locked={false}
                  onToggle={() => toggle(it.game.id)}
                  onOpenGame={() => openGame(it.game.id, it.game.name, it.game.imageUrl)}
                  onStart={() => void start(it.game.id, it.game.name)}
                  onHide={() => void hide(it.game.id, it.game.name)} hideHint={hiddenForText(ttlDays)}
                />
              ))}
          </ol>
          {initial && slow && <p className="ps-rec-note">Подбор занимает дольше обычного…</p>}
          {!initial && items.length > 0 && items.length < REC_COUNT && <p className="ps-rec-note">Подходящих игр в бэклоге: {data?.meta.candidates ?? items.length}</p>}
          {!initial && note && <p className="ps-rec-note ps-rec-note--ic"><Icon name="info" size={12} />{note}</p>}
          {!initial && !note && pending && <p className="ps-rec-note ps-rec-note--ic" data-testid="rec-pending"><Icon name="info" size={12} />{pending}</p>}
        </>
      )}

      {!fatal && hidden && hidden.items.length > 0 && (
        <HiddenBlock
          ref={hidBtn} items={hiddenRows} ttlDays={hidden.ttlDays} now={hidden.at} open={hiddenOpen} busy={restoring}
          onToggle={() => setHiddenOpen((o) => !o)} onRestore={(key, name) => void restore(key, name)}
        />
      )}

      <GameDialog
        game={dialogGame} stub={open?.stub ?? null} startEditing={false} now={now} onClose={() => setOpen(null)}
        onLoaded={(g) => setOpen((o) => (o && o.id === g.id && !o.game ? { ...o, game: g } : o))}
        onStatus={(g, s) => void setStatus(g, s)} onDate={() => {}}
      />
    </div>
  );
}
