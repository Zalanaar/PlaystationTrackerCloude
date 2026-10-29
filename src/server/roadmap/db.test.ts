// Фаза 12 на PGlite: очередь бэклога, порядок, planned_games, GET /api/roadmap целиком, прогресс по снимкам.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
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
    const base = { category: 'ps5_native_game', lastSeenAt: NOW };
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
      { gameId: id('D'), status: 'backlog', statusChangedAt: at(0) },
      { gameId: id('A'), status: 'backlog', statusChangedAt: at(1) },
      { gameId: id('B'), status: 'backlog', statusChangedAt: at(2) },
      { gameId: id('C'), status: 'backlog', statusChangedAt: at(3) },
      { gameId: id('E'), status: 'playing' },
    ]);
    return id;
  }

  it('очередь: только видимый backlog, без позиции по дате попадания, override приоритетнее HLTB', async () => {
    await seed();
    const q = await getBacklogEntries(t.db);
    expect(q.map((e) => e.title)).toEqual(['Delta', 'Alpha', 'Bravo']);
    expect(q.map((e) => [e.hours, e.hoursSource])).toEqual([[null, null], [10, 'hltb'], [5, 'manual']]);
  });

  it('ручной порядок; новая игра бэклога встаёт в конец; игра, ушедшая из бэклога, не мешает', async () => {
    const id = await seed();
    expect(await saveOrder(t.db, [id('B'), id('E'), id('A')])).toEqual([id('B'), id('E'), id('A')]);
    expect((await getBacklogEntries(t.db)).map((e) => e.title)).toEqual(['Bravo', 'Alpha', 'Delta']);
    // новая игра в бэклоге
    const [f] = await t.db.insert(games).values({ category: 'ps4_game', lastSeenAt: NOW, titleId: 'F', name: 'Foxtrot' }).returning({ id: games.id });
    await t.db.insert(gameStatus).values({ gameId: f.id, status: 'backlog', statusChangedAt: new Date(NOW.getTime() + 999_000) });
    expect((await getBacklogEntries(t.db)).map((e) => e.title)).toEqual(['Bravo', 'Alpha', 'Delta', 'Foxtrot']);
    // замена целиком, пустой список сбрасывает
    await saveOrder(t.db, [id('D')]);
    expect((await getBacklogEntries(t.db))[0].title).toBe('Delta');
    await saveOrder(t.db, []);
    expect((await getBacklogEntries(t.db)).map((e) => e.title)).toEqual(['Delta', 'Alpha', 'Bravo', 'Foxtrot']);
  });

  it('строки порядка игр, ушедших из бэклога, не удаляются ни сменой статуса, ни PUT order', async () => {
    const id = await seed();
    await saveOrder(t.db, [id('A'), id('B')]);
    await t.db.update(gameStatus).set({ status: 'playing' }).where(eq(gameStatus.gameId, id('A')));
    await saveOrder(t.db, [id('B')]);
    const rows = await t.db.select({ g: schema.roadmapOrder.gameId }).from(schema.roadmapOrder);
    expect(rows.map((r) => r.g).sort()).toEqual([id('A'), id('B')].sort());
  });

  it('порядок: неизвестные id = UnknownGamesError, ничего не меняется', async () => {
    const id = await seed();
    await saveOrder(t.db, [id('B')]);
    await expect(saveOrder(t.db, [id('A'), 9999])).rejects.toBeInstanceOf(UnknownGamesError);
    expect((await getBacklogEntries(t.db))[0].title).toBe('Bravo');
  });

  it('настройки: нет строки = configured false, upsert', async () => {
    expect(await getSettings(t.db, NOW)).toEqual({ year: 2026, hoursPerWeek: null, configured: false });
    await putSettings(t.db, { year: 2026, hoursPerWeek: 7.5 });
    await putSettings(t.db, { year: 2027, hoursPerWeek: 10 });
    expect(await getSettings(t.db, NOW)).toEqual({ year: 2027, hoursPerWeek: 10, configured: true });
  });

  it('planned_games: CRUD, дубль каталога, want без даты', async () => {
    const a = await createPlanned(t.db, planned({ title: 'Б', releaseDate: '2026-12-01', externalSource: 'rawg', externalId: '1' }));
    const b = await createPlanned(t.db, planned({ title: 'А', releaseDate: '2026-03-01', wantAtRelease: true, hoursManual: 12 }));
    const c = await createPlanned(t.db, planned({ title: 'Без даты' }));
    await expect(createPlanned(t.db, planned({ externalSource: 'rawg', externalId: '1' }))).rejects.toMatchObject({ existingId: a.id });
    await expect(createPlanned(t.db, planned({ externalSource: 'rawg', externalId: '1' }))).rejects.toBeInstanceOf(DuplicatePlannedError);
    expect((await listPlanned(t.db, 'all')).map((x) => x.title)).toEqual(['А', 'Б', 'Без даты']);
    await expect(updatePlanned(t.db, c.id, { wantAtRelease: true })).rejects.toBeInstanceOf(WantNeedsDateError);
    await expect(updatePlanned(t.db, b.id, { releaseDate: null })).rejects.toBeInstanceOf(WantNeedsDateError);
    const upd = await updatePlanned(t.db, c.id, { wantAtRelease: true, releaseDate: '2026-06-01', hoursManual: 8 });
    expect(upd).toMatchObject({ wantAtRelease: true, releaseDate: '2026-06-01', hoursManual: 8 });
    await updatePlanned(t.db, a.id, { status: 'cancelled' });
    expect((await listPlanned(t.db, 'planned')).map((x) => x.id)).toEqual([b.id, c.id]);
    await expect(updatePlanned(t.db, 9999, { title: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await deletePlanned(t.db, a.id);
    await expect(deletePlanned(t.db, a.id)).rejects.toBeInstanceOf(NotFoundError);
    // после удаления тот же внешний id можно добавить снова
    await createPlanned(t.db, planned({ externalSource: 'rawg', externalId: '1' }));
  });

  it('GET /api/roadmap: не настроено -> no_budget, needHours считается, прогресса нет', async () => {
    await seed();
    const r = await getRoadmap(t.db, NOW);
    expect(r).toMatchObject({ status: 'no_budget', settings: { configured: false, year: 2026 }, today: '2026-10-29', progress: null, items: [] });
    expect(r.needHours.map((e) => e.title)).toEqual(['Delta']);
  });

  it('GET /api/roadmap: план из БД, релиз по дате, прогресс по снимкам', async () => {
    const id = await seed();
    await putSettings(t.db, { year: 2026, hoursPerWeek: 10 });
    await saveOrder(t.db, [id('B'), id('A'), id('E')]); // E (playing) остаётся в плане для прогресса
    await createPlanned(t.db, planned({ title: 'Релиз', releaseDate: '2026-01-05', wantAtRelease: true, hoursManual: 7 }));
    const cancelled = await createPlanned(t.db, planned({ title: 'Отменён', releaseDate: '2026-02-05', wantAtRelease: true, hoursManual: 7 }));
    await updatePlanned(t.db, cancelled.id, { status: 'cancelled' });
    // снимки: игра E, до года 100 ч, к 28 октября 100 + 250 ч
    await t.db.insert(playtimeSnapshots).values([
      { gameId: id('E'), snapshotDate: '2025-12-31', playDurationSeconds: 100 * 3600 },
      { gameId: id('E'), snapshotDate: '2026-10-28', playDurationSeconds: 350 * 3600 },
    ]);
    const r = await getRoadmap(t.db, NOW);
    expect(r.status).toBe('ok');
    expect(r.items.map((i) => [i.title, i.start, i.end])).toEqual([
      ['Bravo', '2026-01-01', '2026-01-04'], // 5 ч = 4 дня
      ['Релиз', '2026-01-05', '2026-01-11'],
      ['Alpha', '2026-01-12', '2026-01-18'], // 10 ч = 7 дней после релиза
    ]);
    expect(r.queue).toEqual([{ key: `g:${id('B')}`, state: 'scheduled' }, { key: `g:${id('A')}`, state: 'scheduled' }, { key: `g:${id('D')}`, state: 'need_hours' }]);
    expect(r.notFit).toEqual([]);
    expect(r.progress).toMatchObject({ from: '2026-01-01', asOf: '2026-10-28', actualHours: 250 });
    expect(r.progress?.plannedHours).toBe(15); // только игры плана: Bravo 5 + Alpha 10, релиз не считается
    expect(r.progress?.status).toBe('ahead');
  });

  describe('правки после выкатки: не распределено, сервисы, предстоящие', () => {
    const setStatus = (gameId: number, status: 'service' | 'completed' | 'backlog') =>
      t.db.update(gameStatus).set({ status }).where(eq(gameStatus.gameId, gameId));

    it('исключение: игра уходит из очереди и плана в unallocated, статус backlog остаётся, порядок чистится; идемпотентно', async () => {
      const id = await seed();
      await putSettings(t.db, { year: 2026, hoursPerWeek: 10 });
      await saveOrder(t.db, [id('B'), id('A'), id('D')]);
      await excludeGame(t.db, id('A'));
      await excludeGame(t.db, id('A'));
      const r = await getRoadmap(t.db, NOW);
      expect(r.queue.map((q) => q.key)).toEqual([`g:${id('B')}`, `g:${id('D')}`]);
      expect(r.items.map((i) => i.title)).toEqual(['Bravo']);
      expect(r.notFit).toEqual([]);
      expect(r.needHours.map((e) => e.title)).toEqual(['Delta']);
      expect(r.unallocated).toEqual([
        { key: `g:${id('A')}`, kind: 'backlog', gameId: id('A'), plannedId: null, title: 'Alpha', coverUrl: null, hours: 10, hoursSource: 'hltb', releaseDate: null, wantAtRelease: false },
      ]);
      const [st] = await t.db.select().from(gameStatus).where(eq(gameStatus.gameId, id('A')));
      expect(st.status).toBe('backlog');
      const rows = await t.db.select({ g: schema.roadmapOrder.gameId }).from(schema.roadmapOrder);
      expect(rows.map((x) => x.g)).not.toContain(id('A'));
    });

    it('исключение: нет игры = NotFound, не бэклог = NotBacklog; unallocated не показывает скрытые и ушедшие из бэклога', async () => {
      const id = await seed();
      await expect(excludeGame(t.db, 9999)).rejects.toBeInstanceOf(NotFoundError);
      await expect(excludeGame(t.db, id('E'))).rejects.toBeInstanceOf(NotBacklogError);
      await excludeGame(t.db, id('B'));
      await setStatus(id('B'), 'completed');
      expect((await getRoadmap(t.db, NOW)).unallocated).toEqual([]);
    });

    it('возврат: игра встаёт в конец очереди (после игр без позиции тоже), ручной порядок сохраняется', async () => {
      const id = await seed();
      await saveOrder(t.db, [id('B'), id('A'), id('D')]);
      await excludeGame(t.db, id('B'));
      // новая игра бэклога без позиции
      const [f] = await t.db.insert(games).values({ category: 'ps4_game', lastSeenAt: NOW, titleId: 'F', name: 'Foxtrot' }).returning({ id: games.id });
      await t.db.insert(gameStatus).values({ gameId: f.id, status: 'backlog', statusChangedAt: new Date(NOW.getTime() + 999_000) });
      await restoreGame(t.db, id('B'));
      await restoreGame(t.db, id('B')); // идемпотентно
      expect((await getBacklogEntries(t.db)).map((e) => e.title)).toEqual(['Alpha', 'Delta', 'Foxtrot', 'Bravo']);
      expect((await getRoadmap(t.db, NOW)).unallocated).toEqual([]);
      await expect(restoreGame(t.db, 9999)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('релизы: cancelled = unallocated, возврат planned; done не показывается', async () => {
      await seed();
      const a = await createPlanned(t.db, planned({ title: 'Релиз', releaseDate: '2026-12-01', wantAtRelease: true, hoursManual: 10 }));
      const b = await createPlanned(t.db, planned({ title: 'Позже' }));
      const c = await createPlanned(t.db, planned({ title: 'Готово' }));
      await updatePlanned(t.db, a.id, { status: 'cancelled' });
      await updatePlanned(t.db, c.id, { status: 'done' });
      let r = await getRoadmap(t.db, NOW);
      expect(r.unallocated.map((e) => [e.key, e.kind, e.hours])).toEqual([[`p:${a.id}`, 'release', 10]]);
      expect(r.needHours.map((e) => e.key)).toEqual(expect.not.arrayContaining([`p:${a.id}`]));
      await updatePlanned(t.db, a.id, { status: 'planned' });
      r = await getRoadmap(t.db, NOW);
      expect(r.unallocated).toEqual([]);
      expect(r.needHours.map((e) => e.key)).toContain(`p:${b.id}`);
    });

    it('PUT order: service и исключённые отклоняются, ничего не меняется', async () => {
      const id = await seed();
      await saveOrder(t.db, [id('B')]);
      await setStatus(id('A'), 'service');
      await excludeGame(t.db, id('D'));
      await expect(saveOrder(t.db, [id('A'), id('B')])).rejects.toMatchObject({ reason: 'service_game', ids: [id('A')] });
      await expect(saveOrder(t.db, [id('D')])).rejects.toMatchObject({ reason: 'excluded', ids: [id('D')] });
      await expect(saveOrder(t.db, [id('D')])).rejects.toBeInstanceOf(OrderRejectedError);
      expect((await getBacklogEntries(t.db))[0].title).toBe('Bravo');
    });

    it('PUT order: полный порядок включая не влезшие сохраняется как есть', async () => {
      const id = await seed();
      await putSettings(t.db, { year: 2026, hoursPerWeek: 0.1 }); // почти нет ёмкости: игры не влезают
      await saveOrder(t.db, [id('D'), id('B'), id('A')]);
      const r = await getRoadmap(t.db, NOW);
      expect(r.queue.map((q) => q.key)).toEqual([`g:${id('D')}`, `g:${id('B')}`, `g:${id('A')}`]);
      expect(r.queue.some((q) => q.state === 'not_fit')).toBe(true);
    });

    it('прогресс: service и исключённые выпадают из игр плана (план и факт), completed остаётся', async () => {
      const id = await seed();
      await putSettings(t.db, { year: 2026, hoursPerWeek: 10 });
      await saveOrder(t.db, [id('B'), id('A')]);
      // E (playing) и F (service) и G (completed) в roadmap_order «из прошлого»
      const [f, g] = await t.db
        .insert(games)
        .values([{ category: 'ps4_game', lastSeenAt: NOW, titleId: 'F', name: 'Foxtrot' }, { category: 'ps4_game', lastSeenAt: NOW, titleId: 'G', name: 'Golf' }])
        .returning({ id: games.id });
      await t.db.insert(gameStatus).values([{ gameId: f.id, status: 'service' }, { gameId: g.id, status: 'completed' }]);
      await t.db.insert(schema.roadmapOrder).values([{ gameId: f.id, position: 8 }, { gameId: g.id, position: 9 }]);
      await t.db.insert(playtimeSnapshots).values([
        { gameId: f.id, snapshotDate: '2025-12-31', playDurationSeconds: 0 },
        { gameId: f.id, snapshotDate: '2026-10-28', playDurationSeconds: 100 * 3600 },
        { gameId: g.id, snapshotDate: '2025-12-31', playDurationSeconds: 0 },
        { gameId: g.id, snapshotDate: '2026-10-28', playDurationSeconds: 20 * 3600 },
        { gameId: id('A'), snapshotDate: '2025-12-31', playDurationSeconds: 0 },
        { gameId: id('A'), snapshotDate: '2026-10-28', playDurationSeconds: 3 * 3600 },
      ]);
      let r = await getRoadmap(t.db, NOW);
      expect(r.progress?.actualHours).toBe(23); // Foxtrot (service) не считается; Golf (completed) и Alpha считаются
      // исключённая игра: факт и план пропадают
      await excludeGame(t.db, id('A'));
      r = await getRoadmap(t.db, NOW);
      expect(r.progress?.actualHours).toBe(20);
    });

    it('serviceGames: видимые service, last_played_at desc, лимит 50, часы с шагом 0.1; есть и при no_budget', async () => {
      await seed();
      const base = { category: 'ps5_native_game', lastSeenAt: NOW };
      const rows = Array.from({ length: 52 }, (_, i) => ({
        ...base, titleId: `S${i}`, name: `Svc${i}`, playDurationSeconds: 3600 * 10 + 180 * i, lastPlayedAt: i === 0 ? null : new Date(NOW.getTime() - i * 3_600_000),
        hiddenAt: i === 1 ? NOW : null,
      }));
      const ins = await t.db.insert(games).values(rows).returning({ id: games.id });
      await t.db.insert(gameStatus).values(ins.map((x) => ({ gameId: x.id, status: 'service' as const })));
      const r = await getRoadmap(t.db, NOW);
      expect(r.status).toBe('no_budget');
      expect(r.serviceGames).toHaveLength(50);
      expect(r.serviceGames[0]).toEqual({ gameId: ins[2].id, title: 'Svc2', coverUrl: null, playedHours: 10.1 }); // Svc1 скрыта, Svc0 без запуска в конце
      expect(r.serviceGames.map((x) => x.title)).not.toContain('Svc1');
      expect(r.serviceGames.map((x) => x.title)).not.toContain('Svc0'); // 51 видимая, последняя (без запуска) за лимитом
    });

    it('markPlanned: пометки по external_id в любом статусе', async () => {
      const a = await createPlanned(t.db, planned({ title: 'A', externalSource: 'rawg', externalId: '1' }));
      const b = await createPlanned(t.db, planned({ title: 'B', externalSource: 'rawg', externalId: '2' }));
      const c = await createPlanned(t.db, planned({ title: 'C', externalSource: 'rawg', externalId: '3' }));
      await updatePlanned(t.db, b.id, { status: 'cancelled' });
      await updatePlanned(t.db, c.id, { status: 'done' });
      const cand = (externalId: string) => ({ externalSource: 'rawg' as const, externalId });
      const r = await markPlanned(t.db, ['1', '2', '3', '4'].map(cand));
      expect(r.map((x) => [x.planned, x.unallocated, x.plannedId])).toEqual([[true, false, a.id], [true, true, b.id], [true, false, c.id], [false, false, null]]);
      expect(await markPlanned(t.db, [])).toEqual([]);
    });
  });
});
