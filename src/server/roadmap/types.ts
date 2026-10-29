// Типы роадмапа (контракт 17). Без рантайма, безопасно для `import type` из UI.
export type EntryKind = 'release' | 'backlog' | 'planned';
export type HoursSource = 'manual' | 'hltb' | null;

/** Игра на входе алгоритма и общая часть записей ответа (17.5). */
export type RoadmapEntry = {
  /** `g:<games.id>` для бэклога, `p:<planned_games.id>` для остальных. */
  key: string;
  kind: EntryKind;
  gameId: number | null;
  plannedId: number | null;
  title: string;
  coverUrl: string | null;
  hours: number | null;
  hoursSource: HoursSource;
  releaseDate: string | null;
  wantAtRelease: boolean;
};

export type PlanSegment = { from: string; to: string; days: number; hours: number };

export type PlanItem = RoadmapEntry & {
  start: string;
  end: string;
  days: number;
  shiftedDays: number;
  queuePosition: number | null;
  segments: PlanSegment[];
};

export type ConflictReason = 'release_overlap' | 'exceeds_year_end' | 'starts_before_year';
export type Conflict = { reason: ConflictReason; from: string; to: string; keys: string[] };

export type NotFitReason = 'no_capacity' | 'exceeds_year_end' | 'after_year_end';
export type NotFitEntry = RoadmapEntry & {
  reason: NotFitReason;
  hoursShort: number | null;
  /** Только для g:* с reason no_capacity (17.5): пробный прогон «перенести в конец очереди». null = проба не считалась (сверх лимита). */
  canFitAtEnd?: boolean | null;
  hoursShortAtEnd?: number | null;
  displacesAtEnd?: number | null;
};

export type QueueState = 'scheduled' | 'not_fit' | 'need_hours' | 'unplanned';
export type QueueRef = { key: string; state: QueueState };

export type PeriodLoad = { key: string; hours: number };
export type WeekLoad = { index: number; from: string; to: string; days: number; capacityHours: number; plannedHours: number; items: PeriodLoad[] };
export type MonthLoad = { month: string; from: string; to: string; days: number; capacityHours: number; plannedHours: number; items: PeriodLoad[] };

export type PlanStatus = 'ok' | 'no_budget';

export type Plan = {
  status: PlanStatus;
  year: number;
  range: { from: string; to: string; days: number };
  totals: { capacityHours: number; plannedHours: number };
  weeks: WeekLoad[];
  months: MonthLoad[];
  items: PlanItem[];
  queue: QueueRef[];
  conflicts: Conflict[];
  notFit: NotFitEntry[];
  needHours: RoadmapEntry[];
};

export type ProgressStatus = 'ahead' | 'onTrack' | 'behind' | 'no_data' | 'not_started';
export type Progress = {
  status: ProgressStatus;
  from: string;
  asOf: string;
  plannedHours: number;
  actualHours: number;
  diffHours: number;
  toleranceHours: number;
  budgetHours: number;
};

export type SettingsView = { year: number; hoursPerWeek: number | null; configured: boolean };

/** 17.11: игра-сервис для таблицы «в план не берём». */
export type ServiceGame = { gameId: number; title: string; coverUrl: string | null; playedHours: number };

export type RoadmapResponse = Plan & {
  settings: SettingsView;
  today: string;
  progress: Progress | null;
  /** 17.12: «Не распределено» (исключённый бэклог и отменённые релизы). */
  unallocated: RoadmapEntry[];
  serviceGames: ServiceGame[];
};

export type PlannedGameStatus = 'planned' | 'done' | 'cancelled';
export type PlannedGameDto = {
  id: number;
  title: string;
  releaseDate: string | null;
  coverUrl: string | null;
  wantAtRelease: boolean;
  hoursManual: number | null;
  externalSource: 'rawg' | null;
  externalId: string | null;
  status: PlannedGameStatus;
  createdAt: string;
  updatedAt: string;
};
