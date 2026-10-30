import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getTelegramEnv, messageFor, notifyAfterSync, sendTelegram } from './telegram';

const { syncRuns, psnAuth, notifyLog } = schema;
const ENV = { token: '123:SECRET-TOKEN', chatId: '42' };
const NOW = new Date('2026-10-28T10:00:00Z');
const DAY = 86400_000;

const okFetch = () => vi.fn(async () => new Response('{"ok":true}', { status: 200 }));

describe('telegram: env и отправка', () => {
  it('getTelegramEnv: нужны обе переменные', () => {
    expect(getTelegramEnv({})).toBeNull();
    expect(getTelegramEnv({ TELEGRAM_BOT_TOKEN: 'a' })).toBeNull();
    expect(getTelegramEnv({ TELEGRAM_BOT_TOKEN: 'a', TELEGRAM_CHAT_ID: ' 5 ' })).toEqual({ token: 'a', chatId: '5' });
  });
  it('без env: ничего не делает, fetch не вызывается', async () => {
    const f = okFetch();
    expect(await sendTelegram('x', { env: null, fetchImpl: f })).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('шлёт JSON на sendMessage бота', async () => {
    const f = okFetch();
    expect(await sendTelegram('привет', { env: ENV, fetchImpl: f })).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:SECRET-TOKEN/sendMessage');
    expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: '42', text: 'привет' });
  });
  it('ошибка сети и не-2xx: false, токен не попадает в консоль', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await sendTelegram('x', { env: ENV, fetchImpl: vi.fn(async () => { throw new Error('boom https://api.telegram.org/bot123:SECRET-TOKEN/x'); }) })).toBe(false);
    expect(await sendTelegram('x', { env: ENV, fetchImpl: vi.fn(async () => new Response('', { status: 401 })) })).toBe(false);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-TOKEN');
    spy.mockRestore();
  });
  it('тексты на русском со ссылкой на docs/release.md', () => {
    for (const k of ['auth_expired', 'npsso_invalid', 'sync_stale', 'token_age'] as const) {
      const m = messageFor(k, { ageMs: 4 * DAY });
      expect(m).toContain('docs/release.md');
      expect(m).toMatch(/[а-я]/i);
    }
    expect(messageFor('sync_stale', { ageMs: 4 * DAY })).toContain('4 сут');
  });
});

describe('notifyAfterSync (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  const run = (status: 'success' | 'failed', finishedAt: Date) =>
    t.db.insert(syncRuns).values({ kind: 'daily', status, snapshotDate: '2026-10-20', startedAt: finishedAt, finishedAt });

  it('без env ничего не пишет и не шлёт', async () => {
    const f = okFetch();
    expect(await notifyAfterSync(t.db, { now: NOW, env: null, errorReason: 'auth_expired', fetchImpl: f })).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(await t.db.select().from(notifyLog)).toHaveLength(0);
  });

  it('auth_expired / npsso_invalid: шлёт; в тот же день МСК повторно нет, на следующий день да', async () => {
    const f = okFetch();
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, errorReason: 'auth_expired', fetchImpl: f })).toBe('auth_expired');
    expect(await notifyAfterSync(t.db, { now: new Date(NOW.getTime() + 3600_000), env: ENV, errorReason: 'auth_expired', fetchImpl: f })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
    // другой тип в тот же день: свой дедуп
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, errorReason: 'npsso_invalid', fetchImpl: f })).toBe('npsso_invalid');
    // следующие сутки МСК (граница по МСК, не по 24 часам: 23:10 -> 23:00 следующего дня)
    const next = new Date('2026-10-29T20:00:00Z');
    expect(await notifyAfterSync(t.db, { now: next, env: ENV, errorReason: 'auth_expired', fetchImpl: f })).toBe('auth_expired');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('неудачная доставка не «сжигает» сутки', async () => {
    const bad = vi.fn(async () => new Response('', { status: 500 }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, errorReason: 'auth_expired', fetchImpl: bad })).toBeNull();
    spy.mockRestore();
    expect(await t.db.select().from(notifyLog)).toHaveLength(0);
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, errorReason: 'auth_expired', fetchImpl: okFetch() })).toBe('auth_expired');
  });

  it('sync_stale: последний успех старше 3 суток; ровно 3 суток и свежий не срабатывают; нет запусков не срабатывает', async () => {
    const f = okFetch();
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, fetchImpl: f })).toBeNull();
    await run('success', new Date(NOW.getTime() - 3 * DAY));
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, fetchImpl: f })).toBeNull();
    await t.reset();
    await run('success', new Date(NOW.getTime() - 3 * DAY - 1000));
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, fetchImpl: f })).toBe('sync_stale');
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown[])[1] && ((f.mock.calls[0] as unknown[])[1] as RequestInit).body)).toContain('сут');
  });

  it('sync_stale без единого успеха считается от самой ранней записи', async () => {
    await run('failed', new Date(NOW.getTime() - 5 * DAY));
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, fetchImpl: okFetch() })).toBe('sync_stale');
  });

  it('token_age: токены не обновлялись 7 суток; свежие нет; приоритет у sync_stale', async () => {
    await run('success', new Date(NOW.getTime() - DAY));
    await t.db.insert(psnAuth).values({ id: 1, refreshTokenEnc: 'x', source: 'refresh', updatedAt: new Date(NOW.getTime() - 6 * DAY) });
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, fetchImpl: okFetch() })).toBeNull();
    await t.db.update(psnAuth).set({ updatedAt: new Date(NOW.getTime() - 7 * DAY) });
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, fetchImpl: okFetch() })).toBe('token_age');
  });

  it('если сообщение высшего триггера уже было сегодня, нижние не шлются (нет дублей)', async () => {
    const f = okFetch();
    await run('success', new Date(NOW.getTime() - 5 * DAY));
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, errorReason: 'auth_expired', fetchImpl: f })).toBe('auth_expired');
    expect(await notifyAfterSync(t.db, { now: NOW, env: ENV, errorReason: 'auth_expired', fetchImpl: f })).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('gameLink / gameLine', () => {
  it('абсолютная ссылка из origin; без origin или без записи в библиотеке ссылки нет', async () => {
    const { gameLink, gameLine } = await import('./telegram');
    expect(gameLink(42, 'https://ps.example.com')).toBe('https://ps.example.com/?game=42');
    expect(gameLink(42, null)).toBeNull();
    for (const bad of [null, undefined, 0, -1, 1.5, Number.NaN]) expect(gameLink(bad, 'https://x.y')).toBeNull();
    expect(gameLine('Bloodborne', 7, 'https://x.y')).toBe('Bloodborne\nhttps://x.y/?game=7');
    expect(gameLine('Bloodborne', null, 'https://x.y')).toBe('Bloodborne');
    expect(gameLine('Bloodborne', 7, null)).toBe('Bloodborne');
  });

  it('getAppOrigin: нормализует, мусор и отсутствие дают null', async () => {
    const { getAppOrigin } = await import('@/server/env');
    expect(getAppOrigin({ APP_ORIGIN: 'https://ps.example.com/' })).toBe('https://ps.example.com');
    expect(getAppOrigin({ APP_ORIGIN: 'ps.example.com' })).toBe('https://ps.example.com');
    expect(getAppOrigin({ APP_ORIGIN: 'ftp://x' })).toBeNull();
    expect(getAppOrigin({ APP_ORIGIN: '  ' })).toBeNull();
    expect(getAppOrigin({})).toBeNull();
  });
});
