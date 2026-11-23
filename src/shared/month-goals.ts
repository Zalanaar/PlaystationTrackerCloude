// Цели месяца: лимиты, разбор тела и текущий месяц МСК. Без импортов сервера — можно в клиентском бандле.
export const GOAL_LIMITS = {
  games: { min: 1, max: 100 },
  hours: { min: 1, max: 744 },
  trophies: { min: 1, max: 5000 },
} as const;

export type GoalKey = keyof typeof GOAL_LIMITS;
export type GoalFields = { games: number | null; hours: number | null; trophies: number | null };
export type GoalProgress = { games: number; hours: number; trophies: number };
export type MonthGoalsView = {
  month: string;
  year: number;
  monthNum: number;
  goals: GoalFields;
  progress: GoalProgress;
  hasGoals: boolean;
};

const KEYS = ['games', 'hours', 'trophies'] as const satisfies readonly GoalKey[];

export function currentMonth(now: Date): { month: string; year: number; monthNum: number } {
  const s = new Date(now.getTime() + 3 * 3600_000);
  const year = s.getUTCFullYear();
  const monthNum = s.getUTCMonth() + 1;
  return { month: `${year}-${String(monthNum).padStart(2, '0')}`, year, monthNum };
}

export function hasGoals(g: GoalFields): boolean {
  return KEYS.some((k) => g[k] != null);
}

function asInt(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isInteger(Number(v))) return Number(v);
  return undefined;
}

/** Разбор тела PUT: поля необязательны, null или целое в диапазоне; все null — снять цели. Иначе некорректно. */
export function parseGoals(input: unknown): { ok: true; value: GoalFields } | { ok: false } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false };
  const o = input as Record<string, unknown>;
  if (Object.keys(o).some((k) => !KEYS.includes(k as GoalKey))) return { ok: false };
  const value: GoalFields = { games: null, hours: null, trophies: null };
  for (const k of KEYS) {
    if (!(k in o)) continue;
    const n = asInt(o[k]);
    if (n === undefined) return { ok: false };
    if (n !== null && (n < GOAL_LIMITS[k].min || n > GOAL_LIMITS[k].max)) return { ok: false };
    value[k] = n;
  }
  return { ok: true, value };
}
