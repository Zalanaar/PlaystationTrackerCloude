import { getDb } from '@/db';
import { readJsonBody } from '@/server/collection/http';
import { parseGameId } from '@/server/collection/validation';
import { fail, ok } from '@/server/http';
import { requireUser } from '@/server/auth/require-user';
import { getGamePrice, parsePrice, PriceError, PRICE_MAX, setGamePrice } from '@/server/prices/prices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

// П13.3: GET — цена покупки игры; PUT { price } — целые рубли 0..1 000 000 или null (убрать).
export async function GET(req: Request, ctx: Ctx) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  try {
    return ok(await getGamePrice(getDb(), a.user.id, id));
  } catch (e) {
    if (e instanceof PriceError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const a = await requireUser(req);
  if (!a.ok) return a.response;
  const id = parseGameId((await ctx.params).id);
  if (id === null) return fail(400, 'invalid_request', 'Некорректный id игры.');
  const read = await readJsonBody(req);
  if ('error' in read) return read.error;
  const price = parsePrice((read.body as { price?: unknown } | null)?.price);
  if (price === undefined) return fail(400, 'invalid_request', `Цена: целое число рублей от 0 до ${PRICE_MAX}.`);
  try {
    return ok(await setGamePrice(getDb(), a.user.id, id, price));
  } catch (e) {
    if (e instanceof PriceError) return fail(404, 'not_found', 'Игра не найдена.');
    return fail(503, 'db_unavailable', 'База данных недоступна.');
  }
}
