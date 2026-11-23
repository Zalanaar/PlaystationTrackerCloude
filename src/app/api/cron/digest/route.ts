import { NextResponse } from 'next/server';
import { checkBearer } from '@/server/auth/password';
import { getCronSecret } from '@/server/env';
import { fail } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Сводка в Telegram отключена (решение 23.11). Маршрут оставлен, чтобы старые вызовы
// (в vercel.json его нет) не получали 404; писем больше не шлём. БД и env не трогаем.
export async function GET(req: Request) {
  if (!checkBearer(req.headers.get('authorization'), getCronSecret())) return fail(401, 'unauthorized', 'Не авторизован.');
  return NextResponse.json({ ok: true, data: { digest: null } }, { headers: { 'Cache-Control': 'no-store' } });
}
