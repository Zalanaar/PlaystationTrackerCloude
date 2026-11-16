import { getDb } from '@/db';
import { fail } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { buildIcs, getReleases } from '@/server/roadmap/releases-ics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// П12.6 (контракт «П12. Календарь релизов»): GET — файл .ics с релизами плана и бэклога «вручную» (сегодня и позже).
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    const now = new Date();
    const body = buildIcs(await getReleases(getDb(), a.user.id, now), now);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="releases.ics"',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
