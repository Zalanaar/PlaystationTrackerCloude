import { describe, expect, it } from 'vitest';
import { toHttps } from './https-url';

describe('toHttps', () => {
  it('http -> https, регистр схемы не важен', () => {
    expect(toHttps('http://image.api.playstation.com/a.png')).toBe('https://image.api.playstation.com/a.png');
    expect(toHttps('HTTP://x.example/a.png?s=1')).toBe('https://x.example/a.png?s=1');
  });
  it('https и прочее не меняются, пусто = null', () => {
    expect(toHttps('https://x.example/a.png')).toBe('https://x.example/a.png');
    expect(toHttps('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
    expect(toHttps('//cdn.example/a.png')).toBe('//cdn.example/a.png');
    expect(toHttps('')).toBeNull();
    expect(toHttps(null)).toBeNull();
    expect(toHttps(undefined)).toBeNull();
  });
});
