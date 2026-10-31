// Еженедельная отправка копии в Telegram (контракт 20.3). Запускается из cron watchdog. Не бросает.
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { getTelegramEnv, claimSend, lastSentOn, releaseSend, sendTelegramDocument, type TelegramEnv } from '@/server/notify/telegram';
import { mskDate, mskDateString } from '@/server/stats/period';
import { buildBackup } from './export';
import { backupFileName } from './format';

export const BACKUP_KIND = 'backup_weekly';
/** Если копии не было дольше этого (суток), шлём не дожидаясь воскресенья. */
export const BACKUP_CATCHUP_DAYS = 8;

export type BackupJobResult = 'not_due' | 'sent' | 'already_sent' | 'telegram_disabled' | 'send_failed' | 'error';

const dayNumber = (ymd: string) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);

/** Воскресенье по МСК. */
export function isSundayMsk(now: Date): boolean {
  const { year, month, day } = mskDate(now);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

/** Пора ли слать: воскресенье МСК или с прошлой копии прошло BACKUP_CATCHUP_DAYS суток и больше (или копий не было). */
export function isBackupDue(now: Date, lastSent: string | null): boolean {
  if (isSundayMsk(now)) return true;
  if (!lastSent) return true;
  return dayNumber(mskDateString(now)) - dayNumber(lastSent) >= BACKUP_CATCHUP_DAYS;
}

/** kindSuffix: ключ дедупа `backup_weekly:<id>` для не-owner (22.1); label: ник PSN в подписи файла. */
export async function runWeeklyBackup(db: AnyDb, userId: UserId, o: { now?: Date; env?: TelegramEnv | null; fetchImpl?: typeof fetch; kindSuffix?: string; label?: string } = {}): Promise<BackupJobResult> {
  const now = o.now ?? new Date();
  const kind = `${BACKUP_KIND}${o.kindSuffix ?? ''}`;
  try {
    const last = await lastSentOn(db, kind);
    if (!isBackupDue(now, last)) return 'not_due';
    if (last && last >= mskDateString(now)) return 'already_sent';
    const env = o.env === undefined ? getTelegramEnv() : o.env;
    if (!env) return 'telegram_disabled';
    // N-7: атомарная отметка до отправки, чтобы двойной ручной запуск не продублировал файл.
    const claim = await claimSend(db, kind, now);
    if (!claim.claimed) return 'already_sent';
    let ok = false;
    try {
      const file = await buildBackup(db, userId, now);
      ok = await sendTelegramDocument(
        { name: backupFileName(mskDateString(now)), content: JSON.stringify(file, null, 1), caption: `PS Tracker: резервная копия разметки${o.label ? ` (${o.label.slice(0, 40)})` : ''}, ${file.games.length} игр` },
        { env, fetchImpl: o.fetchImpl },
      );
    } finally {
      if (!ok) await releaseSend(db, kind, claim, now);
    }
    return ok ? 'sent' : 'send_failed';
  } catch {
    console.error('backup: еженедельная копия не выполнена');
    return 'error';
  }
}
