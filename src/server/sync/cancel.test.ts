// Остановка и перезапуск синка (контракт 8.8): движок на PGlite и фейковом PSN.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { PsnError } from '@/server/psn/errors';
import { connectPsn } from '@/server/psn/client';
import type { PsnApi } from '@/server/psn/client';
import { runSyncWatchdog } from '@/server/notify/watchdog';
import { RunContext, RunCancelledError } from './context';
import { runChunk, type SyncDeps } from './engine';
import { cancelRun, restartRun, startRun, CANCEL_MESSAGE_SELF } from './runs';
import { getSyncStatus } from './status';
import { createTestDb, fakeApi, freshState, TEST_USER, TEST_USER_2, type FakeState, type TestDb } from './test-helpers';

const { syncRuns, games, trophies, allowedUsers } = schema;
const DAY1 = new Date('2026-10-27T17:00:00Z'); // 20:00 МСК

describe('остановка и перезапуск синка', () => {
  let t: TestDb;
  let state: FakeState;
  const clock = { t: DAY1.getTime() };

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    state = freshState();
    clock.t = DAY1.getTime();
  });

  /** hook вызывается перед каждым запросом трофеев сета (earned): место, где «пользователь нажимает стоп». */
  const deps = (o: { onEarned?: (n: number) => Promise<void>; connect?: SyncDeps['connect']; budgetMs?: number } = {}): SyncDeps => {
    const base = fakeApi(state);
    let n = 0;
    const api = {
      ...base,
      getUserTrophiesEarnedForTitle: async (...a: Parameters<PsnApi['getUserTrophiesEarnedForTitle']>) => {
        n++;
        await o.onEarned?.(n);
        return base.getUserTrophiesEarnedForTitle(...a);
      },
    } as PsnApi;
    return {
      db: t.db,
      now: () => new Date(clock.t),
      budgetMs: o.budgetMs ?? 1_000_000,
      connect:
        o.connect ??
        (() => connectPsn({ getAccessToken: async () => 'test-token', onlineId: 'Target', delayMs: 0, api, sleep: async (ms) => void (clock.t += ms), now: () => clock.t })),
    };
  };

  const start = async (userId = TEST_USER, kind: 'manual' | 'daily' = 'manual') => {
    const s = await startRun(t.db, userId, { kind, now: new Date(clock.t) });
    if (s.kind !== 'started') throw new Error('не стартовало');
    return s.run;
  };
  const row = async (id: number) => (await t.db.select().from(syncRuns).where(eq(syncRuns.id, id)))[0];
  const counts = async () => ({
    games: (await t.db.select().from(games)).length,
    trophies: (await t.db.select().from(trophies)).length,
  });
  async function addUser2() {
    await t.db.insert(allowedUsers).values({ email: 'm@example.com', role: 'member', status: 'active' });
  }

  it('отмена посреди фазы трофеев: звено останавливается, запуск failed/cancelled, курсор цел, самовызова нет', async () => {
    const run = await start();
    const res = await runChunk(
      deps({
        onEarned: async (n) => {
          if (n === 2) expect(await cancelRun(t.db, TEST_USER, new Date(clock.t))).toMatchObject({ id: run.id });
        },
      }),
      run,
    );
    expect(res).toEqual({ status: 'failed', reason: 'cancelled', continueNext: false });
    const r = await row(run.id);
    expect(r).toMatchObject({ status: 'failed', errorReason: 'cancelled', errorMessage: CANCEL_MESSAGE_SELF, phase: 'trophies' });
    expect(r.finishedAt).not.toBeNull();
    expect(r.cursor).toMatchObject({ phase: 'trophies' }); // курсор сохранён (не null)
    // игры и сеты записаны до отмены; трофеи не дозаписаны после отмены
    const c = await counts();
    expect(c.games).toBe(6);
    expect(c.trophies).toBeLessThan(9);
    // звено дальше не работало: запросов earned не больше, чем было до отмены + текущий
    expect(state.calls.earned).toBeLessThanOrEqual(2);
  });

  it('после отмены обычный синк начинает новый запуск и доводит остаток по данным (трофеи не теряются и не дублируются)', async () => {
    const run = await start();
    await runChunk(deps({ onEarned: async (n) => void (n === 2 && (await cancelRun(t.db, TEST_USER, new Date(clock.t)))) }), run);
    const next = await start(); // слот свободен сразу
    expect(next.id).not.toBe(run.id);
    expect(next.cursor).toMatchObject({ phase: 'games' });
    expect(await runChunk(deps(), next)).toMatchObject({ status: 'success' });
    expect(await counts()).toEqual({ games: 6, trophies: 9 });
  });

  it('гонка отмена + закрытие звена: close не перезаписывает отменённый запуск', async () => {
    const run = await start();
    const res = await runChunk(
      deps({
        connect: async () => {
          await cancelRun(t.db, TEST_USER, new Date(clock.t));
          throw new PsnError('psn_unavailable', 'PSN недоступен');
        },
      }),
      run,
    );
    expect(res).toMatchObject({ status: 'failed', reason: 'cancelled', continueNext: false });
    expect(await row(run.id)).toMatchObject({ status: 'failed', errorReason: 'cancelled', errorMessage: CANCEL_MESSAGE_SELF });
  });

  it('гонка отмена + самовызов: бюджет исчерпан одновременно с отменой = не partial/timeout и без самовызова', async () => {
    const run = await start();
    // budget 0: звено остановилось бы по таймауту после первой единицы работы; отмена приходит в этот же момент
    const res = await runChunk(deps({ budgetMs: 0, connect: async () => { await cancelRun(t.db, TEST_USER, new Date(clock.t)); return connectPsn({ getAccessToken: async () => 't', onlineId: 'Target', delayMs: 0, api: fakeApi(state), sleep: async () => undefined, now: () => clock.t }); } }), run);
    expect(res.continueNext).toBe(false);
    expect(res.reason).toBe('cancelled');
    expect((await row(run.id)).status).toBe('failed');
    // самовызов с hop на отменённый запуск: not_resumable
    expect(await startRun(t.db, TEST_USER, { kind: 'daily', now: new Date(clock.t), continueRunId: run.id, hop: 0 })).toEqual({ kind: 'not_resumable' });
    expect(await startRun(t.db, TEST_USER, { kind: 'daily', now: new Date(clock.t), continueRunId: run.id })).toEqual({ kind: 'not_resumable' });
  });

  it('RunContext.save после отмены бросает RunCancelledError и ничего не меняет', async () => {
    const run = await start();
    await cancelRun(t.db, TEST_USER, new Date(clock.t));
    const ctx = new RunContext(t.db, run, () => new Date(clock.t), 1000);
    ctx.counters.gamesSeen = 99;
    await expect(ctx.save(t.db, { status: 'success' })).rejects.toBeInstanceOf(RunCancelledError);
    expect(await row(run.id)).toMatchObject({ status: 'failed', errorReason: 'cancelled', gamesSeen: 0 });
  });

  it('отмена внутри транзакции батча откатывает батч (игры не пишутся)', async () => {
    const run = await start();
    const res = await runChunk(deps({ connect: async () => { await cancelRun(t.db, TEST_USER, new Date(clock.t)); return connectPsn({ getAccessToken: async () => 't', onlineId: 'Target', delayMs: 0, api: fakeApi(state), sleep: async () => undefined, now: () => clock.t }); } }), run);
    expect(res.reason).toBe('cancelled');
    expect(await counts()).toEqual({ games: 0, trophies: 0 });
  });

  it('cancelRun идемпотентен: нет запуска / повтор = null', async () => {
    expect(await cancelRun(t.db, TEST_USER, new Date(clock.t))).toBeNull();
    const run = await start();
    expect(await cancelRun(t.db, TEST_USER, new Date(clock.t))).toMatchObject({ id: run.id });
    expect(await cancelRun(t.db, TEST_USER, new Date(clock.t))).toBeNull();
  });

  it('hltb-запуск не отменяется', async () => {
    await t.db.insert(syncRuns).values({ userId: 1, kind: 'hltb', status: 'running', snapshotDate: '2026-10-27', startedAt: new Date(clock.t) });
    expect(await cancelRun(t.db, TEST_USER, new Date(clock.t))).toBeNull();
  });

  it('restart продолжает с места: фаза games пропущена, данные доезжают, в PSN игры запрошены один раз', async () => {
    const first = await start();
    let second: number | undefined;
    // «Перезапуск» нажат посреди фазы трофеев
    const res1 = await runChunk(
      deps({
        onEarned: async (n) => {
          if (n === 2) {
            const r = await restartRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t) });
            if (r.kind !== 'started') throw new Error(r.kind);
            expect(r).toMatchObject({ resumed: true, cancelledRunId: first.id });
            expect(r.run.cursor).toMatchObject({ phase: 'trophies', hops: 0 });
            second = r.run.id;
          }
        },
      }),
      first,
    );
    expect(res1.reason).toBe('cancelled');
    expect(second).toBeDefined();
    const newRun = (await t.db.select().from(syncRuns).where(eq(syncRuns.id, second!)))[0];
    expect(newRun.status).toBe('running');
    const playedBefore = state.calls.played;
    expect(playedBefore).toBeGreaterThan(0);
    expect(await runChunk(deps(), newRun)).toMatchObject({ status: 'success' });
    expect((await row(second!)).gamesSeen).toBe(0); // фаза games не повторялась
    expect(state.calls.played).toBe(playedBefore);
    expect(await counts()).toEqual({ games: 6, trophies: 9 });
  });

  it('restart: перенос курсора только в пределах дня МСК и окна 6 часов; без идущего запуска = обычный старт', async () => {
    const mk = async (startedAt: Date, snapshotDate: string) => {
      await t.reset();
      const [r] = await t.db.insert(syncRuns).values({ userId: 1, kind: 'manual', status: 'running', snapshotDate, startedAt, phase: 'trophies', cursor: { phase: 'trophies', hops: 2 } }).returning();
      return r;
    };
    const now = new Date(clock.t);
    await mk(new Date(now.getTime() - 3600_000), '2026-10-27');
    const ok = await restartRun(t.db, TEST_USER, { kind: 'manual', now });
    expect(ok).toMatchObject({ kind: 'started', resumed: true });
    if (ok.kind === 'started') expect(ok.run.cursor).toMatchObject({ phase: 'trophies', hops: 0 });

    await mk(new Date(now.getTime() - 7 * 3600_000), '2026-10-27'); // старше 6 часов
    const old = await restartRun(t.db, TEST_USER, { kind: 'manual', now });
    expect(old).toMatchObject({ kind: 'started', resumed: false });
    if (old.kind === 'started') expect(old.run.cursor).toMatchObject({ phase: 'games' });

    await mk(new Date(now.getTime() - 3600_000), '2026-10-26'); // вчерашняя дата снимка
    const yday = await restartRun(t.db, TEST_USER, { kind: 'manual', now });
    if (yday.kind === 'started') expect(yday.run.cursor).toMatchObject({ phase: 'games' });

    await t.reset();
    const plain = await restartRun(t.db, TEST_USER, { kind: 'manual', now });
    expect(plain).toMatchObject({ kind: 'started', resumed: false, cancelledRunId: null });
  });

  it('изоляция пользователей: отмена и restart одного не трогают запуск другого', async () => {
    await addUser2();
    const a = await start(TEST_USER);
    // слот один на систему: запуск второго пользователя ставим вручную после закрытия первого
    await t.db.update(syncRuns).set({ status: 'success' }).where(eq(syncRuns.id, a.id));
    const b = await start(TEST_USER_2);
    expect(await cancelRun(t.db, TEST_USER, new Date(clock.t))).toBeNull();
    expect((await row(b.id)).status).toBe('running');
    const r = await restartRun(t.db, TEST_USER, { kind: 'manual', now: new Date(clock.t) });
    expect(r).toMatchObject({ kind: 'already_running' }); // слот занят чужим запуском
    expect((await row(b.id)).status).toBe('running');
    expect(await cancelRun(t.db, TEST_USER_2, new Date(clock.t))).toMatchObject({ id: b.id });
  });

  it('статус: cancelled без красной ошибки, running=false, прежний auth_expired не скрывается', async () => {
    const run = await start();
    await cancelRun(t.db, TEST_USER, new Date(clock.t));
    const s = await getSyncStatus(t.db, TEST_USER, new Date(clock.t));
    expect(s.running).toBe(false);
    expect(s.run).toMatchObject({ status: 'failed', errorReason: 'cancelled', id: run.id });
    expect(s.psnAuth).toBe('unknown'); // отменённый запуск не «последний завершённый»

    await t.reset();
    await t.db.insert(syncRuns).values({ userId: 1, kind: 'daily', status: 'failed', errorReason: 'auth_expired', snapshotDate: '2026-10-26', startedAt: new Date(clock.t - 3600_000), finishedAt: new Date(clock.t - 3500_000) });
    await start();
    await cancelRun(t.db, TEST_USER, new Date(clock.t));
    expect((await getSyncStatus(t.db, TEST_USER, new Date(clock.t))).psnAuth).toBe('auth_expired');
  });

  it('watchdog: отмена после свежего успеха не даёт алерта; запуск не считается идущим', async () => {
    await t.db.insert(syncRuns).values({ userId: 1, kind: 'daily', status: 'success', snapshotDate: '2026-10-27', startedAt: new Date(clock.t - 2 * 3600_000), finishedAt: new Date(clock.t - 2 * 3600_000 + 60_000) });
    await start();
    await cancelRun(t.db, TEST_USER, new Date(clock.t));
    let sent = 0;
    const f = (async () => {
      sent++;
      return new Response('{"ok":true}');
    }) as unknown as typeof fetch;
    const res = await runSyncWatchdog(t.db, TEST_USER, { now: new Date(clock.t), env: { token: '1:T', chatId: '1' }, fetchImpl: f });
    expect(res.alert).toBe('not_needed');
    expect(sent).toBe(0);
  });
});
