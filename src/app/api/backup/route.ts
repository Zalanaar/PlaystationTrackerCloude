import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { buildBackup } from '@/server/backup/export';
import { backupFileName } from '@/server/backup/format';
import { fail } from '@/server/http';
import { mskDateString } from '@/server/stats/period';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Скачать резервную копию разметки. Сессию проверяет src/proxy.ts. Тело ответа: сам файл (не конверт). Контракт 20.3.
export async function GET() {
  try {
    const now = new Date();
    const file = await buildBackup(getDb(), now);
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
