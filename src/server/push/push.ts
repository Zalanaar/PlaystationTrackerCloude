// П14.2: Web Push по желанию пользователя. Подписка — по кнопке в приложении (PWA на iPhone с iOS 16.4+), хранится по устройству.
// Ключи VAPID — в env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, VAPID_SUBJECT); без них push выключен целиком.
// Отправка — только на известные push-сервисы браузеров (не произвольный адрес: SSRF). В уведомлении — только названия игр.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db';
import type { AnyDb } from '@/db/types';
import { asUserId } from '@/server/auth/user-id';
import { getReleases } from '@/server/roadmap/releases-ics';

const { pushSubscriptions, pushLog } = schema;

export type PushEnv = { publicKey: string; privateKey: string; subject: string };
export type PushPayload = { title: string; body: string; url: string; tag: string };
export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
/** Отправитель (настоящий — web-push; в тестах — заглушка). Возвращает HTTP-статус push-сервиса. */
export type PushSender = (sub: PushSub, payload: string, env: PushEnv) => Promise<number>;

export const MAX_SUBS_PER_USER = 10;
export const MAX_FAILS = 5;
const KEY_RE = /^[A-Za-z0-9_-]{20,200}={0,2}$/;

export function getPushEnv(env: Record<string, string | undefined> = process.env): PushEnv | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey || !KEY_RE.test(publicKey) || !KEY_RE.test(privateKey)) return null;
  const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const subject = env.VAPID_SUBJECT?.trim() || (host ? `https://${host}` : '');
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/** Push-сервисы браузеров: Apple (Safari/iOS), Google (Chrome/Android), Mozilla, Microsoft. */
export function pushEndpointAllowed(endpoint: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password || endpoint.length > 1000) return false;
  const h = u.hostname.toLowerCase();
  return h === 'fcm.googleapis.com' || h === 'android.googleapis.com' || h === 'web.push.apple.com' || h.endsWith('.push.apple.com')
    || h === 'updates.push.services.mozilla.com' || h.endsWith('.notify.windows.com');
}

export function validSub(s: PushSub): boolean {
  return pushEndpointAllowed(s.endpoint) && KEY_RE.test(s.keys.p256dh) && KEY_RE.test(s.keys.auth);
}

export async function saveSubscription(db: AnyDb, userId: number, s: PushSub): Promise<void> {
  await db.insert(pushSubscriptions)
    .values({ userId, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: s.keys.p256dh, auth: s.keys.auth, failCount: 0, createdAt: sql`now()` } });
  // не больше MAX_SUBS_PER_USER устройств: старые выпадают
  const rows = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId)).orderBy(sql`${pushSubscriptions.createdAt} desc`, sql`${pushSubscriptions.id} desc`);
  const extra = rows.slice(MAX_SUBS_PER_USER).map((r) => r.id);
  if (extra.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, extra));
}

export async function removeSubscription(db: AnyDb, userId: number, endpoint: string): Promise<boolean> {
  const r = await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint))).returning({ id: pushSubscriptions.id });
  return r.length > 0;
}

export async function pushState(db: AnyDb, userId: number, endpoint: string | null): Promise<{ devices: number; thisDevice: boolean }> {
  const rows = await db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  return { devices: rows.length, thisDevice: endpoint !== null && rows.some((r) => r.endpoint === endpoint) };
}

/** Отправить всем устройствам пользователя. 404/410 — подписка умерла, удаляем; другие сбои считаем, после MAX_FAILS удаляем. */
export async function sendToUser(db: AnyDb, userId: number, payload: PushPayload, env: PushEnv, send: PushSender): Promise<{ sent: number; removed: number }> {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).orderBy(asc(pushSubscriptions.id));
  const body = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;
  for (const s of subs) {
    let status = 0;
    try { status = await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, env); } catch { status = 0; }
    if (status >= 200 && status < 300) {
      sent++;
      await db.update(pushSubscriptions).set({ lastOkAt: new Date(), failCount: 0 }).where(eq(pushSubscriptions.id, s.id));
    } else if (status === 404 || status === 410 || s.failCount + 1 >= MAX_FAILS) {
      removed++;
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
    } else {
      await db.update(pushSubscriptions).set({ failCount: s.failCount + 1 }).where(eq(pushSubscriptions.id, s.id));
    }
  }
  return { sent, removed };
}

export const mskDay = (now: Date, plusDays = 0) => new Date(now.getTime() + 3 * 3600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

export function releaseText(titles: string[]): string {
  const t = titles.map((x) => `«${x}»`);
  if (t.length === 1) return `Завтра выходит ${t[0]}.`;
  if (t.length <= 3) return `Завтра выходят ${t.slice(0, -1).join(', ')} и ${t.at(-1)}.`;
  return `Завтра выходят ${t.slice(0, 2).join(', ')} и ещё ${t.length - 2}.`;
}

/** Cron (раз в сутки, 19:00 МСК): «завтра выходит …» по релизам плана и бэклога. Одно уведомление на пользователя и дату (push_log). */
export async function runReleasePushes(db: AnyDb, now: Date, env: PushEnv | null, send: PushSender): Promise<{ users: number; sent: number }> {
  if (!env) return { users: 0, sent: 0 };
  const userIds = [...new Set((await db.selectDistinct({ u: pushSubscriptions.userId }).from(pushSubscriptions)).map((r) => r.u))];
  const tomorrow = mskDay(now, 1);
  let users = 0;
  let sent = 0;
  for (const userId of userIds) {
    const titles = (await getReleases(db, asUserId(userId), now, { notes: false })).filter((r) => r.date === tomorrow).map((r) => r.title);
    if (titles.length === 0) continue;
    // сначала запись в журнал: повторный запуск cron в тот же день ничего не шлёт
    const claimed = await db.insert(pushLog).values({ userId, kind: 'release', ref: tomorrow }).onConflictDoNothing().returning({ u: pushLog.userId });
    if (claimed.length === 0) continue;
    users++;
    sent += (await sendToUser(db, userId, { title: 'Релиз завтра', body: releaseText(titles), url: '/roadmap', tag: `release-${tomorrow}` }, env, send)).sent;
  }
  return { users, sent };
}

export const pushOptions = (env: PushEnv) => ({
  vapidDetails: { subject: env.subject, publicKey: env.publicKey, privateKey: env.privateKey }, TTL: 86_400, urgency: 'normal' as const, timeout: 10_000,
});

/** Настоящий отправитель через web-push (TTL сутки: устаревшее «завтра» не нужно). */
export const webPushSender: PushSender = async (sub, payload, env) => {
  const { sendNotification } = await import('web-push');
  try {
    const r = await sendNotification(sub, payload, pushOptions(env));
    return r.statusCode;
  } catch (e) {
    const code = (e as { statusCode?: unknown }).statusCode;
    return typeof code === 'number' ? code : 0;
  }
};
