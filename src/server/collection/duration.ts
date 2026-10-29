// Длительность прохождения (контракт 16): эффективные часы, бакеты, статус HLTB. Чистые функции без БД.
import { sql, type SQL } from 'drizzle-orm';
import { schema } from '@/db';
import type { GameDuration, DurationBucket, HltbStatus } from './types';

const { games, gameStatus } = schema;

export const DURATION_BUCKETS = ['lt10', '10_30', '30_60', '60plus', 'unknown'] as const satisfies readonly DurationBucket[];
export const DURATION_MAX_HOURS = 1000;

/** Границы бакетов в часах: [от, до). */
const BOUNDS: Record<Exclude<DurationBucket, 'unknown'>, [number, number]> = {
  lt10: [0, 10],
  '10_30': [10, 30],
  '30_60': [30, 60],
  '60plus': [60, Infinity],
};

export function bucketOf(hours: number | null): DurationBucket {
  if (hours === null || !Number.isFinite(hours) || hours <= 0) return 'unknown';
  if (hours < 10) return 'lt10';
  if (hours < 30) return '10_30';
  if (hours < 60) return '30_60';
  return '60plus';
}

/** Ручное значение приоритетнее HLTB; extra в расчёт не входит. */
export function effectiveDuration(o: { override: number | null; main: number | null }): { hours: number | null; source: 'manual' | 'hltb' | null } {
  if (o.override !== null) return { hours: o.override, source: 'manual' };
  if (o.main !== null) return { hours: o.main, source: 'hltb' };
  return { hours: null, source: null };
}

export function hltbStatus(o: { id: number | null; checkedAt: Date | null }): HltbStatus {
  if (o.id !== null) return 'found';
  return o.checkedAt ? 'not_found' : 'unchecked';
}

export type DurationRow = {
  durationOverrideHours?: number | null;
  hltbId?: number | null;
  hltbName?: string | null;
  hltbMainHours?: number | null;
  hltbExtraHours?: number | null;
  hltbCheckedAt?: Date | null;
};

export function buildDuration(r: DurationRow): GameDuration {
  const override = r.durationOverrideHours ?? null;
  const { hours, source } = effectiveDuration({ override, main: r.hltbMainHours ?? null });
  const id = r.hltbId ?? null;
  const checkedAt = r.hltbCheckedAt ?? null;
  const status = hltbStatus({ id, checkedAt });
  const found = status === 'found';
  return {
    hours,
    source,
    bucket: bucketOf(hours),
    overrideHours: override,
    hltb: {
      status,
      id: found ? id : null,
      name: found ? (r.hltbName ?? null) : null,
      mainHours: found ? (r.hltbMainHours ?? null) : null,
      extraHours: found ? (r.hltbExtraHours ?? null) : null,
      checkedAt: checkedAt ? checkedAt.toISOString() : null,
    },
  };
}

/** SQL-выражение эффективных часов (NULL = неизвестно). */
export const effectiveHoursSql: SQL<number | null> = sql`coalesce(${games.durationOverrideHours}, ${games.hltbMainHours})`;

/** Условие бакета на эффективные часы. */
export function bucketSql(b: DurationBucket): SQL {
  if (b === 'unknown') return sql`${effectiveHoursSql} is null`;
  const [lo, hi] = BOUNDS[b];
  return hi === Infinity ? sql`${effectiveHoursSql} >= ${lo}` : sql`(${effectiveHoursSql} >= ${lo} and ${effectiveHoursSql} < ${hi})`;
}

/** Фильтр по нескольким бакетам (ИЛИ). */
export function durationFilterSql(buckets: readonly DurationBucket[] | null): SQL | undefined {
  if (!buckets || buckets.length === 0) return undefined;
  return sql`(${sql.join(buckets.map(bucketSql), sql` or `)})`;
}

export const HLTB_STATUSES = ['found', 'not_found', 'unchecked'] as const satisfies readonly HltbStatus[];

/** Статус HLTB в SQL: только по hltb_id / hltb_checked_at, ручное значение (override) на него не влияет (16.4). */
export function hltbStatusSql(s: HltbStatus): SQL {
  if (s === 'found') return sql`${games.hltbId} is not null`;
  if (s === 'not_found') return sql`(${games.hltbId} is null and ${games.hltbCheckedAt} is not null)`;
  return sql`(${games.hltbId} is null and ${games.hltbCheckedAt} is null)`;
}

/**
 * «Ждут проверки» (`hltb=unchecked` и `hltbCounts.unchecked`, одно условие): статус unchecked, без ручной длительности и не сервис
 * (их шаг HLTB пропускает, 20.1). Требует join game_status в запросе.
 */
export function uncheckedPendingSql(): SQL {
  return sql`(${hltbStatusSql('unchecked')} and ${games.durationOverrideHours} is null and ${gameStatus.status} is distinct from 'service')`;
}

/** Фильтр по нескольким статусам HLTB (ИЛИ). */
export function hltbFilterSql(list: readonly HltbStatus[] | null): SQL | undefined {
  if (!list || list.length === 0) return undefined;
  return sql`(${sql.join(list.map((s) => (s === 'unchecked' ? uncheckedPendingSql() : hltbStatusSql(s))), sql` or `)})`;
}

/** Ручной ввод: число 0.1..1000 -> округлено до 0.1; иначе null. */
export function normalizeOverrideHours(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const h = Math.round(v * 10) / 10;
  return h >= 0.1 && h <= DURATION_MAX_HOURS ? h : null;
}
