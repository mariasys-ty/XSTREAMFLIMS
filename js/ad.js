/* =============================================
   Ad System — XSTREAM
   Fetches from Firebase → /advertisement node
   Supports: image & video ads, seamless auto-scroll,
   drag, touch, pause, clickable links, view/click tracking
   ============================================= */

(function() {
 'use strict';

 /* -------------------------------------------
    Firebase Init (reuses config.js ENV_CONFIG)
    ------------------------------------------- */
 var adFirebaseConfig = {
  apiKey: ENV_CONFIG.FIREBASE_API_KEY,
  authDomain: ENV_CONFIG.FIREBASE_AUTH_DOMAIN,
  projectId: ENV_CONFIG.FIREBASE_PROJECT_ID,
  storageBucket: ENV_CONFIG.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: ENV_CONFIG.FIREBASE_MESSAGING_SENDER_ID,
  appId: ENV_CONFIG.FIREBASE_APP_ID,
  measurementId: ENV_CONFIG.FIREBASE_MEASUREMENT_ID
 };

 /* Only init if not already initialized by app.js */
 if (!firebase.apps.length) {
  firebase.initializeApp(adFirebaseConfig);
 }
 var adDb = firebase.database();

 /* -------------------------------------------
    Ad Cache — avoids re-fetching on every page
    ------------------------------------------- */
 var adCache = null;
 var adCacheTime = 0;
 var AD_CACHE_TTL = 5 * 60 * 1000; /* 5 minutes */

 /* -------------------------------------------
    Tracked Views — prevents duplicate counts
    ------------------------------------------- */
 var trackedViews = {};
 var VIEW_COOLDOWN = 60 * 1000; /* 1 minute cooldown per ad per session */

 /* -------------------------------------------
    Track Ad View — saved to Firebase
    ------------------------------------------- */
 function trackAdView(adId) {
  if (!adId) return;

  /* Prevent duplicate view within cooldown */
  var now = Date.now();
  if (trackedViews[adId] && (now - trackedViews[adId]) < VIEW_COOLDOWN) {
   return;
  }
  trackedViews[adId] = now;

  var today = new Date().toISOString().split('T')[0];

  /* Daily views */
  adDb.ref('adStats/' + adId + '/daily/' + today + '/views')
   .transaction(function(current) {
    return (current || 0) + 1;
   })
   .then(function(result) {
    if (!result.committed) {
     console.warn('[AdSystem] View transaction failed for', adId);
    }
   })
   .catch(function(err) {
    console.warn('[AdSystem] View save error:', err.message);
   });

  /* Total views */
  adDb.ref('adStats/' + adId + '/total/views')
   .transaction(function(current) {
    return (current || 0) + 1;
   })
   .catch(function(err) {
    console.warn('[AdSystem] Total view save error:', err.message);
   });
 }

 /* -------------------------------------------
    Track Ad Click — saved to Firebase
    ------------------------------------------- */
 function trackAdClick(adId) {
  if (!adId) return;

  var today = new Date().toISOString().split('T')[0];

  /* Daily clicks */
  adDb.ref('adStats/' + adId + '/daily/' + today + '/clicks')
   .transaction(function(current) {
    return (current || 0) + 1;
   })
   .then(function(result) {
    if (!result.committed) {
     console.warn('[AdSystem] Click transaction failed for', adId);
    }
   })
   .catch(function(err) {
    console.warn('[AdSystem] Click save error:', err.message);
   });

  /* Total clicks */
  adDb.ref('adStats/' + adId + '/total/clicks')
   .transaction(function(current) {
    return (current || 0) + 1;
   })
   .catch(function(err) {
    console.warn('[AdSystem] Total click save error:', err.message);
   });
 }

 /* -------------------------------------------
    Fetch Ads from Firebase
    ------------------------------------------- */
 function fetchAds() {
  /* Return cache if fresh */
  if (adCache && (Date.now() - adCacheTime) < AD_CACHE_TTL) {
   return Promise.resolve(adCache);
  }

  return adDb.ref('advertisement').once('value').then(function(snapshot) {
   var ads = [];
   snapshot.forEach(function(child) {
    var data = child.val();
    if (!data) return;
    /* Only include active ads that have a media URL */
    if (data.active === false) return;
    if (!data.mediaUrl || data.mediaUrl.length < 5) return;

    ads.push({
     id: child.key,
     type: (data.type || 'image').toLowerCase(),
     mediaUrl: data.mediaUrl,
     linkUrl: data.linkUrl || '',
     title: data.title || 'Ad',
     position: data.position || 'all'
    });
   });

   adCache = ads;
   adCacheTime = Date.now();
   return ads;
  }).catch(function(err) {
   console.warn('[AdSystem] Fetch failed:', err.message);
   return [];
  });
 }

 /* -------------------------------------------
    Filter Ads by Position
    ------------------------------------------- */
 function filterByPosition(ads, position) {
  if (!position || position === 'all') return ads;
  return ads.filter(function(ad) {
   return ad.position === 'all' || ad.position === position;
  });
 }

 /* -------------------------------------------
    Escape text for HTML
    ------------------------------------------- */
 function escapeAdText(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
 }

 /* -------------------------------------------
    Build Ad Card HTML
    ------------------------------------------- */
 function createAdCard(ad) {
  var card = document.createElement('div');
  card.className = 'ad-card';
  card.setAttribute('data-ad-id', ad.id);

  var inner = '';

  if (ad.type === 'video') {
   inner = '<video class="ad-media ad-video" src="' + ad.mediaUrl + '" muted loop playsinline preload="metadata">' +
    '<source src="' + ad.mediaUrl + '" type="video/mp4">' +
    '</video>';
  } else {
   inner = '<img class="ad-media ad-image" src="' + ad.mediaUrl + '" alt="' + escapeAdText(ad.title) + '" loading="lazy" onerror="this.src=\'https://placehold.co/600x200/1a1a2e/555?text=Ad\'">';
  }

  /* Info overlay */
  inner += '<div class="ad-card-overlay">' +
   '<div class="ad-card-info">' +
   '<span class="ad-card-title">' + escapeAdText(ad.title) + '</span>' +
   '</div>' +
   '<span class="ad-sponsored-badge">Sponsored</span>' +
   '</div>';

  card.innerHTML = inner;

  /* ── Track view when card becomes 50% visible ── */
  var viewTracked = false;
  var viewObserver = new IntersectionObserver(function(entries) {
   entries.forEach(function(entry) {
    if (entry.isIntersecting && !viewTracked) {
     viewTracked = true;
     trackAdView(ad.id);
     /* Unobserve after first view — cooldown prevents re-counting */
     viewObserver.unobserve(entry.target);
    }
   });
  }, { threshold: 0.5 });
  viewObserver.observe(card);

  /* ── Click handler ── */
  if (ad.linkUrl && ad.linkUrl.length > 3) {
   card.style.cursor = 'pointer';
   card.setAttribute('role', 'link');
   card.setAttribute('tabindex', '0');

   card.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    trackAdClick(ad.id);
    window.open(ad.linkUrl, '_blank', 'noopener,noreferrer');
   });

   /* Keyboard accessible */
   card.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
     e.preventDefault();
     trackAdClick(ad.id);
     window.open(ad.linkUrl, '_blank', 'noopener,noreferrer');
    }
   });
  }

  /* ── Auto-play video when visible ── */
  if (ad.type === 'video') {
   var video = card.querySelector('video');
   if (video) {
    var videoObserver = new IntersectionObserver(function(entries) {
     entries.forEach(function(entry) {
      if (entry.isIntersecting) {
       video.play().catch(function() {});
      } else {
       video.pause();
      }
     });
    }, { threshold: 0.5 });
    videoObserver.observe(video);
   }
  }

  return card;
 }

 /* -------------------------------------------
    Auto-Scroll Engine — Seamless Infinite Loop
    ------------------------------------------- */
 function setupAutoScroll(track) {
  if (!track) return null;

  var scrollSpeed = 0.5;
  var isPaused = false;
  var isDragging = false;
  var animationId = null;
  var pauseTimeout = null;
  var dragStartX = 0;
  var dragScrollStart = 0;
  var originalSetWidth = 0;

  /* ── Measure original children (before clones) ── */
  function measureOriginalWidth() {
   var total = 0;
   var children = track.querySelectorAll('.ad-card:not(.ad-scroll-clone)');
   for (var i = 0; i < children.length; i++) {
    total += children[i].offsetWidth;
    var style = window.getComputedStyle(children[i]);
    total += parseFloat(style.marginLeft) || 0;
    total += parseFloat(style.marginRight) || 0;
   }
   return total;
  }

  /* ── Clone children for seamless loop ── */
  function cloneForLoop() {
   /* Remove old clones first */
   var oldClones = track.querySelectorAll('.ad-scroll-clone');
   for (var i = 0; i < oldClones.length; i++) {
    oldClones[i].remove();
   }

   originalSetWidth = measureOriginalWidth();

   /* If nothing to scroll, don't clone */
   if (originalSetWidth <= track.clientWidth + 1) {
    return false;
   }

   /* Clone enough sets to fill the visible area + buffer */
   var originals = track.querySelectorAll('.ad-card:not(.ad-scroll-clone)');
   var setsNeeded = Math.ceil(track.clientWidth / originalSetWidth) + 2;

   for (var s = 0; s < setsNeeded; s++) {
    for (var j = 0; j < originals.length; j++) {
     var clone = originals[j].cloneNode(true);
     clone.classList.add('ad-scroll-clone');
     /* Remove data-ad-id from clones so views don't double-count */
     clone.removeAttribute('data-ad-id');
     /* Remove click handlers from clones — they link to original position */
     clone.style.cursor = 'default';
     clone.removeAttribute('role');
     clone.removeAttribute('tabindex');
     track.appendChild(clone);
    }
   }

   return true;
  }

  var canScroll = cloneForLoop();

  /* If content doesn't overflow, don't start the engine */
  if (!canScroll) {
   return null;
  }

  /* ── The animation loop ── */
  function getScrollLimit() {
   return originalSetWidth;
  }

  function scroll() {
   if (!isPaused && !isDragging) {
    track.scrollLeft += scrollSpeed;

    /* When past the first original set, jump back invisibly */
    if (track.scrollLeft >= getScrollLimit()) {
     track.scrollLeft = track.scrollLeft - getScrollLimit();
    }
   }

   animationId = requestAnimationFrame(scroll);
  }

  animationId = requestAnimationFrame(scroll);

  /* ── Pause helpers ── */
  function pause() {
   isPaused = true;
   clearTimeout(pauseTimeout);
  }

  function resumeLater(delay) {
   clearTimeout(pauseTimeout);
   pauseTimeout = setTimeout(function() {
    isPaused = false;
   }, delay);
  }

  /* ── Mouse drag ── */
  track.addEventListener('mousedown', function(e) {
   isDragging = true;
   pause();
   dragStartX = e.clientX;
   dragScrollStart = track.scrollLeft;
   track.style.cursor = 'grabbing';
   e.preventDefault();
  });

  window.addEventListener('mousemove', function(e) {
   if (!isDragging) return;
   var diff = dragStartX - e.clientX;
   track.scrollLeft = dragScrollStart + diff;

   /* Keep within bounds */
   if (track.scrollLeft < 0) {
    track.scrollLeft = 0;
   }
   if (track.scrollLeft > getScrollLimit()) {
    track.scrollLeft = track.scrollLeft - getScrollLimit();
   }
  });

  window.addEventListener('mouseup', function() {
   if (!isDragging) return;
   isDragging = false;
   track.style.cursor = '';
   resumeLater(2000);
  });

  /* ── Touch drag ── */
  var touchStartX = 0;
  var touchScrollStart = 0;

  track.addEventListener('touchstart', function(e) {
   if (e.touches.length !== 1) return;
   isDragging = true;
   pause();
   touchStartX = e.touches[0].clientX;
   touchScrollStart = track.scrollLeft;
  }, { passive: true });

  track.addEventListener('touchmove', function(e) {
   if (!isDragging || e.touches.length !== 1) return;
   var diff = touchStartX - e.touches[0].clientX;
   track.scrollLeft = touchScrollStart + diff;

   if (track.scrollLeft < 0) track.scrollLeft = 0;
   if (track.scrollLeft > getScrollLimit()) {
    track.scrollLeft = track.scrollLeft - getScrollLimit();
   }
  }, { passive: true });

  track.addEventListener('touchend', function() {
   isDragging = false;
   resumeLater(1500);
  });

  /* ── Hover pause (desktop) ── */
  track.addEventListener('mouseenter', function() {
   pause();
  });

  track.addEventListener('mouseleave', function() {
   resumeLater(1000);
  });

  /* ── Wheel pause ── */
  track.addEventListener('wheel', function() {
   pause();
   resumeLater(2000);
  }, { passive: true });

  /* ── Pause when tab is hidden ── */
  var visibilityHandler = function() {
   if (document.hidden) {
    cancelAnimationFrame(animationId);
   } else {
    animationId = requestAnimationFrame(scroll);
   }
  };
  document.addEventListener('visibilitychange', visibilityHandler);

  /* ── Recalculate on resize ── */
  var resizeTimeout;
  var resizeHandler = function() {
   clearTimeout(resizeTimeout);
   resizeTimeout = setTimeout(function() {
    var couldScroll = cloneForLoop();
    if (!couldScroll) {
     cancelAnimationFrame(animationId);
    } else {
     if (!animationId) {
      animationId = requestAnimationFrame(scroll);
     }
    }
   }, 300);
  };
  window.addEventListener('resize', resizeHandler);

  /* ── Cleanup method ── */
  track._destroyAutoScroll = function() {
   cancelAnimationFrame(animationId);
   clearTimeout(pauseTimeout);
   isPaused = true;
   document.removeEventListener('visibilitychange', visibilityHandler);
   window.removeEventListener('resize', resizeHandler);

   var clones = track.querySelectorAll('.ad-scroll-clone');
   for (var i = 0; i < clones.length; i++) {
    clones[i].remove();
   }
  };

  return track._destroyAutoScroll;
 }

 /* -------------------------------------------
    MAIN: Initialize Ad Banner
    ------------------------------------------- */
 function initAdBanner(containerId, options) {
  options = options || {};
  var position = options.position || 'all';
  var maxAds = options.maxAds || 10;

  var container = document.getElementById(containerId);
  if (!container) {
   console.warn('[AdSystem] Container not found:', containerId);
   return;
  }

  /* Show skeleton while loading */
  container.innerHTML = '<div class="ad-track" id="' + containerId + '-track">' +
   '<div class="ad-card ad-skeleton"><div class="ad-skeleton-inner"></div></div>' +
   '<div class="ad-card ad-skeleton"><div class="ad-skeleton-inner"></div></div>' +
   '<div class="ad-card ad-skeleton"><div class="ad-skeleton-inner"></div></div>' +
   '</div>';

  fetchAds().then(function(ads) {
   var filtered = filterByPosition(ads, position);
   var toShow = filtered.slice(0, maxAds);

   if (toShow.length === 0) {
    container.style.display = 'none';
    return;
   }

   container.style.display = 'block';

   var track = document.getElementById(containerId + '-track');
   if (!track) return;

   /* Clear skeletons */
   track.innerHTML = '';

   /* Build ad cards */
   for (var i = 0; i < toShow.length; i++) {
    var card = createAdCard(toShow[i]);
    track.appendChild(card);
   }

   /* Start auto-scroll (handles cloning internally) */
   setupAutoScroll(track);

   /* Fire event so other scripts know ads are ready */
   var event = new CustomEvent('adsLoaded', {
    detail: { containerId: containerId, count: toShow.length }
   });
   document.dispatchEvent(event);

  }).catch(function(err) {
   console.warn('[AdSystem] Init error:', err);
   container.style.display = 'none';
  });
 }

 /* -------------------------------------------
    Initialize All Ad Banners on Page
    ------------------------------------------- */
 function initAllBanners() {
  var containers = document.querySelectorAll('.ad-banner-wrapper');
  for (var i = 0; i < containers.length; i++) {
   var id = containers[i].id;
   if (id && !containers[i].querySelector('.ad-track')) {
    initAdBanner(id, {
     position: 'all',
     maxAds: 10
    });
   }
  }
 }

 /* -------------------------------------------
    Expose to Global Scope
    ------------------------------------------- */
 window.AdSystem = {
  init: initAdBanner,
  initAll: initAllBanners,
  fetch: fetchAds,
  trackView: trackAdView,
  trackClick: trackAdClick,
  reload: function() {
   adCache = null;
   adCacheTime = 0;
   trackedViews = {};
   initAllBanners();
  }
 };

 /* -------------------------------------------
    Auto-Initialize on DOM Ready
    ------------------------------------------- */
 if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAllBanners);
 } else {
  initAllBanners();
 }

 /* Fallback for late-rendered containers */
 setTimeout(initAllBanners, 2000);
 setTimeout(initAllBanners, 5000);

})();