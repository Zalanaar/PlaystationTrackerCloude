import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { matchOrphansByName, normalizeName } from './link';
import { computeDateEdit, computeStatusChange, setGameStatus, setStatusDate, StatusRuleError, type StatusRow } from './status-rules';
import { mskDate } from './time';
import { createTestDb, type TestDb } from './test-helpers';
import { TEST_USER } from '@/server/sync/test-helpers';

const d = (s: string) => new Date(s);
const NOW = d('2026-10-27T10:00:00Z');
const LAST = d('2026-10-01T21:30:00Z');

describe('computeStatusChange (чистые правила 1.3)', () => {
  const none = null;
  const cur = (status: StatusRow['status'], extra: Partial<StatusRow> = {}): StatusRow => ({
    status,
    completedAt: null,
    droppedAt: null,
    statusChangedAt: d('2026-01-01T00:00:00Z'),
    ...extra,
  });

  it('новый completed берёт дату последнего запуска', () => {
    const t = computeStatusChange(none, 'completed', { lastPlayedAt: LAST, now: NOW });
    expect(t).toEqual({ action: 'upsert', row: { status: 'completed', completedAt: LAST, droppedAt: null, statusChangedAt: NOW } });
  });
  it('dropped берёт дату последнего запуска', () => {
    const t = computeStatusChange(cur('playing'), 'dropped', { lastPlayedAt: LAST, now: NOW });
    expect(t).toMatchObject({ action: 'upsert', row: { status: 'dropped', droppedAt: LAST, completedAt: null } });
  });
  it('нет last_played_at: now', () => {
    const t = computeStatusChange(none, 'completed', { lastPlayedAt: null, now: NOW });
    expect(t).toMatchObject({ row: { completedAt: NOW } });
  });
  it('уход с completed обнуляет дату; другие статусы дат не имеют', () => {
    const t = computeStatusChange(cur('completed', { completedAt: LAST }), 'playing', { lastPlayedAt: LAST, now: NOW });
    expect(t).toMatchObject({ row: { status: 'playing', completedAt: null, droppedAt: null } });
    for (const s of ['playing', 'backlog', 'shelved', 'service'] as const) {
      expect(computeStatusChange(none, s, { lastPlayedAt: LAST, now: NOW })).toMatchObject({ row: { completedAt: null, droppedAt: null } });
    }
  });
  it('completed -> dropped: старая дата не переносится', () => {
    const t = computeStatusChange(cur('completed', { completedAt: d('2025-01-01T00:00:00Z') }), 'dropped', { lastPlayedAt: LAST, now: NOW });
    expect(t).toMatchObject({ row: { completedAt: null, droppedAt: LAST } });
  });
  it('тот же статус ничего не трогает (даты сохраняются)', () => {
    const c = cur('completed', { completedAt: d('2025-05-05T00:00:00Z') });
    expect(computeStatusChange(c, 'completed', { lastPlayedAt: LAST, now: NOW })).toEqual({ action: 'noop' });
  });
  it('сброс = delete; сброс «без статуса» без строки = noop', () => {
    expect(computeStatusChange(cur('backlog'), null, { lastPlayedAt: null, now: NOW })).toEqual({ action: 'delete' });
    expect(computeStatusChange(none, null, { lastPlayedAt: null, now: NOW })).toEqual({ action: 'noop' });
  });
  it('правка даты только для completed/dropped и только своей колонки', () => {
    const date = d('2026-02-02T00:00:00Z');
    expect(computeDateEdit(cur('completed', { completedAt: LAST }), date)).toMatchObject({ completedAt: date, droppedAt: null });
    expect(computeDateEdit(cur('dropped'), date)).toMatchObject({ droppedAt: date, completedAt: null });
    expect(() => computeDateEdit(cur('playing'), date)).toThrow(StatusRuleError);
    expect(() => computeDateEdit(cur('service'), date)).toThrow(StatusRuleError);
    expect(computeStatusChange(cur('completed', { completedAt: LAST }), 'service', { lastPlayedAt: LAST, now: NOW })).toMatchObject({ row: { status: 'service', completedAt: null, droppedAt: null } });
    expect(() => computeDateEdit(null, date)).toThrow(StatusRuleError);
  });
});

describe('setGameStatus / setStatusDate (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function game(lastPlayedAt: Date | null) {
    const [g] = await t.db
      .insert(schema.games)
      .values({ userId: 1, titleId: 'CUSA1_00', name: 'G', category: 'ps4_game', lastSeenAt: NOW, lastPlayedAt })
      .returning();
    return g.id;
  }
  const row = async (id: number) => (await t.db.select().from(schema.gameStatus).where(eq(schema.gameStatus.gameId, id)))[0];

  it('полный цикл статусов с БД-ограничениями', async () => {
    const id = await game(LAST);
    await setGameStatus(t.db, TEST_USER, id, 'completed', NOW);
    expect((await row(id)).completedAt).toEqual(LAST);

    // повтор не трогает даты, даже после ручной правки
    const manual = d('2026-02-02T00:00:00Z');
    await setStatusDate(t.db, TEST_USER, id, manual, NOW);
    await setGameStatus(t.db, TEST_USER, id, 'completed', d('2026-11-01T00:00:00Z'));
    expect((await row(id)).completedAt).toEqual(manual);

    await setGameStatus(t.db, TEST_USER, id, 'dropped', NOW);
    const r = await row(id);
    expect(r.completedAt).toBeNull();
    expect(r.droppedAt).toEqual(LAST);

    await setGameStatus(t.db, TEST_USER, id, 'backlog', NOW);
    expect(await row(id)).toMatchObject({ status: 'backlog', droppedAt: null });
    await expect(setStatusDate(t.db, TEST_USER, id, manual)).rejects.toMatchObject({ code: 'date_not_allowed' });

    await setGameStatus(t.db, TEST_USER, id, null, NOW);
    expect(await row(id)).toBeUndefined();
  });

  it('неизвестная игра', async () => {
    await expect(setGameStatus(t.db, TEST_USER, 999, 'playing')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('mskDate', () => {
  it('граница суток по Москве, не по UTC', () => {
    expect(mskDate(d('2026-10-27T20:59:59Z'))).toBe('2026-10-27'); // 23:59:59 МСК
    expect(mskDate(d('2026-10-27T21:00:00Z'))).toBe('2026-10-28'); // 00:00 МСК
    expect(mskDate(d('2026-12-31T21:30:00Z'))).toBe('2027-01-01');
    expect(mskDate(d('2026-10-01T00:30:00Z'))).toBe('2026-10-01');
  });
});

describe('сопоставление по имени', () => {
  it('нормализация', () => {
    expect(normalizeName('Delta Souls™')).toBe(normalizeName('delta souls'));
    expect(normalizeName('Alpha Quest (PS5)')).toBe(normalizeName('Alpha Quest'));
    expect(normalizeName('Game: Deluxe Edition')).toBe(normalizeName('Game'));
    expect(normalizeName('Hades II')).not.toBe(normalizeName('Hades'));
  });
  it('только однозначные совпадения', () => {
    const r = matchOrphansByName(
      [
        { setId: 1, name: 'Delta Souls™' },
        { setId: 2, name: 'Twin' },
        { setId: 3, name: 'Nothing' },
      ],
      [
        { gameId: 10, name: 'Delta Souls' },
        { gameId: 11, name: 'Twin' },
        { gameId: 12, name: 'Twin (PS5)' },
      ],
    );
    expect(r.links).toEqual([{ setId: 1, gameId: 10 }]);
    expect(r.ambiguous).toEqual([2]);
  });
});
