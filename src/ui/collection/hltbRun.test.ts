import { describe, expect, it, vi } from 'vitest';
import { HltbCallError, hltbEndMessage, hltbProgressText, runHltbLoop, type HltbRunBody, type HltbRunResponse } from './hltbRun';

const resp = (o: Partial<HltbRunResponse>): HltbRunResponse => ({
  processed: 0, found: 0, notFound: 0, failed: 0, remaining: 0, done: false, stopReason: 'budget', warnings: [], ...o,
});
const script = (...items: (HltbRunResponse | Error)[]) => {
  const calls: HltbRunBody[] = [];
  const run = vi.fn(async (b: HltbRunBody) => {
    calls.push(b);
    const n = items.shift();
    if (!n) throw new Error('script exhausted');
    if (n instanceof Error) throw n;
    return n;
  });
  return { run, calls };
};
const base = { recheckNotFound: false, since: '2026-10-28T10:00:00.000Z', shouldStop: () => false };

describe('runHltbLoop', () => {
  it('суммирует processed, remaining берёт из последнего ответа, прогресс после каждого вызова', async () => {
    const s = script(resp({ processed: 10, found: 8, notFound: 2, remaining: 15 }), resp({ processed: 5, found: 4, notFound: 1, failed: 1, remaining: 0, done: true, stopReason: 'complete' }));
    const progress: string[] = [];
    const r = await runHltbLoop({ ...base, run: s.run, onProgress: (t) => progress.push(hltbProgressText(t)) });
    expect(r.end).toEqual({ kind: 'complete' });
    expect(r.totals).toEqual({ processed: 15, found: 12, notFound: 3, failed: 1, remaining: 0, calls: 2 });
    expect(progress).toEqual(['Проверено 10, осталось 15', 'Проверено 15, осталось 0']);
  });

  it('без перепроверки тело пустое', async () => {
    const s = script(resp({ done: true, stopReason: 'complete' }));
    await runHltbLoop({ ...base, run: s.run });
    expect(s.calls).toEqual([{}]);
  });

  it('since фиксируется один раз и одинаков во всех вызовах', async () => {
    const s = script(resp({ processed: 1, remaining: 2 }), resp({ processed: 1, remaining: 1 }), resp({ processed: 1, remaining: 0, done: true, stopReason: 'complete' }));
    await runHltbLoop({ ...base, recheckNotFound: true, run: s.run });
    expect(s.calls).toHaveLength(3);
    for (const c of s.calls) expect(c).toEqual({ recheckNotFound: true, since: base.since });
  });

  it('остановка пользователем между вызовами', async () => {
    let stop = false;
    const s = script(resp({ processed: 3, remaining: 9 }), resp({ processed: 3, remaining: 6 }));
    const r = await runHltbLoop({ ...base, run: s.run, shouldStop: () => stop, onProgress: () => { stop = true; } });
    expect(r.end).toEqual({ kind: 'stopped' });
    expect(s.run).toHaveBeenCalledTimes(1);
    expect(r.totals.processed).toBe(3);
  });

  it('остановка до первого вызова не ходит в сеть', async () => {
    const s = script();
    const r = await runHltbLoop({ ...base, run: s.run, shouldStop: () => true });
    expect(r.end).toEqual({ kind: 'stopped' });
    expect(s.run).not.toHaveBeenCalled();
  });

  it('защитный лимит итераций', async () => {
    const run = vi.fn(async () => resp({ processed: 1, remaining: 100 }));
    const r = await runHltbLoop({ ...base, run, maxIterations: 5 });
    expect(run).toHaveBeenCalledTimes(5);
    expect(r.end).toEqual({ kind: 'limit' });
    expect(r.totals.processed).toBe(5);
    const d = vi.fn(async () => resp({ remaining: 100 }));
    await runHltbLoop({ ...base, run: d });
    expect(d).toHaveBeenCalledTimes(40);
  });

  it('409 и 503: цикл прерывается, накопленное сохраняется', async () => {
    const s = script(resp({ processed: 4, found: 4, remaining: 5 }), new HltbCallError(409, 'sync_in_progress'));
    const r = await runHltbLoop({ ...base, run: s.run });
    expect(r.end).toEqual({ kind: 'error', status: 409, code: 'sync_in_progress' });
    expect(r.totals.processed).toBe(4);
    expect(hltbEndMessage(r).text).toContain('Синк уже идёт, повторите позже.');
    const r2 = await runHltbLoop({ ...base, run: script(new HltbCallError(503, 'db_unavailable')).run });
    expect(hltbEndMessage(r2)).toEqual({ tone: 'error', text: 'База данных недоступна, повторите позже.' });
  });

  it('сетевая ошибка', async () => {
    const r = await runHltbLoop({ ...base, run: script(new Error('x')).run });
    expect(r.end).toEqual({ kind: 'error', status: 0, code: 'network' });
    expect(hltbEndMessage(r).tone).toBe('error');
  });

  it('done при remaining > 0 (errors/empty/no_time): остановка с причиной и предупреждения без дублей', async () => {
    const w = { code: 'hltb_failed', message: 'сбой' };
    const s = script(resp({ processed: 1, remaining: 5, warnings: [w] }), resp({ failed: 3, remaining: 4, done: true, stopReason: 'errors', warnings: [w] }));
    const r = await runHltbLoop({ ...base, run: s.run });
    expect(r.end).toEqual({ kind: 'halted', reason: 'errors' });
    expect(r.warnings).toEqual([w]);
    const m = hltbEndMessage(r);
    expect(m.tone).toBe('warn');
    expect(m.text).toContain('Остановлено: HLTB несколько раз подряд вернул ошибку');
    expect(m.text).toContain('Осталось 4, повторите позже');
    for (const reason of ['empty', 'no_time'] as const) {
      const x = await runHltbLoop({ ...base, run: script(resp({ remaining: 2, done: true, stopReason: reason })).run });
      expect(x.end).toEqual({ kind: 'halted', reason });
    }
  });

  it('complete с failed > 0 даёт предупреждение', async () => {
    const r = await runHltbLoop({ ...base, run: script(resp({ processed: 2, found: 1, notFound: 1, failed: 1, done: true, stopReason: 'complete' })).run });
    expect(hltbEndMessage(r)).toEqual({ tone: 'warn', text: 'Готово. Проверено 2: найдено 1, не найдено 1, ошибок 1.' });
  });
});
