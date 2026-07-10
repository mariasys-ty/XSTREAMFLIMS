/* =============================================
   casha.js — Intelligent Firebase Cache Layer
   =============================================
   Caches three nodes: translated, description, series
   Strategy: Memory → localStorage → Firebase
   Prevents duplicate in-flight requests.
   ============================================= */

const Casha = (function () {
  'use strict';

  /* ────────────────────────────────────────────
     Configuration
     ──────────────────────────────────────────── */
  var CONFIG = {
    version: '1.0.0',
    prefix: 'casha_',
    defaultTTL: 30 * 60 * 1000, // 30 minutes in ms
    nodes: {
      translated: {
        refPath: 'Translated',
        ttl: 30 * 60 * 1000,
        localStorageKey: 'casha_translated'
      },
      description: {
        refPath: 'description',
        ttl: 30 * 60 * 1000,
        localStorageKey: 'casha_description'
      },
      series: {
        refPath: 'series',
        ttl: 30 * 60 * 1000,
        localStorageKey: 'casha_series'
      }
    },
    prefetchOnInit: true,
    backgroundRefresh: true,
    backgroundRefreshRatio: 0.7 // refresh when 70% of TTL has passed
  };

  /* ────────────────────────────────────────────
     Internal State
     ──────────────────────────────────────────── */

  /** Memory cache: { translated: { data, timestamp }, ... } */
  var memoryCache = {};

  /** In-flight request locks: { translated: Promise, ... } */
  var inflightRequests = {};

  /** Cache statistics */
  var stats = {
    hits: 0,
    misses: 0,
    lastRefresh: {},
    fetchCount: {},
    errorCount: {}
  };

  /** Whether prefetch has started */
  var prefetchStarted = false;

  /* ────────────────────────────────────────────
     Helpers
     ──────────────────────────────────────────── */

  /**
   * Get current timestamp in ms
   */
  function now() {
    return Date.now();
  }

  /**
   * Check if a cached entry is expired
   */
  function isExpired(timestamp, ttl) {
    return (now() - timestamp) > ttl;
  }

  /**
   * Check if a cached entry is stale enough for background refresh
   */
  function isStale(timestamp, ttl) {
    return (now() - timestamp) > (ttl * CONFIG.backgroundRefreshRatio);
  }

  /**
   * Safe JSON parse — returns null on failure
   */
  function safeParse(str) {
    try {
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  }

  /**
   * Safe JSON stringify — returns null on failure
   */
  function safeStringify(obj) {
    try {
      return JSON.stringify(obj);
    } catch (e) {
      return null;
    }
  }

  /**
   * Safely read from localStorage
   */
  function readLocalStorage(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? safeParse(raw) : null;
    } catch (e) {
      console.warn('[Casha] localStorage read failed for', key, e.message);
      return null;
    }
  }

  /**
   * Safely write to localStorage
   */
  function writeLocalStorage(key, value) {
    try {
      var str = safeStringify(value);
      if (str === null) return false;
      localStorage.setItem(key, str);
      return true;
    } catch (e) {
      console.warn('[Casha] localStorage write failed for', key, e.message);
      return false;
    }
  }

  /**
   * Safely remove from localStorage
   */
  function removeLocalStorage(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      // Silent fail
    }
  }

  /**
   * Convert Firebase snapshot to an array of objects with _id
   */
  function snapshotToArray(snapshot) {
    var items = [];
    if (!snapshot || !snapshot.exists()) return items;

    snapshot.forEach(function (child) {
      var data = child.val();
      if (data && typeof data === 'object') {
        data._id = child.key;
        items.push(data);
      }
    });

    return items;
  }

  /**
   * Get the node config by name
   */
  function getNodeConfig(nodeName) {
    var cfg = CONFIG.nodes[nodeName];
    if (!cfg) {
      console.error('[Casha] Unknown node:', nodeName);
      return null;
    }
    return cfg;
  }

  /**
   * Increment a stat counter
   */
  function bumpStat(counter, key) {
    if (!stats[counter]) stats[counter] = {};
    stats[counter][key] = (stats[counter][key] || 0) + 1;
  }

  /* ────────────────────────────────────────────
     Core Fetch Logic (Internal)
     ──────────────────────────────────────────── */

  /**
   * Fetch a single node from Firebase with full cache chain.
   * Returns { data: Array, source: 'memory'|'localStorage'|'firebase', stale: Boolean }
   */
  async function fetchNode(nodeName, options) {
    options = options || {};
    var forceRefresh = !!options.forceRefresh;
    var skipBackgroundRefresh = !!options.skipBackgroundRefresh;

    var cfg = getNodeConfig(nodeName);
    if (!cfg) return { data: [], source: 'error', stale: false };

    var ttl = options.ttl || cfg.ttl;
    var memEntry = memoryCache[nodeName];

    /* ── Step 1: Memory cache ── */
    if (!forceRefresh && memEntry && memEntry.data) {
      var memExpired = isExpired(memEntry.timestamp, ttl);

      if (!memExpired) {
        stats.hits++;
        bumpStat('hits', nodeName);

        /* Background refresh if stale but not expired */
        if (CONFIG.backgroundRefresh && !skipBackgroundRefresh && isStale(memEntry.timestamp, ttl)) {
          backgroundRefreshNode(nodeName, ttl);
        }

        return { data: memEntry.data, source: 'memory', stale: false };
      }
    }

    /* ── Step 2: localStorage cache ── */
    if (!forceRefresh) {
      var lsEntry = readLocalStorage(cfg.localStorageKey);

      if (lsEntry && lsEntry.data && lsEntry.timestamp) {
        var lsExpired = isExpired(lsEntry.timestamp, ttl);

        if (!lsExpired) {
          /* Promote to memory cache */
          memoryCache[nodeName] = { data: lsEntry.data, timestamp: lsEntry.timestamp };

          stats.hits++;
          bumpStat('hits', nodeName);

          if (CONFIG.backgroundRefresh && !skipBackgroundRefresh && isStale(lsEntry.timestamp, ttl)) {
            backgroundRefreshNode(nodeName, ttl);
          }

          return { data: lsEntry.data, source: 'localStorage', stale: false };
        }

        /* Expired but usable as fallback — serve it while we fetch fresh */
        memoryCache[nodeName] = { data: lsEntry.data, timestamp: lsEntry.timestamp };
      }
    }

    /* ── Step 3: Firebase fetch ── */
    stats.misses++;
    bumpStat('misses', nodeName);
    bumpStat('fetchCount', nodeName);

    /* Deduplicate: if a request is already in-flight, wait for it */
    if (inflightRequests[nodeName]) {
      try {
        var result = await inflightRequests[nodeName];
        return { data: result, source: 'firebase', stale: false };
      } catch (e) {
        /* In-flight request failed, fall through to return stale data or empty */
      }
    }

    /* Create the in-flight promise */
    var fetchPromise = database.ref(cfg.refPath).once('value')
      .then(function (snapshot) {
        var data = snapshotToArray(snapshot);
        return data;
      })
      .catch(function (err) {
        bumpStat('errorCount', nodeName);
        console.error('[Casha] Firebase fetch failed for', nodeName, err.message || err);

        /* Return whatever we have in memory/localStorage as fallback */
        var fallback = memoryCache[nodeName] || readLocalStorage(cfg.localStorageKey);
        if (fallback && fallback.data) {
          return fallback.data;
        }
        return [];
      })
      .finally(function () {
        delete inflightRequests[nodeName];
      });

    inflightRequests[nodeName] = fetchPromise;

    try {
      var freshData = await fetchPromise;

      /* Store in memory */
      var timestamp = now();
      memoryCache[nodeName] = { data: freshData, timestamp: timestamp };

      /* Store in localStorage */
      writeLocalStorage(cfg.localStorageKey, {
        data: freshData,
        timestamp: timestamp,
        version: CONFIG.version
      });

      stats.lastRefresh[nodeName] = timestamp;

      return { data: freshData, source: 'firebase', stale: false };
    } catch (e) {
      /* Should not reach here due to catch inside fetchPromise, but safety net */
      var staleData = (memoryCache[nodeName] && memoryCache[nodeName].data) || [];
      return { data: staleData, source: 'fallback', stale: true };
    }
  }

  /**
   * Background refresh — fires and forgets, updates cache silently
   */
  function backgroundRefreshNode(nodeName, ttl) {
    if (inflightRequests[nodeName]) return; // already fetching

    var cfg = getNodeConfig(nodeName);
    if (!cfg) return;

    bumpStat('fetchCount', nodeName);

    var fetchPromise = database.ref(cfg.refPath).once('value')
      .then(function (snapshot) {
        var data = snapshotToArray(snapshot);
        var timestamp = now();
        memoryCache[nodeName] = { data: data, timestamp: timestamp };
        writeLocalStorage(cfg.localStorageKey, {
          data: data,
          timestamp: timestamp,
          version: CONFIG.version
        });
        stats.lastRefresh[nodeName] = timestamp;
      })
      .catch(function (err) {
        bumpStat('errorCount', nodeName);
        console.warn('[Casha] Background refresh failed for', nodeName, err.message || err);
      })
      .finally(function () {
        delete inflightRequests[nodeName];
      });

    inflightRequests[nodeName] = fetchPromise;
  }

  /* ────────────────────────────────────────────
     Public: Load Functions
     ──────────────────────────────────────────── */

  /**
   * Load translated movies
   * @param {Object} [options] - { ttl, forceRefresh, skipBackgroundRefresh }
   * @returns {Promise<Array>}
   */
  async function loadTranslated(options) {
    var result = await fetchNode('translated', options);
    return result.data;
  }

  /**
   * Load description movies
   * @param {Object} [options]
   * @returns {Promise<Array>}
   */
  async function loadDescription(options) {
    var result = await fetchNode('description', options);
    return result.data;
  }

  /**
   * Load series
   * @param {Object} [options]
   * @returns {Promise<Array>}
   */
  async function loadSeries(options) {
    var result = await fetchNode('series', options);
    return result.data;
  }

  /**
   * Load all three nodes in parallel
   * @param {Object} [options]
   * @returns {Promise<{ translated: Array, description: Array, series: Array }>}
   */
  async function loadAll(options) {
    var results = await Promise.all([
      fetchNode('translated', options),
      fetchNode('description', options),
      fetchNode('series', options)
    ]);

    return {
      translated: results[0].data,
      description: results[1].data,
      series: results[2].data
    };
  }

  /* ────────────────────────────────────────────
     Public: Refresh Functions (Force Fresh)
     ──────────────────────────────────────────── */

  /**
   * Force refresh translated from Firebase
   * @returns {Promise<Array>}
   */
  async function refreshTranslated() {
    return loadTranslated({ forceRefresh: true, skipBackgroundRefresh: true });
  }

  /**
   * Force refresh description from Firebase
   * @returns {Promise<Array>}
   */
  async function refreshDescription() {
    return loadDescription({ forceRefresh: true, skipBackgroundRefresh: true });
  }

  /**
   * Force refresh series from Firebase
   * @returns {Promise<Array>}
   */
  async function refreshSeries() {
    return loadSeries({ forceRefresh: true, skipBackgroundRefresh: true });
  }

  /**
   * Force refresh all nodes from Firebase in parallel
   * @returns {Promise<{ translated: Array, description: Array, series: Array }>}
   */
  async function refreshAll() {
    var results = await Promise.all([
      fetchNode('translated', { forceRefresh: true, skipBackgroundRefresh: true }),
      fetchNode('description', { forceRefresh: true, skipBackgroundRefresh: true }),
      fetchNode('series', { forceRefresh: true, skipBackgroundRefresh: true })
    ]);

    return {
      translated: results[0].data,
      description: results[1].data,
      series: results[2].data
    };
  }

  /* ────────────────────────────────────────────
     Public: Clear Functions
     ──────────────────────────────────────────── */

  function clearNodeCache(nodeName) {
    var cfg = getNodeConfig(nodeName);
    if (!cfg) return;

    delete memoryCache[nodeName];
    removeLocalStorage(cfg.localStorageKey);

    console.log('[Casha] Cleared cache for', nodeName);
  }

  function clearTranslatedCache() {
    clearNodeCache('translated');
  }

  function clearDescriptionCache() {
    clearNodeCache('description');
  }

  function clearSeriesCache() {
    clearNodeCache('series');
  }

  function clearAllCache() {
    clearNodeCache('translated');
    clearNodeCache('description');
    clearNodeCache('series');

    /* Reset stats */
    stats.hits = 0;
    stats.misses = 0;
    stats.lastRefresh = {};
    stats.fetchCount = {};
    stats.errorCount = {};

    console.log('[Casha] All caches cleared');
  }

  /* ────────────────────────────────────────────
     Public: Search Functions (Zero Firebase Reads)
     ──────────────────────────────────────────── */

  /**
   * Search across all cached movie nodes (translated + description)
   * @param {string} keyword
   * @returns {Array} Matching movies with _source field
   */
  function searchMovies(keyword) {
    if (!keyword || keyword.trim().length < 1) return [];

    var q = keyword.trim().toLowerCase();
    var results = [];

    var transData = (memoryCache.translated && memoryCache.translated.data) || [];
    var descData = (memoryCache.description && memoryCache.description.data) || [];

    function match(item) {
      var fields = [item.title, item.genre, item.category, item.director, item.country, item.description, item.year];
      var combined = fields.join(' ').toLowerCase();
      return combined.indexOf(q) !== -1;
    }

    for (var i = 0; i < descData.length; i++) {
      if (match(descData[i])) {
        var item = Object.assign({}, descData[i]);
        item._source = 'description';
        item._isTranslated = false;
        results.push(item);
      }
    }

    for (var j = 0; j < transData.length; j++) {
      if (match(transData[j])) {
        var tItem = Object.assign({}, transData[j]);
        tItem._source = 'translated';
        tItem._isTranslated = true;
        results.push(tItem);
      }
    }

    return results;
  }

  /**
   * Search only translated cache
   * @param {string} keyword
   * @returns {Array}
   */
  function searchTranslated(keyword) {
    if (!keyword || keyword.trim().length < 1) return [];

    var q = keyword.trim().toLowerCase();
    var data = (memoryCache.translated && memoryCache.translated.data) || [];
    var results = [];

    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      var fields = [item.title, item.genre, item.category, item.director, item.country, item.description, item.year];
      if (fields.join(' ').toLowerCase().indexOf(q) !== -1) {
        var copy = Object.assign({}, item);
        copy._source = 'translated';
        copy._isTranslated = true;
        results.push(copy);
      }
    }

    return results;
  }

  /**
   * Search only description cache
   * @param {string} keyword
   * @returns {Array}
   */
  function searchDescription(keyword) {
    if (!keyword || keyword.trim().length < 1) return [];

    var q = keyword.trim().toLowerCase();
    var data = (memoryCache.description && memoryCache.description.data) || [];
    var results = [];

    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      var fields = [item.title, item.genre, item.category, item.director, item.country, item.description, item.year];
      if (fields.join(' ').toLowerCase().indexOf(q) !== -1) {
        var copy = Object.assign({}, item);
        copy._source = 'description';
        copy._isTranslated = false;
        results.push(copy);
      }
    }

    return results;
  }

  /**
   * Search only series cache
   * @param {string} keyword
   * @returns {Array}
   */
  function searchSeries(keyword) {
    if (!keyword || keyword.trim().length < 1) return [];

    var q = keyword.trim().toLowerCase();
    var data = (memoryCache.series && memoryCache.series.data) || [];
    var results = [];

    for (var i = 0; i < data.length; i++) {
      var item = data[i];
      var fields = [item.title, item.genre, item.category, item.director, item.country, item.description, item.year];
      if (fields.join(' ').toLowerCase().indexOf(q) !== -1) {
        var copy = Object.assign({}, item);
        copy._source = 'series';
        results.push(copy);
      }
    }

    return results;
  }

  /* ────────────────────────────────────────────
     Public: Cache Statistics
     ──────────────────────────────────────────── */

  /**
   * Get cache statistics
   * @returns {Object}
   */
  function getStats() {
    var nodeStats = {};

    var nodeNames = ['translated', 'description', 'series'];
    for (var i = 0; i < nodeNames.length; i++) {
      var name = nodeNames[i];
      var memEntry = memoryCache[name];
      var cfg = CONFIG.nodes[name];
      var lsEntry = readLocalStorage(cfg.localStorageKey);

      nodeStats[name] = {
        inMemory: !!memEntry,
        inLocalStorage: !!lsEntry,
        memoryTimestamp: memEntry ? memEntry.timestamp : null,
        localStorageTimestamp: lsEntry ? lsEntry.timestamp : null,
        memoryAge: memEntry ? (now() - memEntry.timestamp) : null,
        isExpired: memEntry ? isExpired(memEntry.timestamp, cfg.ttl) : true,
        itemCount: memEntry ? memEntry.data.length : (lsEntry ? lsEntry.data.length : 0),
        fetchCount: stats.fetchCount[name] || 0,
        errorCount: stats.errorCount[name] || 0,
        lastRefresh: stats.lastRefresh[name] || null
      };
    }

    return {
      version: CONFIG.version,
      totalHits: stats.hits,
      totalMisses: stats.misses,
      hitRate: (stats.hits + stats.misses) > 0
        ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) + '%'
        : '0%',
      nodes: nodeStats,
      hasInflightRequests: Object.keys(inflightRequests).length > 0,
      inflightNodes: Object.keys(inflightRequests)
    };
  }

  /**
   * Log cache stats to console (dev helper)
   */
  function logStats() {
    var s = getStats();
    console.table(s.nodes);
    console.log('[Casha] Hits:', s.totalHits, '| Misses:', s.totalMisses, '| Hit Rate:', s.hitRate);
  }

  /* ────────────────────────────────────────────
     Public: Utility
     ──────────────────────────────────────────── */

  /**
   * Check if a specific node has data in memory
   * @param {string} nodeName
   * @returns {boolean}
   */
  function hasInMemory(nodeName) {
    return !!(memoryCache[nodeName] && memoryCache[nodeName].data);
  }

  /**
   * Get data from memory only (no fetch, no localStorage)
   * @param {string} nodeName
   * @returns {Array|null}
   */
  function getFromMemory(nodeName) {
    var entry = memoryCache[nodeName];
    return entry ? entry.data : null;
  }

  /**
   * Get combined movies (description + translated, deduplicated by _id)
   * @returns {Array}
   */
  function getAllMovies() {
    var desc = (memoryCache.description && memoryCache.description.data) || [];
    var trans = (memoryCache.translated && memoryCache.translated.data) || [];
    var seen = {};
    var combined = [];

    for (var i = 0; i < desc.length; i++) {
      var d = desc[i];
      if (!seen[d._id]) {
        d._isTranslated = false;
        combined.push(d);
        seen[d._id] = true;
      }
    }

    for (var j = 0; j < trans.length; j++) {
      var t = trans[j];
      if (!seen[t._id]) {
        t._isTranslated = true;
        combined.push(t);
        seen[t._id] = true;
      }
    }

    return combined;
  }

  /**
   * Extract unique years from all cached movie data
   * @returns {Array} Sorted years descending
   */
  function getUniqueYears() {
    var yearSet = {};
    var desc = (memoryCache.description && memoryCache.description.data) || [];
    var trans = (memoryCache.translated && memoryCache.translated.data) || [];
    var all = desc.concat(trans);

    for (var i = 0; i < all.length; i++) {
      var y = all[i].year;
      if (y && y.toString().length >= 4) {
        yearSet[y] = true;
      }
    }

    return Object.keys(yearSet).sort(function (a, b) {
      return parseInt(b) - parseInt(a);
    });
  }

  /**
   * Extract unique genres from all cached movie data
   * @returns {Array} Sorted genres alphabetically
   */
  function getUniqueGenres() {
    var genreSet = {};
    var desc = (memoryCache.description && memoryCache.description.data) || [];
    var trans = (memoryCache.translated && memoryCache.translated.data) || [];
    var all = desc.concat(trans);

    for (var i = 0; i < all.length; i++) {
      var raw = (all[i].genre || '').toLowerCase();
      var items = raw.split(/[,;\/|]+/);
      for (var j = 0; j < items.length; j++) {
        var g = items[j].trim();
        if (g.length > 1) genreSet[g] = true;
      }
    }

    return Object.keys(genreSet).sort();
  }

  /**
   * Clean up expired localStorage entries
   */
  function cleanupExpired() {
    var nodeNames = ['translated', 'description', 'series'];
    var cleaned = 0;

    for (var i = 0; i < nodeNames.length; i++) {
      var name = nodeNames[i];
      var cfg = CONFIG.nodes[name];
      var entry = readLocalStorage(cfg.localStorageKey);

      if (entry && entry.timestamp && isExpired(entry.timestamp, cfg.ttl)) {
        /* Only remove if memory cache also doesn't have fresh data */
        var memEntry = memoryCache[name];
        if (!memEntry || isExpired(memEntry.timestamp, cfg.ttl)) {
          removeLocalStorage(cfg.localStorageKey);
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log('[Casha] Cleaned up', cleaned, 'expired localStorage entries');
    }

    return cleaned;
  }

  /* ────────────────────────────────────────────
     Prefetch (Auto-run on page load)
     ──────────────────────────────────────────── */

  /**
   * Prefetch all nodes silently — populates cache without blocking
   */
  async function prefetch() {
    if (prefetchStarted) return;
    prefetchStarted = true;

    /* Try to promote localStorage to memory first (instant) */
    var nodeNames = ['translated', 'description', 'series'];
    for (var i = 0; i < nodeNames.length; i++) {
      var name = nodeNames[i];
      if (!memoryCache[name]) {
        var cfg = CONFIG.nodes[name];
        var lsEntry = readLocalStorage(cfg.localStorageKey);
        if (lsEntry && lsEntry.data && !isExpired(lsEntry.timestamp, cfg.ttl)) {
          memoryCache[name] = { data: lsEntry.data, timestamp: lsEntry.timestamp };
        }
      }
    }

    /* Then fetch fresh data in parallel */
    try {
      await loadAll({ skipBackgroundRefresh: true });
    } catch (e) {
      console.warn('[Casha] Prefetch had errors (cached data still available):', e.message || e);
    }
  }

  /* ────────────────────────────────────────────
     Initialization
     ──────────────────────────────────────────── */

  function init() {
    /* Clean up any expired leftovers from previous sessions */
    cleanupExpired();

    /* Auto-prefetch if enabled */
    if (CONFIG.prefetchOnInit) {
      prefetch();
    }
  }

  /* Run init immediately */
  init();

  /* ────────────────────────────────────────────
     Public API
     ──────────────────────────────────────────── */

  return {
    /* Load */
    loadTranslated: loadTranslated,
    loadDescription: loadDescription,
    loadSeries: loadSeries,
    loadAll: loadAll,

    /* Refresh */
    refreshTranslated: refreshTranslated,
    refreshDescription: refreshDescription,
    refreshSeries: refreshSeries,
    refreshAll: refreshAll,

    /* Clear */
    clearTranslatedCache: clearTranslatedCache,
    clearDescriptionCache: clearDescriptionCache,
    clearSeriesCache: clearSeriesCache,
    clearAllCache: clearAllCache,

    /* Search (zero Firebase reads) */
    searchMovies: searchMovies,
    searchTranslated: searchTranslated,
    searchDescription: searchDescription,
    searchSeries: searchSeries,

    /* Utility */
    getAllMovies: getAllMovies,
    getUniqueYears: getUniqueYears,
    getUniqueGenres: getUniqueGenres,
    getFromMemory: getFromMemory,
    hasInMemory: hasInMemory,

    /* Stats */
    getStats: getStats,
    logStats: logStats,

    /* Maintenance */
    cleanupExpired: cleanupExpired,
    prefetch: prefetch
  };

})();