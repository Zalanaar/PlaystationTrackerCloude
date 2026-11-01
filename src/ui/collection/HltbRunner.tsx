'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHltbRun } from './api';
import { hltbEndMessage, hltbProgressText, hltbSince, runHltbLoop, type HltbLoopResult, type HltbRunTotals } from './hltbRun';

/** Массовая подгрузка длительности с HLTB (16.7): цикл вызовов с прогрессом, остановкой и итогом. Закрытие страницы прерывает цикл. */
export function useHltbRunner(onFinished: () => void) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<HltbRunTotals | null>(null);
  const [result, setResult] = useState<HltbLoopResult | null>(null);
  const stopRef = useRef(false);
  const aliveRef = useRef(true);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const finishedRef = useRef(onFinished);
  useEffect(() => { finishedRef.current = onFinished; }, [onFinished]);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; stopRef.current = true; abortRef.current?.abort(); };
  }, []);

  const start = useCallback(async (recheckNotFound: boolean) => {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setResult(null);
    setProgress(null);
    const ac = new AbortController();
    abortRef.current = ac;
    // since фиксируется один раз на весь цикл (иначе перепроверка не закончится)
    const r = await runHltbLoop({
      run: fetchHltbRun, recheckNotFound, since: hltbSince(Date.now()), signal: ac.signal,
      shouldStop: () => stopRef.current || !aliveRef.current,
      onProgress: (t) => { if (aliveRef.current) setProgress(t); },
    });
    abortRef.current = null;
    runningRef.current = false;
    if (!aliveRef.current) return;
    setRunning(false);
    setResult(r);
    if (r.totals.calls > 0) finishedRef.current();
  }, []);

  const stop = useCallback(() => { stopRef.current = true; abortRef.current?.abort(); }, []);
  return { running, progress, result, start, stop };
}

export type HltbRunner = ReturnType<typeof useHltbRunner>;

/** Плашка прогресса и итога: рисуется только во время запуска или с итогом (кнопки запуска живут в меню страницы). */
export function HltbStatus({ runner }: { runner: HltbRunner }) {
  const { running, progress, result, stop } = runner;
  const msg = result ? hltbEndMessage(result) : null;
  if (!running && !msg) return null;
  return (
    <section className="ps-bl-hltb" aria-label="Длительность с HLTB">
      {running && (
        <div className="ps-bl-hltb__row">
          <p className="ps-bl-hltb__status num" role="status" data-testid="hltb-progress">{progress ? hltbProgressText(progress) : 'Проверяем…'}</p>
          <button type="button" className="ps-btn ps-btn--ghost ps-btn--sm" onClick={stop} aria-label="Остановить подгрузку с HLTB" data-testid="hltb-stop">
            Остановить
          </button>
        </div>
      )}
      {msg && (
        <div className="ps-bl-hltb__result" data-tone={msg.tone} role={msg.tone === 'error' ? 'alert' : 'status'} data-testid="hltb-result">
          <p>{msg.text}</p>
          {result && result.warnings.length > 0 && (
            <ul>{result.warnings.map((w) => <li key={`${w.code}:${w.message}`}>{w.message}</li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
}
