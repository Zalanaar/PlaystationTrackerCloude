import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/db';
import { fail, originAllowed } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { removeProfile } from '@/server/auth/profiles';
import { setActiveProfileCookie } from '@/server/auth/profile-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ confirmOnlineId: z.string().max(64), purge: z.boolean().optional() }).strict();

// Отвязка профиля (41.3): архив на 30 дней по умолчанию, purge:true безвозвратно. Основной профиль отвязать нельзя.
export async function DELETE(req: Request, ctx: Ctx) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  if (!originAllowed(req) || !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  const { id: rawId } = await ctx.params;
  const id = /^[1-9]\d{0,9}$/.test(rawId) && Number(rawId) <= 2147483647 ? Number(rawId) : null;
  let input: z.infer<typeof body>;
  try {
    const r = body.safeParse(await req.json());
    if (!r.success || id === null) return fail(400, 'invalid_request', 'Некорректный запрос.');
    input = r.data;
  } catch {
    return fail(400, 'invalid_request', 'Некорректный запрос.');
  }
  try {
    const r = await removeProfile(getDb(), a.user.loginId, id, input.confirmOnlineId, input.purge === true);
    switch (r.kind) {
      case 'not_found':
        return fail(404, 'not_found', 'Профиль не найден.');
      case 'primary_protected':
        return fail(409, 'primary_protected', 'Основной профиль отвязать нельзя.');
      case 'sync_in_progress':
        return fail(409, 'sync_in_progress', 'У профиля идёт синк. Подождите завершения.');
      case 'confirm_mismatch':
        return fail(400, 'confirm_mismatch', 'Ник не совпадает.');
      default: {
        const wasActive = id === a.user.id;
        const activeProfileId = wasActive ? a.user.loginId : a.user.id;
        const res = NextResponse.json(
          { ok: true, data: r.kind === 'purged' ? { purged: true, activeProfileId } : { archived: true, activeProfileId } },
          { headers: { 'Cache-Control': 'no-store' } },
        );
        if (wasActive) await setActiveProfileCookie(res, req, a.user.loginId);
        return res;
      }
    }
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
