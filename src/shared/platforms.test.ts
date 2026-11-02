import { describe, expect, it } from 'vitest';
import { clampPlatformLabel, isPlaystationName, platformOptions, PLATFORM_NONE } from './platforms';

describe('platformOptions', () => {
  it('сначала не PlayStation, затем PlayStation, в конце «Не указывать»', () => {
    const r = platformOptions(['PlayStation 5', 'PC', 'Xbox One', 'PlayStation 4', 'Nintendo Switch']);
    expect(r.options.map((o) => o.label)).toEqual(['PC', 'Xbox One', 'Nintendo Switch', 'PlayStation 5', 'PlayStation 4', 'Не указывать']);
    expect(r.options.at(-1)?.value).toBe(PLATFORM_NONE);
  });
  it('по умолчанию: единственная; иначе первая не PlayStation; иначе первая PlayStation', () => {
    expect(platformOptions(['Xbox One']).defaultValue).toBe('Xbox One');
    expect(platformOptions(['PlayStation 5', 'Xbox Series S/X', 'PC']).defaultValue).toBe('Xbox Series S/X');
    expect(platformOptions(['PlayStation 5', 'PlayStation 4']).defaultValue).toBe('PlayStation 5');
  });
  it('платформ нет: одна опция «Не указана»', () => {
    const r = platformOptions([]);
    expect(r.empty).toBe(true);
    expect(r.options).toEqual([{ value: '', label: 'Не указана' }]);
    expect(r.defaultValue).toBe('');
  });
  it('дубли и пустые отбрасываются, длинная подпись обрезается до 60', () => {
    const long = 'A'.repeat(80);
    const r = platformOptions(['PC', 'PC', '  ', long]);
    expect(r.options.map((o) => o.label)).toEqual(['PC', 'A'.repeat(60), 'Не указывать']);
  });
});

describe('clampPlatformLabel / isPlaystationName', () => {
  it('убирает < > и управляющие', () => {
    expect(clampPlatformLabel(' <b>PC</b>\n')).toBe('b PC /b');
  });
  it('распознаёт PlayStation', () => {
    expect(isPlaystationName('PlayStation 4')).toBe(true);
    expect(isPlaystationName('PS Vita')).toBe(true);
    expect(isPlaystationName('Xbox One')).toBe(false);
  });
});
