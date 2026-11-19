'use client';

// Живая подписка на календарь релизов: личная ссылка с ключом (в БД только хэш, поэтому ссылка видна один раз — сразу после выпуска).
// webcal:// открывает «Подписаться» в Календаре iPhone; «Скопировать» — для Google/Outlook. «Новая ссылка» отключает старую.
import { useEffect, useId, useState } from 'react';
import { Icon } from '../icons';
import './calendar.css';
import { fetchCalendarFeed, issueCalendarFeed, mutationError, revokeCalendarFeed, type CalendarFeedState } from './api';

const dateRu = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' });

export function CalendarSubscribe() {
  const id = useId();
  const [state, setState] = useState<CalendarFeedState | null>(null);
  const [url, setUrl] = useState<string | null>(null); // https-ссылка, только что выпущенная
  const [confirm, setConfirm] = useState<'regen' | 'off' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const ac = new AbortController();
    fetchCalendarFeed(ac.signal).then(setState, () => { if (!ac.signal.aborted) setState({ active: false, createdAt: null }); });
    return () => ac.abort();
  }, []);

  async function issue() {
    setBusy(true); setMsg('');
    try {
      const r = await issueCalendarFeed();
      setState({ active: true, createdAt: r.createdAt });
      setUrl(`${location.protocol}//${location.host}${r.path}`);
      setConfirm(null);
      setMsg('Ссылка готова.');
    } catch (e) { setMsg(mutationError(e)); } finally { setBusy(false); }
  }
  async function revoke() {
    setBusy(true); setMsg('');
    try {
      setState(await revokeCalendarFeed());
      setUrl(null); setConfirm(null);
      setMsg('Подписка отключена: календарь перестанет получать обновления.');
    } catch (e) { setMsg(mutationError(e)); } finally { setBusy(false); }
  }
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setMsg('Ссылка скопирована.'); } catch {
      const el = document.getElementById(`${id}-url`) as HTMLInputElement | null;
      el?.select(); setMsg('Выдели ссылку и скопируй вручную.');
    }
  }

  return (
    <div className="ps-rm-cal" data-testid="rm-cal">
      <h3 className="ps-rm-cal__t"><Icon name="calendar" size={14} />Подписка на календарь</h3>
      {url ? (
        <>
          <a className="ps-btn ps-btn--primary ps-btn--sm" href={url.replace(/^https?:/, 'webcal:')} data-testid="rm-cal-webcal">
            <Icon name="calendar-plus" size={14} />Подписаться в Календаре
          </a>
          <div className="ps-rm-cal__url">
            <input id={`${id}-url`} aria-label="Ссылка на подписку" className="ps-input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} data-testid="rm-cal-url" />
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => void copy()} data-testid="rm-cal-copy">Скопировать</button>
          </div>
          <small>Ссылка показывается один раз — сохрани её. Не делись ею: по ней видны названия и даты твоих релизов.</small>
        </>
      ) : state?.active ? (
        <p className="ps-rm-cal__state" data-testid="rm-cal-on">Подписка включена{state.createdAt ? ` с ${dateRu(state.createdAt)}` : ''}.</p>
      ) : (
        <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" disabled={busy || state === null} onClick={() => void issue()} data-testid="rm-cal-issue">
          <Icon name="calendar-plus" size={14} />Подписаться на релизы
        </button>
      )}
      {state?.active && (
        confirm ? (
          <div className="ps-rm-cal__btns" role="group" aria-label={confirm === 'regen' ? 'Создать новую ссылку' : 'Отключить подписку'}>
            <small>{confirm === 'regen' ? 'Старая ссылка перестанет работать.' : 'Календарь перестанет получать обновления.'}</small>
            <button type="button" className="ps-btn ps-btn--danger ps-btn--sm" disabled={busy} onClick={() => void (confirm === 'regen' ? issue() : revoke())} data-testid="rm-cal-confirm">
              {confirm === 'regen' ? 'Создать' : 'Отключить'}
            </button>
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" disabled={busy} onClick={() => setConfirm(null)}>Отмена</button>
          </div>
        ) : (
          <div className="ps-rm-cal__btns">
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => setConfirm('regen')} data-testid="rm-cal-regen">Новая ссылка</button>
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => setConfirm('off')} data-testid="rm-cal-off">Отключить</button>
          </div>
        )
      )}
      <small>Подписка обновляется сама: новые релизы и перенесённые даты появятся в календаре без повторного импорта (обычно в течение нескольких часов). В ленте только названия и даты выхода — без заметок и цен.</small>
      <p className="ps-rm-cal__msg" role="status" aria-live="polite" data-testid="rm-cal-msg">{msg}</p>
    </div>
  );
}
