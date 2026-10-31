import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { buildBackup } from '@/server/backup/export';
import { backupFileName } from '@/server/backup/format';
import { fail } from '@/server/http';
import { mskDateString } from '@/server/stats/period';
import { requireUser } from '@/server/auth/require-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Скачать резервную копию разметки. Тело ответа: сам файл (не конверт). Контракт 20.3.
export async function GET(req: Request) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  try {
    const now = new Date();
    const file = await buildBackup(getDb(), a.user.id, now);
    return new NextResponse(JSON.stringify(file, null, 1), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${backupFileName(mskDateString(now))}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
