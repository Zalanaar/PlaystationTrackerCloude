// Чистая логика онбординга (Фаза 20.4, design-system §9, контракт 22.13): валидация ника, шаги, маппинг ошибок.
// Без React, сети и импортов из src/server.

export const NICK_RE = /^[A-Za-z][A-Za-z0-9_-]{2,15}$/;

/** Текст ошибки ника по design-system §9.3; null = ник корректен. Вход нужно сначала обрезать (trim). */
export function validateNick(raw: string): string | null {
  const v = raw.trim();
  if (v === '') return 'Введите ник PSN';
  if (v.length < 3 || v.length > 16) return 'Ник должен быть от 3 до 16 символов';
  if (!/^[A-Za-z]/.test(v)) return 'Ник должен начинаться с латинской буквы';
  if (!NICK_RE.test(v)) return 'Допустимы латинские буквы, цифры, «-» и «_»';
  return null;
}

export type AccessStatus = 'unchecked' | 'ok' | 'not_found' | 'private' | 'friend_required' | 'unavailable';

/** Ответ GET /api/me/psn (22.13). */
export interface PsnState {
  onlineId: string | null;
  accessMode?: string;
  accessStatus: AccessStatus | string;
  checkedAt: string | null;
  canStartSync: boolean;
  onboardedAt: string | null;
  sync: { id: number; kind: string; status: string; phase: string | null; startedAt: string; finishedAt: string | null } | null;
}

export type Step = 1 | 2 | 3;

/** Шаг по данным, а не по локальному состоянию (§9.2). */
export function deriveStep(s: Pick<PsnState, 'onlineId' | 'accessStatus' | 'onboardedAt' | 'canStartSync'>): Step {
  if (!s.onlineId) return 1;
  if (s.accessStatus !== 'ok') return 2;
  return 3;
}

/** Нужно ли отправить пользователя на /onboarding из (app). Владельца не трогаем (§9.1). */
export function needsOnboarding(u: { role: string; status: string; onlineId: string | null; onboardedAt: Date | string | null }): boolean {
  if (u.role === 'owner') return false;
  if (u.status !== 'active') return false;
  return u.onlineId === null || u.onboardedAt === null;
}

/** Состояния результата проверки на шаге 2. */
export type CheckKind =
  | 'checking'
  | 'ok'
  | 'psn_not_found'
  | 'psn_private'
  | 'psn_friend_required'
  | 'psn_account_locked'
  | 'psn_id_taken'
  | 'rate_limited'
  | 'psn_unavailable'
  | 'network'
  | 'config_error'
  | 'invalid';

export interface CheckResult {
  kind: CheckKind;
  retryAfterSec?: number;
}

/** Ошибка PUT /api/me/psn -> состояние. details.retryAfterSec, затем заголовок Retry-After, затем 30 с. */
export function mapPutError(status: number, code: string | undefined, details?: { retryAfterSec?: unknown } | null, retryAfterHeader?: string | null): CheckResult {
  switch (code) {
    case 'psn_not_found': return { kind: 'psn_not_found' };
    case 'psn_private': return { kind: 'psn_private' };
    case 'psn_friend_required': return { kind: 'psn_friend_required' };
    case 'psn_account_locked': return { kind: 'psn_account_locked' };
    case 'psn_id_taken': return { kind: 'psn_id_taken' };
    case 'psn_unavailable': return { kind: 'psn_unavailable' };
    case 'config_error': return { kind: 'config_error' };
    case 'invalid_request': return { kind: 'invalid' };
    case 'rate_limited': return { kind: 'rate_limited', retryAfterSec: retryAfterSeconds(details?.retryAfterSec, retryAfterHeader) };
    default:
      if (status === 429) return { kind: 'rate_limited', retryAfterSec: retryAfterSeconds(details?.retryAfterSec, retryAfterHeader) };
      return { kind: 'network' };
  }
}

export function retryAfterSeconds(fromDetails: unknown, header?: string | null): number {
  const n = typeof fromDetails === 'number' ? fromDetails : Number(header);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 300) : 30;
}

/** Сохранённый статус доступа -> результат, пока проверку заново не запускали. null = нужна проверка. */
export function checkFromStatus(status: string): CheckResult | null {
  switch (status) {
    case 'ok': return { kind: 'ok' };
    case 'not_found': return { kind: 'psn_not_found' };
    case 'private': return { kind: 'psn_private' };
    case 'friend_required': return { kind: 'psn_friend_required' };
    case 'unavailable': return { kind: 'psn_unavailable' };
    default: return null;
  }
}

/** Какие кнопки показывать на шаге 2 (primary / ghost). 'recheck' = «Проверить снова», 'edit' = «Изменить ник», 'next' = «Дальше». */
export type Action = 'recheck' | 'edit' | 'next';
export function checkActions(kind: CheckKind): { primary: Action | null; ghost: Action | null } {
  switch (kind) {
    case 'ok': return { primary: 'next', ghost: null };
    case 'psn_not_found': return { primary: 'edit', ghost: 'recheck' };
    case 'psn_private': return { primary: 'recheck', ghost: 'edit' };
    case 'psn_friend_required': return { primary: 'recheck', ghost: null };
    case 'psn_account_locked': return { primary: null, ghost: 'edit' };
    case 'psn_id_taken': return { primary: 'edit', ghost: null };
    case 'rate_limited': return { primary: 'recheck', ghost: null };
    case 'psn_unavailable': return { primary: 'recheck', ghost: null };
    case 'network': return { primary: 'recheck', ghost: null };
    case 'config_error': return { primary: null, ghost: null };
    case 'invalid': return { primary: 'edit', ghost: null };
    case 'checking': return { primary: null, ghost: null };
  }
}

/** Подпись фазы синка (§9.5). Реальные фазы сервера: games, trophy_sets, trophy_link, trophies; auth оставлена про запас. */
export function phaseLabel(phase: string | null | undefined): string {
  switch (phase) {
    case 'auth': return 'Подключаемся к PlayStation';
    case 'games': return 'Загружаем список игр и часы';
    case 'trophy_sets':
    case 'trophy_link': return 'Сопоставляем игры и трофеи';
    case 'trophies': return 'Загружаем трофеи';
    default: return 'Подключаемся к PlayStation';
  }
}

/** Причина ошибки загрузки (§9.5), без текста исключения. */
export function syncErrorText(reason: string | null | undefined): string {
  if (reason === 'timeout') return 'Загрузка заняла слишком много времени.';
  if (reason === 'npsso_invalid' || reason === 'auth_expired') return 'Сервису не удалось войти в PlayStation. Владелец сайта уже получил уведомление.';
  if (reason === 'cancelled') return 'Загрузка остановлена. Уже загруженное сохранено.';
  return 'Неизвестная ошибка.';
}

export interface SyncSlice {
  running: boolean;
  run: {
    status: string;
    errorReason?: string | null;
    progress?: { phase: string; step: number; steps: number; done: number | null; total: number | null } | null;
    counters?: { gamesSeen?: number } | null;
  } | null;
}

export type SyncView =
  | { kind: 'idle' }
  | { kind: 'running'; partial: boolean }
  | { kind: 'failed'; reason: string | null }
  | { kind: 'success' };

/** Вид шага 3 по статусу синка. */
export function syncView(s: SyncSlice | null): SyncView {
  if (!s || !s.run) return { kind: 'idle' };
  if (s.run.status === 'running' || s.running) return { kind: 'running', partial: false };
  if (s.run.status === 'partial') return { kind: 'running', partial: true };
  if (s.run.status === 'failed') return { kind: 'failed', reason: s.run.errorReason ?? null };
  if (s.run.status === 'success') return { kind: 'success' };
  return { kind: 'idle' };
}

/** Автозапуск на входе в шаг 3: нет запусков или последний failed (и ничего не идёт). */
export function shouldAutoStart(s: SyncSlice | null): boolean {
  if (!s) return false;
  if (s.running) return false;
  return !s.run || s.run.status === 'failed';
}

/** Процент полосы; null = indeterminate (нет счётчика). */
export function progressPercent(p: { done: number | null; total: number | null } | null | undefined): number | null {
  if (!p || p.total === null || p.total <= 0 || p.done === null) return null;
  return Math.max(0, Math.min(100, Math.round((p.done / p.total) * 100)));
}

/** Счётчик игр из статуса, если его нет, число не показываем (null). */
export function gamesSeen(s: SyncSlice | null): number | null {
  const n = s?.run?.counters?.gamesSeen;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export const STEP_NAMES: Record<Step, string> = { 1: 'Ник PSN', 2: 'Доступ', 3: 'Загрузка игр' };
