'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  STATUS_LABEL, buttonLabel, formatMoscow, needsNewNpsso, phaseText, progressFraction, reasonText, runCountersText,
  startErrorText, totalsRows,
  type SyncStatus,
} from './status';

const POLL_MS = 3000;

const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const btnPrimary = `h-11 rounded-md bg-accent px-5 font-semibold text-accent-ink disabled:opacity-60 ${focus}`;
const btnGhost = `h-11 rounded-md border border-border-strong px-4 text-text disabled:opacity-60 ${focus}`;

export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [howTo, setHowTo] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/status', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error('bad status');
      setStatus(json.data as SyncStatus);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const running = status?.running ?? false;
  // Пока идёт синк, опрос каждые ~3 с (в том числе после ошибки опроса).
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [running, load]);

  async function start() {
    setStarting(true);
    setNotice(null);
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (res.status !== 202) {
        const json = await res.json().catch(() => null);
        setNotice(startErrorText(res.status, json?.error?.code));
      }
      await load();
    } catch {
      setNotice('Не удалось запустить синк.');
    } finally {
      setStarting(false);
    }
  }

  const run = status?.run ?? null;
  const last = formatMoscow(status?.lastSuccessAt ?? null);
  const npsso = status ? needsNewNpsso(status) : false;
  const fraction = run && running ? progressFraction(run) : null;
  const label = status ? buttonLabel(status, starting) : starting ? 'Синк идёт…' : 'Синк сейчас';
  const failedReason = run && run.status !== 'running' && run.status !== 'success' ? run.errorReason : null;

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
              <li>Вставь его в PSN_NPSSO на сервере и запусти синк.</li>
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
                <dd className="text-text" data-testid="run-status">{STATUS_LABEL[run.status]}</dd>
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

        {!running && failedReason && !npsso && <p role="status" className="text-text">{reasonText(failedReason)}</p>}
        {loadError && status && (
          <p role="status" className="text-text-2">Не удалось обновить статус. Показаны последние данные.</p>
        )}
        {notice && <p role="status" className="text-text">{notice}</p>}

        <div>
          <button type="button" className={btnPrimary} onClick={() => void start()} disabled={starting || running || loading}>
            {label}
          </button>
        </div>
      </div>
    </section>
  );
}
