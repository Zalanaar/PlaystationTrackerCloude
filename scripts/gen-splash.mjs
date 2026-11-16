// Пакет 6, п. 8 + П11.5.2: заставки iOS (apple-touch-startup-image) для запуска PWA с экрана «Домой» без чёрного/белого экрана.
// Фон темы (SPLASH_THEME_BG = THEME_COLORS) и иконка по центру. Night — public/splash/, остальные темы — public/splash/<тема>/.
// Запуск: node scripts/gen-splash.mjs. Размеры: портрет iPhone (CSS-ширина × высота × DPR), список — SPLASH_SCREENS в src/shared/splash.ts.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SPLASH_SCREENS, SPLASH_THEME_BG, splashFile } from '../src/shared/splash.ts';

for (const [theme, bg] of Object.entries(SPLASH_THEME_BG)) {
  for (const s of SPLASH_SCREENS) {
    const w = s.w * s.dpr, h = s.h * s.dpr;
    const icon = Math.round(Math.min(w, h) * 0.28);
    const png = await sharp('public/icons/icon-maskable-512.png').resize(icon, icon).png().toBuffer();
    const file = `public/${splashFile(s, theme)}`;
    mkdirSync(dirname(file), { recursive: true });
    await sharp({ create: { width: w, height: h, channels: 3, background: bg } })
      .composite([{ input: png, left: Math.round((w - icon) / 2), top: Math.round((h - icon) / 2) }])
      .png({ compressionLevel: 9, palette: true })
      .toFile(file);
    console.log(file, w, h);
  }
}
