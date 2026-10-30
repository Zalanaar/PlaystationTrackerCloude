import { z } from 'zod';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { getMultiuserEnv } from '@/server/env';
import { fail, ok, originAllowed } from '@/server/http';
import { requireOwner } from '@/server/auth/require-user';
import { createMember, listAccessUsers, normalizeEmail, toAccessUserById } from '@/server/auth/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ email: z.string().max(320), role: z.literal('member').optional() });

export async function GET(req: Request) {
  const a = await requireOwner(req);
  if (!a.ok) return a.response;
  try {
    return ok({ users: await listAccessUsers(getDb()) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function POST(req: Request) {
  const a = await requireOwner(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req) || !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  let email: string | null;
  try {
    const r = body.safeParse(await req.json());
    if (!r.success) return fail(400, 'invalid_request', 'Некорректный запрос.');
    email = normalizeEmail(r.data.email);
  } catch {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  if (!email) return fail(400, 'invalid_request', 'Некорректный email.');

  const mu = getMultiuserEnv();
  if (!mu.enabled) return fail(409, 'multiuser_not_ready', 'Добавление пользователей пока недоступно.');
  try {
    const db = getDb();
    const mode = process.env.PSN_NEW_USER_MODE?.trim() === 'friend' ? 'friend' : 'public';
    const r = await createMember(db, email, a.user.id, mu.maxUsers, mode);
    if (!r.ok) {
      return r.reason === 'exists'
        ? fail(409, 'user_exists', 'Пользователь уже в списке.')
        : fail(409, 'user_limit', 'Достигнут лимит пользователей.');
    }
    const user = await toAccessUserById(db, r.id);
    return NextResponse.json({ ok: true, data: { user } }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
