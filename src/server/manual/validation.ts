// Разбор входных данных Фазы 43 (контракт 43.2). Чистые функции, без БД.
import { z } from 'zod';
import type { Parsed } from '@/server/recommend/validation';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string): boolean => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

const addSchema = z.strictObject({
  externalSource: z.literal('rawg'),
  externalId: z.string().trim().min(1).max(64).regex(/^[^\s/?#%\\]+$/),
  title: z.string().trim().min(1).max(200),
  coverUrl: z.string().max(2048).startsWith('https://').nullable(),
  releaseDate: z.string().refine(validDate).nullable(),
  confirmDuplicate: z.boolean().optional(),
  /** Фаза 43.1: false = «Купил» (запись без пометки). По умолчанию true. */
  notPurchased: z.boolean().optional(),
});
export type ManualAddInput = z.infer<typeof addSchema>;

// Фаза 44: «Играл на другой платформе» (POST /api/manual-games с kind = 'other_platform'). Подпись платформы только текст; notPurchased не передаётся.
const otherSchema = z.strictObject({
  kind: z.literal('other_platform'),
  externalSource: z.literal('rawg'),
  externalId: addSchema.shape.externalId,
  title: addSchema.shape.title,
  coverUrl: addSchema.shape.coverUrl,
  releaseDate: addSchema.shape.releaseDate,
  confirmDuplicate: z.boolean().optional(),
  platformLabel: z.string().trim().min(1).max(60).regex(/^[^\u0000-\u001f\u007f<>]+$/).nullable().optional().transform((x) => x ?? null),
});
export type OtherPlatformAddInput = z.infer<typeof otherSchema>;

export function parseOtherPlatformAddBody(body: unknown): Parsed<OtherPlatformAddInput> {
  const r = otherSchema.safeParse(body);
  return r.success ? { ok: true, value: r.data } : { ok: false, message: 'Некорректные поля игры.' };
}

/** POST /api/manual-games: kind отсутствует или 'ps_backlog' = Бэклог (43), 'other_platform' = Фаза 44. */
export function parseAnyManualAddBody(body: unknown): Parsed<{ kind: 'ps_backlog'; v: ManualAddInput } | { kind: 'other_platform'; v: OtherPlatformAddInput }> {
  const kind = typeof body === 'object' && body !== null ? (body as { kind?: unknown }).kind : undefined;
  if (kind === 'other_platform') {
    const r = parseOtherPlatformAddBody(body);
    return r.ok ? { ok: true, value: { kind: 'other_platform', v: r.value } } : r;
  }
  if (kind === 'ps_backlog') {
    const { kind: _k, ...rest } = body as Record<string, unknown>;
    void _k;
    const r = parseManualAddBody(rest);
    return r.ok ? { ok: true, value: { kind: 'ps_backlog', v: r.value } } : r;
  }
  const r = parseManualAddBody(body);
  return r.ok ? { ok: true, value: { kind: 'ps_backlog', v: r.value } } : r;
}

// Пакет 5: PATCH /api/manual-games/{id} для записи other_platform. Хоть одно поле; null = очистить.
export const OTHER_STATUSES = ['playing', 'completed', 'backlog', 'dropped'] as const;
export type OtherStatus = (typeof OTHER_STATUSES)[number];
const otherPatchSchema = z
  .strictObject({
    platformLabel: otherSchema.shape.platformLabel.optional(),
    status: z.enum(OTHER_STATUSES).nullable().optional(),
    rating: z.number().int().min(0).max(10).nullable().optional(),
    note: z.string().max(500).nullable().optional().transform((x) => (x === undefined ? undefined : x === null || x.trim() === '' ? null : x.trim())),
    /** «Вернуть» после удаления: прежняя дата статуса (только вместе с непустым status), чтобы запись вернулась в свой год */
    statusChangedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((v) => Object.keys(v).length > 0)
  .refine((v) => v.statusChangedAt === undefined || (v.status !== undefined && v.status !== null));
export type OtherPlatformPatch = { platformLabel?: string | null; status?: OtherStatus | null; rating?: number | null; note?: string | null; statusChangedAt?: Date };

export function parseOtherPlatformPatch(body: unknown): Parsed<OtherPlatformPatch> {
  const r = otherPatchSchema.safeParse(body);
  if (!r.success) return { ok: false, message: 'Некорректные поля записи.' };
  const v: OtherPlatformPatch = {};
  if ('platformLabel' in (body as object)) v.platformLabel = r.data.platformLabel ?? null;
  if (r.data.status !== undefined) v.status = r.data.status;
  if (r.data.rating !== undefined) v.rating = r.data.rating;
  if (r.data.note !== undefined) v.note = r.data.note;
  if (r.data.statusChangedAt !== undefined) v.statusChangedAt = new Date(r.data.statusChangedAt);
  return { ok: true, value: v };
}

export type ManualKind = 'ps_backlog' | 'other_platform';
/** GET /api/manual-games?kind=: по умолчанию ps_backlog. */
export function parseKindParam(sp: URLSearchParams): Parsed<ManualKind> {
  const v = sp.get('kind');
  if (v === null || v === 'ps_backlog') return { ok: true, value: 'ps_backlog' };
  return v === 'other_platform' ? { ok: true, value: 'other_platform' } : { ok: false, message: 'Некорректный параметр kind.' };
}

export const MANUAL_BATCH_MAX = 10;
const batchSchema = z.strictObject({ items: z.array(addSchema).min(1).max(MANUAL_BATCH_MAX) });

export function parseManualBatchBody(body: unknown): Parsed<ManualAddInput[]> {
  const r = batchSchema.safeParse(body);
  return r.success ? { ok: true, value: r.data.items } : { ok: false, message: `Нужно от 1 до ${MANUAL_BATCH_MAX} корректных игр.` };
}

export function parseManualAddBody(body: unknown): Parsed<ManualAddInput> {
  const r = addSchema.safeParse(body);
  return r.success ? { ok: true, value: r.data } : { ok: false, message: 'Некорректные поля игры.' };
}

const answerSchema = z.strictObject({ answer: z.enum(['yes', 'no']) });
export function parseMatchAnswer(body: unknown): Parsed<'yes' | 'no'> {
  const r = answerSchema.safeParse(body);
  return r.success ? { ok: true, value: r.data.answer } : { ok: false, message: 'Некорректный ответ.' };
}

export function parseManualId(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 2_147_483_647 ? n : null;
}

export function parseManualSearchQuery(sp: URLSearchParams): Parsed<string> {
  const q = (sp.get('q') ?? '').trim();
  return q.length >= 2 && q.length <= 80 ? { ok: true, value: q } : { ok: false, message: 'Запрос: от 2 до 80 символов.' };
}

export const SUGGEST_MIN_CHARS = 3;

/** Фаза 43.1: режим поиска. Без mode = поиск по Enter (q 2..80); mode=suggest = подсказки (q 3..80). */
export function parseManualSearchParams(sp: URLSearchParams): Parsed<{ q: string; suggest: boolean; scopeAll: boolean }> {
  const mode = sp.get('mode');
  const scope = sp.get('scope');
  if (scope !== null && scope !== 'all' && scope !== 'ps') return { ok: false, message: 'Некорректная область поиска.' };
  // Фаза 44: по всем платформам только поиск по Enter, без подсказок (экономия лимита RAWG)
  if (scope === 'all' && mode !== null) return { ok: false, message: 'Подсказки доступны только для PlayStation.' };
  if (mode !== null && mode !== 'suggest') return { ok: false, message: 'Некорректный режим поиска.' };
  const q = parseManualSearchQuery(sp);
  if (!q.ok) return q;
  if (mode === 'suggest' && q.value.length < SUGGEST_MIN_CHARS) return { ok: false, message: 'Подсказки: от 3 до 80 символов.' };
  return { ok: true, value: { q: q.value, suggest: mode === 'suggest', scopeAll: scope === 'all' } };
}

/** nb: только «1» включает фильтр; отсутствие = без фильтра; прочее = ошибка. */
export function parseNbFlag(sp: URLSearchParams): Parsed<boolean> {
  const v = sp.get('nb');
  if (v === null || v === '0') return { ok: true, value: false };
  return v === '1' ? { ok: true, value: true } : { ok: false, message: 'Некорректный параметр nb.' };
}
