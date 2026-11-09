'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlannedGameDto, RoadmapEntry, RoadmapResponse } from '@/server/roadmap/types';
import { ApiError, patchDuration } from '../collection/api';
import { Icon } from '../icons';
import { useToast } from '../primitives/Toast';
import '../roadmap.css';
import { deleteExclusion, deletePlanned, fetchPlanned, fetchRoadmap, mutationError, patchPlanned, postExclusion, postPlanned, putOrder, putSettings } from './api';
import { applyOrder, buildQueueRows, buildSchedule, mergeVisibleOrder, orderGameIds, orderWithAtPosition, placedToast, recreateBody, removedToast, sortPlanned, upcomingBody, type PlannedBody, type UpcomingCandidate } from './model';
import { ServicePanel, UnallocatedPanel, UpcomingPanel } from './ExtraPanels';
import { NeedHoursPanel, OverPanel } from './NeedOverPanels';
import { GoalPanel } from './GoalPanel';
import { flashElement } from './parts';
import { ProgressPanel } from './ProgressPanel';
import { QueuePanel, type SaveState } from './QueuePanel';
import { roadmapBacklogText } from '@/shared/backlog';
import { ReleasesPanel } from './ReleasesPanel';
import { SettingsPanel } from './SettingsPanel';
import { TimelinePanel } from './Timeline';

const SAVE_DEBOUNCE_MS = 500;

/** Экран «План»: настройки, прогресс, таймлайн, релизы, очередь бэклога, «Нужны часы», «Не успеваю». Ошибка блока не роняет страницу. */
export function RoadmapView() {
  const toast = useToast();
  const [data, setData] = useState<RoadmapResponse | null>(null);
  const [error, setError] = useState(false);
  // все записи планируемых игр (любой статус): «Релизы» берут planned, «Предстоящие» сверяются по всем
  const [allPlanned, setAllPlanned] = useState<PlannedGameDto[] | null>(null);
  const planned = useMemo(() => (allPlanned ? allPlanned.filter((g) => g.status === 'planned') : null), [allPlanned]);
  const [plannedErr, setPlannedErr] = useState(false);
  const [recalc, setRecalc] = useState(0);
  const [applying, setApplying] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const dataRef = useRef<RoadmapResponse | null>(null);
  const moving = useRef(false);
  const [moving_, setMoving] = useState(false);
  const plannedRef = useRef<PlannedGameDto[] | null>(null);
  const reqRef = useRef(0);
  const pendingOrder = useRef<string[] | null>(null);
  const failedOrder = useRef<string[] | null>(null);
  const inflight = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // самовызовы в тостах «Повторить» идут через ref, чтобы не обращаться к значению до объявления
  const latest = useRef<{ load: () => Promise<boolean>; loadPlanned: () => Promise<void>; apply: (y: number, h: number) => Promise<void>; patchGame: (id: number, p: Partial<Omit<PlannedBody, 'externalSource' | 'externalId'>>) => Promise<void>; flush: () => Promise<void> } | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    const my = ++reqRef.current;
    try {
      const r = await fetchRoadmap();
      if (my !== reqRef.current) return true;
      dataRef.current = r;
      setData(r);
      setError(false);
      return true;
    } catch (e) {
      if (my !== reqRef.current) return false;
      if (e instanceof ApiError && e.status === 401) return false;
      if (dataRef.current) toast({ kind: 'error', text: `Не удалось обновить план. ${e instanceof ApiError ? mutationError(e) : 'Нет связи с сервером.'}`, action: { label: 'Повторить', run: () => void latest.current?.load() } });
      else setError(true);
      return false;
    }
  }, [toast]);

  const loadPlanned = useCallback(async (): Promise<void> => {
    try {
      const r = await fetchPlanned();
      plannedRef.current = r.planned;
      setAllPlanned(sortPlanned(r.planned));
      setPlannedErr(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      if (plannedRef.current) toast({ kind: 'error', text: 'Не удалось обновить релизы. Повтори', action: { label: 'Повторить', run: () => void latest.current?.loadPlanned() } });
      else setPlannedErr(true);
    }
  }, [toast]);

  const refresh = useCallback(async () => {
    setRecalc((n) => n + 1);
    try { await Promise.all([load(), loadPlanned()]); } finally { setRecalc((n) => n - 1); }
  }, [load, loadPlanned]);

  useEffect(() => {
    const t = setTimeout(() => { void load(); void loadPlanned(); }, 0);
    return () => clearTimeout(t);
  }, [load, loadPlanned]);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  // ---- цель года: ответ PUT/DELETE сразу кладём в данные плана ----
  const setGoal = useCallback((goal: RoadmapResponse['goal']) => {
    const cur = dataRef.current;
    if (!cur) return;
    const next = { ...cur, goal };
    dataRef.current = next;
    setData(next);
  }, []);

  // ---- настройки ----
  const apply = useCallback(async (year: number, hours: number) => {
    const first = !dataRef.current?.settings.configured;
    setApplying(true);
    try {
      await putSettings(year, hours);
      await load(); // часы в неделю пересчитывают план
      toast({ text: first ? 'План составлен' : 'План пересчитан' });
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось сохранить настройки. ${e instanceof ApiError && e.status === 400 ? 'Проверь значения.' : 'Повтори'}`, action: { label: 'Повторить', run: () => void latest.current?.apply(year, hours) } });
    } finally {
      setApplying(false);
    }
  }, [load, toast]);

  // ---- порядок очереди: оптимистично, debounce 500 мс, запросы по очереди, уходит последний порядок ----
  const flush = useCallback(async (): Promise<void> => {
    if (inflight.current) return;
    const keys = pendingOrder.current;
    if (!keys) return;
    inflight.current = true;
    pendingOrder.current = null;
    let failed = false;
    try {
      await putOrder(orderGameIds(keys));
    } catch (err) {
      failed = true;
      if (err instanceof ApiError && err.status === 400) void latest.current?.load(); // игра исчезла: перезапрос плана
    }
    inflight.current = false;
    if (pendingOrder.current) return latest.current?.flush();
    if (failed) {
      failedOrder.current = keys;
      setSaveState('error');
      toast({ kind: 'error', text: 'Не удалось сохранить порядок. Повтори', action: { label: 'Повторить', run: () => { pendingOrder.current = failedOrder.current; setSaveState('saving'); void latest.current?.flush(); } } });
      return;
    }
    setSaveState('saved');
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000);
    setRecalc((n) => n + 1);
    try {
      await load();
    } finally {
      setRecalc((n) => n - 1);
    }
    if (!pendingOrder.current && !inflight.current) setOrder(null);
  }, [load, toast]);

  // полный порядок g:* (включая скрытые not_fit): в PUT уходит он, а не только видимая часть (контракт 17.8)
  const fullKeysRef = useRef<string[]>([]);
  const reorder = useCallback((visibleKeys: string[]) => {
    const keys = mergeVisibleOrder(fullKeysRef.current, visibleKeys);
    setOrder(keys);
    pendingOrder.current = keys;
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [flush]);

  const retrySave = useCallback(() => {
    pendingOrder.current = failedOrder.current;
    setSaveState('saving');
    void flush();
  }, [flush]);

  // ---- релизы ----
  const addPlanned = useCallback(async (body: PlannedBody) => {
    await postPlanned(body);
    toast({ text: 'Игра добавлена в план' });
    void refresh();
  }, [refresh, toast]);

  const patchGame = useCallback(async (id: number, patch: Partial<Omit<PlannedBody, 'externalSource' | 'externalId'>>): Promise<void> => {
    try {
      const r = await patchPlanned(id, patch);
      setAllPlanned((l) => (l ? sortPlanned(l.map((g) => (g.id === id ? r.planned : g))) : l));
      void refresh();
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось сохранить. ${mutationError(e)}`, action: { label: 'Повторить', run: () => void latest.current?.patchGame(id, patch).catch(() => {}) } });
      throw e;
    }
  }, [refresh, toast]);

  const removeGame = useCallback(async (g: PlannedGameDto): Promise<void> => {
    try {
      await deletePlanned(g.id);
    } catch (e) {
      toast({ kind: 'error', text: `Не удалось удалить. ${mutationError(e)}` });
      throw e;
    }
    setAllPlanned((l) => l?.filter((x) => x.id !== g.id) ?? l);
    void refresh();
    toast({
      text: 'Игра удалена из плана', ttl: 8000,
      action: {
        label: 'Отменить',
        run: () => {
          postPlanned(recreateBody(g)).then(() => { void refresh(); toast({ text: 'Игра возвращена в план' }); })
            .catch((e: unknown) => toast({ kind: 'error', text: `Не удалось вернуть игру. ${mutationError(e)}` }));
        },
      },
    });
  }, [refresh, toast]);

  const saveNeedHours = useCallback(async (key: string, hours: number): Promise<void> => {
    if (key.startsWith('g:')) await patchDuration(Number(key.slice(2)), hours);
    else await patchPlanned(Number(key.slice(2)), { hoursManual: hours });
    toast({ text: 'Часы сохранены' });
    await refresh();
  }, [refresh, toast]);

  // ---- «Убрать из плана» / «Не распределено» ----
  type PlanRef = Pick<RoadmapEntry, 'gameId' | 'plannedId' | 'title'>;
  const restoreToPlan = useCallback(async (e: PlanRef, announce = true): Promise<void> => {
    try {
      if (e.gameId !== null) await deleteExclusion(e.gameId);
      else { const r = await patchPlanned(e.plannedId as number, { status: 'planned' }); setAllPlanned((l) => l?.map((g) => (g.id === r.planned.id ? r.planned : g)) ?? l); }
    } catch (err) {
      toast({ kind: 'error', text: `Не удалось вернуть в план. ${mutationError(err)}` });
      throw err;
    }
    if (announce) toast({ text: 'Игра возвращена в план' });
    await refresh();
  }, [refresh, toast]);

  const removeFromPlan = useCallback(async (e: PlanRef): Promise<void> => {
    try {
      if (e.gameId !== null) await postExclusion(e.gameId);
      else { const r = await patchPlanned(e.plannedId as number, { status: 'unallocated' }); setAllPlanned((l) => l?.map((g) => (g.id === r.planned.id ? r.planned : g)) ?? l); }
    } catch (err) {
      toast({ kind: 'error', text: `Не удалось убрать из плана. ${mutationError(err)}` });
      return;
    }
    const before = dataRef.current?.notFit.length ?? 0;
    await refresh();
    const after = dataRef.current?.notFit.length ?? 0;
    toast({ text: removedToast(before, after), action: { label: 'Отменить', run: () => void restoreToPlan(e, false).catch(() => {}) } });
  }, [refresh, restoreToPlan, toast]);

  const deleteUnallocated = useCallback(async (e: RoadmapEntry): Promise<void> => {
    try {
      await deletePlanned(e.plannedId as number);
      setAllPlanned((l) => l?.filter((g) => g.id !== e.plannedId) ?? l);
    } catch (err) {
      toast({ kind: 'error', text: `Не удалось удалить. ${mutationError(err)}` });
      throw err;
    }
    toast({ text: 'Игра удалена' });
    await refresh();
  }, [refresh, toast]);

  // ---- предстоящие релизы: добавление без перезагрузки списка каталога ----
  const addUpcoming = useCallback(async (c: UpcomingCandidate): Promise<PlannedGameDto> => {
    const r = await postPlanned(upcomingBody(c));
    setAllPlanned((l) => sortPlanned([...(l ?? []).filter((g) => g.id !== r.planned.id), r.planned]));
    void refresh();
    return r.planned;
  }, [refresh]);
  const restoreUpcoming = useCallback(async (plannedId: number): Promise<void> => {
    const r = await patchPlanned(plannedId, { status: 'planned' });
    setAllPlanned((l) => l?.map((g) => (g.id === r.planned.id ? r.planned : g)) ?? l);
    void refresh();
  }, [refresh]);

  // ---- «Поставить на позицию N» для не влезшей игры (контракт 17.15: insertAt среди всех g:* очереди) ----
  const moveToPosition = useCallback(async (e: RoadmapEntry, at: number): Promise<void> => {
    if (moving.current) return; // порядок меняется по одному: следующий считается от обновлённого плана
    moving.current = true;
    setMoving(true);
    try {
    const next = orderWithAtPosition(fullKeysRef.current, e.key, at);
    const before = dataRef.current?.notFit.length ?? 0;
    try {
      await putOrder(orderGameIds(next));
    } catch (err) {
      toast({ kind: 'error', text: `Не удалось поставить на позицию. ${mutationError(err)}` });
      if (err instanceof ApiError && err.status === 400) void refresh(); // игра исчезла или изменилась: список устарел
      throw err;
    }
    setOrder(null);
    await refresh();
    const after = dataRef.current?.notFit.length ?? 0;
    const still = dataRef.current?.notFit.some((x) => x.key === e.key);
    toast({ text: still ? `Не влезла и на позиции ${at}: осталась в «Не успеваю», часы обновлены` : placedToast(at, before, after) });
    } finally {
      moving.current = false;
      setMoving(false);
    }
  }, [refresh, toast]);

  const focusNeed = useCallback((key: string) => {
    const li = document.querySelector<HTMLElement>(`[data-rm-need="${key}"]`);
    flashElement(li, li?.querySelector<HTMLElement>('input'));
  }, []);

  useEffect(() => { latest.current = { load, loadPlanned, apply, patchGame, flush }; });

  const extra = useMemo(() => new Map((allPlanned ?? []).map((g) => [`p:${g.id}`, { title: g.title, releaseDate: g.releaseDate }])), [allPlanned]);
  const fullRows = useMemo(() => (data ? applyOrder(buildQueueRows(data), order) : null), [data, order]);
  const rows = useMemo(() => (data ? buildSchedule(data, order) : null), [data, order]);
  useEffect(() => { fullKeysRef.current = (fullRows ?? []).filter((r) => r.movable).map((r) => r.key); }, [fullRows]);
  const recalculating = recalc > 0;
  const today = data?.today ?? new Date().toISOString().slice(0, 10);

  if (error && !data) {
    return (
      <div className="ps-rm-page">
        <div className="ps-pagehead"><h1 className="ps-h1 ps-h1--hdr">План</h1></div>
        <div className="ps-empty" role="alert">
          <span className="ps-empty__icon"><Icon name="circle-alert" size={40} /></span>
          <h2 className="ps-h2">Что-то пошло не так</h2>
          <p className="ps-empty__text">Не удалось загрузить план. Попробуй обновить страницу.</p>
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => { setError(false); void load(); }}>Обновить</button>
        </div>
      </div>
    );
  }

  if (data && !data.settings.configured) {
    return (
      <div className="ps-rm-page">
        <div className="ps-pagehead"><h1 className="ps-h1 ps-h1--hdr">План</h1></div>
        <section className="ps-rm-panel ps-rm-welcome" aria-labelledby="rm-welcome-h">
          <Icon name="roadmap" size={40} />
          <h2 className="ps-h2" id="rm-welcome-h">План на год</h2>
          <p>Укажи год и сколько часов в неделю готов играть: игры из бэклога и релизы встанут на таймлайн по неделям.</p>
          <SettingsPanel settings={data.settings} today={data.today} busy={applying} welcome onApply={(y, h) => void apply(y, h)} />
        </section>
      </div>
    );
  }

  const year = data?.settings.year ?? new Date().getFullYear();
  return (
    <div className="ps-rm-page">
      <div className="ps-pagehead">
        <h1 className="ps-h1 ps-h1--hdr">План</h1>
        <p className="ps-rm-sub ps-rm-sub--head">Неделя с понедельника</p>
      </div>
      <div className="ps-rm" aria-busy={!data || undefined}>
        <section className="ps-rm-panel" data-area="set" aria-labelledby="rm-set-h">
          <h2 className="ps-h2" id="rm-set-h">Настройки плана</h2>
          {data ? <SettingsPanel settings={data.settings} today={data.today} busy={applying} welcome={false} onApply={(y, h) => void apply(y, h)} /> : <div className="ps-skeleton ps-rm-sk-set" aria-hidden="true" />}
        </section>
        <section className="ps-rm-panel" id="rm-goal" data-area="goal" data-tour="roadmap-goal" aria-labelledby="rm-goal-h" aria-busy={!data || undefined}>
          {data ? (
            <GoalPanel goal={data.goal ?? null} year={year} today={data.today} onChanged={setGoal} onSettings={() => document.getElementById('rm-set-h')?.scrollIntoView({ block: 'center' })} />
          ) : <><h2 className="ps-h2" id="rm-goal-h">Цель года</h2><div className="ps-skeleton ps-rm-sk-goal" aria-hidden="true" /></>}
        </section>
        <section className="ps-rm-panel" data-area="prog" aria-label="Прогресс">
          {data ? <ProgressPanel data={data} /> : <><h2 className="ps-h2">Прогресс</h2><div className="ps-skeleton ps-rm-sk-block" aria-hidden="true" /></>}
        </section>
        <section className="ps-rm-panel" data-area="tl" aria-label={`Таймлайн ${year}`}>
          {data ? <TimelinePanel data={data} recalculating={recalculating} extra={extra} /> : <><h2 className="ps-h2">Таймлайн {year}</h2><div className="ps-skeleton ps-rm-sk-tl" aria-hidden="true" /></>}
        </section>
        <section className="ps-rm-panel" id="rm-upcoming" data-area="upc" aria-label="Предстоящие релизы">
          <UpcomingPanel allPlanned={allPlanned} onAdd={addUpcoming} onRestore={restoreUpcoming} />
        </section>
        <section className="ps-rm-panel" id="rm-releases" data-area="rel" aria-label="Релизы">
          <ReleasesPanel
            planned={planned} error={plannedErr} data={data} today={today} year={year} onRetry={() => { setPlannedErr(false); void loadPlanned(); }}
            onAdd={addPlanned} onPatch={patchGame} onRemove={removeGame} onUnallocate={(g) => void removeFromPlan({ gameId: null, plannedId: g.id, title: g.title })}
          />
        </section>
        <section className="ps-rm-panel" id="rm-queue" data-area="queue" aria-label="Очередь бэклога">
          <QueuePanel
            backlogNote={data ? roadmapBacklogText(data.backlogTotal, (data.unallocated ?? []).filter((u) => u.kind === 'backlog').length) : ''}
            rows={rows} conflicts={data?.conflicts ?? []} error={error} loading={recalculating} saveState={saveState}
            onReorder={reorder} onRetry={() => { setError(false); void load(); }} onRetrySave={retrySave} onNeedHours={focusNeed} onRemove={(e) => void removeFromPlan(e)}
          />
        </section>
        {data && data.needHours.length > 0 && (
          <section className="ps-rm-panel" id="rm-need" data-area="need" aria-label="Нужны часы">
            <NeedHoursPanel list={data.needHours} onSave={saveNeedHours} onRemove={(e) => void removeFromPlan(e)} />
          </section>
        )}
        {data && data.notFit.length > 0 && (
          <section className="ps-rm-panel" id="rm-over" data-area="over" aria-label="Не успеваю">
            <OverPanel list={data.notFit} yearEnd={data.range.to} onRemove={(e) => void removeFromPlan(e)} onMoveTo={moveToPosition} locked={moving_} />
          </section>
        )}
        {data && (data.unallocated ?? []).length > 0 && (
          <section className="ps-rm-panel" id="rm-unallocated" data-area="unal" aria-label="Не распределено">
            <UnallocatedPanel list={data.unallocated} onRestore={(e) => restoreToPlan(e)} onDelete={deleteUnallocated} />
          </section>
        )}
        {data && (data.serviceGames ?? []).length > 0 && (
          <section className="ps-rm-panel" id="rm-services" data-area="svc" aria-label="Игры-сервисы">
            <ServicePanel list={data.serviceGames} />
          </section>
        )}
      </div>
    </div>
  );
}
