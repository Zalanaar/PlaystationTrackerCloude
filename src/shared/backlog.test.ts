import { describe, expect, it } from 'vitest';
import { backlogManualText, backlogTotalText, recommendPoolText, roadmapBacklogText } from './backlog';

describe('Фаза 48: подписи единого бэклога', () => {
  it('число бэклога', () => {
    expect(backlogTotalText(64)).toBe('64 игры в бэклоге');
    expect(backlogTotalText(1)).toBe('1 игра в бэклоге');
    expect(backlogTotalText(11)).toBe('11 игр в бэклоге');
  });
  it('записи вручную идут сверх числа', () => {
    expect(backlogManualText(0, 0)).toBe('');
    expect(backlogManualText(5, 3)).toBe('ещё 5 записей вручную, из них 3 не куплено');
    expect(backlogManualText(2, 0)).toBe('ещё 2 записи вручную');
  });
  it('Подскажи: разница с бэклогом подписана', () => {
    expect(recommendPoolText(61, 64)).toBe('Из 61 игры бэклога по твоей истории · ещё 3 скрыты через «Не предлагать»');
    expect(recommendPoolText(64, 64)).toBe('Из 64 игр бэклога по твоей истории');
    expect(recommendPoolText(37, undefined)).toBe('Из 37 игр бэклога по твоей истории');
  });
  it('План: очередь от того же числа', () => {
    expect(roadmapBacklogText(64, 8)).toBe('64 игры в бэклоге: 56 в очереди, 8 убрано из плана');
    expect(roadmapBacklogText(64, 0)).toBe('64 игры в бэклоге: 64 в очереди');
    expect(roadmapBacklogText(undefined, 3)).toBe('');
  });
});
