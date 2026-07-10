/* =============================================
   Series Page Logic
   Reads from the "Series" node in Firebase
   Handles both series.html (listing) and
   watch.html (detail / season / episode player)
   ============================================= */

var SeriesAppState = {
  lastLoadedKey: null,
  currentGenre: 'all',
  currentStatus: 'all',
  currentSort: 'recent',
  currentSearch: '',
  itemsPerPage: 8
};

var SERIES_FB_PATH = 'Series';

/* =============================================
   Auto-detect which page and initialize
   Waits for app.js to be fully loaded first
   ============================================= */

var _seriesInitAttempts = 0;
var _seriesMaxAttempts = 100;

function _waitForAppAndInit() {
  _seriesInitAttempts++;

  // Check if Firebase is loaded
  if (typeof firebase === 'undefined') {
    if (_seriesInitAttempts < _seriesMaxAttempts) {
      setTimeout(_waitForAppAndInit, 100);
    } else {
      console.error('[Series] ERROR: Firebase SDK not loaded. Check script tags in HTML.');
    }
    return;
  }

  // Check if database is initialized by app.js
  if (typeof database === 'undefined' || database === null) {
    if (_seriesInitAttempts < _seriesMaxAttempts) {
      setTimeout(_waitForAppAndInit, 100);
    } else {
      console.error('[Series] ERROR: database not initialized. Check if app.js loaded correctly.');
    }
    return;
  }

  // Check if required app.js functions exist
  if (typeof escapeHTML === 'undefined' || typeof formatNumber === 'undefined' || typeof getThumbnailUrl === 'undefined') {
    if (_seriesInitAttempts < _seriesMaxAttempts) {
      setTimeout(_waitForAppAndInit, 100);
    } else {
      console.error('[Series] ERROR: Required app.js functions not available.');
    }
    return;
  }

  // Everything is ready
  console.log('[Series] app.js ready, initializing... (attempt ' + _seriesInitAttempts + ')');

  if (document.getElementById('series-page-content')) {
    console.log('[Series] Detected series.html — calling initSeriesPage()');
    initSeriesPage();
  }
  if (document.getElementById('watch-page-content')) {
    console.log('[Series] Detected watch.html — calling initWatchPage()');
    initWatchPage();
  }
}

// Start the initialization check when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(_waitForAppAndInit, 50);
  });
} else {
  setTimeout(_waitForAppAndInit, 50);
}

/* ==========================================================
   SERIES.HTML — Listing Page
   ========================================================== */

function initSeriesPage() {
  console.log('[Series] initSeriesPage() started');

  var urlParams = new URLSearchParams(window.location.search);

  SeriesAppState.currentSearch = urlParams.get('search') || '';
  var sortParam = urlParams.get('sort');
  if (sortParam === 'trending' || sortParam === 'views' || sortParam === 'likes' || sortParam === 'rating' || sortParam === 'title') {
    SeriesAppState.currentSort = sortParam;
  }

  var genreParam = urlParams.get('genre');
  if (genreParam) SeriesAppState.currentGenre = genreParam;

  var statusParam = urlParams.get('status');
  if (statusParam === 'ongoing' || statusParam === 'completed') {
    SeriesAppState.currentStatus = statusParam;
  }

  /* Apply initial state to DOM */
  var genreFilter = document.getElementById('genre-filter');
  var sortFilter = document.getElementById('sort-filter');
  var statusFilter = document.getElementById('status-filter');
  var searchInput = document.getElementById('sidebar-search');
  var heroTitle = document.getElementById('viewall-title');
  var breadcrumb = document.getElementById('breadcrumb-current');

  if (genreFilter) genreFilter.value = SeriesAppState.currentGenre;
  if (sortFilter) sortFilter.value = SeriesAppState.currentSort;
  if (statusFilter) statusFilter.value = SeriesAppState.currentStatus;
  if (searchInput && SeriesAppState.currentSearch) searchInput.value = SeriesAppState.currentSearch;
  if (heroTitle) heroTitle.textContent = 'All Series';
  if (breadcrumb) breadcrumb.textContent = 'TV Series';

  updateSeriesActiveFiltersUI();
  renderSeriesVideos(false);
  updateSeriesGenreCounts();
  renderSeriesPopular();

  bindSeriesEvents();

  console.log('[Series] initSeriesPage() complete');
}

/* =============================================
   Event Bindings — series.html
   ============================================= */
function bindSeriesEvents() {
  /* Genre filter dropdown */
  var genreFilter = document.getElementById('genre-filter');
  if (genreFilter) {
    genreFilter.addEventListener('change', function () {
      SeriesAppState.currentGenre = this.value;
      SeriesAppState.lastLoadedKey = null;
      syncSeriesSidebarActive();
      updateSeriesActiveFiltersUI();
      renderSeriesVideos(false);
    });
  }

  /* Status filter dropdown */
  var statusFilter = document.getElementById('status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', function () {
      SeriesAppState.currentStatus = this.value;
      SeriesAppState.lastLoadedKey = null;
      updateSeriesActiveFiltersUI();
      renderSeriesVideos(false);
    });
  }

  /* Sort filter dropdown */
  var sortFilter = document.getElementById('sort-filter');
  if (sortFilter) {
    sortFilter.addEventListener('change', function () {
      SeriesAppState.currentSort = this.value;
      SeriesAppState.lastLoadedKey = null;
      renderSeriesVideos(false);
    });
  }

  /* Sidebar genre links */
  var sidebarGenres = document.getElementById('sidebar-genres');
  if (sidebarGenres) {
    sidebarGenres.addEventListener('click', function (e) {
      e.preventDefault();
      var link = e.target.closest('a[data-genre]');
      if (!link) return;

      var allLinks = sidebarGenres.querySelectorAll('a');
      for (var i = 0; i < allLinks.length; i++) {
        allLinks[i].classList.remove('active');
      }
      link.classList.add('active');

      SeriesAppState.currentGenre = link.dataset.genre;
      SeriesAppState.lastLoadedKey = null;
      if (genreFilter) genreFilter.value = SeriesAppState.currentGenre;
      updateSeriesActiveFiltersUI();
      renderSeriesVideos(false);
    });
  }

  /* Sidebar status links */
  var sidebarStatus = document.getElementById('sidebar-status');
  if (sidebarStatus) {
    sidebarStatus.addEventListener('click', function (e) {
      e.preventDefault();
      var link = e.target.closest('a[data-status]');
      if (!link) return;

      var status = link.dataset.status;
      SeriesAppState.currentStatus = status;
      SeriesAppState.lastLoadedKey = null;
      if (statusFilter) statusFilter.value = status;
      updateSeriesActiveFiltersUI();
      renderSeriesVideos(false);
    });
  }

  /* Sidebar search */
  var sidebarSearchBtn = document.getElementById('sidebar-search-btn');
  if (sidebarSearchBtn) {
    sidebarSearchBtn.addEventListener('click', function () {
      var input = document.getElementById('sidebar-search');
      if (input) {
        SeriesAppState.currentSearch = input.value.trim();
        SeriesAppState.lastLoadedKey = null;
        updateSeriesActiveFiltersUI();
        renderSeriesVideos(false);
      }
    });
  }

  var sidebarSearchInput = document.getElementById('sidebar-search');
  if (sidebarSearchInput) {
    var searchTimer = null;
    sidebarSearchInput.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        SeriesAppState.currentSearch = sidebarSearchInput.value.trim();
        SeriesAppState.lastLoadedKey = null;
        updateSeriesActiveFiltersUI();
        renderSeriesVideos(false);
      }, 400);
    });
    sidebarSearchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        clearTimeout(searchTimer);
        SeriesAppState.currentSearch = sidebarSearchInput.value.trim();
        SeriesAppState.lastLoadedKey = null;
        updateSeriesActiveFiltersUI();
        renderSeriesVideos(false);
      }
    });
  }

  /* Load More button */
  var loadMoreBtn = document.getElementById('load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function () {
      var btn = this;
      btn.style.display = 'none';
      var spinner = document.getElementById('load-more-spinner');
      if (spinner) spinner.style.display = 'block';

      renderSeriesVideos(true).then(function () {
        btn.style.display = 'inline-flex';
        if (spinner) spinner.style.display = 'none';
      });
    });
  }

  /* Clear all filters */
  var clearBtn = document.getElementById('clear-all-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      clearSeriesFilters();
    });
  }

  /* Tag cloud clicks */
  var tagCloud = document.getElementById('tag-cloud');
  if (tagCloud) {
    tagCloud.addEventListener('click', function (e) {
      e.preventDefault();
      var tag = e.target.closest('.tag');
      if (!tag) return;

      var genre = tag.dataset.genre;
      if (genre) {
        SeriesAppState.currentGenre = genre;
        SeriesAppState.lastLoadedKey = null;
        if (genreFilter) genreFilter.value = genre;
        syncSeriesSidebarActive();
        updateSeriesActiveFiltersUI();
        renderSeriesVideos(false);
      }
    });
  }
}

function syncSeriesSidebarActive() {
  var sidebarGenres = document.getElementById('sidebar-genres');
  if (!sidebarGenres) return;
  var allLinks = sidebarGenres.querySelectorAll('a');
  for (var i = 0; i < allLinks.length; i++) {
    allLinks[i].classList.toggle('active', allLinks[i].dataset.genre === SeriesAppState.currentGenre);
  }
}

/* =============================================
   Active Filters UI
   ============================================= */
function updateSeriesActiveFiltersUI() {
  var filtersDiv = document.getElementById('active-filters');
  var chipsDiv = document.getElementById('active-filter-chips');
  var clearBtn = document.getElementById('clear-all-filters');

  if (!filtersDiv || !chipsDiv || !clearBtn) return;

  var hasActive = SeriesAppState.currentSearch ||
    SeriesAppState.currentGenre !== 'all' ||
    SeriesAppState.currentStatus !== 'all';

  if (hasActive) {
    filtersDiv.style.display = 'flex';
    var chips = '';

    if (SeriesAppState.currentSearch) {
      chips += '<span class="active-filter-chip">Search: "' + escapeHTML(SeriesAppState.currentSearch) + '"</span>';
    }
    if (SeriesAppState.currentGenre !== 'all') {
      chips += '<span class="active-filter-chip">Genre: ' + escapeHTML(SeriesAppState.currentGenre) + '</span>';
    }
    if (SeriesAppState.currentStatus !== 'all') {
      chips += '<span class="active-filter-chip">Status: ' + escapeHTML(SeriesAppState.currentStatus) + '</span>';
    }

    chipsDiv.innerHTML = chips;
    clearBtn.style.display = 'inline-flex';
  } else {
    filtersDiv.style.display = 'none';
    clearBtn.style.display = 'none';
  }
}

function clearSeriesFilters() {
  SeriesAppState.currentSearch = '';
  SeriesAppState.currentGenre = 'all';
  SeriesAppState.currentStatus = 'all';
  SeriesAppState.lastLoadedKey = null;
  SeriesAppState.currentSort = 'recent';

  var genreFilter = document.getElementById('genre-filter');
  var sortFilter = document.getElementById('sort-filter');
  var statusFilter = document.getElementById('status-filter');
  var searchInput = document.getElementById('sidebar-search');

  if (genreFilter) genreFilter.value = 'all';
  if (sortFilter) sortFilter.value = 'recent';
  if (statusFilter) statusFilter.value = 'all';
  if (searchInput) searchInput.value = '';

  syncSeriesSidebarActive();
  updateSeriesActiveFiltersUI();
  renderSeriesVideos(false);
}

/* =============================================
   Firebase Fetch — Series node
   ============================================= */
function fetchSeriesVideos(append) {
  console.log('[Series] fetchSeriesVideos()', { append: append, genre: SeriesAppState.currentGenre, status: SeriesAppState.currentStatus, sort: SeriesAppState.currentSort, search: SeriesAppState.currentSearch });

  var ref = database.ref(SERIES_FB_PATH).orderByKey();

  return ref.once('value').then(function (snapshot) {
    var seriesList = [];
    snapshot.forEach(function (child) {
      var data = child.val();
      if (!data || !data.title) return; // Skip entries without title
      data._id = child.key;
      seriesList.push(data);
    });

    console.log('[Series] Fetched ' + seriesList.length + ' series from Firebase');

    /* Filter by genre */
    if (SeriesAppState.currentGenre && SeriesAppState.currentGenre !== 'all') {
      seriesList = seriesList.filter(function (s) {
        return (s.genre || '').toLowerCase() === SeriesAppState.currentGenre.toLowerCase();
      });
    }

    /* Filter by status */
    if (SeriesAppState.currentStatus && SeriesAppState.currentStatus !== 'all') {
      seriesList = seriesList.filter(function (s) {
        return (s.status || '').toLowerCase() === SeriesAppState.currentStatus.toLowerCase();
      });
    }

    /* Filter by search */
    if (SeriesAppState.currentSearch && SeriesAppState.currentSearch.trim()) {
      var q = SeriesAppState.currentSearch.toLowerCase();
      seriesList = seriesList.filter(function (s) {
        return (s.title || '').toLowerCase().indexOf(q) >= 0 ||
          (s.description || '').toLowerCase().indexOf(q) >= 0 ||
          (s.network || '').toLowerCase().indexOf(q) >= 0 ||
          (s.creator || '').toLowerCase().indexOf(q) >= 0 ||
          (s.cast || '').toLowerCase().indexOf(q) >= 0 ||
          (s.country || '').toLowerCase().indexOf(q) >= 0 ||
          (s.genre || '').toLowerCase().indexOf(q) >= 0;
      });
    }

    /* Sort */
    if (SeriesAppState.currentSort === 'views') {
      seriesList.sort(function (a, b) { return (b.views || 0) - (a.views || 0); });
    } else if (SeriesAppState.currentSort === 'likes') {
      seriesList.sort(function (a, b) { return (b.likes || 0) - (a.likes || 0); });
    } else if (SeriesAppState.currentSort === 'rating') {
      seriesList.sort(function (a, b) { return parseFloat(b.imdbRating || 0) - parseFloat(a.imdbRating || 0); });
    } else if (SeriesAppState.currentSort === 'title') {
      seriesList.sort(function (a, b) { return (a.title || '').localeCompare(b.title || ''); });
    } else if (SeriesAppState.currentSort === 'trending') {
      var now = Date.now();
      seriesList.sort(function (a, b) {
        var scoreA = (a.views || 0) + (a.likes || 0) * 5 + Math.max(0, 100000 - (now - (a.createdAt || 0))) / 1000;
        var scoreB = (b.views || 0) + (b.likes || 0) * 5 + Math.max(0, 100000 - (now - (b.createdAt || 0))) / 1000;
        return scoreB - scoreA;
      });
    } else {
      seriesList.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    }

    /* Pagination */
    var startIdx = 0;
    if (append && SeriesAppState.lastLoadedKey) {
      var idx = seriesList.findIndex(function (s) { return s._id === SeriesAppState.lastLoadedKey; });
      if (idx >= 0) startIdx = idx + 1;
    }

    var page = seriesList.slice(startIdx, startIdx + SeriesAppState.itemsPerPage);
    var hasMore = startIdx + SeriesAppState.itemsPerPage < seriesList.length;

    SeriesAppState.lastLoadedKey = page.length > 0 ? page[page.length - 1]._id : null;

    console.log('[Series] Returning ' + page.length + ' series, hasMore:', hasMore);

    return {
      series: page,
      hasMore: hasMore,
      lastKey: SeriesAppState.lastLoadedKey,
      total: seriesList.length
    };
  });
}

/* =============================================
   Series Card — for listing page
   ============================================= */
function createSeriesCard(s) {
  var id = s._id || '';
  var thumb = getThumbnailUrl(s);
  var title = s.title || 'Untitled Series';
  var desc = s.description || '';
  var views = formatNumber(s.views || 0);
  var likes = formatNumber(s.likes || 0);
  var country = s.country || '';
  var year = s.year || '';
  var genre = s.genre || '';
  var rated = s.rated || '';
  var imdbRating = s.imdbRating || '';
  var network = s.network || '';
  var status = s.status || '';
  var creator = s.creator || '';
  var totalSeasons = s.totalSeasons || 0;
  var totalEpisodes = s.totalEpisodes || 0;

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
  if (year) metaBadges += '<span class="card-meta-year">' + escapeHTML(year) + (s.endDate ? '–' + escapeHTML(s.endDate) : '') + '</span>';
  if (rated && rated !== 'N/A') metaBadges += '<span class="card-meta-rated">' + escapeHTML(rated) + '</span>';
  if (imdbRating && imdbRating !== 'N/A') metaBadges += '<span class="card-meta-imdb"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z"/></svg> ' + escapeHTML(imdbRating) + '</span>';

  /* Genre */
  var genreHTML = genre ? '<span class="card-meta-genre">' + escapeHTML(genre) + '</span>' : '';

  /* Creator */
  var creatorHTML = creator ? '<span class="card-meta-genre">' + escapeHTML('Creator: ' + creator) + '</span>' : '';

  /* Description */
  var descHTML = desc ? '<p class="video-card-desc">' + safeDesc + '</p>' : '';

  /* Country badge */
  var countryHTML = country ? '<span class="video-card-country">' + escapeHTML(country) + '</span>' : '';

  /* Status badge */
  var statusHTML = '';
  if (status) {
    var statusClass = status.toLowerCase() === 'ongoing' ? 'ongoing' : 'completed';
    statusHTML = '<div style="margin-bottom:6px;display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:600;' +
      (statusClass === 'ongoing'
        ? 'background:rgba(0,184,148,0.1);border:1px solid rgba(0,184,148,0.2);color:#00b894;'
        : 'background:rgba(116,185,255,0.1);border:1px solid rgba(116,185,255,0.2);color:#74b9ff;') +
      '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">' +
      (statusClass === 'ongoing'
        ? '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
        : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>') +
      '</svg><span>' + escapeHTML(status) + '</span></div>';
  }

  /* Seasons/Episodes badge */
  var seHTML = '';
  if (totalSeasons > 0) {
    seHTML = '<div style="margin-bottom:6px;display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:rgba(230,57,70,0.1);border:1px solid rgba(230,57,70,0.2);border-radius:20px;font-size:0.75rem;font-weight:600;color:#e63946;">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="#e63946" stroke-width="2" width="13" height="13"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>' +
      '<span>' + totalSeasons + ' Season' + (totalSeasons !== 1 ? 's' : '') + ' · ' + totalEpisodes + ' Episode' + (totalEpisodes !== 1 ? 's' : '') + '</span></div>';
  }

  card.innerHTML =
    '<div class="video-card-thumb">' +
    '<img src="' + thumb + '" alt="' + safeTitle + '" loading="lazy" onerror="this.src=\'https://placehold.co/640x360/e63946/ffffff?text=No+Image\'">' +
    '<div class="video-card-overlay">' +
    '<div class="play-btn-overlay"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div>' +
    '<div class="card-actions">' +
    '<button class="card-action-btn fav-btn ' + (isFav ? 'active' : '') + '" data-id="' + id + '" title="Favourite">' +
    '<svg viewBox="0 0 24 24" fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
    '</button>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<div class="video-card-body">' +
    '<h3 class="video-card-title">' + safeTitle + '</h3>' +
    statusHTML +
    seHTML +
    (metaBadges ? '<div class="card-meta-badges">' + metaBadges + '</div>' : '') +
    genreHTML +
    creatorHTML +
    descHTML +
    '<div class="video-card-stats">' +
    countryHTML +
    '<span>' + escapeHTML(network) + '</span>' +
    '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ' + views + '</span>' +
    '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg> ' + likes + '</span>' +
    '</div>' +
    '</div>';

  /* Click → navigate to watch.html */
  card.addEventListener('click', function (e) {
    if (e.target.closest('.card-action-btn')) return;
    window.location.href = 'watch.html?id=' + id + '&source=series';
  });
  card.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') window.location.href = 'watch.html?id=' + id + '&source=series';
  });

  /* Favourite button */
  var favBtn = card.querySelector('.fav-btn');
  if (favBtn) {
    favBtn.addEventListener('click', function (e) {
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

  return card;
}

/* =============================================
   Render Series Grid — listing page
   ============================================= */
function renderSeriesVideos(append) {
  var grid = document.getElementById('videos-grid');
  var loadMoreContainer = document.getElementById('load-more-container');
  var noVideos = document.getElementById('no-videos');

  if (!grid) return;
  if (!append) grid.innerHTML = '';

  fetchSeriesVideos(append).then(function (result) {
    if (result.series.length === 0 && !append) {
      grid.innerHTML = '';
      if (noVideos) noVideos.style.display = 'block';
      if (loadMoreContainer) loadMoreContainer.style.display = 'none';
      return;
    }

    if (noVideos) noVideos.style.display = 'none';

    var fragment = document.createDocumentFragment();
    result.series.forEach(function (s) {
      fragment.appendChild(createSeriesCard(s));
    });
    grid.appendChild(fragment);

    if (typeof initLazyLoading === 'function') initLazyLoading();

    var badge = document.getElementById('video-count-badge');
    if (badge) badge.textContent = result.total + ' Series';

    if (result.hasMore) {
      if (loadMoreContainer) loadMoreContainer.style.display = 'flex';
    } else {
      if (loadMoreContainer) loadMoreContainer.style.display = 'none';
    }
  }).catch(function (err) {
    console.error('[Series] fetch error:', err);
    if (!append) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><h3>Could not load series</h3><p>Please check your connection and try again.</p></div>';
    }
  });
}

/* =============================================
   Genre Counts — sidebar
   ============================================= */
function updateSeriesGenreCounts() {
  database.ref(SERIES_FB_PATH).once('value').then(function (snapshot) {
    var allSeries = [];
    snapshot.forEach(function (child) {
      var data = child.val();
      if (data && data.title) allSeries.push(data);
    });

    var setCount = function (id, count) {
      var el = document.getElementById(id);
      if (el) el.textContent = count;
    };

    setCount('count-all', allSeries.length);

    var genres = [
      'Action', 'Adventure', 'Animation', 'Anime', 'Biography',
      'Comedy', 'Crime', 'Documentary', 'Drama', 'Fantasy',
      'Historical', 'Horror', 'Mystery', 'Romance', 'Sci-Fi',
      'Thriller', 'War', 'Western', 'Family', 'Sitcom',
      'Mini-Series', 'Science Fiction', 'Supernatural', 'Psychological',
      'Political', 'Legal', 'Medical', 'Musical', 'Sport', 'Anthology', 'Reality'
    ];

    genres.forEach(function (genre) {
      var count = allSeries.filter(function (s) {
        return (s.genre || '').toLowerCase() === genre.toLowerCase();
      }).length;
      setCount('count-' + genre.toLowerCase().replace(/\s+/g, '-'), count);
    });

    /* Status counts */
    var ongoingCount = allSeries.filter(function (s) { return (s.status || '').toLowerCase() === 'ongoing'; }).length;
    var completedCount = allSeries.filter(function (s) { return (s.status || '').toLowerCase() === 'completed'; }).length;
    setCount('count-ongoing', ongoingCount);
    setCount('count-completed', completedCount);

    console.log('[Series] Genre counts updated. Total:', allSeries.length);
  }).catch(function (err) {
    console.error('[Series] Genre count error:', err);
  });
}

/* =============================================
   Popular Series Widget — sidebar
   ============================================= */
function renderSeriesPopular() {
  var container = document.getElementById('popular-videos-widget');
  if (!container) return;

  fetchSeriesVideos(false).then(function (result) {
    container.innerHTML = '';

    if (result.series.length === 0) {
      container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">No series yet.</p>';
      return;
    }

    var popular = result.series.slice().sort(function (a, b) {
      return (b.views || 0) - (a.views || 0);
    });
    var top8 = popular.slice(0, 8);

    var fragment = document.createDocumentFragment();
    top8.forEach(function (s) {
      var statusClass = (s.status || '').toLowerCase() === 'ongoing' ? 'ongoing' : 'completed';
      var item = document.createElement('div');
      item.className = 'widget-video-item';
      item.style.cursor = 'pointer';

      item.innerHTML =
        '<div class="widget-video-thumb">' +
        '<img src="' + getThumbnailUrl(s) + '" alt="' + escapeHTML(s.title || 'Untitled') + '" onerror="this.src=\'https://placehold.co/100x64/e63946/fff?text=No+Image\'">' +
        '</div>' +
        '<div class="widget-video-info">' +
        '<h4>' + escapeHTML(s.title || 'Untitled') + '</h4>' +
        '<span class="widget-vj-name" style="color:' + (statusClass === 'ongoing' ? 'var(--success)' : 'var(--info)') + ';">' + escapeHTML(s.status || '') + ' · ' + (s.totalSeasons || 0) + 'S</span>' +
        '<span>' + formatNumber(s.views || 0) + ' views</span>' +
        '</div>';

      item.addEventListener('click', function () {
        window.location.href = 'watch.html?id=' + s._id + '&source=series';
      });

      fragment.appendChild(item);
    });

    container.appendChild(fragment);
    if (typeof initLazyLoading === 'function') initLazyLoading();
  }).catch(function (err) {
    console.error('[Series] Popular widget error:', err);
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">Could not load.</p>';
  });
}

/* ==========================================================
   WATCH.HTML — Detail / Season / Episode Player Page
   ========================================================== */

var WatchState = {
  seriesId: null,
  seriesData: null,
  seasons: [],
  currentSeasonIdx: 0,
  currentEpisodeKey: null,
  currentEpisodeData: null
};

function initWatchPage() {
  console.log('[Series] initWatchPage() started');

  var urlParams = new URLSearchParams(window.location.search);
  var id = urlParams.get('id');
  var source = urlParams.get('source');

  console.log('[Series] URL params:', { id: id, source: source });

  if (!id) {
    console.warn('[Series] No series ID in URL');
    showWatchError('Series not found', 'No series ID provided in the URL.');
    return;
  }

  WatchState.seriesId = id;
  console.log('[Series] Loading series:', id);
  loadSeriesDetail(id);
}

function loadSeriesDetail(id) {
  console.log('[Series] loadSeriesDetail() for:', id);

  // Show loading state in header
  var headerEl = document.getElementById('watch-header');
  if (headerEl) {
    headerEl.innerHTML = '<div style="display:flex;align-items:center;gap:12px;padding:20px;">' +
      '<div class="spinner" style="width:24px;height:24px;border-width:3px;"></div>' +
      '<span style="color:var(--text-muted);">Loading series details...</span></div>';
  }

  database.ref(SERIES_FB_PATH + '/' + id).once('value').then(function (snap) {
    console.log('[Series] Firebase response exists:', snap.exists());

    if (!snap.exists()) {
      console.warn('[Series] Series not found in Firebase at path:', SERIES_FB_PATH + '/' + id);
      showWatchError('Series not found', 'This series may have been removed or doesn\'t exist.');
      return;
    }

    var data = snap.val();
    data._id = id;
    WatchState.seriesData = data;

    console.log('[Series] Series loaded:', data.title, '| Seasons:', Object.keys(data.seasons || {}).length);

    /* Increment views using transaction (safe) */
    database.ref(SERIES_FB_PATH + '/' + id + '/views').transaction(function (currentViews) {
      return (currentViews || 0) + 1;
    }).catch(function (err) {
      console.warn('[Series] View increment failed:', err.message);
    });

    /* Update breadcrumb */
    var breadcrumb = document.getElementById('breadcrumb-current');
    if (breadcrumb) breadcrumb.textContent = data.title || 'Series';

    /* Update page title */
    document.title = (data.title || 'Series') + ' — Xstream';

    /* Render the watch page */
    renderWatchHeader(data);
    loadSeasonsData(id);
    loadRelatedSeries(id, data);

  }).catch(function (err) {
    console.error('[Series] loadSeriesDetail error:', err);
    showWatchError('Failed to load', 'Please check your connection and try again.');
  });
}

function showWatchError(title, message) {
  var grid = document.querySelector('.video-page-grid');
  var notFound = document.getElementById('video-not-found');
  var headerEl = document.getElementById('watch-header');
  var seasonsContainer = document.getElementById('seasons-container');

  if (grid) grid.style.display = 'none';
  if (notFound) {
    notFound.style.display = 'block';
    notFound.querySelector('h3').textContent = title;
    notFound.querySelector('p').textContent = message;
  }
  if (headerEl) headerEl.innerHTML = '';
  if (seasonsContainer) seasonsContainer.style.display = 'none';
}

/* =============================================
   Render Watch Page Header
   ============================================= */
function renderWatchHeader(s) {
  var posterUrl = s.posterUrl || s.thumbnailUrl || 'https://placehold.co/640x360/e63946/ffffff?text=No+Image';
  var title = s.title || 'Untitled Series';
  var status = s.status || '';
  var statusClass = status.toLowerCase() === 'ongoing' ? 'ongoing' : 'completed';
  var network = s.network || '';
  var year = s.year || '';
  var endDate = s.endDate || '';
  var genre = s.genre || '';
  var rated = s.rated || '';
  var imdbRating = s.imdbRating || '';
  var country = s.country || '';
  var creator = s.creator || '';
  var cast = s.cast || '';
  var totalSeasons = s.totalSeasons || 0;
  var totalEpisodes = s.totalEpisodes || 0;
  var description = s.description || '';
  var views = formatNumber(s.views || 0);
  var likes = formatNumber(s.likes || 0);
  var isFav = AppState.favouriteVideos.indexOf(s._id) >= 0;

  var headerEl = document.getElementById('watch-header');
  if (!headerEl) return;

  var yearDisplay = year + (endDate ? ' – ' + endDate : '');

  headerEl.innerHTML =
    /* Poster background */
    '<div class="watch-poster-bg" style="background-image:url(\'' + posterUrl + '\');"></div>' +
    '<div class="watch-poster-overlay"></div>' +

    '<div class="watch-header-inner">' +

    /* Video player area */
    '<div class="watch-player-area" id="watch-player-area">' +
    '<div class="watch-player-placeholder" id="watch-player-placeholder">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="64" height="64" style="opacity:0.3;"><polygon points="5,3 19,12 5,21"/></svg>' +
    '<p style="margin-top:12px;color:var(--text-muted);font-size:0.9rem;">Select an episode to start watching</p>' +
    '</div>' +
    '<video id="watch-video-player" controls playsinline style="display:none;width:100%;max-height:70vh;background:#000;border-radius:8px;"></video>' +
    '</div>' +

    /* Series info panel */
    '<div class="watch-info-panel">' +

    /* Poster thumbnail */
    '<div class="watch-poster-thumb">' +
    '<img src="' + posterUrl + '" alt="' + escapeHTML(title) + '" onerror="this.src=\'https://placehold.co/300x450/e63946/ffffff?text=No+Poster\'">' +
    '</div>' +

    '<div class="watch-info-text">' +
    '<h1 class="watch-title">' + escapeHTML(title) + '</h1>' +

    /* Meta row */
    '<div class="watch-meta-row">' +
    (status ? '<span class="status-badge ' + statusClass + '">' + escapeHTML(status) + '</span>' : '') +
    (network ? '<span class="watch-network">' + escapeHTML(network) + '</span>' : '') +
    (yearDisplay ? '<span class="watch-year">' + escapeHTML(yearDisplay) + '</span>' : '') +
    (rated ? '<span class="watch-rated">' + escapeHTML(rated) + '</span>' : '') +
    (imdbRating ? '<span class="watch-imdb"><svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z"/></svg> ' + escapeHTML(imdbRating) + '</span>' : '') +
    '</div>' +

    /* Season/episode count */
    '<div class="watch-se-count">' +
    (totalSeasons > 0 ? '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg> ' + totalSeasons + ' Season' + (totalSeasons !== 1 ? 's' : '') + '</span>' : '') +
    (totalEpisodes > 0 ? '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M10 8l6 4-6 4V8z"/></svg> ' + totalEpisodes + ' Episode' + (totalEpisodes !== 1 ? 's' : '') + '</span>' : '') +
    '</div>' +

    /* Genre */
    (genre ? '<div class="watch-genre">' + escapeHTML(genre) + '</div>' : '') +

    /* Action buttons */
    '<div class="watch-actions">' +
    '<button class="watch-action-btn fav-btn ' + (isFav ? 'active' : '') + '" id="watch-fav-btn" data-id="' + s._id + '" title="Favourite">' +
    '<svg viewBox="0 0 24 24" fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
    '<span>' + (isFav ? 'Favourited' : 'Favourite') + '</span></button>' +
    '<button class="watch-action-btn" id="watch-share-btn" title="Share">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>' +
    '<span>Share</span></button>' +
    '</div>' +

    /* Stats */
    '<div class="watch-stats">' +
    (country ? '<span class="video-card-country">' + escapeHTML(country) + '</span>' : '') +
    '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ' + views + ' views</span>' +
    '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/></svg> ' + likes + ' likes</span>' +
    '</div>' +

    /* Description */
    (description ? '<p class="watch-description">' + escapeHTML(description) + '</p>' : '') +

    /* Creator & Cast */
    (creator ? '<div class="watch-detail-row"><span class="watch-detail-label">Creator</span><span class="watch-detail-value">' + escapeHTML(creator) + '</span></div>' : '') +
    (cast ? '<div class="watch-detail-row"><span class="watch-detail-label">Cast</span><span class="watch-detail-value">' + escapeHTML(cast) + '</span></div>' : '') +

    '</div>' + /* end watch-info-text */
    '</div>' + /* end watch-info-panel */
    '</div>'; /* end watch-header-inner */

  console.log('[Series] Watch header rendered for:', title);

  /* Bind favourite button */
  var favBtn = document.getElementById('watch-fav-btn');
  if (favBtn) {
    favBtn.addEventListener('click', function () {
      if (!AppState.currentUser) {
        showToast('Please sign in to add favourites', 'warning');
        return;
      }
      toggleFavourite(s._id);
      this.classList.toggle('active');
      var svg = this.querySelector('svg');
      var span = this.querySelector('span');
      if (svg) svg.setAttribute('fill', this.classList.contains('active') ? 'currentColor' : 'none');
      if (span) span.textContent = this.classList.contains('active') ? 'Favourited' : 'Favourite';
    });
  }

  /* Bind share button */
  var shareBtn = document.getElementById('watch-share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      var url = window.location.href;
      if (navigator.share) {
        navigator.share({ title: s.title, url: url }).catch(function () { });
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          showToast('Link copied to clipboard!', 'success');
        });
      } else {
        showToast('Could not share. Copy the URL manually.', 'warning');
      }
    });
  }
}

/* =============================================
   Load Seasons & Episodes
   ============================================= */
function loadSeasonsData(seriesId) {
  console.log('[Series] loadSeasonsData() for:', seriesId);

  database.ref(SERIES_FB_PATH + '/' + seriesId + '/seasons').once('value').then(function (seasonSnap) {
    WatchState.seasons = [];

    if (seasonSnap.exists()) {
      seasonSnap.forEach(function (sc) {
        var sd = sc.val();
        sd._key = sc.key;
        sd._episodes = [];
        WatchState.seasons.push(sd);
      });
    }

    console.log('[Series] Found ' + WatchState.seasons.length + ' seasons');

    /* Sort by season number */
    WatchState.seasons.sort(function (a, b) {
      return (a.seasonNumber || 0) - (b.seasonNumber || 0);
    });

    /* Load episodes for each season */
    var epPromises = WatchState.seasons.map(function (season) {
      return database.ref(SERIES_FB_PATH + '/' + seriesId + '/seasons/' + season._key + '/episodes').once('value').then(function (epSnap) {
        if (epSnap.exists()) {
          epSnap.forEach(function (ec) {
            var ed = ec.val();
            ed._key = ec.key;
            season._episodes.push(ed);
          });
          season._episodes.sort(function (a, b) {
            return (a.episodeNumber || 0) - (b.episodeNumber || 0);
          });
        }
        console.log('[Series] Season ' + (season.seasonNumber || season._key) + ': ' + season._episodes.length + ' episodes');
      });
    });

    return Promise.all(epPromises);
  }).then(function () {
    renderSeasonTabs();
    renderEpisodeList();
  }).catch(function (err) {
    console.error('[Series] Load seasons error:', err);
    var seasonsContainer = document.getElementById('seasons-container');
    if (seasonsContainer) {
      seasonsContainer.innerHTML = '<p style="color:var(--text-muted);padding:20px;">Could not load seasons.</p>';
    }
  });
}

/* =============================================
   Render Season Tabs
   ============================================= */
function renderSeasonTabs() {
  var container = document.getElementById('season-tabs');
  if (!container) return;

  if (!WatchState.seasons.length) {
    container.innerHTML = '<p style="color:var(--text-muted);padding:12px 0;font-size:0.9rem;">No seasons available yet.</p>';
    return;
  }

  var html = '';
  WatchState.seasons.forEach(function (season, idx) {
    var epCount = season._episodes ? season._episodes.length : 0;
    var activeClass = idx === WatchState.currentSeasonIdx ? ' active' : '';
    html += '<button class="season-tab' + activeClass + '" data-idx="' + idx + '">' +
      'Season ' + (season.seasonNumber || idx + 1) +
      '<span class="season-tab-count">' + epCount + '</span>' +
      '</button>';
  });

  container.innerHTML = html;

  /* Bind tab clicks */
  container.querySelectorAll('.season-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      WatchState.currentSeasonIdx = parseInt(this.dataset.idx);
      container.querySelectorAll('.season-tab').forEach(function (t) { t.classList.remove('active'); });
      this.classList.add('active');
      renderEpisodeList();
    });
  });
}

/* =============================================
   Render Episode List
   ============================================= */
function renderEpisodeList() {
  var container = document.getElementById('episode-list');
  if (!container) return;

  var season = WatchState.seasons[WatchState.currentSeasonIdx];

  if (!season || !season._episodes || !season._episodes.length) {
    container.innerHTML = '<div class="ep-empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40" style="opacity:0.3;"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M10 8l6 4-6 4V8z"/></svg><p>No episodes in this season yet.</p></div>';
    return;
  }

  var html = '';
  season._episodes.forEach(function (ep, idx) {
    var epThumb = ep.thumbnailUrl || 'https://placehold.co/160x90/e63946/ffffff?text=E' + (ep.episodeNumber || idx + 1);
    var isActive = WatchState.currentEpisodeKey === ep._key;
    var hasVideo = ep.videoUrl && ep.videoUrl.length > 5;

    html += '<div class="episode-row' + (isActive ? ' now-playing' : '') + '" data-ep-key="' + ep._key + '">' +
      '<div class="ep-row-num">E' + (ep.episodeNumber || idx + 1) + '</div>' +
      '<div class="ep-row-thumb">' +
      '<img src="' + epThumb + '" alt="" loading="lazy" onerror="this.src=\'https://placehold.co/160x90/e63946/ffffff?text=?\'">' +
      (hasVideo ? '<div class="ep-row-play"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div>' : '') +
      (!hasVideo ? '<div class="ep-row-no-video">N/A</div>' : '') +
      '</div>' +
      '<div class="ep-row-info">' +
      '<h4>' + escapeHTML(ep.title || 'Episode ' + (ep.episodeNumber || idx + 1)) + '</h4>' +
      '<span>' + (ep.duration || '—') + '</span>' +
      '</div>' +
      (isActive ? '<div class="ep-row-playing-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="5,3 19,12 5,21"/><line x1="1" y1="1" x2="23" y2="23"/></svg> Playing</div>' : '') +
      '</div>';
  });

  container.innerHTML = html;

  /* Bind episode clicks */
  container.querySelectorAll('.episode-row').forEach(function (row) {
    row.addEventListener('click', function () {
      var epKey = this.dataset.epKey;
      playEpisode(epKey);
    });
  });

  if (typeof initLazyLoading === 'function') initLazyLoading();
}

/* =============================================
   Play Episode
   ============================================= */
function playEpisode(epKey) {
  var season = WatchState.seasons[WatchState.currentSeasonIdx];
  if (!season) return;

  var episode = null;
  if (season._episodes) {
    episode = season._episodes.find(function (e) { return e._key === epKey; });
  }
  if (!episode) {
    console.warn('[Series] Episode not found:', epKey);
    return;
  }

  if (!episode.videoUrl || episode.videoUrl.length < 5) {
    showToast('This episode is not available yet.', 'warning');
    return;
  }

  WatchState.currentEpisodeKey = epKey;
  WatchState.currentEpisodeData = episode;

  console.log('[Series] Playing episode:', episode.title || epKey);

  /* Update player */
  var player = document.getElementById('watch-video-player');
  var placeholder = document.getElementById('watch-player-placeholder');

 if (player) {
  player.src = episode.videoUrl;
  player.style.display = 'block';
  player.play().catch(function(err) {
    console.log('[Series] Autoplay blocked:', err.message);
  });
  
  // Add these lines:
  var playerArea = document.getElementById('watch-player-area');
  if (playerArea) {
    playerArea.classList.add('video-playing');
  }
  
  // Update info overlay content
  var overlayCard = document.querySelector('.video-info-card h3');
  if (overlayCard) {
    overlayCard.textContent = episode.title || 'Episode ' + (ep.episodeNumber || idx + 1);
  }
}
  if (placeholder) {
    placeholder.style.display = 'none';
  }

  /* Update page title */
  document.title = (episode.title || 'Episode') + ' — ' + (WatchState.seriesData.title || 'Series') + ' — Xstream';

  /* Scroll to player on mobile */
  var playerArea = document.getElementById('watch-player-area');
  if (playerArea && window.innerWidth < 900) {
    playerArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* Re-render episode list to highlight current */
  renderEpisodeList();

  /* Increment episode views using transaction */
  database.ref(SERIES_FB_PATH + '/' + WatchState.seriesId + '/seasons/' + season._key + '/episodes/' + epKey + '/views')
    .transaction(function (currentViews) {
      return (currentViews || 0) + 1;
    }).catch(function (err) {
      console.warn('[Series] Episode view increment failed:', err.message);
    });
}

/* =============================================
   Related Series — 5 items
   ============================================= */
function loadRelatedSeries(currentId, currentData) {
  var container = document.getElementById('related-series');
  if (!container) return;

  console.log('[Series] Loading related series for:', currentData.title);

  database.ref(SERIES_FB_PATH).once('value').then(function (snap) {
    var allSeries = [];
    snap.forEach(function (child) {
      var d = child.val();
      if (!d || !d.title) return;
      d._id = child.key;
      if (d._id !== currentId) allSeries.push(d);
    });

    /* Filter by same genre first, then fill with others */
    var sameGenre = allSeries.filter(function (s) {
      return (s.genre || '').toLowerCase() === (currentData.genre || '').toLowerCase();
    });
    var others = allSeries.filter(function (s) {
      return (s.genre || '').toLowerCase() !== (currentData.genre || '').toLowerCase();
    });

    var related = sameGenre.concat(others).slice(0, 5);

    console.log('[Series] Found ' + related.length + ' related series');

    if (!related.length) {
      container.innerHTML = '<p style="color:var(--text-muted);padding:20px;font-size:0.88rem;">No related series found.</p>';
      return;
    }

    var html = '';
    related.forEach(function (s) {
      var thumb = getThumbnailUrl(s);
      var statusClass = (s.status || '').toLowerCase() === 'ongoing' ? 'ongoing' : 'completed';

      html += '<div class="related-card" data-id="' + s._id + '">' +
        '<div class="related-card-thumb">' +
        '<img src="' + thumb + '" alt="' + escapeHTML(s.title || '') + '" loading="lazy" onerror="this.src=\'https://placehold.co/320x180/e63946/ffffff?text=?\'">' +
        '<div class="related-card-overlay"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        '</div>' +
        '<div class="related-card-body">' +
        '<h4>' + escapeHTML(s.title || 'Untitled') + '</h4>' +
        '<div class="related-card-meta">' +
        (s.status ? '<span class="status-badge ' + statusClass + '" style="font-size:0.7rem;padding:2px 8px;">' + escapeHTML(s.status) + '</span>' : '') +
        '<span>' + (s.totalSeasons || 0) + 'S</span>' +
        '<span>' + formatNumber(s.views || 0) + ' views</span>' +
        '</div>' +
        '</div>' +
        '</div>';
    });

    container.innerHTML = html;

    /* Bind clicks */
    container.querySelectorAll('.related-card').forEach(function (card) {
      card.addEventListener('click', function () {
        window.location.href = 'watch.html?id=' + this.dataset.id + '&source=series';
      });
    });

    if (typeof initLazyLoading === 'function') initLazyLoading();
  }).catch(function (err) {
    console.error('[Series] Related series error:', err);
    container.innerHTML = '<p style="color:var(--text-muted);">Could not load related series.</p>';
  });
}