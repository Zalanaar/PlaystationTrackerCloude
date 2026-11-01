import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { createLinkCode } from '@/server/digest/link';
import { getTelegramBotUsername, getTelegramWebhookSecret } from '@/server/env';
import { fail, ok, originAllowed } from '@/server/http';
import { getBotToken } from '@/server/notify/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Новый одноразовый код привязки чата (контракт F29.7). Код показывается только в этом ответе.
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (getBotToken() === null || getTelegramWebhookSecret() === null) return fail(503, 'config_error', 'Бот Telegram на сервере не настроен.');
  try {
    const r = await createLinkCode(getDb(), a.user.id);
    if (!r.ok) return fail(429, 'rate_limited', 'Слишком много кодов. Подожди несколько минут.');
    const bot = getTelegramBotUsername();
    return ok({ code: r.code, expiresAt: r.expiresAt.toISOString(), deepLink: bot ? `https://t.me/${bot}?start=${r.code}` : null });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
