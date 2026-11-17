// П13.2: имя тега, создание (уникальность без регистра, лимит 50), переименование, удаление (связи уходят), набор тегов игры
// (только свои теги и видимые игры), счётчики по видимым играм, фильтр коллекции `tag`, изоляция пользователей.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { listGames } from '@/server/collection/query';
import { parseListQuery } from '@/server/collection/validation';
import { createTag, deleteTag, gameTagIds, listTags, normalizeTagName, renameTag, setGameTags, TAG_LIMIT, TagError } from './tags';

const { games } = schema;
const NOW = new Date('2026-11-16T21:00:00Z');
const U = asUserId(TEST_USER);
const U2 = asUserId(TEST_USER_2);

describe('normalizeTagName', () => {
  it('обрезка, схлопывание, длина', () => {
    expect(normalizeTagName('  С   другом ')).toBe('С другом');
    expect(normalizeTagName('')).toBeNull();
    expect(normalizeTagName('   ')).toBeNull();
    expect(normalizeTagName('я'.repeat(32))).toBe('я'.repeat(32));
    expect(normalizeTagName('я'.repeat(33))).toBeNull();
    expect(normalizeTagName(5)).toBeNull();
  });
});

describe('теги (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.pg.execute(sql`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`);
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(name: string, o: { hidden?: boolean; user?: number } = {}) {
    n += 1;
    const [g] = await t.db.insert(games).values({ userId: o.user ?? TEST_USER, titleId: `CUSA${n}_00`, name, category: 'ps4_game', lastSeenAt: NOW, hiddenAt: o.hidden ? NOW : null }).returning();
    return g.id;
  }
  const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof TagError ? e.code : String(e); } };

  it('создание, уникальность без учёта регистра, переименование, удаление', async () => {
    const a = await createTag(t.db, U, 'Перепройти');
    expect(a).toMatchObject({ name: 'Перепройти', count: 0 });
    expect(await code(createTag(t.db, U, 'перепройти'))).toBe('tag_exists');
    await createTag(t.db, U2, 'Перепройти'); // у другого профиля можно
    const b = await createTag(t.db, U, 'С другом');
    expect(await code(renameTag(t.db, U, b.id, 'ПЕРЕПРОЙТИ'))).toBe('tag_exists');
    await renameTag(t.db, U, b.id, 'Кооп');
    expect((await listTags(t.db, U)).items.map((x) => x.name)).toEqual(['Кооп', 'Перепройти']);
    expect(await code(renameTag(t.db, U2, b.id, 'Чужой'))).toBe('not_found');
    expect(await code(deleteTag(t.db, U2, b.id))).toBe('not_found');
    await deleteTag(t.db, U, b.id);
    expect((await listTags(t.db, U)).items.map((x) => x.name)).toEqual(['Перепройти']);
  });

  it('лимит тегов', async () => {
    for (let i = 0; i < TAG_LIMIT; i++) await createTag(t.db, U, `t${i}`);
    expect(await code(createTag(t.db, U, 'ещё'))).toBe('tag_limit');
  });

  it('набор тегов игры, счётчики, фильтр коллекции', async () => {
    const g1 = await game('Alpha');
    const g2 = await game('Beta');
    const hid = await game('Hidden', { hidden: true });
    const other = await game('Other', { user: TEST_USER_2 });
    const a = await createTag(t.db, U, 'A');
    const b = await createTag(t.db, U, 'B');
    const foreign = await createTag(t.db, U2, 'X');
    expect(await setGameTags(t.db, U, g1, [b.id, a.id, a.id])).toEqual([a.id, b.id]);
    await setGameTags(t.db, U, g2, [a.id]);
    expect(await gameTagIds(t.db, U, g1)).toEqual([a.id, b.id]);
    expect(await code(setGameTags(t.db, U, g1, [foreign.id]))).toBe('not_found');
    expect(await code(setGameTags(t.db, U, hid, [a.id]))).toBe('game_not_found');
    expect(await code(setGameTags(t.db, U, other, [a.id]))).toBe('game_not_found');
    expect((await listTags(t.db, U)).items).toEqual([{ id: a.id, name: 'A', count: 2 }, { id: b.id, name: 'B', count: 1 }]);
    const q = parseListQuery(new URLSearchParams(`tag=${b.id}`));
    if (!q.ok) throw new Error('parse');
    const r = await listGames(t.db, U, q.value, NOW);
    expect(r.items.map((g) => g.title)).toEqual(['Alpha']);
    expect(r.total).toBe(1);
    await setGameTags(t.db, U, g1, []);
    expect(await gameTagIds(t.db, U, g1)).toEqual([]);
    await deleteTag(t.db, U, a.id);
    expect(await gameTagIds(t.db, U, g2)).toEqual([]);
  });
});
