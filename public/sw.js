/* PS Tracker service worker (design-system §15.3).
 * Кэшируем ТОЛЬКО статику: /_next/static/*, /icons/* и один HTML /offline.
 * НИКОГДА не кэшируем /api/*, закрытые страницы, HTML-документы пользователей и RSC-ответы:
 * после выхода или смены пользователя кэш не содержит чужих данных.
 * ВАЖНО: VERSION менять при КАЖДОЙ правке этого файла: иначе /offline и статика не перекэшируются
 * (обновление SW идёт по смене байтов, а кэш пересоздаётся только по смене VERSION).
 * Версию кэша менять при изменении этого файла: старые кэши удаляются в activate. */
'use strict';

var VERSION = 'v1';
var CACHE_PREFIX = 'ps-';
var CACHE = CACHE_PREFIX + 'static-' + VERSION;
var OFFLINE_URL = '/offline';
var PRECACHE = [OFFLINE_URL, '/icons/icon-192.png'];

/** Что делать с запросом: 'static' (cache-first), 'navigate' (сеть, при отказе /offline) или 'bypass' (SW не вмешивается). */
function classify(req, origin) {
  if (!req || req.method !== 'GET') return 'bypass';
  var url;
  try { url = new URL(req.url); } catch (e) { return 'bypass'; }
  if (url.origin !== origin) return 'bypass';
  var p = url.pathname;
  if (p === '/api' || p.indexOf('/api/') === 0) return 'bypass';
  if (p.indexOf('/_next/static/') === 0 || p.indexOf('/icons/') === 0) return 'static';
  // RSC-запросы клиентской навигации Next идут не как document: всегда напрямую
  if (req.mode === 'navigate') return 'navigate';
  return 'bypass';
}

/** В кэш кладём только успешные same-origin ответы на запросы класса 'static' */
function cacheable(kind, res) {
  return kind === 'static' && !!res && res.status === 200 && res.type === 'basic';
}

/** Ссылки на статику из HTML заглушки: нужны, чтобы она открывалась без сети */
function extractStaticUrls(html) {
  var out = [];
  var re = /(?:src|href)="(\/_next\/static\/[^"?#]+)(?:[?#][^"]*)?"/g;
  var m;
  while ((m = re.exec(html)) !== null) { if (out.indexOf(m[1]) === -1) out.push(m[1]); }
  return out;
}

function isOwnCache(name) { return name.indexOf(CACHE_PREFIX) === 0; }

async function precache() {
  var cache = await caches.open(CACHE);
  // credentials: 'omit' - заглушка публична и не должна зависеть от cookie пользователя (тема Night)
  var res = await fetch(OFFLINE_URL, { credentials: 'omit', cache: 'no-store' });
  if (!res.ok || res.redirected) throw new Error('offline page unavailable');
  var html = await res.clone().text();
  await cache.put(OFFLINE_URL, res);
  var assets = extractStaticUrls(html).concat(PRECACHE.slice(1));
  await Promise.all(assets.map(function (u) {
    return fetch(u, { credentials: 'omit' }).then(function (r) { if (cacheable('static', r)) return cache.put(u, r); }).catch(function () {});
  }));
}

async function purge() {
  var keys = await caches.keys();
  await Promise.all(keys.filter(isOwnCache).map(function (k) { return caches.delete(k); }));
}

async function staticFirst(req) {
  var cache = await caches.open(CACHE);
  var hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  var res = await fetch(req);
  if (cacheable('static', res)) cache.put(req, res.clone()).catch(function () {});
  return res;
}

async function navigate(req) {
  try {
    return await fetch(req);
  } catch (e) {
    var cache = await caches.open(CACHE);
    var off = await cache.match(OFFLINE_URL);
    if (off) return off;
    throw e;
  }
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function' && typeof window === 'undefined') {
  self.addEventListener('install', function (event) {
    // skipWaiting только по сообщению клиента (пользователь согласился обновиться)
    event.waitUntil(precache());
  });
  self.addEventListener('activate', function (event) {
    event.waitUntil((async function () {
      var keys = await caches.keys();
      await Promise.all(keys.filter(function (k) { return isOwnCache(k) && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      await self.clients.claim();
    })());
  });
  self.addEventListener('message', function (event) {
    var type = event.data && event.data.type;
    if (type === 'SKIP_WAITING') self.skipWaiting();
    if (type === 'PURGE') event.waitUntil(purge().then(precache).catch(function () {}));
  });
  self.addEventListener('fetch', function (event) {
    var kind = classify(event.request, self.location.origin);
    if (kind === 'static') event.respondWith(staticFirst(event.request));
    else if (kind === 'navigate') event.respondWith(navigate(event.request));
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VERSION: VERSION, CACHE: CACHE, OFFLINE_URL: OFFLINE_URL, classify: classify, cacheable: cacheable, extractStaticUrls: extractStaticUrls, isOwnCache: isOwnCache };
}
