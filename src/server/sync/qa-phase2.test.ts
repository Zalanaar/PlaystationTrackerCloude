// QA Фазы 2: дополнительные проверки поверх тестов backend. Известные баги помечались it.fails (BUG-1 исправлен).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { getAccessToken } from '@/server/psn/auth';
import { encryptToken } from '@/server/psn/crypto';
import { PsnError } from '@/server/psn/errors';
import { connectPsn } from '@/server/psn/client';
import { runChunk, type SyncDeps } from './engine';
import { startRun } from './runs';
import { createTestDb, fakeApi, freshState, type FakeState, type TestDb } from './test-helpers';

const { games, gameStatus, syncRuns, psnAuth, playtimeSnapshots, trophies } = schema;
const KEY = Buffer.alloc(32, 3).toString('base64');
const NPSSO = 'NPSSO-secret-value-ABCDEFGH';
const START = new Date('2026-10-27T17:00:00Z').getTime();
let clock = START;

describe('QA фаза 2', () => {
  let t: TestDb;
  let state: FakeState;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    state = freshState();
    clock = START;
  });
  afterEach(() => vi.unstubAllGlobals());

  const deps = (over: Partial<SyncDeps> = {}): SyncDeps => ({
    db: t.db,
    now: () => new Date(clock),
    budgetMs: 1_000_000,
    secrets: [NPSSO],
    connect: () =>
      connectPsn({
        getAccessToken: async () => 'tok',
        onlineId: 'Target',
        delayMs: 0,
        api: fakeApi(state),
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        secrets: [NPSSO],
      }),
    ...over,
  });
  async function run(over: Partial<SyncDeps> = {}, continueRunId?: number) {
    const s = await startRun(t.db, { kind: 'manual', now: new Date(clock), continueRunId });
    if (s.kind !== 'started') throw new Error(s.kind);
    return { s, res: await runChunk(deps(over), s.run) };
  }
  async function chain(over: Partial<SyncDeps> = {}) {
    const first = await run(over);
    let res = first.res;
    const id = first.s.run.id;
    for (let i = 0; res.continueNext && i < 60; i++) ({ res } = await run(over, id));
    return { id, res };
  }
  const snapshot = async () => ({
    g: (await t.db.select().from(games).orderBy(asc(games.titleId))).map((r) => ({ ...r, updatedAt: 0, lastSeenAt: 0, trophyCheckedAt: 0 })),
    s: (await t.db.select().from(playtimeSnapshots).orderBy(asc(playtimeSnapshots.gameId))).map((r) => ({ ...r, capturedAt: 0, syncRunId: 0, id: 0 })),
    t: (await t.db.select().from(trophies).orderBy(asc(trophies.trophySetId), asc(trophies.trophyId))).map((r) => ({ ...r, updatedAt: 0 })),
  });

  it('идемпотентность: цепочка из мелких звеньев, затем второй синк = те же данные', async () => {
    await chain({ budgetMs: 0 });
    const a = await snapshot();
    expect(a.g.length).toBeGreaterThan(0);
    await chain();
    expect(await snapshot()).toEqual(a);
  });

  it('синк (включая сбои и повторы) не пишет в game_status', async () => {
    await chain();
    expect(await t.db.select().from(gameStatus)).toHaveLength(0);
    state.failOn.set('earned', { error: new Error('Too Many Requests'), times: 99 });
    await chain();
    expect(await t.db.select().from(gameStatus)).toHaveLength(0);
  });

  it('сбой PSN после успешного синка: старые игры, часы и трофеи не тронуты', async () => {
    await chain();
    const before = await snapshot();
    clock += 86400_000;
    state.failOn.set('profile', { error: new Error('Service Unavailable'), times: 99 });
    const { res } = await chain();
    expect(res.status).toBe('failed');
    expect(await snapshot()).toEqual(before);
  });

  it('PSN отдал пустой список игр: игры не удаляются', async () => {
    await chain();
    const n = (await t.db.select().from(games)).length;
    clock += 86400_000;
    state.titles = [];
    await chain();
    expect((await t.db.select().from(games)).length).toBe(n);
  });

  it('секреты из текста ошибки PSN не попадают в sync_runs (error_message, cursor, warnings)', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlMTIz';
    const long = 'r'.repeat(40);
    const connect = async () => {
      throw new PsnError('psn_unavailable', `boom npsso=${NPSSO} Bearer ${jwt} refresh=${long}`);
    };
    const { s } = await run({ connect });
    const [row] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, s.run.id));
    const blob = JSON.stringify(row);
    expect(blob).not.toContain(NPSSO);
    expect(blob).not.toContain('eyJ');
    expect(blob).not.toContain(long);
  });

  it('секрет в ошибке, брошенной не-PsnError (наша ошибка), тоже вырезается', async () => {
    const { s } = await run({
      connect: async () => {
        throw new Error(`db failed with ${NPSSO}`);
      },
    });
    const [row] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, s.run.id));
    expect(row.errorMessage).not.toContain(NPSSO);
  });

  it('гонка: три одновременных старта дают ровно один running', async () => {
    const r = await Promise.all([1, 2, 3].map(() => startRun(t.db, { kind: 'manual', now: new Date(clock) })));
    expect(r.filter((x) => x.kind === 'started')).toHaveLength(1);
    expect(r.filter((x) => x.kind === 'already_running')).toHaveLength(2);
    expect(await t.db.select().from(syncRuns)).toHaveLength(1);
  });

  it('снимок: запуск в 00:30 МСК (21:30 UTC предыдущего дня) пишется датой МСК', async () => {
    clock = new Date('2026-10-27T21:30:00Z').getTime();
    await chain();
    const snaps = await t.db.select().from(playtimeSnapshots);
    expect(snaps.length).toBeGreaterThan(0);
    expect(new Set(snaps.map((x) => x.snapshotDate))).toEqual(new Set(['2026-10-28']));
  });

  describe('реальный psn-api (fetch подменён): сбой обмена токенов', () => {
    const seedRefresh = async () => {
      await t.db.insert(psnAuth).values({
        id: 1,
        refreshTokenEnc: encryptToken('old-refresh', KEY),
        refreshExpiresAt: new Date(clock + 5 * 86400_000),
        accessTokenEnc: null,
        accessExpiresAt: null,
        source: 'npsso',
      });
    };
    const stubFetch = (token: Response, authorize: Response) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => (String(url).includes('/token') ? token.clone() : authorize.clone())),
      );

    // Ожидается rate_limited или psn_unavailable (с повторами), а не ложный auth_expired.
    it('429 при обмене токенов не превращается в auth_expired (BUG-1)', async () => {
      await seedRefresh();
      stubFetch(new Response(JSON.stringify({ error: 'rate_limit' }), { status: 429 }), new Response(null, { status: 429 }));
      const err = await getAccessToken(t.db, { npsso: NPSSO, encryptionKey: KEY }, { now: () => new Date(clock) }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PsnError);
      expect(['rate_limited', 'psn_unavailable']).toContain((err as PsnError).reason);
    });

    it('контроль: настоящий отказ (invalid_grant + NPSSO без code) = auth_expired', async () => {
      await seedRefresh();
      stubFetch(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }), new Response(null, { status: 302 }));
      await expect(getAccessToken(t.db, { npsso: NPSSO, encryptionKey: KEY }, { now: () => new Date(clock) })).rejects.toMatchObject({
        reason: 'auth_expired',
      });
    });
  });
});
