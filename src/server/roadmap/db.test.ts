// Фаза 12 на PGlite: очередь бэклога, порядок, planned_games, GET /api/roadmap целиком, прогресс по снимкам.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { setGameStatus, setGamesStatusBulk } from '@/server/sync/status-rules';
import {
  createPlanned, deletePlanned, DuplicatePlannedError, excludeGame, getBacklogEntries, getRoadmap, getSettings, listPlanned, markPlanned, NotBacklogError, NotFoundError,
  OrderRejectedError, putSettings, restoreGame, saveOrder, UnknownGamesError, updatePlanned, WantNeedsDateError,
} from './db';
import type { PlannedCreate } from './validation';

const { games, gameStatus, playtimeSnapshots } = schema;
const NOW = new Date('2026-10-29T09:00:00Z'); // 12:00 МСК

const planned = (o: Partial<PlannedCreate> = {}): PlannedCreate => ({
  title: 'Новинка', releaseDate: null, coverUrl: null, wantAtRelease: false, hoursManual: null, externalSource: null, externalId: null, ...o,
});

describe('roadmap на БД', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  /** Игры A..E; backlog у A,B,C(скрыта),D; E playing. Возвращает id по ключу. */
  async function seed() {
    const base = { userId: 1, category: 'ps5_native_game', lastSeenAt: NOW };
    const ins = await t.db
      .insert(games)
      .values([
        { ...base, titleId: 'A', name: 'Alpha', hltbMainHours: 10 },
        { ...base, titleId: 'B', name: 'Bravo', hltbMainHours: 20, durationOverrideHours: 5 },
        { ...base, titleId: 'C', name: 'Charlie', hltbMainHours: 7, hiddenAt: NOW },
        { ...base, titleId: 'D', name: 'Delta' },
        { ...base, titleId: 'E', name: 'Echo', hltbMainHours: 9 },
      ])
      .returning({ id: games.id, titleId: games.titleId });
    const id = (k: string) => ins.find((x) => x.titleId === k)!.id;
    const at = (m: number) => new Date(NOW.getTime() + m * 60_000);
    await t.db.insert(gameStatus).values([
      { userId: 1, gameId: id('D'), status: 'backlog', statusChangedAt: at(0) },
      { userId: 1, gameId: id('A'), status: 'backlog', statusChangedAt: at(1) },
      { userId: 1, gameId: id('B'), status: 'backlog', statusChangedAt: at(2) },
      { userId: 1, gameId: id('C'), status: 'backlog', statusChangedAt: at(3) },
      { userId: 1, gameId: id('E'), status: 'playing' },
    ]);
    return id;
  }

  it('очередь: только видимый backlog, без позиции по дате попадания, override приоритетнее HLTB', async () => {
    await seed();
    const q = await getBacklogEntries(t.db, TEST_USER);
    expect(q.map((e) => e.title)).toEqual(['Delta', 'Alpha', 'Bravo']);
    expect(q.map((e) => [e.hours, e.hoursSource])).toEqual([[null, null], [10, 'hltb'], [5, 'manual']]);
  });

  it('ручной порядок; новая игра бэклога встаёт в конец; игра, ушедшая из бэклога, не мешает', async () => {
    const id = await seed();
    expect(await saveOrder(t.db, TEST_USER, [id('B'), id('E'), id('A')])).toEqual([id('B'), id('E'), id('A')]);
    expect((await getBacklogEntries(t.db, TEST_USER)).map((e) => e.title)).toEqual(['Bravo', 'Alpha', 'Delta']);
    // новая игра в бэклоге
    const [f] = await t.db.insert(games).values({ userId: 1, category: 'ps4_game', lastSeenAt: NOW, titleId: 'F', name: 'Foxtrot' }).returning({ id: games.id });
    await t.db.insert(gameStatus).values({ userId: 1, gameId: f.id, status: 'backlog', statusChangedAt: new Date(NOW.getTime() + 999_000) });
    expect((await getBacklogEntries(t.db, TEST_USER)).map((e) => e.title)).toEqual(['Bravo', 'Alpha', 'Delta', 'Foxtrot']);
    // замена целиком, пустой список сбрасывает
    await saveOrder(t.db, TEST_USER, [id('D')]);
    expect((await getBacklogEntries(t.db, TEST_USER))[0].title).toBe('Delta');
    await saveOrder(t.db, TEST_USER, []);
    expect((await getBacklogEntries(t.db, TEST_USER)).map((e) => e.title)).toEqual(['Delta', 'Alpha', 'Bravo', 'Foxtrot']);
  });

  it('строки порядка игр, ушедших из бэклога, не удаляются ни сменой статуса, ни PUT order', async () => {
    const id = await seed();
    await saveOrder(t.db, TEST_USER, [id('A'), id('B')]);
    await t.db.update(gameStatus).set({ status: 'playing' }).where(eq(gameStatus.gameId, id('A')));
    await saveOrder(t.db, TEST_USER, [id('B')]);
    const rows = await t.db.select({ g: schema.roadmapOrder.gameId }).from(schema.roadmapOrder);
    expect(rows.map((r) => r.g).sort()).toEqual([id('A'), id('B')].sort());
  });

  it('N-2: игра, вернувшаяся в бэклог (одиночно и массово), встаёт в конец очереди', async () => {
    const id = await seed();
    await saveOrder(t.db, TEST_USER, [id('B'), id('A'), id('D')]);
    await setGameStatus(t.db, TEST_USER, id('B'), 'playing', NOW);
    await setGameStatus(t.db, TEST_USER, id('B'), 'backlog', new Date(NOW.getTime() + 60_000));
    expect((await getBacklogEntries(t.db, TEST_USER)).map((e) => e.title)).toEqual(['Alpha', 'Delta', 'Bravo']);
    await setGamesStatusBulk(t.db, TEST_USER, [id('A')], 'dropped', NOW);
    await setGamesStatusBulk(t.db, TEST_USER, [id('A')], 'backlog', new Date(NOW.getTime() + 120_000));
    const order = await t.db.select({ g: schema.roadmapOrder.gameId }).from(schema.roadmapOrder);
    expect(order.map((r) => r.g)).toEqual([id('D')]);
    expect((await getBacklogEntries(t.db, TEST_USER)).map((e) => e.title)).toEqual(['Delta', 'Bravo', 'Alpha']);
  });

  it('порядок: неизвестные id = UnknownGamesError, ничего не меняется', async () => {
    const id = await seed();
    await saveOrder(t.db, TEST_USER, [id('B')]);
    await expect(saveOrder(t.db, TEST_USER, [id('A'), 9999])).rejects.toBeInstanceOf(UnknownGamesError);
    expect((await getBacklogEntries(t.db, TEST_USER))[0].title).toBe('Bravo');
  });

  it('настройки: нет строки = configured false, upsert', async () => {
    expect(await getSettings(t.db, TEST_USER, NOW)).toEqual({ year: 2026, hoursPerWeek: null, configured: false });
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 7.5 });
    await putSettings(t.db, TEST_USER, { year: 2027, hoursPerWeek: 10 });
    expect(await getSettings(t.db, TEST_USER, NOW)).toEqual({ year: 2027, hoursPerWeek: 10, configured: true });
  });

  it('planned_games: CRUD, дубль каталога, want без даты', async () => {
    const a = await createPlanned(t.db, TEST_USER, planned({ title: 'Б', releaseDate: '2026-12-01', externalSource: 'rawg', externalId: '1' }));
    const b = await createPlanned(t.db, TEST_USER, planned({ title: 'А', releaseDate: '2026-03-01', wantAtRelease: true, hoursManual: 12 }));
    const c = await createPlanned(t.db, TEST_USER, planned({ title: 'Без даты' }));
    await expect(createPlanned(t.db, TEST_USER, planned({ externalSource: 'rawg', externalId: '1' }))).rejects.toMatchObject({ existingId: a.id });
    await expect(createPlanned(t.db, TEST_USER, planned({ externalSource: 'rawg', externalId: '1' }))).rejects.toBeInstanceOf(DuplicatePlannedError);
    expect((await listPlanned(t.db, TEST_USER, 'all')).map((x) => x.title)).toEqual(['А', 'Б', 'Без даты']);
    await expect(updatePlanned(t.db, TEST_USER, c.id, { wantAtRelease: true })).rejects.toBeInstanceOf(WantNeedsDateError);
    await expect(updatePlanned(t.db, TEST_USER, b.id, { releaseDate: null })).rejects.toBeInstanceOf(WantNeedsDateError);
    const upd = await updatePlanned(t.db, TEST_USER, c.id, { wantAtRelease: true, releaseDate: '2026-06-01', hoursManual: 8 });
    expect(upd).toMatchObject({ wantAtRelease: true, releaseDate: '2026-06-01', hoursManual: 8 });
    await updatePlanned(t.db, TEST_USER, a.id, { status: 'cancelled' });
    expect((await listPlanned(t.db, TEST_USER, 'planned')).map((x) => x.id)).toEqual([b.id, c.id]);
    await expect(updatePlanned(t.db, TEST_USER, 9999, { title: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await deletePlanned(t.db, TEST_USER, a.id);
    await expect(deletePlanned(t.db, TEST_USER, a.id)).rejects.toBeInstanceOf(NotFoundError);
    // после удаления тот же внешний id можно добавить снова
    await createPlanned(t.db, TEST_USER, planned({ externalSource: 'rawg', externalId: '1' }));
  });

  it('GET /api/roadmap: не настроено -> no_budget, needHours считается, прогресса нет', async () => {
    await seed();
    const r = await getRoadmap(t.db, TEST_USER, NOW);
    expect(r).toMatchObject({ status: 'no_budget', settings: { configured: false, year: 2026 }, today: '2026-10-29', progress: null, items: [] });
    expect(r.needHours.map((e) => e.title)).toEqual(['Delta']);
  });

  it('GET /api/roadmap: план из БД, релиз по дате, прогресс по снимкам', async () => {
    const id = await seed();
    await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
    await saveOrder(t.db, TEST_USER, [id('B'), id('A'), id('E')]); // E (playing) остаётся в плане для прогресса
    await createPlanned(t.db, TEST_USER, planned({ title: 'Релиз', releaseDate: '2026-01-05', wantAtRelease: true, hoursManual: 7 }));
    const cancelled = await createPlanned(t.db, TEST_USER, planned({ title: 'Отменён', releaseDate: '2026-02-05', wantAtRelease: true, hoursManual: 7 }));
    await updatePlanned(t.db, TEST_USER, cancelled.id, { status: 'cancelled' });
    // снимки: игра E, до года 100 ч, к 28 октября 100 + 250 ч
    await t.db.insert(playtimeSnapshots).values([
      { userId: 1, gameId: id('E'), snapshotDate: '2025-12-31', playDurationSeconds: 100 * 3600 },
      { userId: 1, gameId: id('E'), snapshotDate: '2026-10-28', playDurationSeconds: 350 * 3600 },
    ]);
    const r = await getRoadmap(t.db, TEST_USER, NOW);
    expect(r.status).toBe('ok');
    expect(r.items.map((i) => [i.title, i.start, i.end])).toEqual([
      ['Bravo', '2026-01-01', '2026-01-04'], // 5 ч = 4 дня
      ['Релиз', '2026-01-05', '2026-01-11'],
      ['Alpha', '2026-01-12', '2026-01-18'], // 10 ч = 7 дней после релиза
    ]);
    expect(r.queue).toEqual([{ key: `g:${id('B')}`, state: 'scheduled' }, { key: `g:${id('A')}`, state: 'scheduled' }, { key: `g:${id('D')}`, state: 'need_hours' }]);
    expect(r.notFit).toEqual([]);
    expect(r.progress).toMatchObject({ from: '2026-01-01', asOf: '2026-10-28', actualHours: 250 });
    expect(r.progress?.plannedHours).toBe(24); // игры очереди: Bravo 5 + Alpha 10 + Echo 9 (ушла из бэклога, N-3), релиз не считается
    expect(r.progress?.status).toBe('ahead');
  });

  describe('правки после выкатки: не распределено, сервисы, предстоящие', () => {
    const setStatus = (gameId: number, status: 'service' | 'completed' | 'backlog') =>
      t.db.update(gameStatus).set({ status }).where(eq(gameStatus.gameId, gameId));

    it('исключение: игра уходит из очереди и плана в unallocated, статус backlog остаётся, порядок чистится; идемпотентно', async () => {
      const id = await seed();
      await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
      await saveOrder(t.db, TEST_USER, [id('B'), id('A'), id('D')]);
      await excludeGame(t.db, TEST_USER, id('A'));
      await excludeGame(t.db, TEST_USER, id('A'));
      const r = await getRoadmap(t.db, TEST_USER, NOW);
      expect(r.queue.map((q) => q.key)).toEqual([`g:${id('B')}`, `g:${id('D')}`]);
      expect(r.items.map((i) => i.title)).toEqual(['Bravo']);
      expect(r.notFit).toEqual([]);
      expect(r.needHours.map((e) => e.title)).toEqual(['Delta']);
      expect(r.unallocated).toEqual([
        { key: `g:${id('A')}`, kind: 'backlog', gameId: id('A'), plannedId: null, title: 'Alpha', coverUrl: null, hours: 10, hoursSource: 'hltb', releaseDate: null, wantAtRelease: false, totalHours: 10, playedHours: 0 },
      ]);
      const [st] = await t.db.select().from(gameStatus).where(eq(gameStatus.gameId, id('A')));
      expect(st.status).toBe('backlog');
      const rows = await t.db.select({ g: schema.roadmapOrder.gameId }).from(schema.roadmapOrder);
      expect(rows.map((x) => x.g)).not.toContain(id('A'));
    });

    it('исключение: нет игры = NotFound, не бэклог = NotBacklog; unallocated не показывает скрытые и ушедшие из бэклога', async () => {
      const id = await seed();
      await expect(excludeGame(t.db, TEST_USER, 9999)).rejects.toBeInstanceOf(NotFoundError);
      await expect(excludeGame(t.db, TEST_USER, id('E'))).rejects.toBeInstanceOf(NotBacklogError);
      await excludeGame(t.db, TEST_USER, id('B'));
      await setStatus(id('B'), 'completed');
      expect((await getRoadmap(t.db, TEST_USER, NOW)).unallocated).toEqual([]);
    });

    it('возврат: игра встаёт в конец очереди (после игр без позиции тоже), ручной порядок сохраняется', async () => {
      const id = await seed();
      await saveOrder(t.db, TEST_USER, [id('B'), id('A'), id('D')]);
      await excludeGame(t.db, TEST_USER, id('B'));
      // новая игра бэклога без позиции
      const [f] = await t.db.insert(games).values({ userId: 1, category: 'ps4_game', lastSeenAt: NOW, titleId: 'F', name: 'Foxtrot' }).returning({ id: games.id });
      await t.db.insert(gameStatus).values({ userId: 1, gameId: f.id, status: 'backlog', statusChangedAt: new Date(NOW.getTime() + 999_000) });
      await restoreGame(t.db, TEST_USER, id('B'));
      await restoreGame(t.db, TEST_USER, id('B')); // идемпотентно
      expect((await getBacklogEntries(t.db, TEST_USER)).map((e) => e.title)).toEqual(['Alpha', 'Delta', 'Foxtrot', 'Bravo']);
      expect((await getRoadmap(t.db, TEST_USER, NOW)).unallocated).toEqual([]);
      await expect(restoreGame(t.db, TEST_USER, 9999)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('релизы: cancelled = unallocated, возврат planned; done не показывается', async () => {
      await seed();
      const a = await createPlanned(t.db, TEST_USER, planned({ title: 'Релиз', releaseDate: '2026-12-01', wantAtRelease: true, hoursManual: 10 }));
      const b = await createPlanned(t.db, TEST_USER, planned({ title: 'Позже' }));
      const c = await createPlanned(t.db, TEST_USER, planned({ title: 'Готово' }));
      await updatePlanned(t.db, TEST_USER, a.id, { status: 'cancelled' });
      await updatePlanned(t.db, TEST_USER, c.id, { status: 'done' });
      let r = await getRoadmap(t.db, TEST_USER, NOW);
      expect(r.unallocated.map((e) => [e.key, e.kind, e.hours])).toEqual([[`p:${a.id}`, 'release', 10]]);
      expect(r.needHours.map((e) => e.key)).toEqual(expect.not.arrayContaining([`p:${a.id}`]));
      await updatePlanned(t.db, TEST_USER, a.id, { status: 'planned' });
      r = await getRoadmap(t.db, TEST_USER, NOW);
      expect(r.unallocated).toEqual([]);
      expect(r.needHours.map((e) => e.key)).toContain(`p:${b.id}`);
    });

    it('PUT order: service и исключённые отклоняются, ничего не меняется', async () => {
      const id = await seed();
      await saveOrder(t.db, TEST_USER, [id('B')]);
      await setStatus(id('A'), 'service');
      await excludeGame(t.db, TEST_USER, id('D'));
      await expect(saveOrder(t.db, TEST_USER, [id('A'), id('B')])).rejects.toMatchObject({ reason: 'service_game', ids: [id('A')] });
      await expect(saveOrder(t.db, TEST_USER, [id('D')])).rejects.toMatchObject({ reason: 'excluded', ids: [id('D')] });
      await expect(saveOrder(t.db, TEST_USER, [id('D')])).rejects.toBeInstanceOf(OrderRejectedError);
      expect((await getBacklogEntries(t.db, TEST_USER))[0].title).toBe('Bravo');
    });

    it('PUT order: полный порядок включая не влезшие сохраняется как есть', async () => {
      const id = await seed();
      await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 0.1 }); // почти нет ёмкости: игры не влезают
      await saveOrder(t.db, TEST_USER, [id('D'), id('B'), id('A')]);
      const r = await getRoadmap(t.db, TEST_USER, NOW);
      expect(r.queue.map((q) => q.key)).toEqual([`g:${id('D')}`, `g:${id('B')}`, `g:${id('A')}`]);
      expect(r.queue.some((q) => q.state === 'not_fit')).toBe(true);
    });

    it('прогресс: service и исключённые выпадают из игр плана (план и факт), completed остаётся', async () => {
      const id = await seed();
      await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
      await saveOrder(t.db, TEST_USER, [id('B'), id('A')]);
      // E (playing) и F (service) и G (completed) в roadmap_order «из прошлого»
      const [f, g] = await t.db
        .insert(games)
        .values([{ userId: 1, category: 'ps4_game', lastSeenAt: NOW, titleId: 'F', name: 'Foxtrot' }, { userId: 1, category: 'ps4_game', lastSeenAt: NOW, titleId: 'G', name: 'Golf' }])
        .returning({ id: games.id });
      await t.db.insert(gameStatus).values([{ userId: 1, gameId: f.id, status: 'service' }, { userId: 1, gameId: g.id, status: 'completed' }]);
      await t.db.insert(schema.roadmapOrder).values([{ userId: 1, gameId: f.id, position: 8 }, { userId: 1, gameId: g.id, position: 9 }]);
      await t.db.insert(playtimeSnapshots).values([
        { userId: 1, gameId: f.id, snapshotDate: '2025-12-31', playDurationSeconds: 0 },
        { userId: 1, gameId: f.id, snapshotDate: '2026-10-28', playDurationSeconds: 100 * 3600 },
        { userId: 1, gameId: g.id, snapshotDate: '2025-12-31', playDurationSeconds: 0 },
        { userId: 1, gameId: g.id, snapshotDate: '2026-10-28', playDurationSeconds: 20 * 3600 },
        { userId: 1, gameId: id('A'), snapshotDate: '2025-12-31', playDurationSeconds: 0 },
        { userId: 1, gameId: id('A'), snapshotDate: '2026-10-28', playDurationSeconds: 3 * 3600 },
      ]);
      let r = await getRoadmap(t.db, TEST_USER, NOW);
      expect(r.progress?.actualHours).toBe(23); // Foxtrot (service) не считается; Golf (completed) и Alpha считаются
      // исключённая игра: факт и план пропадают
      await excludeGame(t.db, TEST_USER, id('A'));
      r = await getRoadmap(t.db, TEST_USER, NOW);
      expect(r.progress?.actualHours).toBe(20);
    });

    it('N-3: игра, ушедшая из бэклога, сохраняет плановые часы в прогрессе', async () => {
      const id = await seed();
      await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
      await saveOrder(t.db, TEST_USER, [id('A'), id('B')]); // A 10 ч, B 5 ч
      await t.db.insert(playtimeSnapshots).values([
        { userId: 1, gameId: id('A'), snapshotDate: '2025-12-31', playDurationSeconds: 0 },
        { userId: 1, gameId: id('A'), snapshotDate: '2026-10-28', playDurationSeconds: 10 * 3600 },
      ]);
      const before = (await getRoadmap(t.db, TEST_USER, NOW)).progress!;
      await setGameStatus(t.db, TEST_USER, id('A'), 'completed', NOW);
      const after = (await getRoadmap(t.db, TEST_USER, NOW)).progress!;
      expect(before.plannedHours).toBe(15);
      expect(after.plannedHours).toBe(15); // раньше падало до 5 и завышало «опережаю»
      expect(after.actualHours).toBe(10);
      expect(after.diffHours).toBe(before.diffHours);
    });

    it('serviceGames: видимые service, last_played_at desc, лимит 50, часы с шагом 0.1; есть и при no_budget', async () => {
      await seed();
      const base = { userId: 1, category: 'ps5_native_game', lastSeenAt: NOW };
      const rows = Array.from({ length: 52 }, (_, i) => ({
        ...base, titleId: `S${i}`, name: `Svc${i}`, playDurationSeconds: 3600 * 10 + 180 * i, lastPlayedAt: i === 0 ? null : new Date(NOW.getTime() - i * 3_600_000),
        hiddenAt: i === 1 ? NOW : null,
      }));
      const ins = await t.db.insert(games).values(rows).returning({ id: games.id });
      await t.db.insert(gameStatus).values(ins.map((x) => ({ userId: 1, gameId: x.id, status: 'service' as const })));
      const r = await getRoadmap(t.db, TEST_USER, NOW);
      expect(r.status).toBe('no_budget');
      expect(r.serviceGames).toHaveLength(50);
      expect(r.serviceGames[0]).toEqual({ gameId: ins[2].id, title: 'Svc2', coverUrl: null, playedHours: 10.1 }); // Svc1 скрыта, Svc0 без запуска в конце
      expect(r.serviceGames.map((x) => x.title)).not.toContain('Svc1');
      expect(r.serviceGames.map((x) => x.title)).not.toContain('Svc0'); // 51 видимая, последняя (без запуска) за лимитом
    });

    it('markPlanned: пометки по external_id в любом статусе', async () => {
      const a = await createPlanned(t.db, TEST_USER, planned({ title: 'A', externalSource: 'rawg', externalId: '1' }));
      const b = await createPlanned(t.db, TEST_USER, planned({ title: 'B', externalSource: 'rawg', externalId: '2' }));
      const c = await createPlanned(t.db, TEST_USER, planned({ title: 'C', externalSource: 'rawg', externalId: '3' }));
      await updatePlanned(t.db, TEST_USER, b.id, { status: 'cancelled' });
      await updatePlanned(t.db, TEST_USER, c.id, { status: 'done' });
      const cand = (externalId: string) => ({ externalSource: 'rawg' as const, externalId });
      const r = await markPlanned(t.db, TEST_USER, ['1', '2', '3', '4'].map(cand));
      expect(r.map((x) => [x.planned, x.unallocated, x.plannedId])).toEqual([[true, false, a.id], [true, true, b.id], [true, false, c.id], [false, false, null]]);
      expect(await markPlanned(t.db, TEST_USER, [])).toEqual([]);
    });

    it('после исключения GET /roadmap пересчитывает notFit (без кэша): игра ДО не влезшей освобождает место, игра ПОСЛЕ нет', async () => {
      const base = { userId: 1, category: 'ps5_native_game', lastSeenAt: NOW };
      const ins = await t.db
        .insert(games)
        .values([
          { ...base, titleId: 'P', name: 'First', hltbMainHours: 300 },
          { ...base, titleId: 'Q', name: 'Second', hltbMainHours: 300 },
          { ...base, titleId: 'R', name: 'Third', hltbMainHours: 100 },
        ])
        .returning({ id: games.id });
      await t.db.insert(gameStatus).values(ins.map((g, i) => ({ userId: 1, gameId: g.id, status: 'backlog' as const, statusChangedAt: new Date(NOW.getTime() + i) })));
      await putSettings(t.db, TEST_USER, { year: 2026, hoursPerWeek: 10 });
      const [p, q, r3] = ins.map((g) => g.id);
      await saveOrder(t.db, TEST_USER, [p, q, r3]);
      const short = async () => (await getRoadmap(t.db, TEST_USER, NOW)).notFit.find((n) => n.gameId === q);
      const first = await short();
      expect(first).toMatchObject({ reason: 'no_capacity', hoursShort: 78.6, insertAt: 1, displacesAtInsert: 1, displacedTitles: ['First'] });
      await excludeGame(t.db, TEST_USER, r3); // после Second: ничего не меняется
      expect(await short()).toMatchObject({ hoursShort: 78.6 });
      await excludeGame(t.db, TEST_USER, p); // до Second: теперь влезает
      const after = await getRoadmap(t.db, TEST_USER, NOW);
      expect(after.notFit).toEqual([]);
      expect(after.items.map((i) => i.gameId)).toEqual([q]);
      expect(after.unallocated.map((u) => u.gameId).sort()).toEqual([p, r3].sort());
    });
  });
});
