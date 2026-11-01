// Привязка чата (контракт F29.6, F29.7): коды, /start, /stop, лимиты, чужие чаты, API сайта и webhook.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { resetTestSession, testSession } from '@/server/auth/test-require-user';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';

const holder: { db: TestDb['db'] | null } = { db: null };
vi.mock('@/db', async (orig) => ({
  ...(await orig<typeof import('@/db')>()),
  getDb: () => {
    if (!holder.db) throw new Error('no db');
    return holder.db;
  },
}));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

import { DELETE as unlinkApi, GET as statusApi } from '@/app/api/me/telegram/route';
import { POST as linkApi } from '@/app/api/me/telegram/link/route';
import { POST as webhook } from '@/app/api/telegram/webhook/route';
import { BOT_TEXT, replyFor, type TelegramUpdate } from './bot';
import { bindChat, CODE_ALPHABET, CODE_TTL_MS, createLinkCode, generateCode, hashCode, normalizeCode } from './link';

const { telegramChats, telegramLinkCodes, telegramLinkAttempts } = schema;
const A = TEST_USER;
const B = TEST_USER_2;
const NOW = new Date('2026-11-01T10:00:00Z');
const SECRET = 'webhook-secret-0123456789';
const upd = (text: string, chat = 500, type = 'private'): TelegramUpdate => ({ message: { text, chat: { id: chat, type } } });

describe('привязка Telegram', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    holder.db = t.db;
    await t.db.execute(sql.raw(`insert into allowed_users (email, role, status, psn_online_id) values ('b@example.com', 'member', 'active', 'Boris')`));
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    resetTestSession();
    vi.unstubAllEnvs();
  });

  const mk = async (userId = A, now = NOW) => {
    const r = await createLinkCode(t.db, userId, now);
    if (!r.ok) throw new Error('code');
    return r.code;
  };

  describe('коды', () => {
    it('формат: 8 символов алфавита без 0/O/1/I; регистр не важен; хранится хеш', async () => {
      expect(CODE_ALPHABET).not.toMatch(/[01OI]/);
      for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(normalizeCode(' k7m2qx9h ')).toBe('K7M2QX9H');
      expect(normalizeCode('K7M2QX90')).toBeNull();
      expect(normalizeCode('SHORT')).toBeNull();
      const code = await mk();
      const [row] = await t.db.select().from(telegramLinkCodes);
      expect(row.codeHash).toBe(hashCode(code));
      expect(JSON.stringify(row)).not.toContain(code);
      expect(row.expiresAt.getTime() - NOW.getTime()).toBe(CODE_TTL_MS);
    });
    it('новый код заменяет прежний', async () => {
      const c1 = await mk();
      const c2 = await mk();
      expect((await bindChat(t.db, '500', c1, NOW)).kind).toBe('invalid');
      expect((await bindChat(t.db, '500', c2, NOW)).kind).toBe('ok');
    });
    it('создание кодов: не больше 5 за 10 минут', async () => {
      for (let i = 0; i < 5; i++) await mk();
      expect(await createLinkCode(t.db, A, NOW)).toEqual({ ok: false, reason: 'rate_limited' });
      expect((await createLinkCode(t.db, B, NOW)).ok).toBe(true);
      expect((await createLinkCode(t.db, A, new Date(NOW.getTime() + 11 * 60_000))).ok).toBe(true);
    });
  });

  describe('/start и /stop', () => {
    it('верный код привязывает, ответ с ником, код одноразовый', async () => {
      const code = await mk(B);
      const r = await replyFor(t.db, upd(`/start ${code}`), { now: NOW, origin: 'https://ps.example.app' });
      expect(r?.text).toBe('Готово: чат привязан к Boris. Сводка будет приходить по воскресеньям вечером (МСК). Отписаться: /stop. Статус и настройки: https://ps.example.app/');
      expect((await t.db.select().from(telegramChats))).toMatchObject([{ userId: B, chatId: '500' }]);
      // тот же код из другого чата: использован
      expect((await replyFor(t.db, upd(`/start ${code}`, 501), { now: NOW }))?.text).toBe(BOT_TEXT.expired);
    });
    it('без origin нет ссылки', async () => {
      const code = await mk(B);
      expect((await replyFor(t.db, upd(`/start@ps_bot ${code.toLowerCase()}`), { now: NOW, origin: null }))?.text).not.toContain('http');
    });
    it('неверный код, просроченный, без кода, мусор, не приватный чат', async () => {
      expect((await replyFor(t.db, upd('/start ABCDEFGH'), { now: NOW }))?.text).toBe(BOT_TEXT.invalid);
      expect((await replyFor(t.db, upd('/start 12'), { now: NOW }))?.text).toBe(BOT_TEXT.invalid);
      const code = await mk();
      expect((await replyFor(t.db, upd(`/start ${code}`), { now: new Date(NOW.getTime() + CODE_TTL_MS) }))?.text).toBe(BOT_TEXT.expired);
      expect((await replyFor(t.db, upd('/start'), { now: NOW }))?.text).toBe(BOT_TEXT.help);
      expect((await replyFor(t.db, upd('привет'), { now: NOW }))?.text).toBe(BOT_TEXT.unknown);
      expect(await replyFor(t.db, upd('/start X', -100, 'group'), { now: NOW })).toBeNull();
      expect(await replyFor(t.db, {}, { now: NOW })).toBeNull();
      expect(await t.db.select().from(telegramChats)).toEqual([]);
    });
    it('5 неверных попыток за 10 минут блокируют чат, даже верный код; через 10 минут снова можно', async () => {
      const code = await mk();
      for (let i = 0; i < 5; i++) await replyFor(t.db, upd('/start ABCDEFGH'), { now: NOW });
      expect((await replyFor(t.db, upd(`/start ${code}`), { now: NOW }))?.text).toBe(BOT_TEXT.tooMany);
      // другой чат не затронут
      expect((await replyFor(t.db, upd(`/start ${code}`, 777), { now: NOW }))?.text).toContain('Готово');
      const later = new Date(NOW.getTime() + 10 * 60_000 + 1);
      const code2 = await mk(A, later);
      expect((await replyFor(t.db, upd(`/start ${code2}`), { now: later }))?.text).toContain('Готово');
    });
    it('чат уже привязан к тому же пользователю / к другому', async () => {
      const c1 = await mk(A);
      await replyFor(t.db, upd(`/start ${c1}`), { now: NOW });
      const c1b = await mk(A);
      expect((await replyFor(t.db, upd(`/start ${c1b}`), { now: NOW }))?.text).toMatch(/^Этот чат уже привязан к .+\. Отписаться: \/stop\.$/);
      const c2 = await mk(B);
      expect((await replyFor(t.db, upd(`/start ${c2}`), { now: NOW }))?.text).toBe(BOT_TEXT.alreadyOther);
      expect((await t.db.select().from(telegramChats)).map((r) => r.userId)).toEqual([A]);
    });
    it('смена чата: новый чат заменяет прежний у пользователя', async () => {
      await replyFor(t.db, upd(`/start ${await mk(B)}`, 500), { now: NOW });
      await replyFor(t.db, upd(`/start ${await mk(B)}`, 600), { now: NOW });
      expect((await t.db.select().from(telegramChats))).toMatchObject([{ userId: B, chatId: '600' }]);
    });
    it('/stop отвязывает только этот чат', async () => {
      await replyFor(t.db, upd(`/start ${await mk(A)}`, 500), { now: NOW });
      await replyFor(t.db, upd(`/start ${await mk(B)}`, 600), { now: NOW });
      expect((await replyFor(t.db, upd('/stop', 500), { now: NOW }))?.text).toBe(BOT_TEXT.stopped);
      expect((await replyFor(t.db, upd('/stop', 500), { now: NOW }))?.text).toBe(BOT_TEXT.notLinked);
      expect((await t.db.select().from(telegramChats)).map((r) => r.userId)).toEqual([B]);
    });
    it('заблокированный пользователь не может привязать чат', async () => {
      const code = await mk(B);
      await t.db.execute(sql.raw(`update allowed_users set status = 'blocked' where id = 2`));
      expect((await replyFor(t.db, upd(`/start ${code}`), { now: NOW }))?.text).toBe(BOT_TEXT.invalid);
      await t.db.execute(sql.raw(`update allowed_users set status = 'active' where id = 2`));
      expect(await t.db.select().from(telegramLinkAttempts)).not.toEqual([]);
    });
  });

  describe('API сайта и webhook', () => {
    const req = (method: string, path = '/api/me/telegram', body?: unknown) =>
      new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', host: 'localhost', origin: 'http://localhost' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const hook = (secret: string | null, body: unknown) =>
      new Request('http://localhost/api/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}) }, body: JSON.stringify(body) });

    it('бот не настроен: статус botConfigured=false, создание кода 503', async () => {
      const s = await (await statusApi(req('GET'))).json();
      expect(s.data).toMatchObject({ botConfigured: false, linked: false, deliversTo: 'none', pendingCode: null });
      expect((await linkApi(req('POST', '/api/me/telegram/link', {}))).status).toBe(503);
    });

    it('полный цикл: код -> /start через webhook -> статус -> отвязка', async () => {
      vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:SECRET-TOKEN');
      vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET);
      vi.stubEnv('TELEGRAM_BOT_USERNAME', '@ps_tracker_bot');
      const sent: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => { sent.push(JSON.parse(init.body).text); return new Response('{"ok":true}'); }));
      testSession.userId = B;
      testSession.role = 'member';
      const made = await (await linkApi(req('POST', '/api/me/telegram/link', {}))).json();
      expect(made.data.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(made.data.deepLink).toBe(`https://t.me/ps_tracker_bot?start=${made.data.code}`);
      let s = await (await statusApi(req('GET'))).json();
      expect(s.data).toMatchObject({ botConfigured: true, linked: false, pendingCode: { expiresAt: expect.any(String) }, role: 'member' });
      expect(JSON.stringify(s)).not.toContain(made.data.code);

      const res = await webhook(hook(SECRET, upd(`/start ${made.data.code}`, 888)));
      expect(res.status).toBe(200);
      expect(sent[0]).toContain('Готово: чат привязан к Boris');
      s = await (await statusApi(req('GET'))).json();
      expect(s.data).toMatchObject({ linked: true, deliversTo: 'own_chat', pendingCode: null });

      // чужой пользователь не видит чужую привязку
      testSession.userId = A;
      testSession.role = 'owner';
      expect((await (await statusApi(req('GET'))).json()).data).toMatchObject({ linked: false, deliversTo: 'none' });

      testSession.userId = B;
      testSession.role = 'member';
      expect((await (await unlinkApi(req('DELETE'))).json()).data).toEqual({ linked: false });
      expect((await (await unlinkApi(req('DELETE'))).json()).data).toEqual({ linked: false });
      expect(await t.db.select().from(telegramChats)).toEqual([]);
      vi.unstubAllGlobals();
    });

    it('владелец без привязки: deliversTo = alerts_chat при TELEGRAM_CHAT_ID', async () => {
      vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:SECRET-TOKEN');
      vi.stubEnv('TELEGRAM_CHAT_ID', '42');
      expect((await (await statusApi(req('GET'))).json()).data.deliversTo).toBe('alerts_chat');
    });

    it('webhook: без секрета, с чужим секретом и без настроенного секрета 401, привязка не происходит', async () => {
      const code = await mk();
      const body = upd(`/start ${code}`, 888);
      vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET);
      expect((await webhook(hook(null, body))).status).toBe(401);
      expect((await webhook(hook('wrong-secret-0123456789', body))).status).toBe(401);
      vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '');
      expect((await webhook(hook(SECRET, body))).status).toBe(401);
      expect(await t.db.select().from(telegramChats)).toEqual([]);
    });

    it('webhook: битый JSON и сбой БД отвечают 200', async () => {
      vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET);
      const bad = new Request('http://localhost/api/telegram/webhook', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': SECRET }, body: '{' });
      expect((await webhook(bad)).status).toBe(200);
      const saved = holder.db;
      holder.db = null;
      const errs = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect((await webhook(hook(SECRET, upd('/stop')))).status).toBe(200);
      errs.mockRestore();
      holder.db = saved;
    });
  });
});
