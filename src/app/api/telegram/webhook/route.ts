import { timingSafeEqual, createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { replyFor, type TelegramUpdate } from '@/server/digest/bot';
import { getAppOrigin, getTelegramWebhookSecret } from '@/server/env';
import { fail } from '@/server/http';
import { getBotToken, sendTelegram } from '@/server/notify/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_BODY = 64 * 1024;

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Сравнение без утечки по времени (хеши одинаковой длины). */
function secretOk(header: string | null, secret: string | null): boolean {
  if (!header || !secret) return false;
  return timingSafeEqual(digest(header), digest(secret));
}

// Webhook бота Telegram (контракт F29.6). Публичный путь: подлинность по X-Telegram-Bot-Api-Secret-Token.
// Все обработанные апдейты отвечают 200 (Telegram иначе ретраит); ошибки БД и отправки не раскрываются.
export async function POST(req: Request) {
  if (!secretOk(req.headers.get('x-telegram-bot-api-secret-token'), getTelegramWebhookSecret())) return fail(401, 'unauthorized', 'Не авторизован.');
  const okRes = () => NextResponse.json({ ok: true }, { headers: NO_STORE });
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) return okRes();
  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return okRes();
  }
  try {
    const reply = await replyFor(getDb(), update, { origin: getAppOrigin() });
    const token = getBotToken();
    if (reply && token) await sendTelegram(reply.text, { env: { token, chatId: reply.chatId } });
  } catch {
    console.error('telegram webhook: апдейт не обработан');
  }
  return okRes();
}
