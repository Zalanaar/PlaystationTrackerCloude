// Разбор входных данных «Уже есть» (Фаза 40, контракт 40.2). Чистые функции, без БД.
import { z } from 'zod';
import type { Parsed } from '@/server/recommend/validation';

const externalId = z.string().trim().min(1).max(64).regex(/^[^\s/?#%\\]+$/);
const base = {
  externalSource: z.literal('rawg'),
  externalId,
  title: z.string().trim().min(1).max(200),
  coverUrl: z.string().max(2048).startsWith('https://').nullable(),
};

const markSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('covered'), coveredByGameId: z.number().int().min(1).max(2_147_483_647) }),
  z.strictObject({ ...base, kind: z.literal('not_in_library'), completed: z.boolean() }),
]);

export type OwnedMarkInput = z.infer<typeof markSchema>;

export function parseOwnedMarkBody(body: unknown): Parsed<OwnedMarkInput> {
  const r = markSchema.safeParse(body);
  return r.success ? { ok: true, value: r.data } : { ok: false, message: 'Некорректные поля отметки.' };
}

export function parseOwnedExternalId(raw: string): string | null {
  const r = externalId.safeParse(raw);
  return r.success ? r.data : null;
}

const intIn = (min: number, max: number, def: number) => (raw: string | null): number | null => {
  if (raw === null) return def;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
};

export function parseRecentLimit(raw: string | null): Parsed<number> {
  const n = intIn(1, 10, 5)(raw);
  return n === null ? { ok: false, message: 'Некорректный параметр limit.' } : { ok: true, value: n };
}

export function parseSearchParams(sp: URLSearchParams): Parsed<{ q: string; limit: number }> {
  const q = (sp.get('q') ?? '').trim();
  if (q.length < 1 || q.length > 80) return { ok: false, message: 'Некорректный параметр q.' };
  const limit = intIn(1, 30, 20)(sp.get('limit'));
  return limit === null ? { ok: false, message: 'Некорректный параметр limit.' } : { ok: true, value: { q, limit } };
}
