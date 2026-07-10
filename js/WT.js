/* =============================================
   WatchTime Tracker (WT.js)
   Tracks movie watch sessions & real-time analytics
   Requires: firebase app.js loaded before this file
   ============================================= */
var WatchTime = (function() {
  'use strict';

  /* ─── Configuration ─── */
  var CONFIG = {
    HEARTBEAT_MS: 15000,       // Active viewer ping every 15s
    SAVE_MS: 10000,            // Save accumulated time every 10s
    INACTIVITY_MS: 300000,     // 5 min silence = auto-stop
    TRENDING_DAYS: 7,          // Trending window
    REPLAY_THRESHOLD: 30,      // Seconds watched before seek-to-0 counts as replay
    REPLAY_POSITION: 5,        // Seek destination < this = replay
    COUNTRY_CACHE_HOURS: 24,
    MAX_SESSION_EVENTS: 200    // Cap events per session to prevent bloat
  };

  /* ─── Internal Session State ─── */
  var _session = {
    id: null,
    movieId: null,
    userId: null,
    movieTitle: '',
    movieDuration: 0,
    startTime: 0,
    lastUpdateTime: 0,
    lastKnownPosition: 0,
    accumulatedSeconds: 0,
    isPlaying: false,
    isPaused: false,
    isComplete: false,
    isActive: false,
    eventCount: 0
  };

  var _heartbeatRef = null;
  var _currentlyWatchingRef = null;
  var _saveInterval = null;
  var _heartbeatInterval = null;
  var _inactivityTimer = null;
  var _countryCache = null;
  var _deviceCache = null;
  var _pageHidden = false;

  /* ─── Firebase Paths ─── */
  var P = {
    sessions: 'watchtime/sessions',
    activeViewers: 'watchtime/activeViewers',
    currentlyWatching: 'watchtime/currentlyWatching',
    mostWatched: 'watchtime/mostWatched',
    trending: 'watchtime/trending',
    daily: 'watchtime/daily',
    weekly: 'watchtime/weekly',
    monthly: 'watchtime/monthly',
    movies: 'watchtime/movies'
  };

  /* =============================================
     UTILITY HELPERS
     ============================================= */

  function _genId() {
    return Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  function _getUserId() {
    if (auth && auth.currentUser) return auth.currentUser.uid;
    var gid = localStorage.getItem('wt_guest_id');
    if (!gid) {
      gid = 'guest_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
      localStorage.setItem('wt_guest_id', gid);
    }
    return gid;
  }

  function _getDevice() {
    if (_deviceCache) return _deviceCache;
    var ua = navigator.userAgent || '';
    if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) { _deviceCache = 'tablet'; }
    else if (/Mobile|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) { _deviceCache = 'mobile'; }
    else { _deviceCache = 'desktop'; }
    return _deviceCache;
  }

  function _getCountry(callback) {
    if (_countryCache) { callback(_countryCache); return; }
    var cached = localStorage.getItem('wt_country');
    var cachedTime = parseInt(localStorage.getItem('wt_country_ts') || '0');
    if (cached && (Date.now() - cachedTime) < CONFIG.COUNTRY_CACHE_HOURS * 3600000) {
      _countryCache = cached;
      callback(_countryCache);
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://ipapi.co/json/', true);
    xhr.timeout = 4000;
    xhr.onload = function() {
      try {
        var data = JSON.parse(xhr.responseText);
        _countryCache = (data.country_code || '').toUpperCase();
      } catch (e) { _countryCache = ''; }
      localStorage.setItem('wt_country', _countryCache || '');
      localStorage.setItem('wt_country_ts', Date.now().toString());
      callback(_countryCache);
    };
    xhr.onerror = xhr.ontimeout = function() {
      _countryCache = localStorage.getItem('wt_country') || '';
      callback(_countryCache);
    };
    xhr.send();
  }

  function _getDateKeys() {
    var now = new Date();
    var y = now.getFullYear();
    var m = String(now.getMonth() + 1).padStart(2, '0');
    var d = String(now.getDate()).padStart(2, '0');

    var jan1 = new Date(y, 0, 1);
    var dayOfYear = Math.ceil((now - jan1) / 86400000);
    var weekNum = Math.ceil(dayOfYear / 7);

    return {
      daily: y + '-' + m + '-' + d,
      weekly: y + '-W' + String(weekNum).padStart(2, '0'),
      monthly: y + '-' + m
    };
  }

  function _viewerKey() {
    return _session.movieId + '_' + _session.userId;
  }

  function _watchPercentage() {
    if (!_session.movieDuration || _session.movieDuration <= 0) return 0;
    return Math.min(100, (_session.accumulatedSeconds / _session.movieDuration) * 100);
  }

  function _safeWrite(ref, data) {
    try { ref.set(data); } catch (e) { /* Silent fail for analytics */ }
  }

  function _safeTransaction(ref, fn) {
    try { ref.transaction(fn); } catch (e) { /* Silent fail */ }
  }

  function _safeUpdate(data) {
    try { database.ref().update(data); } catch (e) { /* Silent fail */ }
  }

  /* =============================================
     INTERNAL: FIREBASE WRITES
     ============================================= */

  function _initSessionInFirebase() {
    var sessionData = {
      movieId: _session.movieId,
      userId: _session.userId,
      movieTitle: _session.movieTitle,
      startTime: _session.startTime,
      endTime: null,
      duration: 0,
      watchPercentage: 0,
      deviceType: _getDevice(),
      country: _countryCache || '',
      status: 'playing',
      movieDuration: _session.movieDuration
    };
    _safeWrite(database.ref(P.sessions + '/' + _session.id), sessionData);
  }

  function _updateSessionField(fields) {
    var updates = {};
    var base = P.sessions + '/' + _session.id + '/';
    for (var key in fields) {
      if (fields.hasOwnProperty(key)) {
        updates[base + key] = fields[key];
      }
    }
    _safeUpdate(updates);
  }

  function _setActiveViewer() {
    var key = _viewerKey();
    var data = {
      movieId: _session.movieId,
      userId: _session.userId,
      movieTitle: _session.movieTitle,
      position: _session.lastKnownPosition,
      lastHeartbeat: firebase.database.ServerValue.TIMESTAMP,
      deviceType: _getDevice(),
      country: _countryCache || '',
      sessionId: _session.id
    };
    _heartbeatRef = database.ref(P.activeViewers + '/' + key);
    _safeWrite(_heartbeatRef, data);

    /* Auto-remove on disconnect */
    _heartbeatRef.onDisconnect().remove();
  }

  function _removeActiveViewer() {
    var key = _viewerKey();
    if (_heartbeatRef) {
      try { _heartbeatRef.onDisconnect().cancel(); } catch (e) {}
      _heartbeatRef = null;
    }
    database.ref(P.activeViewers + '/' + key).remove(function() {});
  }

  function _updateCurrentlyWatching(delta) {
    if (!_session.movieId) return;
    var movieRef = database.ref(P.currentlyWatching + '/' + _session.movieId);

    /* Update title once */
    movieRef.child('title').transaction(function(current) {
      return current || _session.movieTitle;
    }, function() {});

    /* Update viewer count */
    movieRef.child('viewerCount').transaction(function(count) {
      return Math.max(0, (count || 0) + delta);
    }, function() {});

    /* Add/remove this viewer */
    var viewerRef = movieRef.child('viewers/' + _session.userId);
    if (delta > 0) {
      _safeWrite(viewerRef, {
        position: _session.lastKnownPosition,
        lastHeartbeat: firebase.database.ServerValue.TIMESTAMP
      });
      _currentlyWatchingRef = viewerRef;
      viewerRef.onDisconnect().remove();
    } else {
      if (_currentlyWatchingRef) {
        try { _currentlyWatchingRef.onDisconnect().cancel(); } catch (e) {}
        _currentlyWatchingRef = null;
      }
      viewerRef.remove(function() {});

      /* Clean up empty movie node */
      movieRef.child('viewerCount').once('value', function(snap) {
        if ((snap.val() || 0) <= 0) {
          movieRef.remove(function() {});
        }
      });
    }
  }

  function _updateMovieStats(extraSeconds) {
    if (!_session.movieId) return;
    var base = P.movies + '/' + _session.movieId;
    var hoursIncrement = extraSeconds / 3600;

    var updates = {};
    updates[base + '/title'] = _session.movieTitle;
    updates[base + '/lastWatched'] = firebase.database.ServerValue.TIMESTAMP;

    /* Total views (increment once per session start) */
    updates[base + '/totalViews'] = firebase.database.ServerValue.TIMESTAMP;
    _safeTransaction(database.ref(base + '/totalViews'), function(c) { return (c || 0) + 1; });

    /* Watch hours */
    _safeTransaction(database.ref(base + '/watchHours'), function(h) { return (h || 0) + hoursIncrement; });

    /* Unique viewers (set once per user-movie combo) */
    var uvRef = database.ref(base + '/uniqueViewers/' + _session.userId);
    uvRef.transaction(function(val) {
      if (val === null) {
        _safeTransaction(database.ref(base + '/uniqueViewerCount'), function(c) { return (c || 0) + 1; });
        return true;
      }
      return val;
    }, function() {});

    /* Most watched */
    _safeTransaction(database.ref(P.mostWatched + '/' + _session.movieId + '/totalWatchHours'), function(h) { return (h || 0) + hoursIncrement; });
    _safeTransaction(database.ref(P.mostWatched + '/' + _session.movieId + '/totalViews'), function(c) { return (c || 0) + 1; });
    database.ref(P.mostWatched + '/' + _session.movieId + '/title').set(_session.movieTitle);

    /* Trending */
    _safeTransaction(database.ref(P.trending + '/' + _session.movieId + '/recentViews'), function(c) { return (c || 0) + 1; });
    _safeTransaction(database.ref(P.trending + '/' + _session.movieId + '/recentWatchHours'), function(h) { return (h || 0) + hoursIncrement; });
    database.ref(P.trending + '/' + _session.movieId + '/title').set(_session.movieTitle);
    database.ref(P.trending + '/' + _session.movieId + '/lastActivity').set(firebase.database.ServerValue.TIMESTAMP);
  }

  function _updateTimeBuckets(seconds) {
    if (!_session.movieId || seconds <= 0) return;
    var keys = _getDateKeys();
    var hours = seconds / 3600;
    var movieBase;

    var buckets = [
      { path: P.daily + '/' + keys.daily, key: keys.daily },
      { path: P.weekly + '/' + keys.weekly, key: keys.weekly },
      { path: P.monthly + '/' + keys.monthly, key: keys.monthly }
    ];

    for (var i = 0; i < buckets.length; i++) {
      var bucket = buckets[i];
      movieBase = bucket.path + '/movies/' + _session.movieId;

      _safeTransaction(database.ref(bucket.path + '/totalWatchHours'), function(h) { return (h || 0) + hours; });
      _safeTransaction(database.ref(bucket.path + '/totalViews'), function(c) { return (c || 0) + 1; });
      _safeTransaction(database.ref(bucket.path + '/uniqueViewers'), function(c) { return (c || 0) + 1; });

      _safeTransaction(database.ref(movieBase + '/watchHours'), function(h) { return (h || 0) + hours; });
      _safeTransaction(database.ref(movieBase + '/views'), function(c) { return (c || 0) + 1; });
      database.ref(movieBase + '/title').set(_session.movieTitle);
    }
  }

  function _updateCompletionRate(completed) {
    if (!_session.movieId) return;
    var base = P.movies + '/' + _session.movieId;

    _safeTransaction(database.ref(base + '/completions'), function(c) { return (c || 0) + (completed ? 1 : 0); });
    _safeTransaction(database.ref(base + '/totalSessions'), function(c) { return (c || 0) + 1; });

    /* Recalculate completion rate */
    database.ref(base).once('value', function(snap) {
      var d = snap.val();
      if (!d) return;
      var total = (d.totalSessions || 0);
      var comps = (d.completions || 0);
      var rate = total > 0 ? ((comps / total) * 100) : 0;
      database.ref(base + '/completionRate').set(Math.round(rate * 10) / 10);
    });
  }

  /* =============================================
     INTERNAL: EVENT LOGGING
     ============================================= */

  function _logEvent(type, extraData) {
    if (!_session.id || _session.eventCount >= CONFIG.MAX_SESSION_EVENTS) return;
    _session.eventCount++;
    var eventData = {
      type: type,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      position: _session.lastKnownPosition
    };
    if (extraData) {
      for (var key in extraData) {
        if (extraData.hasOwnProperty(key)) eventData[key] = extraData[key];
      }
    }
    _safeWrite(
      database.ref(P.sessions + '/' + _session.id + '/events/' + _session.eventCount),
      eventData
    );
  }

  /* =============================================
     INTERNAL: TIMERS
     ============================================= */

  function _startHeartbeat() {
    _stopHeartbeat();
    _heartbeatInterval = setInterval(function() {
      if (!_session.isActive || !_session.movieId) return;
      var data = {
        position: _session.lastKnownPosition,
        lastHeartbeat: firebase.database.ServerValue.TIMESTAMP
      };
      var key = _viewerKey();
      _safeUpdate({
        [P.activeViewers + '/' + key + '/position']: data.position,
        [P.activeViewers + '/' + key + '/lastHeartbeat']: data.lastHeartbeat,
        [P.currentlyWatching + '/' + _session.movieId + '/viewers/' + _session.userId + '/position']: data.position,
        [P.currentlyWatching + '/' + _session.movieId + '/viewers/' + _session.userId + '/lastHeartbeat']: data.lastHeartbeat
      });
    }, CONFIG.HEARTBEAT_MS);
  }

  function _stopHeartbeat() {
    if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
  }

  function _startSaveInterval() {
    _stopSaveInterval();
    _saveInterval = setInterval(function() {
      if (!_session.isActive || _session.isPaused || _pageHidden) return;
      _performSave();
    }, CONFIG.SAVE_MS);
  }

  function _stopSaveInterval() {
    if (_saveInterval) { clearInterval(_saveInterval); _saveInterval = null; }
  }

  function _performSave() {
    var now = Date.now();
    var delta = (now - _session.lastUpdateTime) / 1000;
    if (delta <= 0 || delta > 120) return; // Skip if gap > 2min (invalid)

    _session.accumulatedSeconds += delta;
    _session.lastUpdateTime = now;

    var roundedSeconds = Math.round(delta);
    _updateSessionField({
      duration: Math.round(_session.accumulatedSeconds),
      watchPercentage: Math.round(_watchPercentage() * 10) / 10
    });

    _updateMovieStats(roundedSeconds);
    _updateTimeBuckets(roundedSeconds);
  }

  function _resetInactivityTimer() {
    if (_inactivityTimer) clearTimeout(_inactivityTimer);
    _inactivityTimer = setTimeout(function() {
      if (_session.isActive && _session.isPlaying) {
        stopWatching(_session.movieId, _session.userId);
      }
    }, CONFIG.INACTIVITY_MS);
  }

  /* =============================================
     INTERNAL: CLEANUP
     ============================================= */

  function _fullCleanup(status) {
    if (!_session.isActive) return;

    /* Final save */
    if (_session.isPlaying && !_session.isPaused) {
      var now = Date.now();
      var delta = (now - _session.lastUpdateTime) / 1000;
      if (delta > 0 && delta < 120) {
        _session.accumulatedSeconds += delta;
        _updateMovieStats(Math.round(delta));
        _updateTimeBuckets(Math.round(delta));
      }
    }

    /* Update session final state */
    _updateSessionField({
      endTime: firebase.database.ServerValue.TIMESTAMP,
      duration: Math.round(_session.accumulatedSeconds),
      watchPercentage: Math.round(_watchPercentage() * 10) / 10,
      status: status || 'abandoned'
    });

    /* Update completion rate */
    var isComplete = status === 'completed';
    _updateCompletionRate(isComplete);

    /* Remove from active viewers */
    _removeActiveViewer();
    _updateCurrentlyWatching(-1);

    /* Stop all timers */
    _stopHeartbeat();
    _stopSaveInterval();
    if (_inactivityTimer) { clearTimeout(_inactivityTimer); _inactivityTimer = null; }

    /* Clear session */
    _session.isActive = false;
    _session.isPlaying = false;
    _session.isPaused = false;
    _session.isComplete = false;

    /* Clear session storage */
    try { sessionStorage.removeItem('wt_session'); } catch (e) {}
  }

  /* =============================================
     PAGE LIFECYCLE LISTENERS
     ============================================= */

  function _onVisibilityChange() {
    if (document.hidden) {
      _pageHidden = true;
      if (_session.isActive && _session.isPlaying && !_session.isPaused) {
        /* Save current progress before going hidden */
        var now = Date.now();
        var delta = (now - _session.lastUpdateTime) / 1000;
        if (delta > 0 && delta < 120) {
          _session.accumulatedSeconds += delta;
          _updateMovieStats(Math.round(delta));
          _updateTimeBuckets(Math.round(delta));
        }
        _session.lastUpdateTime = now;
      }
    } else {
      _pageHidden = false;
      if (_session.isActive && _session.isPlaying && !_session.isPaused) {
        _session.lastUpdateTime = Date.now();
      }
    }
  }

  function _onBeforeUnload() {
    if (_session.isActive) {
      /* Synchronous save attempt using sendBeacon fallback */
      var now = Date.now();
      var delta = (now - _session.lastUpdateTime) / 1000;
      if (delta > 0 && delta < 120) {
        _session.accumulatedSeconds += delta;
      }

      /* Use navigator.sendBeacon for reliable final save */
      var sessionData = {
        endTime: firebase.database.ServerValue.TIMESTAMP,
        duration: Math.round(_session.accumulatedSeconds),
        watchPercentage: Math.round(_watchPercentage() * 10) / 10,
        status: 'abandoned'
      };

      try {
        var sessionRef = P.sessions + '/' + _session.id + '.json';
        var authPayload = '';
        if (auth && auth.currentUser) {
          auth.currentUser.getIdToken().then(function(token) {
            var url = 'https://' + firebaseConfig.projectId + '.firebaseio.com/' + sessionRef + '?auth=' + token;
            navigator.sendBeacon(url, JSON.stringify(sessionData));
          });
        } else {
          var url2 = 'https://' + firebaseConfig.projectId + '.firebaseio.com/' + sessionRef;
          navigator.sendBeacon(url2, JSON.stringify(sessionData));
        }
      } catch (e) {
        /* sendBeacon not available, try synchronous XHR as last resort */
        try {
          var xhr = new XMLHttpRequest();
          xhr.open('PUT', 'https://' + firebaseConfig.projectId + '.firebaseio.com/' + P.sessions + '/' + _session.id + '.json', false);
          xhr.send(JSON.stringify(sessionData));
        } catch (e2) { /* Can't save, move on */ }
      }

      /* Remove active viewer synchronously */
      try {
        var xhr2 = new XMLHttpRequest();
        xhr2.open('DELETE', 'https://' + firebaseConfig.projectId + '.firebaseio.com/' + P.activeViewers + '/' + _viewerKey() + '.json', false);
        xhr2.send();
      } catch (e) {}

      _session.isActive = false;
    }
  }

  function _setupPageListeners() {
    document.addEventListener('visibilitychange', _onVisibilityChange);
    window.addEventListener('beforeunload', _onBeforeUnload);
  }

  /* =============================================
     PUBLIC API: CORE TRACKING
     ============================================= */

  /**
   * Start a watch session
   * @param {string} movieId
   * @param {string} [userId] - defaults to current auth user or guest
   * @param {string} [movieTitle]
   * @param {number} [movieDuration] - in seconds
   */
  function startWatching(movieId, userId, movieTitle, movieDuration) {
    if (!movieId) { console.warn('[WT] startWatching: movieId is required'); return; }

    /* Stop any existing session first */
    if (_session.isActive) {
      _fullCleanup('abandoned');
    }

    /* Check for recoverable session */
    try {
      var saved = sessionStorage.getItem('wt_session');
      if (saved) {
        var parsed = JSON.parse(saved);
        if (parsed.movieId === movieId && (Date.now() - parsed.startTime) < 7200000) {
          _session = parsed;
          _session.isActive = true;
          _session.lastUpdateTime = Date.now();
          _setActiveViewer();
          _updateCurrentlyWatching(1);
          _startHeartbeat();
          _startSaveInterval();
          _logEvent('resume', { recovered: true });
          console.log('[WT] Session recovered:', _session.id);
          return;
        }
      }
    } catch (e) { /* Ignore parse errors */ }

    /* Create new session */
    _session.id = _genId();
    _session.movieId = movieId;
    _session.userId = userId || _getUserId();
    _session.movieTitle = movieTitle || '';
    _session.movieDuration = parseFloat(movieDuration) || 0;
    _session.startTime = Date.now();
    _session.lastUpdateTime = Date.now();
    _session.lastKnownPosition = 0;
    _session.accumulatedSeconds = 0;
    _session.isPlaying = true;
    _session.isPaused = false;
    _session.isComplete = false;
    _session.isActive = true;
    _session.eventCount = 0;

    /* Save session to sessionStorage for recovery */
    try { sessionStorage.setItem('wt_session', JSON.stringify(_session)); } catch (e) {}

    /* Get country then initialize everything */
    _getCountry(function(country) {
      _countryCache = country;

      _initSessionInFirebase();
      _setActiveViewer();
      _updateCurrentlyWatching(1);
      _updateMovieStats(0);
      _logEvent('play');
      _startHeartbeat();
      _startSaveInterval();
      _resetInactivityTimer();

      console.log('[WT] Session started:', _session.id, '| Movie:', _session.movieTitle);
    });
  }

  /**
   * Update current watch position (call periodically from player)
   * @param {string} [movieId]
   * @param {string} [userId]
   * @param {number} currentPosition - current playback position in seconds
   */
  function updateWatchTime(movieId, userId, currentPosition) {
    if (!_session.isActive) return;
    if (typeof currentPosition === 'number' && currentPosition >= 0) {
      var oldPos = _session.lastKnownPosition;
      _session.lastKnownPosition = currentPosition;

      /* Detect seek */
      var diff = Math.abs(currentPosition - oldPos);
      if (diff > 5 && oldPos > 0) {
        /* Check if it's a replay */
        if (currentPosition < CONFIG.REPLAY_POSITION && oldPos > CONFIG.REPLAY_THRESHOLD) {
          _logEvent('replay', { from: oldPos, to: currentPosition });
        } else {
          _logEvent('seek', { from: oldPos, to: currentPosition });
        }
      }

      _resetInactivityTimer();
    }
  }

  /**
   * Pause the watch session
   */
  function pauseWatching(movieId, userId) {
    if (!_session.isActive || _session.isPaused) return;

    /* Save time up to now */
    var now = Date.now();
    var delta = (now - _session.lastUpdateTime) / 1000;
    if (delta > 0 && delta < 120) {
      _session.accumulatedSeconds += delta;
      _updateMovieStats(Math.round(delta));
      _updateTimeBuckets(Math.round(delta));
    }
    _session.lastUpdateTime = now;

    _session.isPaused = true;
    _session.isPlaying = false;

    _updateSessionField({ status: 'paused' });
    _logEvent('pause');
    console.log('[WT] Paused at', Math.round(_session.accumulatedSeconds), 's');
  }

  /**
   * Resume from pause
   */
  function resumeWatching(movieId, userId) {
    if (!_session.isActive || !_session.isPaused) return;

    _session.isPaused = false;
    _session.isPlaying = true;
    _session.lastUpdateTime = Date.now();

    _updateSessionField({ status: 'playing' });
    _logEvent('resume');
    _resetInactivityTimer();
    console.log('[WT] Resumed at', Math.round(_session.lastKnownPosition), 's');
  }

  /**
   * Stop watching (abandon)
   */
  function stopWatching(movieId, userId) {
    if (!_session.isActive) return;
    _logEvent('abandon');
    _fullCleanup('abandoned');
    console.log('[WT] Session stopped. Watched:', Math.round(_session.accumulatedSeconds), 's');
  }

  /**
   * Mark movie as completed
   */
  function completeMovie(movieId, userId) {
    if (!_session.isActive) return;

    /* Ensure full duration is counted */
    var now = Date.now();
    var delta = (now - _session.lastUpdateTime) / 1000;
    if (delta > 0 && delta < 120) {
      _session.accumulatedSeconds += delta;
    }

    _session.isComplete = true;
    _session.isPlaying = false;
    _session.isPaused = false;

    _logEvent('complete', { watchPercentage: Math.round(_watchPercentage() * 10) / 10 });
    _fullCleanup('completed');
    console.log('[WT] Completed. Total:', Math.round(_session.accumulatedSeconds), 's (' + Math.round(_watchPercentage()) + '%)');
  }

  /* =============================================
     PUBLIC API: ANALYTICS GETTERS
     ============================================= */

  /**
   * Get most watched movies of all time
   * @param {number} [limit=20]
   * @returns {Promise<Array>}
   */
  function getMostWatched(limit) {
    limit = limit || 20;
    return database.ref(P.mostWatched)
      .orderByChild('totalWatchHours')
      .limitToLast(limit)
      .once('value')
      .then(function(snap) {
        var results = [];
        snap.forEach(function(child) {
          var d = child.val();
          d.movieId = child.key;
          results.push(d);
        });
        results.sort(function(a, b) { return (b.totalWatchHours || 0) - (a.totalWatchHours || 0); });
        return results;
      });
  }

  /**
   * Get trending movies (weighted recent activity)
   * @param {number} [limit=20]
   * @returns {Promise<Array>}
   */
  function getTrendingMovies(limit) {
    limit = limit || 20;
    var cutoff = Date.now() - (CONFIG.TRENDING_DAYS * 86400000);

    return database.ref(P.trending)
      .orderByChild('lastActivity')
      .startAt(cutoff)
      .once('value')
      .then(function(snap) {
        var results = [];
        var now = Date.now();
        snap.forEach(function(child) {
          var d = child.val();
          if (!d.lastActivity || d.lastActivity < cutoff) return;
          /* Calculate trending score: views + watchHours*5 + time decay */
          var ageHours = (now - d.lastActivity) / 3600000;
          var decay = Math.max(0.1, 1 - (ageHours / (CONFIG.TRENDING_DAYS * 24)));
          d.score = ((d.recentViews || 0) * 1) + ((d.recentWatchHours || 0) * 5) * decay;
          d.movieId = child.key;
          results.push(d);
        });
        results.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
        return results.slice(0, limit);
      });
  }

  /**
   * Get currently watching movies with viewer counts
   * @returns {Promise<Array>}
   */
  function getCurrentlyWatching() {
    return database.ref(P.currentlyWatching)
      .once('value')
      .then(function(snap) {
        var results = [];
        snap.forEach(function(child) {
          var d = child.val();
          d.movieId = child.key;
          results.push(d);
        });
        results.sort(function(a, b) { return (b.viewerCount || 0) - (a.viewerCount || 0); });
        return results;
      });
  }

  /**
   * Get analytics for a specific movie
   * @param {string} movieId
   * @returns {Promise<Object>}
   */
  function getMovieAnalytics(movieId) {
    if (!movieId) return Promise.resolve(null);

    return Promise.all([
      database.ref(P.movies + '/' + movieId).once('value'),
      database.ref(P.mostWatched + '/' + movieId).once('value'),
      database.ref(P.trending + '/' + movieId).once('value'),
      database.ref(P.sessions).orderByChild('movieId').equalTo(movieId).limitToLast(50).once('value')
    ]).then(function(results) {
      var stats = results[0].val() || {};
      var mostWatched = results[1].val() || {};
      var trending = results[2].val() || {};
      var sessions = [];

      results[3].forEach(function(child) {
        sessions.push(child.val());
      });

      /* Calculate average watch percentage from sessions */
      var totalPercent = 0;
      var percentCount = 0;
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].watchPercentage) {
          totalPercent += sessions[i].watchPercentage;
          percentCount++;
        }
      }

      return {
        movieId: movieId,
        title: stats.title || mostWatched.title || '',
        totalViews: stats.totalViews || mostWatched.totalViews || 0,
        watchHours: Math.round((stats.watchHours || mostWatched.totalWatchHours || 0) * 100) / 100,
        uniqueViewers: stats.uniqueViewerCount || 0,
        completionRate: stats.completionRate || 0,
        avgWatchPercentage: percentCount > 0 ? Math.round((totalPercent / percentCount) * 10) / 10 : 0,
        lastWatched: stats.lastWatched || null,
        trendingScore: trending.score || 0,
        recentViews: trending.recentViews || 0,
        recentWatchHours: trending.recentWatchHours || 0,
        recentSessions: sessions.reverse()
      };
    });
  }

  /**
   * Get full dashboard stats
   * @returns {Promise<Object>}
   */
  function getDashboardStats() {
    var keys = _getDateKeys();

    return Promise.all([
      database.ref(P.activeViewers).once('value'),
      database.ref(P.currentlyWatching).once('value'),
      database.ref(P.daily + '/' + keys.daily).once('value'),
      database.ref(P.weekly + '/' + keys.weekly).once('value'),
      database.ref(P.monthly + '/' + keys.monthly).once('value'),
      getMostWatched(5),
      getTrendingMovies(10),
      getCurrentlyWatching()
    ]).then(function(results) {
      var activeViewersSnap = results[0];
      var currentlyWatchingSnap = results[1];
      var daily = results[2].val() || {};
      var weekly = results[3].val() || {};
      var monthly = results[4].val() || {};
      var mostWatched = results[5];
      var trending = results[6];
      var currentlyWatching = results[7];

      var activeViewerCount = 0;
      activeViewersSnap.forEach(function() { activeViewerCount++; });

      return {
        /* Real-time */
        activeViewerCount: activeViewerCount,
        currentlyWatching: currentlyWatching,

        /* Today */
        today: {
          totalWatchHours: Math.round((daily.totalWatchHours || 0) * 100) / 100,
          totalViews: daily.totalViews || 0,
          uniqueViewers: daily.uniqueViewers || 0,
          dateKey: keys.daily
        },

        /* This week */
        thisWeek: {
          totalWatchHours: Math.round((weekly.totalWatchHours || 0) * 100) / 100,
          totalViews: weekly.totalViews || 0,
          uniqueViewers: weekly.uniqueViewers || 0,
          dateKey: keys.weekly
        },

        /* This month */
        thisMonth: {
          totalWatchHours: Math.round((monthly.totalWatchHours || 0) * 100) / 100,
          totalViews: monthly.totalViews || 0,
          uniqueViewers: monthly.uniqueViewers || 0,
          dateKey: keys.monthly
        },

        /* Rankings */
        mostWatchedAllTime: mostWatched,
        mostWatchedToday: _extractTopMovies(daily, 5),
        mostWatchedThisWeek: _extractTopMovies(weekly, 5),
        mostWatchedThisMonth: _extractTopMovies(monthly, 5),
        trendingMovies: trending
      };
    });
  }

  /* Helper: extract top movies from a time bucket */
  function _extractTopMovies(bucket, limit) {
    if (!bucket || !bucket.movies) return [];
    var movies = [];
    for (var key in bucket.movies) {
      if (bucket.movies.hasOwnProperty(key)) {
        var m = bucket.movies[key];
        m.movieId = key;
        movies.push(m);
      }
    }
    movies.sort(function(a, b) { return (b.watchHours || 0) - (a.watchHours || 0); });
    return movies.slice(0, limit);
  }

  /* =============================================
     INIT: Set up page lifecycle listeners
     ============================================= */
  _setupPageListeners();

  /* =============================================
     PUBLIC API EXPORT
     ============================================= */
  return {
    startWatching: startWatching,
    updateWatchTime: updateWatchTime,
    pauseWatching: pauseWatching,
    resumeWatching: resumeWatching,
    stopWatching: stopWatching,
    completeMovie: completeMovie,
    getMostWatched: getMostWatched,
    getTrendingMovies: getTrendingMovies,
    getCurrentlyWatching: getCurrentlyWatching,
    getMovieAnalytics: getMovieAnalytics,
    getDashboardStats: getDashboardStats
  };

})();