/* =============================================
   Translated Movies Page Logic - Performance Optimized
   Reads from the "Translated" node in Firebase
   ============================================= */

/* =============================================
   Translated Cache — Eliminates repeated Firebase reads
   ============================================= */
var TranslatedCache = {
  raw: null,              // Full raw data from Firebase
  metadata: null,         // Lightweight metadata array for fast card rendering
  fullDataMap: null,      // Full data keyed by ID for download buttons, etc.
  lastFetchTime: 0,       // Timestamp of last successful fetch
  isLoaded: false         // Whether in-memory cache has been populated
};

var TRANSLATED_SESSION_KEY = 'TranslatedMetadataCache';
var TRANSLATED_CACHE_TTL = 5 * 60 * 1000; /* 5 minutes */

/* =============================================
   App State
   ============================================= */
var TranslatedAppState = {
  lastLoadedKey: null,
  currentCategory: 'all',
  currentSort: 'recent',
  currentSearch: '',
  itemsPerPage: 30,
  currentBatch: 0,
  isLoading: false,
  allFilteredVideos: null
};

/* Firebase path — reads directly from Translated/ */
var TRANSLATED_FB_PATH = 'Translated'

/* =============================================
   Cache Helper Functions
   ============================================= */

/**
/**
 * Extracts lightweight metadata needed to render video cards.
 * This is much smaller than full video data and loads faster.
 */
function extractTranslatedMetadata(videos) {
  var result = [];
  for (var i = 0; i < videos.length; i++) {
    var v = videos[i];
    result.push({
      _id: v._id,
      title: v.title,
      /* ALL possible image field names — getThumbnailUrl() needs these */
      thumbnail: v.thumbnail,
      thumbnailUrl: v.thumbnailUrl,
      thumbnailURL: v.thumbnailURL,
      thumb: v.thumb,
      posterUrl: v.posterUrl,
      posterURL: v.posterURL,
      poster: v.poster,
      imageUrl: v.imageUrl,
      imageURL: v.imageURL,
      image: v.image,
      cover: v.cover,
      coverUrl: v.coverUrl,
      coverURL: v.coverURL,
      photo: v.photo,
      photoUrl: v.photoUrl,
      /* end image fields */
      year: v.year,
      genre: v.genre,
      runtime: v.runtime,
      imdbRating: v.imdbRating,
      country: v.country,
      vjName: v.vjName,
      rated: v.rated,
      views: v.views,
      likes: v.likes,
      dislikes: v.dislikes,
      createdAt: v.createdAt
    });
  }
  return result;
}

/**
 * Attempts to load cached metadata from sessionStorage.
 * Returns null if not available or expired.
 */
function loadSessionCache() {
  try {
    var stored = sessionStorage.getItem(TRANSLATED_SESSION_KEY);
    if (stored) {
      var parsed = JSON.parse(stored);
      if (parsed.lastFetchTime && (Date.now() - parsed.lastFetchTime) < TRANSLATED_CACHE_TTL) {
        return parsed;
      }
    }
  } catch (e) { /* sessionStorage unavailable or parse error */ }
  return null;
}

/**
 * Saves lightweight metadata to sessionStorage for fast page revisit.
 */
function saveSessionCache(metadata) {
  try {
    sessionStorage.setItem(TRANSLATED_SESSION_KEY, JSON.stringify({
      metadata: metadata,
      lastFetchTime: Date.now()
    }));
  } catch (e) { /* sessionStorage full or unavailable */ }
}

/**
 * Returns cached data if available and fresh.
 * Checks in-memory cache first, then sessionStorage.
 */
function getTranslatedCache() {
  if (TranslatedCache.isLoaded && TranslatedCache.metadata) {
    return {
      metadata: TranslatedCache.metadata,
      fullDataMap: TranslatedCache.fullDataMap,
      fromSession: false
    };
  }

  var sessionData = loadSessionCache();
  if (sessionData && sessionData.metadata) {
    TranslatedCache.metadata = sessionData.metadata;
    TranslatedCache.lastFetchTime = sessionData.lastFetchTime;
    return {
      metadata: sessionData.metadata,
      fullDataMap: null,
      fromSession: true
    };
  }

  return null;
}

/**
 * Stores video data in both in-memory cache and sessionStorage.
 */
function setTranslatedCache(videos) {
  TranslatedCache.raw = videos;
  TranslatedCache.metadata = extractTranslatedMetadata(videos);
  TranslatedCache.fullDataMap = {};

  for (var i = 0; i < videos.length; i++) {
    TranslatedCache.fullDataMap[videos[i]._id] = videos[i];
  }

  TranslatedCache.lastFetchTime = Date.now();
  TranslatedCache.isLoaded = true;

  saveSessionCache(TranslatedCache.metadata);
}

/**
 * Clears all cache stores.
 */
function invalidateTranslatedCache() {
  TranslatedCache.raw = null;
  TranslatedCache.metadata = null;
  TranslatedCache.fullDataMap = null;
  TranslatedCache.lastFetchTime = 0;
  TranslatedCache.isLoaded = false;

  try { sessionStorage.removeItem(TRANSLATED_SESSION_KEY); } catch (e) {}
}

/* =============================================
   Cache Wait System — Prevents duplicate Firebase calls
   ============================================= */
var cacheWaitResolvers = [];
var isCacheFetchInProgress = false;

/**
 * Returns a Promise that resolves with cached data.
 * If a fetch is already in progress, waits for it instead of starting a new one.
 */
function waitForCache() {
  return new Promise(function(resolve, reject) {
    var cached = getTranslatedCache();
    if (cached) {
      resolve(cached);
      return;
    }

    cacheWaitResolvers.push({ resolve: resolve, reject: reject });

    if (!isCacheFetchInProgress) {
      isCacheFetchInProgress = true;

      database.ref(TRANSLATED_FB_PATH).orderByKey().once('value').then(function(snapshot) {
        var videos = [];
        snapshot.forEach(function(child) {
          var data = child.val();
          data._id = child.key;
          videos.push(data);
        });

        setTranslatedCache(videos);
        isCacheFetchInProgress = false;

        var cache = getTranslatedCache();
        for (var i = 0; i < cacheWaitResolvers.length; i++) {
          cacheWaitResolvers[i].resolve(cache);
        }
        cacheWaitResolvers = [];
      }).catch(function(err) {
        isCacheFetchInProgress = false;
        for (var i = 0; i < cacheWaitResolvers.length; i++) {
          cacheWaitResolvers[i].reject(err);
        }
        cacheWaitResolvers = [];
      });
    }
  });
}

/* =============================================
   Background Full Data Loading (Phase 2)
   ============================================= */

/**
 * Loads full video data in the background after metadata is already displayed.
 * This populates download URLs and other heavy fields without blocking the UI.
 */
function loadFullDataInBackground() {
  if (TranslatedCache.fullDataMap) return;

  database.ref(TRANSLATED_FB_PATH).orderByKey().once('value').then(function(snapshot) {
    var videos = [];
    snapshot.forEach(function(child) {
      var data = child.val();
      data._id = child.key;
      videos.push(data);
    });

    TranslatedCache.raw = videos;
    TranslatedCache.fullDataMap = {};
    for (var i = 0; i < videos.length; i++) {
      TranslatedCache.fullDataMap[videos[i]._id] = videos[i];
    }

    mergeFullDataIntoCards();
  }).catch(function(err) {
    console.error('Background full data load error:', err);
  });
}

function refreshCacheInBackground() {
  database.ref(TRANSLATED_FB_PATH).orderByKey().once('value').then(function(snapshot) {
    var videos = [];
    snapshot.forEach(function(child) {
      var data = child.val();
      data._id = child.key;
      videos.push(data);
    });
    setTranslatedCache(videos);
    mergeFullDataIntoCards();
  }).catch(function() {});
}

/**
 * Merges full video data into already-rendered cards.
 * Updates download button URLs without rebuilding cards.
 */
function mergeFullDataIntoCards() {
  if (!TranslatedCache.fullDataMap) return;

  var grid = document.getElementById('videos-grid');
  if (!grid) return;

  var cards = grid.querySelectorAll('.video-card');
  for (var i = 0; i < cards.length; i++) {
    var favBtn = cards[i].querySelector('.fav-btn');
    if (favBtn) {
      var id = favBtn.getAttribute('data-id');
      if (id && TranslatedCache.fullDataMap[id]) {
        var fullData = TranslatedCache.fullDataMap[id];
        var dlBtn = cards[i].querySelector('.dl-btn');
        if (dlBtn && fullData.videoUrl) {
          dlBtn.setAttribute('data-url', fullData.videoUrl);
        }
      }
    }
  }
}

/* =============================================
   Initialization
   ============================================= */

function initTranslatedPage() {
  getTranslatedCacheSync(); /* Pre-warm cache from sessionStorage */
  
  var urlParams = new URLSearchParams(window.location.search);
  /* ... rest of function unchanged ... */

  /* Parse URL parameters */
  TranslatedAppState.currentSearch = urlParams.get('search') || '';
  var sortParam = urlParams.get('sort');
  if (sortParam === 'trending' || sortParam === 'views' || sortParam === 'likes') {
    TranslatedAppState.currentSort = sortParam;
  }

  var catParam = urlParams.get('category');
  if (catParam) TranslatedAppState.currentCategory = catParam;

  /* Apply initial state to DOM */
  var catFilter = document.getElementById('category-filter');
  var sortFilter = document.getElementById('sort-filter');
  var searchInput = document.getElementById('sidebar-search');
  var heroTitle = document.getElementById('viewall-title');
  var breadcrumb = document.getElementById('breadcrumb-current');

  if (catFilter) catFilter.value = TranslatedAppState.currentCategory;
  if (sortFilter) sortFilter.value = TranslatedAppState.currentSort;
  if (searchInput && TranslatedAppState.currentSearch) searchInput.value = TranslatedAppState.currentSearch;
  if (heroTitle) heroTitle.textContent = 'All Translations';
  if (breadcrumb) breadcrumb.textContent = 'Translated Movies';

  /* Render everything */
  updateActiveFiltersUI();
  renderTranslatedVideos(false);
  updateTranslatedCategoryCounts();
  renderTranslatedPopular();

  /* Bind all interactive events */
  bindTranslatedEvents();
}

/* =============================================
   Event Bindings
   ============================================= */
function bindTranslatedEvents() {
  /* Category filter dropdown */
  var catFilter = document.getElementById('category-filter');
  if (catFilter) {
    catFilter.addEventListener('change', function() {
      TranslatedAppState.currentCategory = this.value;
      TranslatedAppState.lastLoadedKey = null;
      TranslatedAppState.currentBatch = 0;
      TranslatedAppState.allFilteredVideos = null;
      syncSidebarActiveState();
      updateActiveFiltersUI();
      renderTranslatedVideos(false);
    });
  }
  
  /* Sort filter dropdown */
  var sortFilter = document.getElementById('sort-filter');
  if (sortFilter) {
    sortFilter.addEventListener('change', function() {
      TranslatedAppState.currentSort = this.value;
      TranslatedAppState.lastLoadedKey = null;
      TranslatedAppState.currentBatch = 0;
      TranslatedAppState.allFilteredVideos = null;
      renderTranslatedVideos(false);
    });
  }
  
  /* Sidebar category links */
  var sidebarCategories = document.getElementById('sidebar-categories');
  if (sidebarCategories) {
    sidebarCategories.addEventListener('click', function(e) {
      e.preventDefault();
      var link = e.target.closest('a[data-category]');
      if (!link) return;
      
      var allLinks = sidebarCategories.querySelectorAll('a');
      for (var i = 0; i < allLinks.length; i++) {
        allLinks[i].classList.remove('active');
      }
      link.classList.add('active');
      
      TranslatedAppState.currentCategory = link.dataset.category;
      TranslatedAppState.lastLoadedKey = null;
      TranslatedAppState.currentBatch = 0;
      TranslatedAppState.allFilteredVideos = null;
      if (catFilter) catFilter.value = TranslatedAppState.currentCategory;
      updateActiveFiltersUI();
      renderTranslatedVideos(false);
    });
  }
  
  /* Tag cloud — search by VJ name */
  var tagCloud = document.getElementById('tag-cloud');
  if (tagCloud) {
    tagCloud.addEventListener('click', function(e) {
      e.preventDefault();
      var tag = e.target.closest('.tag[data-vj]');
      if (!tag) return;
      
      var vjSlug = tag.dataset.vj;
      TranslatedAppState.currentCategory = vjSlug;
      TranslatedAppState.lastLoadedKey = null;
      TranslatedAppState.currentBatch = 0;
      TranslatedAppState.allFilteredVideos = null;
      
      if (catFilter) catFilter.value = vjSlug;
      syncSidebarActiveState();
      updateActiveFiltersUI();
      renderTranslatedVideos(false);
    });
  }
  
  /* Infinite scroll */
  setupInfiniteScroll();
  
  /* Clear all filters button */
  var clearBtn = document.getElementById('clear-all-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      clearTranslatedFilters();
    });
  }
}

/* =============================================
   Infinite Scroll
   ============================================= */
var infiniteScrollHandler = null;
var scrollThrottleTimer = null;

function setupInfiniteScroll() {
  if (infiniteScrollHandler) {
    window.removeEventListener('scroll', infiniteScrollHandler);
  }
  
  infiniteScrollHandler = function() {
    if (scrollThrottleTimer) return;
    scrollThrottleTimer = setTimeout(function() {
      scrollThrottleTimer = null;
      checkAndLoadMore();
    }, 100);
  };
  
  window.addEventListener('scroll', infiniteScrollHandler, { passive: true });
}

function checkAndLoadMore() {
  if (TranslatedAppState.isLoading) return;
  if (!TranslatedAppState.allFilteredVideos) return;
  
  var totalVideos = TranslatedAppState.allFilteredVideos.length;
  var displayedCount = TranslatedAppState.currentBatch * TranslatedAppState.itemsPerPage;
  
  if (displayedCount >= totalVideos) return;
  
  var scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
  var windowHeight = window.innerHeight;
  var documentHeight = document.documentElement.scrollHeight;
  
  if (scrollPosition + windowHeight >= documentHeight - 200) {
    loadNextBatch();
  }
}

function loadNextBatch() {
  if (TranslatedAppState.isLoading) return;
  
  var totalVideos = TranslatedAppState.allFilteredVideos.length;
  var startIndex = TranslatedAppState.currentBatch * TranslatedAppState.itemsPerPage;
  
  if (startIndex >= totalVideos) return;
  
  TranslatedAppState.isLoading = true;
  
  var endIndex = Math.min(startIndex + TranslatedAppState.itemsPerPage, totalVideos);
  var batchVideos = TranslatedAppState.allFilteredVideos.slice(startIndex, endIndex);
  
  var grid = document.getElementById('videos-grid');
  if (!grid) {
    TranslatedAppState.isLoading = false;
    return;
  }
  
  var fragment = document.createDocumentFragment();
  for (var i = 0; i < batchVideos.length; i++) {
    fragment.appendChild(createTranslatedVideoCard(batchVideos[i]));
  }
  grid.appendChild(fragment);
  
  TranslatedAppState.currentBatch++;
  TranslatedAppState.isLoading = false;
  
  initLazyLoading();
}

/* =============================================
   Active Filters UI
   ============================================= */
function updateActiveFiltersUI() {
  var filtersDiv = document.getElementById('active-filters');
  var chipsDiv = document.getElementById('active-filter-chips');
  var clearBtn = document.getElementById('clear-all-filters');

  if (!filtersDiv || !chipsDiv || !clearBtn) return;

  var hasActiveFilters = TranslatedAppState.currentSearch || TranslatedAppState.currentCategory !== 'all';

  if (hasActiveFilters) {
    filtersDiv.style.display = 'flex';
    var chipsHTML = '';

    if (TranslatedAppState.currentSearch) {
      chipsHTML += '<span class="active-filter-chip">Search: "' + escapeHTML(TranslatedAppState.currentSearch) + '"</span>';
    }

    if (TranslatedAppState.currentCategory !== 'all') {
      var catName = TranslatedAppState.currentCategory.replace('vj-', 'VJ ');
      chipsHTML += '<span class="active-filter-chip">VJ: ' + escapeHTML(catName) + '</span>';
    }

    chipsDiv.innerHTML = chipsHTML;
    clearBtn.style.display = 'inline-flex';
  } else {
    filtersDiv.style.display = 'none';
    clearBtn.style.display = 'none';
  }
}

/**
 * Clears all active filters and resets the grid.
 */
function clearTranslatedFilters() {
  TranslatedAppState.currentSearch = '';
  TranslatedAppState.currentCategory = 'all';
  TranslatedAppState.lastLoadedKey = null;
  TranslatedAppState.currentSort = 'recent';
  TranslatedAppState.currentBatch = 0;
  TranslatedAppState.allFilteredVideos = null;

  var catFilter = document.getElementById('category-filter');
  var sortFilter = document.getElementById('sort-filter');
  var searchInput = document.getElementById('sidebar-search');

  if (catFilter) catFilter.value = 'all';
  if (sortFilter) sortFilter.value = 'recent';
  if (searchInput) searchInput.value = '';

  syncSidebarActiveState();
  updateActiveFiltersUI();
  renderTranslatedVideos(false);
}

/* =============================================
   Firebase Fetch — Reads from cache when possible
   ============================================= */
function fetchTranslatedVideos(append) {
  return new Promise(function(resolve, reject) {
    var cached = getTranslatedCache();
    
    if (cached) {
      var result = processFilteredVideos(cached.metadata, cached.fullDataMap);
      
      if (cached.fromSession && !cached.fullDataMap) {
        loadFullDataInBackground();
      }
      
      resolve(result);
      return;
    }
    
    database.ref(TRANSLATED_FB_PATH).orderByKey().once('value').then(function(snapshot) {
      var videos = [];
      snapshot.forEach(function(child) {
        var data = child.val();
        data._id = child.key;
        videos.push(data);
      });
      
      setTranslatedCache(videos);
      
      var result = processFilteredVideos(TranslatedCache.metadata, TranslatedCache.fullDataMap);
      resolve(result);
    }).catch(function(err) {
      reject(err);
    });
  });
}

/**
 * Filters, sorts, and returns the first batch of videos.
 * Stores full filtered list for infinite scroll pagination.
 */
function processFilteredVideos(metadata, fullDataMap) {
  var videos = metadata.slice();
  
  /* Filter by VJ name */
  if (TranslatedAppState.currentCategory && TranslatedAppState.currentCategory !== 'all') {
    videos = videos.filter(function(v) {
      return (v.vjName || '').toLowerCase() === TranslatedAppState.currentCategory;
    });
  }
  
  /* Filter by search query */
  if (TranslatedAppState.currentSearch && TranslatedAppState.currentSearch.trim()) {
    var q = TranslatedAppState.currentSearch.toLowerCase();
    videos = videos.filter(function(v) {
      return (v.title || '').toLowerCase().indexOf(q) >= 0 ||
        (v.description || '').toLowerCase().indexOf(q) >= 0 ||
        (v.vjName || '').toLowerCase().indexOf(q) >= 0 ||
        (v.country || '').toLowerCase().indexOf(q) >= 0 ||
        (v.director || '').toLowerCase().indexOf(q) >= 0 ||
        (v.genre || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  
  /* Sort */
  if (TranslatedAppState.currentSort === 'views') {
    videos.sort(function(a, b) { return (b.views || 0) - (a.views || 0); });
  } else if (TranslatedAppState.currentSort === 'likes') {
    videos.sort(function(a, b) { return (b.likes || 0) - (a.likes || 0); });
  } else if (TranslatedAppState.currentSort === 'trending') {
    var now = Date.now();
    videos.sort(function(a, b) {
      var scoreA = (a.views || 0) + (a.likes || 0) * 5 + Math.max(0, 100000 - (now - (a.createdAt || 0))) / 1000;
      var scoreB = (b.views || 0) + (b.likes || 0) * 5 + Math.max(0, 100000 - (now - (b.createdAt || 0))) / 1000;
      return scoreB - scoreA;
    });
  } else {
    videos.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }
  
  TranslatedAppState.allFilteredVideos = videos;
  
  var firstBatch = videos.slice(0, TranslatedAppState.itemsPerPage);
  var hasMore = videos.length > TranslatedAppState.itemsPerPage;
  
  return {
    videos: firstBatch,
    hasMore: hasMore,
    lastKey: firstBatch.length > 0 ? firstBatch[firstBatch.length - 1]._id : null,
    total: videos.length
  };
}

/* =============================================
   Video Card
   ============================================= */
function createTranslatedVideoCard(v) {
  var id = v._id || '';
  var thumb = v.thumbnailSrc || getThumbnailUrl(v);
  var title = v.title || 'Untitled Video';
  var desc = v.description || '';
  var views = formatNumber(v.views || 0);
  var likes = formatNumber(v.likes || 0);
  var dislikes = formatNumber(v.dislikes || 0);
  var country = v.country || '';
  var year = v.year || '';
  var genre = v.genre || '';
  var rated = v.rated || '';
  var imdbRating = v.imdbRating || '';
  var runtime = v.runtime || '';
  var director = v.director || '';
  var vjRaw = v.vjName || '';
  var vjName = vjRaw.replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim();
  
  var videoUrl = v.videoUrl || '';
  if (!videoUrl && TranslatedCache.fullDataMap && TranslatedCache.fullDataMap[id]) {
    videoUrl = TranslatedCache.fullDataMap[id].videoUrl || '';
  }
  
  var safeTitle = escapeHTML(title);
  var safeDesc = desc.length > 120 ? escapeHTML(desc.substring(0, 120)) + '...' : escapeHTML(desc);
  var isFav = AppState.favouriteVideos.indexOf(id) >= 0;
  
  var card = document.createElement('article');
  card.className = 'video-card';
  card.setAttribute('role', 'link');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', title);
  
  /* Meta badges */
  var metaBadges = '';
  if (year) metaBadges += '<span class="card-meta-year">' + escapeHTML(year) + '</span>';
  if (rated && rated !== 'N/A') metaBadges += '<span class="card-meta-rated">' + escapeHTML(rated) + '</span>';
  if (runtime && runtime !== 'N/A') metaBadges += '<span class="card-meta-runtime">' + escapeHTML(runtime) + '</span>';
  if (imdbRating && imdbRating !== 'N/A') metaBadges += '<span class="card-meta-imdb"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z"/></svg> ' + escapeHTML(imdbRating) + '</span>';
  if (vjName) metaBadges += '<span class="card-vj-name">' + escapeHTML(vjName) + '</span>';
  
  /* Country badge */
  var countryHTML = country ? '<span class="video-card-country">' + escapeHTML(country) + '</span>' : '';
  
  card.innerHTML =
    '<div class="video-card-thumb">' +
    '<img src="' + thumb + '" alt="' + safeTitle + '" loading="lazy" onerror="this.src=\'https://placehold.co/640x360/e63946/ffffff?text=No+Image\'">' +
    '<div class="video-card-overlay">' +
    '<div class="play-btn-overlay"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div>' +
    '<div class="card-actions">' +
    '<button class="card-action-btn fav-btn ' + (isFav ? 'active' : '') + '" data-id="' + id + '" title="Favourite">' +
    '<svg viewBox="0 0 24 24" fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
    '</button>' +
    '<button class="card-action-btn dl-btn" data-id="' + id + '" data-url="' + (videoUrl ? escapeHTML(videoUrl) : '') + '" data-title="' + safeTitle + '" title="Download">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 8 12 3 17 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
    '</button>' +
    '</div>' +
    '</div>' +
    (runtime ? '<span class="video-card-duration">' + escapeHTML(runtime) + '</span>' : '') +
    '</div>' +
    '<div class="video-card-body">' +
    '<h3 class="video-card-title">' + safeTitle + '</h3>' +
    (metaBadges ? '<div class="card-meta-badges">' + metaBadges + '</div>' : '') +
    (countryHTML ? '<div class="video-card-stats">' + countryHTML + '</div>' : '') +
    '</div>';
  
  /* Click to navigate to video.html */
  card.addEventListener('click', function(e) {
    if (e.target.closest('.card-action-btn')) return;
    window.location.href = 'video.html?id=' + id + '&source=translated';
  });
  card.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') window.location.href = 'video.html?id=' + id + '&source=translated';
  });
  
  /* Favourite button */
  var favBtn = card.querySelector('.fav-btn');
  if (favBtn) {
    favBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (!AppState.currentUser) {
        showToast('Please sign in to add favourites', 'warning');
        return;
      }
      toggleFavourite(id);
      this.classList.toggle('active');
      var svg = this.querySelector('svg');
      if (svg) svg.setAttribute('fill', this.classList.contains('active') ? 'currentColor' : 'none');
    });
  }
  
  /* Download button */
  var dlBtn = card.querySelector('.dl-btn');
  if (dlBtn) {
    dlBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var url = this.getAttribute('data-url');
      if (!url) {
        showToast('Video not available for download', 'error');
        return;
      }
      handleFileDownload(url, this.dataset.title || 'video');
    });
  }
  
  return card;
}

/* =============================================
   Render Video Grid
   ============================================= */
function renderTranslatedVideos(append) {
  var grid = document.getElementById('videos-grid');
  var loadMoreContainer = document.getElementById('load-more-container');
  var noVideos = document.getElementById('no-videos');
  
  if (!grid) return;
  if (!append) {
    grid.innerHTML = '';
    TranslatedAppState.currentBatch = 1;
  }
  
  /* SYNCHRONOUS PATH — zero delay when cache exists */
  var cached = getTranslatedCacheSync();
  if (cached && cached.metadata) {
    var result = processFilteredVideos(cached.metadata, cached.fullDataMap);
    
    if (result.videos.length === 0 && !append) {
      if (noVideos) noVideos.style.display = 'block';
      if (loadMoreContainer) loadMoreContainer.style.display = 'none';
      TranslatedAppState.allFilteredVideos = [];
      return;
    }
    
    if (noVideos) noVideos.style.display = 'none';
    
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < result.videos.length; i++) {
      fragment.appendChild(createTranslatedVideoCard(result.videos[i]));
    }
    grid.appendChild(fragment);
    
    initLazyLoading();
    
    var badge = document.getElementById('video-count-badge');
    if (badge) badge.textContent = result.total + ' Translations';
    
    if (loadMoreContainer) loadMoreContainer.style.display = 'none';
    
    if (cached.fromSession) {
      refreshCacheInBackground();
    }
    return;
  }
  
  /* ASYNC PATH — only when no cache available */
  fetchTranslatedVideos(append).then(function(result) {
    if (result.videos.length === 0 && !append) {
      grid.innerHTML = '';
      if (noVideos) noVideos.style.display = 'block';
      if (loadMoreContainer) loadMoreContainer.style.display = 'none';
      TranslatedAppState.allFilteredVideos = [];
      return;
    }
    
    if (noVideos) noVideos.style.display = 'none';
    
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < result.videos.length; i++) {
      fragment.appendChild(createTranslatedVideoCard(result.videos[i]));
    }
    grid.appendChild(fragment);
    
    initLazyLoading();
    
    var badge = document.getElementById('video-count-badge');
    if (badge) badge.textContent = result.total + ' Translations';
    
    if (loadMoreContainer) loadMoreContainer.style.display = 'none';
  }).catch(function(err) {
    console.error('Translated fetch error:', err);
    if (!append) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><h3>Could not load translations</h3><p>Please check your connection and try again.</p></div>';
    }
  });
}

/* =============================================
   Category Counts — Uses cache to avoid extra Firebase reads
   ============================================= */
function updateTranslatedCategoryCounts() {
  var cached = getTranslatedCache();
  
  if (cached && cached.metadata) {
    processCategoryCounts(cached.metadata);
    return;
  }
  
  waitForCache().then(function(cache) {
    if (cache && cache.metadata) {
      processCategoryCounts(cache.metadata);
    }
  }).catch(function(err) {
    console.error('Category count error:', err);
  });
}

function getTranslatedCacheSync() {
  if (TranslatedCache.isLoaded && TranslatedCache.metadata) {
    return { metadata: TranslatedCache.metadata, fullDataMap: TranslatedCache.fullDataMap, fromSession: false };
  }
  var sessionData = loadSessionCache();
  if (sessionData && sessionData.metadata) {
    TranslatedCache.metadata = sessionData.metadata;
    TranslatedCache.lastFetchTime = sessionData.lastFetchTime;
    return { metadata: sessionData.metadata, fullDataMap: null, fromSession: true };
  }
  return null;
}

/**
 * Computes and updates category count badges from metadata.
 */
function processCategoryCounts(metadata) {
  var setCount = function(id, count) {
    var el = document.getElementById(id);
    if (el) el.textContent = count;
  };

  setCount('count-all', metadata.length);

  var categories = [
    'vj-junior', 'vj-jingo', 'vj-emmy', 'vj-ice-p', 'vj-mark', 'vj-kevo',
    'vj-hd', 'vj-silver', 'vj-heavy-q', 'vj-lance', 'vj-jimmy', 'vj-grade',
    'vj-ivo', 'vj-muba', 'vj-ulio', 'vj-kimuli', 'vj-banks', 'vj-tom',
    'vj-dan-de', 'vj-eddy', 'vj-ks', 'vj-henrico', 'vj-cabs', 'vj-fredy',
    'vj-baros', 'vj-jovan', 'vj-kevin', 'vj-nelly', 'vj-kriss', 'vj-soul'
  ];

  for (var i = 0; i < categories.length; i++) {
    var cat = categories[i];
    var count = 0;
    for (var j = 0; j < metadata.length; j++) {
      if ((metadata[j].vjName || '').toLowerCase() === cat) {
        count++;
      }
    }
    setCount('count-' + cat, count);
  }
}

/* =============================================
   Popular Videos Widget — Uses cache
   ============================================= */
function renderTranslatedPopular() {
  var container = document.getElementById('popular-videos-widget');
  if (!container) return;

  var cached = getTranslatedCache();
  
  if (cached && cached.metadata) {
    processPopularVideos(container, cached.metadata);
    
    if (cached.fromSession && !cached.fullDataMap) {
      loadFullDataInBackground();
    }
    return;
  }
  
  waitForCache().then(function(cache) {
    if (cache && cache.metadata) {
      processPopularVideos(container, cache.metadata);
    } else {
      container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">No translations yet.</p>';
    }
  }).catch(function(err) {
    console.error('Popular widget error:', err);
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">Could not load.</p>';
  });
}

/**
 * Renders the popular videos widget from metadata.
 */
function processPopularVideos(container, metadata) {
  container.innerHTML = '';

  if (metadata.length === 0) {
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">No translations yet.</p>';
    return;
  }

  var sorted = metadata.slice().sort(function(a, b) {
    return (b.views || 0) - (a.views || 0);
  });
  var top8 = sorted.slice(0, 8);

  var fragment = document.createDocumentFragment();
  for (var i = 0; i < top8.length; i++) {
    var v = top8[i];
    var vjName = (v.vjName || 'Unknown').replace('vj-', 'VJ ');

    var item = document.createElement('div');
    item.className = 'widget-video-item';
    item.style.cursor = 'pointer';

    item.innerHTML =
      '<div class="widget-video-thumb">' +
        '<img src="' + getThumbnailUrl(v) + '" alt="' + escapeHTML(v.title || 'Untitled') + '" onerror="this.src=\'https://placehold.co/100x64/e63946/fff?text=No+Image\'">' +
      '</div>' +
      '<div class="widget-video-info">' +
        '<h4>' + escapeHTML(v.title || 'Untitled') + '</h4>' +
        '<span class="widget-vj-name">' + escapeHTML(vjName) + '</span>' +
        '<span>' + formatNumber(v.views || 0) + ' views</span>' +
      '</div>';

    (function(videoId) {
      item.addEventListener('click', function() {
        window.location.href = 'video.html?id=' + videoId + '&source=translated';
      });
    })(v._id);

    fragment.appendChild(item);
  }

  container.appendChild(fragment);
  initLazyLoading();
}