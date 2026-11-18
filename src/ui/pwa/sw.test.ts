import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OFFLINE_DATA_CACHE, OFFLINE_DATA_KEY } from '@/shared/offline-snapshot';

type Sw = {
  VERSION: string; CACHE: string; DATA_CACHE: string; OFFLINE_URL: string;
  classify: (r: { method: string; url: string; mode?: string }, origin: string) => 'static' | 'navigate' | 'bypass';
  cacheable: (kind: string, res: { status: number; type: string }) => boolean;
  extractStaticUrls: (html: string) => string[];
  isOwnCache: (n: string) => boolean;
  pushView: (raw: string) => { title: string; body: string; url: string; tag: string };
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
  it('VERSION = хэш содержимого (P2-12): после правки sw.js запустить node scripts/sw-version.mjs --write', async () => {
    // @ts-expect-error: .mjs без типов
    const { swContentVersion } = (await import('../../../scripts/sw-version.mjs')) as { swContentVersion: (s: string) => string };
    expect(sw.VERSION, 'sw.js изменён без новой VERSION: node scripts/sw-version.mjs --write').toBe(swContentVersion(swSource));
  });
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

describe('sw: копия для офлайн-просмотра (пакет 7, п. 2)', () => {
  it('кэш копии общий со страницей, свой (ps-*) и не версионный; адрес копии — не /api и не обрабатывается воркером', () => {
    expect(sw.DATA_CACHE).toBe(OFFLINE_DATA_CACHE);
    expect(sw.isOwnCache(sw.DATA_CACHE)).toBe(true);
    expect(sw.DATA_CACHE).not.toBe(sw.CACHE);
    expect(OFFLINE_DATA_KEY.startsWith('/api')).toBe(false);
    expect(sw.classify(get(OFFLINE_DATA_KEY), O)).toBe('bypass');
  });
  it('activate не удаляет кэш копии при обновлении версии', () => {
    expect(swSource).toMatch(/k !== CACHE && k !== DATA_CACHE/);
  });
});

describe('sw: push (П14.2)', () => {
  it('только свой путь, иначе «/»; без данных — общий заголовок', () => {
    expect(sw.pushView('{"title":"Релиз завтра","body":"Завтра выходит «X».","url":"/roadmap","tag":"release-2026-12-01"}'))
      .toEqual({ title: 'Релиз завтра', body: 'Завтра выходит «X».', url: '/roadmap', tag: 'release-2026-12-01' });
    for (const url of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', 42]) {
      expect(sw.pushView(JSON.stringify({ url })).url, String(url)).toBe('/');
    }
    expect(sw.pushView('не json')).toEqual({ title: 'PS Tracker', body: '', url: '/', tag: 'ps' });
    expect(sw.pushView(JSON.stringify({ title: 'x'.repeat(200) })).title).toHaveLength(80);
  });
});
