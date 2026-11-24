import { getDb } from '@/db';
import { getCatalogGame } from '@/server/catalog/rawg';
import { getRawgKey } from '@/server/env';
import { fail, okRevalidated } from '@/server/http';
import { getRoadmap } from '@/server/roadmap/db';
import { refreshPlannedReleaseDates } from '@/server/roadmap/sync-release-dates';
import { rawgReserve } from '@/server/usage/rawg-reserve';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Посчитанный план на лету. Контракт 17.5.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    const db = getDb();
    const apiKey = getRawgKey();
    if (apiKey) {
      // Существующие «на релизе»: подтянуть новую дату, даже если вкладку релизов не открывали. Сбой каталога план не валит.
      await refreshPlannedReleaseDates(db, a.user.id, {
        fetchGame: (id) => getCatalogGame(id, { apiKey, reserve: rawgReserve(a.user.id) }),
      }).catch(() => []);
    }
    return okRevalidated(req, await getRoadmap(db, a.user.id));
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
