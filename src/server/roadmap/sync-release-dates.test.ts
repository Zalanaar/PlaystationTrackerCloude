import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { createPlanned, getRoadmap, listPlanned, putSettings, updatePlanned } from './db';
import type { PlannedCreate } from './validation';
import { applyCatalogReleaseDates, refreshPlannedReleaseDates } from './sync-release-dates';

const planned = (o: Partial<PlannedCreate> = {}): PlannedCreate => ({
  title: 'Новинка', releaseDate: null, coverUrl: null, wantAtRelease: false, hoursManual: null, externalSource: null, externalId: null, ...o,
});

describe('даты релиза в плане подтягиваются из каталога', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  it('меняет дату у «Хочу пройти на релизе» с тем же rawg id; окно плана переезжает', async () => {
    await putSettings(t.db, TEST_USER, { year: 2027, hoursPerWeek: 10 });
    const g = await createPlanned(t.db, TEST_USER, planned({
      title: 'God of War Laufey', releaseDate: '2027-02-16', wantAtRelease: true, hoursManual: 14,
      externalSource: 'rawg', externalId: '999001',
    }));
    const before = await getRoadmap(t.db, TEST_USER, new Date('2026-11-24T12:00:00Z'));
    expect(before.items.find((i) => i.plannedId === g.id)).toMatchObject({ start: '2027-02-16', end: '2027-03-01' });

    const changed = await applyCatalogReleaseDates(t.db, TEST_USER, [
      { externalId: '999001', releaseDate: '2027-05-20' },
    ]);
    expect(changed).toEqual([{ id: g.id, externalId: '999001', from: '2027-02-16', to: '2027-05-20' }]);
    expect((await listPlanned(t.db, TEST_USER, 'planned'))[0].releaseDate).toBe('2027-05-20');

    const after = await getRoadmap(t.db, TEST_USER, new Date('2026-11-24T12:00:00Z'));
    expect(after.items.find((i) => i.plannedId === g.id)).toMatchObject({ start: '2027-05-20', end: '2027-06-02' });
  });

  it('не трогает игру без галки, чужого пользователя, done и пустую дату каталога', async () => {
    const keep = await createPlanned(t.db, TEST_USER, planned({
      title: 'Без галки', releaseDate: '2027-02-16', wantAtRelease: false, hoursManual: 10,
      externalSource: 'rawg', externalId: '10',
    }));
    const want = await createPlanned(t.db, TEST_USER, planned({
      title: 'На релизе', releaseDate: '2027-02-16', wantAtRelease: true, hoursManual: 10,
      externalSource: 'rawg', externalId: '11',
    }));
    const done = await createPlanned(t.db, TEST_USER, planned({
      title: 'Готово', releaseDate: '2027-02-16', wantAtRelease: true, hoursManual: 10,
      externalSource: 'rawg', externalId: '12',
    }));
    await updatePlanned(t.db, TEST_USER, done.id, { status: 'done' });
    const [u2] = await t.db.insert(schema.allowedUsers).values({ email: 'u2@example.com', role: 'member', status: 'active' }).returning({ id: schema.allowedUsers.id });
    const otherUser = asUserId(u2.id);
    const other = await createPlanned(t.db, otherUser, planned({
      title: 'Чужая', releaseDate: '2027-02-16', wantAtRelease: true, hoursManual: 10,
      externalSource: 'rawg', externalId: '11',
    }));

    const changed = await applyCatalogReleaseDates(t.db, TEST_USER, [
      { externalId: '10', releaseDate: '2027-05-20' },
      { externalId: '11', releaseDate: '2027-05-20' },
      { externalId: '12', releaseDate: '2027-05-20' },
      { externalId: '11', releaseDate: null },
    ]);
    // null не затирает; без галки и done не входят; чужой пользователь не наш
    expect(changed).toEqual([{ id: want.id, externalId: '11', from: '2027-02-16', to: '2027-05-20' }]);
    const rows = await listPlanned(t.db, TEST_USER, 'all');
    expect(rows.find((r) => r.id === keep.id)?.releaseDate).toBe('2027-02-16');
    expect(rows.find((r) => r.id === want.id)?.releaseDate).toBe('2027-05-20');
    expect(rows.find((r) => r.id === done.id)?.releaseDate).toBe('2027-02-16');
    expect((await listPlanned(t.db, otherUser, 'planned'))[0]).toMatchObject({ id: other.id, releaseDate: '2027-02-16' });
  });

  it('refresh: ходит в каталог за играми не с текущей страницы, кэш не повторяет запрос', async () => {
    const a = await createPlanned(t.db, TEST_USER, planned({
      title: 'На странице', releaseDate: '2027-02-16', wantAtRelease: true, hoursManual: 10,
      externalSource: 'rawg', externalId: '21',
    }));
    const b = await createPlanned(t.db, TEST_USER, planned({
      title: 'Не на странице', releaseDate: '2027-03-01', wantAtRelease: true, hoursManual: 10,
      externalSource: 'rawg', externalId: '22',
    }));
    const called: string[] = [];
    const fetchGame = async (id: string) => {
      called.push(id);
      return id === '22' ? { externalId: '22', releaseDate: '2027-08-15' } : { externalId: id, releaseDate: '2027-05-01' };
    };
    const cache = new Map();
    const first = await refreshPlannedReleaseDates(t.db, TEST_USER, {
      fetchGame, skipIds: new Set(['21']), cache, now: 1_000,
    });
    expect(called).toEqual(['22']);
    expect(first).toEqual([{ id: b.id, externalId: '22', from: '2027-03-01', to: '2027-08-15' }]);
    called.length = 0;
    const again = await refreshPlannedReleaseDates(t.db, TEST_USER, {
      fetchGame, cache, now: 1_000 + 59 * 60_000,
    });
    expect(called).toEqual([]);
    expect(again).toEqual([]);
    const afterTtl = await refreshPlannedReleaseDates(t.db, TEST_USER, {
      fetchGame, cache, now: 1_000 + 60 * 60_000,
    });
    expect(called.sort()).toEqual(['21', '22']);
    expect(afterTtl).toEqual([{ id: a.id, externalId: '21', from: '2027-02-16', to: '2027-05-01' }]);
    expect((await listPlanned(t.db, TEST_USER, 'planned')).find((r) => r.id === a.id)?.releaseDate).toBe('2027-05-01');
  });
});
