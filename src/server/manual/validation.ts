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
});
export type ManualAddInput = z.infer<typeof addSchema>;

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

/** nb: только «1» включает фильтр; отсутствие = без фильтра; прочее = ошибка. */
export function parseNbFlag(sp: URLSearchParams): Parsed<boolean> {
  const v = sp.get('nb');
  if (v === null || v === '0') return { ok: true, value: false };
  return v === '1' ? { ok: true, value: true } : { ok: false, message: 'Некорректный параметр nb.' };
}
