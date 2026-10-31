// Предупреждения о протухании NPSSO в Telegram (контракт 15.4). Необязательный модуль: без TELEGRAM_BOT_TOKEN и
// TELEGRAM_CHAT_ID ничего не делает и не падает. Токен бота не логируется и не попадает в тексты ошибок.
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { getAppOrigin } from '@/server/env';
import { mskDateString } from '@/server/stats/period';

const { syncRuns, psnAuth, notifyLog } = schema;

export const STALE_SYNC_MS = 3 * 86400_000;
export const TOKEN_AGE_MS = 7 * 86400_000;
export const TELEGRAM_TIMEOUT_MS = 8000;
export const TELEGRAM_DOC_TIMEOUT_MS = 15_000;
const DAY_MS = 86400_000;
const DOC = 'Инструкция: docs/release.md, раздел 3 (Обновление NPSSO).';

export type TelegramEnv = { token: string; chatId: string };

/** null, если не заданы обе переменные. */
export function getTelegramEnv(env: Record<string, string | undefined> = process.env): TelegramEnv | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

/**
 * Абсолютная ссылка на игру `{origin}/?game=<id>` (контракт 15.4). null, если APP_ORIGIN не задан или у игры нет
 * записи в библиотеке (gameId не положительное целое): тогда ссылку не добавляем.
 */
export function gameLink(gameId: number | null | undefined, origin: string | null = getAppOrigin()): string | null {
  if (!origin || gameId === null || gameId === undefined || !Number.isSafeInteger(gameId) || gameId <= 0) return null;
  return `${origin}/?game=${gameId}`;
}

/** Строка сообщения про игру: «Название» плюс ссылка на новой строке, если она есть. Не бросает. */
export function gameLine(title: string, gameId: number | null | undefined, origin: string | null = getAppOrigin()): string {
  const link = gameLink(gameId, origin);
  return link ? `${title}\n${link}` : title;
}

/** Отправка одного сообщения. Любая ошибка проглатывается (false); в консоль идёт только короткий код. */
export async function sendTelegram(text: string, o: { env?: TelegramEnv | null; fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  const env = o.env === undefined ? getTelegramEnv() : o.env;
  if (!env) return false;
  try {
    const res = await (o.fetchImpl ?? fetch)(`https://api.telegram.org/bot${env.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      cache: 'no-store',
    });
    await res.body?.cancel();
    if (!res.ok) {
      console.error(`notify: telegram http ${res.status}`);
      return false;
    }
    return true;
  } catch {
    // текст исключения может содержать URL с токеном: не выводим
    console.error('notify: telegram недоступен');
    return false;
  }
}

/**
 * Отправка файла документом (контракт 20.3). Любая ошибка проглатывается (false); токен в логи не попадает.
 * Файл уходит как multipart; подпись до 1024 символов.
 */
export async function sendTelegramDocument(
  file: { name: string; content: string; caption?: string },
  o: { env?: TelegramEnv | null; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  const env = o.env === undefined ? getTelegramEnv() : o.env;
  if (!env) return false;
  try {
    const form = new FormData();
    form.set('chat_id', env.chatId);
    if (file.caption) form.set('caption', file.caption.slice(0, 1000));
    form.set('document', new Blob([file.content], { type: 'application/json' }), file.name);
    const res = await (o.fetchImpl ?? fetch)(`https://api.telegram.org/bot${env.token}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TELEGRAM_DOC_TIMEOUT_MS),
      cache: 'no-store',
    });
    await res.body?.cancel();
    if (!res.ok) {
      console.error(`notify: telegram document http ${res.status}`);
      return false;
    }
    return true;
  } catch {
    console.error('notify: telegram недоступен (документ)');
    return false;
  }
}

/** Дата (МСК) последней отправки данного вида или null. Для дедупа раз в сутки / раз в неделю. */
export async function lastSentOn(db: AnyDb, kind: string): Promise<string | null> {
  const [r] = await db.select({ sentOn: notifyLog.sentOn }).from(notifyLog).where(eq(notifyLog.kind, kind)).limit(1);
  return r?.sentOn ?? null;
}

export async function markSent(db: AnyDb, kind: string, now: Date): Promise<void> {
  const today = mskDateString(now);
  await db
    .insert(notifyLog)
    .values({ kind, lastSentAt: now, sentOn: today })
    .onConflictDoUpdate({ target: notifyLog.kind, set: { lastSentAt: sql`excluded."last_sent_at"`, sentOn: sql`excluded."sent_on"` } });
}

export type SendClaim = { claimed: boolean; prev: { lastSentAt: Date; sentOn: string } | null };

/**
 * Атомарно «занимает» отправку на сегодня (МСК): строка notify_log обновляется только если там дата раньше сегодняшней.
 * Два параллельных вызова: claimed=true получит один (N-7). Если отправка не удалась, вызвать releaseSend(prev).
 */
export async function claimSend(db: AnyDb, kind: string, now: Date): Promise<SendClaim> {
  const today = mskDateString(now);
  const [before] = await db.select({ lastSentAt: notifyLog.lastSentAt, sentOn: notifyLog.sentOn }).from(notifyLog).where(eq(notifyLog.kind, kind)).limit(1);
  const rows = await db
    .insert(notifyLog)
    .values({ kind, lastSentAt: now, sentOn: today })
    .onConflictDoUpdate({
      target: notifyLog.kind,
      set: { lastSentAt: sql`excluded."last_sent_at"`, sentOn: sql`excluded."sent_on"` },
      setWhere: sql`${notifyLog.sentOn} < excluded."sent_on"`,
    })
    .returning({ kind: notifyLog.kind });
  return { claimed: rows.length > 0, prev: before ?? null };
}

/** Отменяет claimSend после неудачной отправки: возвращает прежнюю запись, чтобы следующий запуск мог повторить. */
export async function releaseSend(db: AnyDb, kind: string, claim: SendClaim, now: Date): Promise<void> {
  if (!claim.claimed) return;
  try {
    if (claim.prev) {
      await db.update(notifyLog).set({ lastSentAt: claim.prev.lastSentAt, sentOn: claim.prev.sentOn }).where(and(eq(notifyLog.kind, kind), eq(notifyLog.lastSentAt, now)));
    } else {
      await db.delete(notifyLog).where(and(eq(notifyLog.kind, kind), eq(notifyLog.lastSentAt, now)));
    }
  } catch {
    console.error('notify: не удалось снять отметку отправки');
  }
}

export type NotifyKind = 'auth_expired' | 'npsso_invalid' | 'sync_stale' | 'token_age' | 'sync_missed';

const days = (ms: number) => Math.max(1, Math.floor(ms / DAY_MS));

/** Подпись пользователя в предупреждениях владельцу (только ник PSN, без email). */
const forUser = (label?: string): string => (label ? `\nПользователь: ${label.slice(0, 40)}.` : '');

export function messageFor(kind: NotifyKind, o: { ageMs?: number; label?: string } = {}): string {
  switch (kind) {
    case 'auth_expired':
      return `PS Tracker: PSN отклонил токен обновления, синк остановлен. Нужен новый NPSSO.\n${DOC}`;
    case 'npsso_invalid':
      return `PS Tracker: PSN отклонил NPSSO, синк остановлен. Замените PSN_NPSSO на Vercel.\n${DOC}`;
    case 'sync_stale':
      return `PS Tracker: синк не выполнялся успешно уже ${days(o.ageMs ?? STALE_SYNC_MS)} сут. Проверьте cron и NPSSO.${forUser(o.label)}\n${DOC}`;
    case 'sync_missed': {
      const h = Math.max(1, Math.floor((o.ageMs ?? 0) / 3_600_000));
      return `PS Tracker: синк не выполнялся успешно уже ${h} ч (порог 30 ч). Проверьте cron на Vercel и NPSSO.${forUser(o.label)}\n${DOC}`;
    }
    case 'token_age':
      return `PS Tracker: токены PSN не обновлялись ${days(o.ageMs ?? TOKEN_AGE_MS)} сут., refresh живёт около 10 суток. Возможно, скоро понадобится новый NPSSO.\n${DOC}`;
  }
}

export type NotifyAfterSyncOpts = {
  now?: Date;
  /** Причина, с которой только что завершилось звено (failed). */
  errorReason?: string | null;
  /** Суффикс ключа дедупа для пользовательских событий (sync_stale:<id>, контракт 22.1); у владельца пусто. */
  kindSuffix?: string;
  /** Подпись пользователя в тексте (ник PSN). */
  label?: string;
  env?: TelegramEnv | null;
  fetchImpl?: typeof fetch;
};

/**
 * Определяет самый приоритетный сработавший триггер (auth > stale > token_age) и шлёт не чаще раза в сутки МСК на тип.
 * Возвращает отправленный тип или null. Не бросает.
 */
export async function notifyAfterSync(db: AnyDb, userId: UserId, o: NotifyAfterSyncOpts = {}): Promise<NotifyKind | null> {
  try {
    const env = o.env === undefined ? getTelegramEnv() : o.env;
    if (!env) return null;
    const now = o.now ?? new Date();

    const trigger = await pickTrigger(db, userId, now, o.errorReason ?? null);
    if (!trigger) return null;

    const today = mskDateString(now);
    // sync_stale относится к пользователю, остальные триггеры глобальные (один технический NPSSO)
    const key = trigger.kind === 'sync_stale' ? `${trigger.kind}${o.kindSuffix ?? ''}` : trigger.kind;
    const prev = await lastSentOn(db, key);
    if (prev && prev >= today) return null;

    const sent = await sendTelegram(messageFor(trigger.kind, { ageMs: trigger.ageMs, label: trigger.kind === 'sync_stale' ? o.label : undefined }), { env, fetchImpl: o.fetchImpl });
    if (!sent) return null;
    await markSent(db, key, now);
    return trigger.kind;
  } catch {
    console.error('notify: проверка уведомлений не выполнена');
    return null;
  }
}

async function pickTrigger(db: AnyDb, userId: UserId, now: Date, errorReason: string | null): Promise<{ kind: NotifyKind; ageMs?: number } | null> {
  if (errorReason === 'auth_expired' || errorReason === 'npsso_invalid') return { kind: errorReason };

  const [lastSuccess] = await db
    .select({ at: syncRuns.finishedAt, startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), ne(syncRuns.kind, 'hltb'), eq(syncRuns.status, 'success')))
    .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
    .limit(1);
  let reference = lastSuccess ? (lastSuccess.at ?? lastSuccess.startedAt) : null;
  if (!lastSuccess) {
    const [firstRun] = await db.select({ startedAt: syncRuns.startedAt }).from(syncRuns).where(and(eq(syncRuns.userId, userId), ne(syncRuns.kind, 'hltb'))).orderBy(syncRuns.startedAt).limit(1);
    reference = firstRun?.startedAt ?? null;
  }
  if (reference && now.getTime() - reference.getTime() > STALE_SYNC_MS) return { kind: 'sync_stale', ageMs: now.getTime() - reference.getTime() };

  const [auth] = await db.select({ updatedAt: psnAuth.updatedAt }).from(psnAuth).where(eq(psnAuth.id, 1)).limit(1);
  if (auth && now.getTime() - auth.updatedAt.getTime() >= TOKEN_AGE_MS) return { kind: 'token_age', ageMs: now.getTime() - auth.updatedAt.getTime() };
  return null;
}
