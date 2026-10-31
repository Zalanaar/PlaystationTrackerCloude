import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { runWeeklyBackup } from '@/server/backup/weekly';
import { getCronSecret } from '@/server/env';
import { checkBearer } from '@/server/auth/password';
import { fail } from '@/server/http';
import { getOwnerUserId } from '@/server/auth/users';
import { runSyncWatchdog } from '@/server/notify/watchdog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Cron раз в сутки (vercel.json): алерт «синк не запускался» и еженедельная копия разметки в Telegram. Контракт 20.2, 20.3.
// Две проверки независимы: сбой одной не мешает другой. Ошибки БД попадают в поле результата, а не в HTTP-статус.
export async function GET(req: Request) {
  if (!checkBearer(req.headers.get('authorization'), getCronSecret())) return fail(401, 'unauthorized', 'Не авторизован.');
  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json({ ok: true, data: { sync: { isOverdue: false, ageHours: null, alert: 'error' }, backup: { result: 'error' } } }, { headers: { 'Cache-Control': 'no-store' } });
  }
  // 20.3: проверка и копия для владельца; обход всех пользователей: 20.4
  const ownerId = await getOwnerUserId(db).catch(() => null);
  if (ownerId === null) return NextResponse.json({ ok: true, data: { sync: { isOverdue: false, ageHours: null, alert: 'error' }, backup: { result: 'error' } } }, { headers: { 'Cache-Control': 'no-store' } });
  const sync = await runSyncWatchdog(db, ownerId);
  const backup = await runWeeklyBackup(db, ownerId);
  return NextResponse.json({ ok: true, data: { sync, backup: { result: backup } } }, { headers: { 'Cache-Control': 'no-store' } });
}
