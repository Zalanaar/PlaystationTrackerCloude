// F2-B (пакет 3): гайд игры — совпадение из индекса + своя ссылка + «Не тот гайд». Дубль (25.x) пишет на главную карточку.
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import type { UserId } from '@/server/auth/user-id';
import { NotFoundError } from '@/server/collection/mutations';
import type { GameGuide } from '@/server/collection/types';
import { findGuide } from './store';

const { games } = schema;
export const GUIDE_URL_MAX = 500;

export type GuidePatch = { override?: string | null; dismissed?: boolean };

/** Ссылка: только https, без пробелов, до 500 символов; хост любой (свой гайд владельца). */
export function normalizeGuideUrl(v: string): string | null {
  const t = v.trim();
  if (!t || t.length > GUIDE_URL_MAX || /\s/.test(t)) return null;
  try {
    const u = new URL(t);
    if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) return null;
    const out = u.toString();
    return out.length <= GUIDE_URL_MAX ? out : null;
  } catch { return null; }
}

export function parseGuideBody(body: unknown): { ok: true; value: GuidePatch } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Ожидается объект.' };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => k !== 'override' && k !== 'dismissed');
  if (extra.length) return { ok: false, message: `Неизвестное поле: ${extra[0]}.` };
  if (!('override' in b) && !('dismissed' in b)) return { ok: false, message: 'Нужно поле override или dismissed.' };
  const out: GuidePatch = {};
  if ('override' in b) {
    if (b.override === null || b.override === '') out.override = null;
    else if (typeof b.override !== 'string') return { ok: false, message: 'Ссылка — строка или null.' };
    else {
      const u = normalizeGuideUrl(b.override);
      if (!u) return { ok: false, message: 'Нужна ссылка https:// не длиннее 500 символов.' };
      out.override = u;
    }
  }
  if ('dismissed' in b) {
    if (typeof b.dismissed !== 'boolean') return { ok: false, message: 'dismissed — true или false.' };
    out.dismissed = b.dismissed;
  }
  return { ok: true, value: out };
}

async function mainCard(db: AnyDb, userId: UserId, gameId: number) {
  const [g] = await db.select({ id: games.id, dup: games.duplicateOfGameId }).from(games).where(and(eq(games.id, gameId), eq(games.userId, userId))).limit(1);
  if (!g) throw new NotFoundError('Игра не найдена.');
  return g.dup ?? g.id;
}

/** Гайд главной карточки игры. Сбой индекса (нет таблицы, БД) — без совпадения, ссылки-поиск остаются. */
export async function getGameGuide(db: AnyDb, userId: UserId, gameId: number): Promise<GameGuide> {
  const target = await mainCard(db, userId, gameId);
  const [g] = await db
    .select({ name: games.name, override: games.guideUrlOverride, dismissed: games.guideMatchDismissed })
    .from(games)
    .where(and(eq(games.id, target), eq(games.userId, userId)))
    .limit(1);
  if (!g) throw new NotFoundError('Игра не найдена.');
  const match = g.dismissed ? null : await findGuide(db, g.name).catch(() => null);
  return { match, override: g.override, dismissed: g.dismissed };
}

export async function setGameGuide(db: AnyDb, userId: UserId, gameId: number, patch: GuidePatch): Promise<{ gameId: number; guide: GameGuide }> {
  const target = await mainCard(db, userId, gameId);
  const set: { guideUrlOverride?: string | null; guideMatchDismissed?: boolean; updatedAt: Date } = { updatedAt: new Date() };
  if (patch.override !== undefined) set.guideUrlOverride = patch.override;
  if (patch.dismissed !== undefined) set.guideMatchDismissed = patch.dismissed;
  await db.update(games).set(set).where(and(eq(games.id, target), eq(games.userId, userId)));
  return { gameId: target, guide: await getGameGuide(db, userId, target) };
}
