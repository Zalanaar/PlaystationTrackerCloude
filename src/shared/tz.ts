// Часовой пояс устройства для показа времени (Пакет 6, п. 3): часы и минуты показываем по часам телефона, без подписи «МСК».
// Границы дней, месяцев и годов (хроника, статистика, лимиты) остаются по Europe/Moscow. Чистые функции без env/БД/сети.

export const MSK_TZ = 'Europe/Moscow';

/** IANA-имя без экзотики: буквы, цифры, «/», «_», «+», «-»; до 64 символов. Дальше проверяет Intl. */
const TZ_RE = /^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/;

/** Допустимый часовой пояс (IANA, известный Intl). Используется и как защита перед вставкой литерала в SQL. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64 || !TZ_RE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Пояс устройства (браузер); при сбое или вне браузера — Москва. */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : MSK_TZ;
  } catch {
    return MSK_TZ;
  }
}

/** Разбор параметра ?tz=: пусто или мусор = Москва (старое поведение), без ошибки. */
export function parseTzParam(raw: string | null | undefined): string {
  return isValidTimeZone(raw) ? raw : MSK_TZ;
}
