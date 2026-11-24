// Цели месяца: лимиты, разбор тела и текущий месяц МСК. Без импортов сервера — можно в клиентском бандле.
export const GOAL_LIMITS = {
  games: { min: 1, max: 100 },
  hours: { min: 1, max: 744 },
  trophies: { min: 1, max: 5000 },
} as const;

/** Сколько игр можно выбрать в цель месяца. */
export const GOAL_PICK_MAX = 20;

export type GoalKey = keyof typeof GOAL_LIMITS;
export type GoalFields = { games: number | null; hours: number | null; trophies: number | null };
export type ParsedGoals = GoalFields & { gameIds?: number[] };
export type GoalProgress = { games: number; hours: number; trophies: number };
export type GoalGame = { id: number; title: string; coverUrl: string | null; completed: boolean };
export type MonthGoalsView = {
  month: string;
  year: number;
  monthNum: number;
  goals: GoalFields;
  progress: GoalProgress;
  hasGoals: boolean;
  picked: GoalGame[];
  /** Выбор игр: «Играю», «В плане на месяц» (План ставит на этот месяц), остальной План, «Бэклог». */
  candidates: { playing: GoalGame[]; planMonth: GoalGame[]; plan: GoalGame[]; backlog: GoalGame[] };
  hoursHint: number | null;
  /** Часы из «часов в неделю» Плана на дни текущего месяца; null, если бюджет не задан. */
  planHoursHint: number | null;
  hoursPerWeek: number | null;
  /** Цель года текущего календарного года, если задана в Плане. */
  yearGoal: MonthYearGoal | null;
  /** Итоги прошлого месяца в первые ~3 дня нового (пока не закрыты). */
  recap: MonthRecap | null;
  /** Предложение перенести цель года после автоперехода 1 января. */
  yearRollover: YearGoalRollover | null;
};

export type MonthYearGoal = {
  mode: 'complete' | 'backlog_to';
  year: number;
  current: number;
  count: number;
  /** Сколько игр в месяц нужно по темпу цели года (для подсказки в форме). */
  gamesHint: number | null;
};

/** Итоги прошлого месяца на главной в начале нового. */
export type MonthRecap = {
  month: string;
  year: number;
  monthNum: number;
  goals: GoalFields;
  progress: GoalProgress;
  picked: GoalGame[];
  unfinished: GoalGame[];
  canCarry: boolean;
};

/** Предложение перенести цель года на новый год (старый год сохранён в архиве). */
export type YearGoalRollover = {
  fromYear: number;
  toYear: number;
  mode: 'complete' | 'backlog_to';
  count: number;
  current: number;
};

export type RollKind = 'month' | 'year';
export type RollAction = 'carry' | 'dismiss';

/** Строка-мост на карточке месяца: «Год: 7 из 12» или «Год: бэклог 24, цель 12». */
export function yearGoalBridgeLabel(g: Pick<MonthYearGoal, 'mode' | 'current' | 'count'>): string {
  return g.mode === 'complete' ? `Год: ${g.current} из ${g.count}` : `Год: бэклог ${g.current}, цель ${g.count}`;
}

/** Подсказка «игр в месяц» из requiredPerMonth цели года. */
export function yearGamesHint(requiredPerMonth: number, remaining: number, year: number, nowYear: number, achieved: boolean): number | null {
  if (year !== nowYear || achieved || remaining <= 0) return null;
  return Math.min(GOAL_LIMITS.games.max, Math.max(1, Math.round(requiredPerMonth)));
}

const KEYS = ['games', 'hours', 'trophies'] as const satisfies readonly GoalKey[];

export function currentMonth(now: Date): { month: string; year: number; monthNum: number } {
  const s = new Date(now.getTime() + 3 * 3600_000);
  const year = s.getUTCFullYear();
  const monthNum = s.getUTCMonth() + 1;
  return { month: `${year}-${String(monthNum).padStart(2, '0')}`, year, monthNum };
}

export function monthParts(month: string): { month: string; year: number; monthNum: number } {
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));
  return { month, year, monthNum };
}

/** Предыдущий календарный месяц 'YYYY-MM'. */
export function prevMonth(month: string): string {
  const { year, monthNum } = monthParts(month);
  if (monthNum === 1) return `${year - 1}-12`;
  return `${year}-${String(monthNum - 1).padStart(2, '0')}`;
}

/** Якорь внутри месяца (15-е 12:00 МСК) — чтобы посчитать прогресс именно за этот месяц. */
export function monthAnchor(month: string): Date {
  const { year, monthNum } = monthParts(month);
  return new Date(Date.UTC(year, monthNum - 1, 15, 9, 0, 0));
}

/** Первые `days` календарных дней месяца по МСК (для карточки итогов). */
export function inRecapWindow(now: Date, days = 3): boolean {
  const s = new Date(now.getTime() + 3 * 3600_000);
  return s.getUTCDate() <= days;
}

const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

function recapPlural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (d > 1 && d < 5) return forms[1];
  if (d === 1) return forms[0];
  return forms[2];
}

/** «Ноябрь: 2 из 3 игр, 34 из 40 ч». */
export function recapSummary(r: Pick<MonthRecap, 'monthNum' | 'goals' | 'progress'>): string {
  const parts: string[] = [];
  if (r.goals.games != null) parts.push(`${r.progress.games} из ${r.goals.games} ${recapPlural(r.goals.games, ['игры', 'игр', 'игр'])}`);
  if (r.goals.hours != null) parts.push(`${Math.round(r.progress.hours)} из ${r.goals.hours} ч`);
  const name = MONTHS_NOM[r.monthNum - 1] ?? r.monthNum;
  return parts.length ? `${name}: ${parts.join(', ')}` : `${name}`;
}

/** «Цель на 2026: 10 из 12 игр. Перенести на 2027?» */
export function yearRolloverSummary(r: YearGoalRollover): string {
  const result = r.mode === 'complete'
    ? `${r.current} из ${r.count} ${recapPlural(r.count, ['игры', 'игр', 'игр'])}`
    : `бэклог ${r.current}, цель ${r.count}`;
  return `Цель на ${r.fromYear}: ${result}. Перенести на ${r.toYear}?`;
}

export function parseRoll(input: unknown): { ok: true; value: { kind: RollKind; action: RollAction } } | { ok: false } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false };
  const o = input as Record<string, unknown>;
  if (Object.keys(o).some((k) => k !== 'kind' && k !== 'action')) return { ok: false };
  if (o.kind !== 'month' && o.kind !== 'year') return { ok: false };
  if (o.action !== 'carry' && o.action !== 'dismiss') return { ok: false };
  return { ok: true, value: { kind: o.kind, action: o.action } };
}

/** Видимые цели: игры (число или выбранные) и часы. Колонка трофеев в БД больше не используется в UI. */
export function hasGoals(g: GoalFields, pickedCount = 0): boolean {
  return g.games != null || g.hours != null || pickedCount > 0;
}

function asInt(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (v === undefined) return undefined;
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isInteger(Number(v))) return Number(v);
  return undefined;
}

function parseGameIds(v: unknown): number[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > GOAL_PICK_MAX) return undefined;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of v) {
    const n = asInt(item);
    if (n === undefined || n === null || n < 1) return undefined;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Разбор тела PUT: поля необязательны; gameIds — выбранные игры (задаёт цель по играм); trophies принимается, но в UI больше нет. Все цели пустые — снять. */
export function parseGoals(input: unknown): { ok: true; value: ParsedGoals } | { ok: false } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false };
  const o = input as Record<string, unknown>;
  const allowed = new Set<string>([...KEYS, 'gameIds']);
  if (Object.keys(o).some((k) => !allowed.has(k))) return { ok: false };
  const value: ParsedGoals = { games: null, hours: null, trophies: null };
  for (const k of KEYS) {
    if (!(k in o)) continue;
    const n = asInt(o[k]);
    if (n === undefined) return { ok: false };
    if (n !== null && (n < GOAL_LIMITS[k].min || n > GOAL_LIMITS[k].max)) return { ok: false };
    value[k] = n;
  }
  if ('gameIds' in o) {
    const ids = parseGameIds(o.gameIds);
    if (ids === undefined) return { ok: false };
    value.gameIds = ids;
    value.games = ids.length === 0 ? null : ids.length;
  }
  return { ok: true, value };
}
