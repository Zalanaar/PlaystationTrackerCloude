import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/server/collection/mutations';

const getGameGuide = vi.fn();
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => ({}) }));
vi.mock('@/server/guides/game-guide', async (orig) => ({ ...(await orig<typeof import('@/server/guides/game-guide')>()), getGameGuide: (...a: unknown[]) => getGameGuide(...a) }));
vi.mock('@/server/auth/require-user', async () => (await import('@/server/auth/test-require-user')).requireUserMock);

import { GET } from './route';

const get = (id: string) => GET(new Request(`http://x/api/games/${id}/guide`), { params: Promise.resolve({ id }) });

describe('GET /api/games/{id}/guide', () => {
  it('отдаёт гайд; чужая/нет игры — одинаковый 404; плохой id — 400; сбой БД — 503', async () => {
    getGameGuide.mockResolvedValue({ match: null, override: null, dismissed: false });
    const ok = await get('8');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, data: { guide: { match: null, override: null, dismissed: false } } });

    getGameGuide.mockRejectedValue(new NotFoundError());
    const foreign = await get('5');
    const missing = await get('999999');
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());

    expect((await get('abc')).status).toBe(400);
    getGameGuide.mockRejectedValue(new Error('db'));
    expect((await get('8')).status).toBe(503);
  });
});
