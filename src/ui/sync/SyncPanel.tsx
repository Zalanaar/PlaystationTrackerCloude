'use client';

import { Fragment, useRef, useState } from 'react';
import { useIsOwner } from '../access/useIsOwner';
import { useSync } from './SyncProvider';
import {
  buttonLabel, formatMoscow, needsNewNpsso, npssoErrorText, phaseText, progressFraction, psnTokenRows,
  CANCEL_CONFIRM_TEXT, isCancelledRun, reasonText, runCountersText, runStatusLabel, totalsRows,
} from './status';

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const btnPrimary = `h-11 rounded-md bg-accent px-5 font-semibold text-accent-ink disabled:opacity-60 ${focus}`;
const btnGhost = `h-11 rounded-md border border-border-strong px-4 text-text disabled:opacity-60 ${focus}`;

export function SyncPanel() {
  const { status, loading, loadError, starting, stopping, restarting, notice, start, cancel, restart, reload } = useSync();
  const [stopAskedFor, setStopAskedFor] = useState<number | null>(null); // id запуска, для которого открыто подтверждение
  const isOwner = useIsOwner();
  const [howTo, setHowTo] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [npssoMsg, setNpssoMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // NPSSO живёт только в поле и в теле запроса: поле очищается до ожидания ответа, в state значение не попадает.
  async function submitNpsso(e: React.FormEvent) {
    e.preventDefault();
    const el = inputRef.current;
    const raw = el?.value.trim() ?? '';
    if (!raw) {
      setNpssoMsg({ ok: false, text: npssoErrorText(400, 'invalid_request') });
      return;
    }
    const body = JSON.stringify({ npsso: raw });
    if (el) el.value = '';
    setSending(true);
    setNpssoMsg(null);
    try {
      const res = await fetch('/api/sync/npsso', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (res.ok) {
        await res.text().catch(() => '');
        setNpssoMsg({ ok: true, text: 'Принято. Токен сохранён, можно запускать синк.' });
        await reload();
      } else {
        const json = await res.json().catch(() => null);
        setNpssoMsg({ ok: false, text: npssoErrorText(res.status, json?.error?.code, json?.error?.details?.retryAfterSeconds) });
      }
    } catch {
      setNpssoMsg({ ok: false, text: npssoErrorText(0, undefined) });
    } finally {
      setSending(false);
    }
  }

  const tokenRows = psnTokenRows(status?.psnToken);
  const running = status?.running ?? false;

  const run = status?.run ?? null;
  const last = formatMoscow(status?.lastSuccessAt ?? null);
  const npsso = status ? needsNewNpsso(status) : false;
  const fraction = run && running ? progressFraction(run) : null;
  const label = status ? buttonLabel(status, starting) : starting ? 'Синк идёт…' : 'Синк сейчас';
  const failedReason = run && run.status !== 'running' && run.status !== 'success' ? run.errorReason : null;
  const cancelled = isCancelledRun(run);
  const confirmStop = running && run !== null && stopAskedFor === run.id;
  const setConfirmStop = (v: boolean) => setStopAskedFor(v && run ? run.id : null);
  const stopBusy = stopping || restarting;

  return (
    <section aria-labelledby="sync-title" aria-busy={loading || running} className="flex flex-col gap-4">
      {npsso && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-md border-l-4 border-l-danger p-4 text-text"
          style={{ background: 'color-mix(in srgb, var(--danger) 14%, var(--surface))' }}
        >
          <p className="font-semibold">Нужен новый NPSSO</p>
          <p className="text-text-2">
            Синк остановлен: токен доступа к PSN устарел.
            {last ? ` Данные не обновляются с ${last}.` : ''}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGhost} aria-expanded={howTo} onClick={() => setHowTo((v) => !v)}>
              Как обновить
            </button>
            <button type="button" className={btnGhost} onClick={() => void start()} disabled={starting || running}>
              Проверить снова
            </button>
          </div>
          {howTo && (
            <ol className="list-decimal pl-5 text-text-2">
              <li>Войди в технический аккаунт PSN в браузере.</li>
              <li>Открой ca.account.sony.com/api/v1/ssocookie и скопируй значение npsso.</li>
              <li>{isOwner ? 'Вставь его в поле «Вставить NPSSO» ниже и нажми «Сохранить».' : 'Передай его владельцу: вставить может только он.'}</li>
            </ol>
          )}
        </div>
      )}

      <div className="ps-card flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <h2 id="sync-title" className="font-display text-xl font-bold text-text">
          Синхронизация с PSN
        </h2>

        {loading ? (
          <div className="ps-skeleton h-12 rounded-md" aria-hidden="true" />
        ) : loadError && !status ? (
          <p role="status" className="text-text-2">Не удалось получить статус синка.</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-text-2">
            <dt>Последний успешный синк</dt>
            <dd className="text-text">{last ?? 'ещё не было'}</dd>
            {run && (
              <>
                <dt>Последний запуск</dt>
                <dd className="text-text" data-testid="run-status">{runStatusLabel(run)}</dd>
              </>
            )}
            {totalsRows(status?.totals).map((r) => (
              <Fragment key={r.label}>
                <dt>{r.label}</dt>
                <dd className="font-num text-text">{r.value}</dd>
              </Fragment>
            ))}
          </dl>
        )}

        {tokenRows && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-text-2" aria-label="Токен PSN" data-testid="psn-token">
            {tokenRows.map((r) => (
              <Fragment key={r.label}>
                <dt>{r.label}</dt>
                <dd className="min-w-0 break-words text-text">{r.value}</dd>
              </Fragment>
            ))}
          </dl>
        )}

        {running && run && (
          <div role="status" className="flex flex-col gap-2">
            <p className="text-text">{phaseText(run)}</p>
            {runCountersText(run) && <p className="text-text-2">{runCountersText(run)}</p>}
            <div
              className="h-[6px] overflow-hidden rounded-pill bg-surface-3"
              role="progressbar"
              aria-label="Прогресс синка"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
            >
              <div className="h-full bg-accent" style={{ width: `${Math.round((fraction ?? 0.05) * 100)}%` }} />
            </div>
          </div>
        )}

        {running && (
          <div className="flex flex-col gap-2" data-testid="sync-run-actions">
            {confirmStop ? (
              <div
                role="alertdialog" aria-labelledby="sync-stop-q" className="flex flex-wrap items-center gap-2"
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirmStop(false); } }}
              >
                <p id="sync-stop-q" className="w-full font-semibold text-text">{CANCEL_CONFIRM_TEXT}</p>
                <button
                  type="button" className={btnPrimary} disabled={stopBusy}
                  onClick={() => { setConfirmStop(false); void cancel(); }}
                >
                  Остановить
                </button>
                <button type="button" className={btnGhost} autoFocus onClick={() => setConfirmStop(false)}>Отмена</button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnGhost} disabled={stopBusy} onClick={() => setConfirmStop(true)}>
                  {stopping ? 'Останавливаем…' : 'Остановить'}
                </button>
                <button type="button" className={btnGhost} disabled={stopBusy} onClick={() => void restart()}>
                  {restarting ? 'Перезапускаем…' : 'Перезапустить'}
                </button>
              </div>
            )}
          </div>
        )}

        {!running && failedReason && !npsso && (
          <p role="status" className="text-text" data-testid={cancelled ? 'sync-cancelled' : undefined}>{reasonText(failedReason, run?.errorMessage)}</p>
        )}
        {loadError && status && (
          <p role="status" className="text-text-2">Не удалось обновить статус. Показаны последние данные.</p>
        )}
        <div role="status" aria-live="polite">{notice && <p className="text-text">{notice}</p>}</div>

        {isOwner && (
          <form onSubmit={(e) => void submitNpsso(e)} className="flex flex-col gap-2" data-testid="npsso-form" noValidate>
            <label htmlFor="npsso-input" className="font-semibold text-text">Вставить NPSSO</label>
            <div className="flex flex-wrap gap-2">
              <input
                id="npsso-input" ref={inputRef} type="password" name="psn-token-field" autoComplete="off" autoCapitalize="off"
                autoCorrect="off" spellCheck={false} className="ps-input min-w-0 flex-1 basis-40" disabled={sending}
                aria-describedby="npsso-hint npsso-result"
              />
              <button type="submit" className={btnGhost} disabled={sending}>{sending ? 'Сохраняем…' : 'Сохранить'}</button>
            </div>
            <p id="npsso-hint" className="text-text-2">Значение npsso или ответ страницы целиком. Не сохраняется в браузере.</p>
          </form>
        )}
        <div id="npsso-result" role="status" aria-live="polite" data-testid="npsso-result" className="flex flex-col gap-2">
          {npssoMsg && <p className={npssoMsg.ok ? 'text-text' : 'text-danger'}>{npssoMsg.text}</p>}
          {npssoMsg?.ok && (
            <div>
              <button type="button" className={btnGhost} onClick={() => void start()} disabled={starting || running}>Синк сейчас</button>
            </div>
          )}
        </div>

        <div>
          <button type="button" className={btnPrimary} onClick={() => void start()} disabled={starting || running || loading}>
            {label}
          </button>
        </div>
      </div>
    </section>
  );
}
