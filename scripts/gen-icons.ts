// Генерация растровых иконок из монограммы PS (docs/design-system.md §8.5). Запуск: npx tsx scripts/gen-icons.ts
// Цвета фиксированные (Night), шрифты не нужны: буквы нарисованы штрихами.
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const BG = '#0e0f16';
const glyphs = (transform = '') => `
  <g${transform ? ` transform="${transform}"` : ''} fill="none" stroke-width="44" stroke-linejoin="round">
    <path d="M104 398V136h64a64 64 0 0 1 0 128h-64" stroke="#eef0fa"/>
    <path d="M408 196a60 60 0 1 0-60 60a60 60 0 1 1-60 60" stroke="#b99cff"/>
  </g>`;
const svg = (bg: string, g: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${g}</svg>`;
const rounded = svg(`<rect width="512" height="512" rx="112" fill="${BG}"/>`, glyphs());
const square = svg(`<rect width="512" height="512" fill="${BG}"/>`, glyphs());
const maskable = svg(`<rect width="512" height="512" fill="${BG}"/>`, glyphs('translate(256 256) scale(.8) translate(-256 -256)'));

const png = (s: string, size: number, opaque = false) => {
  const img = sharp(Buffer.from(s)).resize(size, size);
  return (opaque ? img.flatten({ background: BG }) : img).png().toBuffer();
};

/** ICO с одним PNG-изображением 32x32 (формат поддерживается всеми современными браузерами). */
function ico(pngBuf: Buffer, size: number): Buffer {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head.writeUInt8(size, 6); head.writeUInt8(size, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(pngBuf.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, pngBuf]);
}

async function main() {
  mkdirSync('public/icons', { recursive: true });
  writeFileSync('public/icons/icon-192.png', await png(rounded, 192));
  writeFileSync('public/icons/icon-512.png', await png(rounded, 512));
  writeFileSync('public/icons/icon-maskable-512.png', await png(maskable, 512, true));
  writeFileSync('src/app/apple-icon.png', await png(square, 180, true));
  writeFileSync('src/app/favicon.ico', ico(await png(rounded, 32), 32));
}
void main();
