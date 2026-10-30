import { describe, expect, it, vi } from 'vitest';

// Выборка по пользователю возвращает null и для чужой, и для несуществующей игры: ответ обязан быть одинаковым.
const getGameDetails = vi.fn();
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: () => ({}) }));
vi.mock('@/server/collection/details', () => ({ getGameDetails: (...a: unknown[]) => getGameDetails(...a) }));

import { GET } from './route';

const get = (id: string) => GET(new Request(`http://x/api/games/${id}`), { params: Promise.resolve({ id }) });

describe('GET /api/games/{id}: 404 без утечки существования', () => {
  it('чужая и несуществующая игра дают побайтно одинаковый 404 (не 403)', async () => {
    getGameDetails.mockResolvedValue(null);
    const foreign = await get('5');
    const missing = await get('999999');
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
    const body = await (await get('7')).json();
    expect(body).toEqual({ ok: false, error: { code: 'not_found', message: 'Игра не найдена.' } });
  });
});
