// Резервная копия разметки (контракт 20.3): формат, выгрузка, preview/apply восстановления, идемпотентность, еженедельная отправка.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { schema } from '@/db';
import { sendTelegramDocument } from '@/server/notify/telegram';
import { createTestDb, type TestDb } from '@/server/sync/test-helpers';
import { buildBackup } from './export';
import { BACKUP_APP, BACKUP_SCHEMA_VERSION, parseBackup, type BackupFile } from './format';
import { isDataError } from './errors';
import { applyRestore, previewRestore } from './restore';
import { BACKUP_KIND, isBackupDue, isSundayMsk, runWeeklyBackup } from './weekly';

const { games, gameStatus, roadmapOrder, roadmapExcluded, gameMonthExclusions, plannedGames, roadmapSettings, statusBackups, notifyLog } = schema;
const NOW = new Date('2026-10-29T09:00:00Z'); // четверг
const SUNDAY = new Date('2026-11-01T06:00:00Z');
const ENV = { token: '123:SECRET-TOKEN', chatId: '42' };

describe('backup', () => {
  let t: TestDb;
  beforeAll(async () => { t = await createTestDb(); });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  async function seed() {
    const ins = await t.db.insert(games).values([
      { titleId: 'A', name: 'Hades', category: 'ps5_native_game', lastSeenAt: NOW, durationOverrideHours: 22.5, genresOverride: ['ACTION'] },
      { titleId: 'B', name: 'Bloodborne', category: 'ps4_game', lastSeenAt: NOW },
      { titleId: 'C', name: 'Hidden', category: 'ps4_game', lastSeenAt: NOW, hiddenAt: new Date('2026-05-01T00:00:00Z') },
      { titleId: 'D', name: 'Чистая игра без разметки', category: 'ps4_game', lastSeenAt: NOW },
      { titleId: 'E', name: 'Queue', category: 'ps4_game', lastSeenAt: NOW },
    ]).returning({ id: games.id, titleId: games.titleId });
    const id = (k: string) => ins.find((x) => x.titleId === k)!.id;
    await t.db.insert(gameStatus).values([
      { gameId: id('A'), status: 'completed', completedAt: new Date('2026-03-02T19:10:00Z'), statusChangedAt: new Date('2026-03-02T19:11:00Z') },
      { gameId: id('B'), status: 'dropped', droppedAt: new Date('2026-04-01T10:00:00Z') },
      { gameId: id('E'), status: 'backlog' },
    ]);
    await t.db.insert(roadmapOrder).values([{ gameId: id('E'), position: 3 }]);
    await t.db.insert(roadmapExcluded).values([{ gameId: id('B') }]);
    await t.db.insert(gameMonthExclusions).values([{ gameId: id('A'), month: '2026-03' }, { gameId: id('A'), month: '2026-02' }]);
    await t.db.insert(plannedGames).values([
      { title: 'GTA VI', releaseDate: '2026-11-19', wantAtRelease: true, hoursManual: 40, externalSource: 'rawg', externalId: '123', coverUrl: 'https://media.rawg.io/a.jpg' },
      { title: 'Manual One', status: 'cancelled' },
    ]);
    await t.db.insert(roadmapSettings).values({ id: 1, year: 2026, hoursPerWeek: 8 });
    return id;
  }

  it('выгрузка: версия, только игры с ручными данными, стабильный порядок, нет секретов и лишних полей', async () => {
    await seed();
    const f = await buildBackup(t.db, NOW);
    expect(f).toMatchObject({ app: BACKUP_APP, schemaVersion: BACKUP_SCHEMA_VERSION, createdAt: NOW.toISOString() });
    expect(f.games.map((g) => g.titleId)).toEqual(['A', 'B', 'C', 'E']); // D без разметки не попадает
    const a = f.games[0];
    expect(a).toEqual({
      titleId: 'A', name: 'Hades',
      status: { value: 'completed', completedAt: '2026-03-02T19:10:00.000Z', droppedAt: null, statusChangedAt: '2026-03-02T19:11:00.000Z' },
      durationOverrideHours: 22.5, genresOverride: ['ACTION'], hiddenAt: null, roadmapPosition: null, roadmapExcluded: false, monthExclusions: ['2026-02', '2026-03'],
    });
    expect(f.games[1]).toMatchObject({ titleId: 'B', roadmapExcluded: true, status: { value: 'dropped', droppedAt: '2026-04-01T10:00:00.000Z' } });
    expect(f.games[2]).toMatchObject({ titleId: 'C', status: null, hiddenAt: '2026-05-01T00:00:00.000Z' });
    expect(f.games[3]).toMatchObject({ titleId: 'E', roadmapPosition: 3 });
    expect(f.plannedGames).toHaveLength(2);
    expect(f.plannedGames[0]).toEqual({ title: 'GTA VI', releaseDate: '2026-11-19', coverUrl: 'https://media.rawg.io/a.jpg', wantAtRelease: true, hoursManual: 40, externalSource: 'rawg', externalId: '123', status: 'planned' });
    expect(f.roadmapSettings).toEqual({ year: 2026, hoursPerWeek: 8 });
    expect(JSON.stringify(f)).not.toMatch(/token|npsso|secret|password/i);
  });

  it('выгрузка проходит собственную валидацию (круг)', async () => {
    await seed();
    const f = await buildBackup(t.db, NOW);
    const p = parseBackup(JSON.parse(JSON.stringify(f)));
    expect(p.ok).toBe(true);
  });

  it('пустая БД: пустой, но валидный файл', async () => {
    const f = await buildBackup(t.db, NOW);
    expect(f.games).toEqual([]);
    expect(f.roadmapSettings).toBeNull();
    expect(parseBackup(f).ok).toBe(true);
  });

  // --- валидация формата
  it('parseBackup: чужой файл, версия, поля, дубли', async () => {
    await seed();
    const good = JSON.parse(JSON.stringify(await buildBackup(t.db, NOW))) as BackupFile;
    const clone = () => JSON.parse(JSON.stringify(good)) as BackupFile;
    expect(parseBackup(null)).toEqual({ ok: false, failure: { reason: 'invalid_format' } });
    expect(parseBackup([])).toEqual({ ok: false, failure: { reason: 'invalid_format' } });
    expect(parseBackup({ ...clone(), app: 'other' })).toEqual({ ok: false, failure: { reason: 'invalid_format', path: 'app' } });
    expect(parseBackup({ ...clone(), schemaVersion: 2 })).toEqual({ ok: false, failure: { reason: 'unsupported_version', got: 2 } });
    expect(parseBackup({ ...clone(), schemaVersion: '1' })).toMatchObject({ ok: false, failure: { reason: 'invalid_format', path: 'schemaVersion' } });
    const bad = (mutate: (f: BackupFile) => void) => { const f = clone(); mutate(f); return parseBackup(f); };
    expect(bad((f) => { f.games[0].status!.value = 'wat' as never; }).ok).toBe(false);
    expect(bad((f) => { f.games[0].status!.droppedAt = '2026-01-01T00:00:00.000Z'; }).ok).toBe(false); // дата dropped при completed
    expect(bad((f) => { f.games[0].durationOverrideHours = 0; }).ok).toBe(false);
    expect(bad((f) => { f.games[0].durationOverrideHours = 5000; }).ok).toBe(false);
    expect(bad((f) => { f.games[0].genresOverride = ['NOPE']; }).ok).toBe(false);
    expect(bad((f) => { f.games[0].monthExclusions = ['2026-13']; }).ok).toBe(false);
    expect(bad((f) => { f.games[0].hiddenAt = 'вчера'; }).ok).toBe(false);
    expect(bad((f) => { f.games[1].titleId = f.games[0].titleId; }).ok).toBe(false); // дубль titleId
    expect(bad((f) => { f.plannedGames[0].coverUrl = 'http://x/a.jpg'; }).ok).toBe(false);
    expect(bad((f) => { f.plannedGames[0].releaseDate = null; }).ok).toBe(false); // wantAtRelease без даты
    expect(bad((f) => { f.plannedGames[0].externalId = null; }).ok).toBe(false); // пара источник+id
    expect(bad((f) => { f.plannedGames[0].status = 'x' as never; }).ok).toBe(false);
    expect(bad((f) => { f.roadmapSettings = { year: 1999, hoursPerWeek: 8 }; }).ok).toBe(false);
    expect(bad((f) => { (f as { games: unknown }).games = 'x'; }).ok).toBe(false);
    const r = bad((f) => { f.games[0].roadmapPosition = -1; });
    expect(r).toMatchObject({ ok: false, failure: { reason: 'invalid_format', path: 'games.0.roadmapPosition' } });
  });

  // --- восстановление
  async function wipe() {
    await t.db.delete(gameStatus);
    await t.db.delete(roadmapOrder);
    await t.db.delete(roadmapExcluded);
    await t.db.delete(gameMonthExclusions);
    await t.db.delete(plannedGames);
    await t.db.delete(roadmapSettings);
    await t.db.update(games).set({ durationOverrideHours: null, genresOverride: null, hiddenAt: null });
  }
  const srt = <T,>(rows: T[]): T[] => [...rows].sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));
  const snapshot = async () => ({
    st: srt((await t.db.select().from(gameStatus)).map((s) => [s.gameId, s.status, s.completedAt?.toISOString() ?? null, s.droppedAt?.toISOString() ?? null, s.statusChangedAt.toISOString()])),
    g: srt((await t.db.select({ id: games.id, d: games.durationOverrideHours, ge: games.genresOverride, h: games.hiddenAt }).from(games)).map((x) => [x.id, x.d, x.ge, x.h?.toISOString() ?? null])),
    o: srt(await t.db.select().from(roadmapOrder).then((r) => r.map((x) => [x.gameId, x.position]))),
    ex: srt(await t.db.select().from(roadmapExcluded).then((r) => r.map((x) => x.gameId))),
    m: await t.db.select().from(gameMonthExclusions).then((r) => r.map((x) => `${x.gameId}|${x.month}`).sort()),
    p: srt(await t.db.select().from(plannedGames).then((r) => r.map((x) => [x.title, x.releaseDate, x.wantAtRelease, x.hoursManual, x.externalId, x.status]))),
    s: await t.db.select().from(roadmapSettings).then((r) => r.map((x) => [x.year, x.hoursPerWeek])),
  });

  it('круг: выгрузка -> очистка -> preview -> apply восстанавливает всё один в один', async () => {
    await seed();
    const before = await snapshot();
    const file = parseBackup(JSON.parse(JSON.stringify(await buildBackup(t.db, NOW)))) as { ok: true; value: BackupFile };
    await wipe();
    expect((await snapshot()).st).toEqual([]);

    const pre = await previewRestore(t.db, file.value);
    expect(pre.applied).toBe(false);
    expect(pre.sections.status).toEqual({ add: 3, change: 0, unchanged: 0, skipped: 0 });
    expect(pre.sections.duration.add).toBe(1);
    expect(pre.sections.genres.add).toBe(1);
    expect(pre.sections.hidden.add).toBe(1);
    expect(pre.sections.roadmapOrder.add).toBe(1);
    expect(pre.sections.roadmapExcluded.add).toBe(1);
    expect(pre.sections.monthExclusions.add).toBe(2);
    expect(pre.sections.plannedGames.add).toBe(2);
    expect(pre.sections.roadmapSettings.add).toBe(1);
    expect(pre.missing).toEqual([]);
    expect(pre.changesTruncated).toBe(false);
    expect(pre.changes[0]).toMatchObject({ section: 'status', kind: 'add' });
    // preview ничего не пишет
    expect((await snapshot()).st).toEqual([]);

    const res = await applyRestore(t.db, file.value, NOW);
    expect(res.applied).toBe(true);
    expect(res.sections.status.add).toBe(3);
    expect(res.backupId).toBeNull(); // статусов не было: копировать нечего
    expect(await snapshot()).toEqual(before);
  });

  it('идемпотентность: повторный apply даёт нули в add/change', async () => {
    await seed();
    const file = (parseBackup(await buildBackup(t.db, NOW)) as { ok: true; value: BackupFile }).value;
    await wipe();
    await applyRestore(t.db, file, NOW);
    const again = await applyRestore(t.db, file, NOW);
    for (const s of Object.values(again.sections)) expect([s.add, s.change]).toEqual([0, 0]);
    expect(again.sections.status.unchanged).toBe(3);
    expect(again.changes).toEqual([]);
  });

  it('N-2: порядок очереди после восстановления остаётся с уникальными позициями, игры вне файла идут после', async () => {
    const id = await seed(); // E: позиция 3
    const extra = await t.db.insert(games).values([{ titleId: 'X', name: 'X', category: 'ps4_game', lastSeenAt: NOW }, { titleId: 'Y', name: 'Y', category: 'ps4_game', lastSeenAt: NOW }]).returning({ id: games.id, titleId: games.titleId });
    const xid = extra.find((e) => e.titleId === 'X')!.id;
    const yid = extra.find((e) => e.titleId === 'Y')!.id;
    await t.db.delete(roadmapOrder);
    await t.db.insert(roadmapOrder).values([{ gameId: xid, position: 0 }, { gameId: yid, position: 1 }]);
    const file = (parseBackup({ app: BACKUP_APP, schemaVersion: 1, createdAt: NOW.toISOString(), games: [
      { titleId: 'A', name: 'A', status: null, durationOverrideHours: null, genresOverride: null, hiddenAt: null, roadmapPosition: 0, roadmapExcluded: false, monthExclusions: [] },
      { titleId: 'E', name: 'E', status: null, durationOverrideHours: null, genresOverride: null, hiddenAt: null, roadmapPosition: 1, roadmapExcluded: false, monthExclusions: [] },
    ], plannedGames: [], roadmapSettings: null }) as { ok: true; value: BackupFile }).value;
    const pre = await previewRestore(t.db, file);
    expect(pre.sections.roadmapOrder).toEqual({ add: 2, change: 0, unchanged: 0, skipped: 0 });
    await applyRestore(t.db, file, NOW);
    const rows = await t.db.select().from(roadmapOrder);
    const pos = new Map(rows.map((r) => [r.gameId, r.position]));
    expect(new Set(rows.map((r) => r.position)).size).toBe(rows.length); // уникальны
    expect([pos.get(id('A')), pos.get(id('E'))]).toEqual([0, 1]);
    expect(pos.get(xid)!).toBeLessThan(pos.get(yid)!); // относительный порядок сохранён
    expect(pos.get(xid)!).toBeGreaterThan(1);
    const again = await applyRestore(t.db, file, NOW);
    expect(again.sections.roadmapOrder).toMatchObject({ add: 0, change: 0 });
    expect(new Map((await t.db.select().from(roadmapOrder)).map((r) => [r.gameId, r.position]))).toEqual(pos); // идемпотентно
  });

  it('дубли roadmapPosition внутри файла: позиции в БД остаются уникальными, порядок файла сохраняется', async () => {
    const id = await seed();
    await t.db.delete(roadmapOrder);
    const g = (titleId: string, roadmapPosition: number | null) => ({ titleId, name: titleId, status: null, durationOverrideHours: null, genresOverride: null, hiddenAt: null, roadmapPosition, roadmapExcluded: false, monthExclusions: [] });
    const file = (parseBackup({ app: BACKUP_APP, schemaVersion: 1, createdAt: NOW.toISOString(), games: [g('A', 1), g('E', 1), g('ZZ_MISSING', 1), g('B', 2)], plannedGames: [], roadmapSettings: null }) as { ok: true; value: BackupFile }).value;
    const pre = await previewRestore(t.db, file);
    expect(pre.sections.roadmapOrder).toMatchObject({ add: 3, skipped: 1 });
    await applyRestore(t.db, file, NOW);
    const pos = new Map((await t.db.select().from(roadmapOrder)).map((r) => [r.gameId, r.position]));
    expect([pos.get(id('A')), pos.get(id('E')), pos.get(id('B'))]).toEqual([1, 2, 3]);
    const again = await applyRestore(t.db, file, NOW);
    expect(again.sections.roadmapOrder).toMatchObject({ add: 0, change: 0 });
  });

  it('N-5: дубли месяцев и планируемых игр внутри файла не завышают add и не создают копий', async () => {
    await seed();
    const file = (parseBackup(await buildBackup(t.db, NOW)) as { ok: true; value: BackupFile }).value;
    await wipe();
    file.games[0].monthExclusions = ['2026-03', '2026-03'];
    file.plannedGames = [...file.plannedGames, ...file.plannedGames];
    const pre = await previewRestore(t.db, file);
    expect(pre.sections.monthExclusions.add).toBe(1);
    expect(pre.sections.plannedGames.add).toBe(2);
    await applyRestore(t.db, file, NOW);
    expect(await t.db.select().from(plannedGames)).toHaveLength(2);
    const again = await applyRestore(t.db, file, NOW);
    expect([again.sections.plannedGames.add, again.sections.plannedGames.change, again.sections.monthExclusions.add]).toEqual([0, 0, 0]);
  });

  it('N-4: нарушение CHECK внутри транзакции распознаётся как ошибка данных, транзакция откатывается', async () => {
    await seed();
    const file = (parseBackup(await buildBackup(t.db, NOW)) as { ok: true; value: BackupFile }).value;
    await wipe();
    file.games[0].status = { value: 'completed', completedAt: null, droppedAt: '2026-01-01T00:00:00.000Z', statusChangedAt: NOW.toISOString() }; // в обход parse
    const err = await applyRestore(t.db, file, NOW).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(isDataError(err)).toBe(true);
    expect(isDataError(new Error('connection refused'))).toBe(false);
    expect(await t.db.select().from(gameStatus)).toEqual([]);
  });

  it('изменения: change показывает from/to, перед apply статусов делается копия в status_backups', async () => {
    const id = await seed();
    const file = (parseBackup(await buildBackup(t.db, NOW)) as { ok: true; value: BackupFile }).value;
    // «после копии» разметку испортили: статус другой, длительность другая, порядок другой
    await t.db.update(gameStatus).set({ status: 'backlog', completedAt: null }).where(eq(gameStatus.gameId, id('A')));
    await t.db.update(games).set({ durationOverrideHours: 99 }).where(eq(games.id, id('A')));
    await t.db.update(roadmapOrder).set({ position: 9 });
    const pre = await previewRestore(t.db, file);
    expect(pre.sections.status).toMatchObject({ change: 1, unchanged: 2 });
    expect(pre.changes.filter((c) => c.kind === 'change')).toEqual([
      { section: 'status', kind: 'change', titleId: 'A', name: 'Hades', from: 'backlog', to: 'completed' },
      { section: 'duration', kind: 'change', titleId: 'A', name: 'Hades', from: '99', to: '22.5' },
      { section: 'roadmapOrder', kind: 'change', titleId: 'E', name: 'Queue', from: '9', to: '3' },
    ]);
    expect(await t.db.select().from(statusBackups)).toEqual([]);
    const res = await applyRestore(t.db, file, NOW);
    expect(res.backupId).not.toBeNull();
    const [b] = await t.db.select().from(statusBackups);
    expect(b).toMatchObject({ id: res.backupId, reason: 'before_file_restore' });
    expect((b.payload as { gameId: number; status: string }[]).find((x) => x.gameId === id('A'))?.status).toBe('backlog'); // состояние ДО
    const [a] = await t.db.select().from(gameStatus).where(eq(gameStatus.gameId, id('A')));
    expect(a).toMatchObject({ status: 'completed' });
    expect(a.completedAt?.toISOString()).toBe('2026-03-02T19:10:00.000Z');
  });

  it('ничего не удаляет и пустое в файле не трогает: лишние данные БД остаются', async () => {
    const id = await seed();
    const file = (parseBackup(await buildBackup(t.db, NOW)) as { ok: true; value: BackupFile }).value;
    // в БД появилась разметка, которой нет в файле
    await t.db.insert(gameStatus).values({ gameId: id('D'), status: 'playing' });
    await t.db.update(games).set({ durationOverrideHours: 7 }).where(eq(games.id, id('D')));
    await t.db.insert(plannedGames).values({ title: 'Новая после копии', status: 'planned' });
    await t.db.insert(gameMonthExclusions).values({ gameId: id('B'), month: '2026-07' });
    // игра B в файле без длительности, а в БД длительность есть: остаётся
    await t.db.update(games).set({ durationOverrideHours: 4 }).where(eq(games.id, id('B')));
    await applyRestore(t.db, file, NOW);
    expect((await t.db.select().from(gameStatus).where(eq(gameStatus.gameId, id('D'))))[0].status).toBe('playing');
    expect((await t.db.select().from(games).where(eq(games.id, id('D'))))[0].durationOverrideHours).toBe(7);
    expect((await t.db.select().from(games).where(eq(games.id, id('B'))))[0].durationOverrideHours).toBe(4);
    expect((await t.db.select().from(plannedGames)).map((p) => p.title)).toContain('Новая после копии');
    expect((await t.db.select().from(gameMonthExclusions).where(eq(gameMonthExclusions.gameId, id('B')))).map((m) => m.month)).toEqual(['2026-07']);
  });

  it('скрытая игра остаётся скрытой с прежней датой (булево поведение)', async () => {
    const id = await seed();
    const file = (parseBackup(await buildBackup(t.db, NOW)) as { ok: true; value: BackupFile }).value;
    const when = new Date('2026-09-09T09:09:09Z');
    await t.db.update(games).set({ hiddenAt: when }).where(eq(games.id, id('C')));
    const pre = await previewRestore(t.db, file);
    expect(pre.sections.hidden).toEqual({ add: 0, change: 0, unchanged: 1, skipped: 0 });
    await applyRestore(t.db, file, NOW);
    expect((await t.db.select().from(games).where(eq(games.id, id('C'))))[0].hiddenAt?.toISOString()).toBe(when.toISOString());
  });

  it('игры, которых нет в БД: skipped и missing (до 50), остальное применяется', async () => {
    await seed();
    const file = (parseBackup(await buildBackup(t.db, NOW)) as { ok: true; value: BackupFile }).value;
    const extra = Array.from({ length: 60 }, (_, i) => ({ ...file.games[3], titleId: `GONE${i}`, name: `Gone ${i}` }));
    file.games.push(...extra);
    const pre = await previewRestore(t.db, file);
    expect(pre.sections.roadmapOrder.skipped).toBe(60);
    expect(pre.sections.status.skipped).toBe(60); // у E статус backlog есть
    expect(pre.missing).toHaveLength(50);
    expect(pre.missing[0]).toEqual({ titleId: 'GONE0', name: 'Gone 0' });
    const res = await applyRestore(t.db, file, NOW);
    expect(res.sections.roadmapOrder.skipped).toBe(60);
    expect((await t.db.select().from(games)).filter((g) => g.titleId.startsWith('GONE'))).toEqual([]);
  });

  it('список изменений обрезается на 100, счётчики полные', async () => {
    const rows = Array.from({ length: 130 }, (_, i) => ({ titleId: `X${i}`, name: `Game ${i}`, category: 'ps4_game', lastSeenAt: NOW }));
    await t.db.insert(games).values(rows);
    const file: BackupFile = {
      app: BACKUP_APP, schemaVersion: 1, createdAt: NOW.toISOString(), plannedGames: [], roadmapSettings: null,
      games: rows.map((r) => ({ titleId: r.titleId, name: r.name, status: { value: 'backlog', completedAt: null, droppedAt: null, statusChangedAt: NOW.toISOString() }, durationOverrideHours: null, genresOverride: null, hiddenAt: null, roadmapPosition: null, roadmapExcluded: false, monthExclusions: [] })),
    };
    const pre = await previewRestore(t.db, file);
    expect(pre.sections.status.add).toBe(130);
    expect(pre.changes).toHaveLength(100);
    expect(pre.changesTruncated).toBe(true);
  });

  it('планируемые: совпадение по externalId обновляет, по названию и дате тоже, пустые поля не затираются', async () => {
    await t.db.insert(plannedGames).values([
      { title: 'Old title', releaseDate: '2026-11-19', wantAtRelease: false, hoursManual: 55, externalSource: 'rawg', externalId: '123', status: 'planned', coverUrl: 'https://c/x.jpg' },
      { title: 'Manual One', status: 'planned', hoursManual: 12 },
    ]);
    const file: BackupFile = {
      app: BACKUP_APP, schemaVersion: 1, createdAt: NOW.toISOString(), games: [], roadmapSettings: null,
      plannedGames: [
        { title: 'GTA VI', releaseDate: '2026-11-19', coverUrl: null, wantAtRelease: true, hoursManual: null, externalSource: 'rawg', externalId: '123', status: 'planned' },
        { title: 'manual one', releaseDate: null, coverUrl: null, wantAtRelease: false, hoursManual: null, externalSource: null, externalId: null, status: 'done' },
      ],
    };
    const pre = await previewRestore(t.db, file);
    expect(pre.sections.plannedGames).toEqual({ add: 0, change: 2, unchanged: 0, skipped: 0 });
    await applyRestore(t.db, file, NOW);
    const all = await t.db.select().from(plannedGames);
    expect(all).toHaveLength(2);
    const g = all.find((p) => p.externalId === '123')!;
    expect(g).toMatchObject({ title: 'GTA VI', wantAtRelease: true, hoursManual: 55, coverUrl: 'https://c/x.jpg' });
    expect(all.find((p) => p.externalId === null)).toMatchObject({ status: 'done', hoursManual: 12 });
  });

  it('apply атомарен: ошибка посередине откатывает всё (в т.ч. копию статусов)', async () => {
    const id = await seed();
    const file = (parseBackup(await buildBackup(t.db, NOW)) as { ok: true; value: BackupFile }).value;
    await wipe();
    // нарушаем CHECK game_status уже после валидных операций (в обход parse)
    file.games[1].status = { value: 'completed', completedAt: null, droppedAt: '2026-01-01T00:00:00.000Z', statusChangedAt: NOW.toISOString() };
    await t.db.insert(gameStatus).values({ gameId: id('D'), status: 'playing' });
    const before = await snapshot();
    await expect(applyRestore(t.db, file, NOW)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
    expect(await t.db.select().from(statusBackups)).toEqual([]);
  });

  it('копии статусов: хранятся не больше BACKUPS_KEEP', async () => {
    const id = await seed();
    const file = (parseBackup(await buildBackup(t.db, NOW)) as { ok: true; value: BackupFile }).value;
    for (let i = 0; i < 12; i++) {
      await t.db.update(gameStatus).set({ status: 'shelved' }).where(eq(gameStatus.gameId, id('E')));
      await applyRestore(t.db, file, new Date(NOW.getTime() + i * 1000));
    }
    expect((await t.db.select().from(statusBackups)).length).toBe(10);
  });

  // --- Telegram и расписание
  it('sendTelegramDocument: multipart на sendDocument с файлом и подписью; ошибки глотаются без токена', async () => {
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    expect(await sendTelegramDocument({ name: 'b.json', content: '{"a":1}', caption: 'копия' }, { env: ENV, fetchImpl: f as unknown as typeof fetch })).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:SECRET-TOKEN/sendDocument');
    const form = init.body as FormData;
    expect(form.get('chat_id')).toBe('42');
    expect(form.get('caption')).toBe('копия');
    const doc = form.get('document') as File;
    expect(doc.name).toBe('b.json');
    expect(await doc.text()).toBe('{"a":1}');
    expect(await sendTelegramDocument({ name: 'b.json', content: '{}' }, { env: null })).toBe(false);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await sendTelegramDocument({ name: 'b.json', content: '{}' }, { env: ENV, fetchImpl: vi.fn(async () => { throw new Error('boom /bot123:SECRET-TOKEN/'); }) as unknown as typeof fetch })).toBe(false);
    expect(await sendTelegramDocument({ name: 'b.json', content: '{}' }, { env: ENV, fetchImpl: vi.fn(async () => new Response('', { status: 413 })) as unknown as typeof fetch })).toBe(false);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-TOKEN');
    spy.mockRestore();
  });

  it('isSundayMsk и isBackupDue: воскресенье МСК, догон через 8 суток, первый раз', () => {
    expect(isSundayMsk(new Date('2026-11-01T06:00:00Z'))).toBe(true);
    expect(isSundayMsk(new Date('2026-10-31T21:00:00Z'))).toBe(true); // 00:00 МСК воскресенья
    expect(isSundayMsk(new Date('2026-11-01T21:00:00Z'))).toBe(false); // уже понедельник МСК
    expect(isSundayMsk(NOW)).toBe(false);
    expect(isBackupDue(NOW, '2026-10-25')).toBe(false); // 4 суток
    expect(isBackupDue(NOW, '2026-10-21')).toBe(true); // 8 суток
    expect(isBackupDue(NOW, null)).toBe(true);
    expect(isBackupDue(SUNDAY, '2026-10-25')).toBe(true);
  });

  it('weekly: не по расписанию молчит; в воскресенье шлёт документ и пишет дедуп; повтор в тот же день не шлёт', async () => {
    await seed();
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const fi = f as unknown as typeof fetch;
    await t.db.insert(notifyLog).values({ kind: BACKUP_KIND, lastSentAt: new Date('2026-10-25T06:00:00Z'), sentOn: '2026-10-25' });
    expect(await runWeeklyBackup(t.db, { now: NOW, env: ENV, fetchImpl: fi })).toBe('not_due');
    expect(f).not.toHaveBeenCalled();
    expect(await runWeeklyBackup(t.db, { now: SUNDAY, env: ENV, fetchImpl: fi })).toBe('sent');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/sendDocument');
    const form = init.body as FormData;
    expect((form.get('document') as File).name).toBe('ps-tracker-backup-2026-11-01.json');
    expect(form.get('caption')).toBe('PS Tracker: резервная копия разметки, 4 игр');
    const sent = JSON.parse(await (form.get('document') as File).text()) as BackupFile;
    expect(parseBackup(sent).ok).toBe(true);
    expect((await t.db.select().from(notifyLog).where(eq(notifyLog.kind, BACKUP_KIND)))[0].sentOn).toBe('2026-11-01');
    expect(await runWeeklyBackup(t.db, { now: new Date('2026-11-01T18:00:00Z'), env: ENV, fetchImpl: fi })).toBe('already_sent');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('N-7: два параллельных запуска weekly шлют один файл', async () => {
    await seed();
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const fi = f as unknown as typeof fetch;
    const r = await Promise.all([runWeeklyBackup(t.db, { now: SUNDAY, env: ENV, fetchImpl: fi }), runWeeklyBackup(t.db, { now: SUNDAY, env: ENV, fetchImpl: fi })]);
    expect([...r].sort()).toEqual(['already_sent', 'sent']);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('weekly: нет Telegram, сбой отправки (дедуп не пишется), ошибка БД, догон после пропущенной недели', async () => {
    await seed();
    expect(await runWeeklyBackup(t.db, { now: SUNDAY, env: null })).toBe('telegram_disabled');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await runWeeklyBackup(t.db, { now: SUNDAY, env: ENV, fetchImpl: vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch })).toBe('send_failed');
    expect(await t.db.select().from(notifyLog)).toEqual([]);
    const db = Object.assign(Object.create(t.db), { select: () => { throw new Error('db down'); } });
    expect(await runWeeklyBackup(db, { now: SUNDAY, env: ENV })).toBe('error');
    spy.mockRestore();
    // воскресенье пропущено (Telegram лежал): через 8 суток после прошлой отправки шлём в любой день
    await t.db.insert(notifyLog).values({ kind: BACKUP_KIND, lastSentAt: new Date('2026-10-21T06:00:00Z'), sentOn: '2026-10-21' });
    expect(await runWeeklyBackup(t.db, { now: NOW, env: ENV, fetchImpl: vi.fn(async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch })).toBe('sent');
  });
});
