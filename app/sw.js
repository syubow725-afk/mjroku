// Service Worker：アプリ本体（同一オリジンのファイル）だけをキャッシュし、電波がなくても起動できるようにする。
// GAS への通信（別オリジン）には手を出さず素通しする。
'use strict';

// app.js の APP_VERSION と揃えて上げる。上げると古いキャッシュは activate 時に消える
const CACHE_VERSION = '0.0.2';
const CACHE_NAME = `mjroku-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/app.js',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('mjroku-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// stale-while-revalidate：キャッシュがあれば即座に返し（電波が弱くても速い）、
// 裏で最新を取りに行ってキャッシュを更新する。更新は次回起動時に反映される。
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
