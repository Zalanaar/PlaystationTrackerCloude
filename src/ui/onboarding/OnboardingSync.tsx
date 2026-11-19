'use client';

// П15.6: шаг «Загрузка» онбординга — первая синхронизация игр, опрос статуса, повтор и частичная загрузка.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { week1HintCookie } from '@/shared/week1-hint';
import { Icon } from '../icons';
import { queueTourStart, skipTourSilently } from '../tour/api';
import { fetchPsn, goLogin, JSON_HEADERS, POLL_MS } from './http';
import {
  gamesSeen, phaseLabel, isIdlePartial, isStalled, progressPercent, shouldAutoStart, shouldResumePartial, syncErrorText, syncView, type PsnState, type Step, type SyncSlice,
} from './model';

type StatusData = SyncSlice;

export function SyncStep({ initial, recheck, h2, onBack }: { initial: PsnState; recheck: boolean; h2: React.RefObject<HTMLHeadingElement | null>; onBack: (s: Step) => void }) {
  const router = useRouter();
  const [began, setBegan] = useState(!recheck);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loadFail, setLoadFail] = useState(false);
  const [queued, setQueued] = useState(false);
  const [startError, setStartError] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean>(!recheck && !!initial.onboardedAt);
  const [phaseNote, setPhaseNote] = useState('');
  const [stalled, setStalled] = useState(false);
  const api = useRef<{ retry: () => void }>({ retry: () => {} });
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  useEffect(() => {
    if (!began) return;
    let alive = true;
    let polling = true;
    let first = !recheck;
    let q = false;
    let confirmTries = 0;
    let lastPhase = '';
    let idleTicks = 0;
    let lastResumeAt: number | null = null;
    let lastDone = -1;
    let lastProgressAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (alive && polling) timer = setTimeout(() => void tick(), ms);
    };

    async function post(resume = false): Promise<void> {
      setStartError(false);
      try {
        const r = await fetch('/api/sync', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
        if (r.status === 401) { goLogin(); return; }
        if (r.status === 202) { q = false; setQueued(false); return; }
        const j = await r.json().catch(() => null);
        const code = j?.error?.code;
        if (r.status === 409 && code === 'sync_in_progress') { if (resume) return; q = true; setQueued(true); return; }
        if (code === 'psn_not_set') { polling = false; onBackRef.current(1); return; }
        if (code === 'psn_not_verified') { polling = false; onBackRef.current(2); return; }
        setStartError(true);
        polling = false;
      } catch {
        setStartError(true);
        polling = false;
      }
    }

    async function tick(): Promise<void> {
      if (!alive || !polling) return;
      if (document.hidden) return; // возобновится по visibilitychange
      let s: StatusData | null = null;
      try {
        const r = await fetch('/api/sync/status', { cache: 'no-store' });
        if (r.status === 401) { goLogin(); return; }
        const j = await r.json().catch(() => null);
        if (r.ok && j?.ok) s = j.data as StatusData;
      } catch { /* сеть: попробуем на следующем тике */ }
      if (!alive) return;
      if (!s) { setLoadFail(true); schedule(POLL_MS); return; }
      setLoadFail(false);
      setStatus(s);
      if (first) {
        first = false;
        if (shouldAutoStart(s)) { await post(); if (alive && polling) schedule(600); return; }
      } else if (q && !s.running) {
        await post();
        if (alive && polling) schedule(POLL_MS);
        return;
      }
      const nowMs = Date.now();
      const doneNow = s.run?.progress?.done ?? -1;
      if (doneNow > lastDone || s.run?.status === 'success') { lastProgressAt = nowMs; setStalled(false); }
      lastDone = Math.max(lastDone, doneNow);
      if (isIdlePartial(s)) {
        idleTicks++;
        if (shouldResumePartial(idleTicks, lastResumeAt, nowMs)) {
          lastResumeAt = nowMs;
          await post(true);
          if (!alive) return;
          if (polling) schedule(600);
          return;
        }
      } else idleTicks = 0;
      if (isStalled(lastProgressAt, nowMs) && syncView(s).kind === 'running') setStalled(true);
      const v = syncView(s);
      const ph = s.run?.progress?.phase ?? '';
      if (ph && ph !== lastPhase) { lastPhase = ph; setPhaseNote(phaseLabel(ph)); }
      if (v.kind === 'success') {
        if (gamesSeen(s) === 0) { polling = false; return; }
        const d = await fetchPsn();
        if (!alive) return;
        if (d?.onboardedAt || ++confirmTries > 6) { polling = false; setOnboarded(true); return; }
        schedule(POLL_MS);
        return;
      }
      if (v.kind === 'running') { schedule(POLL_MS); return; }
      polling = false; // idle / failed: ждём действия пользователя
    }

    api.current.retry = () => {
      polling = true;
      first = false;
      confirmTries = 0;
      idleTicks = 0;
      lastResumeAt = Date.now();
      lastProgressAt = Date.now();
      setStalled(false);
      setStatus((p) => (p ? { ...p, running: true, run: p.run ? { ...p.run, status: 'running' } : p.run } : p));
      void (async () => { await post(); if (alive && polling) schedule(600); })();
    };

    const onVis = () => { if (!document.hidden && polling) { clearTimeout(timer); void tick(); } };
    document.addEventListener('visibilitychange', onVis);
    void tick();
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [began, recheck]);

  const v = syncView(status);
  const seen = gamesSeen(status);
  const progress = status?.run?.progress ?? null;
  const pct = progressPercent(progress);
  const retry = () => api.current.retry();

  let body: ReactNode;
  if (!began) {
    body = (
      <>
        <p className="ps-ob__rtext">Доступ подтверждён. Загрузим игры, часы и трофеи с вашего профиля.</p>
        <div className="ps-ob__acts"><button type="button" className="ps-btn ps-btn--primary" onClick={() => setBegan(true)}>Начать загрузку</button></div>
      </>
    );
  } else if (startError && v.kind !== 'running') {
    body = <FailBlock title="Не удалось запустить загрузку." text="Попробуйте ещё раз." onRetry={retry} onBack={() => onBackRef.current(2)} />;
  } else if (!status) {
    body = loadFail ? (
      <div className="ps-ob__result" data-tone="warning" role="status"><Icon name="cloud-off" size={24} /><div className="ps-ob__rbody"><p className="ps-ob__rtitle">Не удалось обновить состояние загрузки</p><p className="ps-ob__rtext">Пробуем ещё раз…</p></div></div>
    ) : (
      <div className="ps-ob__sk" aria-busy="true" data-testid="ob-sync-loading">
        <span className="ps-skeleton" style={{ height: 'var(--sp-4)' }} /><span className="ps-skeleton" style={{ height: 6 }} /><span className="ps-skeleton" style={{ height: 'var(--sp-3)' }} />
      </div>
    );
  } else if (v.kind === 'cancelled') {
    body = (
      <>
        <div className="ps-ob__result" data-tone="neutral" role="status" data-testid="ob-sync-cancelled">
          <Icon name="cloud-off" size={24} />
          <div className="ps-ob__rbody"><p className="ps-ob__rtitle">Загрузка остановлена</p><p className="ps-ob__rtext">Уже загруженное сохранено.</p></div>
        </div>
        <div className="ps-ob__acts"><button type="button" className="ps-btn ps-btn--primary" onClick={retry}>Продолжить загрузку</button></div>
      </>
    );
  } else if (v.kind === 'failed') {
    body = <FailBlock title="Не удалось загрузить игры. Уже загруженное сохранено." text={syncErrorText(v.reason)} onRetry={retry} onBack={() => onBackRef.current(2)} />;
  } else if (v.kind === 'success' && seen === 0) {
    body = (
      <>
        <div className="ps-ob__result" data-tone="warning" role="status" data-testid="ob-empty">
          <Icon name="gamepad" size={24} />
          <div className="ps-ob__rbody"><p className="ps-ob__rtitle">Игр не нашли</p><p className="ps-ob__rtext">Возможно, в профиле скрыт список игр. Проверьте приватность и повторите.</p></div>
        </div>
        <div className="ps-ob__acts">
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => onBackRef.current(2)}>Проверить доступ</button>
          <button type="button" className="ps-btn ps-btn--ghost" onClick={retry}>Повторить</button>
        </div>
      </>
    );
  } else if (v.kind === 'success' && onboarded) {
    body = (
      <div className="ps-ob__done" data-testid="ob-done" role="status">
        <Icon name="check-circle" size={32} />
        <h2 className="ps-ob__h2">Готово</h2>
        <p className="ps-ob__rtext">{seen !== null ? `Загружено игр: ${seen}. ` : ''}Осталось разобрать, что вы уже прошли, а что бросили.</p>
        <div className="ps-ob__acts">
          <button type="button" className="ps-btn ps-btn--primary" onClick={() => { document.cookie = week1HintCookie(true); queueTourStart(); router.push('/'); }}>Начать тур</button>
          <button type="button" className="ps-btn ps-btn--ghost" onClick={() => { document.cookie = week1HintCookie(true); skipTourSilently(); router.push('/triage'); }}>Пропустить, открыть Разбор</button>
        </div>
      </div>
    );
  } else {
    const label = v.kind === 'success' ? 'Заканчиваем загрузку' : phaseLabel(progress?.phase ?? status.run?.progress?.phase ?? status.run?.status);
    const total = progress?.total ?? null;
    const done = progress?.done ?? null;
    body = (
      <>
        {queued && !status.running && <p className="ps-ob__rtext" role="status" data-testid="ob-queued">Сейчас идёт загрузка у другого пользователя, ваша начнётся следом.</p>}
        <div>
          <div className="ps-ob__prog" data-testid="ob-progress-text">
            <span>{progress ? `Шаг ${progress.step} из ${progress.steps}: ${label}` : label}</span>
            {total !== null && total > 0 && done !== null && <span>{done} из {total}</span>}
          </div>
        </div>
        <div
          className="ps-ob__bar" role="progressbar" aria-label="Загрузка игр" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={pct ?? undefined} aria-valuetext={pct === null ? 'Идёт загрузка' : undefined} aria-live="off"
          data-indeterminate={pct === null ? '' : undefined}
        >
          <div className="ps-ob__bar-fill" style={pct === null ? undefined : { width: `${pct}%` }} />
        </div>
        {v.kind === 'running' && v.partial && <p className="ps-ob__hint">Продолжаем загрузку…</p>}
        {stalled && v.kind === 'running' && (
          <>
            <p className="ps-ob__rtext" role="status" data-testid="ob-stalled">Загрузка остановилась. Нажмите, чтобы продолжить: загруженное сохранится.</p>
            <div className="ps-ob__acts"><button type="button" className="ps-btn ps-btn--primary" onClick={retry}>Продолжить загрузку</button></div>
          </>
        )}
        <p className="ps-ob__hint">Первая загрузка занимает несколько минут. Вкладку можно закрыть: загрузка продолжится.</p>
        <p className="ps-ob__sr" role="status">{phaseNote}</p>
      </>
    );
  }

  return (
    <section className="ps-panel ps-ob__panel" aria-labelledby={v.kind === 'success' && onboarded && seen !== 0 ? undefined : 'ob-h2'} aria-busy={began && !status}>
      {!(v.kind === 'success' && onboarded && seen !== 0 && began) && <h2 id="ob-h2" className="ps-ob__h2" tabIndex={-1} ref={h2}>Загружаем вашу коллекцию</h2>}
      {body}
    </section>
  );
}

function FailBlock({ title, text, onRetry, onBack }: { title: string; text: string; onRetry: () => void; onBack: () => void }) {
  return (
    <>
      <div className="ps-ob__result" data-tone="danger" role="alert" data-testid="ob-sync-failed">
        <Icon name="circle-alert" size={24} />
        <div className="ps-ob__rbody"><p className="ps-ob__rtitle">{title}</p><p className="ps-ob__rtext">{text}</p></div>
      </div>
      <div className="ps-ob__acts">
        <button type="button" className="ps-btn ps-btn--primary" onClick={onRetry}>Повторить</button>
        <button type="button" className="ps-btn ps-btn--ghost" onClick={onBack}>Проверить доступ</button>
      </div>
    </>
  );
}
