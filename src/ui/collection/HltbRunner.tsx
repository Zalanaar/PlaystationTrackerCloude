'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchHltbRun } from './api';
import { hltbEndMessage, hltbProgressText, runHltbLoop, type HltbLoopResult, type HltbRunTotals } from './hltbRun';

/** Массовая подгрузка длительности с HLTB (16.7): цикл вызовов с прогрессом, остановкой и итогом. Закрытие страницы прерывает цикл. */
export function HltbRunner({ onFinished }: { onFinished: () => void }) {
  const [running, setRunning] = useState(false);
  const [recheck, setRecheck] = useState(false);
  const [progress, setProgress] = useState<HltbRunTotals | null>(null);
  const [result, setResult] = useState<HltbLoopResult | null>(null);
  const stopRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; stopRef.current = true; };
  }, []);

  async function start() {
    if (running) return;
    stopRef.current = false;
    setRunning(true);
    setResult(null);
    setProgress(null);
    // since фиксируется один раз на весь цикл (иначе перепроверка не закончится)
    const r = await runHltbLoop({
      run: fetchHltbRun, recheckNotFound: recheck, since: new Date().toISOString(),
      shouldStop: () => stopRef.current || !aliveRef.current,
      onProgress: (t) => { if (aliveRef.current) setProgress(t); },
    });
    if (!aliveRef.current) return;
    setRunning(false);
    setResult(r);
    if (r.totals.calls > 0) onFinished();
  }

  const msg = result ? hltbEndMessage(result) : null;
  return (
    <section className="ps-bl-hltb" aria-label="Длительность с HLTB">
      <div className="ps-bl-hltb__row">
        <button
          type="button" className="ps-btn" onClick={() => void start()} disabled={running} aria-label="Подтянуть длительность с HLTB" data-testid="hltb-start"
        >
          Подтянуть длительность с HLTB
        </button>
        {running && (
          <button type="button" className="ps-btn ps-btn--ghost" onClick={() => { stopRef.current = true; }} aria-label="Остановить подгрузку с HLTB" data-testid="hltb-stop">
            Остановить
          </button>
        )}
        <label className="ps-bl-hltb__check">
          <input type="checkbox" checked={recheck} disabled={running} onChange={(e) => setRecheck(e.target.checked)} />
          <span>Перепроверить не найденные</span>
        </label>
      </div>
      {running && (
        <p className="ps-bl-hltb__status num" role="status" data-testid="hltb-progress">{progress ? hltbProgressText(progress) : 'Проверяем…'}</p>
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
