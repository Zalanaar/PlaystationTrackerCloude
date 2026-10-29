// Разбор входных данных раздела 17 (чистые функции, без БД).
import { z } from 'zod';
import { normalizeOverrideHours } from '@/server/collection/duration';
import { isDateString } from './dates';
import { MAX_HOURS_PER_WEEK, round1 } from './plan';
import type { PlannedGameStatus } from './types';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string; details?: Record<string, unknown> };
const bad = (message: string, details?: Record<string, unknown>): { ok: false; message: string; details?: Record<string, unknown> } => ({ ok: false, message, ...(details ? { details } : {}) });

export const ORDER_MAX = 1000;
export const CATALOG_Q_MIN = 2;
export const CATALOG_Q_MAX = 100;
export const PLANNED_STATUSES = ['planned', 'done', 'cancelled'] as const satisfies readonly PlannedGameStatus[];

const issueMessage = (e: z.ZodError): string => {
  const path = e.issues[0]?.path.join('.');
  return path ? `Некорректное поле: ${path}.` : 'Некорректное тело запроса.';
};

export function parseId(raw: string): number | null {
  if (!/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

// --- настройки (17.3)
const settingsSchema = z.strictObject({ year: z.number().int().min(2000).max(2100), hoursPerWeek: z.number().finite().gt(0).max(MAX_HOURS_PER_WEEK) });

export function parseSettingsBody(body: unknown): Parsed<{ year: number; hoursPerWeek: number }> {
  const r = settingsSchema.safeParse(body);
  if (!r.success) return bad(issueMessage(r.error));
  const hoursPerWeek = round1(r.data.hoursPerWeek);
  if (hoursPerWeek < 0.1) return bad('Часов в неделю должно быть не меньше 0.1.');
  return { ok: true, value: { year: r.data.year, hoursPerWeek } };
}

// --- planned_games (17.7)
const title = z.string().trim().min(1).max(200);
const releaseDate = z.string().refine(isDateString, 'date').nullable();
const coverUrl = z
  .string()
  .max(2048)
  .refine((s) => {
    try {
      return new URL(s).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'https')
  .nullable();
const hoursManual = z.number().finite().nullable();

const createSchema = z.strictObject({
  title,
  releaseDate: releaseDate.optional(),
  coverUrl: coverUrl.optional(),
  wantAtRelease: z.boolean().optional(),
  hoursManual: hoursManual.optional(),
  externalSource: z.literal('rawg').optional(),
  externalId: z.string().trim().min(1).max(64).optional(),
});
const patchSchema = z.strictObject({
  title: title.optional(),
  releaseDate: releaseDate.optional(),
  coverUrl: coverUrl.optional(),
  wantAtRelease: z.boolean().optional(),
  hoursManual: hoursManual.optional(),
  status: z.enum(PLANNED_STATUSES).optional(),
});

export type PlannedCreate = {
  title: string;
  releaseDate: string | null;
  coverUrl: string | null;
  wantAtRelease: boolean;
  hoursManual: number | null;
  externalSource: 'rawg' | null;
  externalId: string | null;
};
export type PlannedPatch = Partial<{ title: string; releaseDate: string | null; coverUrl: string | null; wantAtRelease: boolean; hoursManual: number | null; status: PlannedGameStatus }>;

/** Часы: null остаётся null; число 0.1..1000 округляется до 0.1; иначе ошибка. */
function hoursOf(v: number | null | undefined): { ok: true; value: number | null | undefined } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, value: v };
  const n = normalizeOverrideHours(v);
  return n === null ? { ok: false } : { ok: true, value: n };
}

export function parsePlannedCreate(body: unknown): Parsed<PlannedCreate> {
  const r = createSchema.safeParse(body);
  if (!r.success) return bad(issueMessage(r.error));
  const d = r.data;
  if ((d.externalSource === undefined) !== (d.externalId === undefined)) return bad('externalSource и externalId задаются вместе.');
  const h = hoursOf(d.hoursManual);
  if (!h.ok) return bad('Часы должны быть от 0.1 до 1000.');
  const wantAtRelease = d.wantAtRelease ?? false;
  const date = d.releaseDate ?? null;
  if (wantAtRelease && date === null) return bad('Для «хочу на релизе» нужна дата выхода.', { reason: 'want_requires_release_date' });
  return {
    ok: true,
    value: { title: d.title, releaseDate: date, coverUrl: d.coverUrl ?? null, wantAtRelease, hoursManual: h.value ?? null, externalSource: d.externalSource ?? null, externalId: d.externalId ?? null },
  };
}

export function parsePlannedPatch(body: unknown): Parsed<PlannedPatch> {
  const r = patchSchema.safeParse(body);
  if (!r.success) return bad(issueMessage(r.error));
  const d = r.data;
  const h = hoursOf(d.hoursManual);
  if (!h.ok) return bad('Часы должны быть от 0.1 до 1000.');
  const out: PlannedPatch = {};
  if (d.title !== undefined) out.title = d.title;
  if (d.releaseDate !== undefined) out.releaseDate = d.releaseDate;
  if (d.coverUrl !== undefined) out.coverUrl = d.coverUrl;
  if (d.wantAtRelease !== undefined) out.wantAtRelease = d.wantAtRelease;
  if (h.value !== undefined) out.hoursManual = h.value;
  if (d.status !== undefined) out.status = d.status;
  if (Object.keys(out).length === 0) return bad('Нет полей для изменения.');
  return { ok: true, value: out };
}

export function parsePlannedStatusFilter(sp: URLSearchParams): Parsed<PlannedGameStatus | 'all'> {
  const raw = sp.get('status');
  if (raw === null || raw === '') return { ok: true, value: 'all' };
  if (raw === 'all') return { ok: true, value: 'all' };
  return (PLANNED_STATUSES as readonly string[]).includes(raw) ? { ok: true, value: raw as PlannedGameStatus } : bad('Неизвестный статус.');
}

// --- порядок (17.8)
const orderSchema = z.strictObject({ gameIds: z.array(z.number().int().min(1).max(2_147_483_647)).max(ORDER_MAX) });

export function parseOrderBody(body: unknown): Parsed<number[]> {
  const r = orderSchema.safeParse(body);
  if (!r.success) return bad(issueMessage(r.error));
  if (new Set(r.data.gameIds).size !== r.data.gameIds.length) return bad('В порядке есть повторы.');
  return { ok: true, value: r.data.gameIds };
}

// --- поиск в каталоге (17.9)
export function parseCatalogQuery(sp: URLSearchParams): Parsed<string> {
  const q = (sp.get('q') ?? '').trim();
  if (q.length < CATALOG_Q_MIN || q.length > CATALOG_Q_MAX) return bad(`Запрос поиска: от ${CATALOG_Q_MIN} до ${CATALOG_Q_MAX} символов.`);
  return { ok: true, value: q };
}
