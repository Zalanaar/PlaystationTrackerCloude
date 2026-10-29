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
