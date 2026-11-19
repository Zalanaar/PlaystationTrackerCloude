import { describe, expect, it } from 'vitest';
import { playLabel } from './playLabel';

describe('playLabel (F23)', () => {
  it('запускалась — «Продолжить», нет — «Начать играть»', () => {
    expect(playLabel(3600)).toBe('Продолжить');
    expect(playLabel(0)).toBe('Начать играть');
    expect(playLabel(null)).toBe('Начать играть');
  });
});
