import { z } from 'zod';
import { getDb } from '@/db';
import { getMultiuserEnv } from '@/server/env';
import { fail, ok, originAllowed } from '@/server/http';
import { requireOwner } from '@/server/auth/require-user';
import { deleteUser, patchUser, toAccessUserById } from '@/server/auth/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const patchBody = z
  .object({ status: z.enum(['active', 'blocked']).optional(), psnAccessMode: z.enum(['public', 'friend']).optional() })
  .refine((v) => v.status !== undefined || v.psnAccessMode !== undefined);
const deleteBody = z.object({ confirmEmail: z.string().max(320) });

async function parseId(ctx: Ctx): Promise<number | null> {
  const { id } = await ctx.params;
  return /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 2147483647 ? Number(id) : null;
}

async function readJson(req: Request): Promise<unknown | undefined> {
  if (!originAllowed(req) || !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return undefined;
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const a = await requireOwner(req);
  if (!a.ok) return a.response;
  const parsed = patchBody.safeParse(await readJson(req));
  const id = await parseId(ctx);
  if (!parsed.success || id === null) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (id === a.user.loginId && parsed.data.status === 'blocked') return fail(409, 'owner_protected', 'Нельзя заблокировать себя.');
  try {
    const db = getDb();
    const r = await patchUser(db, id, parsed.data, getMultiuserEnv().maxUsers);
    if (!r.ok) {
      if (r.reason === 'not_found') return fail(404, 'not_found', 'Пользователь не найден.');
      if (r.reason === 'owner_protected') return fail(409, 'owner_protected', 'Владельца нельзя заблокировать.');
      return fail(409, 'user_limit', 'Достигнут лимит пользователей.');
    }
    return ok({ user: await toAccessUserById(db, id) });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const a = await requireOwner(req);
  if (!a.ok) return a.response;
  const parsed = deleteBody.safeParse(await readJson(req));
  const id = await parseId(ctx);
  if (!parsed.success || id === null) return fail(400, 'invalid_request', 'Некорректный запрос.');
  if (id === a.user.loginId) return fail(409, 'owner_protected', 'Нельзя удалить себя.');
  try {
    const r = await deleteUser(getDb(), id, parsed.data.confirmEmail);
    if (!r.ok) {
      if (r.reason === 'not_found') return fail(404, 'not_found', 'Пользователь не найден.');
      if (r.reason === 'owner_protected') return fail(409, 'owner_protected', 'Владельца нельзя удалить.');
      if (r.reason === 'not_blocked') return fail(409, 'not_blocked', 'Сначала заблокируйте пользователя.');
      return fail(400, 'confirm_mismatch', 'Email не совпадает.');
    }
    return ok({ deleted: true });
  } catch {
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
