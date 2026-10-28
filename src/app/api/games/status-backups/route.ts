import { getDb } from '@/db';
import { getLatestResetBackup } from '@/server/collection/mutations';
import { fail, ok } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Последняя копия reset_all для кнопки «Вернуть». Сессию проверяет src/proxy.ts. Контракт 9.9a.
export async function GET() {
  try {
    return ok(await getLatestResetBackup(getDb()));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
