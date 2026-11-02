import { getDb } from '@/db';
import { requireUser } from '@/server/auth/require-user';
import { readJsonBody } from '@/server/collection/http';
import { fail, ok } from '@/server/http';
import { answerMatch, ManualNotFoundError } from '@/server/manual/store';
import { parseManualId, parseMatchAnswer } from '@/server/manual/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ответ на «Это та игра?»: yes = склеить с предложенной игрой библиотеки, no = запомнить пару и больше не предлагать. Контракт Фазы 43, 43.5.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseManualId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const p = parseMatchAnswer(read.body);
  if (!p.ok) return fail(400, 'invalid_request', p.message);
  try {
    return ok({ id, answer: p.value, ...(await answerMatch(getDb(), a.user.id, id, p.value)) });
  } catch (e) {
    if (e instanceof ManualNotFoundError) return fail(404, 'not_found', 'Вопрос не найден.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
