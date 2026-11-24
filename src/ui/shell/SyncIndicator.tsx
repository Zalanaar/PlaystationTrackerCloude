'use client';

import { syncAge } from '../format';
import { Icon } from '../icons';
import { useNow } from '../primitives/hooks';
import { useSync } from '../sync/SyncProvider';
import { isFailedRun, needsNewNpsso } from '../sync/status';

export type SyncTone = 'ok' | 'warn' | 'bad' | 'busy' | 'unknown';

/** F8: жёлтый, если пропущен ночной синк (крон раз в сутки, 23:00 МСК; запас 2 ч). Watchdog и «Здоровье» — по-прежнему 36 ч. */
export const HEADER_STALE_HOURS = 26;

/** Тон индикатора: красный при ошибке/протухшем NPSSO, жёлтый после 26 ч без успешного синка. */
export function syncTone(
  s: { running: boolean; lastSuccessAt: string | null; failed: boolean; npsso: boolean } | null, nowMs: number,
): SyncTone {
  if (!s) return 'unknown';
  if (s.npsso || s.failed) return 'bad';
  if (s.running) return 'busy';
  const t = s.lastSuccessAt ? Date.parse(s.lastSuccessAt) : NaN;
  return Number.isNaN(t) || nowMs - t > HEADER_STALE_HOURS * 3600_000 ? 'warn' : 'ok';
}

/** «12 ч назад» → «12 ч», «3 дн. назад» → «3 дн», «только что» → «сейчас» (на телефоне рядом значок ↻ — это возраст синка, а не наигранное время). */
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
  const text = tone === 'busy' ? 'Синк с PSN идёт…' : tone === 'unknown' ? 'Синк с PSN: нет данных' : age ? `Синк с PSN: ${age}` : 'Синк с PSN не запускался';
  // мобильная шапка (D2/P2-14, F8): значок ↻ цветом тона + короткое время «12 ч» (не путается с наигранными часами), полный текст в aria-label
  const mobileText = tone === 'bad' ? 'Ошибка' : tone === 'busy' ? 'Идёт…' : tone === 'unknown' ? '' : age ? shortAge(age) : 'Нет';
  return (
    <button type="button" className="ps-btn ps-btn--sync" data-tour="sync" onClick={openPanel} aria-label={`${text}. Открыть синк с PSN`} title={text} data-tone={tone}>
      <span className="ps-dot" data-tone={tone} aria-hidden="true" />
      <span className="ps-sync-ic" data-tone={tone} aria-hidden="true"><Icon name="refresh" size={14} /></span>
      <span className="ps-sync-text">{text}</span>
      <span className="ps-sync-text-m num" aria-hidden="true"><span>{mobileText}</span></span>
    </button>
  );
}
