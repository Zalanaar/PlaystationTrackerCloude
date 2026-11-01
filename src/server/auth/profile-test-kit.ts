// Только для тестов Фазы 41: настоящие cookie сессии (подпись SESSION_SECRET) и запросы к роутам поверх PGlite.
import { createSessionTokenV2, SESSION_COOKIE, type SessionRole } from './session';

export const KIT_SECRET = 's'.repeat(40);
export const KIT_ORIGIN = 'https://app.example';

export async function sessionCookie(uid: number, o: { pid?: number; role?: SessionRole; nowMs?: number } = {}): Promise<string> {
  const token = await createSessionTokenV2(KIT_SECRET, { uid, pid: o.pid, role: o.role ?? 'member', amr: 'google' }, o.nowMs);
  return `${SESSION_COOKIE}=${token}`;
}

export function kitRequest(path: string, o: { method?: string; cookie?: string; body?: unknown; origin?: string | null } = {}): Request {
  const headers: Record<string, string> = { host: 'app.example' };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.origin !== null) headers.origin = o.origin ?? KIT_ORIGIN;
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`${KIT_ORIGIN}${path}`, { method: o.method ?? 'GET', headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
}

/** Значение Set-Cookie сессии из ответа (undefined = не ставилась). Пустая строка = очистка. */
export function setCookieToken(res: Response): string | undefined {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return raw ? raw.split(';')[0].slice(SESSION_COOKIE.length + 1) : undefined;
}
