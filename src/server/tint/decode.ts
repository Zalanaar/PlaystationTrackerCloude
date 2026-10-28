// Декодирование обложки в 32x32 RGB через sharp (контракт 15.2). sharp грузится динамически: сбой бинарника
// не ломает остальной синк.
import { TINT_SIZE, pickTintFromRgb } from './pick';

/** sharp не загрузился (нет бинарника в окружении). */
export class TintUnavailableError extends Error {}

type SharpFn = (input: Uint8Array) => {
  flatten(o: { background: string }): ReturnType<SharpFn>;
  resize(w: number, h: number, o: { fit: 'cover' }): ReturnType<SharpFn>;
  removeAlpha(): ReturnType<SharpFn>;
  raw(): ReturnType<SharpFn>;
  toBuffer(): Promise<Buffer>;
};

async function loadSharp(): Promise<SharpFn> {
  try {
    const mod = (await import('sharp')) as unknown as { default?: SharpFn };
    if (typeof mod.default !== 'function') throw new Error('sharp: нет экспорта');
    return mod.default;
  } catch {
    throw new TintUnavailableError('sharp недоступен');
  }
}

/** Байты изображения -> #rrggbb или null (серое). Бросает при нечитаемой картинке, TintUnavailableError без sharp. */
export async function tintFromImage(bytes: Uint8Array): Promise<string | null> {
  const sharp = await loadSharp();
  const raw = await sharp(bytes)
    .flatten({ background: '#000000' })
    .resize(TINT_SIZE, TINT_SIZE, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer();
  return pickTintFromRgb(raw);
}
