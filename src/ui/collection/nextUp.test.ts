import { describe, expect, it } from 'vitest';
import type { PlanItem } from '@/server/roadmap/types';
import { pickNextUp } from './nextUp';

const it_ = (key: string, start: string, end: string, o: Partial<PlanItem> = {}): PlanItem => ({
  key, kind: 'backlog', gameId: Number(key.slice(2)), plannedId: null, title: `T${key}`, coverUrl: null, hours: 10, hoursSource: 'hltb', releaseDate: null, wantAtRelease: false,
  start, end, days: 7, shiftedDays: 0, queuePosition: 0, segments: [], ...o,
});
const plan = (items: PlanItem[], status: 'ok' | 'no_budget' = 'ok') => ({ status, items, today: '2026-11-03' });
const all = () => true;

describe('pickNextUp', () => {
  it('первая незавершённая игра бэклога по дате и следующая запись', () => {
    const r = pickNextUp(plan([it_('g:2', '2026-11-10', '2026-11-12'), it_('g:1', '2026-11-01', '2026-11-07'), it_('g:9', '2026-10-01', '2026-10-20')]), all);
    expect(r).toEqual({ gameId: 1, from: '2026-11-01', to: '2026-11-07', then: { title: 'Tg:2', from: '2026-11-10', to: '2026-11-12' } });
  });
  it('релиз первым: CTA только для игры бэклога, релиз может быть «затем»', () => {
    const rel = it_('p:5', '2026-11-03', '2026-11-05', { kind: 'release', gameId: null, plannedId: 5, title: 'Релиз' });
    const r = pickNextUp(plan([rel, it_('g:1', '2026-11-06', '2026-11-09'), it_('p:6', '2026-11-10', '2026-11-11', { kind: 'planned', gameId: null, title: 'Хочу' })]), all);
    expect(r?.gameId).toBe(1);
    expect(r?.then?.title).toBe('Хочу');
  });
  it('игры нет в загруженном списке: берётся следующая', () => {
    const r = pickNextUp(plan([it_('g:1', '2026-11-01', '2026-11-07'), it_('g:2', '2026-11-08', '2026-11-12')]), (id) => id !== 1);
    expect(r?.gameId).toBe(2);
    expect(r?.then).toBeNull();
  });
  it('нет плана, нет бюджета, пусто: null', () => {
    expect(pickNextUp(null, all)).toBeNull();
    expect(pickNextUp(plan([it_('g:1', '2026-11-01', '2026-11-07')], 'no_budget'), all)).toBeNull();
    expect(pickNextUp(plan([]), all)).toBeNull();
    expect(pickNextUp(plan([it_('g:1', '2026-10-01', '2026-11-02')]), all)).toBeNull();
  });
});
