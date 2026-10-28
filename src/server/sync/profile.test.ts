import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { connectPsn } from '@/server/psn/client';
import { runChunk, type SyncDeps } from './engine';
import { startRun } from './runs';
import { createTestDb, fakeApi, freshState, type FakeState, type TestDb } from './test-helpers';

const { games, psnProfile, syncRuns } = schema;
const NOW = new Date('2026-10-27T17:00:00Z');

describe('синк: профиль PSN и banner_url (контракт 12.1)', () => {
  let t: TestDb;
  let state: FakeState;

  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    state = freshState();
  });

  const deps = (): SyncDeps => ({
    db: t.db,
    now: () => NOW,
    budgetMs: 1_000_000,
    connect: () =>
      connectPsn({ getAccessToken: async () => 'tok', onlineId: 'Target', delayMs: 0, api: fakeApi(state), sleep: async () => undefined, now: () => NOW.getTime() }),
  });
  async function run() {
    const s = await startRun(t.db, { kind: 'manual', now: NOW });
    if (s.kind !== 'started') throw new Error('не стартовало');
    const res = await runChunk(deps(), s.run);
    const [row] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, s.run.id));
    return { res, row };
  }

  it('пишет psn_profile одной строкой, повторный синк идемпотентен', async () => {
    await run();
    const rows = await t.db.select().from(psnProfile);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 1, onlineId: 'Target', avatarUrl: 'https://img.example/av-xl.png',
      trophyLevel: 312, trophyProgress: 47, trophyTier: 7,
      earnedPlatinum: 38, earnedGold: 410, earnedSilver: 1100, earnedBronze: 2800,
    });
    await run();
    expect(await t.db.select().from(psnProfile)).toHaveLength(1);
  });

  it('PSN не дал avatarUrls и trophySummary: прежние значения остаются, синк успешен', async () => {
    await run();
    const api = { ...fakeApi(state), getProfileFromUserName: (async () => ({ profile: { accountId: '1234567890', onlineId: 'Target2' } })) as never };
    const s = await startRun(t.db, { kind: 'manual', now: new Date('2026-10-28T17:00:00Z') });
    if (s.kind !== 'started') throw new Error('не стартовало');
    const res = await runChunk(
      { ...deps(), connect: () => connectPsn({ getAccessToken: async () => 'tok', onlineId: 'Target', delayMs: 0, api, sleep: async () => undefined }) },
      s.run,
    );
    expect(res.status).toBe('success');
    const [p] = await t.db.select().from(psnProfile);
    expect(p).toMatchObject({ onlineId: 'Target2', avatarUrl: 'https://img.example/av-xl.png', trophyLevel: 312, earnedPlatinum: 38 });
  });

  it('профиль без onlineId: предупреждение, синк не падает, игры записаны', async () => {
    const api = { ...fakeApi(state), getProfileFromUserName: (async () => ({ profile: { accountId: '1234567890' } })) as never };
    const s = await startRun(t.db, { kind: 'manual', now: NOW });
    if (s.kind !== 'started') throw new Error('не стартовало');
    const res = await runChunk(
      { ...deps(), connect: () => connectPsn({ getAccessToken: async () => 'tok', onlineId: 'Target', delayMs: 0, api, sleep: async () => undefined }) },
      s.run,
    );
    expect(res.status).toBe('success');
    expect(await t.db.select().from(psnProfile)).toHaveLength(0);
    expect((await t.db.select().from(games)).length).toBeGreaterThan(0);
    const [row] = await t.db.select().from(syncRuns).where(eq(syncRuns.id, s.run.id));
    expect(JSON.stringify(row.warnings)).toContain('profile_missing');
  });

  it('banner_url пишется и не затирается пустым значением', async () => {
    await run();
    const eps = async () => (await t.db.select().from(games).where(eq(games.titleId, 'PCSA00007_00')))[0];
    expect((await eps()).bannerUrl).toBe('https://img.example/eps-concept.jpg');
    const alpha = (await t.db.select().from(games).where(eq(games.titleId, 'CUSA00001_00')))[0];
    expect(alpha.bannerUrl).toBeNull();
    // PSN перестал отдавать картинки у Epsilon
    const t5 = state.titles.find((x) => x.titleId === 'PCSA00007_00') as { concept: { media: { images: unknown[] } } };
    t5.concept.media.images = [];
    await run();
    expect((await eps()).bannerUrl).toBe('https://img.example/eps-concept.jpg');
  });
});
