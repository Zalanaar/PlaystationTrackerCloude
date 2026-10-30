'use client';

import { useSync } from '../../sync/SyncProvider';
import { phaseText, progressFraction } from '../../sync/status';

export function SyncProgress() {
  const { status } = useSync();
  const run = status?.run;
  if (!run) return null;
  const p = run.progress;
  const frac = progressFraction(run);
  const text = p && p.phase === 'games' && p.done !== null && p.total !== null ? `Загружено ${p.done} из ${p.total} игр` : phaseText(run);
  return (
    <div role="status" className="ps-empty__progress">
      <p>{text}</p>
      <div className="ps-bar" role="progressbar" aria-label="Прогресс синка" aria-valuemin={0} aria-valuemax={100} aria-valuenow={frac === null ? undefined : Math.round(frac * 100)}>
        <span style={{ width: `${Math.round((frac ?? 0.05) * 100)}%` }} />
      </div>
    </div>
  );
}
