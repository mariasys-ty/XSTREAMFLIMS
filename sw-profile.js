/* =============================================
   Profile Page Service Worker
   ============================================= */

var CACHE_NAME = 'profile-v2';
var STATIC_ASSETS = [
 '/',
 'profile.html',
 'video.html',
 '/css/profile.css',
 '/js/profile.js'
];

// Install - cache static assets
self.addEventListener('install', function(event) {
 event.waitUntil(
  caches.open(CACHE_NAME).then(function(cache) {
   return cache.addAll(STATIC_ASSETS).catch(function(err) {
    console.warn('Some assets failed to cache:', err);
    // Continue even if some fail
    return Promise.resolve();
   });
  })
 );
 self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', function(event) {
 event.waitUntil(
  caches.keys().then(function(keys) {
   return Promise.all(
    keys.filter(function(key) {
     return key !== CACHE_NAME;
    }).map(function(key) {
     return caches.delete(key);
    })
   );
  })
 );
 self.clients.claim();
});

// Fetch - network first, cache fallback
self.addEventListener('fetch', function(event) {
 var url = new URL(event.request.url);
 
 // Skip non-GET requests
 if (event.request.method !== 'GET') return;
 
 // Skip Firebase requests (handled by Firebase SDK)
 if (url.hostname.includes('firebaseio.com') ||
  url.hostname.includes('googleapis.com')) {
  return;
 }
 
 // For navigation requests
 if (event.request.mode === 'navigate') {
  event.respondWith(
   fetch(event.request)
   .catch(function() {
    return caches.match(event.request).then(function(cached) {
     return cached || caches.match('/profile.html');
    });
   })
  );
  return;
 }
 
 // For static assets - cache first, then network
 if (url.pathname.match(/\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2)$/)) {
  event.respondWith(
   caches.match(event.request).then(function(cached) {
    if (cached) return cached;
    
    return fetch(event.request).then(function(response) {
     if (response.ok) {
      var clone = response.clone();
      caches.open(CACHE_NAME).then(function(cache) {
       cache.put(event.request, clone);
      });
     }
     return response;
    }).catch(function() {
     // Return empty response for images
     if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg)$/)) {
      return new Response('', {
       headers: { 'Content-Type': 'image/svg+xml' }
      });
     }
    });
   })
  );
  return;
 }
 
 // Default - network first
 event.respondWith(
  fetch(event.request)
  .then(function(response) {
   if (response.ok) {
    var clone = response.clone();
    caches.open(CACHE_NAME).then(function(cache) {
     cache.put(event.request, clone);
    });
   }
   return response;
  })
  .catch(function() {
   return caches.match(event.request);
  })
 );
});