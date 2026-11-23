import { z } from 'zod';
import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getPushEnv, pushState, removeSubscription, saveSubscription, validSub } from '@/server/push/push';
import { getShelvedReminderPref, setShelvedReminderPref } from '@/server/push/shelved';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const subBody = z.object({ endpoint: z.string().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(200) }) });
const delBody = z.object({ endpoint: z.string().max(1000) });

async function parse<T>(req: Request, schema: z.ZodType<T>): Promise<T | null> {
  if (!originAllowed(req) || !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return null;
  try {
    const r = schema.safeParse(await req.json());
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// П14.2 (контракт «П14.2. Push-уведомления»): GET — настроен ли push, сколько устройств и включено ли напоминание об «Отложено»; POST — подписать это устройство; PATCH — переключатель напоминания; DELETE — отписать.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    const db = getDb();
    const shelvedReminder = await getShelvedReminderPref(db, a.user.id);
    const env = getPushEnv();
    if (!env) return ok({ configured: false, publicKey: null, devices: 0, shelvedReminder });
    const s = await pushState(db, a.user.id, null);
    return ok({ configured: true, publicKey: env.publicKey, devices: s.devices, shelvedReminder });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

const prefBody = z.object({ shelvedReminder: z.boolean() });

export async function PATCH(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const b = await parse(req, prefBody);
  if (!b) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    return ok({ shelvedReminder: await setShelvedReminderPref(getDb(), a.user.id, b.shelvedReminder) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function POST(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const b = await parse(req, subBody);
  if (!b || !validSub(b)) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (!getPushEnv()) return fail(409, 'push_not_configured', 'Уведомления не настроены на сервере.');
  try {
    const db = getDb();
    await saveSubscription(db, a.user.id, b);
    return ok({ subscribed: true, devices: (await pushState(db, a.user.id, null)).devices });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function DELETE(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const b = await parse(req, delBody);
  if (!b) return fail(400, 'invalid_request', 'Некорректный запрос.');
  try {
    const db = getDb();
    await removeSubscription(db, a.user.id, b.endpoint);
    return ok({ subscribed: false, devices: (await pushState(db, a.user.id, null)).devices });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
