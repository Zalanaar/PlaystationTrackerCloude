// Эмуляция API профилей PSN (Фаза 41, контракт 41.3) для e2e: БД в e2e нет.
import type { Page, Route } from '@playwright/test';
import { mockApi, seed, type G, type Mock } from './collection-mock';
import { signedSession } from './session';

export type P = { id: number; isPrimary: boolean; onlineId: string; accessStatus: string; onboardedAt: string | null; canStartSync: boolean; gamesCount: number; lastSyncAt: string | null };
export type A = { id: number; onlineId: string; archivedAt: string; purgeAt: string };
export type ProfState = {
  active: number; profiles: P[]; archived: A[]; games: Record<number, G[]>; mock: Mock; calls: string[];
  addFail: { status: number; code: string; details?: unknown } | 'abort' | null; delFail: { status: number; code: string } | null;
  switchDelay: number; switchFail: { status: number; code: string } | null; nextId: number; bodies: Array<{ url: string; body: unknown }>;
};

const mk = (id: number, nick: string, o: Partial<P> = {}): P => ({
  id, isPrimary: id === 1, onlineId: nick, accessStatus: 'ok', onboardedAt: '2026-10-01T10:00:00.000Z', canStartSync: true, gamesCount: 5, lastSyncAt: '2026-10-31T05:00:00.000Z', ...o,
});
const SECOND_GAMES = (): G[] => [
  { ...seed()[0], id: 701, title: 'Только у второго', status: 'backlog', completedAt: null, lastPlayedAt: '2026-09-01T10:00:00.000Z', playSeconds: 3600 },
  { ...seed()[0], id: 702, title: 'Второй играет', status: 'playing', completedAt: null, lastPlayedAt: '2026-10-20T10:00:00.000Z', playSeconds: 7200 },
];

export async function setup(page: Page, baseURL: string, profiles: P[], extra: Partial<ProfState> = {}): Promise<ProfState> {
  await page.context().addCookies([{ name: 'pst_session', value: await signedSession({ uid: 1, role: 'owner' }), url: baseURL }]);
  const mock = await mockApi(page, seed());
  const s: ProfState = {
    active: 1, profiles, archived: [], games: { 1: seed(), 2: SECOND_GAMES(), 3: [] }, mock, calls: [], addFail: null, delFail: null,
    switchDelay: 0, switchFail: null, nextId: 10, bodies: [], ...extra,
  };
  const ok = (r: Route, data: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: true, data }) });
  const fail = (r: Route, status: number, code: string, details?: unknown) =>
    r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code, message: 'x', details } }) });

  await page.route('**/api/me/tour', (r) => ok(r, { version: 1, completedVersion: 1, shouldAutoStart: false }));
  await page.route('**/api/auth/me', (r) => ok(r, {
    id: s.active, loginId: 1, activeProfileId: s.active, email: 'a@example.com', displayName: null, role: 'owner', amr: 'google',
    profiles: s.profiles.map((p) => ({ id: p.id, onlineId: p.onlineId, isPrimary: p.isPrimary })),
  }));
  const applyActive = () => { s.mock.games = s.games[s.active] ?? []; };
  applyActive();

  await page.route(/\/api\/me\/profiles$/, async (r) => {
    const req = r.request();
    if (req.method() === 'GET') {
      s.calls.push('GET list');
      return ok(r, { loginId: 1, activeProfileId: s.active, limit: 3, canAdd: s.profiles.length < 3, profiles: s.profiles, archived: s.archived });
    }
    const body = req.postDataJSON() as { onlineId: string; activate?: boolean };
    s.bodies.push({ url: req.url(), body });
    s.calls.push(`POST add ${body.onlineId}`);
    if (s.addFail === 'abort') return r.abort('failed');
    if (s.addFail) return fail(r, s.addFail.status, s.addFail.code, s.addFail.details);
    const arch = s.archived.find((a) => a.onlineId.toLowerCase() === body.onlineId.toLowerCase());
    let prof: P;
    if (arch) {
      prof = mk(arch.id, arch.onlineId, { gamesCount: 7 });
      s.archived = s.archived.filter((a) => a.id !== arch.id);
    } else {
      prof = mk(s.nextId++, body.onlineId, { gamesCount: 0, lastSyncAt: null, onboardedAt: null });
      s.games[prof.id] = [];
    }
    s.profiles.push(prof);
    if (body.activate !== false) { s.active = prof.id; applyActive(); }
    return ok(r, { profile: prof, activeProfileId: s.active, ...(arch ? { restored: true } : {}) }, arch ? 200 : 201);
  });
  await page.route(/\/api\/me\/profiles\/active$/, async (r) => {
    const { profileId } = r.request().postDataJSON() as { profileId: number };
    s.calls.push(`POST active ${profileId}`);
    if (s.switchDelay) await new Promise((res) => setTimeout(res, s.switchDelay));
    if (s.switchFail) return fail(r, s.switchFail.status, s.switchFail.code);
    if (!s.profiles.some((p) => p.id === profileId)) return fail(r, 404, 'not_found');
    s.active = profileId;
    applyActive();
    return ok(r, { activeProfileId: profileId, profile: s.profiles.find((p) => p.id === profileId) });
  });
  await page.route(/\/api\/me\/profiles\/\d+$/, async (r) => {
    const id = Number(new URL(r.request().url()).pathname.split('/').pop());
    const body = r.request().postDataJSON() as { confirmOnlineId: string; purge?: boolean };
    s.bodies.push({ url: r.request().url(), body });
    s.calls.push(`DELETE ${id}${body.purge ? ' purge' : ''}`);
    if (s.delFail) return fail(r, s.delFail.status, s.delFail.code);
    const p = s.profiles.find((x) => x.id === id);
    const a = s.archived.find((x) => x.id === id);
    const target = p ?? a;
    if (!target) return fail(r, 404, 'not_found');
    if (p?.isPrimary) return fail(r, 409, 'primary_protected');
    if (target.onlineId.toLowerCase() !== body.confirmOnlineId.trim().toLowerCase()) return fail(r, 422, 'confirm_mismatch');
    if (p) {
      s.profiles = s.profiles.filter((x) => x.id !== id);
      if (!body.purge) s.archived.push({ id, onlineId: p.onlineId, archivedAt: '2026-11-01T10:00:00.000Z', purgeAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
    } else {
      s.archived = s.archived.filter((x) => x.id !== id);
    }
    if (s.active === id) { s.active = 1; applyActive(); }
    return ok(r, body.purge ? { purged: true, activeProfileId: s.active } : { archived: true, activeProfileId: s.active });
  });
  return s;
}

export const THREE = () => [mk(1, 'Artem_PS', { gamesCount: 214 }), mk(2, 'Second_Nick', { gamesCount: 12 }), mk(3, 'Third_Nick', { gamesCount: 0, lastSyncAt: null })];
export const TWO = () => [mk(1, 'Artem_PS', { gamesCount: 214 }), mk(2, 'Second_Nick', { gamesCount: 12 })];
export const ONE = () => [mk(1, 'Artem_PS', { gamesCount: 214 })];
