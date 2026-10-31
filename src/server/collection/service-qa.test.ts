// QA правки 1: статус service. Миграция 0001 на пустой и заполненной БД, CHECK, summary.services (порядок, лимит 50), «Продолжить», bulk.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import * as fullSchema from '@/db/schema';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { setGameStatus, setGamesStatusBulk, setStatusDate } from '@/server/sync/status-rules';
import { SERVICES_LIMIT, getCollectionSummary, getGamesByIds, listGames } from './query';
import { parseListQuery } from './validation';

const { games, gameStatus } = schema;
const NOW = new Date('2026-10-27T10:00:00Z');
const MIG = fileURLToPath(new URL('../../db/migrations/', import.meta.url));

describe('миграция 0001 (service)', () => {
  it('применяется на пустую БД и на заполненную (данные 0000 сохраняются, service доступен после)', async () => {
    // заполненная: накатываем только 0000 вручную, наполняем, затем применяем 0001
    const pg = new PGlite();
    await pg.exec(readFileSync(MIG + '0000_init.sql', 'utf8').replaceAll('--> statement-breakpoint', ''));
    await pg.exec(`insert into games (title_id, name, category, last_seen_at) values ('CUSA1_00','A','ps4_game',now()),('CUSA2_00','B','ps4_game',now())`);
    await pg.exec(`insert into game_status (game_id, status) values (1,'playing'),(2,'backlog')`);
    // 'service' до миграции недоступен
    await expect(pg.exec(`insert into game_status (game_id, status) values (3,'service')`)).rejects.toThrow();
    await pg.exec(readFileSync(MIG + '0001_game_status_service.sql', 'utf8'));
    const before = await pg.query<{ status: string }>(`select status::text from game_status order by game_id`);
    expect(before.rows.map((r) => r.status)).toEqual(['playing', 'backlog']);
    await pg.exec(`update game_status set status='service' where game_id=2`);
    const after = await pg.query<{ status: string }>(`select status::text from game_status order by game_id`);
    expect(after.rows.map((r) => r.status)).toEqual(['playing', 'service']);
    const labels = await pg.query<{ e: string }>(`select unnest(enum_range(null::game_status_value))::text e`);
    expect(labels.rows.map((r) => r.e)).toEqual(['playing', 'completed', 'dropped', 'backlog', 'shelved', 'service']);
    await pg.close();
  });

  it('штатный migrator drizzle: обе миграции на пустой БД, повторный запуск идемпотентен', async () => {
    const pg = new PGlite();
    const db = drizzle(pg, { schema: fullSchema });
    await migrate(db, { migrationsFolder: MIG });
    await migrate(db, { migrationsFolder: MIG });
    await pg.exec(`insert into allowed_users (email, role, status) values ('owner@example.com', 'owner', 'active')`); // user_id = 1 (0014)
    await db.insert(fullSchema.games).values({ titleId: 'CUSA1_00', name: 'A', category: 'ps4_game', lastSeenAt: NOW });
    await db.insert(fullSchema.gameStatus).values({ gameId: 1, status: 'service' });
    await pg.close();
  });
});

describe('статус service: БД и API-логика', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function game(n: number, o: Partial<typeof games.$inferInsert> = {}) {
    const [g] = await t.db.insert(games).values({ titleId: `CUSA${n}_00`, name: `G${String(n).padStart(3, '0')}`, category: 'ps4_game', lastSeenAt: NOW, ...o }).returning();
    return g.id;
  }

  it('CHECK: у service нельзя хранить completed_at / dropped_at', async () => {
    const a = await game(1);
    await expect(t.db.insert(gameStatus).values({ gameId: a, status: 'service', completedAt: NOW })).rejects.toThrow();
    await expect(t.db.insert(gameStatus).values({ gameId: a, status: 'service', droppedAt: NOW })).rejects.toThrow();
  });

  it('смена из/в service: даты ставятся/обнуляются, повтор не трогает, статус-дата 409', async () => {
    const last = new Date('2026-09-01T12:00:00Z');
    const a = await game(1, { lastPlayedAt: last });
    await setGameStatus(t.db, TEST_USER, a, 'completed', NOW);
    expect((await getGamesByIds(t.db, TEST_USER, [a]))[0]).toMatchObject({ status: 'completed', completedAt: last.toISOString() });
    await setGameStatus(t.db, TEST_USER, a, 'service', NOW);
    expect((await getGamesByIds(t.db, TEST_USER, [a]))[0]).toMatchObject({ status: 'service', completedAt: null, droppedAt: null });
    await setGameStatus(t.db, TEST_USER, a, 'dropped', NOW);
    expect((await getGamesByIds(t.db, TEST_USER, [a]))[0]).toMatchObject({ status: 'dropped', droppedAt: last.toISOString() });
    await setGameStatus(t.db, TEST_USER, a, 'service', NOW);
    await setGameStatus(t.db, TEST_USER, a, 'service', new Date(NOW.getTime() + 1000));
    const [row] = await t.db.select().from(gameStatus);
    expect(row.statusChangedAt.toISOString()).toBe(NOW.toISOString());
    await expect(setStatusDate(t.db, TEST_USER, a, new Date('2026-09-02T00:00:00Z'), NOW)).rejects.toMatchObject({ code: 'date_not_allowed' });
    await setGameStatus(t.db, TEST_USER, a, null, NOW);
    expect((await getGamesByIds(t.db, TEST_USER, [a]))[0].status).toBeNull();
  });

  it('summary.services: 60 игр -> 50 по last_played desc nulls last, затем title, id; counts.service = 60; в playing не попадают', async () => {
    const ids: number[] = [];
    for (let i = 1; i <= 60; i++) {
      // 5 игр без last_played, 3 с одинаковым временем (ничья по названию)
      const lp = i <= 5 ? null : new Date(Date.UTC(2026, 0, 1) + (i % 3 === 0 ? 100 : i) * 86400_000);
      ids.push(await game(i, { lastPlayedAt: lp }));
    }
    await setGamesStatusBulk(t.db, TEST_USER, ids, 'service', NOW);
    const s = await getCollectionSummary(t.db, TEST_USER);
    expect(SERVICES_LIMIT).toBe(50);
    expect(s.services).toHaveLength(50);
    expect(s.counts.service).toBe(60);
    expect(s.playing).toHaveLength(0);
    const keys = s.services.map((g) => [g.lastPlayedAt, g.title] as const);
    const sorted = [...keys].sort((x, y) => {
      if (x[0] === y[0]) return x[1] < y[1] ? -1 : 1;
      if (x[0] === null) return 1;
      if (y[0] === null) return -1;
      return x[0] < y[0] ? 1 : -1;
    });
    expect(keys).toEqual(sorted);
    expect(s.services.every((g) => g.lastPlayedAt !== null)).toBe(true); // 5 без даты уехали за лимит
    // список /api/games?status=service отдаёт все 60 (UI грузит его, а не summary)
    const q = parseListQuery(new URLSearchParams('status=service&limit=300'));
    if (!q.ok) throw new Error('query');
    const all = await listGames(t.db, TEST_USER, q.value);
    expect(all.total).toBe(60);
    expect(all.items).toHaveLength(60);
    expect(all.counts.service).toBe(60);
  });

  it('continue включает service (контракт 9.3), исключает completed/dropped; игры без запуска не попадают', async () => {
    const lp = new Date('2026-10-01T00:00:00Z');
    const svc = await game(1, { lastPlayedAt: lp });
    const done = await game(2, { lastPlayedAt: lp });
    const never = await game(3, { lastPlayedAt: null });
    await setGameStatus(t.db, TEST_USER, svc, 'service', NOW);
    await setGameStatus(t.db, TEST_USER, done, 'completed', NOW);
    await setGameStatus(t.db, TEST_USER, never, 'service', NOW);
    const s = await getCollectionSummary(t.db, TEST_USER);
    expect(s.continue.map((g) => g.id)).toEqual([svc]);
    expect(s.counts).toMatchObject({ service: 2, completed: 1, all: 3 });
  });

  it('bulk: смесь статусов в service, completed->service обнуляет дату, changed не считает уже service', async () => {
    const lp = new Date('2026-09-01T00:00:00Z');
    const a = await game(1, { lastPlayedAt: lp });
    const b = await game(2, { lastPlayedAt: lp });
    const c = await game(3, { lastPlayedAt: lp });
    await setGameStatus(t.db, TEST_USER, a, 'completed', NOW);
    await setGameStatus(t.db, TEST_USER, b, 'dropped', NOW);
    await setGameStatus(t.db, TEST_USER, c, 'service', NOW);
    expect(await setGamesStatusBulk(t.db, TEST_USER, [a, b, c], 'service', NOW)).toBe(2);
    const items = await getGamesByIds(t.db, TEST_USER, [a, b, c]);
    expect(items.map((g) => [g.status, g.completedAt, g.droppedAt])).toEqual([['service', null, null], ['service', null, null], ['service', null, null]]);
    const r = await t.pg.execute(sql`select count(*)::int n from game_status where completed_at is not null or dropped_at is not null`);
    expect((r.rows[0] as { n: number }).n).toBe(0);
  });
});
