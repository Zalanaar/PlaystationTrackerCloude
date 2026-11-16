// П12.6: экранирование, свёртка 75 октетов UTF-8, события на весь день, отбор (planned, будущие, по Москве), дубли названий, изоляция.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { schema } from '@/db';
import { asUserId } from '@/server/auth/user-id';
import { createTestDb, TEST_USER, TEST_USER_2, type TestDb } from '@/server/sync/test-helpers';
import { buildIcs, foldLine, getReleases, icsText } from './releases-ics';

const NOW = new Date('2026-11-16T22:30:00Z'); // 17 ноября по Москве
const enc = new TextEncoder();

describe('формат', () => {
  it('экранирование TEXT', () => {
    expect(icsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });
  it('свёртка по 75 октетов, кириллица не рвётся', () => {
    const line = `SUMMARY:${'Ж'.repeat(80)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(enc.encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
    expect(foldLine('SHORT')).toBe('SHORT');
  });
  it('календарь и событие на весь день', () => {
    const ics = buildIcs([{ uid: 'planned-1@ps-tracker', title: 'GTA VI', date: '2026-12-31', note: 'В плане' }], NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n');
    expect(ics).toContain('UID:planned-1@ps-tracker\r\nDTSTAMP:20261116T223000Z\r\n');
    expect(ics).toContain('SUMMARY:Релиз: GTA VI\r\n');
    expect(buildIcs([], NOW)).not.toContain('VEVENT');
  });
});

describe('getReleases (PGlite)', () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await createTestDb();
    await t.pg.execute(sql`insert into allowed_users (email, role, status) values ('m@example.com', 'member', 'active')`);
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  it('отбор и порядок', async () => {
    const p = (title: string, releaseDate: string | null, o: { status?: string; want?: boolean; user?: number } = {}) =>
      t.db.insert(schema.plannedGames).values({ userId: o.user ?? TEST_USER, title, releaseDate, status: o.status ?? 'planned', wantAtRelease: o.want ?? false }).returning();
    const [b] = await p('Beta', '2027-03-01', { want: true });
    const [a] = await p('Alpha', '2026-11-17'); // сегодня по Москве — входит
    await p('Past', '2026-11-16');
    await p('NoDate', null);
    await p('Done', '2027-01-01', { status: 'done' });
    await p('Other', '2027-01-01', { user: TEST_USER_2 });
    const m = (title: string, releaseDate: string, kind = 'ps_backlog') => t.db.insert(schema.manualGames).values({ userId: TEST_USER, rawgId: title, title, releaseDate, kind }).returning();
    const [g] = await m('Gamma', '2027-02-01');
    await m('beta ', '2027-03-01'); // дубль названия из плана
    await m('Other platform', '2027-02-02', 'other_platform');
    const r = await getReleases(t.db, asUserId(TEST_USER), NOW);
    expect(r).toEqual([
      { uid: `planned-${a.id}@ps-tracker`, title: 'Alpha', date: '2026-11-17', note: 'В плане' },
      { uid: `manual-${g.id}@ps-tracker`, title: 'Gamma', date: '2027-02-01', note: 'В бэклоге (вручную)' },
      { uid: `planned-${b.id}@ps-tracker`, title: 'Beta', date: '2027-03-01', note: 'В плане: хочу пройти на релизе' },
    ]);
  });
});
