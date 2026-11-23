// Напоминание об отложенной игре: выбор игры, раз в месяц, повтор игры не раньше 180 дней, без env и подписки — ничего.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { saveSubscription, type PushEnv, type PushSender } from './push';
import { agoText, getShelvedReminderPref, mskMonth, pickShelved, playedText, runShelvedReminders, setShelvedReminderPref, shelvedPushBody } from './shelved';

const KEY = 'B'.repeat(87);
const ENV: PushEnv = { publicKey: KEY, privateKey: 'k'.repeat(43), subject: 'mailto:a@example.com' };
const SUB = { endpoint: 'https://web.push.apple.com/sub-1', keys: { p256dh: KEY, auth: 'a'.repeat(22) } };
const DAY = 86_400_000;
const NOW = new Date('2026-12-01T16:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

describe('тексты', () => {
  it('давность, наиграно, тело', () => {
    expect(agoText(35)).toBe('5 нед. назад');
    expect(agoText(100)).toBe('3 мес. назад');
    expect(agoText(800)).toBe('2 г. назад');
    expect(playedText(0)).toBe('ещё не запускалась');
    expect(playedText(1200)).toBe('наиграно меньше часа');
    expect(playedText(12.4 * 3600)).toBe('наиграно 12 ч');
    expect(shelvedPushBody({ gameId: 1, title: 'Starfield', shelvedAt: ago(100), playSeconds: 43200 }, NOW))
      .toEqual({ title: 'Вернуться к «Starfield»?', body: 'Отложена 3 мес. назад, наиграно 12 ч. Может, пора?' });
    expect(mskMonth(new Date('2026-11-30T22:30:00Z'))).toBe('2026-12'); // 01:30 МСК 1 декабря
  });
});

describe('на PGlite', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => { await t.reset(); });

  let n = 0;
  async function game(name: string, status: 'shelved' | 'backlog', daysAgo: number, secs: number, hidden = false) {
    n += 1;
    const [g] = await t.db.insert(schema.games).values({
      userId: TEST_USER, titleId: `CUSA${n}_00`, name, category: 'ps4_game', lastSeenAt: NOW, playDurationSeconds: secs, hiddenAt: hidden ? NOW : null,
    }).returning();
    await t.db.insert(schema.gameStatus).values({ userId: TEST_USER, gameId: g.id, status, statusChangedAt: ago(daysAgo) });
    return g.id;
  }

  it('выбор: ≥ 30 дней, больше наиграно, затем дольше лежит; скрытые и не «Отложено» — нет', async () => {
    await game('Fresh', 'shelved', 10, 99999);
    await game('Backlog', 'backlog', 400, 99999);
    await game('Hidden', 'shelved', 400, 99999, true);
    const a = await game('A', 'shelved', 100, 3600);
    const b = await game('B', 'shelved', 300, 3600);
    expect((await pickShelved(t.db, TEST_USER, NOW))?.gameId).toBe(b);
    await game('C', 'shelved', 40, 7200);
    expect((await pickShelved(t.db, TEST_USER, NOW))?.title).toBe('C');
    void a;
  });

  it('раз в месяц; следующий месяц — другая игра; без env или подписки — ничего', async () => {
    const big = await game('Big', 'shelved', 200, 50000);
    const small = await game('Small', 'shelved', 200, 100);
    const send: PushSender = vi.fn(async () => 201);
    expect(await runShelvedReminders(t.db, NOW, null, send)).toEqual({ users: 0, sent: 0 });
    expect(await runShelvedReminders(t.db, NOW, ENV, send)).toEqual({ users: 0, sent: 0 }); // нет подписки
    await saveSubscription(t.db, TEST_USER, SUB);
    expect(await runShelvedReminders(t.db, NOW, ENV, send)).toEqual({ users: 1, sent: 1 });
    expect(await runShelvedReminders(t.db, new Date(NOW.getTime() + 5 * DAY), ENV, send)).toEqual({ users: 0, sent: 0 }); // тот же месяц
    const p1 = JSON.parse((send as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    expect(p1).toMatchObject({ title: 'Вернуться к «Big»?', url: `/?game=${big}`, tag: 'shelved-2026-12' });
    const jan = new Date('2027-01-02T16:00:00Z');
    expect(await runShelvedReminders(t.db, jan, ENV, send)).toEqual({ users: 1, sent: 1 });
    const p2 = JSON.parse((send as ReturnType<typeof vi.fn>).mock.calls[1][1] as string);
    expect(p2.url).toBe(`/?game=${small}`);
    const feb = new Date('2027-02-02T16:00:00Z');
    expect(await runShelvedReminders(t.db, feb, ENV, send)).toEqual({ users: 0, sent: 0 }); // обе уже были за 180 дней
    const log = (await t.pg.execute(sql`select kind, ref from push_log order by kind, ref`)).rows;
    expect(log).toEqual([
      { kind: 'shelved', ref: '2026-12' }, { kind: 'shelved', ref: '2027-01' },
      { kind: 'shelved_game', ref: String(big) }, { kind: 'shelved_game', ref: String(small) },
    ].sort((x, y) => (x.kind + x.ref < y.kind + y.ref ? -1 : 1)));
  });

  it('выключенное в настройках напоминание не уходит; по умолчанию включено', async () => {
    await game('Big', 'shelved', 200, 50000);
    await saveSubscription(t.db, TEST_USER, SUB);
    expect(await getShelvedReminderPref(t.db, TEST_USER)).toBe(true);
    await setShelvedReminderPref(t.db, TEST_USER, false, NOW);
    expect(await getShelvedReminderPref(t.db, TEST_USER)).toBe(false);
    const send: PushSender = vi.fn(async () => 201);
    expect(await runShelvedReminders(t.db, NOW, ENV, send)).toEqual({ users: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    await setShelvedReminderPref(t.db, TEST_USER, true, NOW);
    expect(await runShelvedReminders(t.db, NOW, ENV, send)).toEqual({ users: 1, sent: 1 });
  });
});
