// Эмуляция API роадмапа (контракт §17) для e2e. Мини-планировщик: достаточно, чтобы порядок очереди двигал даты.
import type { Page, Route } from '@playwright/test';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (s: string) => Date.parse(`${s}T00:00:00Z`);

export type RmGame = { id: number; title: string; hours: number | null; source?: 'hltb' | 'manual' };
export type RmPlanned = {
  id: number; title: string; releaseDate: string | null; coverUrl: string | null; wantAtRelease: boolean; hoursManual: number | null;
  externalSource: 'rawg' | null; externalId: string | null; status: 'planned';
};
export type RmState = {
  year: number; today: string; hoursPerWeek: number | null; configured: boolean;
  order: number[]; games: RmGame[]; planned: RmPlanned[];
  /** принудительные ответы */
  roadmapFail: number | null; plannedFail: number | null; orderFail: boolean;
  catalog: { status: number; reason?: string; candidates?: unknown[] } | null;
  calls: { roadmap: number; settings: unknown[]; orders: number[][]; posts: Record<string, unknown>[]; patches: { id: number; body: Record<string, unknown> }[]; deletes: number[]; durations: { id: number; hours: number | null }[]; catalog: string[] };
};

export function baseState(over: Partial<RmState> = {}): RmState {
  return {
    year: 2026, today: '2026-10-29', hoursPerWeek: 10, configured: true,
    order: [1, 2, 3], games: [
      { id: 1, title: 'Хейдес', hours: 22, source: 'hltb' },
      { id: 2, title: 'Элден Ринг', hours: 40, source: 'hltb' },
      { id: 3, title: 'Год оф Вар', hours: 30, source: 'manual' },
      { id: 4, title: 'Игра без часов', hours: null },
    ],
    planned: [], roadmapFail: null, plannedFail: null, orderFail: false, catalog: null,
    calls: { roadmap: 0, settings: [], orders: [], posts: [], patches: [], deletes: [], durations: [], catalog: [] },
    ...over,
  };
}

function weeksOf(year: number, b: number) {
  const out: { index: number; from: string; to: string; days: number; capacityHours: number; plannedHours: number; items: { key: string; hours: number }[] }[] = [];
  const end = Date.UTC(year, 11, 31);
  let d = Date.UTC(year, 0, 1);
  let index = 1;
  while (d <= end) {
    const dow = (new Date(d).getUTCDay() + 6) % 7;
    const to = Math.min(d + (6 - dow) * DAY, end);
    const days = (to - d) / DAY + 1;
    out.push({ index: index++, from: iso(d), to: iso(to), days, capacityHours: Math.round(((b * days) / 7) * 10) / 10, plannedHours: 0, items: [] });
    d = to + DAY;
  }
  return out;
}
function monthsOf(year: number, b: number) {
  return Array.from({ length: 12 }, (_, m) => {
    const from = Date.UTC(year, m, 1);
    const to = Date.UTC(year, m + 1, 0);
    const days = (to - from) / DAY + 1;
    return { month: `${year}-${String(m + 1).padStart(2, '0')}`, from: iso(from), to: iso(to), days, capacityHours: Math.round(((b * days) / 7) * 10) / 10, plannedHours: 0, items: [] as { key: string; hours: number }[] };
  });
}

type Entry = { key: string; kind: 'release' | 'backlog' | 'planned'; gameId: number | null; plannedId: number | null; title: string; coverUrl: string | null; hours: number | null; hoursSource: 'manual' | 'hltb' | null; releaseDate: string | null; wantAtRelease: boolean };

export function buildRoadmap(s: RmState) {
  const b = s.hoursPerWeek ?? 0;
  const yearStart = `${s.year}-01-01`;
  const yearEnd = `${s.year}-12-31`;
  const weeks = weeksOf(s.year, b || 1);
  const months = monthsOf(s.year, b || 1);
  const items: Record<string, unknown>[] = [];
  const conflicts: Record<string, unknown>[] = [];
  const notFit: Record<string, unknown>[] = [];
  const needHours: Entry[] = [];
  const queue: { key: string; state: string }[] = [];
  const spread = (key: string, from: string, to: string, hours: number) => {
    const days = (ms(to) - ms(from)) / DAY + 1;
    for (const w of weeks) {
      const a = Math.max(ms(w.from), ms(from)); const z = Math.min(ms(w.to), ms(to));
      if (z >= a) { const h = Math.round(((hours * ((z - a) / DAY + 1)) / days) * 10) / 10; w.items.push({ key, hours: h }); w.plannedHours += h; }
    }
    for (const m of months) {
      const a = Math.max(ms(m.from), ms(from)); const z = Math.min(ms(m.to), ms(to));
      if (z >= a) { const h = Math.round(((hours * ((z - a) / DAY + 1)) / days) * 10) / 10; m.items.push({ key, hours: h }); m.plannedHours += h; }
    }
  };
  const seg = (from: string, to: string, hours: number) => ({ from, to, days: (ms(to) - ms(from)) / DAY + 1, hours });

  // релизы с галкой: жёстко по дате, пересечение = сдвиг и конфликт
  let busyUntil = ms(yearStart) - DAY;
  let lastKey: string | null = null;
  const rel = s.planned.filter((p) => p.wantAtRelease && p.releaseDate).sort((a, c) => (a.releaseDate as string).localeCompare(c.releaseDate as string));
  const relEntries = new Map<string, Entry>();
  for (const p of rel) {
    const key = `p:${p.id}`;
    const e: Entry = { key, kind: 'release', gameId: null, plannedId: p.id, title: p.title, coverUrl: p.coverUrl, hours: p.hoursManual, hoursSource: p.hoursManual ? 'manual' : null, releaseDate: p.releaseDate, wantAtRelease: true };
    relEntries.set(key, e);
    if (!p.hoursManual || b <= 0) { needHours.push(e); continue; }
    const days = 7 * Math.ceil(p.hoursManual / b);
    let start = Math.max(ms(p.releaseDate as string), ms(yearStart));
    const wanted = start;
    if (start <= busyUntil) start = busyUntil + DAY;
    if (start > ms(yearEnd)) { notFit.push({ ...e, reason: 'after_year_end', hoursShort: null }); continue; }
    const end = start + (days - 1) * DAY;
    busyUntil = end;
    const from = iso(start); const to = iso(Math.min(end, ms(yearEnd)));
    items.push({ ...e, start: from, end: to, days: seg(from, to, 0).days, shiftedDays: Math.round((start - wanted) / DAY), queuePosition: null, segments: [seg(from, to, p.hoursManual)] });
    spread(key, from, to, p.hoursManual);
    if (start > wanted && lastKey) conflicts.push({ reason: 'release_overlap', from: iso(wanted), to: iso(start - DAY), keys: [lastKey, key] });
    lastKey = key;
  }

  // очередь: бэклог по порядку, затем релизы без галки
  const q: Entry[] = [];
  const byId = new Map(s.games.map((g) => [g.id, g]));
  for (const id of s.order) {
    const g = byId.get(id);
    if (g) q.push({ key: `g:${g.id}`, kind: 'backlog', gameId: g.id, plannedId: null, title: g.title, coverUrl: null, hours: g.hours, hoursSource: g.hours ? (g.source ?? 'hltb') : null, releaseDate: null, wantAtRelease: false });
  }
  for (const g of s.games) if (!s.order.includes(g.id)) q.push({ key: `g:${g.id}`, kind: 'backlog', gameId: g.id, plannedId: null, title: g.title, coverUrl: null, hours: g.hours, hoursSource: g.hours ? (g.source ?? 'hltb') : null, releaseDate: null, wantAtRelease: false });
  for (const p of s.planned.filter((x) => !x.wantAtRelease)) q.push({ key: `p:${p.id}`, kind: 'planned', gameId: null, plannedId: p.id, title: p.title, coverUrl: p.coverUrl, hours: p.hoursManual, hoursSource: p.hoursManual ? 'manual' : null, releaseDate: p.releaseDate, wantAtRelease: false });
  let cursor = ms(yearStart);
  let pos = 0;
  for (const e of q) {
    pos++;
    if (!e.hours || b <= 0) { needHours.push(e); queue.push({ key: e.key, state: 'need_hours' }); continue; }
    const days = Math.ceil((7 * e.hours) / b);
    const end = cursor + (days - 1) * DAY;
    if (end > ms(yearEnd)) {
      const left = (ms(yearEnd) - cursor) / DAY + 1;
      notFit.push({ ...e, reason: 'no_capacity', hoursShort: Math.round((e.hours - (left * b) / 7) * 10) / 10 });
      queue.push({ key: e.key, state: 'not_fit' });
      continue;
    }
    const from = iso(cursor); const to = iso(end);
    items.push({ ...e, start: from, end: to, days, shiftedDays: 0, queuePosition: pos, segments: [seg(from, to, e.hours)] });
    spread(e.key, from, to, e.hours);
    queue.push({ key: e.key, state: 'scheduled' });
    cursor = end + DAY;
  }
  for (const w of weeks) w.plannedHours = Math.round(w.plannedHours * 10) / 10;
  for (const m of months) m.plannedHours = Math.round(m.plannedHours * 10) / 10;
  items.sort((a, c) => String(a.start).localeCompare(String(c.start)) || String(a.key).localeCompare(String(c.key)));
  const days = (ms(yearEnd) - ms(yearStart)) / DAY + 1;
  const planned = items.reduce((sum, i) => sum + (i.segments as { hours: number }[]).reduce((x, g) => x + g.hours, 0), 0);
  return {
    settings: { year: s.year, hoursPerWeek: s.hoursPerWeek, configured: s.configured },
    status: b > 0 ? 'ok' : 'no_budget', today: s.today, range: { from: yearStart, to: yearEnd, days },
    totals: { capacityHours: Math.round(((b * days) / 7) * 10) / 10, plannedHours: Math.round(planned * 10) / 10 },
    weeks, months, items, queue, conflicts, notFit, needHours,
    progress: b > 0 ? { status: 'behind', from: yearStart, asOf: '2026-10-28', plannedHours: 280.5, actualHours: 262, diffHours: -18.5, toleranceHours: 2, budgetHours: 390 } : null,
  };
}

const dto = (p: RmPlanned) => ({ ...p, createdAt: '2026-10-29T10:00:00.000Z', updatedAt: '2026-10-29T10:00:00.000Z' });

export async function mockRoadmap(page: Page, s: RmState): Promise<RmState> {
  const ok = (r: Route, data: unknown) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  const fail = (r: Route, status: number, code: string, details?: Record<string, unknown>) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message: 'x', ...(details ? { details } : {}) } }) });
  let nextId = Math.max(0, ...s.planned.map((p) => p.id)) + 1;

  await page.route(/\/api\/roadmap(\?|$)/, (r) => {
    s.calls.roadmap++;
    if (s.roadmapFail) return fail(r, s.roadmapFail, 'db_unavailable');
    return ok(r, buildRoadmap(s));
  });
  await page.route(/\/api\/roadmap\/settings$/, async (r) => {
    if (r.request().method() !== 'PUT') return ok(r, { settings: { year: s.year, hoursPerWeek: s.hoursPerWeek, configured: s.configured } });
    const body = r.request().postDataJSON() as { year: number; hoursPerWeek: number };
    s.calls.settings.push(body);
    s.year = body.year; s.hoursPerWeek = body.hoursPerWeek; s.configured = true;
    return ok(r, { settings: { year: s.year, hoursPerWeek: s.hoursPerWeek, configured: true } });
  });
  await page.route(/\/api\/roadmap\/planned(\?.*)?$/, async (r) => {
    if (r.request().method() === 'POST') {
      const body = r.request().postDataJSON() as Record<string, unknown>;
      s.calls.posts.push(body);
      const p: RmPlanned = {
        id: nextId++, title: String(body.title), releaseDate: (body.releaseDate as string | null) ?? null, coverUrl: (body.coverUrl as string | null) ?? null,
        wantAtRelease: Boolean(body.wantAtRelease), hoursManual: (body.hoursManual as number | null) ?? null,
        externalSource: (body.externalSource as 'rawg' | undefined) ?? null, externalId: (body.externalId as string | undefined) ?? null, status: 'planned',
      };
      s.planned.push(p);
      return ok(r, { planned: dto(p) });
    }
    if (s.plannedFail) return fail(r, s.plannedFail, 'db_unavailable');
    const sorted = [...s.planned].sort((a, c) => (a.releaseDate ?? '9999').localeCompare(c.releaseDate ?? '9999') || a.id - c.id);
    return ok(r, { planned: sorted.map(dto) });
  });
  await page.route(/\/api\/roadmap\/planned\/\d+$/, async (r) => {
    const id = Number(r.request().url().match(/planned\/(\d+)/)?.[1]);
    const p = s.planned.find((x) => x.id === id);
    if (!p) return fail(r, 404, 'not_found');
    if (r.request().method() === 'DELETE') { s.calls.deletes.push(id); s.planned = s.planned.filter((x) => x.id !== id); return ok(r, { deleted: true, id }); }
    const body = r.request().postDataJSON() as Partial<RmPlanned>;
    s.calls.patches.push({ id, body });
    Object.assign(p, body);
    return ok(r, { planned: dto(p) });
  });
  await page.route(/\/api\/roadmap\/order$/, async (r) => {
    const ids = (r.request().postDataJSON() as { gameIds: number[] }).gameIds;
    s.calls.orders.push(ids);
    if (s.orderFail) return fail(r, 503, 'db_unavailable');
    s.order = ids;
    return ok(r, { order: ids });
  });
  await page.route(/\/api\/roadmap\/catalog\/search/, async (r) => {
    s.calls.catalog.push(new URL(r.request().url()).searchParams.get('q') ?? '');
    const c = s.catalog;
    if (c && c.status !== 200) return fail(r, c.status, 'catalog_unavailable', { reason: c.reason ?? 'network' });
    return ok(r, { candidates: c?.candidates ?? [] });
  });
  await page.route(/\/api\/games\/\d+\/duration$/, async (r) => {
    const id = Number(r.request().url().match(/games\/(\d+)\/duration/)?.[1]);
    const hours = (r.request().postDataJSON() as { hours: number | null }).hours;
    s.calls.durations.push({ id, hours });
    const g = s.games.find((x) => x.id === id);
    if (g) { g.hours = hours; g.source = 'manual'; }
    return ok(r, { game: { id } });
  });
  return s;
}
