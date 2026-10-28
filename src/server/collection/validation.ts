// Разбор и проверка входных данных раздела 9 (чистые функции, без БД).
import { z } from 'zod';
import type { GameSort, GameStatusValue, SortOrder, StatusFilterValue } from './types';

export const STATUS_VALUES = ['playing', 'completed', 'dropped', 'backlog', 'shelved', 'service'] as const satisfies readonly GameStatusValue[];
const FILTER_VALUES: readonly string[] = [...STATUS_VALUES, 'none'];
export const SORTS = ['last_played', 'hours', 'title', 'trophies_progress', 'completed_at'] as const satisfies readonly GameSort[];
export const DEFAULT_ORDER: Record<GameSort, SortOrder> = {
  last_played: 'desc',
  hours: 'desc',
  title: 'asc',
  trophies_progress: 'desc',
  completed_at: 'desc',
};
export const LIMIT_DEFAULT = 60;
export const LIMIT_MAX = 300;
export const BULK_MAX = 250;
export const Q_MAX = 100;

export type ListQuery = {
  q: string | null;
  statuses: StatusFilterValue[] | null;
  year: number | null;
  sort: GameSort;
  order: SortOrder;
  limit: number;
  offset: number;
  /** 9.2: true = только скрытые (`hidden=only`), false = только видимые. */
  hiddenOnly: boolean;
  /** 14.4: true = только забытые игры (`forgotten=only`). */
  forgottenOnly: boolean;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
const bad = (message: string): { ok: false; message: string } => ({ ok: false, message });

function intParam(raw: string, min: number, max: number): number | null {
  if (!/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

export function parseListQuery(sp: URLSearchParams): Parsed<ListQuery> {
  const qRaw = (sp.get('q') ?? '').trim();
  if (qRaw.length > Q_MAX) return bad('Слишком длинный запрос поиска.');

  let statuses: StatusFilterValue[] | null = null;
  const sRaw = sp.get('status');
  if (sRaw !== null && sRaw.trim() !== '') {
    const parts = sRaw.split(',').map((s) => s.trim());
    if (parts.some((p) => !FILTER_VALUES.includes(p))) return bad('Неизвестный статус в фильтре.');
    statuses = [...new Set(parts)] as StatusFilterValue[];
  }

  let year: number | null = null;
  const yRaw = sp.get('year');
  if (yRaw !== null && yRaw !== '') {
    year = intParam(yRaw, 2000, 2100);
    if (year === null) return bad('Некорректный год.');
  }

  const sortRaw = sp.get('sort') ?? 'last_played';
  if (!(SORTS as readonly string[]).includes(sortRaw)) return bad('Неизвестная сортировка.');
  const sort = sortRaw as GameSort;
  const orderRaw = sp.get('order');
  if (orderRaw !== null && orderRaw !== 'asc' && orderRaw !== 'desc') return bad('Некорректное направление сортировки.');
  const order = (orderRaw as SortOrder | null) ?? DEFAULT_ORDER[sort];

  let limit = LIMIT_DEFAULT;
  const lRaw = sp.get('limit');
  if (lRaw !== null && lRaw !== '') {
    const n = intParam(lRaw, 1, LIMIT_MAX);
    if (n === null) return bad('Некорректный limit.');
    limit = n;
  }
  let offset = 0;
  const oRaw = sp.get('offset');
  if (oRaw !== null && oRaw !== '') {
    const n = intParam(oRaw, 0, 1_000_000);
    if (n === null) return bad('Некорректный offset.');
    offset = n;
  }
  const hRaw = sp.get('hidden');
  if (hRaw !== null && hRaw !== '' && hRaw !== 'only') return bad('Некорректный параметр hidden.');
  const hiddenOnly = hRaw === 'only';
  const fRaw = sp.get('forgotten');
  if (fRaw !== null && fRaw !== '' && fRaw !== 'only') return bad('Некорректный параметр forgotten.');
  const forgottenOnly = fRaw === 'only';
  return { ok: true, value: { q: qRaw || null, statuses, year, sort, order, limit, offset, hiddenOnly, forgottenOnly } };
}

const statusSchema = z.union([z.enum(STATUS_VALUES), z.null()]);
const idSchema = z.number().int().positive().max(2_147_483_647);

/** id из пути: положительное целое. */
export function parseGameId(raw: string): number | null {
  return /^\d{1,10}$/.test(raw) && idSchema.safeParse(Number(raw)).success ? Number(raw) : null;
}

export function parseStatusBody(body: unknown): Parsed<{ status: GameStatusValue | null }> {
  if (typeof body !== 'object' || body === null || !('status' in body)) return bad('Нужно поле status.');
  const r = statusSchema.safeParse((body as { status: unknown }).status);
  return r.success ? { ok: true, value: { status: r.data } } : bad('Недопустимый статус.');
}

export function parseBulkBody(body: unknown): Parsed<{ ids: number[]; status: GameStatusValue | null }> {
  if (typeof body !== 'object' || body === null) return bad('Некорректное тело запроса.');
  const b = body as { ids?: unknown };
  const ids = z.array(idSchema).min(1).max(BULK_MAX).safeParse(b.ids);
  if (!ids.success) return bad(`ids: от 1 до ${BULK_MAX} положительных целых.`);
  const st = parseStatusBody(body);
  if (!st.ok) return st;
  return { ok: true, value: { ids: [...new Set(ids.data)].sort((a, c) => a - c), status: st.value.status } };
}

const isoSchema = z.iso.datetime({ offset: true });

export type DateEdit = { field: 'completedAt' | 'droppedAt'; date: Date };

export function parseDateBody(body: unknown): Parsed<DateEdit> {
  if (typeof body !== 'object' || body === null) return bad('Некорректное тело запроса.');
  const b = body as Record<string, unknown>;
  const has = (['completedAt', 'droppedAt'] as const).filter((k) => k in b);
  if (has.length !== 1) return bad('Нужно ровно одно поле: completedAt или droppedAt.');
  const field = has[0];
  const r = isoSchema.safeParse(b[field]);
  if (!r.success) return bad('Дата должна быть в формате ISO 8601.');
  const date = new Date(r.data);
  if (Number.isNaN(date.getTime())) return bad('Некорректная дата.');
  return { ok: true, value: { field, date } };
}

export function parseHiddenBody(body: unknown): Parsed<{ hidden: boolean }> {
  if (typeof body !== 'object' || body === null || !('hidden' in body)) return bad('Нужно поле hidden.');
  const h = (body as { hidden: unknown }).hidden;
  return typeof h === 'boolean' ? { ok: true, value: { hidden: h } } : bad('hidden должно быть true или false.');
}

/** 15.1: {"month":"YYYY-MM","excluded":boolean}, год 2000..2100. */
export function parseMonthExclusionBody(body: unknown): Parsed<{ month: string; excluded: boolean }> {
  if (typeof body !== 'object' || body === null) return bad('Некорректное тело запроса.');
  const { month, excluded } = body as { month?: unknown; excluded?: unknown };
  const m = typeof month === 'string' ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month) : null;
  if (!m || Number(m[1]) < 2000 || Number(m[1]) > 2100) return bad('month должен быть в формате YYYY-MM (год 2000..2100).');
  if (typeof excluded !== 'boolean') return bad('excluded должно быть true или false.');
  return { ok: true, value: { month: month as string, excluded } };
}

export function parseResetAllBody(body: unknown): Parsed<true> {
  if (typeof body !== 'object' || body === null || (body as { confirm?: unknown }).confirm !== 'RESET') {
    return bad('Нужно подтверждение: {"confirm":"RESET"}.');
  }
  return { ok: true, value: true };
}

export function parseRestoreBody(body: unknown): Parsed<{ backupId: number }> {
  if (typeof body !== 'object' || body === null) return bad('Некорректное тело запроса.');
  const r = idSchema.safeParse((body as { backupId?: unknown }).backupId);
  return r.success ? { ok: true, value: { backupId: r.data } } : bad('backupId: положительное целое.');
}
