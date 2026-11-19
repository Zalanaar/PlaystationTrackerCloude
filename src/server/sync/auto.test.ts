import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncRuns } from '@/db/schema';
import type { UserId } from '@/server/auth/user-id';
import { AUTO_SYNC_STALE_MS, autoSyncDecision, loadAutoSyncInputs } from './auto';
import { createTestDb, type TestDb } from './test-helpers';

const now = new Date('2026-11-19T12:00:00Z');
const ago = (h: number) => new Date(now.getTime() - h * 3600_000);

describe('автосинк при открытии (идея 1)', () => {
  it('порог 6 ч', () => expect(AUTO_SYNC_STALE_MS).toBe(6 * 3600_000));
  it('данным больше 6 ч, последний запуск давно — запуск', () => {
    expect(autoSyncDecision({ last: { status: 'success', startedAt: ago(13) }, lastSuccessAt: ago(13) }, now)).toEqual({ go: true });
  });
  it('свежие данные — нет', () => {
    expect(autoSyncDecision({ last: { status: 'success', startedAt: ago(2) }, lastSuccessAt: ago(2) }, now)).toEqual({ go: false, reason: 'recent' });
  });
  it('недавняя неудачная попытка тоже держит окно 6 ч (не долбим PSN)', () => {
    expect(autoSyncDecision({ last: { status: 'failed', startedAt: ago(1) }, lastSuccessAt: ago(30) }, now)).toEqual({ go: false, reason: 'recent' });
  });
  it('идёт синк — нет', () => {
    expect(autoSyncDecision({ last: { status: 'running', startedAt: ago(9) }, lastSuccessAt: ago(30) }, now)).toEqual({ go: false, reason: 'running' });
  });
  it('ни одного успешного синка — нет (первый запускает онбординг)', () => {
    expect(autoSyncDecision({ last: null, lastSuccessAt: null }, now)).toEqual({ go: false, reason: 'never' });
  });
});

describe('loadAutoSyncInputs (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  it('последний запуск любого вида, кроме hltb, и время последнего успешного', async () => {
    const uid = 1 as UserId;
    expect(await loadAutoSyncInputs(t.db, uid)).toEqual({ last: null, lastSuccessAt: null });
    await t.db.insert(syncRuns).values({ userId: 1, kind: 'daily', status: 'success', snapshotDate: '2026-11-18', startedAt: ago(13), finishedAt: ago(12.9) });
    await t.db.insert(syncRuns).values({ userId: 1, kind: 'manual', status: 'failed', snapshotDate: '2026-11-19', startedAt: ago(8), finishedAt: ago(7.9) });
    await t.db.insert(syncRuns).values({ userId: 1, kind: 'hltb', status: 'success', snapshotDate: '2026-11-19', startedAt: ago(1), finishedAt: ago(0.9) });
    const i = await loadAutoSyncInputs(t.db, uid);
    expect(i.last).toEqual({ status: 'failed', startedAt: ago(8) });
    expect(i.lastSuccessAt).toEqual(ago(12.9));
    expect(autoSyncDecision(i, now)).toEqual({ go: true });
  });
});
