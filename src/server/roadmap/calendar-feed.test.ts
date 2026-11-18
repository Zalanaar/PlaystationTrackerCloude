// Подписка на календарь: ключ 43 символа, в БД только SHA-256; лента — только названия и даты (без описаний), прошедший месяц и будущее;
// «Новая ссылка» отключает прежнюю; «Отключить»; чужой/кривой ключ — null.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { FEED_TOKEN_RE, feedByToken, feedPath, getFeedState, hashFeedToken, issueFeed, revokeFeed } from './calendar-feed';

const NOW = new Date('2026-11-18T09:00:00Z');
const U = asUserId(TEST_USER);
const U2 = asUserId(TEST_USER_2);

describe('подписка на календарь (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.pg.execute(sql`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.pg.execute(sql`delete from calendar_feeds`);
    await t.db.insert(schema.plannedGames).values([
      { userId: TEST_USER, title: 'Будущая', releaseDate: '2026-12-05', status: 'planned', wantAtRelease: true },
      { userId: TEST_USER, title: 'Неделю назад', releaseDate: '2026-11-11', status: 'planned' },
      { userId: TEST_USER, title: 'Давно', releaseDate: '2026-09-01', status: 'planned' },
      { userId: TEST_USER_2, title: 'Чужая', releaseDate: '2026-12-01', status: 'planned' },
    ]);
  });

  it('выпуск: ключ один раз, в БД только хэш; лента без описаний', async () => {
    expect(await getFeedState(t.db, U)).toEqual({ active: false, createdAt: null });
    const { token } = await issueFeed(t.db, U, NOW);
    expect(token).toMatch(FEED_TOKEN_RE);
    expect(feedPath(token)).toBe(`/api/cal/${token}.ics`);
    const rows = (await t.pg.execute(sql`select token_hash from calendar_feeds`)).rows as { token_hash: string }[];
    expect(rows).toEqual([{ token_hash: hashFeedToken(token) }]);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect((await getFeedState(t.db, U)).active).toBe(true);
    const ics = (await feedByToken(t.db, token, NOW))!;
    expect(ics).toContain('SUMMARY:Релиз: Будущая');
    expect(ics).toContain('SUMMARY:Релиз: Неделю назад');
    expect(ics).not.toContain('Давно');
    expect(ics).not.toContain('Чужая');
    expect(ics).not.toContain('DESCRIPTION');
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT6H');
  });

  it('новая ссылка отключает старую; отключить; кривой ключ', async () => {
    const a = await issueFeed(t.db, U, NOW);
    const b = await issueFeed(t.db, U, NOW);
    expect(await feedByToken(t.db, a.token, NOW)).toBeNull();
    expect(await feedByToken(t.db, b.token, NOW)).not.toBeNull();
    const c = await issueFeed(t.db, U2, NOW);
    expect(await feedByToken(t.db, c.token, NOW)).toContain('Чужая');
    await revokeFeed(t.db, U);
    expect(await feedByToken(t.db, b.token, NOW)).toBeNull();
    expect(await getFeedState(t.db, U)).toEqual({ active: false, createdAt: null });
    expect(await feedByToken(t.db, 'short', NOW)).toBeNull();
    expect(await feedByToken(t.db, `${b.token.slice(0, 42)}!`, NOW)).toBeNull();
  });
});
