// Разбор входных данных раздела 18 (чистые функции, без БД).
import { z } from 'zod';
import { isStatusHintRule, STATUS_HINT_RULES } from '@/shared/status-hints';
import { TIME_WISHES, type TimeWish } from './types';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** `time` отсутствует = any; пустое или неизвестное значение = ошибка. */
export function parseTime(raw: string | null): Parsed<TimeWish> {
  if (raw === null) return { ok: true, value: 'any' };
  return (TIME_WISHES as readonly string[]).includes(raw) ? { ok: true, value: raw as TimeWish } : { ok: false, message: 'Некорректный параметр time.' };
}

const dislikeSchema = z.strictObject({ gameId: z.number().int().min(1).max(2_147_483_647) });

export function parseDislikeBody(body: unknown): Parsed<number> {
  const r = dislikeSchema.safeParse(body);
  return r.success ? { ok: true, value: r.data.gameId } : { ok: false, message: 'Некорректное поле: gameId.' };
}

export function parseGameId(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 2_147_483_647 ? n : null;
}

// --- «У тебя нет» (Фаза 30)

const externalIdSchema = z.string().trim().min(1).max(64).regex(/^[^\s/?#%\\]+$/);
const externalDislikeSchema = z.strictObject({
  externalSource: z.literal('rawg'),
  externalId: externalIdSchema,
  title: z.string().trim().min(1).max(200),
  coverUrl: z.string().max(2048).startsWith('https://').nullable(),
});

export function parseExternalDislikeBody(body: unknown): Parsed<z.infer<typeof externalDislikeSchema>> {
  const r = externalDislikeSchema.safeParse(body);
  return r.success ? { ok: true, value: r.data } : { ok: false, message: 'Некорректные поля externalSource, externalId, title или coverUrl.' };
}

export function parseExternalId(raw: string): string | null {
  const r = externalIdSchema.safeParse(raw);
  return r.success ? r.data : null;
}

// --- Подсказки статусов (Фаза 27, контракт 28)

const hintDismissSchema = z.strictObject({
  gameId: z.number().int().min(1).max(2_147_483_647),
  rule: z.enum(STATUS_HINT_RULES),
});

export function parseHintDismissBody(body: unknown): Parsed<{ gameId: number; rule: (typeof STATUS_HINT_RULES)[number] }> {
  const r = hintDismissSchema.safeParse(body);
  return r.success ? { ok: true, value: r.data } : { ok: false, message: 'Некорректные поля: gameId, rule.' };
}

export function parseHintRule(raw: string): (typeof STATUS_HINT_RULES)[number] | null {
  return isStatusHintRule(raw) ? raw : null;
}
