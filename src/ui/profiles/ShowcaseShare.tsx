'use client';

// П14.3 «Публичная витрина» на /profiles: по умолчанию закрыта. «Открыть» выпускает ссылку с ключом (видна один раз — в базе только хэш),
// «Новая ссылка» отключает прежнюю, «Закрыть витрину» — ссылка перестаёт работать. Витрина — открытого сейчас профиля.
import { useEffect, useId, useState } from 'react';
import { Icon } from '../icons';
import { closeShowcase, fetchShowcase, openShowcase, type ShowcaseState } from './api';

const dateRu = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' });

export function ShowcaseShare({ nick }: { nick: string }) {
  const id = useId();
  const [state, setState] = useState<ShowcaseState | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'regen' | 'close' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const ac = new AbortController();
    fetchShowcase(ac.signal).then(setState, () => { if (!ac.signal.aborted) setState({ open: false, createdAt: null }); });
    return () => ac.abort();
  }, []);

  async function open() {
    setBusy(true); setMsg('');
    try {
      const r = await openShowcase();
      setState({ open: true, createdAt: r.createdAt });
      setUrl(`${location.protocol}//${location.host}${r.path}`);
      setConfirm(null);
      setMsg('Витрина открыта. Ссылка ниже.');
    } catch { setMsg('Не удалось открыть витрину. Попробуй ещё раз.'); } finally { setBusy(false); }
  }
  async function close() {
    setBusy(true); setMsg('');
    try {
      setState(await closeShowcase());
      setUrl(null); setConfirm(null);
      setMsg('Витрина закрыта: ссылка больше не работает.');
    } catch { setMsg('Не удалось закрыть витрину. Попробуй ещё раз.'); } finally { setBusy(false); }
  }
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setMsg('Ссылка скопирована.'); } catch {
      (document.getElementById(`${id}-url`) as HTMLInputElement | null)?.select();
      setMsg('Выдели ссылку и скопируй вручную.');
    }
  }

  return (
    <section className="ps-psc" aria-labelledby={`${id}-h`} data-testid="psc">
      <h2 id={`${id}-h`} className="ps-h3">Публичная витрина</h2>
      <p className="ps-psc__lead">Страница по ссылке для друзей: ник <b>{nick}</b>, общие цифры, игры с наибольшим числом часов и недавно пройденные. Без заметок, цен, тегов и почты; поисковики её не индексируют.</p>
      {url ? (
        <>
          <div className="ps-psc__url">
            <input id={`${id}-url`} aria-label="Ссылка на витрину" className="ps-input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} data-testid="psc-url" />
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => void copy()} data-testid="psc-copy">Скопировать</button>
          </div>
          <a className="ps-btn ps-btn--ghost ps-btn--sm ps-psc__open" href={url} target="_blank" rel="noopener noreferrer" data-testid="psc-view">
            Посмотреть витрину<Icon name="external-link" size={14} />
          </a>
          <small className="ps-psc__note">Ссылка показывается один раз — сохрани её. Любой, у кого она есть, увидит витрину, пока ты её не закроешь.</small>
        </>
      ) : state?.open ? (
        <p className="ps-psc__state" data-testid="psc-on">Витрина открыта{state.createdAt ? ` с ${dateRu(state.createdAt)}` : ''}.</p>
      ) : (
        <>
          <p className="ps-psc__state" data-testid="psc-off">Сейчас закрыта: её никто не видит.</p>
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" disabled={busy || state === null} onClick={() => void open()} data-testid="psc-open">Открыть витрину</button>
        </>
      )}
      {state?.open && (
        confirm ? (
          <div className="ps-psc__btns" role="group" aria-label={confirm === 'regen' ? 'Новая ссылка' : 'Закрыть витрину'}>
            <small className="ps-psc__note">{confirm === 'regen' ? 'Старая ссылка перестанет работать.' : 'Ссылка перестанет работать, витрину никто не увидит.'}</small>
            <button type="button" className="ps-btn ps-btn--danger ps-btn--sm" disabled={busy} onClick={() => void (confirm === 'regen' ? open() : close())} data-testid="psc-confirm">
              {confirm === 'regen' ? 'Создать' : 'Закрыть'}
            </button>
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" disabled={busy} onClick={() => setConfirm(null)}>Отмена</button>
          </div>
        ) : (
          <div className="ps-psc__btns">
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => setConfirm('regen')} data-testid="psc-regen">Новая ссылка</button>
            <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={() => setConfirm('close')} data-testid="psc-close">Закрыть витрину</button>
          </div>
        )
      )}
      <p className="ps-psc__msg" role="status" aria-live="polite" data-testid="psc-msg">{msg}</p>
    </section>
  );
}
