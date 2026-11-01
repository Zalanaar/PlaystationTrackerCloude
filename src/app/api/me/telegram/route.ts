import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { getLinkedChatId, unlinkUser } from '@/server/digest/link';
import { getTelegramBotUsername, getTelegramWebhookSecret } from '@/server/env';
import { fail, ok, originAllowed } from '@/server/http';
import { getBotToken } from '@/server/notify/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function telegramProfile(db: ReturnType<typeof getDb>, loginId: number): Promise<{ id: number; onlineId: string | null }> {
  const [r] = await db.select({ onlineId: schema.allowedUsers.psnOnlineId }).from(schema.allowedUsers).where(eq(schema.allowedUsers.id, loginId)).limit(1);
  return { id: loginId, onlineId: r?.onlineId ?? null };
}

// Статус привязки Telegram ВХОДА сессии (контракт F29.7, 41.4): всегда основной профиль, независимо от активного.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    const db = getDb();
    const now = new Date();
    const [chatId, code, state] = await Promise.all([
      getLinkedChatId(db, a.user.loginId),
      db.select({ expiresAt: schema.telegramLinkCodes.expiresAt }).from(schema.telegramLinkCodes).where(eq(schema.telegramLinkCodes.userId, a.user.loginId)).limit(1),
      db.select({ lastSentAt: schema.digestState.lastSentAt }).from(schema.digestState).where(eq(schema.digestState.userId, a.user.loginId)).limit(1),
    ]);
    const botConfigured = getBotToken() !== null && getTelegramWebhookSecret() !== null;
    const alerts = a.user.role === 'owner' && !!process.env.TELEGRAM_CHAT_ID?.trim();
    const deliversTo = getBotToken() === null ? 'none' : chatId ? 'own_chat' : alerts ? 'alerts_chat' : 'none';
    const pending = code[0] && code[0].expiresAt.getTime() > now.getTime() ? { expiresAt: code[0].expiresAt.toISOString() } : null;
    return ok({
      botConfigured,
      botUsername: getTelegramBotUsername(),
      role: a.user.role,
      profile: await telegramProfile(db, a.user.loginId),
      linked: chatId !== null,
      deliversTo,
      lastSentAt: state[0]?.lastSentAt?.toISOString() ?? null,
      pendingCode: pending,
    });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

// Отвязка: привязка и живой код. Идемпотентна.
export async function DELETE(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    await unlinkUser(getDb(), a.user.loginId);
    return ok({ linked: false });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
