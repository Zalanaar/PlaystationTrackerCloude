import { describe, expect, it } from 'vitest';
import { mapLimit } from './limit';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('mapLimit', () => {
  it('не больше limit задач одновременно, порядок сохраняется', async () => {
    let active = 0;
    let peak = 0;
    const r = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 5, async (x) => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return x * 2;
    });
    expect(peak).toBe(5);
    expect(r.ok.map((o) => o.value)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
    expect(r.failed).toEqual([]);
  });
  it('ошибки собираются отдельно и не прерывают остальные', async () => {
    const r = await mapLimit([1, 2, 3, 4], 2, async (x) => {
      await tick();
      if (x % 2 === 0) throw new Error(`bad ${x}`);
      return x;
    });
    expect(r.ok.map((o) => o.item)).toEqual([1, 3]);
    expect(r.failed.map((f) => f.item)).toEqual([2, 4]);
  });
  it('пустой вход и некорректный limit', async () => {
    expect(await mapLimit([], 5, async () => 1)).toEqual({ ok: [], failed: [] });
    expect((await mapLimit([1, 2], 0, async (x) => x)).ok).toHaveLength(2);
  });
});
