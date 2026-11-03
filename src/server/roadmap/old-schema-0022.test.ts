// Фаза 32 (QA): порядок «код раньше миграции 0022»: документируем фактическое поведение нового кода на схеме после 0021.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb, TEST_USER } from '@/server/sync/test-helpers';
import { getGoal, getSettings } from './db';

describe('QA-32-1: новый код на схеме без 0022', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb({ migrations: 22 }); });
  afterAll(() => t.close());
  it('и настройки, и getGoal (а с ними весь GET /api/roadmap) падают (select * по roadmap_settings требует goal_mode), а не только цель', async () => {
    await expect(getSettings(t.db, TEST_USER, new Date('2026-07-01T09:00:00Z'))).rejects.toThrow();
    await expect(getGoal(t.db, TEST_USER, new Date('2026-07-01T09:00:00Z'))).rejects.toThrow(); // getRoadmap зовёт оба в Promise.all
  });
});
