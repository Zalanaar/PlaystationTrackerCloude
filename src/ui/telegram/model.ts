// Фаза 29: логика состояний блока «Сводка в Telegram» (без React и сети). Тексты из docs/design/spec-phase-29-digest.md, раздел 5.

export type TelegramStatus = {
  botConfigured: boolean;
  botUsername: string | null;
  role: 'owner' | 'member';
  linked: boolean;
  linkedAt: string | null;
  deliversTo: 'own_chat' | 'alerts_chat' | 'none';
  lastSentAt: string | null;
  pendingCode: { expiresAt: string } | null;
};

export type LocalCode = { code: string | null; expiresAt: string; deepLink: string | null };

export type DigestView = 'loading' | 'unavailable' | 'not_linked' | 'pending' | 'expired' | 'linked' | 'linked_owner' | 'create_error';

export const CODE_TTL_LABEL = '15 минут';

/** Приоритет: недоступно, ошибка создания, подключено, код (ждём/истёк), не подключено. */
export function deriveView(status: TelegramStatus | null, code: LocalCode | null, createFailed: boolean, nowMs: number): DigestView {
  if (!status) return 'loading';
  if (!status.botConfigured) return 'unavailable';
  if (createFailed) return 'create_error';
  if (status.linked && status.deliversTo !== 'alerts_chat') return 'linked';
  if (status.deliversTo === 'alerts_chat') return 'linked_owner';
  const exp = code?.expiresAt ?? status.pendingCode?.expiresAt ?? null;
  if (exp) {
    const t = Date.parse(exp);
    if (Number.isFinite(t)) return t > nowMs ? 'pending' : 'expired';
  }
  return 'not_linked';
}

export function remainingMs(expiresAt: string | null | undefined, nowMs: number): number {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : 0;
}

/** «мм:сс» до истечения кода. */
export function countdownText(ms: number): string {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** «26 окт, 19:00 МСК». */
export function formatLastSent(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')} ${get('month').replace('.', '')}, ${get('hour')}:${get('minute')} МСК`;
}

export const STATUS_TEXT: Record<Exclude<DigestView, 'loading'>, string> = {
  unavailable: 'Недоступно',
  not_linked: 'Не подключено',
  pending: 'Ждём подтверждения',
  expired: 'Код истёк',
  linked: 'Подключено',
  linked_owner: 'Подключено',
  create_error: 'Ошибка',
};

export const STATUS_ICON: Record<Exclude<DigestView, 'loading'>, 'bell-off' | 'clock' | 'alert' | 'check-circle' | 'info'> = {
  unavailable: 'info',
  not_linked: 'bell-off',
  pending: 'clock',
  expired: 'alert',
  linked: 'check-circle',
  linked_owner: 'check-circle',
  create_error: 'alert',
};

export const STATUS_TONE: Record<Exclude<DigestView, 'loading'>, 'success' | 'warning' | 'muted' | 'danger'> = {
  unavailable: 'muted', not_linked: 'muted', pending: 'muted', expired: 'warning', linked: 'success', linked_owner: 'success', create_error: 'danger',
};

export const INTRO = 'Раз в неделю, в воскресенье вечером (МСК): часы, трофеи, План и один совет. Присылает бот в Telegram.';

export function captionFor(view: DigestView, lastSentAt: string | null): string {
  switch (view) {
    case 'unavailable': return 'Бот Telegram на сервере не настроен.';
    case 'not_linked': return INTRO;
    case 'expired': return 'Создай новый код и пришли его боту.';
    case 'create_error': return 'Не получилось создать код. Попробуй ещё раз.';
    case 'linked_owner': return 'Чат задан на сервере вместе с алертами.';
    case 'linked': {
      const last = formatLastSent(lastSentAt);
      return `Сводка приходит в этот чат по воскресеньям вечером. ${last ? `Последняя: ${last}` : 'Ещё не отправлялась'}`;
    }
    default: return '';
  }
}

/** Ошибка создания кода: 503 config_error — бот не настроен, 429 — лимит, остальное — общий текст. */
export function createErrorText(status: number): string {
  if (status === 429) return 'Слишком много кодов подряд. Подожди несколько минут и попробуй снова.';
  if (status === 503) return 'Бот Telegram на сервере не настроен.';
  return 'Не получилось создать код. Попробуй ещё раз.';
}

export const POLL_MS = 5000;
