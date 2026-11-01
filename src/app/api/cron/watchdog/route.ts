import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { runWeeklyBackup, type BackupJobResult } from '@/server/backup/weekly';
import { getCronSecret, getPsnEnv } from '@/server/env';
import { checkBearer } from '@/server/auth/password';
import { fail } from '@/server/http';
import { getOwnerUserId } from '@/server/auth/users';
import { alertOwnerMissing, runSyncWatchdog, type WatchdogResult } from '@/server/notify/watchdog';
import { runDigest, type DigestRunResult } from '@/server/digest/run';
import { listSyncUsers } from '@/server/sync/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'no-store' };
const BACKUP_PARALLEL = 4;

// Cron раз в сутки (vercel.json): алерт «синк не запускался» и еженедельная копия разметки в Telegram по каждому пользователю,
// всё владельцу. Контракт 20.2, 20.3, 22.13. Проверки независимы: сбой одной не мешает другой. Ошибки БД попадают в поле результата.
export async function GET(req: Request) {
  if (!checkBearer(req.headers.get('authorization'), getCronSecret())) return fail(401, 'unauthorized', 'Не авторизован.');
  let db;
  try {
    db = getDb();
  } catch {
    return NextResponse.json({ ok: true, data: { sync: { isOverdue: false, ageHours: null, alert: 'error' }, backup: { result: 'error' } } }, { headers: NO_STORE });
  }
  const ownerId = await getOwnerUserId(db).catch(() => null);
  if (ownerId === null) {
    // без owner молчать нельзя (N-2): ошибка в логах cron и сообщение в Telegram раз в сутки
    console.error('watchdog: owner не найден в allowed_users');
    const alert = await alertOwnerMissing(db);
    return fail(500, 'config_error', 'Владелец не найден в списке доступа.', { alert });
  }
  // подходящие пользователи; владелец без своего ника идёт через fallback env, а при отсутствии настроек PSN всё равно проверяется сам
  const env = getPsnEnv();
  const listed = await listSyncUsers(db, env?.targetOnlineId ?? '__none__').catch(() => []);
  const targets = [{ id: ownerId, onlineId: listed.find((u) => u.id === ownerId)?.onlineId ?? null }, ...listed.filter((u) => u.id !== ownerId)];

  const users: Array<{ userId: number } & WatchdogResult & { backup?: BackupJobResult }> = [];
  for (const t of targets) {
    const isOwner = t.id === ownerId;
    const r = await runSyncWatchdog(db, t.id, { kindSuffix: isOwner ? undefined : `:${t.id}`, label: isOwner ? undefined : (t.onlineId ?? undefined) });
    users.push({ userId: t.id, ...r });
  }
  const sync = users[0];

  const results: BackupJobResult[] = [];
  for (let i = 0; i < targets.length; i += BACKUP_PARALLEL) {
    const part = targets.slice(i, i + BACKUP_PARALLEL);
    results.push(...(await Promise.all(part.map((t) => runWeeklyBackup(db, t.id, { kindSuffix: t.id === ownerId ? undefined : `:${t.id}`, label: t.id === ownerId ? undefined : (t.onlineId ?? undefined) })))));
  }
  results.forEach((r, i) => {
    users[i].backup = r;
  });
  const ownerBackup = results[0];
  // Фаза 29 (F29.2): недельная сводка в воскресенье МСК и догоняющий запуск в понедельник; в остальные дни digest = null. Не бросает.
  const digest: DigestRunResult | null = await runDigest(db).catch(() => null);
  return NextResponse.json(
    { ok: true, data: { sync: { isOverdue: sync.isOverdue, ageHours: sync.ageHours, alert: sync.alert }, users, backup: { result: ownerBackup }, digest } },
    { headers: NO_STORE },
  );
}
