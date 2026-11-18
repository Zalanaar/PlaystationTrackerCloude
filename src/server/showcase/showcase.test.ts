// П14.3: витрина на PGlite — закрыта по умолчанию, ключ хэшем, новая ссылка отключает старую, закрытие, только безопасные поля.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { hashFeedToken } from '@/server/roadmap/calendar-feed';
import { closeShowcase, getShowcaseState, openShowcase, showcaseByToken, showcasePath } from './showcase';

const NOW = new Date('2026-11-18T09:00:00Z');

describe('публичная витрина (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.pg.execute(sql`
      insert into games (user_id, title_id, name, category, last_seen_at, play_duration_seconds, image_url) values
        (1, 'T1', ' Elden Ring ', 'ps5_native_game', now(), 36000, 'https://image.api.playstation.com/er.png'),
        (1, 'T2', 'Astro Bot', 'ps5_native_game', now(), 7200, 'http://insecure.example/a.png'),
        (1, 'T3', 'Не играл', 'ps5_native_game', now(), 0, null),
        (1, 'T4', 'Скрытая', 'ps5_native_game', now(), 99999, null)`);
    await t.pg.execute(sql`update games set hidden_at = now() where title_id = 'T4'`);
    await t.pg.execute(sql`insert into game_status (game_id, user_id, status, completed_at) values (2, 1, 'completed', '2026-10-20T22:30:00Z')`);
    await t.pg.execute(sql`insert into psn_profile (user_id, online_id, avatar_url, trophy_level) values (1, 'Artem_PS', 'https://psn-rsc.example/ava.png', 412)`);
  });

  it('закрыта по умолчанию; открытие — ключ один раз, в БД хэш; данные без лишнего', async () => {
    expect(await getShowcaseState(t.db, TEST_USER)).toEqual({ open: false, createdAt: null });
    const { token } = await openShowcase(t.db, TEST_USER, NOW);
    expect(showcasePath(token)).toBe(`/s/${token}`);
    const rows = (await t.pg.execute(sql`select token_hash from showcase_shares`)).rows;
    expect(rows).toEqual([{ token_hash: hashFeedToken(token) }]);
    const d = (await showcaseByToken(t.db, token))!;
    expect(d).toEqual({
      onlineId: 'Artem_PS', avatarUrl: 'https://psn-rsc.example/ava.png', trophyLevel: 412,
      values: { games: 3, completed: 1, hours: 12, trophies: 0, platinum: 0, achievements: 1 },
      top: [{ name: 'Elden Ring', imageUrl: 'https://image.api.playstation.com/er.png', hours: 10 }, { name: 'Astro Bot', imageUrl: null, hours: 2 }],
      done: [{ name: 'Astro Bot', imageUrl: null, month: '2026-10' }],
    });
    expect(JSON.stringify(d)).not.toMatch(/Скрытая|owner@example\.com/);
  });

  it('новая ссылка отключает старую; закрытие; кривой ключ', async () => {
    const a = await openShowcase(t.db, TEST_USER, NOW);
    const b = await openShowcase(t.db, TEST_USER, NOW);
    expect(await showcaseByToken(t.db, a.token)).toBeNull();
    expect(await showcaseByToken(t.db, b.token)).not.toBeNull();
    await closeShowcase(t.db, TEST_USER);
    expect(await showcaseByToken(t.db, b.token)).toBeNull();
    expect(await getShowcaseState(t.db, TEST_USER)).toEqual({ open: false, createdAt: null });
    expect(await showcaseByToken(t.db, 'short')).toBeNull();
  });
});
