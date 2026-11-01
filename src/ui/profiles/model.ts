// Чистая логика профилей PSN (Фаза 41, design-system §17): ключи хранилища, тексты ошибок, архив. Без React, сети и импортов из src/server.
import { formatDate, formatNumber, plural } from '../format';
import { NICK_RE } from '../onboarding/model';

export const PROFILE_LIMIT_DEFAULT = 3;
export const DAY_MS = 86_400_000;

/** Ключ localStorage/sessionStorage с id активного профиля. Нет id (ещё не загрузили /api/auth/me) = базовый ключ. */
export function scopedKey(base: string, profileId: number | null): string {
  return profileId === null ? base : `${base}:${profileId}`;
}

/** Формат ника как в онбординге (§9.3); сообщение формы добавления одно (§17.4). */
export function isValidNick(raw: string): boolean {
  return NICK_RE.test(raw.trim());
}
export const NICK_FORMAT_ERROR = 'Ник: 3-16 символов, латиница, цифры, дефис и подчёркивание.';

/** Подтверждение ником: без учёта регистра и крайних пробелов, пустое не совпадает. */
export function nickMatches(typed: string, nick: string | null): boolean {
  const a = typed.trim().toLowerCase();
  return nick !== null && a !== '' && a === nick.toLowerCase();
}

export const initialOf = (nick: string | null): string => {
  const c = (nick ?? '').trim().charAt(0);
  return c === '' ? '?' : c.toUpperCase();
};

export const counterText = (n: number, limit: number): string => `${n} из ${limit}`;

/** Сколько суток до удаления из архива: ceil, минимум 1; null = меньше суток (удалится сегодня). */
export function daysLeft(purgeAt: string, nowMs: number): number | null {
  const t = Date.parse(purgeAt);
  if (!Number.isFinite(t)) return 1;
  const left = t - nowMs;
  if (left <= 0) return null;
  if (left < DAY_MS) return null;
  return Math.max(1, Math.ceil(left / DAY_MS));
}

export const daysWord = (n: number): string => plural(n, ['день', 'дня', 'дней']);

export function purgeText(purgeAt: string, nowMs: number): string {
  const d = daysLeft(purgeAt, nowMs);
  return d === null ? 'Архив: удалится сегодня' : `Архив: удалится через ${d} ${daysWord(d)}`;
}

export function profileMeta(gamesCount: number, lastSyncAt: string | null): string {
  const sync = lastSyncAt ? `синк ${formatDate(lastSyncAt) ?? ''}`.trim() : 'синк ещё не было';
  if (gamesCount <= 0) return `игр пока нет · ${sync}`;
  return `${formatNumber(gamesCount)} ${plural(gamesCount, ['игра', 'игры', 'игр'])} · ${sync}`;
}

/**
 * Тексты проблем доступа к профилю. Источник: онбординг §9.4 (те же формулировки; кнопки «Проверить снова» в списке нет,
 * поэтому хвосты про неё опущены). Нет в §9.4 и дописано: `friend_required` без имени тех. аккаунта, `unchecked`.
 */
export function accessStatusText(status: string): string | null {
  switch (status) {
    case 'ok': return null;
    case 'not_found': return 'Профиль не найден. Проверьте, нет ли опечатки в нике PSN.';
    case 'private': return 'Профиль закрыт. Откройте игры и трофеи в настройках приватности PlayStation.';
    case 'friend_required': return 'Профиль виден только друзьям. Добавьте в друзья технический аккаунт сервиса, детали у владельца сайта.';
    case 'unavailable': return 'PlayStation сейчас не отвечает. Это не ошибка в нике. Попробуйте через минуту.';
    case 'unchecked': return 'Доступ к профилю ещё не проверен.';
    default: return 'Доступ к профилю не подтверждён.';
  }
}

export type ApiFail = { status: number; code: string; retryAfterSec?: number };

const retryText = (s?: number) => `Слишком часто. Повтори через ${s ?? 30} с.`;

/** Баннер/ошибка в форме добавления (§17.4). `field` = показать под полем, а не в баннере. */
export function addErrorText(e: ApiFail, nick: string): { text: string; field?: boolean; retry?: boolean; toList?: boolean } {
  switch (e.code) {
    case 'invalid_request': return { text: 'Проверь ник: так он записать нельзя.', field: true };
    case 'profile_limit': return { text: 'Достигнут лимит: 3 профиля PSN на один вход. Отвяжи ненужный и повтори.', toList: true };
    case 'user_limit': return { text: 'Достигнут общий лимит пользователей сайта. Обратись к владельцу.' };
    case 'psn_id_taken': return { text: 'Этот профиль PSN уже подключён (у вас или у другого пользователя). Один аккаунт PSN можно подключить только один раз.' };
    case 'psn_not_found': return { text: `Профиль «${nick}» не найден в PSN. Проверь написание ника.` };
    case 'psn_private': return { text: `Профиль «${nick}» закрыт. Откройте игры и трофеи для всех в настройках приватности PSN и повторите.` };
    case 'rate_limited': return { text: retryText(e.retryAfterSec) };
    case 'psn_unavailable': return { text: 'PSN сейчас недоступен. Повтори чуть позже.', retry: true };
    case 'network': return { text: 'Нет связи. Проверь интернет и повтори.' };
    default:
      if (e.status === 429) return { text: retryText(e.retryAfterSec) };
      return { text: 'Не удалось добавить профиль. Повтори позже.' };
  }
}

/** Тост при «Вернуть» из архива (§17.6). */
export function restoreErrorText(e: ApiFail): string {
  switch (e.code) {
    case 'profile_limit': return 'Нет свободного места: 3 из 3. Сначала отвяжи другой профиль.';
    case 'psn_id_taken': return 'Этот аккаунт PSN уже подключён к другому профилю. Вернуть нельзя.';
    case 'rate_limited': return retryText(e.retryAfterSec);
    case 'psn_private': return 'Профиль закрыт. Откройте игры и трофеи для всех в настройках приватности PSN и повторите.';
    case 'psn_not_found': return 'Профиль не найден в PSN. Проверь написание ника.';
    case 'psn_unavailable': return 'PSN сейчас недоступен. Повтори чуть позже.';
    default: return e.status === 429 ? retryText(e.retryAfterSec) : 'Не удалось вернуть профиль. Повтори.';
  }
}

export type UnlinkFail = { text: string; field?: boolean; close?: boolean; reload?: boolean };

/** Ошибки отвязки и «Удалить сразу» (§17.5). */
export function unlinkErrorText(e: ApiFail, nick: string, purge: boolean): UnlinkFail {
  switch (e.code) {
    case 'confirm_mismatch': return { text: `Ник не совпал. Введите «${nick}» точно.`, field: true };
    case 'primary_protected': return { text: 'Основной профиль отвязать нельзя.', reload: true };
    case 'sync_in_progress': return { text: 'Сейчас идёт синк этого профиля. Подожди минуту и повтори.' };
    case 'not_found': return { text: 'Этот профиль уже отвязан или удалён.', close: true, reload: true };
    default: return { text: purge ? 'Не удалось удалить профиль. Повтори.' : 'Не удалось отвязать профиль. Повтори.' };
  }
}

export function switchErrorText(e: ApiFail): { text: string; retry: boolean; reload: boolean } {
  if (e.code === 'not_found' || e.status === 404) return { text: 'Этого профиля уже нет. Список обновлён.', retry: false, reload: true };
  return { text: 'Не удалось сменить профиль. Повтори.', retry: true, reload: false };
}

/** Почему «Добавить» недоступна (§17.3). null = можно. */
export function addBlockedText(canAdd: boolean, activeCount: number, limit: number): string | null {
  if (canAdd) return null;
  if (activeCount >= limit) return `Достигнут лимит: ${limit} из ${limit}. Отвяжи профиль, чтобы добавить другой.`;
  return 'Сейчас нельзя добавить профиль: достигнут общий лимит пользователей.';
}

export const veilText = (nick: string): string => `Открываю профиль ${nick}…`;
export const switchedToast = (nick: string): string => `Профиль PSN: ${nick}`;
