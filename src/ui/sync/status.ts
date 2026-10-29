// Чистая логика SyncPanel: типы ответа GET /api/sync/status (контракт 8.4) и маппинг в русский текст.

import type { SyncOverdue } from '@/shared/sync';

export type SyncErrorReason =
  | 'auth_expired'
  | 'npsso_invalid'
  | 'access_denied'
  | 'rate_limited'
  | 'psn_unavailable'
  | 'timeout'
  | 'internal';

export type SyncRunStatus = 'running' | 'success' | 'partial' | 'failed';

export interface SyncRun {
  id: number;
  kind: string;
  status: SyncRunStatus;
  phase: string | null;
  errorReason: SyncErrorReason | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  progress: { phase: string; step: number; steps: number; done: number | null; total: number | null } | null;
  counters: {
    gamesSeen?: number;
    trophySetsSynced?: number;
    trophiesUpserted?: number;
  } | null;
  warningsCount?: number;
}

/** Итоги из БД (не по запуску). */
export interface SyncTotals {
  games: number;
  trophySets: number;
  trophies: number;
  trophiesEarned: number;
  platinumEarned: number;
}

export interface SyncStatus {
  totals?: SyncTotals | null;
  running: boolean;
  run: SyncRun | null;
  lastSuccessAt: string | null;
  psnAuth: 'ok' | 'auth_expired' | 'unknown';
  psnAuthExpiresAt: string | null;
  /** Давность последнего успешного синка (контракт 20.2). Старые ответы поля не содержат. */
  overdue?: SyncOverdue | null;
}

export const STATUS_LABEL: Record<SyncRunStatus, string> = {
  running: 'Идёт синк',
  success: 'Готово',
  partial: 'Частично',
  failed: 'Ошибка',
};

const PHASE_LABEL: Record<string, string> = {
  auth: 'Авторизация в PSN',
  games: 'Загрузка игр',
  trophy_sets: 'Загрузка списков трофеев',
  trophy_link: 'Связывание игр с трофеями',
  trophies: 'Загрузка трофеев',
};

const REASON_TEXT: Record<SyncErrorReason, string> = {
  auth_expired: 'Токен доступа к PSN устарел. Нужен новый NPSSO.',
  npsso_invalid: 'PSN отклонил NPSSO. Нужен новый NPSSO.',
  access_denied: 'PSN закрыл доступ к списку игр или трофеям.',
  rate_limited: 'PSN ограничил частоту запросов. Попробуй позже.',
  psn_unavailable: 'PSN сейчас недоступен. Попробуй позже.',
  timeout: 'Синк не уложился во время и остановлен. Можно продолжить.',
  internal: 'Внутренняя ошибка синка.',
};

export function reasonText(reason: SyncErrorReason | null | undefined): string {
  return reason ? (REASON_TEXT[reason] ?? REASON_TEXT.internal) : '';
}

export function needsNewNpsso(s: Pick<SyncStatus, 'psnAuth' | 'run'>): boolean {
  const r = s.run?.errorReason;
  if (s.run?.status === 'running') return false;
  return s.psnAuth === 'auth_expired' || r === 'auth_expired' || r === 'npsso_invalid';
}

export function phaseText(run: SyncRun): string {
  const phase = run.progress?.phase ?? run.phase;
  const base = (phase && PHASE_LABEL[phase]) || 'Подготовка';
  const p = run.progress;
  if (p && p.done !== null && p.total !== null) return `${base}: ${p.done} из ${p.total}`;
  if (p && p.steps > 0) return `${base} (шаг ${p.step} из ${p.steps})`;
  return base;
}

/** Доля 0..1 для полосы; null, если неизвестна. */
export function progressFraction(run: SyncRun): number | null {
  const p = run.progress;
  if (!p) return null;
  if (p.done !== null && p.total !== null && p.total > 0) return Math.min(1, p.done / p.total);
  return null;
}

const nf = new Intl.NumberFormat('ru-RU');

/** Строки итогов из БД; пустой список, если totals нет. */
export function totalsRows(t: SyncTotals | null | undefined): { label: string; value: string }[] {
  if (!t) return [];
  const rows: { label: string; value: string }[] = [];
  if (Number.isFinite(t.games)) rows.push({ label: 'Игр', value: nf.format(t.games) });
  if (Number.isFinite(t.trophiesEarned) && Number.isFinite(t.trophies)) {
    rows.push({ label: 'Трофеев', value: `${nf.format(t.trophiesEarned)} из ${nf.format(t.trophies)}` });
  }
  if (Number.isFinite(t.platinumEarned)) rows.push({ label: 'Платин', value: nf.format(t.platinumEarned) });
  return rows;
}

/** Прогресс запуска (только пока идёт синк). */
export function runCountersText(run: SyncRun): string | null {
  const c = run.counters;
  if (!c) return null;
  const parts: string[] = [];
  if (c.gamesSeen !== undefined) parts.push(`игр: ${c.gamesSeen}`);
  if (c.trophySetsSynced !== undefined) parts.push(`наборов трофеев: ${c.trophySetsSynced}`);
  if (c.trophiesUpserted !== undefined) parts.push(`трофеев: ${c.trophiesUpserted}`);
  return parts.length ? `Обработано за этот запуск: ${parts.join(', ')}` : null;
}

export function buttonLabel(s: Pick<SyncStatus, 'run' | 'running'>, busy: boolean): string {
  if (busy || s.running) return 'Синк идёт…';
  if (s.run?.status === 'partial') return 'Продолжить синк';
  return 'Синк сейчас';
}

export function formatMoscow(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Текст ошибки ответа POST /api/sync. */
export function startErrorText(status: number, code: string | undefined): string {
  if (status === 409 || code === 'sync_in_progress') return 'Синк уже идёт.';
  if (code === 'config_error') return 'Синк не настроен на сервере.';
  if (code === 'db_unavailable' || status === 503) return 'База данных недоступна.';
  if (status === 401) return 'Сессия истекла. Войди заново.';
  return 'Не удалось запустить синк.';
}

/** Баннер «синк не запускался» (20.2): только при isOverdue и когда синк не идёт. */
export function isSyncOverdue(s: Pick<SyncStatus, 'overdue' | 'running'>): boolean {
  return !s.running && s.overdue?.isOverdue === true;
}

/** «53 ч» / «2 дня»: давность целыми часами до трёх суток, дальше сутками. */
export function overdueAgeText(o: SyncOverdue): string {
  const h = o.ageHours;
  if (h === null || !Number.isFinite(h)) return `больше ${o.thresholdHours} ч`;
  if (h < 72) return `${Math.floor(h)} ч`;
  const d = Math.floor(h / 24);
  const m = d % 10, c = d % 100;
  return `${d} ${m === 1 && c !== 11 ? 'день' : m >= 2 && m <= 4 && (c < 12 || c > 14) ? 'дня' : 'дней'}`;
}
