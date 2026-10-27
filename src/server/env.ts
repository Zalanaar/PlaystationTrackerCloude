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
