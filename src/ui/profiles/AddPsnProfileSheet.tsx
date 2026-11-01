'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import '../recommend.css';
import { addProfile, ProfilesApiError, type Profile } from './api';
import { addErrorText, isValidNick, NICK_FORMAT_ERROR } from './model';
import { Spinner } from './Spinner';

export type AddResult = { profile: Profile; activeProfileId: number; restored: boolean; activated: boolean };

type Fail = { text: string; field?: boolean; retry?: boolean; toList?: boolean };

/** Форма добавления профиля PSN (§17.4). Лист без собственного состояния снаружи: каждое открытие начинается с чистой формы. */
export function AddPsnProfileSheet({
  open, onClose, onDone, onLimit,
}: { open: boolean; onClose: () => void; onDone: (r: AddResult) => void; onLimit: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onClose={() => { if (!busy) onClose(); }} title="Добавить PSN-профиль" className="ps-padd">
      <AddForm busy={busy} setBusy={setBusy} onClose={onClose} onDone={onDone} onLimit={onLimit} />
    </Sheet>
  );
}

function AddForm({
  busy, setBusy, onClose, onDone, onLimit,
}: { busy: boolean; setBusy: (b: boolean) => void; onClose: () => void; onDone: (r: AddResult) => void; onLimit: () => void }) {
  const [nick, setNick] = useState('');
  const [touched, setTouched] = useState(false);
  const [activate, setActivate] = useState(true);
  const [fail, setFail] = useState<Fail | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errId = useId();
  const statusId = useId();

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 0); // после фокуса диалога в Sheet
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const valid = isValidNick(nick);
  const formatError = touched && nick.trim() !== '' && !valid ? NICK_FORMAT_ERROR : null;
  const fieldError = formatError ?? (fail?.field ? fail.text : null);
  const bannerError = fail && !fail.field ? fail : null;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (busy || cooldown > 0) return;
    setTouched(true);
    if (!valid) { input.current?.focus(); return; }
    const value = nick.trim();
    setBusy(true);
    setFail(null);
    try {
      const r = await addProfile(value, activate);
      onDone({ profile: r.profile, activeProfileId: r.activeProfileId, restored: r.restored === true, activated: activate });
    } catch (err) {
      const f = err instanceof ProfilesApiError ? err : new ProfilesApiError(0, 'network');
      if (f.status === 401) return;
      const t = addErrorText(f, value);
      setFail(t);
      if (f.code === 'rate_limited' || f.status === 429) setCooldown(f.retryAfterSec ?? 30);
      if (f.code === 'profile_limit') onLimit();
      setBusy(false);
      if (f.code !== 'rate_limited' && f.status !== 429) setTimeout(() => input.current?.focus(), 0);
    }
  }

  const describedBy = [hintId, fieldError ? errId : null].filter(Boolean).join(' ');
  const submitLabel = busy ? 'Проверяю профиль…' : cooldown > 0 ? `Добавить (${cooldown})` : 'Добавить';

  return (
    <form className="ps-padd__form" onSubmit={(e) => void submit(e)} aria-busy={busy || undefined} noValidate>
      <div className="ps-padd__field">
        <label htmlFor={`${hintId}-in`} className="ps-padd__label">Ник в PSN (Online ID)</label>
        <input
          id={`${hintId}-in`} ref={input} className="ps-input" type="text" value={nick} maxLength={16}
          autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={busy}
          aria-invalid={fieldError ? true : undefined} aria-describedby={describedBy}
          onChange={(e) => { setNick(e.target.value); if (fail?.field) setFail(null); }}
          onBlur={() => setTouched(true)}
        />
        <p id={hintId} className="ps-padd__hint">
          Любой открытый PSN-профиль, вы отвечаете за него сами.
          <br />
          Профиль должен быть публичным: в настройках PSN у игр и трофеев должен быть доступ «Все».
        </p>
        {fieldError && (
          <p id={errId} className="ps-field-error ps-padd__err" role="alert"><Icon name="circle-alert" size={14} />{fieldError}</p>
        )}
        {busy && <p id={statusId} className="ps-padd__hint" role="status">Проверяю профиль в PSN. Это занимает несколько секунд.</p>}
      </div>

      <label className="ps-pcheck">
        <input type="checkbox" checked={activate} disabled={busy} onChange={(e) => setActivate(e.target.checked)} />
        <span className="ps-check" data-checked={activate || undefined} aria-hidden="true">{activate && <Icon name="check" size={12} />}</span>
        <span>Сразу открыть этот профиль</span>
      </label>

      {bannerError && (
        <div className="ps-rec-banner ps-padd__banner" role="alert">
          <Icon name="circle-alert" size={16} />
          <span className="ps-padd__bannertx">{bannerError.text}</span>
          {bannerError.retry && <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => void submit()}>Повторить</button>}
          {bannerError.toList && <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={onClose}>Закрыть</button>}
        </div>
      )}

      <div className="ps-padd__acts">
        <button type="submit" className="ps-btn ps-btn--primary ps-padd__submit" disabled={busy || cooldown > 0 || !valid} aria-live="off">
          {busy && <Spinner size={14} />}{submitLabel}
        </button>
        <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={onClose}>Отмена</button>
      </div>
    </form>
  );
}
