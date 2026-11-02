// Эмуляция API Фазы 44 (docs/api-contract.md, 44.2-44.3) для e2e: БД в e2e недоступна.
import type { Page, Route } from '@playwright/test';

export type OP = {
  id: number; source: 'manual'; kind: 'other_platform'; externalSource: 'rawg'; externalId: string; title: string; coverUrl: string | null;
  releaseDate: string | null; platformLabel: string | null; createdAt: string;
};
export type OCand = {
  externalSource: 'rawg'; externalId: string; title: string; releaseDate: string | null; coverUrl: string | null; platforms: string[]; playstation: boolean;
  duplicate: 'library' | 'planned' | null; inBacklog: boolean; inList: boolean;
};
type Reply = { status: number; data?: unknown; error?: { code: string; message: string; details?: unknown } };

export const op = (id: number, title: string, o: Partial<OP> = {}): OP => ({
  id, source: 'manual', kind: 'other_platform', externalSource: 'rawg', externalId: String(7000 + id), title, coverUrl: null, releaseDate: '2020-05-01',
  platformLabel: 'Xbox One', createdAt: new Date(Date.UTC(2026, 10, 3, 12, 0, 0) - id * 60_000).toISOString(), ...o,
});
export const ocand = (id: string, title: string, o: Partial<OCand> = {}): OCand => ({
  externalSource: 'rawg', externalId: id, title, releaseDate: '2020-09-17', coverUrl: null, platforms: ['PlayStation 4', 'Xbox One', 'PC'], playstation: true,
  duplicate: null, inBacklog: false, inList: false, ...o,
});

export type OPMock = {
  items: OP[];
  candidates: OCand[];
  listReply: Reply | null;
  /** Задержка ответа списка, мс */
  listDelay: number;
  searchReply: Reply | null;
  searchUrls: string[];
  addBodies: Record<string, unknown>[];
  addReplies: Reply[];
  removeCalls: number[];
  /** Очередь ответов на DELETE (иначе успех) */
  removeReplies: Reply[];
  /** externalId, для которых POST отвечает duplicate_game, пока нет confirmDuplicate */
  dup: string[];
  listCalls: number;
};

export async function mockOtherPlatforms(page: Page, init: Partial<OPMock> = {}): Promise<OPMock> {
  const m: OPMock = {
    items: [], candidates: [], listReply: null, listDelay: 0, searchReply: null, searchUrls: [], addBodies: [], addReplies: [], removeCalls: [], removeReplies: [],
    dup: [], listCalls: 0, ...init,
  };
  let seq = 0;
  const send = (route: Route, r: Reply) =>
    route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.status < 400 ? { ok: true, data: r.data } : { ok: false, error: r.error }) });
  const ok = (route: Route, data: unknown) => send(route, { status: 200, data });

  await page.route(/\/api\/manual-games(\?[^/]*)?$/, async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      if (new URL(req.url()).searchParams.get('kind') !== 'other_platform') return ok(route, { items: [] });
      m.listCalls++;
      if (m.listDelay) await new Promise((r) => setTimeout(r, m.listDelay));
      if (m.listReply) return send(route, m.listReply);
      return ok(route, { items: [...m.items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) });
    }
    const body = req.postDataJSON() as Record<string, unknown>;
    m.addBodies.push(body);
    const queued = m.addReplies.shift();
    if (queued) return send(route, queued);
    const exists = m.items.find((x) => x.externalId === body.externalId);
    if (exists) return ok(route, { item: exists, created: false });
    if (m.dup.includes(String(body.externalId)) && body.confirmDuplicate !== true) {
      return send(route, { status: 409, error: { code: 'duplicate_game', message: 'x', details: { duplicate: 'library', game: { gameId: 1, name: `${String(body.title)} (PSN)`, imageUrl: null }, planned: null } } });
    }
    const maxId = Math.max(1000, ...m.items.map((x) => x.id));
    const item: OP = {
      id: maxId + 1, source: 'manual', kind: 'other_platform', externalSource: 'rawg', externalId: String(body.externalId), title: String(body.title),
      coverUrl: (body.coverUrl as string | null) ?? null, releaseDate: (body.releaseDate as string | null) ?? null,
      platformLabel: (body.platformLabel as string | null | undefined) ?? null, createdAt: new Date(Date.UTC(2030, 0, 1) + (seq += 1) * 1000).toISOString(),
    };
    m.items.unshift(item);
    return ok(route, { item, created: true });
  });
  await page.route(/\/api\/manual-games\/search\?/, (route) => {
    const u = new URL(route.request().url());
    m.searchUrls.push(u.search);
    if (m.searchReply) return send(route, m.searchReply);
    const needle = (u.searchParams.get('q') ?? '').toLowerCase();
    return ok(route, {
      candidates: m.candidates.filter((c) => c.title.toLowerCase().includes(needle)).map((c) => ({ ...c, inList: c.inList || m.items.some((x) => x.externalId === c.externalId) })),
      cached: false,
    });
  });
  await page.route(/\/api\/manual-games\/(\d+)$/, (route) => {
    const id = Number(/manual-games\/(\d+)$/.exec(route.request().url())![1]);
    m.removeCalls.push(id);
    const queued = m.removeReplies.shift();
    if (queued) return send(route, queued);
    const had = m.items.some((x) => x.id === id);
    m.items = m.items.filter((x) => x.id !== id);
    return ok(route, { id, removed: had });
  });
  return m;
}
