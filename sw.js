/* =============================================
   Xstream Service Worker v1.0.0
   Caches static assets for offline shell
   ============================================= */

var CACHE_VERSION = 'xstream-v1';
var STATIC_CACHE = CACHE_VERSION + '-static';
var DYNAMIC_CACHE = CACHE_VERSION + '-dynamic';

// Files to pre-cache (app shell)
var APP_SHELL = [
  '/',
  '/index.html',
  '/profile.html',
  '/video.html',
  '/login.html',
  '/signup.html',
  '/live.html',
  '/viewall.html',
  '/translated.html',
  '/maintenance.html',
  '/css/style.css',      // Update with your actual CSS path
  '/js/app.js',          // Update with your actual JS path
  '/js/offline-manager.js'
];

// Install: Pre-cache app shell
self.addEventListener('install', function(event) {
  console.log('[SW] Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function(cache) {
        console.log('[SW] Caching app shell');
        // Cache all, continue even if some fail
        return Promise.allSettled(
          APP_SHELL.map(function(url) {
            return cache.add(url).catch(function(err) {
              console.warn('[SW] Failed to cache:', url, err.message);
              return null;
            });
          })
        );
      })
      .then(function() {
        // Skip waiting to activate immediately
        return self.skipWaiting();
      })
  );
});

// Activate: Clean old caches
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating...');
  
  event.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(
          keys.filter(function(key) {
            // Delete old version caches
            return key.startsWith('xstream-') && key !== STATIC_CACHE && key !== DYNAMIC_CACHE;
          }).map(function(key) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
        );
      })
      .then(function() {
        // Take control of all clients immediately
        return self.clients.claim();
      })
  );
});

// Fetch: Serve from cache, fallback to network
self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') return;
  
  // Skip Firebase and external API requests
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('google.com') ||
      url.hostname.includes('omdbapi.com') ||
      url.hostname.includes('ipwho.is') ||
      url.hostname.includes('ipapi.co') ||
      url.hostname.includes('b2cdn') ||
      url.hostname.includes('backblazeb2')) {
    return;
  }
  
  // Navigation requests: Cache first, then network
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(request)
        .then(function(cached) {
          if (cached) return cached;
          
          return fetch(request)
            .then(function(response) {
              if (response.ok) {
                var clone = response.clone();
                caches.open(STATIC_CACHE).then(function(cache) {
                  cache.put(request, clone);
                });
              }
              return response;
            })
            .catch(function() {
              // Ultimate fallback to index.html (SPA behavior)
              return caches.match('/index.html');
            });
        })
    );
    return;
  }
  
  // Static assets (CSS, JS, images, fonts): Cache first
  if (url.pathname.match(/\.(css|js|woff|woff2|ttf|eot|svg)$/)) {
    event.respondWith(
      caches.match(request)
        .then(function(cached) {
          if (cached) return cached;
          
          return fetch(request)
            .then(function(response) {
              if (response.ok) {
                var clone = response.clone();
                caches.open(STATIC_CACHE).then(function(cache) {
                  cache.put(request, clone);
                });
              }
              return response;
            })
            .catch(function() {
              // Return empty CSS/JS to prevent crashes
              if (url.pathname.match(/\.(css|js)$/)) {
                return new Response('', {
                  headers: { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript' }
                });
              }
            });
        })
    );
    return;
  }
  
  // Images: Cache first with placeholder fallback
  if (url.pathname.match(/\.(png|jpg|jpeg|gif|webp|ico)$/)) {
    event.respondWith(
      caches.match(request)
        .then(function(cached) {
          if (cached) return cached;
          
          return fetch(request)
            .then(function(response) {
              if (response.ok) {
                var clone = response.clone();
                caches.open(DYNAMIC_CACHE).then(function(cache) {
                  cache.put(request, clone);
                });
              }
              return response;
            })
            .catch(function() {
              // Return 1x1 transparent pixel
              return new Response(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
                { headers: { 'Content-Type': 'image/png' } }
              );
            });
        })
    );
    return;
  }
  
  // Everything else: Network first, cache fallback
  event.respondWith(
    fetch(request)
      .then(function(response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(DYNAMIC_CACHE).then(function(cache) {
            cache.put(request, clone);
          });
        }
        return response;
      })
      .catch(function() {
        return caches.match(request);
      })
  );
});

// Message handler for cache management
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        return caches.delete(key);
      }));
    }).then(function() {
      event.ports[0].postMessage({ success: true });
    });
  }
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});