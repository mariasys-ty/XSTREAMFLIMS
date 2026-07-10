/* ========================================
   UPCOMING MOVIES — js/upcoming.js
   (TMDB API)
   ======================================== */
(function () {
  'use strict';

  /* ---------- TMDB CONFIGURATION ---------- */
  var TMDB_API_KEY = '54758259d3a4cf5195b79fb8aade4439';   /* ← replace with your key from themoviedb.org */
  var TMDB_BASE    = 'https://api.themoviedb.org/3';
  var TMDB_IMG     = 'https://image.tmdb.org/t/p/';
  var POSTER_SIZE  = 'w500';
  var PROFILE_SIZE = 'w185';

  var MAX_CARDS       = 3;
  var ROTATE_INTERVAL = 120000;
  var UPCOMING_PAGES  = 2;                  /* fetch 2 pages (~40 movies) */
  var CACHE_KEY       = 'xstream_upcoming_tmdb_cache';
  var CAST_CACHE_KEY  = 'xstream_cast_cache';
  var GENRE_CACHE_KEY = 'xstream_genre_cache';
  var CACHE_TTL       = 10 * 60 * 1000;

  var imageObserver    = null;
  var isDestroyed      = false;
  var fetchController   = null;
  var rotateTimer       = null;
  var allMovies         = [];
  var genreMap          = null;
  var rotationIndex     = 0;
  var isPaused          = false;
  var pauseTimeout      = null;

  /* ---------- DOM ---------- */
  var grid       = document.getElementById('upcoming-grid');
  var emptyState = document.getElementById('upcoming-empty');
  var errorState = document.getElementById('upcoming-error');
  var errorText  = document.getElementById('upcoming-error-text');
  var retryBtn   = document.getElementById('upcoming-retry-btn');

  /* ============================================================
     INIT
     ============================================================ */
  function init() {
    if (!grid) return;
    showSkeletons();
    setupEvents();
    loadUpcomingMovies();
  }

  /* ============================================================
     YEAR FILTER — current year, next year, or any future year
     ============================================================ */
  function getCurrentYear() {
    return new Date().getFullYear();
  }

  function isUpcomingYear(yearStr) {
    if (!yearStr || yearStr === 'N/A') return false;
    var parts = yearStr.split(/[–\-—]/);
    var minYear = parseInt(parts[0], 10);
    if (isNaN(minYear)) return false;
   return minYear >= getCurrentYear() - 1;
  }

  function filterUpcomingMovies(movies) {
    return movies.filter(function (m) {
      return isUpcomingYear(m.year);
    });
  }

  /* ============================================================
     GENRE MAP
     ============================================================ */
  async function loadGenreMap() {
    /* Return cached map if still fresh */
    try {
      var raw = sessionStorage.getItem(GENRE_CACHE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts < CACHE_TTL && parsed.data) {
          genreMap = parsed.data;
          return genreMap;
        }
      }
    } catch (e) {}

    try {
      var url = TMDB_BASE + '/genre/movie/list' +
        '?api_key=' + encodeURIComponent(TMDB_API_KEY) +
        '&language=en-US';
      var res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (data.success === false) throw new Error(data.status_message || 'TMDB error');

      var map = {};
      (data.genres || []).forEach(function (g) { map[g.id] = g.name; });
      genreMap = map;

      try {
        sessionStorage.setItem(GENRE_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: map }));
      } catch (e) {}

      return map;
    } catch (e) {
      genreMap = {};
      return genreMap;
    }
  }

  /* ============================================================
     DATA FLOW
     ============================================================ */
  async function loadUpcomingMovies() {
    if (isDestroyed) return;

    /* Try cache first */
    var cached = loadCache();
    if (cached && cached.length) {
      allMovies = filterUpcomingMovies(cached);
      if (allMovies.length) {
        /* Ensure genre map is available for rendering */
        if (!genreMap) await loadGenreMap();
        renderRotationSet();
        startRotation();
        enrichAllCastInBackground();
        refreshInBackground();
        return;
      }
    }

    fetchController = new AbortController();

    try {
      /* 1. Genre map */
      await loadGenreMap();
      if (isDestroyed) return;

      /* 2. Fetch upcoming pages */
      var movies = await fetchUpcomingPages(UPCOMING_PAGES, fetchController.signal);
      if (isDestroyed) return;
      if (!movies || !movies.length) { showEmpty(); return; }

      /* 3. Filter by year */
      allMovies = filterUpcomingMovies(movies);
      if (!allMovies.length) { showEmpty(); return; }

      /* 4. Cache & render */
      saveCache(allMovies);
      renderRotationSet();
      startRotation();

      /* 5. Enrich with cast + details in background */
      enrichAllCastInBackground();
    } catch (err) {
      if (isDestroyed || err.name === 'AbortError') return;
      if (TMDB_API_KEY === 'YOUR_TMDB_API_KEY') {
        showError('TMDB API key is missing. Set TMDB_API_KEY in upcoming.js.');
      } else {
        showError('Failed to load upcoming movies.');
      }
    } finally {
      fetchController = null;
    }
  }

  async function refreshInBackground() {
    try {
      if (!genreMap) await loadGenreMap();
      var movies = await fetchUpcomingPages(UPCOMING_PAGES);
      if (!movies || !movies.length) return;
      saveCache(movies);
      var filtered = filterUpcomingMovies(movies);
      if (filtered.length) {
        allMovies = filtered;
      }
    } catch (e) { /* silent */ }
  }

  /* ============================================================
     TMDB — UPCOMING PAGES
     ============================================================ */
   async function fetchUpcomingPages(pageCount, signal) {
    var allResults = [];
    var prevYear = getCurrentYear() - 1;
    
    /* Fallback chain: upcoming → now_playing → discover by release date.
       TMDB's /upcoming can return 0 results depending on region/date,
       so we automatically try the next endpoint if one is empty. */
    var endpoints = [
      '/movie/upcoming',
      '/movie/now_playing',
      '/discover/movie?primary_release_date.gte=' + prevYear + '-01-01&sort_by=release_date.asc&vote_count.gte=10'
    ];
    
    for (var e = 0; e < endpoints.length; e++) {
      allResults = [];
      var endpoint = endpoints[e];
      
      for (var p = 1; p <= pageCount; p++) {
        if (isDestroyed) break;
        try {
          /* Safely append ? or & depending on whether endpoint already has params */
          var url = TMDB_BASE + endpoint +
            (endpoint.indexOf('?') === -1 ? '?' : '&') +
            'api_key=' + encodeURIComponent(TMDB_API_KEY) +
            '&language=en-US' +
            '&page=' + p;
          
          var res = await fetch(url, { signal: signal || undefined });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          var data = await res.json();
          if (data.success === false) throw new Error(data.status_message || 'TMDB error');
          
          var pageMovies = (data.results || []).map(function(m) {
            return mapListToCard(m, genreMap);
          });
          allResults = allResults.concat(pageMovies);
          
          /* Stop early if there are no more pages */
          if (data.page >= data.total_pages) break;
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          /* If this endpoint fails or errors, break and try the next fallback */
          break;
        }
      }
      
      /* If we successfully got movies from this endpoint, stop the fallback chain */
      if (allResults.length > 0) {
        break;
      }
    }
    return allResults;
  }

  /* ============================================================
     TMDB — MOVIE DETAILS (cast, director, certification, runtime)
     ============================================================ */
  async function fetchMovieDetails(tmdbId) {
    var url = TMDB_BASE + '/movie/' + tmdbId +
      '?api_key=' + encodeURIComponent(TMDB_API_KEY) +
      '&language=en-US' +
      '&append_to_response=credits,release_dates';

    var res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    if (data.success === false) return null;
    return data;
  }

  /* ============================================================
     MAPPING — list response → card object
     ============================================================ */
  function mapListToCard(m, gMap) {
    var genres = [];
    if (m.genre_ids && gMap) {
      m.genre_ids.forEach(function (gid) {
        if (gMap[gid]) genres.push(gMap[gid]);
      });
    }
    return {
      id:          m.id || '',
      title:       m.title || 'Untitled',
      poster:      m.poster_path ? (TMDB_IMG + POSTER_SIZE + m.poster_path) : '',
      description: m.overview || '',
      genres:      genres,
      year:        m.release_date ? m.release_date.substring(0, 4) : '',
      rating:      (m.vote_average != null && m.vote_average > 0) ? m.vote_average.toFixed(1) : '',
      ageRating:   '',
      runtime:     '',
      director:    '',
      cast:        '',
      castList:    [],
      language:    m.original_language || '',
      country:     '',
      releaseDate: m.release_date || '',
      _enriched:   false
    };
  }

  /* ============================================================
     ENRICHMENT — add cast photos, director, runtime, certification
     ============================================================ */
  function enrichCard(card, details) {
    if (!details || card._enriched) return card;

    if (details.runtime) card.runtime = details.runtime + ' min';

    /* Production countries */
    if (details.production_countries && details.production_countries.length) {
      card.country = details.production_countries.map(function (c) { return c.name; }).join(', ');
    }

    /* Age rating from release_dates (prefer US) */
    if (details.release_dates && details.release_dates.results) {
      var usRelease = null;
      for (var r = 0; r < details.release_dates.results.length; r++) {
        if (details.release_dates.results[r].iso_3166_1 === 'US') {
          usRelease = details.release_dates.results[r];
          break;
        }
      }
      if (!usRelease && details.release_dates.results.length) {
        usRelease = details.release_dates.results[0];
      }
      if (usRelease && usRelease.release_dates && usRelease.release_dates.length) {
        card.ageRating = usRelease.release_dates[0].certification || '';
      }
    }

    /* Credits — cast with profile photos */
    if (details.credits) {
      if (details.credits.cast && details.credits.cast.length) {
        card.castList = details.credits.cast.slice(0, 20).map(function (c) {
          return {
            id:           c.id || 0,
            name:         c.name || '',
            character:    c.character || '',
            profile_path: c.profile_path || '',
            profile_url:  c.profile_path ? (TMDB_IMG + PROFILE_SIZE + c.profile_path) : '',
            order:        c.order || 0
          };
        });
        card.cast = card.castList.map(function (c) { return c.name; }).join(', ');
      }

      if (details.credits.crew && details.credits.crew.length) {
        for (var c = 0; c < details.credits.crew.length; c++) {
          if (details.credits.crew[c].job === 'Director') {
            card.director = details.credits.crew[c].name;
            break;
          }
        }
      }
    }

    card._enriched = true;
    return card;
  }

  /* ============================================================
     ENRICH ALL — background batch fetch for cast images
     ============================================================ */
  async function enrichAllCastInBackground() {
    var toEnrich = allMovies.filter(function (m) { return !m._enriched; });
    if (!toEnrich.length) return;

    var BATCH_SIZE = 3;
    for (var i = 0; i < toEnrich.length; i += BATCH_SIZE) {
      if (isDestroyed) return;

      var batch = toEnrich.slice(i, i + BATCH_SIZE);
      var promises = batch.map(function (m) {
        return fetchMovieDetails(m.id)
          .then(function (details) {
            if (details) {
              enrichCard(m, details);
              saveCastData(String(m.id), m.castList, m.title, m.poster);
            }
          })
          .catch(function () { /* skip */ });
      });

      await Promise.allSettled(promises);

      /* Persist enriched data to cache after each batch */
      saveCache(allMovies);

      /* Brief pause between batches to respect rate limits */
      if (i + BATCH_SIZE < toEnrich.length) {
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
      }
    }
  }

  /* ============================================================
     CAST DATA STORAGE
     Each entry stores the full cast array with profile URLs
     so movieinfo.html can render cast photos directly.
     ============================================================ */
  function saveCastData(movieId, castList, title, poster) {
    if (!castList || !castList.length) return;
    try {
      var cache = {};
      try {
        var raw = sessionStorage.getItem(CAST_CACHE_KEY);
        if (raw) cache = JSON.parse(raw);
      } catch (e) {}
      cache[movieId] = {
        cast:   castList,
        title:  title || '',
        poster: poster || '',
        ts:     Date.now()
      };
      sessionStorage.setItem(CAST_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {}
  }

  /* ============================================================
     ROTATION — cycles a new set of MAX_CARDS every 9 seconds
     ============================================================ */
  function renderRotationSet() {
    if (isDestroyed || !allMovies.length) return;
    rotationIndex = rotationIndex % allMovies.length;
    var set = [];
    for (var i = 0; i < MAX_CARDS; i++) {
      set.push(allMovies[(rotationIndex + i) % allMovies.length]);
    }
    renderMovies(set);
  }

  function startRotation() {
    stopRotation();
    if (allMovies.length <= MAX_CARDS) return;
    rotateTimer = setInterval(function () {
      if (isDestroyed || isPaused) return;
      rotationIndex = (rotationIndex + MAX_CARDS) % allMovies.length;
      renderRotationSet();
    }, ROTATE_INTERVAL);
  }

  function stopRotation() {
    if (rotateTimer) {
      clearInterval(rotateTimer);
      rotateTimer = null;
    }
  }

  function pauseRotation() {
    isPaused = true;
    if (pauseTimeout) clearTimeout(pauseTimeout);
    pauseTimeout = setTimeout(function () {
      isPaused = false;
    }, 15000);
  }

  /* ============================================================
     CACHE
     ============================================================ */
  function saveCache(movies) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: movies }));
    } catch (e) {}
  }

  function loadCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > CACHE_TTL) return null;
      return (parsed.data && parsed.data.length) ? parsed.data : null;
    } catch (e) { return null; }
  }

  /* ============================================================
     SKELETONS
     ============================================================ */
  function showSkeletons() {
    grid.style.display = '';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';
    grid.innerHTML = skeletonHTML();
  }

  function skeletonHTML() {
    var s = '';
    for (var i = 0; i < MAX_CARDS; i++) {
      s +=
        '<div class="upcoming-skeleton">' +
          '<div class="upcoming-skeleton-poster upcoming-skeleton-bar"></div>' +
          '<div class="upcoming-skeleton-info">' +
            '<div class="upcoming-skeleton-bar title"></div>' +
            '<div class="upcoming-skeleton-bar meta"></div>' +
            '<div class="upcoming-skeleton-bar genres"></div>' +
            '<div class="upcoming-skeleton-bar desc1"></div>' +
            '<div class="upcoming-skeleton-bar desc2"></div>' +
            '<div class="upcoming-skeleton-bar desc3"></div>' +
            '<div class="upcoming-skeleton-bar release"></div>' +
            '<div class="upcoming-skeleton-bar btn"></div>' +
          '</div>' +
        '</div>';
    }
    return s;
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function renderMovies(movies) {
    if (isDestroyed) return;
    grid.style.display = '';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';

    var html = '';
    movies.forEach(function (m) { html += cardHTML(m); });
    grid.innerHTML = html;
    observeImages();
  }

  function cardHTML(m) {
    var genres      = Array.isArray(m.genres) ? m.genres.join(', ') : (m.genres || '');
    var releaseDate = formatReleaseDate(m.releaseDate);
    var ageRating   = m.ageRating || '';
    var year        = m.year || '';
    var desc        = m.description || '';

    var ageSpan = ageRating
      ? '<span class="upcoming-age">' + escHTML(ageRating) + '</span>'
      : '';

    return '' +
      '<article class="upcoming-card" data-id="' + escAttr(String(m.id)) + '" tabindex="0" role="link" aria-label="View details for ' + escAttr(m.title) + '">' +
        '<div class="upcoming-poster-wrap">' +
          '<img class="upcoming-poster-img" data-src="' + escAttr(m.poster) + '" alt="' + escAttr(m.title) + ' poster" loading="lazy">' +
          '<span class="upcoming-badge">COMING SOON</span>' +
        '</div>' +
        '<div class="upcoming-info">' +
          '<h3 class="upcoming-movie-title">' + escHTML(m.title) + '</h3>' +
          '<div class="upcoming-meta">' +
            '<span class="upcoming-year">' + escHTML(String(year)) + '</span>' +
            ageSpan +
          '</div>' +
          '<div class="upcoming-genres">' + escHTML(genres) + '</div>' +
          '<p class="upcoming-desc">' + escHTML(desc) + '</p>' +
          '<div class="upcoming-release">\uD83D\uDCC5 ' + escHTML(releaseDate) + '</div>' +
          '<button class="upcoming-trailer-btn" data-id="' + escAttr(String(m.id)) + '" aria-label="Watch trailer for ' + escAttr(m.title) + '">\u25B6 Watch Trailer</button>' +
        '</div>' +
      '</article>';
  }

  /* ============================================================
     STATES
     ============================================================ */
  function showEmpty() {
    if (isDestroyed) return;
    grid.style.display = 'none';
    errorState.style.display = 'none';
    emptyState.style.display = '';
  }

  function showError(msg) {
    if (isDestroyed) return;
    grid.style.display = 'none';
    emptyState.style.display = 'none';
    errorState.style.display = '';
    if (errorText) errorText.textContent = msg || 'Something went wrong.';
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  function setupEvents() {
    grid.addEventListener('click', onGridClick);
    grid.addEventListener('keydown', onGridKeydown);
    grid.addEventListener('mouseenter', function () { pauseRotation(); }, true);
    grid.addEventListener('focusin', function () { pauseRotation(); }, true);
    if (retryBtn) retryBtn.addEventListener('click', onRetry);
    window.addEventListener('beforeunload', cleanup);
  }

  function onGridClick(e) {
    var btn  = e.target.closest('.upcoming-trailer-btn');
    var card = e.target.closest('.upcoming-card');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      navigateToMovie(btn.getAttribute('data-id'));
      return;
    }
    if (card) {
      navigateToMovie(card.getAttribute('data-id'));
    }
  }

  function onGridKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      var card = e.target.closest('.upcoming-card');
      if (card) {
        e.preventDefault();
        navigateToMovie(card.getAttribute('data-id'));
      }
    }
  }

  function onRetry() {
    if (fetchController) fetchController.abort();
    stopRotation();
    showSkeletons();
    try { sessionStorage.removeItem(CACHE_KEY); } catch (e) {}
    allMovies = [];
    genreMap = null;
    rotationIndex = 0;
    loadUpcomingMovies();
  }

  function navigateToMovie(id) {
    if (!id) return;

    /* Ensure cast data (with photos) is saved before navigating,
       so movieinfo.html can read it immediately from sessionStorage */
    var movie = allMovies.find(function (m) { return String(m.id) === String(id); });
    if (movie) {
      saveCastData(String(id), movie.castList, movie.title, movie.poster);
      try {
        sessionStorage.setItem('xstream_current_movie', JSON.stringify({
          id:          movie.id,
          title:       movie.title,
          poster:      movie.poster,
          description: movie.description,
          genres:      movie.genres,
          year:        movie.year,
          rating:      movie.rating,
          ageRating:   movie.ageRating,
          runtime:     movie.runtime,
          director:    movie.director,
          cast:        movie.cast,
          castList:    movie.castList,
          language:    movie.language,
          country:     movie.country,
          releaseDate: movie.releaseDate
        }));
      } catch (e) {}
    }

    window.location.href = 'movieinfo.html?id=' + encodeURIComponent(id);
  }

  /* ============================================================
     LAZY LOAD IMAGES
     ============================================================ */
  function observeImages() {
    if (imageObserver) imageObserver.disconnect();
    var images = grid.querySelectorAll('.upcoming-poster-img[data-src]');
    if (!images.length) return;

    if ('IntersectionObserver' in window) {
      imageObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            loadImage(entry.target);
            imageObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: '200px 0px' });
      images.forEach(function (img) { imageObserver.observe(img); });
    } else {
      images.forEach(loadImage);
    }
  }

  function loadImage(img) {
    var src = img.getAttribute('data-src');
    if (!src) return;
    var temp = new Image();
    temp.onload = function () {
      img.src = src;
      img.removeAttribute('data-src');
      requestAnimationFrame(function () { img.classList.add('loaded'); });
    };
    temp.onerror = function () {
      img.removeAttribute('data-src');
      img.style.opacity = '0.12';
      img.classList.add('loaded');
    };
    temp.src = src;
  }

  /* ============================================================
     CLEANUP
     ============================================================ */
  function cleanup() {
    isDestroyed = true;
    if (fetchController) { fetchController.abort(); fetchController = null; }
    if (imageObserver) { imageObserver.disconnect(); imageObserver = null; }
    stopRotation();
    if (pauseTimeout) { clearTimeout(pauseTimeout); pauseTimeout = null; }
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function formatReleaseDate(str) {
    if (!str) return 'TBA';
    try {
      var d = new Date(str + 'T00:00:00');
      if (isNaN(d.getTime())) return str;
      return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return str; }
  }

  function escHTML(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
  }

  function escAttr(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ============================================================
     BOOT
     ============================================================ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();