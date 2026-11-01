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

export type PsnTokenEventName = 'pasted' | 'refreshed' | 'expired' | 'from_env';

/** Журнал токена PSN (контракт 27.4). Без секретов. */
export interface PsnTokenInfo {
  issuedAt: string | null;
  ageSeconds: number | null;
  source: 'pasted' | 'from_env' | null;
  lastEvent: { event: PsnTokenEventName; at: string; details?: Record<string, unknown> | null } | null;
}

export interface SyncStatus {
  psnToken?: PsnTokenInfo | null;
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

const EVENT_LABEL: Record<PsnTokenEventName, string> = {
  pasted: 'NPSSO вставлен на сайте',
  from_env: 'NPSSO взят из настроек сервера',
  refreshed: 'токен продлён',
  expired: 'токен протух',
};

function plural(n: number, one: string, few: string, many: string): string {
  const m = n % 10, c = n % 100;
  return m === 1 && c !== 11 ? one : m >= 2 && m <= 4 && (c < 12 || c > 14) ? few : many;
}

/** Строки блока «Токен PSN»; null, если журнала нет (psnToken = null) или данных нет совсем. */
export function psnTokenRows(t: PsnTokenInfo | null | undefined): { label: string; value: string }[] | null {
  if (!t) return null;
  const rows: { label: string; value: string }[] = [];
  if (t.ageSeconds !== null && Number.isFinite(t.ageSeconds) && t.ageSeconds >= 0) {
    const d = Math.floor(t.ageSeconds / 86400);
    const age = d === 0 ? 'меньше суток назад' : `${d} ${plural(d, 'день', 'дня', 'дней')} назад`;
    rows.push({ label: 'Токен обновлён', value: age });
  }
  if (t.source) rows.push({ label: 'Источник', value: t.source === 'pasted' ? 'с сайта' : 'из env' });
  if (t.lastEvent) {
    const at = formatMoscow(t.lastEvent.at);
    rows.push({ label: 'Последнее событие', value: `${EVENT_LABEL[t.lastEvent.event] ?? 'событие'}${at ? `, ${at}` : ''}` });
  }
  return rows.length ? rows : null;
}

/** «через 5 мин» / «через 2 ч» / «через 40 с» по retryAfterSeconds. */
export function retryAfterText(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec <= 0) return 'позже';
  if (sec < 60) return `через ${Math.ceil(sec)} с`;
  if (sec < 3600) return `через ${Math.ceil(sec / 60)} мин`;
  return `через ${Math.ceil(sec / 3600)} ч`;
}

/** Фиксированные тексты ошибок POST /api/sync/npsso (27.1). Введённое значение не подставляется. */
export function npssoErrorText(status: number, code: string | undefined, retryAfterSeconds?: number | null): string {
  if (status === 429 || code === 'rate_limited') return `Слишком много попыток. Повторить можно ${retryAfterText(retryAfterSeconds)}.`;
  if (status === 422 || code === 'npsso_invalid') return 'PSN отклонил NPSSO. Возьми свежий и вставь снова.';
  if (status === 400 || code === 'invalid_request') return 'Неверный формат. Нужны 64 латинские буквы и цифры или ответ страницы целиком.';
  if (status === 401) return 'Сессия истекла. Войди заново.';
  if (status === 403 || code === 'forbidden') return 'Вставлять NPSSO может только владелец.';
  if (status === 503) return 'PSN или база сейчас недоступны. Попробуй позже.';
  return 'Не удалось сохранить NPSSO. Попробуй позже.';
}
