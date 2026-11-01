// Чистая логика страницы «Здоровье» (Фаза 35): форматирование и уровни. Без сети и React.
import { mskParts, plural } from '../format';
import type { CriterionStatus } from '@/server/health/criteria';
import type { HealthOverview } from '@/server/health/overview';
import type { LimitSource } from '@/server/health/limits';

export type { HealthOverview };
export type Level = 'ok' | 'warn' | 'danger' | 'unknown';

/** Refresh-токен PSN живёт ~10 дней (CLAUDE.md): предупреждение с 7-го дня, критично с 10-го. */
export const TOKEN_WARN_DAYS = 7;
export const TOKEN_DANGER_DAYS = 10;
const DAY = 86_400;

export function tokenLevel(ageSeconds: number | null | undefined): Level {
  if (ageSeconds === null || ageSeconds === undefined || !Number.isFinite(ageSeconds) || ageSeconds < 0) return 'unknown';
  if (ageSeconds >= TOKEN_DANGER_DAYS * DAY) return 'danger';
  if (ageSeconds >= TOKEN_WARN_DAYS * DAY) return 'warn';
  return 'ok';
}

export function tokenLevelText(l: Level): string {
  switch (l) {
    case 'ok': return 'Токен свежий.';
    case 'warn': return 'Токен скоро истечёт. Подготовь новый NPSSO.';
    case 'danger': return 'Токен мог истечь. Нужен новый NPSSO.';
    default: return 'Возраст токена неизвестен.';
  }
}

export function tokenSourceLabel(s: string | null | undefined): string {
  if (s === 'pasted') return 'вставлен вручную';
  if (s === 'from_env') return 'из переменной окружения';
  return 'не известен';
}

const EVENT_LABEL: Record<string, string> = { pasted: 'вставлен NPSSO', refreshed: 'токен обновлён', expired: 'токен истёк', from_env: 'взят из окружения' };
export const tokenEventLabel = (e: string) => EVENT_LABEL[e] ?? e;

/** «9 дн. 4 ч», «5 ч», «12 мин». */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return 'нет данных';
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh === 0 ? `${d} дн.` : `${d} дн. ${rh} ч`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** «01.11.2026, 13:05» по Москве. Пусто или битая дата: «нет». */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return 'нет';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'нет';
  const p = mskParts(t);
  const x = new Date(t + 3 * 3600_000);
  return `${pad(p.d)}.${pad(p.m)}.${p.y}, ${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`;
}

/** Уровень свежести успешного синка: нет = danger, старше 36 ч = warn (как watchdog и критерий observation_sync). */
export function syncLevel(lastSuccessAt: string | null | undefined, nowMs: number): Level {
  if (!lastSuccessAt) return 'danger';
  const t = new Date(lastSuccessAt).getTime();
  if (Number.isNaN(t)) return 'danger';
  return nowMs - t > 36 * 3600_000 ? 'warn' : 'ok';
}

// ---- Критерии ----
export const CRITERION_LABEL: Record<CriterionStatus, string> = { pass: 'Выполнено', fail: 'Не выполнено', pending: 'Ждёт включения', manual: 'Проверить вручную' };
export const CRITERION_ICON: Record<CriterionStatus, 'check-circle' | 'circle-alert' | 'clock' | 'info'> = { pass: 'check-circle', fail: 'circle-alert', pending: 'clock', manual: 'info' };
export const criterionLabel = (s: string) => CRITERION_LABEL[s as CriterionStatus] ?? s;
export const criterionIcon = (s: string) => CRITERION_ICON[s as CriterionStatus] ?? 'info';

export function criteriaSummaryText(s: Record<CriterionStatus, number>): string {
  const parts = [`выполнено ${s.pass}`, `не выполнено ${s.fail}`, `ждут включения ${s.pending}`, `вручную ${s.manual}`];
  return parts.join(' · ');
}

/** Общий вердикт: есть fail = «не готово», иначе есть manual/pending = «проверь вручную», иначе «готово». */
export function criteriaVerdict(s: Record<CriterionStatus, number>): { level: Level; text: string } {
  if (s.fail > 0) return { level: 'danger', text: `Не готово: ${s.fail} ${plural(s.fail, ['критерий не выполнен', 'критерия не выполнены', 'критериев не выполнено'])}` };
  if (s.manual > 0 || s.pending > 0) return { level: 'warn', text: 'Автоматические проверки пройдены, остались ручные' };
  return { level: 'ok', text: 'Все критерии выполнены' };
}

// ---- Потолки и расход ----
export type ProviderView = { state: 'active' | 'disabled'; reason?: string; userLimit: number; totalLimit: number; userSource: LimitSource; totalSource: LimitSource };

export function reasonLabel(provider: 'rawg' | 'hltb' | 'llm', reason: string | undefined): string {
  switch (reason) {
    case 'no_key': return provider === 'rawg' ? 'не задан ключ RAWG' : 'не задан ключ LLM';
    case 'no_provider': return 'не выбран провайдер LLM';
    case 'limit_zero': return 'суточный потолок равен нулю';
    default: return 'выключено';
  }
}

/** Выключенный провайдер не «без лимита»: запросы не выполняются. */
export function providerStateText(provider: 'rawg' | 'hltb' | 'llm', v: ProviderView): string {
  return v.state === 'disabled' ? `Выключено: ${reasonLabel(provider, v.reason)}. Запросы не выполняются.` : 'Включено';
}

export function sourceText(s: LimitSource): string | null {
  if (s === 'clamped') return 'значение из окружения вне допустимого диапазона, приведено к границе';
  if (s === 'env') return 'задано в окружении';
  return null;
}

export function usageText(cell: { used: number; limit: number | null }, view: Pick<ProviderView, 'state'>): string {
  if (view.state === 'disabled' || cell.limit === null) return `${cell.used} · выключено`;
  return `${cell.used} из ${cell.limit}`;
}

/** 0..1 для полоски; null, если потолка нет (выключено). */
export function usageRatio(cell: { used: number; limit: number | null }): number | null {
  if (cell.limit === null || cell.limit <= 0) return null;
  return Math.min(1, cell.used / cell.limit);
}

export function usageLevel(cell: { used: number; limit: number | null }): Level {
  const r = usageRatio(cell);
  if (r === null) return 'unknown';
  if (r >= 1) return 'danger';
  if (r >= 0.8) return 'warn';
  return 'ok';
}

// ---- Прочее ----
const RUN_KIND: Record<string, string> = { daily: 'ежедневный', manual: 'ручной', trophy_backfill: 'добор трофеев', hltb: 'HLTB' };
export const runKindLabel = (k: string) => RUN_KIND[k] ?? k;
export const runStatusText = (s: string) => (s === 'partial' ? 'частично' : s === 'failed' ? 'ошибка' : s);

const ERR_REASON: Record<string, string> = {
  auth_expired: 'токен PSN устарел', npsso_invalid: 'PSN отклонил NPSSO', access_denied: 'PSN закрыл доступ', rate_limited: 'лимит запросов PSN',
  psn_unavailable: 'PSN недоступен', timeout: 'не уложился во время', internal: 'внутренняя ошибка',
};
export const errorReasonLabel = (r: string | null | undefined) => (r ? (ERR_REASON[r] ?? 'другая ошибка') : 'причина не указана');

export function healthErrorText(status: number, code: string): string {
  if (status === 403 || code === 'forbidden') return 'Доступно только владельцу.';
  if (status === 401) return 'Сессия истекла. Войдите заново.';
  if (status === 503 || code === 'db_unavailable') return 'База данных недоступна. Попробуйте позже.';
  if (status === 0 || code === 'network') return 'Нет связи с сервером.';
  return 'Не удалось загрузить сводку. Попробуйте ещё раз.';
}

export const profileTitle = (u: { label: string | null; psnOnlineId: string | null; email: string | null; id: number }) =>
  u.label ?? u.psnOnlineId ?? u.email ?? `Профиль ${u.id}`;
