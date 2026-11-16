import { getDb } from '@/db';
import { fail } from '@/server/http';
import { mskDate } from '@/server/stats/period';
import { getWrapped } from '@/server/wrapped/query';
import { parseWrappedQuery } from '@/server/wrapped/validation';
import { requireUser } from '@/server/auth/require-user';
import { shareModel } from '@/server/wrapped/share';
import { renderShareImage } from '@/server/wrapped/share-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П8.3: картинка «Итоги года» 1080×1920 (PNG) только для вошедшего пользователя; публичной ссылки нет, кэш private no-store.
// Только год (не «всё время»): ?year=2026; без year — текущий год МСК.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const now = new Date();
  const p = parseWrappedQuery(new URL(req.url).searchParams, mskDate(now).year);
  if (!p.ok || p.value.year === 'all') return fail(400, 'invalid_request', p.ok ? 'Картинка только для года.' : p.message);
  let data;
  try {
    const onlineId = a.user.row.psnOnlineId?.trim() || null;
    data = await getWrapped(getDb(), a.user.id, p.value.year, onlineId, now, { withService: p.value.withService, tz: p.value.tz });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
  if (data.mode !== 'story') return fail(404, 'not_found', 'За этот год данных нет.');
  try {
    return await renderShareImage(shareModel(data, mskDate(now).year));
  } catch {
    return fail(500, 'internal_error', 'Не удалось подготовить картинку.');
  }
}
