'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { formatDate, formatNumber } from '../format';
import { Icon } from '../icons';
import { NotFound } from '../NotFound';
import { Sheet } from '../primitives/Sheet';
import { useToast } from '../primitives/Toast';
import { SkRoot } from '../skeletons';
import { addAccessUser, AccessApiError, deleteAccessUser, fetchAccessUsers, setAccessStatus, type AccessUser } from './api';
import { accessErrorText, confirmMatches, isEmailLike, psnStatusLabel, roleLabel, rowActions, statusLabel } from './model';

type Load = { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'forbidden' } | { kind: 'ready'; users: AccessUser[] };

const errText = (e: unknown) => (e instanceof AccessApiError ? accessErrorText(e.status, e.code) : accessErrorText(0, 'network'));

export function AccessView() {
  const toast = useToast();
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [del, setDel] = useState<AccessUser | null>(null);
  const [typed, setTyped] = useState('');
  const [delError, setDelError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const acRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    fetchAccessUsers(ac.signal).then(
      (users) => { if (!ac.signal.aborted) setState({ kind: 'ready', users }); },
      (e: unknown) => {
        if (ac.signal.aborted) return;
        if (e instanceof AccessApiError && (e.status === 403 || e.status === 404)) setState({ kind: 'forbidden' });
        else setState({ kind: 'error', text: errText(e) });
      },
    );
  }, []);
  useEffect(() => { load(); return () => acRef.current?.abort(); }, [load]);

  const patchUser = (u: AccessUser) =>
    setState((s) => (s.kind === 'ready' ? { kind: 'ready', users: s.users.map((x) => (x.id === u.id ? u : x)) } : s));

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!isEmailLike(email)) { setFormError(accessErrorText(400, 'invalid_request')); return; }
    setAdding(true);
    setFormError(null);
    try {
      const { user } = await addAccessUser(email.trim());
      setState((s) => (s.kind === 'ready' ? { kind: 'ready', users: [...s.users, user] } : s));
      setEmail('');
      toast({ text: 'Участник добавлен. Пусть войдёт через Google.', kind: 'info' });
    } catch (err) {
      setFormError(errText(err));
    } finally {
      setAdding(false);
    }
  }

  async function onToggle(u: AccessUser, to: 'active' | 'blocked') {
    setBusyId(u.id);
    setRowError(null);
    try {
      const { user } = await setAccessStatus(u.id, to);
      patchUser(user);
      toast({ text: to === 'blocked' ? 'Участник заблокирован. Сессии закрыты.' : 'Участник разблокирован.', kind: 'info' });
    } catch (err) {
      setRowError(errText(err));
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete() {
    if (!del) return;
    setDeleting(true);
    setDelError(null);
    try {
      await deleteAccessUser(del.id, typed.trim());
      const id = del.id;
      setState((s) => (s.kind === 'ready' ? { kind: 'ready', users: s.users.filter((x) => x.id !== id) } : s));
      setDel(null);
      toast({ text: 'Участник и его данные удалены.', kind: 'info' });
    } catch (err) {
      setDelError(errText(err));
    } finally {
      setDeleting(false);
    }
  }

  if (state.kind === 'forbidden') return <NotFound />;

  return (
    <div className="ps-access">
      <h1 className="ps-h1">Доступ</h1>
      <p className="ps-access__lead">Вход только для email из этого списка, через Google. У каждого участника своя коллекция.</p>

      <form className="ps-access__add" onSubmit={(e) => void onAdd(e)} noValidate>
        <label className="ps-access__field">
          <span className="ps-micro">Добавить email</span>
          <input
            type="email" inputMode="email" autoComplete="off" maxLength={254} placeholder="name@gmail.com"
            className="ps-input" value={email} onChange={(e) => setEmail(e.target.value)}
            aria-invalid={formError ? true : undefined} aria-describedby={formError ? 'access-add-err' : undefined}
          />
        </label>
        <button type="submit" className="ps-btn ps-btn--primary" disabled={adding || email.trim() === ''}>
          <Icon name="plus" size={16} />Добавить
        </button>
        {formError && <p id="access-add-err" role="alert" className="ps-access__err">{formError}</p>}
      </form>

      {rowError && <p role="alert" className="ps-access__err">{rowError}</p>}

      {state.kind === 'loading' && (
        <SkRoot className="ps-access__list">
          {[0, 1, 2].map((i) => <span key={i} className="ps-skeleton ps-access__sk" />)}
        </SkRoot>
      )}

      {state.kind === 'error' && (
        <div className="ps-empty" role="alert">
          <span className="ps-empty__icon"><Icon name="circle-alert" size={40} /></span>
          <h2 className="ps-h2">Список не загрузился</h2>
          <p className="ps-empty__text">{state.text}</p>
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => { setState({ kind: 'loading' }); load(); }}>Повторить</button>
        </div>
      )}

      {state.kind === 'ready' && (
        <ul className="ps-access__list" aria-label="Участники">
          {state.users.map((u) => {
            const act = rowActions(u);
            const busy = busyId === u.id;
            return (
              <li key={u.id} className="ps-access__row" data-testid="access-row" data-status={u.status}>
                <div className="ps-access__who">
                  <b className="ps-access__email" title={u.email}>{u.email}</b>
                  {u.displayName && <small>{u.displayName}</small>}
                </div>
                <div className="ps-access__badges">
                  <span className="ps-access__pill" data-kind={u.role}>{roleLabel(u.role)}</span>
                  <span className="ps-access__pill" data-kind={u.status}>{statusLabel(u.status)}</span>
                </div>
                <dl className="ps-access__meta">
                  <div><dt>PSN</dt><dd>{u.psnOnlineId ? `${u.psnOnlineId}, ` : ''}{psnStatusLabel(u.psnAccessStatus)}</dd></div>
                  <div><dt>Последний вход</dt><dd className="num">{formatDate(u.lastLoginAt) ?? 'не входил'}</dd></div>
                  <div><dt>Игр</dt><dd className="num">{formatNumber(u.gamesCount)}</dd></div>
                </dl>
                <div className="ps-access__acts">
                  {act.toggle && (
                    <button
                      type="button" className="ps-btn ps-btn--sm" disabled={busy}
                      onClick={() => void onToggle(u, act.toggle === 'block' ? 'blocked' : 'active')}
                    >{act.toggle === 'block' ? 'Заблокировать' : 'Разблокировать'}<span className="ps-sr"> {u.email}</span></button>
                  )}
                  {act.canDelete && (
                    <button
                      type="button" className="ps-btn ps-btn--sm ps-btn--danger" disabled={busy}
                      onClick={() => { setDel(u); setTyped(''); setDelError(null); }}
                    >Удалить<span className="ps-sr"> {u.email}</span></button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={del !== null} onClose={() => !deleting && setDel(null)} title="Удалить участника">
        {del && (
          <form className="ps-stack" onSubmit={(e) => { e.preventDefault(); void onDelete(); }}>
            <p className="ps-sheet__sub">
              Участник {del.email} и вся его коллекция будут удалены безвозвратно. Для подтверждения введите его email.
            </p>
            <input
              type="email" autoComplete="off" className="ps-input" aria-label="Email для подтверждения" placeholder={del.email}
              value={typed} onChange={(e) => setTyped(e.target.value)}
            />
            {delError && <p role="alert" className="ps-access__err">{delError}</p>}
            <div className="ps-access__acts">
              <button type="button" className="ps-btn ps-btn--ghost" onClick={() => setDel(null)} disabled={deleting}>Отмена</button>
              <button type="submit" className="ps-btn ps-btn--danger" disabled={deleting || !confirmMatches(typed, del.email)}>Удалить навсегда</button>
            </div>
          </form>
        )}
      </Sheet>
    </div>
  );
}
