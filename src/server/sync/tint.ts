// Шаг «цвет акцента» в конце успешного звена синка (контракт 15.2). Не фаза: число шагов прогресса не меняется.
// Ошибка любой обложки не роняет синк: tint остаётся NULL, tint_checked_at = now.
import { and, asc, isNull, lt, or, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { fetchImageBytes, isPublicHttpsImageUrl } from '@/server/psn/image';
import { TintUnavailableError, tintFromImage } from '@/server/tint/decode';
import type { RunContext } from './context';

const { games } = schema;

export const TINT_BATCH = 120;
export const TINT_CONCURRENCY = 6;
export const TINT_RETRY_MS = 7 * 86400_000;
/** Не начинать новую пачку, если до конца бюджета звена осталось меньше. */
export const TINT_MIN_LEFT_MS = 3000;

export type TintDeps = {
  fetchBytes: (url: string) => Promise<Uint8Array>;
  /** Байты -> #rrggbb или null (серое). Бросает при нечитаемой картинке. */
  decode: (bytes: Uint8Array) => Promise<string | null>;
};

export const defaultTintDeps: TintDeps = { fetchBytes: (u) => fetchImageBytes(u), decode: tintFromImage };

/** Цвет по обложке, при её неудаче/сером результате по баннеру. Бросает, только если не получилось ни с одним источником. */
async function tintFor(urls: readonly (string | null)[], deps: TintDeps): Promise<string | null> {
  const sources = urls.filter((u): u is string => isPublicHttpsImageUrl(u));
  if (sources.length === 0) throw new Error('нет https-источника');
  let lastError: unknown = null;
  for (const url of sources) {
    try {
      const t = await deps.decode(await deps.fetchBytes(url));
      if (t) return t;
    } catch (e) {
      if (e instanceof TintUnavailableError) throw e;
      lastError = e;
    }
  }
  if (lastError) throw lastError;
  return null;
}

export async function tintStep(ctx: RunContext, deps: TintDeps): Promise<{ done: number; failed: number }> {
  if (ctx.timeLeft() < TINT_MIN_LEFT_MS) return { done: 0, failed: 0 };
  const retryBefore = new Date(ctx.now().getTime() - TINT_RETRY_MS);
  const todo = await ctx.db
    .select({ id: games.id, imageUrl: games.imageUrl, bannerUrl: games.bannerUrl })
    .from(games)
    .where(
      and(
        isNull(games.tint),
        or(sql`${games.imageUrl} is not null`, sql`${games.bannerUrl} is not null`),
        or(isNull(games.tintCheckedAt), lt(games.tintCheckedAt, retryBefore)),
      ),
    )
    .orderBy(sql`${games.lastPlayedAt} desc nulls last`, asc(games.id))
    .limit(TINT_BATCH);

  let done = 0;
  let failed = 0;
  for (let i = 0; i < todo.length; i += TINT_CONCURRENCY) {
    if (ctx.timeLeft() < TINT_MIN_LEFT_MS) break;
    const part = todo.slice(i, i + TINT_CONCURRENCY);
    const results = await Promise.all(
      part.map(async (g) => {
        try {
          return { id: g.id, tint: await tintFor([g.imageUrl, g.bannerUrl], deps), ok: true as const };
        } catch (e) {
          if (e instanceof TintUnavailableError) return { id: g.id, unavailable: true as const };
          return { id: g.id, tint: null, ok: false as const };
        }
      }),
    );
    if (results.some((r) => 'unavailable' in r)) {
      ctx.warn('tint_unavailable', 'Цвет акцента не посчитан: библиотека обработки изображений недоступна.');
      return { done, failed };
    }
    const now = ctx.now();
    for (const r of results) {
      if ('unavailable' in r) continue;
      await ctx.db.update(games).set({ tint: r.tint, tintCheckedAt: now }).where(sql`${games.id} = ${r.id}`);
      if (r.ok) done++;
      else failed++;
    }
  }
  if (failed > 0) ctx.warn('tint_failed', `Цвет акцента не посчитан для ${failed} игр (обложка недоступна или не картинка).`);
  return { done, failed };
}
