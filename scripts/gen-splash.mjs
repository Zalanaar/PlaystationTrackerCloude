// Пакет 6, п. 8: заставки iOS (apple-touch-startup-image) для запуска PWA с экрана «Домой» без белой вспышки.
// Фон Night (#0e0f16, как background_color манифеста) и иконка по центру. Запуск: node scripts/gen-splash.mjs
// Размеры: портрет iPhone (CSS-ширина × высота × DPR). Список должен совпадать с SPLASH_SCREENS в src/shared/splash.ts.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { SPLASH_SCREENS, splashFile } from '../src/shared/splash.ts';

const BG = '#0e0f16';
mkdirSync('public/splash', { recursive: true });
for (const s of SPLASH_SCREENS) {
  const w = s.w * s.dpr, h = s.h * s.dpr;
  const icon = Math.round(Math.min(w, h) * 0.28);
  const png = await sharp('public/icons/icon-maskable-512.png').resize(icon, icon).png().toBuffer();
  await sharp({ create: { width: w, height: h, channels: 3, background: BG } })
    .composite([{ input: png, left: Math.round((w - icon) / 2), top: Math.round((h - icon) / 2) }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(`public/${splashFile(s)}`);
  console.log(splashFile(s), w, h);
}
