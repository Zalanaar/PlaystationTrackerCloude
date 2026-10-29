// Алерт «синк не запускался» (контракт 20.2). Отдельный cron-пинг: срабатывает и тогда, когда синк не стартовал вовсе
// (notifyAfterSync вызывается только после запуска). Не бросает: итог описывается в результате.
import type { AnyDb } from '@/db/types';
import { getSyncOverdue, isSyncRunningFresh } from '@/server/sync/overdue';
import { getTelegramEnv, claimSend, messageFor, releaseSend, sendTelegram, type TelegramEnv } from './telegram';

export type WatchdogAlert = 'not_needed' | 'sent' | 'already_sent' | 'telegram_disabled' | 'send_failed' | 'sync_running' | 'error';
export type WatchdogResult = { isOverdue: boolean; ageHours: number | null; alert: WatchdogAlert };

export const SYNC_MISSED_KIND = 'sync_missed';

export async function runSyncWatchdog(db: AnyDb, o: { now?: Date; env?: TelegramEnv | null; fetchImpl?: typeof fetch } = {}): Promise<WatchdogResult> {
  const now = o.now ?? new Date();
  try {
    const overdue = await getSyncOverdue(db, now);
    const base = { isOverdue: overdue.isOverdue, ageHours: overdue.ageHours };
    if (!overdue.isOverdue) return { ...base, alert: 'not_needed' };
    const env = o.env === undefined ? getTelegramEnv() : o.env;
    if (!env) return { ...base, alert: 'telegram_disabled' };
    if (await isSyncRunningFresh(db, now)) return { ...base, alert: 'sync_running' };
    // N-7: отметка «отправлено сегодня» ставится атомарно ДО отправки, второй параллельный вызов получит already_sent.
    const claim = await claimSend(db, SYNC_MISSED_KIND, now);
    if (!claim.claimed) return { ...base, alert: 'already_sent' };
    let sent = false;
    try {
      sent = await sendTelegram(messageFor('sync_missed', { ageMs: (overdue.ageHours ?? 0) * 3_600_000 }), { env, fetchImpl: o.fetchImpl });
    } finally {
      if (!sent) await releaseSend(db, SYNC_MISSED_KIND, claim, now);
    }
    return { ...base, alert: sent ? 'sent' : 'send_failed' };
  } catch {
    console.error('watchdog: проверка синка не выполнена');
    return { isOverdue: false, ageHours: null, alert: 'error' };
  }
}
