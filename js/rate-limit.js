/* =============================================
   rate-limit.js — Client-Side Rate Limiting & Abuse Protection
   =============================================
   Protects against excessive requests, reduces unnecessary Firebase 
   reads, and integrates with casha.js to ignore cached data.
   
   NOTE: Client-side rate limiting is a first line of defense. It 
   prevents UI spam and reduces Firebase bandwidth. For strict 
   security, pair this with Firebase Security Rules or Cloud Functions.
   ============================================= */

var RateLimiter = (function () {
  'use strict';

  /* ────────────────────────────────────────────
     Configuration (Easily adjustable)
     ──────────────────────────────────────────── */
  var CONFIG = {
    enabled: true,
    logging: true,
    
    limits: {
      homepage:    { max: 100, windowMs: 60 * 1000 },       // 100 req/min
      movieRead:   { max: 60,  windowMs: 60 * 1000 },       // 60 Firebase reads/min
      search:      { max: 30,  windowMs: 60 * 1000 },       // 30 searches/min
      streaming:   { max: 100, windowMs: 60 * 1000 },       // 100 req/min
      admin:       { max: 20,  windowMs: 60 * 1000 },       // 20 actions/min
      login:       { maxFails: 5, blockWindowMs: 15 * 60 * 1000 } // 5 fails -> 15 min block
    }
  };

  /* ────────────────────────────────────────────
     Internal State
     ──────────────────────────────────────────── */
  
  /** Stores timestamps of requests: { identifier: { type: [timestamp, ...] } } */
  var requestStore = {};

  /** Stores failed login attempts: { identifier: { attempts: [], blockedUntil: timestamp } } */
  var loginStore = {};

  /** Persistent anonymous session ID (fallback if user is not logged in) */
  var sessionId = localStorage.getItem('rl_session_id');
  if (!sessionId) {
    sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    try { localStorage.setItem('rl_session_id', sessionId); } catch (e) {}
  }

  /* ────────────────────────────────────────────
     Helpers
     ──────────────────────────────────────────── */

  /**
   * Get the best available identifier for the current user
   * Priority: Auth UID > Session ID
   */
  function getIdentifier() {
    try {
      if (auth && auth.currentUser && auth.currentUser.uid) {
        return 'user_' + auth.currentUser.uid;
      }
    } catch (e) {
      // auth might not be defined yet on very first load
    }
    return 'anon_' + sessionId;
  }

  /**
   * Logging utility
   */
  function log(action, type, identifier, details) {
    if (!CONFIG.logging) return;
    var msg = '[RateLimiter] ' + action + ' | Type: ' + type + ' | ID: ' + identifier;
    if (details) msg += ' | ' + details;
    
    if (action === 'BLOCK') {
      console.warn(msg);
    } else {
      console.log(msg);
    }
  }

  /**
   * Prune old timestamps outside the time window
   */
  function pruneTimestamps(timestamps, windowMs) {
    var now = Date.now();
    var valid = [];
    for (var i = 0; i < timestamps.length; i++) {
      if (now - timestamps[i] < windowMs) {
        valid.push(timestamps[i]);
      }
    }
    return valid;
  }

  /* ────────────────────────────────────────────
     Core Logic
     ──────────────────────────────────────────── */

  /**
   * Internal function to check if an action is allowed based on limits
   */
  function isAllowed(type) {
    if (!CONFIG.enabled) return true;

    var limitCfg = CONFIG.limits[type];
    if (!limitCfg || !limitCfg.max) return true; // Unknown type, allow by default

    var id = getIdentifier();
    var windowMs = limitCfg.windowMs;

    // Initialize store for this user/type if needed
    if (!requestStore[id]) requestStore[id] = {};
    if (!requestStore[id][type]) requestStore[id][type] = [];

    // Clean up old requests
    requestStore[id][type] = pruneTimestamps(requestStore[id][type], windowMs);

    // Check if limit is exceeded
    if (requestStore[id][type].length >= limitCfg.max) {
      log('BLOCK', type, id, 'Limit ' + limitCfg.max + '/' + (windowMs / 1000) + 's reached');
      return false;
    }

    // Record this request
    requestStore[id][type].push(Date.now());
    log('ALLOW', type, id);
    return true;
  }

  /* ────────────────────────────────────────────
     Public API: Action Checkers
     ──────────────────────────────────────────── */

  /**
   * Generic request checker
   * @param {string} type - 'homepage', 'movieRead', 'search', 'streaming', 'admin'
   * @returns {boolean}
   */
  function allowRequest(type) {
    return isAllowed(type);
  }

  /**
   * Search protection (30/min)
   * @returns {boolean}
   */
  function allowSearch() {
    return isAllowed('search');
  }

  /**
   * Movie Read Protection with Casha Integration
   * If data is already in Casha memory, it does NOT count against the limit.
   * @returns {boolean}
   */
  function allowMovieRead() {
    if (!CONFIG.enabled) return true;

    // 1. Integrate with Casha.js
    if (typeof Casha !== 'undefined' && Casha.hasInMemory) {
      // If ALL nodes are cached, this read won't hit Firebase. Bypass limit.
      if (Casha.hasInMemory('description') && 
          Casha.hasInMemory('translated') && 
          Casha.hasInMemory('series')) {
        log('CACHE_HIT', 'movieRead', getIdentifier(), 'Firebase read prevented by Casha');
        return true;
      }
    }

    // 2. Data is missing, this WILL trigger a Firebase read. Apply limit.
    return isAllowed('movieRead');
  }

  /**
   * Streaming Page Protection (100/min)
   * @returns {boolean}
   */
  function allowStreaming() {
    return isAllowed('streaming');
  }

  /**
   * Login Protection (Complex: tracks failures, applies 15min block)
   * NOTE: Call recordLoginSuccess() or recordLoginFailure() AFTER this check.
   * @returns {boolean}
   */
  function allowLogin() {
    if (!CONFIG.enabled) return true;

    var id = getIdentifier();
    var loginCfg = CONFIG.limits.login;
    var now = Date.now();

    if (!loginStore[id]) loginStore[id] = { attempts: [], blockedUntil: null };

    // Check if currently blocked
    if (loginStore[id].blockedUntil && now < loginStore[id].blockedUntil) {
      var remainingMs = loginStore[id].blockedUntil - now;
      var remainingMin = Math.ceil(remainingMs / 60000);
      log('BLOCK', 'login', id, 'Blocked for ' + remainingMin + ' more minutes');
      return false;
    }

    // If block expired, reset state
    if (loginStore[id].blockedUntil && now >= loginStore[id].blockedUntil) {
      loginStore[id] = { attempts: [], blockedUntil: null };
    }

    return true;
  }

  /**
   * Admin Action Protection (20/min)
   * @returns {boolean}
   */
  function allowAdminAction() {
    return isAllowed('admin');
  }

  /* ────────────────────────────────────────────
     Public API: Login State Recorders
     ──────────────────────────────────────────── */

  /**
   * Call this when a login attempt FAILS
   */
  function recordLoginFailure() {
    if (!CONFIG.enabled) return;
    var id = getIdentifier();
    var loginCfg = CONFIG.limits.login;
    var now = Date.now();

    if (!loginStore[id]) loginStore[id] = { attempts: [], blockedUntil: null };

    // Prune old attempts outside the block window
    loginStore[id].attempts = pruneTimestamps(loginStore[id].attempts, loginCfg.blockWindowMs);
    
    // Record this failure
    loginStore[id].attempts.push(now);
    log('ALLOW', 'login_fail', id, 'Fail count: ' + loginStore[id].attempts.length);

    // Check if threshold reached to apply block
    if (loginStore[id].attempts.length >= loginCfg.maxFails) {
      loginStore[id].blockedUntil = now + loginCfg.blockWindowMs;
      log('BLOCK', 'login_trigger', id, 'Max fails reached. Blocked for 15 minutes.');
    }
  }

  /**
   * Call this when a login attempt SUCCEEDS (clears the failure counter)
   */
  function recordLoginSuccess() {
    var id = getIdentifier();
    delete loginStore[id];
    log('ALLOW', 'login_success', id, 'Fail counter reset.');
  }

  /* ────────────────────────────────────────────
     Public API: Management & Stats
     ──────────────────────────────────────────── */

  /**
   * Reset all limits for a specific user (e.g., after admin intervention)
   * @param {string} userId - Firebase UID
   */
  function resetLimits(userId) {
    var id = userId ? 'user_' + userId : getIdentifier();
    delete requestStore[id];
    delete loginStore[id];
    log('ALLOW', 'reset', id, 'All limits cleared.');
  }

  /**
   * Get current rate limit status for debugging/display
   * @param {string} [userId]
   * @returns {Object}
   */
  function getRateLimitStatus(userId) {
    var id = userId ? 'user_' + userId : getIdentifier();
    var status = {
      identifier: id,
      limits: {},
      login: {}
    };

    var types = ['homepage', 'movieRead', 'search', 'streaming', 'admin'];
    for (var i = 0; i < types.length; i++) {
      var type = types[i];
      var limitCfg = CONFIG.limits[type];
      var timestamps = (requestStore[id] && requestStore[id][type]) ? requestStore[id][type] : [];
      var pruned = pruneTimestamps(timestamps, limitCfg.windowMs);
      
      status.limits[type] = {
        current: pruned.length,
        max: limitCfg.max,
        windowSeconds: limitCfg.windowMs / 1000,
        isBlocked: pruned.length >= limitCfg.max
      };
    }

    // Login status
    var loginData = loginStore[id];
    var now = Date.now();
    if (loginData) {
      var prunedAttempts = pruneTimestamps(loginData.attempts || [], CONFIG.limits.login.blockWindowMs);
      status.login = {
        recentFailures: prunedAttempts.length,
        maxFails: CONFIG.limits.login.maxFails,
        isBlocked: !!(loginData.blockedUntil && now < loginData.blockedUntil),
        blockedUntil: loginData.blockedUntil || null
      };
    } else {
      status.login = { recentFailures: 0, maxFails: CONFIG.limits.login.maxFails, isBlocked: false, blockedUntil: null };
    }

    return status;
  }

  /**
   * Print current user's status to console
   */
  function logStatus() {
    var status = getRateLimitStatus();
    console.table(status.limits);
    console.log('[RateLimiter] Login Status:', status.login);
  }

  /* ────────────────────────────────────────────
     Memory Cleanup (Garbage Collection)
     ──────────────────────────────────────────── */
  
  /**
   * Prevents memory leaks by removing inactive users/anonymous sessions
   * Runs every 5 minutes
   */
  setInterval(function () {
    var now = Date.now();
    var maxAge = 10 * 60 * 1000; // 10 minutes of inactivity

    for (var id in requestStore) {
      if (!requestStore.hasOwnProperty(id)) continue;
      
      var isExpired = true;
      var types = Object.keys(requestStore[id]);
      
      for (var i = 0; i < types.length; i++) {
        var type = types[i];
        var limitCfg = CONFIG.limits[type];
        if (!limitCfg || !limitCfg.windowMs) continue;

        // Prune and check if any recent activity remains
        requestStore[id][type] = pruneTimestamps(requestStore[id][type], maxAge);
        if (requestStore[id][type].length > 0) {
          isExpired = false;
          break;
        }
      }

      // Delete user from memory if completely inactive for 10 mins
      if (isExpired) {
        delete requestStore[id];
      }
    }

    // Cleanup old login failures
    for (var loginId in loginStore) {
      if (!loginStore.hasOwnProperty(loginId)) continue;
      var ld = loginStore[loginId];
      if (ld.blockedUntil && now > ld.blockedUntil + maxAge) {
        delete loginStore[loginId];
      } else if (!ld.blockedUntil) {
        ld.attempts = pruneTimestamps(ld.attempts, maxAge);
        if (ld.attempts.length === 0) delete loginStore[loginId];
      }
    }
  }, 5 * 60 * 1000);


  /* ────────────────────────────────────────────
     Export Public API
     ──────────────────────────────────────────── */

  return {
    // Checkers
    allowRequest: allowRequest,
    allowSearch: allowSearch,
    allowMovieRead: allowMovieRead,
    allowStreaming: allowStreaming,
    allowLogin: allowLogin,
    allowAdminAction: allowAdminAction,

    // Login State
    recordLoginFailure: recordLoginFailure,
    recordLoginSuccess: recordLoginSuccess,

    // Management
    resetLimits: resetLimits,
    getRateLimitStatus: getRateLimitStatus,
    logStatus: logStatus
  };

})();