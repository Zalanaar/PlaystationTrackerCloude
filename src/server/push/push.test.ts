// П14.2: push на PGlite — env, белый список push-сервисов, подписка/лимит/отписка, отправка (404/410 и сбои), «Релиз завтра» один раз.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { generateVAPIDKeys, generateRequestDetails } from 'web-push';
import { schema } from '@/db';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import {
  MAX_FAILS, MAX_SUBS_PER_USER, getPushEnv, pushEndpointAllowed, pushOptions, pushState, releaseText, removeSubscription, runReleasePushes,
  saveSubscription, sendToUser, validSub, type PushEnv, type PushSender,
} from './push';

const KEY = 'B'.repeat(87);
const AUTH = 'a'.repeat(22);
const ENV: PushEnv = { publicKey: KEY, privateKey: 'k'.repeat(43), subject: 'mailto:a@example.com' };
const sub = (n: number, host = 'web.push.apple.com') => ({ endpoint: `https://${host}/sub-${n}`, keys: { p256dh: KEY, auth: AUTH } });

describe('push: env и проверки', () => {
  it('без ключей — выключено; subject из env или адреса прода', () => {
    expect(getPushEnv({})).toBeNull();
    expect(getPushEnv({ VAPID_PUBLIC_KEY: KEY })).toBeNull();
    expect(getPushEnv({ VAPID_PUBLIC_KEY: KEY, VAPID_PRIVATE_KEY: 'k'.repeat(43) })).toBeNull();
    expect(getPushEnv({ VAPID_PUBLIC_KEY: KEY, VAPID_PRIVATE_KEY: 'k'.repeat(43), VERCEL_PROJECT_PRODUCTION_URL: 'ps.example' })?.subject).toBe('https://ps.example');
    expect(getPushEnv({ VAPID_PUBLIC_KEY: KEY, VAPID_PRIVATE_KEY: 'k'.repeat(43), VAPID_SUBJECT: 'mailto:x@y.z' })?.subject).toBe('mailto:x@y.z');
    expect(getPushEnv({ VAPID_PUBLIC_KEY: 'bad key!', VAPID_PRIVATE_KEY: 'k'.repeat(43), VAPID_SUBJECT: 'mailto:x@y.z' })).toBeNull();
  });
  it('только push-сервисы браузеров по https', () => {
    for (const ok of ['https://web.push.apple.com/x', 'https://api.push.apple.com/x', 'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-db5p.notify.windows.com/w/?token=x']) expect(pushEndpointAllowed(ok), ok).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'https://169.254.169.254/', 'not a url', `https://fcm.googleapis.com/${'x'.repeat(1000)}`]) expect(pushEndpointAllowed(bad), bad).toBe(false);
    expect(validSub({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'short', auth: AUTH } })).toBe(false);
  });
  it('настоящие ключи VAPID: web-push собирает запрос aes128gcm с нашими параметрами', () => {
    const k = generateVAPIDKeys();
    const env = getPushEnv({ VAPID_PUBLIC_KEY: k.publicKey, VAPID_PRIVATE_KEY: k.privateKey, VAPID_SUBJECT: 'mailto:a@example.com' })!;
    expect(env).not.toBeNull();
    const client = generateVAPIDKeys(); // как ключ клиента подходит любой P-256 открытый ключ
    const d = generateRequestDetails({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: client.publicKey, auth: 'AAAAAAAAAAAAAAAAAAAAAA' } }, '{"title":"t"}', pushOptions(env));
    expect(d.headers['Content-Encoding']).toBe('aes128gcm');
    expect(d.headers.TTL).toBe(86400);
    expect(String(d.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
  });
  it('текст «Релиз завтра»', () => {
    expect(releaseText(['A'])).toBe('Завтра выходит «A».');
    expect(releaseText(['A', 'B', 'C'])).toBe('Завтра выходят «A», «B» и «C».');
    expect(releaseText(['A', 'B', 'C', 'D', 'E'])).toBe('Завтра выходят «A», «B» и ещё 3.');
  });
});

describe('push на PGlite', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); });

  it('подписка: upsert по endpoint, лимит устройств, отписка только своей', async () => {
    for (let i = 0; i < MAX_SUBS_PER_USER + 2; i++) await saveSubscription(t.db, TEST_USER, sub(i));
    await saveSubscription(t.db, TEST_USER, sub(5));
    const s = await pushState(t.db, TEST_USER, sub(5).endpoint);
    expect(s).toEqual({ devices: MAX_SUBS_PER_USER, thisDevice: true });
    expect(await removeSubscription(t.db, 999, sub(5).endpoint)).toBe(false);
    expect(await removeSubscription(t.db, TEST_USER, sub(5).endpoint)).toBe(true);
    expect((await pushState(t.db, TEST_USER, sub(5).endpoint)).thisDevice).toBe(false);
  });

  it('отправка: 201 — ок, 410 — удалить, 500 — счётчик, после MAX_FAILS удалить', async () => {
    await saveSubscription(t.db, TEST_USER, sub(1));
    await saveSubscription(t.db, TEST_USER, sub(2));
    await saveSubscription(t.db, TEST_USER, sub(3));
    const codes: Record<string, number> = { [sub(1).endpoint]: 201, [sub(2).endpoint]: 410, [sub(3).endpoint]: 500 };
    const send: PushSender = vi.fn(async (s) => codes[s.endpoint]);
    const p = { title: 't', body: 'b', url: '/', tag: 'x' };
    expect(await sendToUser(t.db, TEST_USER, p, ENV, send)).toEqual({ sent: 1, removed: 1 });
    for (let i = 1; i < MAX_FAILS; i++) await sendToUser(t.db, TEST_USER, p, ENV, send);
    expect((await t.db.select().from(schema.pushSubscriptions)).map((r) => r.endpoint)).toEqual([sub(1).endpoint]);
    expect(JSON.parse((send as ReturnType<typeof vi.fn>).mock.calls[0][1] as string)).toEqual(p);
  });

  it('«Релиз завтра»: только завтрашние релизы, одно уведомление на дату; без env — ничего', async () => {
    const now = new Date('2026-11-30T16:00:00Z'); // 19:00 МСК, завтра 01.12
    await t.db.insert(schema.plannedGames).values([
      { userId: TEST_USER, title: 'Завтрашняя', releaseDate: '2026-12-01', status: 'planned' },
      { userId: TEST_USER, title: 'Послезавтра', releaseDate: '2026-12-02', status: 'planned' },
    ]);
    const send: PushSender = vi.fn(async () => 201);
    expect(await runReleasePushes(t.db, now, null, send)).toEqual({ users: 0, sent: 0 });
    expect(await runReleasePushes(t.db, now, ENV, send)).toEqual({ users: 0, sent: 0 }); // нет подписок
    await saveSubscription(t.db, TEST_USER, sub(1));
    expect(await runReleasePushes(t.db, now, ENV, send)).toEqual({ users: 1, sent: 1 });
    expect(await runReleasePushes(t.db, now, ENV, send)).toEqual({ users: 0, sent: 0 });
    const body = JSON.parse((send as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    expect(body).toEqual({ title: 'Релиз завтра', body: 'Завтра выходит «Завтрашняя».', url: '/roadmap', tag: 'release-2026-12-01' });
    const log = (await t.pg.execute(sql`select kind, ref from push_log`)).rows;
    expect(log).toEqual([{ kind: 'release', ref: '2026-12-01' }]);
  });
});
