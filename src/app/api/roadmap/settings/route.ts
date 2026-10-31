import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { getSettings, putSettings } from '@/server/roadmap/db';
import { parseSettingsBody } from '@/server/roadmap/validation';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Год и бюджет часов в неделю. Контракт 17.3.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    return ok({ settings: await getSettings(getDb(), a.user.id) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function PUT(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseSettingsBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ settings: await putSettings(getDb(), a.user.id, p.value) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
