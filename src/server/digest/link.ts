// Привязка чата Telegram к пользователю (контракт F29.6, F29.7). Коды одноразовые, живут 15 минут, в БД только sha256.
// Токены и секреты не логируются; открытый код не пишется в логи.
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';

const { telegramChats, telegramLinkCodes, telegramLinkAttempts, allowedUsers } = schema;

export const CODE_TTL_MS = 15 * 60_000;
export const ATTEMPT_WINDOW_MS = 10 * 60_000;
export const MAX_WRONG_ATTEMPTS = 5;
export const MAX_CODES_PER_WINDOW = 5;
/** Алфавит без 0/O/1/I: 32 символа, байт & 31 даёт равномерный выбор. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[bytes[i] & 31];
  return s;
}

/** Нормализованный код (верхний регистр) или null, если формат неверный. */
export function normalizeCode(raw: string | undefined | null): string | null {
  const s = (raw ?? '').trim().toUpperCase();
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

export const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

/** Служебный «chat_id» счётчика создания кодов пользователя (та же таблица попыток). */
const creatorKey = (userId: number) => `user:${userId}`;

async function countRecent(db: AnyDb, key: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - ATTEMPT_WINDOW_MS);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(telegramLinkAttempts)
    .where(and(eq(telegramLinkAttempts.chatId, key), gt(telegramLinkAttempts.attemptedAt, since)));
  return r?.n ?? 0;
}

async function recordAttempt(db: AnyDb, key: string, now: Date): Promise<void> {
  await db.insert(telegramLinkAttempts).values({ chatId: key, attemptedAt: now });
  // чистка старых записей этого ключа
  await db.delete(telegramLinkAttempts).where(and(eq(telegramLinkAttempts.chatId, key), sql`${telegramLinkAttempts.attemptedAt} <= ${new Date(now.getTime() - ATTEMPT_WINDOW_MS)}`));
}

export type CreatedCode = { ok: true; code: string; expiresAt: Date } | { ok: false; reason: 'rate_limited' };

/** Создаёт код привязки (заменяет прежний). Не чаще MAX_CODES_PER_WINDOW за 10 минут на пользователя. */
export async function createLinkCode(db: AnyDb, userId: UserId, now: Date = new Date()): Promise<CreatedCode> {
  const key = creatorKey(userId);
  if ((await countRecent(db, key, now)) >= MAX_CODES_PER_WINDOW) return { ok: false, reason: 'rate_limited' };
  await recordAttempt(db, key, now);
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await db
    .insert(telegramLinkCodes)
    .values({ userId, codeHash: hashCode(code), expiresAt, createdAt: now })
    .onConflictDoUpdate({ target: telegramLinkCodes.userId, set: { codeHash: hashCode(code), expiresAt, createdAt: now } });
  return { ok: true, code, expiresAt };
}

export type BindResult =
  | { kind: 'ok'; userId: number; label: string }
  | { kind: 'already_same'; label: string }
  | { kind: 'chat_taken' }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'rate_limited' };

const labelOf = (u: { psnOnlineId: string | null; displayName: string | null }): string => u.psnOnlineId ?? u.displayName ?? 'PS Tracker';

/**
 * `/start <код>` из чата chatId. Неверные коды считаются (5 за 10 минут на чат). Успешный код гасится атомарно
 * (UPDATE ... WHERE expires_at > now), поэтому повтор и параллельная отправка не привязывают дважды.
 */
export async function bindChat(db: AnyDb, chatId: string, rawCode: string | undefined, now: Date = new Date()): Promise<BindResult> {
  if ((await countRecent(db, chatId, now)) >= MAX_WRONG_ATTEMPTS) return { kind: 'rate_limited' };
  const code = normalizeCode(rawCode);
  const hash = code ? hashCode(code) : null;
  const [row] = hash
    ? await db
        .select({ userId: telegramLinkCodes.userId, expiresAt: telegramLinkCodes.expiresAt, status: allowedUsers.status, psnOnlineId: allowedUsers.psnOnlineId, displayName: allowedUsers.displayName })
        .from(telegramLinkCodes)
        .innerJoin(allowedUsers, eq(allowedUsers.id, telegramLinkCodes.userId))
        .where(eq(telegramLinkCodes.codeHash, hash))
        .limit(1)
    : [];
  if (!row || row.status !== 'active') {
    await recordAttempt(db, chatId, now);
    return { kind: 'invalid' };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    await recordAttempt(db, chatId, now);
    return { kind: 'expired' };
  }
  const [existing] = await db.select({ userId: telegramChats.userId }).from(telegramChats).where(eq(telegramChats.chatId, chatId)).limit(1);
  if (existing) {
    if (existing.userId === row.userId) {
      await db.update(telegramLinkCodes).set({ expiresAt: now }).where(and(eq(telegramLinkCodes.codeHash, hash!), gt(telegramLinkCodes.expiresAt, now)));
      return { kind: 'already_same', label: labelOf(row) };
    }
    return { kind: 'chat_taken' };
  }
  const consumed = await db
    .update(telegramLinkCodes)
    .set({ expiresAt: now })
    .where(and(eq(telegramLinkCodes.codeHash, hash!), gt(telegramLinkCodes.expiresAt, now)))
    .returning({ userId: telegramLinkCodes.userId });
  if (consumed.length === 0) return { kind: 'expired' };
  try {
    await db
      .insert(telegramChats)
      .values({ userId: row.userId, chatId, linkedAt: now })
      .onConflictDoUpdate({ target: telegramChats.userId, set: { chatId, linkedAt: now } });
  } catch {
    // уникальность chat_id: другой пользователь успел занять чат
    return { kind: 'chat_taken' };
  }
  return { kind: 'ok', userId: row.userId, label: labelOf(row) };
}

/** `/stop`: удаляет привязку этого чата. true, если она была. */
export async function unlinkChat(db: AnyDb, chatId: string): Promise<boolean> {
  const r = await db.delete(telegramChats).where(eq(telegramChats.chatId, chatId)).returning({ userId: telegramChats.userId });
  return r.length > 0;
}

/** Отвязка с сайта: привязка и живой код пользователя. Идемпотентна. */
export async function unlinkUser(db: AnyDb, userId: UserId): Promise<void> {
  await db.delete(telegramChats).where(eq(telegramChats.userId, userId));
  await db.delete(telegramLinkCodes).where(eq(telegramLinkCodes.userId, userId));
}

export async function getLinkedChatId(db: AnyDb, userId: UserId): Promise<string | null> {
  const [r] = await db.select({ chatId: telegramChats.chatId }).from(telegramChats).where(eq(telegramChats.userId, userId)).limit(1);
  return r?.chatId ?? null;
}
