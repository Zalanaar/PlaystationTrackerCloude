import { describe, expect, it, vi } from 'vitest';
import { Breaker, withFallback } from './fallback';
import { CatalogError, type CatalogCandidate } from './rawg';

const c = (id: string, catalog?: CatalogCandidate['catalog']): CatalogCandidate => ({
  externalSource: 'rawg', externalId: id, title: id, releaseDate: null, coverUrl: null, platforms: [], playstation: true, ...(catalog ? { catalog } : {}),
});
const fail = (reason: CatalogError['reason']) => vi.fn(async (): Promise<CatalogCandidate[]> => { throw new CatalogError(reason); });

describe('withFallback: RAWG главный, запасной — только при сбое', () => {
  it('RAWG ответил: запасной не вызывается', async () => {
    const fb = vi.fn(async () => ({ candidates: [c('ps-1', 'psstore')], catalog: 'psstore' as const }));
    expect(await withFallback(async () => [c('1')], fb)).toEqual({ candidates: [c('1')], catalog: 'rawg' });
    expect(fb).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'network', 'http_error', 'bad_response'] as const)('сбой RAWG (%s): выдача запасного', async (reason) => {
    const fb = vi.fn(async () => ({ candidates: [c('ps-1', 'psstore')], catalog: 'psstore' as const }));
    expect((await withFallback(fail(reason), fb)).catalog).toBe('psstore');
  });

  it.each(['rate_limited', 'no_key'] as const)('%s: не сбой каталога, ошибка RAWG как была', async (reason) => {
    const fb = vi.fn(async () => ({ candidates: [], catalog: 'psstore' as const }));
    await expect(withFallback(fail(reason), fb)).rejects.toMatchObject({ reason });
    expect(fb).not.toHaveBeenCalled();
  });

  it('запасной тоже упал: наружу причина RAWG; запасного нет: тоже', async () => {
    await expect(withFallback(fail('timeout'), async () => { throw new CatalogError('http_error'); })).rejects.toMatchObject({ reason: 'timeout' });
    await expect(withFallback(fail('network'), null)).rejects.toMatchObject({ reason: 'network' });
  });

  it('после сбоя RAWG пропускается до конца паузы, потом снова первый', async () => {
    let t = 1_000;
    const br = new Breaker(60_000);
    const fb = vi.fn(async () => ({ candidates: [c('ps-1', 'psstore')], catalog: 'psstore' as const }));
    const down = fail('timeout');
    await withFallback(down, fb, { breaker: br, now: () => t });
    expect(down).toHaveBeenCalledTimes(1);
    t += 30_000;
    const rawg = vi.fn(async () => [c('1')]);
    expect((await withFallback(rawg, fb, { breaker: br, now: () => t })).catalog).toBe('psstore');
    expect(rawg).not.toHaveBeenCalled();
    t += 31_000;
    expect((await withFallback(rawg, fb, { breaker: br, now: () => t })).catalog).toBe('rawg');
    expect(br.isDown(t)).toBe(false);
  });

  it('пауза идёт, но запасной упал: пробуем RAWG; запасной второй раз не зовём', async () => {
    const br = new Breaker(60_000);
    br.down(0);
    const fb = vi.fn(async () => { throw new CatalogError('network'); });
    expect((await withFallback(async () => [c('1')], fb, { breaker: br, now: () => 10 })).catalog).toBe('rawg');
    await expect(withFallback(fail('timeout'), fb, { breaker: (br.down(0), br), now: () => 10 })).rejects.toMatchObject({ reason: 'timeout' });
    expect(fb).toHaveBeenCalledTimes(2);
  });
});
