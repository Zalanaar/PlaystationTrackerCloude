import { describe, expect, it, vi } from 'vitest';
import { fetchImageBytes, IMAGE_MAX_REDIRECTS, isPublicHttpsImageUrl } from './image';

const img = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

describe('fetchImageBytes: редиректы (повторный аудит P2-8)', () => {
  it('без редиректа — байты, redirect: manual', async () => {
    const f = vi.fn<(u: string, i?: RequestInit) => Promise<Response>>(async () => img());
    expect(await fetchImageBytes('https://image.api.playstation.com/a.png', f as unknown as typeof fetch)).toEqual(new Uint8Array([1, 2, 3]));
    expect(f.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
  });
  it('редирект на публичный https-хост (в т.ч. относительный) проходит', async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect('https://cdn.example.com/b.png')).mockResolvedValueOnce(redirect('/c.png')).mockResolvedValueOnce(img());
    await expect(fetchImageBytes('https://image.api.playstation.com/a.png', f as unknown as typeof fetch)).resolves.toHaveLength(3);
    expect(f.mock.calls.map((c) => c[0])).toEqual(['https://image.api.playstation.com/a.png', 'https://cdn.example.com/b.png', 'https://cdn.example.com/c.png']);
  });
  it.each(['http://cdn.example.com/x.png', 'https://169.254.169.254/latest/meta-data', 'https://localhost/x', 'https://db.internal/x', 'https://[::1]/x'])(
    'редирект на %s отклоняется до запроса',
    async (to) => {
      const f = vi.fn().mockResolvedValueOnce(redirect(to)).mockResolvedValue(img());
      await expect(fetchImageBytes('https://image.api.playstation.com/a.png', f as unknown as typeof fetch)).rejects.toThrow(/недопустимый редирект/);
      expect(f).toHaveBeenCalledTimes(1);
    },
  );
  it('цепочка длиннее лимита и редирект без Location — ошибка', async () => {
    const loop = vi.fn(async () => redirect('https://cdn.example.com/again.png'));
    await expect(fetchImageBytes('https://image.api.playstation.com/a.png', loop as unknown as typeof fetch)).rejects.toThrow(/редиректов/);
    expect(loop).toHaveBeenCalledTimes(IMAGE_MAX_REDIRECTS + 1);
    const noLoc = vi.fn(async () => new Response(null, { status: 301 }));
    await expect(fetchImageBytes('https://image.api.playstation.com/a.png', noLoc as unknown as typeof fetch)).rejects.toThrow(/редиректов/);
  });
  it('исходный URL по-прежнему проверяется', async () => {
    expect(isPublicHttpsImageUrl('https://10.0.0.1/x')).toBe(false);
    await expect(fetchImageBytes('http://image.api.playstation.com/a.png', vi.fn() as unknown as typeof fetch)).rejects.toThrow(/недопустимый URL/);
  });
});
