'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../icons';
import { Sheet } from '../primitives/Sheet';
import '../recommend.css';
import { ProfilesApiError, unlinkProfile } from './api';
import { nickMatches, unlinkErrorText } from './model';
import { Spinner } from './Spinner';

export type UnlinkMode = 'unlink' | 'purge';
export type UnlinkTarget = { id: number; onlineId: string; active: boolean };
export type UnlinkResult = { mode: UnlinkMode; target: UnlinkTarget; activeProfileId: number };

/** Отвязка (архив на 30 дней) и «Удалить сразу» (§17.5, §17.6): подтверждение вводом ника. */
export function UnlinkProfileSheet({
  target, mode, onClose, onDone, onStale,
}: {
  target: UnlinkTarget | null; mode: UnlinkMode; onClose: () => void;
  onDone: (r: UnlinkResult) => void;
  /** профиль уже отвязан/удалён или изменился (not_found, primary_protected): страница перечитывает список и показывает тост */
  onStale: (text: string, kind: 'info' | 'alert') => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open={target !== null} onClose={() => { if (!busy) onClose(); }} className="ps-padd"
      title={target ? (mode === 'purge' ? `Удалить профиль ${target.onlineId} насовсем?` : `Отвязать профиль ${target.onlineId}?`) : ''}
    >
      {target && <UnlinkForm target={target} mode={mode} busy={busy} setBusy={setBusy} onClose={onClose} onDone={onDone} onStale={onStale} />}
    </Sheet>
  );
}

function UnlinkForm({
  target, mode, busy, setBusy, onClose, onDone, onStale,
}: {
  target: UnlinkTarget; mode: UnlinkMode; busy: boolean; setBusy: (b: boolean) => void; onClose: () => void;
  onDone: (r: UnlinkResult) => void; onStale: (text: string, kind: 'info' | 'alert') => void;
}) {
  const purge = mode === 'purge';
  const [typed, setTyped] = useState('');
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const match = nickMatches(typed, target.onlineId);

  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!match || busy) return;
    setBusy(true);
    setFieldErr(null);
    setBanner(null);
    try {
      const r = await unlinkProfile(target.id, typed.trim(), purge);
      onDone({ mode, target, activeProfileId: r.activeProfileId });
    } catch (err) {
      setBusy(false);
      const f = err instanceof ProfilesApiError ? err : new ProfilesApiError(0, 'network');
      if (f.status === 401) return;
      const t = unlinkErrorText(f, target.onlineId, purge);
      if (t.close) { onStale(t.text, 'alert'); return; }
      if (t.reload) { onStale(t.text, 'alert'); return; }
      if (t.field) setFieldErr(t.text); else setBanner(t.text);
      setTimeout(() => input.current?.focus(), 0);
    }
  }

  const label = purge ? 'Удалить насовсем' : 'Отвязать';
  return (
    <form className="ps-padd__form" onSubmit={(e) => void submit(e)} aria-busy={busy || undefined} noValidate>
      {purge ? (
        <p className="ps-padd__text">Игры, статусы и трофеи этого профиля удалятся без возможности вернуть.</p>
      ) : (
        <>
          <p className="ps-padd__text">
            Профиль уйдёт из переключателя и синка. Игры, статусы и трофеи останутся в архиве 30 дней, за это время профиль можно вернуть. Потом данные удалятся.
          </p>
          {target.active && <p className="ps-padd__text ps-padd__text--strong">Сейчас он открыт. После отвязки откроется основной профиль.</p>}
        </>
      )}
      <div className="ps-padd__field">
        <label htmlFor={`${id}-in`} className="ps-padd__label">Введите ник профиля, чтобы подтвердить: <strong>{target.onlineId}</strong></label>
        <input
          id={`${id}-in`} ref={input} className="ps-input" type="text" value={typed} autoComplete="off" autoCapitalize="off" spellCheck={false}
          disabled={busy} aria-invalid={fieldErr ? true : undefined} aria-describedby={fieldErr ? `${id}-err` : `${id}-hint`}
          onChange={(e) => { setTyped(e.target.value); setFieldErr(null); }}
        />
        {fieldErr && <p id={`${id}-err`} className="ps-field-error ps-padd__err" role="alert"><Icon name="circle-alert" size={14} />{fieldErr}</p>}
      </div>
      {banner && (
        <div className="ps-rec-banner ps-padd__banner" role="alert">
          <Icon name="circle-alert" size={16} /><span className="ps-padd__bannertx">{banner}</span>
        </div>
      )}
      <div className="ps-padd__acts">
        <button type="submit" className="ps-btn ps-btn--danger ps-padd__submit" disabled={!match || busy} aria-describedby={`${id}-hint`}>
          {busy ? <Spinner size={14} /> : <Icon name={purge ? 'trash' : 'unlink'} size={14} />}
          {busy ? (purge ? 'Удаляю…' : 'Отвязываю…') : label}
        </button>
        <button type="button" className="ps-btn ps-btn--ghost" disabled={busy} onClick={onClose}>Отмена</button>
      </div>
      <p id={`${id}-hint`} className="ps-padd__hint">{match ? ' ' : 'Введите ник, чтобы включить кнопку'}</p>
    </form>
  );
}
