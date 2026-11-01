// Фаза 40 (QA): порядок выкатки (код на схеме до 0024), отметка не попадает в Статистику и резервную копию статусов.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { getDiscover } from '@/server/recommend/discover';
import { createTestDb, TEST_USER, type TestDb } from '@/server/sync/test-helpers';
import { filterOwned, listOwnedMarks, upsertOwnedMark } from './marks';

describe('QA-40: схема до 0024', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());

  it('getDiscover без таблицы owned_marks не падает; отметки читаются ошибкой (роуты отвечают 503), фильтр каталога бросает (роуты ловят)', async () => {
    await t.db.execute(sql`drop table owned_marks`);
    await expect(getDiscover(t.db, TEST_USER, new Date('2026-11-01T09:00:00Z'))).resolves.toBeDefined();
    await expect(listOwnedMarks(t.db, TEST_USER)).rejects.toThrow();
    await expect(filterOwned(t.db, TEST_USER, [{ externalId: '1' }])).rejects.toThrow();
  });
});

describe('QA-40: отметка не попадает в игры/статусы', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());

  it('PUT not_in_library+completed не создаёт строк в games, game_status, status_backups', async () => {
    const before = async () => ({
      games: (await t.db.select().from(schema.games)).length,
      st: (await t.db.select().from(schema.gameStatus)).length,
      bk: (await t.db.select().from(schema.statusBackups)).length,
    });
    const a = await before();
    await upsertOwnedMark(t.db, TEST_USER, { externalSource: 'rawg', externalId: '9', title: 'X', coverUrl: null, kind: 'not_in_library', completed: true });
    expect(await before()).toEqual(a);
  });
});
