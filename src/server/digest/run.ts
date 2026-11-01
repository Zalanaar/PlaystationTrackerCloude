// Отправка сводки (контракт F29.2-F29.4). Не бросает: итог в результате. Токен бота не логируется.
import { and, eq, like, lt, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { asUserId, type UserId } from '@/server/auth/user-id';
import { getAppOrigin } from '@/server/env';
import { getBotToken, sendTelegram } from '@/server/notify/telegram';
import { mskDateString } from '@/server/stats/period';
import { BLOCK_COUNT, collectDigest, type Collectors } from './data';
import { formatDigest } from './format';
import { addDays, digestKind, DIGEST_KIND_PREFIX, digestTarget, type DigestWeek } from './week';

const { notifyLog, telegramChats, digestState, allowedUsers } = schema;

export type DigestResultKind = 'sent' | 'already_sent' | 'no_target' | 'telegram_disabled' | 'send_failed' | 'skipped' | 'error';
export type DigestUserResult = { userId: number; result: DigestResultKind };
export type DigestRunResult = { week: string; results: DigestUserResult[] };

export type DigestDeps = {
  now?: Date;
  /** Токен бота (по умолчанию из env). null = выключено. */
  token?: string | null;
  /** Чат алертов владельца (по умолчанию TELEGRAM_CHAT_ID). */
  alertsChatId?: string | null;
  origin?: string | null;
  fetchImpl?: typeof fetch;
  collectors?: Collectors;
};

type Recipient = { id: UserId; role: string };

async function resolveChat(db: AnyDb, u: Recipient, alertsChatId: string | null): Promise<string | null> {
  const [row] = await db.select({ chatId: telegramChats.chatId }).from(telegramChats).where(eq(telegramChats.userId, u.id)).limit(1);
  if (row) return row.chatId;
  return u.role === 'owner' ? alertsChatId : null;
}

/** Атомарная отметка до отправки: true = мы владеем отправкой этой недели. */
async function claim(db: AnyDb, kind: string, now: Date): Promise<boolean> {
  const rows = await db.insert(notifyLog).values({ kind, lastSentAt: now, sentOn: mskDateString(now) }).onConflictDoNothing().returning({ kind: notifyLog.kind });
  return rows.length > 0;
}

async function release(db: AnyDb, kind: string, now: Date): Promise<void> {
  try {
    await db.delete(notifyLog).where(and(eq(notifyLog.kind, kind), eq(notifyLog.lastSentAt, now)));
  } catch {
    console.error('digest: не удалось снять отметку отправки');
  }
}

export async function runDigestForUser(db: AnyDb, u: Recipient, week: DigestWeek, deps: DigestDeps = {}): Promise<DigestResultKind> {
  const now = deps.now ?? new Date();
  const kind = digestKind(u.id, week.from);
  let claimed = false;
  try {
    const token = deps.token === undefined ? getBotToken() : deps.token;
    if (!token) return 'telegram_disabled';
    const alerts = deps.alertsChatId === undefined ? (process.env.TELEGRAM_CHAT_ID?.trim() || null) : deps.alertsChatId;
    const chatId = await resolveChat(db, u, alerts);
    if (!chatId) return 'no_target';
    const [done] = await db.select({ kind: notifyLog.kind }).from(notifyLog).where(eq(notifyLog.kind, kind)).limit(1);
    if (done) return 'already_sent';
    claimed = await claim(db, kind, now);
    if (!claimed) return 'already_sent';

    const [state] = await db.select({ last: digestState.lastAdviceGameId }).from(digestState).where(eq(digestState.userId, u.id)).limit(1);
    const { data, failed } = await collectDigest(db, u.id, week, { now, lastAdviceGameId: state?.last ?? null, collectors: deps.collectors });
    // все блоки упали (БД недоступна): не слать ложную «пустую неделю»
    if (failed >= BLOCK_COUNT) throw new Error('digest: нет данных');
    const text = formatDigest(data, { origin: deps.origin === undefined ? getAppOrigin() : deps.origin });
    const sent = await sendTelegram(text, { env: { token, chatId }, fetchImpl: deps.fetchImpl });
    if (!sent) {
      await release(db, kind, now);
      claimed = false;
      return 'send_failed';
    }
    try {
      await db
        .insert(digestState)
        .values({ userId: u.id, lastSentAt: now, lastWeek: week.from, lastAdviceGameId: data.advice?.gameId ?? null })
        .onConflictDoUpdate({
          target: digestState.userId,
          set: { lastSentAt: now, lastWeek: week.from, ...(data.advice ? { lastAdviceGameId: data.advice.gameId } : {}) },
        });
    } catch {
      console.error('digest: состояние сводки не записано');
    }
    return 'sent';
  } catch {
    console.error('digest: сводка пользователя не отправлена');
    if (claimed) await release(db, kind, now);
    return 'error';
  }
}

/** Старые ключи дедупа (старше 10 недель) удаляются. Не бросает. */
async function prune(db: AnyDb, now: Date): Promise<void> {
  try {
    await db.delete(notifyLog).where(and(like(notifyLog.kind, `${DIGEST_KIND_PREFIX}%`), lt(notifyLog.sentOn, addDays(mskDateString(now), -70))));
  } catch {
    // не критично
  }
}

export const DIGEST_BUDGET_MS = 40_000;

/**
 * Запуск для всех активных пользователей. null, если сегодня не день сводки (воскресенье / догоняющий понедельник МСК)
 * и нет force. Пользователи по очереди; не успевшие до бюджета получают 'skipped' (без отметки, уйдут на догоняющем запуске).
 */
export async function runDigest(db: AnyDb, o: DigestDeps & { force?: boolean; budgetMs?: number } = {}): Promise<DigestRunResult | null> {
  const now = o.now ?? new Date();
  const target = digestTarget(now, o.force === true);
  if (!target) return null;
  const started = Date.now();
  let users: Recipient[] = [];
  try {
    const rows = await db.select({ id: allowedUsers.id, role: allowedUsers.role }).from(allowedUsers).where(eq(allowedUsers.status, 'active')).orderBy(sql`${allowedUsers.role} = 'owner' desc`, allowedUsers.id);
    users = rows.map((r) => ({ id: asUserId(r.id), role: r.role }));
  } catch {
    console.error('digest: список пользователей не получен');
    return { week: target.week.from, results: [] };
  }
  await prune(db, now);
  const results: DigestUserResult[] = [];
  for (const u of users) {
    if (Date.now() - started > (o.budgetMs ?? DIGEST_BUDGET_MS)) {
      results.push({ userId: u.id, result: 'skipped' });
      continue;
    }
    results.push({ userId: u.id, result: await runDigestForUser(db, u, target.week, o) });
  }
  return { week: target.week.from, results };
}
