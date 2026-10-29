import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { getSettings, putSettings } from '@/server/roadmap/db';
import { parseSettingsBody } from '@/server/roadmap/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Год и бюджет часов в неделю. Контракт 17.3.
export async function GET() {
  try {
    return ok({ settings: await getSettings(getDb()) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function PUT(req: Request) {
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseSettingsBody(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ settings: await putSettings(getDb(), p.value) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
