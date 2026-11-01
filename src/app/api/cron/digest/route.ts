import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { checkBearer } from '@/server/auth/password';
import { runDigest } from '@/server/digest/run';
import { getCronSecret } from '@/server/env';
import { fail } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Ручной запуск недельной сводки (контракт F29.2). По расписанию её запускает cron watchdog (лимит Hobby: 2 задания).
// ?force=1 игнорирует день недели (неделя = текущая по МСК).
export async function GET(req: Request) {
  if (!checkBearer(req.headers.get('authorization'), getCronSecret())) return fail(401, 'unauthorized', 'Не авторизован.');
  const force = new URL(req.url).searchParams.get('force') === '1';
  try {
    const digest = await runDigest(getDb(), { force });
    return NextResponse.json({ ok: true, data: { digest } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: true, data: { digest: { week: null, results: [] } } }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
