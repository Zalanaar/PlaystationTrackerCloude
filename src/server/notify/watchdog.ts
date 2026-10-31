// Алерт «синк не запускался» (контракт 20.2). Отдельный cron-пинг: срабатывает и тогда, когда синк не стартовал вовсе
// (notifyAfterSync вызывается только после запуска). Не бросает: итог описывается в результате.
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { getSyncOverdue, isSyncRunningFresh } from '@/server/sync/overdue';
import { getTelegramEnv, claimSend, messageFor, releaseSend, sendTelegram, type TelegramEnv } from './telegram';

export type WatchdogAlert = 'not_needed' | 'sent' | 'already_sent' | 'telegram_disabled' | 'send_failed' | 'sync_running' | 'error';
export type WatchdogResult = { isOverdue: boolean; ageHours: number | null; alert: WatchdogAlert };

export const SYNC_MISSED_KIND = 'sync_missed';

/** kindSuffix: ключ дедупа `sync_missed:<id>` для не-owner (22.1); label: ник PSN в тексте. */
export async function runSyncWatchdog(db: AnyDb, userId: UserId, o: { now?: Date; env?: TelegramEnv | null; fetchImpl?: typeof fetch; kindSuffix?: string; label?: string } = {}): Promise<WatchdogResult> {
  const kind = `${SYNC_MISSED_KIND}${o.kindSuffix ?? ''}`;
  const now = o.now ?? new Date();
  try {
    const overdue = await getSyncOverdue(db, userId, now);
    const base = { isOverdue: overdue.isOverdue, ageHours: overdue.ageHours };
    if (!overdue.isOverdue) return { ...base, alert: 'not_needed' };
    const env = o.env === undefined ? getTelegramEnv() : o.env;
    if (!env) return { ...base, alert: 'telegram_disabled' };
    if (await isSyncRunningFresh(db, userId, now)) return { ...base, alert: 'sync_running' };
    // N-7: отметка «отправлено сегодня» ставится атомарно ДО отправки, второй параллельный вызов получит already_sent.
    const claim = await claimSend(db, kind, now);
    if (!claim.claimed) return { ...base, alert: 'already_sent' };
    let sent = false;
    try {
      sent = await sendTelegram(messageFor('sync_missed', { ageMs: (overdue.ageHours ?? 0) * 3_600_000, label: o.label }), { env, fetchImpl: o.fetchImpl });
    } finally {
      if (!sent) await releaseSend(db, kind, claim, now);
    }
    return { ...base, alert: sent ? 'sent' : 'send_failed' };
  } catch {
    console.error('watchdog: проверка синка не выполнена');
    return { isOverdue: false, ageHours: null, alert: 'error' };
  }
}

export const OWNER_MISSING_KIND = 'owner_missing';

/** В allowed_users нет владельца: cron не может ничего проверить. Сообщение в Telegram раз в сутки; не бросает. */
export async function alertOwnerMissing(db: AnyDb, o: { now?: Date; env?: TelegramEnv | null; fetchImpl?: typeof fetch } = {}): Promise<'sent' | 'already_sent' | 'telegram_disabled' | 'send_failed' | 'error'> {
  const now = o.now ?? new Date();
  try {
    const env = o.env === undefined ? getTelegramEnv() : o.env;
    if (!env) return 'telegram_disabled';
    const claim = await claimSend(db, OWNER_MISSING_KIND, now);
    if (!claim.claimed) return 'already_sent';
    let sent = false;
    try {
      sent = await sendTelegram('PS Tracker: владелец не найден в списке доступа (allowed_users). Синк и копии остановлены. Проверьте базу данных.', { env, fetchImpl: o.fetchImpl });
    } finally {
      if (!sent) await releaseSend(db, OWNER_MISSING_KIND, claim, now);
    }
    return sent ? 'sent' : 'send_failed';
  } catch {
    return 'error';
  }
}
