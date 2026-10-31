'use client';

import { isSyncStale, syncAge } from '../format';
import { useNow } from '../primitives/hooks';
import { useSync } from '../sync/SyncProvider';
import { needsNewNpsso } from '../sync/status';

export type SyncTone = 'ok' | 'warn' | 'bad' | 'busy' | 'unknown';

/** Тон индикатора: красный при ошибке/протухшем NPSSO, жёлтый после 36 ч. */
export function syncTone(
  s: { running: boolean; lastSuccessAt: string | null; failed: boolean; npsso: boolean } | null, nowMs: number,
): SyncTone {
  if (!s) return 'unknown';
  if (s.npsso || s.failed) return 'bad';
  if (s.running) return 'busy';
  return isSyncStale(s.lastSuccessAt, nowMs) ? 'warn' : 'ok';
}

export function SyncIndicator() {
  const { status, loading, loadError, openPanel } = useSync();
  const now = useNow();
  const failed = !!status?.run && status.run.status === 'failed';
  const tone = loading || (loadError && !status) ? 'unknown' : syncTone(
    status ? { running: status.running, lastSuccessAt: status.lastSuccessAt, failed, npsso: needsNewNpsso(status) } : null, now,
  );
  const age = status ? syncAge(status.lastSuccessAt, now) : null;
  const text = tone === 'busy' ? 'Синк идёт…' : tone === 'unknown' ? 'Синк: нет данных' : age ? `Синк: ${age}` : 'Синк не запускался';
  // мобильная шапка: статус текстом (Фаза 22); при ошибке явно «Ошибка синка», на десктопе текст не меняется
  const mobileText = tone === 'bad' ? 'Ошибка синка' : text;
  return (
    <button type="button" className="ps-btn ps-btn--sync" data-tour="sync" onClick={openPanel} aria-label={`${text}. Открыть синк`} title={text} data-tone={tone}>
      <span className="ps-dot" data-tone={tone} aria-hidden="true" />
      <span className="ps-sync-text">{text}</span>
      <span className="ps-sync-text-m" aria-hidden="true">{mobileText}</span>
    </button>
  );
}
