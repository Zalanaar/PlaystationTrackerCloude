'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { useToast } from '../primitives/Toast';
import '../recommend.css';
import { AddPsnProfileSheet, type AddResult } from './AddPsnProfileSheet';
import { addProfile, fetchProfiles, ProfilesApiError, type ArchivedProfile, type Profile, type ProfilesList } from './api';
import {
  accessStatusText, addBlockedText, addErrorText, counterText, initialOf, profileMeta, restoreErrorText,
} from './model';
import { ProfileArchive } from './ProfileArchive';
import { ProfilesSkeleton } from './ProfilesSkeleton';
import { usePsnProfiles } from './PsnProfileProvider';
import { UnlinkProfileSheet, type UnlinkMode, type UnlinkResult, type UnlinkTarget } from './UnlinkProfileSheet';

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: ProfilesList };

/** Страница «Профили PSN» (§17.3–17.7). */
export function ProfilesPage() {
  const toast = useToast();
  const { completeSwitch, switchTo, reload: reloadAuth, activeProfileId: headerActive, switching } = usePsnProfiles();
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [now, setNow] = useState(0);
  const [adding, setAdding] = useState(false);
  const [unlink, setUnlink] = useState<{ target: UnlinkTarget; mode: UnlinkMode } | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const acRef = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const archiveRef = useRef<HTMLHeadingElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (silent = false): Promise<ProfilesList | null> => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    if (!silent) setState({ kind: 'loading' });
    try {
      const data = await fetchProfiles(ac.signal);
      if (ac.signal.aborted) return null;
      setNow(Date.now());
      setState({ kind: 'ready', data });
      return data;
    } catch (e) {
      if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return null;
      if (!silent || state.kind !== 'ready') setState({ kind: 'error' });
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); return () => acRef.current?.abort(); }, [load]);

  // шапка знает другой активный профиль, чем список (изменено в другой вкладке): перечитать, сказать об этом
  const staleNotified = useRef(false);
  useEffect(() => {
    if (state.kind !== 'ready' || headerActive === null || switching !== null) return;
    if (state.data.activeProfileId !== headerActive && !staleNotified.current) {
      staleNotified.current = true;
      toast({ text: 'Список профилей обновлён.', kind: 'info' });
      void reloadAuth();
    }
  }, [state, headerActive, switching, toast, reloadAuth]);

  const focusSoon = (fn: () => HTMLElement | null | undefined) => {
    setTimeout(() => { if (alive.current) fn()?.focus(); }, 60);
  };

  const refreshAll = useCallback(async () => {
    const [d] = await Promise.all([load(true), reloadAuth()]);
    return d;
  }, [load, reloadAuth]);

  async function onAdded(r: AddResult) {
    setAdding(false);
    const nick = r.profile.onlineId ?? '';
    if (r.activated) { await completeSwitch(r.activeProfileId, nick); return; }
    toast({ text: r.restored ? `Профиль ${nick} восстановлен из архива, данные на месте` : `Профиль ${nick} добавлен`, kind: 'info' });
    await refreshAll();
    focusSoon(() => document.querySelector<HTMLElement>(`[data-pid="${r.profile.id}"]`));
  }

  async function onUnlinked(r: UnlinkResult) {
    setUnlink(null);
    const prevActive = state.kind === 'ready' ? state.data.activeProfileId : null;
    const nick = r.target.onlineId;
    if (r.mode === 'purge') toast({ text: `Профиль ${nick} удалён`, kind: 'info' });
    else toast({ text: `Профиль ${nick} отвязан. Вернуть можно в течение 30 дней.`, kind: 'info' });
    if (r.activeProfileId !== prevActive) {
      const primary = state.kind === 'ready' ? state.data.profiles.find((p) => p.id === r.activeProfileId)?.onlineId ?? 'PSN' : 'PSN';
      await completeSwitch(r.activeProfileId, primary);
      return;
    }
    const d = await refreshAll();
    focusSoon(() => (d && d.archived.length > 0 ? archiveRef.current : addRef.current) ?? headingRef.current);
  }

  async function onStale(text: string, kind: 'info' | 'alert') {
    setUnlink(null);
    toast({ text, kind: kind === 'alert' ? 'error' : 'info', alert: kind === 'alert' });
    await refreshAll();
  }

  async function restore(a: ArchivedProfile) {
    if (!a.onlineId || restoringId !== null) return;
    setRestoringId(a.id);
    try {
      const r = await addProfile(a.onlineId, false);
      toast({ text: `Профиль ${r.profile.onlineId ?? a.onlineId} возвращён`, kind: 'info' });
      await refreshAll();
      focusSoon(() => document.querySelector<HTMLElement>(`[data-pid="${r.profile.id}"]`));
    } catch (e) {
      if (e instanceof ProfilesApiError && e.status === 401) return;
      const f = e instanceof ProfilesApiError ? e : new ProfilesApiError(0, 'network');
      toast({ text: f.code === 'network' ? addErrorText(f, a.onlineId).text : restoreErrorText(f), kind: 'error', alert: true });
    } finally {
      if (alive.current) setRestoringId(null);
    }
  }

  const header = (count: string | null, locked: boolean) => (
    <header className="ps-plist-head">
      <div className="ps-plist-head__row">
        <h1 ref={headingRef} tabIndex={-1} className="ps-h1">Профили PSN</h1>
        {count && <span className="ps-plist-count num" aria-label={`Профилей: ${count}`}>{locked && <Icon name="lock" size={12} />}{count}</span>}
      </div>
      <p className="ps-plist-lead">Один вход, до 3 профилей PSN. Игры, статусы и статистика у каждого свои.</p>
    </header>
  );

  if (state.kind === 'loading') {
    return (
      <ProfilesSkeleton />
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="ps-pprof">
        {header(null, false)}
        <div className="ps-rec-banner" role="alert">
          <Icon name="circle-alert" size={16} /><span>Не удалось загрузить профили.</span>
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => void load()}><Icon name="refresh" size={14} />Повторить</button>
        </div>
      </div>
    );
  }

  const { data } = state;
  const limit = data.limit;
  const full = data.profiles.length >= limit;
  const blocked = addBlockedText(data.canAdd, data.profiles.length, limit);
  const single = data.profiles.length === 1;

  return (
    <div className="ps-pprof" data-tour-page="profiles" data-tour-ready="true">
      {header(counterText(data.profiles.length, limit), full)}
      <ul className="ps-plist" aria-label="Профили PSN" aria-busy={restoringId !== null || undefined}>
        {data.profiles.map((p) => (
          <ProfileRow
            key={p.id} p={p} active={p.id === data.activeProfileId} onOpen={() => void switchTo(p.id)}
            onUnlink={() => p.onlineId && setUnlink({ target: { id: p.id, onlineId: p.onlineId, active: p.id === data.activeProfileId }, mode: 'unlink' })}
          />
        ))}
      </ul>

      {single && data.canAdd ? (
        <section className="ps-panel ps-pempty" aria-labelledby="ps-pempty-h">
          <Icon name="users" size={32} className="ps-pempty__ico" />
          <h3 id="ps-pempty-h" className="ps-h3">Один профиль PSN</h3>
          <p>Можно добавить ещё до двух профилей, например аккаунт друга или семьи. У каждого свои игры и статистика.</p>
          <button ref={addRef} type="button" className="ps-btn ps-btn--primary ps-padd-open" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />Добавить PSN-профиль
          </button>
        </section>
      ) : (
        <div className="ps-padd-wrap">
          <button
            ref={addRef} type="button" className="ps-btn ps-btn--primary ps-padd-open" disabled={!data.canAdd}
            aria-disabled={!data.canAdd} aria-describedby={blocked ? 'ps-padd-why' : undefined} onClick={() => setAdding(true)}
          >
            <Icon name="plus" size={16} />Добавить PSN-профиль
          </button>
          {blocked && <p id="ps-padd-why" className="ps-padd-why">{blocked}</p>}
        </div>
      )}

      <ProfileArchive
        ref={archiveRef} items={data.archived} nowMs={now} busyId={restoringId} disabled={restoringId !== null}
        onRestore={(a) => void restore(a)}
        onPurge={(a) => a.onlineId && setUnlink({ target: { id: a.id, onlineId: a.onlineId, active: false }, mode: 'purge' })}
      />

      <AddPsnProfileSheet
        open={adding} onClose={() => setAdding(false)} onDone={(r) => void onAdded(r)}
        onLimit={() => { void load(true); }}
      />
      <UnlinkProfileSheet
        target={unlink?.target ?? null} mode={unlink?.mode ?? 'unlink'} onClose={() => setUnlink(null)}
        onDone={(r) => void onUnlinked(r)} onStale={(t, k) => void onStale(t, k)}
      />
    </div>
  );
}

function ProfileRow({ p, active, onOpen, onUnlink }: { p: Profile; active: boolean; onOpen: () => void; onUnlink: () => void }) {
  const nick = p.onlineId ?? 'Без ника';
  const problem = accessStatusText(p.accessStatus);
  const lockId = `ps-plock-${p.id}`;
  return (
    <li className="ps-panel ps-plist__item" data-pid={p.id} data-active={active || undefined} aria-current={active ? 'true' : undefined} aria-describedby={p.isPrimary ? lockId : undefined} tabIndex={-1}>
      <span className="ps-plist__ini" aria-hidden="true">{initialOf(p.onlineId)}</span>
      <div className="ps-plist__main">
        <div className="ps-plist__top">
          <b className="ps-plist__nick" title={nick}>{nick}</b>
          {p.isPrimary && <span className="ps-plist__pill">Основной</span>}
          {active && <span className="ps-plist__pill ps-plist__pill--now"><Icon name="check" size={12} />Открыт сейчас</span>}
        </div>
        <small className="ps-plist__meta">{profileMeta(p.gamesCount, p.lastSyncAt)}</small>
        {problem && <p className="ps-plist__problem"><Icon name="circle-alert" size={14} />{problem}</p>}
      </div>
      <div className="ps-plist__acts">
        {!active && <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" aria-label={`Открыть профиль ${nick}`} onClick={onOpen}>Открыть</button>}
        {!p.isPrimary && (
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm ps-btn--danger" aria-label={`Отвязать профиль ${nick}`} onClick={onUnlink}>
            <Icon name="unlink" size={14} />Отвязать
          </button>
        )}
        {p.isPrimary && <small id={lockId} className="ps-plist__lock"><Icon name="lock" size={12} />Основной профиль нельзя отвязать</small>}
      </div>
    </li>
  );
}
