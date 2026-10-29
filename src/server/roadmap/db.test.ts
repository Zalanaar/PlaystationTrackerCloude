// Фаза 12 на PGlite: очередь бэклога, порядок, planned_games, GET /api/roadmap целиком, прогресс по снимкам.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import {
  createPlanned, deletePlanned, DuplicatePlannedError, getBacklogEntries, getRoadmap, getSettings, listPlanned, NotFoundError,
  putSettings, saveOrder, UnknownGamesError, updatePlanned, WantNeedsDateError,
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
    await saveOrder(t.db, [id('B'), id('A')]);
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
    expect(r.progress?.plannedHours).toBe(22);
    expect(r.progress?.status).toBe('ahead');
  });
});
