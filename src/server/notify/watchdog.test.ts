// Алерт «синк не запускался» (контракт 20.2): давность по БД, дедуп, Telegram выключен, идущий синк, ошибки.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { getSyncOverdue } from '@/server/sync/overdue';
import { getSyncStatus } from '@/server/sync/status';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { runSyncWatchdog } from './watchdog';
import { messageFor } from './telegram';

const { syncRuns, notifyLog } = schema;
const ENV = { token: '123:SECRET-TOKEN', chatId: '42' };
const NOW = new Date('2026-10-29T06:00:00Z');
const H = 3_600_000;
const okFetch = () => vi.fn(async () => new Response('{"ok":true}', { status: 200 }));

describe('watchdog', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function run(o: { status?: 'success' | 'failed' | 'running' | 'partial'; kind?: 'daily' | 'manual' | 'hltb'; hoursAgo: number; finished?: boolean }) {
    const started = new Date(NOW.getTime() - o.hoursAgo * H);
    await t.db.insert(syncRuns).values({
      kind: o.kind ?? 'daily', status: o.status ?? 'success', snapshotDate: '2026-10-28', startedAt: started,
      finishedAt: o.status === 'running' || o.finished === false ? null : new Date(started.getTime() + 300_000),
    });
  }

  it('N-7: два параллельных запуска шлют одно сообщение', async () => {
    await run({ hoursAgo: 35 });
    const f = okFetch();
    const [a, b] = await Promise.all([
      runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: f }),
      runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: f }),
    ]);
    expect([a.alert, b.alert].sort()).toEqual(['already_sent', 'sent']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('N-7: неудачная отправка не блокирует повтор в тот же день', async () => {
    await run({ hoursAgo: 35 });
    const bad = vi.fn(async () => new Response('{"ok":false}', { status: 500 }));
    expect((await runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: bad })).alert).toBe('send_failed');
    expect(await t.db.select().from(notifyLog)).toEqual([]);
    expect((await runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: okFetch() })).alert).toBe('sent');
  });

  it('свежий успех: не просрочено, Telegram не вызывается', async () => {
    await run({ hoursAgo: 10 });
    const f = okFetch();
    const r = await runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: f });
    expect(r).toMatchObject({ isOverdue: false, alert: 'not_needed' });
    expect(r.ageHours).toBeCloseTo(9.9, 1);
    expect(f).not.toHaveBeenCalled();
  });

  it('успех старше 30 ч: сообщение в Telegram один раз в сутки МСК; повтор в тот же день не шлёт', async () => {
    await run({ hoursAgo: 35 });
    const f = okFetch();
    const r1 = await runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: f });
    expect(r1.alert).toBe('sent');
    expect(r1.isOverdue).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/sendMessage');
    const text = (JSON.parse(init.body as string) as { text: string }).text;
    expect(text).toMatch(/не выполнялся успешно уже 3[45] ч/);
    expect(text).toContain('docs/release.md');
    expect((await t.db.select().from(notifyLog))[0]).toMatchObject({ kind: 'sync_missed', sentOn: '2026-10-29' });
    expect((await runSyncWatchdog(t.db, { now: new Date(NOW.getTime() + 3 * H), env: ENV, fetchImpl: f })).alert).toBe('already_sent');
    expect(f).toHaveBeenCalledTimes(1);
    // следующие сутки МСК (после 21:00Z): снова
    expect((await runSyncWatchdog(t.db, { now: new Date('2026-10-30T06:00:00Z'), env: ENV, fetchImpl: f })).alert).toBe('sent');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('Telegram недоступен: send_failed, дедуп не записывается (завтра попробуем снова)', async () => {
    await run({ hoursAgo: 40 });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = vi.fn(async () => new Response('', { status: 500 }));
    expect((await runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: bad })).alert).toBe('send_failed');
    expect(await t.db.select().from(notifyLog)).toEqual([]);
    expect((await runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: okFetch() })).alert).toBe('sent');
    spy.mockRestore();
  });

  it('Telegram не настроен: telegram_disabled, сеть не трогается', async () => {
    await run({ hoursAgo: 40 });
    const f = okFetch();
    const r = await runSyncWatchdog(t.db, { now: NOW, env: null, fetchImpl: f });
    expect(r).toMatchObject({ isOverdue: true, alert: 'telegram_disabled' });
    expect(f).not.toHaveBeenCalled();
  });

  it('идёт свежий синк: не шлём; зависший running старше 2 ч не считается', async () => {
    await run({ hoursAgo: 40 });
    await run({ status: 'running', hoursAgo: 0.5 });
    const f = okFetch();
    expect((await runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: f })).alert).toBe('sync_running');
    expect(f).not.toHaveBeenCalled();
    await t.db.delete(syncRuns).where(eq(syncRuns.status, 'running'));
    await run({ status: 'running', hoursAgo: 3 });
    expect((await runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: f })).alert).toBe('sent');
  });

  it('HLTB-запуски не маскируют отсутствие синка; failed/partial не считаются успехом', async () => {
    await run({ hoursAgo: 60 });
    await run({ kind: 'hltb', hoursAgo: 1 });
    await run({ status: 'failed', hoursAgo: 2 });
    await run({ status: 'partial', hoursAgo: 3 });
    const r = await runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: okFetch() });
    expect(r.alert).toBe('sent');
    expect(r.ageHours).toBeCloseTo(59.9, 1);
  });

  it('успех без finished_at считается по started_at', async () => {
    await run({ hoursAgo: 31, finished: false });
    expect((await getSyncOverdue(t.db, NOW)).isOverdue).toBe(true);
  });

  it('успехов не было, но запуски были: возраст от первого запуска', async () => {
    await run({ status: 'failed', hoursAgo: 50 });
    await run({ status: 'failed', hoursAgo: 5 });
    const o = await getSyncOverdue(t.db, NOW);
    expect(o.isOverdue).toBe(true);
    expect(o.ageHours).toBeCloseTo(50, 0);
  });

  it('запусков нет вообще: тихо, не просрочено', async () => {
    const f = okFetch();
    expect(await runSyncWatchdog(t.db, { now: NOW, env: ENV, fetchImpl: f })).toEqual({ isOverdue: false, ageHours: null, alert: 'not_needed' });
    expect(f).not.toHaveBeenCalled();
  });

  it('ошибка БД даёт error, а не исключение; токен не попадает в консоль', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = Object.assign(Object.create(t.db), { select: () => { throw new Error('db down 123:SECRET-TOKEN'); } });
    const r = await runSyncWatchdog(db, { now: NOW, env: ENV, fetchImpl: okFetch() });
    expect(r.alert).toBe('error');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-TOKEN');
    spy.mockRestore();
  });

  it('GET /api/sync/status отдаёт overdue для баннера', async () => {
    await run({ hoursAgo: 53.2 });
    const st = await getSyncStatus(t.db, NOW);
    expect(st.overdue).toEqual({ isOverdue: true, ageHours: 53.1, thresholdHours: 30 }); // от finished_at
    await run({ hoursAgo: 2 });
    expect((await getSyncStatus(t.db, NOW)).overdue.isOverdue).toBe(false);
  });

  it('текст sync_missed', () => {
    expect(messageFor('sync_missed', { ageMs: 35.5 * H })).toMatch(/уже 35 ч \(порог 30 ч\)/);
  });
});
