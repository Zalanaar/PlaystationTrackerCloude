import { describe, expect, it } from 'vitest';
import { themeInitScript } from './theme-script';

describe('themeInitScript', () => {
  it('читает ключ ps-theme и знает все атрибуты тем', () => {
    expect(themeInitScript).toContain('ps-theme');
    expect(themeInitScript).toContain('graphite');
    expect(themeInitScript).not.toContain('"night"]');
  });
});
