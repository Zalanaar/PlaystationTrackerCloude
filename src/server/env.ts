// Чтение секретов из env. Fail closed: невалидное значение = null, вызывающий отвечает config_error / 401.
// Значения никогда не логируются и не попадают в сообщения об ошибках.
import { z } from 'zod';

const adminPassword = z.string().min(12);
const longSecret = z.string().min(32);

export type AuthEnv = { adminPassword: string; sessionSecret: string };

export function getAuthEnv(env: Record<string, string | undefined> = process.env): AuthEnv | null {
  const p = adminPassword.safeParse(env.ADMIN_PASSWORD);
  const s = longSecret.safeParse(env.SESSION_SECRET);
  if (!p.success || !s.success) return null;
  return { adminPassword: p.data, sessionSecret: s.data };
}

export function getSessionSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = longSecret.safeParse(env.SESSION_SECRET);
  return s.success ? s.data : null;
}

export function getCronSecret(env: Record<string, string | undefined> = process.env): string | null {
  const s = longSecret.safeParse(env.CRON_SECRET);
  return s.success ? s.data : null;
}

export type PsnEnv = {
  /** NPSSO нужен только пока нет рабочего refresh token; может отсутствовать */
  npsso: string | null;
  targetOnlineId: string;
  encryptionKey: string;
  requestDelayMs: number;
  timeBudgetMs: number;
};

/** Потолок бюджета звена: maxDuration = 60 с, остаток нужен на последний батч и закрытие запуска. */
export const MAX_TIME_BUDGET_MS = 55_000;

function intEnv(v: string | undefined, def: number, min: number, max: number): number {
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : def;
}

/** null, если не хватает обязательного (PSN_TARGET_ONLINE_ID, TOKEN_ENCRYPTION_KEY = 32 байта base64). Значения не логируются. */
export function getPsnEnv(env: Record<string, string | undefined> = process.env): PsnEnv | null {
  const target = env.PSN_TARGET_ONLINE_ID?.trim();
  const key = env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!target || !key || Buffer.from(key, 'base64').length !== 32) return null;
  return {
    npsso: env.PSN_NPSSO?.trim() || null,
    targetOnlineId: target,
    encryptionKey: key,
    requestDelayMs: intEnv(env.PSN_REQUEST_DELAY_MS, 300, 0, 5000),
    timeBudgetMs: intEnv(env.SYNC_TIME_BUDGET_MS, 50000, 1000, MAX_TIME_BUDGET_MS),
  };
}

/**
 * Доверенный origin для самовызова продолжения синка (туда уходит Bearer CRON_SECRET). Никогда не берётся из запроса.
 * Порядок: SYNC_ORIGIN, на Vercel production VERCEL_PROJECT_PRODUCTION_URL, иначе VERCEL_URL; вне production без них http://localhost:PORT.
 * null = цепочку не продолжаем (запасной путь: cron и кнопка).
 */
export function getSyncOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const norm = (v: string | undefined, defaultProto: 'https' | 'http'): string | null => {
    const s = v?.trim();
    if (!s) return null;
    try {
      const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
      const u = new URL(hasScheme ? s : `${defaultProto}://${s}`);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
    } catch {
      return null;
    }
  };
  const explicit = norm(env.SYNC_ORIGIN, 'https');
  if (explicit) return explicit;
  const vercel = (env.VERCEL_ENV === 'production' ? norm(env.VERCEL_PROJECT_PRODUCTION_URL, 'https') : null) ?? norm(env.VERCEL_URL, 'https');
  if (vercel) return vercel;
  if (env.NODE_ENV !== 'production') return `http://localhost:${/^\d{2,5}$/.test(env.PORT ?? '') ? env.PORT : '3000'}`;
  return null;
}

/** Ключ RAWG (Фаза 12, контракт 17.2). null = каталог не настроен, поиск отвечает catalog_unavailable. Значение не логируется. */
export function getRawgKey(env: Record<string, string | undefined> = process.env): string | null {
  const k = env.RAWG_API_KEY?.trim();
  return k ? k : null;
}

/**
 * Публичный origin сайта для абсолютных ссылок в Telegram (контракт 15.4). Только APP_ORIGIN (http/https);
 * null = ссылки не добавляем. Намеренно не берёт VERCEL_URL: у preview-деплоев он не тот адрес, что открывает Артём.
 */
export function getAppOrigin(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.APP_ORIGIN?.trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

export type LlmEnv = { provider: 'gemini' | 'groq'; apiKey: string; model: string | null; dailyLimit: number; /** вызовов на пользователя в сутки (22.13); нет = 12 */ userDailyLimit?: number };

/** Без LLM_DAILY_LIMIT: хватает 5 пользователям по 12 вызовов (22.13, W-3). */
export const LLM_DEFAULT_DAILY_LIMIT = 60;
export const LLM_MAX_DAILY_LIMIT = 200;
export const LLM_DEFAULT_USER_DAILY_LIMIT = 12;

/**
 * Фаза 13 (контракт 18.2); LLM_DAILY_LIMIT с Фазы 20.4 — общий потолок по сумме пользователей (22.13). null = LLM выключен (нет провайдера или ключа, неизвестный провайдер, лимит 0): работаем на шаблонах.
 * Ключ не логируется. LLM_MODEL необязателен (смена модели без деплоя кода).
 */
export function getLlmEnv(env: Record<string, string | undefined> = process.env): LlmEnv | null {
  const provider = env.LLM_PROVIDER?.trim().toLowerCase();
  if (provider !== 'gemini' && provider !== 'groq') return null;
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) return null;
  const dailyLimit = intEnv(env.LLM_DAILY_LIMIT, LLM_DEFAULT_DAILY_LIMIT, 0, LLM_MAX_DAILY_LIMIT);
  if (dailyLimit === 0) return null;
  const userDailyLimit = intEnv(env.LLM_USER_DAILY_LIMIT, LLM_DEFAULT_USER_DAILY_LIMIT, 1, LLM_MAX_DAILY_LIMIT);
  const model = env.LLM_MODEL?.trim();
  return { provider, apiKey, model: model && /^[\w.:\-/]{1,80}$/.test(model) ? model : null, dailyLimit, userDailyLimit };
}

export type GoogleEnv = { clientId: string; clientSecret: string; origin: string };

/** Google OAuth (контракт 22.4/22.8). null = вход Google не настроен (вход паролем owner работает). Секрет не логируется. */
export function getGoogleEnv(env: Record<string, string | undefined> = process.env): GoogleEnv | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const origin = getAppOrigin(env);
  if (!clientId || !clientSecret || !origin) return null;
  return { clientId, clientSecret, origin };
}

export const DEFAULT_MAX_USERS = 10;

/** Мультипользовательность (контракт 22.7/22.8): MULTIUSER_ENABLED=1 разрешает добавлять member; MAX_USERS (1..100, по умолчанию 10). */
export function getMultiuserEnv(env: Record<string, string | undefined> = process.env): { enabled: boolean; maxUsers: number } {
  return { enabled: env.MULTIUSER_ENABLED?.trim() === '1', maxUsers: intEnv(env.MAX_USERS, DEFAULT_MAX_USERS, 1, 100) };
}

/**
 * W-3 (22.13): общий потолок LLM меньше `пользователи x LLM_USER_DAILY_LIMIT` — владелец (идёт первым) съест бюджет, остальным не хватит.
 * Возвращает текст предупреждения или null. Без секретов, пригоден для лога.
 */
export function llmLimitWarning(llm: Pick<LlmEnv, 'dailyLimit' | 'userDailyLimit'> | null, activeUsers: number): string | null {
  if (!llm) return null;
  const need = activeUsers * (llm.userDailyLimit ?? LLM_DEFAULT_USER_DAILY_LIMIT);
  if (llm.dailyLimit >= need) return null;
  return `LLM_DAILY_LIMIT=${llm.dailyLimit} меньше нужного ${need} (${activeUsers} польз. x ${llm.userDailyLimit ?? LLM_DEFAULT_USER_DAILY_LIMIT}): последним в обходе LLM не хватит`;
}
