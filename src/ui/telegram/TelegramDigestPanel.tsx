'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import {
  POLL_MS, STATUS_ICON, STATUS_TEXT, STATUS_TONE, captionFor, countdownText, createErrorText, deriveView, remainingMs,
  type LocalCode, type TelegramStatus,
} from './model';

const json = { 'Content-Type': 'application/json' };

/** Блок «Сводка в Telegram» (Фаза 29). Монтируется вместе с панелью синка; опрос останавливается при размонтировании и в скрытой вкладке. */
export function TelegramDigestPanel() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [code, setCode] = useState<LocalCode | null>(null);
  const [createFailed, setCreateFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  const wasPending = useRef(false);

  const load = useCallback(async (): Promise<TelegramStatus | null> => {
    try {
      const res = await fetch('/api/me/telegram', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error('bad');
      if (!alive.current) return null;
      setStatus(body.data as TelegramStatus);
      setLoadError(false);
      return body.data as TelegramStatus;
    } catch {
      if (alive.current) setLoadError(true);
      return null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const t = setTimeout(() => void load(), 0);
    return () => { alive.current = false; clearTimeout(t); };
  }, [load]);

  const view = deriveView(status, code, createFailed !== null, now);
  const pending = view === 'pending';
  const expiresAt = code?.expiresAt ?? status?.pendingCode?.expiresAt ?? null;

  // Таймер до истечения (1 с) только пока код ждёт.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pending]);

  // Опрос статуса пока код ждёт привязки; в скрытой вкладке пропускаем.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [pending, load]);

  // Привязка подтверждена: код больше не нужен.
  useEffect(() => {
    if (pending) { wasPending.current = true; return; }
    if (wasPending.current && (view === 'linked' || view === 'linked_owner')) {
      wasPending.current = false;
      setCode(null);
      setNotice('Telegram привязан.');
    }
  }, [pending, view]);

  async function createCode() {
    setBusy(true);
    setCreateFailed(null);
    setNotice(null);
    setCopied(false);
    try {
      const res = await fetch('/api/me/telegram/link', { method: 'POST', headers: json, body: '{}' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok || typeof body.data?.code !== 'string') {
        setCreateFailed(createErrorText(res.status));
        if (res.status === 503) void load();
        return;
      }
      setCode({ code: body.data.code, expiresAt: body.data.expiresAt, deepLink: body.data.deepLink ?? null });
      setNow(Date.now());
      await load();
    } catch {
      setCreateFailed(createErrorText(0));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function removeLink() {
    setBusy(true);
    try {
      const res = await fetch('/api/me/telegram', { method: 'DELETE' });
      if (res.ok) {
        setConfirming(false);
        setCode(null);
        wasPending.current = false;
        setNotice('Сводка отключена.');
        await load();
      } else setNotice('Не получилось отключить. Попробуй ещё раз.');
    } catch {
      setNotice('Не получилось отключить. Попробуй ещё раз.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function cancelCode() {
    setBusy(true);
    try {
      await fetch('/api/me/telegram', { method: 'DELETE' });
    } catch { /* код истечёт сам */ }
    setCode(null);
    setCreateFailed(null);
    await load();
    if (alive.current) setBusy(false);
  }

  async function copy() {
    if (!code?.code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      setTimeout(() => { if (alive.current) setCopied(false); }, 2000);
    } catch {
      setNotice('Не удалось скопировать. Выдели код вручную.');
    }
  }

  const btn = 'ps-btn';
  const loading = view === 'loading' && !loadError;

  return (
    <section className="ps-panel ps-tg" aria-labelledby="tg-title" aria-busy={loading || undefined} data-testid="tg-digest">
      <h3 id="tg-title" className="ps-tg__title">Сводка в Telegram</h3>

      {loading ? (
        <>
          <div className="ps-skeleton ps-tg__sk" aria-hidden="true" />
          <div className="ps-skeleton ps-tg__sk ps-tg__sk--cap" aria-hidden="true" />
          <div className="ps-tg__acts"><button type="button" className={`${btn} ps-btn--primary`} disabled>Привязать Telegram</button></div>
        </>
      ) : view === 'loading' ? (
        <>
          <p className="ps-tg__cap" role="status">Не удалось загрузить настройки Telegram.</p>
          <div className="ps-tg__acts"><button type="button" className={`${btn} ps-btn--ghost`} onClick={() => void load()}>Повторить</button></div>
        </>
      ) : (
        <>
          <div className="ps-tg__status" data-tone={STATUS_TONE[view as keyof typeof STATUS_TONE]} aria-live="polite" data-testid="tg-status">
            <Icon name={STATUS_ICON[view as keyof typeof STATUS_ICON]} size={16} />
            <span>{STATUS_TEXT[view as keyof typeof STATUS_TEXT]}</span>
          </div>

          {pending ? (
            <>
              <p className="ps-tg__cap">
                {code?.code ? <>Пришли боту команду: /start {code.code}. Код действует 15 минут.</> : <>Код уже создан, но показывается один раз. Нужен код на экране: нажми «Новый код». Код действует 15 минут.</>}
              </p>
              {code?.code && (
                <div className="ps-tg__codebox">
                  <span className="ps-tg__code" data-testid="tg-code">{code.code}</span>
                  <button type="button" className={`${btn} ps-btn--ghost`} onClick={() => void copy()} aria-label={copied ? 'Скопировано' : 'Копировать'}>
                    <Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? 'Скопировано' : 'Копировать'}
                  </button>
                </div>
              )}
              <p className="ps-tg__timer" data-testid="tg-timer">Осталось {countdownText(remainingMs(expiresAt, now))}</p>
              {code?.deepLink && (
                <a className="ps-link" href={code.deepLink} target="_blank" rel="noopener noreferrer">Открыть бота</a>
              )}
              <div className="ps-tg__acts">
                <button type="button" className={`${btn} ps-btn--ghost`} onClick={() => void createCode()} disabled={busy}>Новый код</button>
                <button type="button" className={`${btn} ps-btn--ghost`} onClick={() => void cancelCode()} disabled={busy}>Отмена</button>
              </div>
            </>
          ) : (
            <>
              <p className="ps-tg__cap">{view === 'create_error' ? createFailed : captionFor(view, status?.lastSentAt ?? null)}</p>
              {view === 'not_linked' && (
                <div className="ps-tg__acts"><button type="button" className={`${btn} ps-btn--primary`} onClick={() => void createCode()} disabled={busy}>Привязать Telegram</button></div>
              )}
              {view === 'expired' && (
                <div className="ps-tg__acts"><button type="button" className={`${btn} ps-btn--primary`} onClick={() => void createCode()} disabled={busy}>Новый код</button></div>
              )}
              {view === 'create_error' && (
                <div className="ps-tg__acts"><button type="button" className={`${btn} ps-btn--ghost`} onClick={() => void createCode()} disabled={busy}>Повторить</button></div>
              )}
              {view === 'linked' && !confirming && (
                <div className="ps-tg__acts"><button type="button" className={`${btn} ps-btn--ghost`} onClick={() => setConfirming(true)} disabled={busy}>Отключить</button></div>
              )}
              {view === 'linked' && confirming && (
                <div className="ps-tg__confirm" role="group" aria-label="Подтверждение">
                  <p className="ps-tg__cap">Отключить сводку? Привязку чата можно создать заново.</p>
                  <div className="ps-tg__acts">
                    <button type="button" className={`${btn} ps-btn--danger`} onClick={() => void removeLink()} disabled={busy}>Отключить</button>
                    <button type="button" className={`${btn} ps-btn--ghost`} onClick={() => setConfirming(false)} disabled={busy}>Отмена</button>
                  </div>
                </div>
              )}
            </>
          )}
          {loadError && <p className="ps-tg__cap" role="status">Не удалось обновить статус. Показаны последние данные.</p>}
          <p className="ps-tg__cap" role="status" data-testid="tg-notice">{notice}</p>
        </>
      )}
    </section>
  );
}
