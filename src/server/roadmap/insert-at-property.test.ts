import { describe, expect, it } from 'vitest';
import { buildPlan, MAX_INSERT_PROBES } from './plan';
import type { RoadmapEntry } from './types';
import { orderWithAtPosition } from '@/ui/roadmap/model';

// QA 7 багов: сверка insertAt с перебором всех позиций на случайных входах (включая релизы с жёсткими окнами и игры без часов).
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const bl = (id: number, hours: number | null): RoadmapEntry => ({
  key: `g:${id}`, kind: 'backlog', gameId: id, plannedId: null, title: `B${id}`, coverUrl: null, hours,
  hoursSource: hours === null ? null : 'hltb', releaseDate: null, wantAtRelease: false,
});
const rel = (id: number, date: string, hours: number | null): RoadmapEntry => ({
  key: `p:${id}`, kind: 'release', gameId: null, plannedId: id, title: `R${id}`, coverUrl: null, hours,
  hoursSource: hours === null ? null : 'manual', releaseDate: date, wantAtRelease: true,
});
const day = () => `2026-${String(ri(1, 12)).padStart(2, '0')}-${String(ri(1, 28)).padStart(2, '0')}`;

describe('QA: insertAt против перебора', () => {
  it('случайные входы: insertAt = самая поздняя влезающая позиция; порядок frontend даёт тот же результат', () => {
    let checked = 0;
    for (let it = 0; it < 400; it++) {
      const n = ri(2, 9);
      const backlog = Array.from({ length: n }, (_, i) => bl(i + 1, rnd() < 0.15 ? null : ri(5, 380)));
      const planned = Array.from({ length: ri(0, 3) }, (_, i) => rel(i + 1, day(), rnd() < 0.2 ? null : ri(5, 200)));
      const hpw = [5, 10, 20][ri(0, 2)];
      const input = { year: 2026, hoursPerWeek: hpw, backlog, planned };
      const p = buildPlan(input);
      for (const nf of p.notFit.filter((x) => x.kind === 'backlog' && x.reason === 'no_capacity')) {
        const keys = backlog.map((b) => b.key);
        let best: number | null = null;
        for (let at = 1; at <= n; at++) {
          const ord = orderWithAtPosition(keys, nf.key, at);
          const pl = buildPlan({ ...input, backlog: ord.map((k) => backlog.find((b) => b.key === k) as RoadmapEntry) });
          if (pl.items.some((i) => i.key === nf.key)) best = at;
        }
        expect(nf.insertAt, JSON.stringify(input)).toBe(best);
        if (best !== null) {
          const ord = orderWithAtPosition(keys, nf.key, best);
          const pl = buildPlan({ ...input, backlog: ord.map((k) => backlog.find((b) => b.key === k) as RoadmapEntry) });
          const was = new Set(p.items.map((i) => i.key));
          const now = new Set(pl.items.map((i) => i.key));
          const displaced = [...was].filter((k) => !now.has(k));
          expect(nf.displacesAtInsert).toBe(displaced.length);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
  it('лимит проб: хвост получает null, а не ложное значение', () => {
    const backlog = Array.from({ length: 150 }, (_, i) => bl(i + 1, 300));
    const p = buildPlan({ year: 2026, hoursPerWeek: 10, backlog, planned: [] });
    const withInsert = p.notFit.filter((n) => typeof n.insertAt === 'number').length;
    expect(withInsert).toBeLessThanOrEqual(MAX_INSERT_PROBES);
    for (const n of p.notFit) if (n.insertAt === null && n.displacesAtInsert === null) expect(n.displacedTitles).toBeNull();
  });
});
