import { z } from 'zod';
import { getDb } from '@/db';
import { fail, ok, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getPushEnv, pushState, removeSubscription, saveSubscription, validSub } from '@/server/push/push';

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

// П14.2 (контракт «П14.2. Push-уведомления»): GET — настроен ли push и сколько устройств; POST — подписать это устройство; DELETE — отписать.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const env = getPushEnv();
  if (!env) return ok({ configured: false, publicKey: null, devices: 0 });
  try {
    const s = await pushState(getDb(), a.user.id, null);
    return ok({ configured: true, publicKey: env.publicKey, devices: s.devices });
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
