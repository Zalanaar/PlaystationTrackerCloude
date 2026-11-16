// П11.5.2: цвета манифеста и заставок iOS по теме совпадают с THEME_COLORS; ссылка и разбор ?theme=.
import { describe, expect, it } from 'vitest';
import { THEME_COLORS, THEMES } from '@/ui/tokens';
import { buildManifest, manifestHref, manifestTheme } from './manifest';
import { appleStartupImages, SPLASH_SCREENS, SPLASH_THEME_BG, splashFile } from './splash';

describe('П11.5.2 манифест и заставки по теме', () => {
  it('фон заставок = THEME_COLORS для всех тем', () => {
    expect(SPLASH_THEME_BG).toEqual(THEME_COLORS);
    expect(Object.keys(SPLASH_THEME_BG).sort()).toEqual(THEMES.map((t) => t.id).sort());
  });
  it('манифест: цвета темы, Night по умолчанию', () => {
    expect(buildManifest()).toMatchObject({ background_color: '#0e0f16', theme_color: '#0e0f16', id: '/', display: 'standalone' });
    expect(buildManifest('ps4')).toMatchObject({ background_color: '#02173d', theme_color: '#02173d' });
  });
  it('ссылка и разбор ?theme=', () => {
    expect(manifestHref('night')).toBe('/manifest.webmanifest');
    expect(manifestHref('ps3')).toBe('/manifest.webmanifest?theme=ps3');
    expect(manifestTheme('ps3')).toBe('ps3');
    for (const bad of [null, '', 'toString', '__proto__', 'activity', 'PS3']) expect(manifestTheme(bad)).toBe('night');
  });
  it('заставки: Night в корне, остальные темы в папке темы', () => {
    expect(splashFile(SPLASH_SCREENS[5])).toBe('splash/iphone-1170x2532.png');
    expect(splashFile(SPLASH_SCREENS[5], 'ps2')).toBe('splash/ps2/iphone-1170x2532.png');
    expect(appleStartupImages('graphite').every((x) => x.url.startsWith('/splash/graphite/'))).toBe(true);
    expect(appleStartupImages()).toHaveLength(12);
  });
});
