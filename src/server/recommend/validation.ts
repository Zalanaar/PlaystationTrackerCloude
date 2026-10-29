// Разбор входных данных раздела 18 (чистые функции, без БД).
import { z } from 'zod';
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
