// Пакет 6, п. 8: заставки iOS для PWA. Чистые данные без env/БД/сети: их читают layout (metadata) и scripts/gen-splash.mjs.
// w × h — CSS-размер экрана в портрете, dpr — плотность. Картинки лежат в public/splash/ (генерирует скрипт).

export type SplashScreen = { w: number; h: number; dpr: 2 | 3 };

export const SPLASH_SCREENS: readonly SplashScreen[] = [
  { w: 440, h: 956, dpr: 3 }, // 16 Pro Max
  { w: 402, h: 874, dpr: 3 }, // 16 Pro
  { w: 430, h: 932, dpr: 3 }, // 14 Pro Max, 15 Plus/Pro Max, 16 Plus
  { w: 393, h: 852, dpr: 3 }, // 14 Pro, 15, 15 Pro, 16
  { w: 428, h: 926, dpr: 3 }, // 12/13 Pro Max, 14 Plus
  { w: 390, h: 844, dpr: 3 }, // 12, 12 Pro, 13, 13 Pro, 14
  { w: 375, h: 812, dpr: 3 }, // X, XS, 11 Pro, 12/13 mini
  { w: 414, h: 896, dpr: 3 }, // XS Max, 11 Pro Max
  { w: 414, h: 896, dpr: 2 }, // XR, 11
  { w: 414, h: 736, dpr: 3 }, // 6+/7+/8 Plus
  { w: 375, h: 667, dpr: 2 }, // 6/7/8, SE 2/3
  { w: 320, h: 568, dpr: 2 }, // SE 1
];

/**
 * П11.5.2: фон заставки по теме (= THEME_COLORS, проверяет splash.test.ts). Night — файлы в корне public/splash (как раньше),
 * остальные темы — public/splash/<тема>/.
 */
export const SPLASH_THEME_BG = {
  night: '#0e0f16', graphite: '#111113', ps1: '#1c1c22', ps2: '#070b1a', ps3: '#10070b', ps4: '#02173d', ps5: '#0a0a0c',
} as const;
export type SplashTheme = keyof typeof SPLASH_THEME_BG;

export const splashFile = (s: SplashScreen, theme: SplashTheme = 'night'): string =>
  `splash/${theme === 'night' ? '' : `${theme}/`}iphone-${s.w * s.dpr}x${s.h * s.dpr}.png`;

/** media для <link rel="apple-touch-startup-image">: только портрет (PWA открывается в портрете). */
export const splashMedia = (s: SplashScreen): string =>
  `(device-width: ${s.w}px) and (device-height: ${s.h}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)`;

export const appleStartupImages = (theme: SplashTheme = 'night'): { url: string; media: string }[] =>
  SPLASH_SCREENS.map((s) => ({ url: `/${splashFile(s, theme)}`, media: splashMedia(s) }));
