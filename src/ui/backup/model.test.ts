import { describe, expect, it } from 'vitest';
import { changeLine, changesText, MAX_BACKUP_BYTES, parseBackupFile, restoreErrorText, totalChanges } from './model';

describe('копия разметки (20.3)', () => {
  it('ошибки по details.reason по-русски', () => {
    expect(restoreErrorText(400, 'invalid_request', 'invalid_json')).toMatch(/не JSON/);
    expect(restoreErrorText(400, 'invalid_request', 'invalid_format')).toMatch(/не файл копии/);
    expect(restoreErrorText(400, 'invalid_request', 'unsupported_version')).toMatch(/версия/);
    expect(restoreErrorText(400, 'invalid_request', 'too_large')).toMatch(/5 МБ/);
    expect(restoreErrorText(503, 'db_unavailable', undefined)).toMatch(/База данных/);
    expect(restoreErrorText(0, 'network', undefined)).toMatch(/Нет связи/);
    expect(restoreErrorText(500, 'x', undefined)).toMatch(/Не удалось/);
  });
  it('parseBackupFile: JSON, мусор, размер', () => {
    expect(parseBackupFile('{"a":1}', 7)).toEqual({ ok: true, value: { a: 1 } });
    expect(parseBackupFile('нет', 3)).toMatchObject({ ok: false });
    expect(parseBackupFile('{}', MAX_BACKUP_BYTES + 1)).toMatchObject({ ok: false });
  });
  it('changeLine и счётчики', () => {
    expect(changeLine({ section: 'status', kind: 'change', from: 'backlog', to: 'completed' })).toBe('бэклог → пройдено');
    expect(changeLine({ section: 'status', kind: 'add', from: null, to: 'playing' })).toBe('играю');
    expect(changeLine({ section: 'duration', kind: 'change', from: '10', to: '22.5' })).toBe('10 ч → 22.5 ч');
    const c = { add: 1, change: 2, unchanged: 3, skipped: 4 };
    expect(totalChanges({ sections: { a: c, b: c } as never })).toBe(6);
    expect(changesText(1)).toBe('1 изменение');
    expect(changesText(2)).toBe('2 изменения');
    expect(changesText(5)).toBe('5 изменений');
  });
});
