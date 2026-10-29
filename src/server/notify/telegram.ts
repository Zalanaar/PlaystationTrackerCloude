// Предупреждения о протухании NPSSO в Telegram (контракт 15.4). Необязательный модуль: без TELEGRAM_BOT_TOKEN и
// TELEGRAM_CHAT_ID ничего не делает и не падает. Токен бота не логируется и не попадает в тексты ошибок.
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { mskDateString } from '@/server/stats/period';

const { syncRuns, psnAuth, notifyLog } = schema;

export const STALE_SYNC_MS = 3 * 86400_000;
export const TOKEN_AGE_MS = 7 * 86400_000;
export const TELEGRAM_TIMEOUT_MS = 8000;
const DAY_MS = 86400_000;
const DOC = 'Инструкция: docs/release.md, раздел 3 (Обновление NPSSO).';

export type TelegramEnv = { token: string; chatId: string };

/** null, если не заданы обе переменные. */
export function getTelegramEnv(env: Record<string, string | undefined> = process.env): TelegramEnv | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  return token && chatId ? { token, chatId } : null;
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

export type NotifyKind = 'auth_expired' | 'npsso_invalid' | 'sync_stale' | 'token_age';

const days = (ms: number) => Math.max(1, Math.floor(ms / DAY_MS));

export function messageFor(kind: NotifyKind, o: { ageMs?: number } = {}): string {
  switch (kind) {
    case 'auth_expired':
      return `PS Tracker: PSN отклонил токен обновления, синк остановлен. Нужен новый NPSSO.\n${DOC}`;
    case 'npsso_invalid':
      return `PS Tracker: PSN отклонил NPSSO, синк остановлен. Замените PSN_NPSSO на Vercel.\n${DOC}`;
    case 'sync_stale':
      return `PS Tracker: синк не выполнялся успешно уже ${days(o.ageMs ?? STALE_SYNC_MS)} сут. Проверьте cron и NPSSO.\n${DOC}`;
    case 'token_age':
      return `PS Tracker: токены PSN не обновлялись ${days(o.ageMs ?? TOKEN_AGE_MS)} сут., refresh живёт около 10 суток. Возможно, скоро понадобится новый NPSSO.\n${DOC}`;
  }
}

export type NotifyAfterSyncOpts = {
  now?: Date;
  /** Причина, с которой только что завершилось звено (failed). */
  errorReason?: string | null;
  env?: TelegramEnv | null;
  fetchImpl?: typeof fetch;
};

/**
 * Определяет самый приоритетный сработавший триггер (auth > stale > token_age) и шлёт не чаще раза в сутки МСК на тип.
 * Возвращает отправленный тип или null. Не бросает.
 */
export async function notifyAfterSync(db: AnyDb, o: NotifyAfterSyncOpts = {}): Promise<NotifyKind | null> {
  try {
    const env = o.env === undefined ? getTelegramEnv() : o.env;
    if (!env) return null;
    const now = o.now ?? new Date();

    const trigger = await pickTrigger(db, now, o.errorReason ?? null);
    if (!trigger) return null;

    const today = mskDateString(now);
    const [prev] = await db.select({ sentOn: notifyLog.sentOn }).from(notifyLog).where(eq(notifyLog.kind, trigger.kind)).limit(1);
    if (prev && prev.sentOn >= today) return null;

    const sent = await sendTelegram(messageFor(trigger.kind, { ageMs: trigger.ageMs }), { env, fetchImpl: o.fetchImpl });
    if (!sent) return null;
    await db
      .insert(notifyLog)
      .values({ kind: trigger.kind, lastSentAt: now, sentOn: today })
      .onConflictDoUpdate({ target: notifyLog.kind, set: { lastSentAt: sql`excluded."last_sent_at"`, sentOn: sql`excluded."sent_on"` } });
    return trigger.kind;
  } catch {
    console.error('notify: проверка уведомлений не выполнена');
    return null;
  }
}

async function pickTrigger(db: AnyDb, now: Date, errorReason: string | null): Promise<{ kind: NotifyKind; ageMs?: number } | null> {
  if (errorReason === 'auth_expired' || errorReason === 'npsso_invalid') return { kind: errorReason };

  const [lastSuccess] = await db
    .select({ at: syncRuns.finishedAt, startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(and(ne(syncRuns.kind, 'hltb'), eq(syncRuns.status, 'success')))
    .orderBy(desc(syncRuns.startedAt), desc(syncRuns.id))
    .limit(1);
  let reference = lastSuccess ? (lastSuccess.at ?? lastSuccess.startedAt) : null;
  if (!lastSuccess) {
    const [firstRun] = await db.select({ startedAt: syncRuns.startedAt }).from(syncRuns).where(ne(syncRuns.kind, 'hltb')).orderBy(syncRuns.startedAt).limit(1);
    reference = firstRun?.startedAt ?? null;
  }
  if (reference && now.getTime() - reference.getTime() > STALE_SYNC_MS) return { kind: 'sync_stale', ageMs: now.getTime() - reference.getTime() };

  const [auth] = await db.select({ updatedAt: psnAuth.updatedAt }).from(psnAuth).where(eq(psnAuth.id, 1)).limit(1);
  if (auth && now.getTime() - auth.updatedAt.getTime() >= TOKEN_AGE_MS) return { kind: 'token_age', ageMs: now.getTime() - auth.updatedAt.getTime() };
  return null;
}
