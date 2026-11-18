import { getDb, schema } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getPushEnv, sendToUser, webPushSender } from '@/server/push/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// П14.2: «Проверить» — тестовое уведомление на все устройства пользователя; не чаще раза в минуту (журнал push_log).
export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  const env = getPushEnv();
  if (!env) return fail(409, 'push_not_configured', 'Уведомления не настроены на сервере.');
  try {
    const db = getDb();
    const minute = new Date().toISOString().slice(0, 16);
    const claimed = await db.insert(schema.pushLog).values({ userId: a.user.id, kind: 'test', ref: minute }).onConflictDoNothing().returning({ u: schema.pushLog.userId });
    if (claimed.length === 0) return fail(429, 'rate_limited', 'Не чаще раза в минуту.', { retryAfterSec: 60 });
    const r = await sendToUser(db, a.user.id, { title: 'PS Tracker', body: 'Уведомления работают.', url: '/', tag: 'test' }, env, webPushSender);
    return ok(r);
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
