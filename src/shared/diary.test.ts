import { describe, expect, it } from 'vitest';
import { DIARY_NOTE_MAX, parseDiaryBody } from './diary';

describe('разбор заметки дневника', () => {
  it('нормализует, отвергает пустую и слишком длинную', () => {
    expect(parseDiaryBody({ body: '  Привет \n' })).toEqual({ ok: true, text: 'Привет' });
    expect(parseDiaryBody({ body: '   ' }).ok).toBe(false);
    expect(parseDiaryBody({ body: 'x'.repeat(DIARY_NOTE_MAX + 1) }).ok).toBe(false);
    expect(parseDiaryBody({ body: 'x'.repeat(DIARY_NOTE_MAX) }).ok).toBe(true);
    expect(parseDiaryBody({})).toMatchObject({ ok: false });
  });
});
