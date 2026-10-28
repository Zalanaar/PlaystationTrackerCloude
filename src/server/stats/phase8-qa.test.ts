// QA Фаза 8: независимая проверка 8.1 (L0 первого снимка), 8.2 (played), 8.3 (сброс/откат), 8.5 (скрытие), размер ответа.
import { PGlite } from '@electric-sql/pglite';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import * as fullSchema from '@/db/schema';
import type { AnyDb } from '@/db/types';
import { NotFoundError, resetAllStatuses, restoreStatuses, setGameHidden } from '@/server/collection/mutations';
import { getCollectionSummary, listGames } from '@/server/collection/query';
import { parseListQuery } from '@/server/collection/validation';
import { BulkMissingError, setGameStatus, setGamesStatusBulk } from '@/server/sync/status-rules';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { getStats } from './query';

const { games, gameStatus, playtimeSnapshots: ps, statusBackups } = schema;
const H = 3600;
const D = (s: string) => new Date(s);
const NOW = D('2026-10-28T12:00:00Z');
const lq = (s = '') => {
  const p = parseListQuery(new URLSearchParams(s));
  if (!p.ok) throw new Error(p.message);
  return p.value;
};

describe('QA Фаза 8 (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  let n = 0;
  async function game(o: Partial<typeof games.$inferInsert> = {}) {
    n++;
    const [g] = await t.db
      .insert(games)
      .values({ titleId: `QA${n}_00`, name: `QA ${n}`, category: 'ps5_native_game', lastSeenAt: NOW, psnGenres: ['ACTION'], ...o })
      .returning();
    return g.id;
  }

  describe('8.1 конец оценки = L0 первого снимка', () => {
    async function trails(l0: Date | null) {
      // первый запуск дек 2025, игра янв 2026, первый снимок 27.10.2026, затем игра в окт 2026 (синк перезаписал games.last_played_at)
      const id = await game({ firstPlayedAt: D('2025-12-10T18:00:00Z'), lastPlayedAt: D('2026-10-28T10:00:00Z'), playDurationSeconds: 22 * H });
      await t.db.insert(ps).values([
        { gameId: id, snapshotDate: '2026-10-27', playDurationSeconds: 20 * H, lastPlayedAt: l0 },
        { gameId: id, snapshotDate: '2026-10-28', playDurationSeconds: 22 * H, lastPlayedAt: D('2026-10-28T10:00:00Z') },
      ]);
      return id;
    }

    it('часы делятся на дек 2025 + янв 2026; октябрь = реальная дельта', async () => {
      const id = await trails(D('2026-01-15T18:00:00Z'));
      const y25 = await getStats(t.db, { type: 'year', year: 2025, month: null }, NOW);
      expect(y25.hours.byMonth[11]).toBe(10);
      expect(y25.header.hours).toBe(10);
      expect(y25.hours.estimatedHours).toBe(10);
      expect(y25.played.groups.map((g) => g.month)).toEqual(['2025-12']);
      expect(y25.played.groups[0].items[0]).toMatchObject({ hours: 10, estimated: true, finished: null });
      expect(y25.years).toEqual([2026, 2025]);

      const y26 = await getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
      expect(y26.hours.byMonth[0]).toBe(10);
      expect(y26.hours.byMonth.slice(1, 9)).toEqual([null, null, null, null, null, null, null, null]);
      expect(y26.hours.byMonth[9]).toBe(2);
      expect(y26.header.hours).toBe(12);
      expect(y26.played.groups.map((g) => [g.month, g.items[0].game.id, g.items[0].hours, g.items[0].estimated])).toEqual([
        ['2026-10', id, 2, false],
        ['2026-01', id, 10, true],
      ]);
    });

    it('L0 = 31.12.2025 21:30 UTC (00:30 МСК 1 янв) относится к январю 2026', async () => {
      await trails(D('2025-12-31T21:30:00Z'));
      const y25 = await getStats(t.db, { type: 'year', year: 2025, month: null }, NOW);
      expect(y25.hours.byMonth[11]).toBe(10);
      const y26 = await getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
      expect(y26.hours.byMonth[0]).toBe(10);
    });

    it('L0 в снимке NULL: fallback на games.last_played_at (диапазон дек 2025..окт 2026)', async () => {
      await trails(null);
      const y25 = await getStats(t.db, { type: 'year', year: 2025, month: null }, NOW);
      // 11 месяцев: floor(20h/11)
      expect(y25.hours.estimatedByMonth[11]).toBe(Math.round(Math.floor((20 * H) / 11) / 360) / 10);
    });
  });

  describe('8.2 played', () => {
    it('сумма часов группы ≈ hours.byMonth; фигура только у месяца события; режим месяц', async () => {
      const a = await game({ firstPlayedAt: D('2026-01-05T10:00:00Z'), name: 'A' });
      const b = await game({ firstPlayedAt: D('2026-02-05T10:00:00Z'), name: 'B' });
      const c = await game({ name: 'C' });
      await t.db.insert(ps).values([
        { gameId: a, snapshotDate: '2026-03-04', playDurationSeconds: 9 * H + 7, lastPlayedAt: D('2026-03-01T10:00:00Z') },
        { gameId: a, snapshotDate: '2026-03-31', playDurationSeconds: 11 * H + 1000 },
        { gameId: a, snapshotDate: '2026-04-02', playDurationSeconds: 12 * H + 2500 },
        { gameId: b, snapshotDate: '2026-03-04', playDurationSeconds: 3 * H + 13, lastPlayedAt: D('2026-02-20T10:00:00Z') },
        { gameId: b, snapshotDate: '2026-04-30', playDurationSeconds: 5 * H + 333 },
        // C: только снимки без прироста, брошена в апреле (21:30 UTC 31 марта = 00:30 МСК 1 апреля)
        { gameId: c, snapshotDate: '2026-03-04', playDurationSeconds: 1 * H },
        { gameId: c, snapshotDate: '2026-04-10', playDurationSeconds: 1 * H },
      ]);
      await t.db.insert(gameStatus).values([
        { gameId: a, status: 'completed', completedAt: D('2026-04-02T10:00:00Z') },
        { gameId: c, status: 'dropped', droppedAt: D('2026-03-31T21:30:00Z') },
      ]);
      const r = await getStats(t.db, { type: 'year', year: 2026, month: null }, NOW);
      for (const g of r.played.groups) {
        const sum = g.items.reduce((s, i) => s + i.hours, 0);
        expect(Math.abs(sum - (r.hours.byMonth[g.monthNumber - 1] ?? 0)), g.month).toBeLessThanOrEqual(0.1 * g.items.length);
      }
      const apr = r.played.groups.find((g) => g.month === '2026-04');
      const mar = r.played.groups.find((g) => g.month === '2026-03');
      expect(apr).toMatchObject({ completed: 1, dropped: 1 });
      expect(apr?.items.map((i) => [i.game.id, i.finished])).toEqual([
        [a, 'completed'],
        [c, 'dropped'],
        [b, null],
      ]);
      expect(apr?.items.find((i) => i.game.id === c)?.hours).toBe(0);
      expect(mar?.items.every((i) => i.finished === null)).toBe(true);
      expect(mar?.items.map((i) => i.game.id)).not.toContain(c);
      expect(r.played.groups.find((g) => g.month === '2026-02')?.items.map((i) => [i.game.id, i.estimated])).toEqual(
        expect.arrayContaining([[a, true], [b, true]]),
      );

      const m = await getStats(t.db, { type: 'month', year: 2026, month: 4 }, NOW);
      expect(m.played.groups).toHaveLength(1);
      expect(m.played.groups[0].items.map((i) => i.game.id)).toEqual(apr?.items.map((i) => i.game.id));
      const empty = await getStats(t.db, { type: 'month', year: 2026, month: 8 }, NOW);
      expect(empty.played.groups).toEqual([]);
    });
  });

  describe('8.5 скрытие: edge', () => {
    it('скрытая игра со статусом playing исчезает из «Играю», summary, Разбора и Бэклога; возврат сохраняет статус', async () => {
      const p = await game({ lastPlayedAt: D('2026-10-01T10:00:00Z'), playDurationSeconds: 5 * H });
      const none = await game({ lastPlayedAt: D('2026-10-02T10:00:00Z') });
      const bl = await game();
      await setGameStatus(t.db, p, 'playing', NOW);
      await setGameStatus(t.db, bl, 'backlog', NOW);
      for (const id of [p, none, bl]) await setGameHidden(t.db, id, true, NOW);

      const s = await getCollectionSummary(t.db);
      expect(s.playing).toEqual([]);
      expect(s.counts.playing).toBe(0);
      expect(s.totals.games).toBe(0);
      expect(s.continue).toEqual([]);
      for (const q of ['status=playing', 'status=none', 'status=backlog', '']) {
        const l = await listGames(t.db, lq(q));
        expect(l.items, q).toEqual([]);
        expect(l.total, q).toBe(0);
      }
      expect((await listGames(t.db, lq('hidden=only'))).total).toBe(3);

      // статус скрытой игры сохраняется; повторное скрытие не меняет hidden_at
      await setGameHidden(t.db, p, true, D('2027-01-01T00:00:00Z'));
      const [row] = await t.db.select().from(games).where(eq(games.id, p));
      expect(row.hiddenAt?.toISOString()).toBe(NOW.toISOString());
      await setGameHidden(t.db, p, false, NOW);
      const back = await getCollectionSummary(t.db);
      expect(back.playing.map((g) => g.id)).toEqual([p]);
    });

    it('status-bulk со скрытой игрой и status=null: 404, видимая не сброшена', async () => {
      const a = await game();
      const b = await game();
      await setGameStatus(t.db, a, 'backlog', NOW);
      await setGameStatus(t.db, b, 'backlog', NOW);
      await setGameHidden(t.db, b, true, NOW);
      await expect(setGamesStatusBulk(t.db, [a, b], null, NOW)).rejects.toBeInstanceOf(BulkMissingError);
      expect((await t.db.select().from(gameStatus)).length).toBe(2);
    });
  });

  describe('8.3 сброс всех и откат', () => {
    it('0 статусов (и только у скрытых): backupId null, статусы скрытых целы', async () => {
      expect(await resetAllStatuses(t.db, NOW)).toEqual({ backupId: null, reset: 0 });
      const h = await game();
      await setGameStatus(t.db, h, 'completed', NOW);
      await setGameHidden(t.db, h, true, NOW);
      expect(await resetAllStatuses(t.db, NOW)).toEqual({ backupId: null, reset: 0 });
      expect((await t.db.select().from(gameStatus)).map((r) => r.gameId)).toEqual([h]);
      expect(await t.db.select().from(statusBackups)).toEqual([]);
    });

    it('ручные даты восстанавливаются ровно; откат отката; ротация 10 с before_restore', async () => {
      const a = await game({ lastPlayedAt: D('2026-05-01T10:00:00Z') });
      const b = await game({ lastPlayedAt: D('2026-06-01T10:00:00Z') });
      const c = await game();
      await t.db.insert(gameStatus).values([
        { gameId: a, status: 'completed', completedAt: D('2024-02-29T23:59:59.123Z'), statusChangedAt: D('2026-01-01T00:00:00Z') },
        { gameId: b, status: 'dropped', droppedAt: D('2025-12-31T21:00:00Z'), statusChangedAt: D('2026-02-01T00:00:00Z') },
        { gameId: c, status: 'shelved', statusChangedAt: D('2026-03-01T00:00:00Z') },
      ]);
      const snap = async () =>
        (await t.db.select().from(gameStatus).orderBy(asc(gameStatus.gameId))).map((r) => ({
          g: r.gameId, s: r.status, c: r.completedAt?.toISOString() ?? null, d: r.droppedAt?.toISOString() ?? null, ch: r.statusChangedAt.toISOString(),
        }));
      const orig = await snap();
      const reset = await resetAllStatuses(t.db, NOW);
      expect(reset.reset).toBe(3);
      expect(await snap()).toEqual([]);
      // после сброса пользователь поставил новый статус, затем «Вернуть»
      await setGameStatus(t.db, c, 'playing', NOW);
      const r1 = await restoreStatuses(t.db, reset.backupId as number, NOW);
      expect(r1).toMatchObject({ restored: 3, skipped: 0 });
      expect(await snap()).toEqual(orig);
      // откат отката: возвращает состояние «c = playing»
      await restoreStatuses(t.db, r1.backupId, NOW);
      expect((await snap()).map((x) => [x.g, x.s])).toEqual([[c, 'playing']]);

      for (let i = 0; i < 12; i++) await restoreStatuses(t.db, r1.backupId + 1 + i, NOW).catch(() => undefined);
      const left = await t.db.select({ id: statusBackups.id, reason: statusBackups.reason }).from(statusBackups);
      expect(left.length).toBe(10);
      await expect(restoreStatuses(t.db, reset.backupId as number, NOW)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

describe('QA риск: размер /api/stats с played на 214 играх', () => {
  it('замер JSON', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema: fullSchema });
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)) });
    await client.exec(`
      insert into games (title_id, name, category, last_seen_at, first_played_at, last_played_at, psn_genres, image_url)
      select 'CUSA' || lpad(i::text, 5, '0') || '_00', 'Очень длинное название игры номер ' || i, 'ps5_native_game', now(),
             timestamptz '2024-01-01' + (i || ' days')::interval, timestamptz '2026-10-01' + (i % 25 || ' days')::interval,
             array['ACTION','ROLE_PLAYING_GAMES'], 'https://image.api.playstation.com/vulcan/ap/rnd/202301/0000/abcdefghijklmnopqrstuvwx' || i || '.png'
      from generate_series(1, 214) i;
      insert into playtime_snapshots (game_id, snapshot_date, play_duration_seconds, last_played_at)
      select g.id, d::date, 3600 * 5 + (extract(epoch from d - timestamp '2025-10-28') / 86400)::int * 60, g.last_played_at
      from games g, generate_series(timestamp '2025-10-28', timestamp '2026-10-27', interval '1 day') d;
      insert into game_status (game_id, status, completed_at)
      select id, 'completed', timestamptz '2026-01-15' + (id || ' days')::interval from games where id % 5 = 0;
    `);
    const adb = db as unknown as AnyDb;
    const t0 = Date.now();
    const year = await getStats(adb, { type: 'year', year: 2026, month: null }, D('2026-10-27T12:00:00Z'));
    const ms = Date.now() - t0;
    const month = await getStats(adb, { type: 'month', year: 2026, month: 10 }, D('2026-10-27T12:00:00Z'));
    const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify({ ok: true, data: x }));
    const playedItems = year.played.groups.reduce((s, g) => s + g.items.length, 0);
    console.log(`[QA size] year=${bytes(year)} B gzip=${(await import("node:zlib")).gzipSync(JSON.stringify(year)).length} B (played items=${playedItems}, played=${bytes(year.played)} B, finished=${bytes(year.finished)} B, ${ms} ms); month=${bytes(month)} B`);
    expect(playedItems).toBeGreaterThan(214 * 9);
    await client.close();
  });
});
