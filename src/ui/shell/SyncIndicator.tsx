'use client';

import { isSyncStale, syncAge } from '../format';
import { useNow } from '../primitives/hooks';
import { useSync } from '../sync/SyncProvider';
import { isFailedRun, needsNewNpsso } from '../sync/status';

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

/** «12 ч назад» → «12 ч», «3 дн. назад» → «3 дн», «только что» → «сейчас». */
export function shortAge(age: string): string {
  if (age === 'только что') return 'сейчас';
  return age.replace(/\s*назад$/, '').replace(/\.$/, '');
}

export function SyncIndicator() {
  const { status, loading, loadError, openPanel } = useSync();
  const now = useNow();
  const failed = isFailedRun(status?.run);
  const tone = loading || (loadError && !status) ? 'unknown' : syncTone(
    status ? { running: status.running, lastSuccessAt: status.lastSuccessAt, failed, npsso: needsNewNpsso(status) } : null, now,
  );
  const age = status ? syncAge(status.lastSuccessAt, now) : null;
  const text = tone === 'busy' ? 'Синк идёт…' : tone === 'unknown' ? 'Синк: нет данных' : age ? `Синк: ${age}` : 'Синк не запускался';
  // мобильная шапка (D2/P2-14): точка-тон + короткое время «12 ч», полный текст в aria-label; при ошибке «Ошибка»
  const mobileText = tone === 'bad' ? 'Ошибка' : tone === 'busy' ? 'Идёт…' : tone === 'unknown' ? '' : age ? shortAge(age) : 'Нет';
  return (
    <button type="button" className="ps-btn ps-btn--sync" data-tour="sync" onClick={openPanel} aria-label={`${text}. Открыть синк`} title={text} data-tone={tone}>
      <span className="ps-dot" data-tone={tone} aria-hidden="true" />
      <span className="ps-sync-text">{text}</span>
      <span className="ps-sync-text-m num" aria-hidden="true">{mobileText}</span>
    </button>
  );
}
