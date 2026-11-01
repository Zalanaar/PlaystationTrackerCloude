import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Sw = {
  VERSION: string; CACHE: string; OFFLINE_URL: string;
  classify: (r: { method: string; url: string; mode?: string }, origin: string) => 'static' | 'navigate' | 'bypass';
  cacheable: (kind: string, res: { status: number; type: string }) => boolean;
  extractStaticUrls: (html: string) => string[];
  isOwnCache: (n: string) => boolean;
};
// sw.js - классический скрипт воркера: исполняем исходник как CommonJS-подобный модуль
const swSource = readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8');
const mod: { exports: Partial<Sw> } = { exports: {} };
new Function('module', swSource)(mod);
const sw = mod.exports as Sw;
const O = 'https://ps.example';
const get = (path: string, mode = 'cors') => ({ method: 'GET', url: O + path, mode });

describe('sw: стратегия кэша', () => {
  it('статика и иконки: cache-first', () => {
    expect(sw.classify(get('/_next/static/chunks/a.js'), O)).toBe('static');
    expect(sw.classify(get('/icons/icon-192.png'), O)).toBe('static');
  });
  it('/api/* никогда не обрабатывается, даже навигация и картинки', () => {
    for (const p of ['/api', '/api/health', '/api/collection', '/api/backup', '/api/x.png', '/api/auth/me']) {
      expect(sw.classify(get(p), O), p).toBe('bypass');
      expect(sw.classify(get(p, 'navigate'), O), p).toBe('bypass');
    }
  });
  it('HTML-документы идут через сеть и не кэшируются (navigate -> только заглушка при отказе)', () => {
    for (const p of ['/', '/stats', '/backlog?x=1', '/wrapped']) {
      expect(sw.classify(get(p, 'navigate'), O)).toBe('navigate');
      expect(sw.cacheable('navigate', { status: 200, type: 'basic' })).toBe(false);
    }
  });
  it('RSC и прочие fetch закрытых страниц не трогаем', () => {
    expect(sw.classify(get('/stats?_rsc=abc'), O)).toBe('bypass');
    expect(sw.classify(get('/'), O)).toBe('bypass');
  });
  it('POST, чужой origin и мусорный URL игнорируются', () => {
    expect(sw.classify({ method: 'POST', url: O + '/_next/static/a.js' }, O)).toBe('bypass');
    expect(sw.classify({ method: 'GET', url: 'https://image.api.playstation.com/x.png' }, O)).toBe('bypass');
    expect(sw.classify({ method: 'GET', url: 'не url' }, O)).toBe('bypass');
  });
  it('кэшируются только успешные basic-ответы статики', () => {
    expect(sw.cacheable('static', { status: 200, type: 'basic' })).toBe(true);
    expect(sw.cacheable('static', { status: 404, type: 'basic' })).toBe(false);
    expect(sw.cacheable('static', { status: 200, type: 'opaque' })).toBe(false);
    expect(sw.cacheable('bypass', { status: 200, type: 'basic' })).toBe(false);
  });
});

describe('sw: версия и очистка', () => {
  it('имя кэша содержит версию, чужие кэши не трогаем', () => {
    expect(sw.CACHE).toBe(`ps-static-${sw.VERSION}`);
    expect(sw.isOwnCache('ps-static-v0')).toBe(true);
    expect(sw.isOwnCache('workbox-precache')).toBe(false);
  });
  it('ссылки на статику из HTML заглушки', () => {
    const html = '<script src="/_next/static/chunks/a.js?v=1" async></script><link href="/_next/static/css/b.css" rel="stylesheet"><a href="/stats">';
    expect(sw.extractStaticUrls(html)).toEqual(['/_next/static/chunks/a.js', '/_next/static/css/b.css']);
  });
});

describe('sw: исходник', () => {
  const src = readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8');
  it('skipWaiting только по сообщению клиента', () => {
    const calls = src.match(/skipWaiting\(\)/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(src).toMatch(/SKIP_WAITING[\s\S]{0,60}skipWaiting\(\)/);
  });
  it('activate чистит старые версии', () => {
    expect(src).toMatch(/k !== CACHE/);
  });
  it('/offline не получает куки пользователя', () => {
    expect(src).toMatch(/credentials: 'omit'/);
  });
});
