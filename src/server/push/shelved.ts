// Идея «Напоминание об отложенной игре» (аудит UX, решение Артёма 19.11): раз в месяц, только тем, кто включил уведомления,
// push «Вернуться к …?» про одну игру из «Отложено». Выбор: отложена не меньше 30 дней, больше всего наиграно (вложился —
// вероятнее вернётся), при равенстве — дольше всех лежит; игры, о которых уже напоминали за 180 дней, пропускаются.
// Не чаще раза в месяц МСК на пользователя (push_log kind='shelved', ref='YYYY-MM'); без ключей VAPID — ничего.
import { and, desc, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { sendToUser, type PushEnv, type PushSender } from './push';

const { games, gameStatus, pushLog, pushPrefs, pushSubscriptions } = schema;
const DAY = 86_400_000;
export const SHELVED_MIN_DAYS = 30;
export const SHELVED_REPEAT_DAYS = 180;

export const mskMonth = (now: Date) => new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 7);

export type ShelvedPick = { gameId: number; title: string; shelvedAt: Date; playSeconds: number };

export function agoText(days: number): string {
  if (days < 61) return `${Math.max(1, Math.floor(days / 7))} нед. назад`;
  if (days < 365) return `${Math.floor(days / 30.44)} мес. назад`;
  return `${Math.floor(days / 365.25)} г. назад`;
}

export function playedText(secs: number): string {
  const h = secs / 3600;
  if (h < 1) return secs > 0 ? 'наиграно меньше часа' : 'ещё не запускалась';
  return `наиграно ${Math.round(h)} ч`;
}

export function shelvedPushBody(p: ShelvedPick, now: Date): { title: string; body: string } {
  const days = Math.floor((now.getTime() - p.shelvedAt.getTime()) / DAY);
  return { title: `Вернуться к «${p.title}»?`, body: `Отложена ${agoText(days)}, ${playedText(p.playSeconds)}. Может, пора?` };
}

export async function pickShelved(db: AnyDb, userId: number, now: Date): Promise<ShelvedPick | null> {
  const recent = (await db.select({ ref: pushLog.ref }).from(pushLog)
    .where(and(eq(pushLog.userId, userId), eq(pushLog.kind, 'shelved_game'), gte(pushLog.sentAt, new Date(now.getTime() - SHELVED_REPEAT_DAYS * DAY)))))
    .map((r) => Number(r.ref));
  const rows = await db
    .select({ gameId: games.id, title: games.name, shelvedAt: gameStatus.statusChangedAt, playSeconds: games.playDurationSeconds })
    .from(games)
    .innerJoin(gameStatus, and(eq(gameStatus.gameId, games.id), eq(gameStatus.userId, userId)))
    .where(and(eq(games.userId, userId), isNull(games.hiddenAt), eq(gameStatus.status, 'shelved'), lte(gameStatus.statusChangedAt, new Date(now.getTime() - SHELVED_MIN_DAYS * DAY))))
    .orderBy(desc(games.playDurationSeconds), asc(gameStatus.statusChangedAt), asc(games.id))
    .limit(SHELVED_REPEAT_DAYS);
  return rows.find((r) => !recent.includes(r.gameId)) ?? null;
}


export async function getShelvedReminderPref(db: AnyDb, userId: number): Promise<boolean> {
  const [row] = await db.select({ on: pushPrefs.shelvedReminder }).from(pushPrefs).where(eq(pushPrefs.userId, userId)).limit(1);
  return row?.on ?? true;
}

export async function setShelvedReminderPref(db: AnyDb, userId: number, on: boolean, now: Date = new Date()): Promise<boolean> {
  await db.insert(pushPrefs).values({ userId, shelvedReminder: on, updatedAt: now })
    .onConflictDoUpdate({ target: pushPrefs.userId, set: { shelvedReminder: on, updatedAt: now } });
  return on;
}

/** Cron watchdog (раз в сутки): первое подходящее срабатывание в месяце отправляет одно напоминание. Не бросает наружу ошибки отправки. */
export async function runShelvedReminders(db: AnyDb, now: Date, env: PushEnv | null, send: PushSender): Promise<{ users: number; sent: number }> {
  if (!env) return { users: 0, sent: 0 };
  const userIds = [...new Set((await db.selectDistinct({ u: pushSubscriptions.userId }).from(pushSubscriptions)).map((r) => r.u))];
  const off = userIds.length
    ? new Set((await db.select({ u: pushPrefs.userId }).from(pushPrefs).where(and(inArray(pushPrefs.userId, userIds), eq(pushPrefs.shelvedReminder, false)))).map((r) => r.u))
    : new Set<number>();
  const month = mskMonth(now);
  let users = 0;
  let sent = 0;
  for (const userId of userIds) {
    if (off.has(userId)) continue;
    const done = await db.select({ u: pushLog.userId }).from(pushLog).where(and(eq(pushLog.userId, userId), eq(pushLog.kind, 'shelved'), eq(pushLog.ref, month))).limit(1);
    if (done.length) continue;
    const pick = await pickShelved(db, userId, now);
    if (!pick) continue;
    // сначала журнал: повторный запуск cron в том же месяце ничего не шлёт
    const claimed = await db.insert(pushLog).values({ userId, kind: 'shelved', ref: month }).onConflictDoNothing().returning({ u: pushLog.userId });
    if (claimed.length === 0) continue;
    await db.insert(pushLog).values({ userId, kind: 'shelved_game', ref: String(pick.gameId), sentAt: now })
      .onConflictDoUpdate({ target: [pushLog.userId, pushLog.kind, pushLog.ref], set: { sentAt: sql`excluded.sent_at` } });
    users++;
    const { title, body } = shelvedPushBody(pick, now);
    sent += (await sendToUser(db, userId, { title, body, url: `/?game=${pick.gameId}`, tag: `shelved-${month}` }, env, send)).sent;
  }
  return { users, sent };
}
