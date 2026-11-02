// Эмуляция API Фазы 43 (docs/api-contract.md, 43.2-43.5) для e2e: БД в e2e недоступна.
import type { Page, Route } from '@playwright/test';

export type MGame = {
  id: number; source: 'manual'; kind: 'ps_backlog'; externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null;
  releaseDate: string | null; status: 'backlog'; notPurchased: boolean; matchSuggestion: null | { gameId: number; name: string; imageUrl: string | null };
  createdAt: string; updatedAt: string;
};
export type Cand = {
  externalSource: 'rawg'; externalId: string; title: string; releaseDate: string | null; coverUrl: string | null; platforms: string[]; playstation: boolean;
  duplicate: 'library' | 'planned' | null; inBacklog: boolean;
};
export type MMatch = { id: number; title: string; coverUrl: string | null; notPurchased: boolean; game: { gameId: number; name: string; imageUrl: string | null; lastPlayedAt: string | null; hours: number } };

export const mgame = (id: number, title: string, o: Partial<MGame> = {}): MGame => ({
  id, source: 'manual', kind: 'ps_backlog', externalSource: 'rawg', externalId: String(5000 + id), title, coverUrl: null, releaseDate: '2027-02-10',
  status: 'backlog', notPurchased: true, matchSuggestion: null, createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-01T10:00:00.000Z', ...o,
});
export const cand = (id: string, title: string, o: Partial<Cand> = {}): Cand => ({
  externalSource: 'rawg', externalId: id, title, releaseDate: '2026-12-05', coverUrl: null, platforms: ['PlayStation 5', 'PlayStation 4'], playstation: true,
  duplicate: null, inBacklog: false, ...o,
});

type Reply = { status: number; data?: unknown; error?: { code: string; message: string; details?: unknown } };

export type ManualMock = {
  items: MGame[];
  candidates: Cand[];
  /** Переопределение ответа поиска (ошибки) */
  searchReply: Reply | null;
  searchCalls: string[];
  addBodies: Record<string, unknown>[];
  /** Очередь ответов на POST /api/manual-games (иначе успех) */
  addReplies: Reply[];
  purchasedCalls: string[];
  removeCalls: number[];
  matches: MMatch[];
  matchCalls: { id: number; answer: string }[];
  matchFails: number;
  listCalls: string[];
  /** Ответ GET /api/manual-games (503 на старой схеме) */
  listReply: Reply | null;
  /** Фаза 43.1: запросы подсказок (mode=suggest) в порядке отправки */
  suggestCalls: string[];
  /** Переопределение ответа подсказок (429 suggest_limited / quota, ошибки) */
  suggestReply: Reply | null;
  /** Задержка ответа подсказок по запросу (мс, ключ = q в нижнем регистре) */
  suggestDelays: Record<string, number>;
  /** Запросы подсказок, прерванные клиентом */
  suggestAborted: string[];
  /** Тела POST /api/manual-games/batch */
  batchBodies: Record<string, unknown>[][];
  /** Очередь ответов на batch целиком (сбой запроса); иначе обработка по правилам ниже */
  batchReplies: Reply[];
  /** externalId, для которых batch отвечает duplicate, пока нет confirmDuplicate */
  batchDup: string[];
  /** externalId -> код ошибки элемента batch */
  batchFail: Record<string, 'manual_limit' | 'db_unavailable'>;
};

export async function mockManual(page: Page, init: Partial<ManualMock> = {}): Promise<ManualMock> {
  const m: ManualMock = {
    items: [], candidates: [], searchReply: null, searchCalls: [], addBodies: [], addReplies: [], purchasedCalls: [], removeCalls: [], matches: [], matchCalls: [],
    matchFails: 0, listCalls: [], listReply: null, suggestCalls: [], suggestReply: null, suggestDelays: {}, suggestAborted: [], batchBodies: [], batchReplies: [],
    batchDup: [], batchFail: {}, ...init,
  };
  const send = (route: Route, r: Reply) =>
    route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.status < 400 ? { ok: true, data: r.data } : { ok: false, error: r.error }) });
  const ok = (route: Route, data: unknown) => send(route, { status: 200, data });
  const find = (id: number) => m.items.find((x) => x.id === id);

  // порядок не важен: шаблоны не пересекаются
  await page.route(/\/api\/manual-games(\?[^/]*)?$/, async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      m.listCalls.push(req.url());
      if (m.listReply) return send(route, m.listReply);
      const nb = new URL(req.url()).searchParams.get('nb') === '1';
      return ok(route, { items: m.items.filter((x) => !nb || x.notPurchased) });
    }
    const body = req.postDataJSON() as Record<string, unknown>;
    m.addBodies.push(body);
    const queued = m.addReplies.shift();
    if (queued) return send(route, queued);
    const exists = m.items.find((x) => x.externalId === body.externalId);
    if (exists) return ok(route, { item: exists, created: false });
    const item = mgame(100 + m.items.length + 1, String(body.title), {
      externalId: String(body.externalId), coverUrl: (body.coverUrl as string | null) ?? null, releaseDate: (body.releaseDate as string | null) ?? null,
      notPurchased: body.notPurchased !== false,
    });
    m.items.unshift(item);
    return ok(route, { item, created: true });
  });
  await page.route(/\/api\/manual-games\/search\?/, async (route) => {
    const u = new URL(route.request().url());
    const q = u.searchParams.get('q') ?? '';
    const needle = q.toLowerCase();
    if (u.searchParams.get('mode') === 'suggest') {
      m.suggestCalls.push(q);
      const wait = m.suggestDelays[needle] ?? 0;
      if (wait) {
        // прерванный клиентом запрос не получает ответа: fulfill упадёт, это не ошибка теста
        try { await new Promise((r) => setTimeout(r, wait)); } catch { /* пусто */ }
      }
      if (m.suggestReply) return send(route, m.suggestReply).catch(() => { m.suggestAborted.push(q); });
      return ok(route, { candidates: m.candidates.filter((c) => c.title.toLowerCase().includes(needle)).slice(0, 8), cached: false }).catch(() => { m.suggestAborted.push(q); });
    }
    m.searchCalls.push(q);
    if (m.searchReply) return send(route, m.searchReply);
    return ok(route, { candidates: m.candidates.filter((c) => c.title.toLowerCase().includes(needle)), cached: false });
  });
  await page.route(/\/api\/manual-games\/batch$/, (route) => {
    const body = route.request().postDataJSON() as { items: Record<string, unknown>[] };
    m.batchBodies.push(body.items);
    const queued = m.batchReplies.shift();
    if (queued) return send(route, queued);
    const results = body.items.map((it, index) => {
      const externalId = String(it.externalId);
      if (m.batchFail[externalId]) return { index, externalId, status: 'error', code: m.batchFail[externalId] };
      if (m.batchDup.includes(externalId) && it.confirmDuplicate !== true) {
        return { index, externalId, status: 'duplicate', code: 'duplicate_game', details: { duplicate: 'library', game: { gameId: 1, name: `${String(it.title)} (PSN)`, imageUrl: null }, planned: null } };
      }
      const exists = m.items.find((x) => x.externalId === externalId);
      if (exists) return { index, externalId, status: 'exists', item: exists };
      const item = mgame(100 + m.items.length + 1, String(it.title), {
        externalId, coverUrl: (it.coverUrl as string | null) ?? null, releaseDate: (it.releaseDate as string | null) ?? null, notPurchased: it.notPurchased !== false,
      });
      m.items.unshift(item);
      return { index, externalId, status: 'created', item };
    });
    return ok(route, { results, created: results.filter((r) => r.status === 'created').length });
  });
  await page.route(/\/api\/manual-games\/matches$/, (route) => ok(route, { matches: m.matches }));
  await page.route(/\/api\/manual-games\/(\d+)\/match$/, (route) => {
    const id = Number(/manual-games\/(\d+)\//.exec(route.request().url())![1]);
    const body = route.request().postDataJSON() as { answer: string };
    m.matchCalls.push({ id, answer: body.answer });
    if (m.matchFails > 0) { m.matchFails--; return send(route, { status: 503, error: { code: 'db_unavailable', message: 'x' } }); }
    const at = m.matches.find((x) => x.id === id);
    if (!at) return send(route, { status: 404, error: { code: 'not_found', message: 'x' } });
    m.matches = m.matches.filter((x) => x.id !== id);
    if (body.answer === 'yes') m.items = m.items.filter((x) => x.id !== id);
    return ok(route, { id, answer: body.answer, linked: body.answer === 'yes' ? { gameId: at.game.gameId, name: at.game.name, imageUrl: null } : null });
  });
  await page.route(/\/api\/manual-games\/(\d+)\/purchased$/, (route) => {
    const req = route.request();
    const id = Number(/manual-games\/(\d+)\//.exec(req.url())![1]);
    m.purchasedCalls.push(`${req.method()} ${id}`);
    const it = find(id);
    if (!it) return send(route, { status: 404, error: { code: 'not_found', message: 'x' } });
    it.notPurchased = req.method() === 'DELETE';
    return ok(route, { item: it });
  });
  await page.route(/\/api\/manual-games\/(\d+)$/, (route) => {
    const id = Number(/manual-games\/(\d+)$/.exec(route.request().url())![1]);
    m.removeCalls.push(id);
    const had = !!find(id);
    m.items = m.items.filter((x) => x.id !== id);
    return ok(route, { id, removed: had });
  });
  return m;
}
