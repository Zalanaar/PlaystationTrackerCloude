// Чистая логика экрана «Доступ» и страницы входа: тексты ошибок и подписи. Без сети и React.

/** Тексты ?error= на /login. Неизвестный код не показывается. */
export function loginErrorText(code: string | null | undefined): string | null {
  switch (code) {
    case 'access_denied': return 'Не удалось войти. Если вы ждёте доступ, обратитесь к владельцу.';
    case 'oauth_failed': return 'Вход через Google не удался. Попробуйте ещё раз.';
    case 'rate_limited': return 'Слишком много попыток входа. Подождите немного и попробуйте снова.';
    default: return null;
  }
}

/** Человеческий текст ошибки API «Доступ» по коду контракта 22.5. */
export function accessErrorText(status: number, code: string): string {
  switch (code) {
    case 'multiuser_not_ready': return 'Добавление участников пока отключено.';
    case 'user_exists': return 'Этот email уже в списке.';
    case 'user_limit': return 'Достигнут предел числа участников. Удалите заблокированного или приглашённого.';
    case 'owner_protected': return 'Владельца нельзя заблокировать или удалить.';
    case 'not_blocked': return 'Удалить можно только заблокированного или приглашённого участника.';
    case 'confirm_mismatch': return 'Email для подтверждения не совпадает.';
    case 'invalid_request': return 'Проверьте email: он указан неверно.';
    case 'forbidden': return 'Доступно только владельцу.';
    case 'not_found': return 'Участник не найден. Обновите список.';
    case 'rate_limited': return 'Слишком много запросов. Подождите немного.';
  }
  if (status === 401) return 'Сессия истекла. Войдите заново.';
  if (status === 403) return 'Доступно только владельцу.';
  if (status === 404) return 'Участник не найден. Обновите список.';
  if (status === 503 || code === 'db_unavailable') return 'База данных недоступна.';
  if (status === 0) return 'Нет связи с сервером.';
  return 'Не удалось выполнить действие. Попробуйте ещё раз.';
}

export const ROLE_LABEL: Record<string, string> = { owner: 'Владелец', member: 'Участник' };
export const STATUS_LABEL: Record<string, string> = { invited: 'Приглашён', active: 'Активен', blocked: 'Заблокирован' };
export const PSN_STATUS_LABEL: Record<string, string> = {
  unchecked: 'Не проверен',
  ok: 'Доступен',
  private: 'Профиль закрыт',
  not_found: 'PSN ID не найден',
  friend_required: 'Нужна заявка в друзья',
  unavailable: 'PSN недоступен',
};

export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
export const psnStatusLabel = (s: string) => PSN_STATUS_LABEL[s] ?? s;

/** Какие действия доступны строке. Владельца трогать нельзя; удалять можно только blocked/invited. */
export function rowActions(u: { role: string; status: string }): { toggle: 'block' | 'unblock' | null; canDelete: boolean } {
  if (u.role === 'owner') return { toggle: null, canDelete: false };
  return { toggle: u.status === 'blocked' ? 'unblock' : 'block', canDelete: u.status === 'blocked' || u.status === 'invited' };
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
export const normalizeEmail = (s: string) => s.trim().toLowerCase();
export const isEmailLike = (s: string) => { const e = normalizeEmail(s); return e.length <= 254 && EMAIL_RE.test(e); };
/** Подтверждение удаления: сравнение без учёта регистра и пробелов по краям (сервер нормализует так же). */
export const confirmMatches = (typed: string, email: string) => normalizeEmail(typed) === normalizeEmail(email);
