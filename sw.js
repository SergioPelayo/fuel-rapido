/* Fuel Rápido — service worker mínimo.
   Sólo cachea el "esqueleto" de la app (mismo origen). Los precios se guardan
   aparte en IndexedDB, así que la app abre y funciona sin cobertura. */

const VERSION = 'fuel-rapido-v5';
const SHELL = [
  './',
  './index.html',
  './mercado.html',
  './styles.css',
  './app.js',
  './marcas.js',
  './viz.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/logo-pid.svg',
  './assets/icono.svg',
  './icons/favicon-32.png',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // nunca tocamos el Ministerio ni los mapas

  // Red primero, caché como red de seguridad.
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
