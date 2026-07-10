/**
 * ========================================================================
 * @file        js/autorefresh.js
 * @description Global Background Auto Refresh Engine
 * @version     1.0.0
 * @license     Private
 * ========================================================================
 * 
 * NETFLIX-STYLE BACKGROUND AUTO REFRESH ENGINE
 * 
 * This module provides seamless background data synchronization for a
 * streaming platform. It refreshes content every 5 seconds without any
 * visible page reloads, interruptions, or user-perceivable changes.
 * 
 * KEY FEATURES:
 * - 5-second background refresh cycle
 * - Version-based change detection (only updates changed data)
 * - Smart page detection (refreshes only relevant data)
 * - Watch page protection (never interrupts playback)
 * - In-memory + localStorage caching
 * - Efficient DOM patching with requestAnimationFrame
 * - Online/offline handling with auto-resume
 * - Self-healing with retry logic
 * - Low CPU and battery usage
 * 
 * DEPENDENCIES:
 * - config.js (provides: firebase, auth, database, storage)
 * 
 * INTEGRATES WITH:
 * - app.js, video-watch.js, continue.js, resume.js
 * - quality.js, analytics.js, offline-manager.js
 * - translated.js, cast.js, channel.js, live.js
 * - Service Worker, PWA
 * 
 * ========================================================================
 */

(function (global) {
    'use strict';

    /* ====================================================================
     * SECTION 1: CONSTANTS & CONFIGURATION
     * ==================================================================== */

    /**
     * Refresh interval in milliseconds (5 seconds)
     * This is the core timing for all background refresh operations
     */
    var REFRESH_INTERVAL_MS = 5000;

    /**
     * Delay before retrying a failed refresh (3 seconds)
     */
    var RETRY_DELAY_MS = 3000;

    /**
     * Maximum number of retry attempts before giving up on a cycle
     */
    var MAX_RETRY_ATTEMPTS = 3;

    /**
     * Prefix for all localStorage cache keys
     */
    var CACHE_KEY_PREFIX = 'autorefresh_';

    /**
     * localStorage key for storing version tracking data
     */
    var VERSION_CACHE_KEY = CACHE_KEY_PREFIX + 'versions';

    /**
     * localStorage key for storing last successful refresh timestamp
     */
    var LAST_REFRESH_KEY = CACHE_KEY_PREFIX + 'lastRefresh';

    /**
     * Maximum age for cached data before forced refresh (5 minutes)
     */
    var CACHE_MAX_AGE_MS = 300000;

    /**
     * DOM selector patterns for common elements
     * Used for efficient element lookups
     */
    var SELECTORS = {
        featuredBanner: '#featured-banner, .featured-banner, .hero-banner',
        bannerTitle: '.banner-title, .hero-title, .featured-title',
        bannerDescription: '.banner-description, .hero-description',
        bannerImage: '.banner-image, .hero-image, .featured-image img',
        bannerRating: '.banner-rating, .hero-rating',
        movieRow: '.movie-row, .content-row',
        movieCard: '.movie-card, .content-card, .video-card',
        cardImage: '.card-image img, .poster-img, .thumbnail',
        cardTitle: '.card-title, .movie-title, .video-title',
        cardRating: '.card-rating, .movie-rating',
        cardBadge: '.card-badge, .new-badge, .badge-new',
        progressBar: '.progress-bar, .watch-progress, .completion-bar',
        timeLeft: '.time-left, .remaining-time',
        continueWatching: '#continue-watching, .continue-watching-section',
        notificationsContainer: '#notifications-container, .notifications-list, .notifications-dropdown',
        notificationBadge: '.notification-badge, .notif-count, .badge-notif',
        notificationItem: '.notification-item, .notif-item',
        notificationText: '.notification-text, .notif-text',
        notificationTime: '.notification-time, .notif-time',
        announcementsBar: '#announcements, .announcements-bar, .announcement-banner',
        announcementText: '.announcement-text, .announcement-content',
        viewCount: '.views-count, .video-views, .view-count',
        likeCount: '.likes-count, .like-count, .btn-like .count',
        dislikeCount: '.dislikes-count, .dislike-count, .btn-dislike .count',
        videoDescription: '.video-description, .watch-description, .description-text',
        castList: '.cast-list, .video-cast, .cast-section',
        castItem: '.cast-item, .cast-card',
        castName: '.cast-name, .actor-name',
        castRole: '.cast-role, .character-name',
        castPhoto: '.cast-photo img, .cast-avatar img',
        recommendationsList: '.recommendations-list, .sidebar-recommendations, .related-videos',
        recommendationItem: '.recommendation-item, .sidebar-card, .related-card',
        commentSection: '.comments-section, .comments-list',
        commentItem: '.comment-item, .comment',
        commentCount: '.comments-count, .comment-header .count',
        commentAvatar: '.comment-avatar img',
        commentUsername: '.comment-username, .comment-author',
        commentText: '.comment-text, .comment-content',
        commentTime: '.comment-time, .comment-date',
        commentLikes: '.comment-likes, .comment-like-count',
        liveViewerCount: '.viewer-count, .live-viewers, .watching-now',
        liveIndicator: '.live-indicator, .live-status, .live-badge',
        currentProgram: '.current-program, .now-playing',
        currentProgramTitle: '.current-program-title, .now-playing-title',
        currentProgramDesc: '.current-program-description',
        currentProgramTime: '.current-program-time, .now-playing-time',
        nextProgram: '.next-program, .up-next',
        nextProgramTitle: '.next-program-title, .up-next-title',
        nextProgramTime: '.next-program-time, .up-next-time',
        scheduleList: '.schedule-list, .program-schedule, .epg-list',
        scheduleItem: '.schedule-item, .epg-item',
        scheduleTime: '.schedule-time, .epg-time',
        scheduleTitle: '.schedule-title, .epg-title',
        channelLogo: '.channel-logo, .live-channel-logo',
        channelGrid: '.channels-grid, .channel-list',
        channelCard: '.channel-card, .channel-item',
        channelName: '.channel-name, .channel-title',
        channelStatus: '.channel-status, .channel-live-status',
        profileAvatar: '.profile-avatar, .user-avatar, .avatar-img',
        profileUsername: '.profile-username, .user-name, .display-name',
        profileEmail: '.profile-email, .user-email',
        statWatched: '.stat-watched, .watched-count, .movies-watched',
        statWatchlist: '.stat-watchlist, .watchlist-count',
        watchHistory: '.watch-history-list, .history-section',
        historyItem: '.history-item, .history-card',
        historyTitle: '.history-title, .history-name',
        moviesGrid: '.movies-grid, .movie-grid, .content-grid',
        seriesGrid: '.series-grid, .shows-grid',
        maintenanceOverlay: '#maintenance-overlay'
    };

    /**
     * Mapping of pages to the refresh nodes they care about
     * Only these nodes will be checked/refreshed when on each page
     * This prevents unnecessary Firebase reads
     */
    var PAGE_NODE_MAP = {
        'index.html': [
            'homepage',
            'featured',
            'banners',
            'recommendations',
            'continueWatching',
            'watchlist',
            'notifications',
            'movies',
            'series',
            'maintenance',
            'appVersion'
        ],
        '': [
            'homepage',
            'featured',
            'banners',
            'recommendations',
            'continueWatching',
            'watchlist',
            'notifications',
            'movies',
            'series',
            'maintenance',
            'appVersion'
        ],
        'watch.html': [
            'movies',
            'series',
            'recommendations',
            'notifications',
            'maintenance'
        ],
        'video.html': [
            'movies',
            'series',
            'recommendations',
            'notifications',
            'maintenance'
        ],
        'movie.html': [
            'movies',
            'recommendations',
            'notifications',
            'maintenance'
        ],
        'series.html': [
            'series',
            'recommendations',
            'notifications',
            'maintenance'
        ],
        'channel.html': [
            'channels',
            'live',
            'notifications',
            'maintenance'
        ],
        'cast.html': [
            'movies',
            'series',
            'notifications',
            'maintenance'
        ],
        'live.html': [
            'live',
            'channels',
            'notifications',
            'maintenance'
        ],
        'profile.html': [
            'profile',
            'watchHistory',
            'watchlist',
            'notifications',
            'maintenance'
        ],
        'download.html': [
            'movies',
            'series',
            'notifications',
            'maintenance'
        ],
        'helpcenter.html': [
            'maintenance',
            'appVersion'
        ],
        'services.html': [
            'maintenance',
            'appVersion'
        ],
        'translated.html': [
            'translated',
            'notifications',
            'maintenance'
        ],
        'viewall.html': [
            'movies',
            'series',
            'notifications',
            'maintenance'
        ],
        'privacy.html': [
            'maintenance',
            'appVersion'
        ],
        'cookies.html': [
            'maintenance',
            'appVersion'
        ],
        'verification.html': [
            'maintenance',
            'appVersion'
        ],
        'login.html': [
            'maintenance',
            'appVersion'
        ],
        'signup.html': [
            'maintenance',
            'appVersion'
        ],
        'maintenance.html': [
            'maintenance',
            'appVersion'
        ]
    };

    /**
     * Pages where video playback is active
     * Extra protection is applied on these pages
     */
    var WATCH_PAGES = ['watch.html', 'video.html'];

    /**
     * Pages where live streaming is active
     */
    var LIVE_PAGES = ['live.html', 'channel.html'];

    /* ====================================================================
     * SECTION 2: INTERNAL STATE
     * ==================================================================== */

    /**
     * Internal state object
     * Tracks all module state in one place for easy management
     */
    var state = {
        /** Whether init() has been called successfully */
        isInitialized: false,

        /** Whether the refresh interval is currently active */
        isRunning: false,

        /** Whether refresh is paused (can be resumed) */
        isPaused: false,

        /** Whether the browser reports online status */
        isOnline: navigator.onLine,

        /** The setInterval ID for the main refresh loop */
        intervalId: null,

        /** Current retry attempt count (resets after success) */
        retryCount: 0,

        /** setTimeout ID for retry delay */
        retryTimerId: null,

        /** Currently detected page filename */
        currentPage: '',

        /** Cached version numbers from Firebase refresh/ node */
        cachedVersions: {},

        /** In-memory data cache (key -> data object) */
        memoryCache: {},

        /** Timestamps for when each cache entry was last updated */
        cacheTimestamps: {},

        /** Number of pending refresh operations */
        pendingRefreshes: 0,

        /** Timestamp of last successful refresh cycle */
        lastRefreshTime: 0,

        /** Whether connection is detected as slow */
        isSlowConnection: false,

        /** Whether page was hidden (for resume logic) */
        wasRunningBeforeHidden: false,

        /** Whether a refresh cycle is currently in progress */
        isRefreshing: false,

        /** Count of total refresh cycles completed */
        totalRefreshCycles: 0,

        /** Count of total changes detected and applied */
        totalChangesApplied: 0,

        /** Last error message (for debugging) */
        lastError: null
    };

    /* ====================================================================
     * SECTION 3: UTILITY FUNCTIONS
     * ==================================================================== */

    /**
     * Extract the current page filename from the URL
     * Handles various URL formats including root path
     * 
     * @returns {string} Page filename (e.g., 'index.html') or empty string for root
     */
    function getCurrentPage() {
        var path = window.location.pathname;

        /* Remove trailing slash */
        if (path.charAt(path.length - 1) === '/') {
            path = path.slice(0, -1);
        }

        /* Get the last segment */
        var segments = path.split('/');
        var page = segments[segments.length - 1] || '';

        /* Normalize to lowercase */
        page = page.toLowerCase();

        /* Root path maps to index.html */
        if (page === '' || page === '/') {
            page = 'index.html';
        }

        return page;
    }

    /**
     * Check if the current connection is slow
     * Uses Network Information API if available
     * 
     * @returns {boolean} True if connection is detected as slow
     */
    function detectSlowConnection() {
        var connection = null;

        /* Try to get connection info from various browser implementations */
        if (typeof navigator !== 'undefined') {
            connection = navigator.connection ||
                        navigator.mozConnection ||
                        navigator.webkitConnection ||
                        navigator.msConnection;
        }

        if (connection) {
            var effectiveType = connection.effectiveType || '';
            var downlink = connection.downlink || 10;

            /* Consider 2g and slow-2g as slow connections */
            state.isSlowConnection = (
                effectiveType === '2g' ||
                effectiveType === 'slow-2g' ||
                downlink < 0.5
            );
        } else {
            /* If API not available, assume not slow */
            state.isSlowConnection = false;
        }

        return state.isSlowConnection;
    }

    /**
     * Safely retrieve a deeply nested property from an object
     * Prevents "Cannot read property of undefined" errors
     * 
     * @param {Object} obj - The object to traverse
     * @param {string} path - Dot-notation path (e.g., 'a.b.c')
     * @returns {*} The value at the path, or null if not found
     */
    function getNestedProperty(obj, path) {
        if (!obj || typeof path !== 'string') {
            return null;
        }

        var parts = path.split('.');
        var current = obj;

        for (var i = 0; i < parts.length; i++) {
            if (current === null || current === undefined) {
                return null;
            }
            if (!current.hasOwnProperty(parts[i])) {
                return null;
            }
            current = current[parts[i]];
        }

        return current;
    }

    /**
     * Create a deep clone of an object
     * Handles objects, arrays, and primitive values
     * 
     * @param {*} source - Value to clone
     * @returns {*} Deep clone of the source
     */
    function deepClone(source) {
        /* Handle null, undefined, and primitives */
        if (source === null || typeof source !== 'object') {
            return source;
        }

        /* Handle Date objects */
        if (source instanceof Date) {
            return new Date(source.getTime());
        }

        /* Handle Array objects */
        if (Array.isArray(source)) {
            var arrClone = [];
            for (var i = 0; i < source.length; i++) {
                arrClone[i] = deepClone(source[i]);
            }
            return arrClone;
        }

        /* Handle plain objects */
        var objClone = {};
        for (var key in source) {
            if (source.hasOwnProperty(key)) {
                objClone[key] = deepClone(source[key]);
            }
        }
        return objClone;
    }

    /**
     * Format a large number into a human-readable string
     * Examples: 1500 -> "1.5K", 2500000 -> "2.5M"
     * 
     * @param {number} count - The number to format
     * @returns {string} Formatted string
     */
    function formatCount(count) {
        if (typeof count !== 'number' || isNaN(count)) {
            return '0';
        }

        if (count >= 1000000000) {
            return (count / 1000000000).toFixed(1) + 'B';
        }
        if (count >= 1000000) {
            return (count / 1000000).toFixed(1) + 'M';
        }
        if (count >= 1000) {
            return (count / 1000).toFixed(1) + 'K';
        }
        return count.toString();
    }

    /**
     * Dispatch a custom DOM event with optional detail data
     * Compatible with older browsers via fallback
     * 
     * @param {string} eventName - Name of the custom event
     * @param {Object} [detail] - Data to attach to the event
     */
    function dispatchCustomEvent(eventName, detail) {
        var eventData = detail || {};

        try {
            /* Modern browsers */
            var event = new CustomEvent(eventName, {
                detail: eventData,
                bubbles: true,
                cancelable: true
            });
            document.dispatchEvent(event);
        } catch (e) {
            /* Fallback for older browsers */
            if (typeof document.createEvent === 'function') {
                var fallbackEvent = document.createEvent('CustomEvent');
                fallbackEvent.initCustomEvent(eventName, true, true, eventData);
                document.dispatchEvent(fallbackEvent);
            }
        }
    }

    /**
     * Internal logging with consistent prefix
     * Only logs in development or when explicitly enabled
     * 
     * @param {string} message - Log message
     * @param {string} [level] - Log level: 'log', 'warn', 'error'
     */
    function log(message, level) {
        var prefix = '[AutoRefresh]';
        var logLevel = level || 'log';

        if (logLevel === 'error') {
            console.error(prefix, message);
        } else if (logLevel === 'warn') {
            console.warn(prefix, message);
        } else {
            console.log(prefix, message);
        }
    }

    /**
     * Generate a unique ID for cache entries
     * Simple timestamp-based ID generation
     * 
     * @returns {string} Unique identifier string
     */
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    /**
     * Check if a value is a plain object (not array, not null)
     * 
     * @param {*} value - Value to check
     * @returns {boolean} True if plain object
     */
    function isPlainObject(value) {
        return value !== null &&
               typeof value === 'object' &&
               !Array.isArray(value) &&
               (value.constructor === Object || value.constructor === undefined);
    }

    /**
     * Debounce a function call
     * Ensures rapid successive calls only execute once after delay
     * 
     * @param {Function} fn - Function to debounce
     * @param {number} delay - Delay in milliseconds
     * @returns {Function} Debounced function
     */
    function debounce(fn, delay) {
        var timerId = null;
        return function () {
            var context = this;
            var args = arguments;
            if (timerId) {
                clearTimeout(timerId);
            }
            timerId = setTimeout(function () {
                fn.apply(context, args);
                timerId = null;
            }, delay);
        };
    }

    /* ====================================================================
     * SECTION 4: CACHE MANAGEMENT
     * ==================================================================== */

    /**
     * Load cached version data from localStorage
     * Called during initialization to restore state
     */
    function loadVersionCache() {
        try {
            var stored = localStorage.getItem(VERSION_CACHE_KEY);
            if (stored) {
                var parsed = JSON.parse(stored);
                if (isPlainObject(parsed)) {
                    state.cachedVersions = parsed;
                    log('Loaded ' + Object.keys(parsed).length + ' cached versions');
                }
            }
        } catch (e) {
            log('Failed to load version cache: ' + e.message, 'warn');
            state.cachedVersions = {};
        }
    }

    /**
     * Persist current version cache to localStorage
     * Called after each successful version update
     */
    function saveVersionCache() {
        try {
            localStorage.setItem(VERSION_CACHE_KEY, JSON.stringify(state.cachedVersions));
        } catch (e) {
            /* localStorage might be full or disabled */
            log('Failed to save version cache: ' + e.message, 'warn');
        }
    }

    /**
     * Retrieve data from the in-memory cache
     * 
     * @param {string} key - Cache key
     * @returns {*} Cached data or null if not found/expired
     */
    function getMemoryCache(key) {
        var timestamp = state.cacheTimestamps[key];

        /* Check if cache entry exists and is not expired */
        if (state.memoryCache.hasOwnProperty(key) && timestamp) {
            var age = Date.now() - timestamp;
            if (age < CACHE_MAX_AGE_MS) {
                return deepClone(state.memoryCache[key]);
            }
            /* Cache expired, remove it */
            delete state.memoryCache[key];
            delete state.cacheTimestamps[key];
        }

        return null;
    }

    /**
     * Store data in the in-memory cache
     * 
     * @param {string} key - Cache key
     * @param {*} data - Data to cache
     */
    function setMemoryCache(key, data) {
        state.memoryCache[key] = deepClone(data);
        state.cacheTimestamps[key] = Date.now();
    }

    /**
     * Check if a cache key exists and is valid
     * 
     * @param {string} key - Cache key to check
     * @returns {boolean} True if valid cache entry exists
     */
    function hasValidCache(key) {
        var timestamp = state.cacheTimestamps[key];
        if (!timestamp) {
            return false;
        }
        var age = Date.now() - timestamp;
        return age < CACHE_MAX_AGE_MS;
    }

    /**
     * Clear all caches (memory and localStorage)
     * Used by the public clearCache() API
     */
    function clearAllCaches() {
        /* Clear memory cache */
        state.memoryCache = {};
        state.cacheTimestamps = {};
        state.cachedVersions = {};

        /* Clear localStorage entries with our prefix */
        try {
            var keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.indexOf(CACHE_KEY_PREFIX) === 0) {
                    keysToRemove.push(key);
                }
            }
            for (var j = 0; j < keysToRemove.length; j++) {
                localStorage.removeItem(keysToRemove[j]);
            }
        } catch (e) {
            log('Failed to clear localStorage: ' + e.message, 'warn');
        }

        log('All caches cleared');
    }

    /* ====================================================================
     * SECTION 5: FIREBASE OPERATIONS
     * ==================================================================== */

    /**
     * Safely read data from Firebase Database
     * Handles errors gracefully without crashing
     * 
     * @param {string} path - Database path to read
     * @returns {Promise} Resolves with data or null
     */
    function firebaseRead(path) {
        return new Promise(function (resolve, reject) {
            /* Validate that database is available */
            if (typeof database === 'undefined' || database === null) {
                reject(new Error('Firebase database not available'));
                return;
            }

            try {
                var ref = database.ref(path);

                ref.once('value')
                    .then(function (snapshot) {
                        var data = snapshot.val();
                        resolve(data);
                    })
                    .catch(function (error) {
                        reject(error);
                    });
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * Read the refresh/ node containing all version info
     * 
     * @returns {Promise} Resolves with refresh node data
     */
    function readRefreshNode() {
        return firebaseRead('refresh');
    }

    /**
     * Read a specific data node by name
     * 
     * @param {string} nodeName - Name of the data node (e.g., 'movies')
     * @returns {Promise} Resolves with node data
     */
    function readDataNode(nodeName) {
        return firebaseRead(nodeName);
    }

    /* ====================================================================
     * SECTION 6: VERSION COMPARISON & CHANGE DETECTION
     * ==================================================================== */

    /**
     * Check if a refresh node is relevant for the current page
     * Prevents unnecessary Firebase reads for unrelated data
     * 
     * @param {string} nodeName - Name of the refresh node
     * @returns {boolean} True if node is relevant for current page
     */
    function isNodeRelevantForCurrentPage(nodeName) {
        var pageNodes = PAGE_NODE_MAP[state.currentPage];
        if (!pageNodes || !Array.isArray(pageNodes)) {
            return false;
        }
        return pageNodes.indexOf(nodeName) !== -1;
    }

    /**
     * Compare Firebase versions with cached versions
     * Returns only the nodes that have changed
     * 
     * @param {Object} versionsData - Data from refresh/ node
     * @returns {Array} Array of change objects with node info
     */
    function detectChanges(versionsData) {
        var changes = [];

        /* Validate input */
        if (!isPlainObject(versionsData)) {
            return changes;
        }

        /* Iterate through all nodes in the refresh data */
        for (var nodeName in versionsData) {
            if (!versionsData.hasOwnProperty(nodeName)) {
                continue;
            }

            var nodeData = versionsData[nodeName];

            /* Skip if node data is null or invalid */
            if (!nodeData || typeof nodeData !== 'object') {
                continue;
            }

            /* Check if this node is relevant for the current page */
            if (!isNodeRelevantForCurrentPage(nodeName)) {
                continue;
            }

            /* Check if node is enabled */
            var isEnabled = nodeData.enabled !== false;
            if (!isEnabled) {
                continue;
            }

            /* Get version values */
            var newVersion = nodeData.version;
            var cachedVersion = state.cachedVersions[nodeName];

            /* Determine if this is a change */
            var hasChanged = false;

            if (cachedVersion === undefined || cachedVersion === null) {
                /* No cached version - this is new data */
                hasChanged = true;
            } else if (cachedVersion !== newVersion) {
                /* Version number changed */
                hasChanged = true;
            }

            if (hasChanged) {
                changes.push({
                    node: nodeName,
                    oldVersion: cachedVersion,
                    newVersion: newVersion,
                    priority: typeof nodeData.priority === 'number' ? nodeData.priority : 0,
                    lastUpdated: nodeData.lastUpdated || null,
                    enabled: isEnabled
                });
            }
        }

        /* Sort changes by priority (highest first) */
        changes.sort(function (a, b) {
            return b.priority - a.priority;
        });

        return changes;
    }

    /* ====================================================================
     * SECTION 7: DOM QUERY HELPERS
     * ==================================================================== */

    /**
     * Query a single element using multiple selector attempts
     * Returns the first match found
     * 
     * @param {string} selectorString - Comma-separated selectors
     * @param {Element} [context] - Parent element to search within
     * @returns {Element|null} Found element or null
     */
    function queryFirst(selectorString, context) {
        var parent = context || document;
        try {
            return parent.querySelector(selectorString);
        } catch (e) {
            return null;
        }
    }

    /**
     * Query all elements using a selector string
     * 
     * @param {string} selectorString - CSS selector
     * @param {Element} [context] - Parent element to search within
     * @returns {Array} Array of found elements (never null)
     */
    function queryAll(selectorString, context) {
        var parent = context || document;
        try {
            var nodeList = parent.querySelectorAll(selectorString);
            return Array.prototype.slice.call(nodeList);
        } catch (e) {
            return [];
        }
    }

    /**
     * Safely update text content of an element
     * Only updates if the new text differs from current
     * 
     * @param {Element} element - DOM element to update
     * @param {string} text - New text content
     */
    function safeSetText(element, text) {
        if (!element) return;
        if (typeof text !== 'string') text = String(text || '');
        if (element.textContent !== text) {
            element.textContent = text;
        }
    }

    /**
     * Safely update an element's src attribute
     * Only updates if the new src differs from current
     * 
     * @param {Element} element - DOM element (typically img)
     * @param {string} src - New src value
     */
    function safeSetSrc(element, src) {
        if (!element) return;
        if (typeof src !== 'string') return;
        if (element.src !== src) {
            element.src = src;
        }
    }

    /**
     * Safely update an element's style display property
     * 
     * @param {Element} element - DOM element
     * @param {string} value - Display value ('block', 'none', 'flex', etc.)
     */
    function safeSetDisplay(element, value) {
        if (!element) return;
        if (element.style.display !== value) {
            element.style.display = value;
        }
    }

    /**
     * Safely toggle a CSS class on an element
     * 
     * @param {Element} element - DOM element
     * @param {string} className - Class to toggle
     * @param {boolean} force - Force add (true) or remove (false)
     */
    function safeToggleClass(element, className, force) {
        if (!element) return;
        if (element.classList) {
            element.classList.toggle(className, force);
        } else {
            /* Fallback for very old browsers */
            var hasClass = element.className.indexOf(className) !== -1;
            if ((force && !hasClass) || (!force && hasClass)) {
                if (force) {
                    element.className += ' ' + className;
                } else {
                    element.className = element.className.replace(
                        new RegExp('(?:^|\\s)' + className + '(?:\\s|$)', 'g'),
                        ' '
                    );
                }
            }
        }
    }

    /**
     * Safely update a style property
     * 
     * @param {Element} element - DOM element
     * @param {string} property - CSS property name
     * @param {string} value - CSS value
     */
    function safeSetStyle(element, property, value) {
        if (!element) return;
        element.style[property] = value;
    }

    /* ====================================================================
     * SECTION 8: HOMEPAGE DOM UPDATERS
     * ==================================================================== */

    /**
     * Update the featured/hero banner on the homepage
     * Only patches changed text and images, never rebuilds
     * 
     * @param {Object} featured - Featured banner data
     */
    function updateFeaturedBanner(featured) {
        if (!isPlainObject(featured)) return;

        var banner = queryFirst(SELECTORS.featuredBanner);
        if (!banner) return;

        /* Update title */
        if (featured.title) {
            var titleEl = queryFirst(SELECTORS.bannerTitle, banner);
            safeSetText(titleEl, featured.title);
        }

        /* Update description */
        if (featured.description) {
            var descEl = queryFirst(SELECTORS.bannerDescription, banner);
            safeSetText(descEl, featured.description);
        }

        /* Update image */
        if (featured.image) {
            var imgEl = queryFirst(SELECTORS.bannerImage, banner);
            safeSetSrc(imgEl, featured.image);
        }

        /* Update rating */
        if (featured.rating !== undefined) {
            var ratingEl = queryFirst(SELECTORS.bannerRating, banner);
            safeSetText(ratingEl, String(featured.rating));
        }

        /* Update year */
        if (featured.year) {
            var yearEl = queryFirst('.banner-year, .hero-year', banner);
            safeSetText(yearEl, String(featured.year));
        }

        /* Update genre tags */
        if (featured.genres && Array.isArray(featured.genres)) {
            var genreContainer = queryFirst('.banner-genres, .hero-genres', banner);
            if (genreContainer) {
                var currentGenres = queryAll('.genre-tag', genreContainer);
                for (var i = 0; i < Math.min(featured.genres.length, currentGenres.length); i++) {
                    safeSetText(currentGenres[i], featured.genres[i]);
                }
            }
        }

        /* Update play button link if changed */
        if (featured.playUrl) {
            var playBtn = queryFirst('.banner-play-btn, .hero-play-btn', banner);
            if (playBtn && playBtn.getAttribute('href') !== featured.playUrl) {
                playBtn.setAttribute('href', featured.playUrl);
            }
        }
    }

    /**
     * Update a horizontal movie/series row
     * Efficiently patches existing cards and adds new ones
     * Never rebuilds the entire row
     * 
     * @param {string} rowId - ID or class of the row container
     * @param {Array} items - Array of movie/series data objects
     */
    function updateContentRow(rowSelector, items) {
        if (!Array.isArray(items)) return;

        var row = queryFirst(rowSelector);
        if (!row) return;

        var container = queryFirst('.movie-container, .card-container, .content-scroll', row);
        if (!container) {
            container = row;
        }

        var existingCards = queryAll(SELECTORS.movieCard, container);

        /* Update existing cards in place */
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var card = existingCards[i];

            if (card && card.dataset.id === String(item.id)) {
                /* Patch existing card */
                patchContentCard(card, item);
            } else if (card && card.dataset.id !== String(item.id)) {
                /* Card exists but for different item - patch it anyway */
                patchContentCard(card, item);
                card.dataset.id = String(item.id);
            } else if (!card) {
                /* Need to create a new card */
                var newCard = createContentCard(item);
                if (newCard) {
                    container.appendChild(newCard);
                }
            }
        }

        /* Remove extra cards if list shrunk */
        var allCards = queryAll(SELECTORS.movieCard, container);
        for (var j = items.length; j < allCards.length; j++) {
            if (allCards[j].parentNode) {
                allCards[j].parentNode.removeChild(allCards[j]);
            }
        }
    }

    /**
     * Patch a single content card with new data
     * Only updates elements that have changed
     * 
     * @param {Element} card - The card element
     * @param {Object} data - New data for the card
     */
    function patchContentCard(card, data) {
        if (!card || !isPlainObject(data)) return;

        /* Update poster/thumbnail image */
        if (data.poster || data.thumbnail || data.image) {
            var img = queryFirst(SELECTORS.cardImage, card);
            var newSrc = data.poster || data.thumbnail || data.image;
            safeSetSrc(img, newSrc);
        }

        /* Update title */
        if (data.title) {
            var title = queryFirst(SELECTORS.cardTitle, card);
            safeSetText(title, data.title);
        }

        /* Update rating */
        if (data.rating !== undefined) {
            var rating = queryFirst(SELECTORS.cardRating, card);
            safeSetText(rating, String(data.rating));
        }

        /* Update new badge visibility */
        if (data.isNew !== undefined) {
            var badge = queryFirst(SELECTORS.cardBadge, card);
            if (badge) {
                safeSetDisplay(badge, data.isNew ? 'block' : 'none');
            }
        }

        /* Update progress bar (for continue watching) */
        if (data.progress !== undefined && typeof data.progress === 'number') {
            var progress = queryFirst(SELECTORS.progressBar, card);
            if (progress) {
                safeSetStyle(progress, 'width', data.progress + '%');
            }
        }

        /* Update time remaining */
        if (data.timeLeft) {
            var timeLeft = queryFirst(SELECTORS.timeLeft, card);
            safeSetText(timeLeft, data.timeLeft);
        }

        /* Update quality badge */
        if (data.quality) {
            var qualityBadge = queryFirst('.card-quality, .quality-badge', card);
            if (qualityBadge) {
                safeSetText(qualityBadge, data.quality);
                safeSetDisplay(qualityBadge, 'flex');
            }
        }

        /* Update subtitle badge */
        if (data.hasSubtitles !== undefined) {
            var subBadge = queryFirst('.subtitle-badge, .cc-badge', card);
            if (subBadge) {
                safeSetDisplay(subBadge, data.hasSubtitles ? 'flex' : 'none');
            }
        }
    }

    /**
     * Create a new content card DOM element
     * Uses DocumentFragment for efficient insertion
     * 
     * @param {Object} data - Card data
     * @returns {Element|null} Created card element
     */
    function createContentCard(data) {
        if (!isPlainObject(data)) return null;

        var fragment = document.createDocumentFragment();
        var card = document.createElement('div');
        card.className = 'movie-card content-card';
        card.dataset.id = String(data.id || generateId());

        /* Create image */
        var img = document.createElement('img');
        img.className = 'card-image poster-img';
        img.src = data.poster || data.thumbnail || data.image || '';
        img.alt = data.title || '';
        img.loading = 'lazy';
        card.appendChild(img);

        /* Create title overlay */
        var title = document.createElement('span');
        title.className = 'card-title movie-title';
        title.textContent = data.title || '';
        card.appendChild(title);

        /* Create rating if available */
        if (data.rating !== undefined) {
            var rating = document.createElement('span');
            rating.className = 'card-rating movie-rating';
            rating.textContent = String(data.rating);
            card.appendChild(rating);
        }

        /* Create progress bar for continue watching */
        if (data.progress !== undefined) {
            var progressContainer = document.createElement('div');
            progressContainer.className = 'progress-container';

            var progressBar = document.createElement('div');
            progressBar.className = 'progress-bar watch-progress';
            progressBar.style.width = (data.progress || 0) + '%';
            progressContainer.appendChild(progressBar);

            card.appendChild(progressContainer);
        }

        fragment.appendChild(card);
        return fragment;
    }

    /**
     * Update the Continue Watching section
     * Only updates progress bars and time remaining
     * Never resets or interrupts anything
     * 
     * @param {Array} items - Continue watching items
     */
    function updateContinueWatchingSection(items) {
        if (!Array.isArray(items)) return;

        var container = queryFirst(SELECTORS.continueWatching);
        if (!container) return;

        var cards = queryAll(SELECTORS.movieCard, container);

        for (var i = 0; i < Math.min(items.length, cards.length); i++) {
            var item = items[i];

            /* Only update progress - never touch playback state */
            if (item.progress !== undefined) {
                var progress = queryFirst(SELECTORS.progressBar, cards[i]);
                if (progress) {
                    safeSetStyle(progress, 'width', item.progress + '%');
                }
            }

            /* Update time remaining text */
            if (item.timeLeft) {
                var timeLeft = queryFirst(SELECTORS.timeLeft, cards[i]);
                safeSetText(timeLeft, item.timeLeft);
            }

            /* Update thumbnail if changed (for dynamic thumbnails) */
            if (item.thumbnail) {
                var img = queryFirst(SELECTORS.cardImage, cards[i]);
                safeSetSrc(img, item.thumbnail);
            }
        }
    }

    /**
     * Update notifications display
     * Updates badge count and individual notification items
     * 
     * @param {Object} notifications - Notifications data object
     */
    function updateNotificationsDisplay(notifications) {
        if (!isPlainObject(notifications)) return;

        /* Update badge count */
        if (notifications.unreadCount !== undefined) {
            var badges = queryAll(SELECTORS.notificationBadge);
            for (var b = 0; b < badges.length; b++) {
                safeSetText(badges[b], String(notifications.unreadCount));
                safeSetDisplay(badges[b], notifications.unreadCount > 0 ? 'flex' : 'none');
            }
        }

        /* Update notification items in dropdown/list */
        var containers = queryAll(SELECTORS.notificationsContainer);
        for (var c = 0; c < containers.length; c++) {
            var container = containers[c];
            var items = queryAll(SELECTORS.notificationItem, container);
            var notifItems = notifications.items || [];

            for (var i = 0; i < Math.min(notifItems.length, items.length); i++) {
                var notif = notifItems[i];
                var item = items[i];

                /* Toggle read/unread state */
                if (notif.read !== undefined) {
                    safeToggleClass(item, 'unread', !notif.read);
                }

                /* Update text */
                if (notif.text) {
                    var textEl = queryFirst(SELECTORS.notificationText, item);
                    safeSetText(textEl, notif.text);
                }

                /* Update timestamp */
                if (notif.time) {
                    var timeEl = queryFirst(SELECTORS.notificationTime, item);
                    safeSetText(timeEl, notif.time);
                }

                /* Update avatar */
                if (notif.avatar) {
                    var avatarEl = queryFirst('.notification-avatar img', item);
                    safeSetSrc(avatarEl, notif.avatar);
                }
            }
        }
    }

    /**
     * Update announcements bar
     * 
     * @param {Object} announcements - Announcements data
     */
    function updateAnnouncementsDisplay(announcements) {
        if (!isPlainObject(announcements)) return;

        var bar = queryFirst(SELECTORS.announcementsBar);
        if (!bar) return;

        /* Update text */
        if (announcements.text) {
            var textEl = queryFirst(SELECTORS.announcementText, bar);
            safeSetText(textEl, announcements.text);
        }

        /* Update visibility */
        if (announcements.visible !== undefined) {
            safeSetDisplay(bar, announcements.visible ? 'block' : 'none');
        }

        /* Update link */
        if (announcements.link) {
            var linkEl = queryFirst('.announcement-link', bar);
            if (linkEl) {
                linkEl.setAttribute('href', announcements.link);
            }
        }
    }

    /* ====================================================================
     * SECTION 9: WATCH PAGE DOM UPDATERS
     * ==================================================================== */

    /**
     * Update watch page metadata without touching playback
     * THIS FUNCTION MUST NEVER INTERRUPT VIDEO PLAYBACK
     * 
     * Protected elements (NEVER touched):
     * - video.currentTime
     * - video.volume
     * - video.playbackRate
     * - video.src (unless explicitly needed)
     * - Quality settings
     * - Subtitle settings
     * - Fullscreen state
     * - Picture-in-Picture state
     * 
     * @param {Object} data - Watch page data
     */
    function updateWatchPageMetadata(data) {
        if (!isPlainObject(data)) return;

        /*
         * CRITICAL: Never access video element properties that control playback
         * We only read playback state, never write to it
         */

        /* Update view count */
        if (data.views !== undefined) {
            var viewsEls = queryAll(SELECTORS.viewCount);
            for (var v = 0; v < viewsEls.length; v++) {
                safeSetText(viewsEls[v], formatCount(data.views) + ' views');
            }
        }

        /* Update like count */
        if (data.likes !== undefined) {
            var likeEls = queryAll(SELECTORS.likeCount);
            for (var l = 0; l < likeEls.length; l++) {
                safeSetText(likeEls[l], formatCount(data.likes));
            }
        }

        /* Update dislike count */
        if (data.dislikes !== undefined) {
            var dislikeEls = queryAll(SELECTORS.dislikeCount);
            for (var d = 0; d < dislikeEls.length; d++) {
                safeSetText(dislikeEls[d], formatCount(data.dislikes));
            }
        }

        /* Update description */
        if (data.description) {
            var descEls = queryAll(SELECTORS.videoDescription);
            for (var de = 0; de < descEls.length; de++) {
                safeSetText(descEls[de], data.description);
            }
        }

        /* Update cast list */
        if (Array.isArray(data.cast)) {
            updateCastListDisplay(data.cast);
        }

        /* Update recommendations sidebar */
        if (Array.isArray(data.recommendations)) {
            updateRecommendationsSidebar(data.recommendations);
        }

        /* Update related movies/videos */
        if (Array.isArray(data.related)) {
            var relatedContainer = queryFirst(SELECTORS.recommendationsList);
            if (relatedContainer) {
                var relatedCards = queryAll(SELECTORS.recommendationItem, relatedContainer);
                for (var r = 0; r < Math.min(data.related.length, relatedCards.length); r++) {
                    patchContentCard(relatedCards[r], data.related[r]);
                }
            }
        }

        /* Update comments */
        if (isPlainObject(data.comments)) {
            updateCommentsDisplay(data.comments);
        }

        /* Update live viewer count (for live streams) */
        if (data.liveViewerCount !== undefined) {
            var liveViewerEls = queryAll(SELECTORS.liveViewerCount);
            for (var lv = 0; lv < liveViewerEls.length; lv++) {
                safeSetText(liveViewerEls[lv], formatCount(data.liveViewerCount) + ' watching');
            }
        }

        /* Update title (non-destructive) */
        if (data.title) {
            var titleEls = queryAll('.video-title, .watch-title, .player-title');
            for (var t = 0; t < titleEls.length; t++) {
                safeSetText(titleEls[t], data.title);
            }
        }

        /* Update genre tags */
        if (Array.isArray(data.genres)) {
            var genreEls = queryAll('.video-genre, .watch-genre');
            for (var g = 0; g < Math.min(data.genres.length, genreEls.length); g++) {
                safeSetText(genreEls[g], data.genres[g]);
            }
        }

        /*
         * NEVER DO ANY OF THESE:
         * var video = document.querySelector('video');
         * video.currentTime = anything;
         * video.volume = anything;
         * video.playbackRate = anything;
         * video.pause();
         * video.play();
         * video.src = anything;
         * video.load();
         * document.exitFullscreen();
         * document.pictureInPictureElement.exitPictureInPicture();
         */
    }

    /**
     * Update the cast list on watch page
     * 
     * @param {Array} castList - Array of cast member objects
     */
    function updateCastListDisplay(castList) {
        if (!Array.isArray(castList)) return;

        var containers = queryAll(SELECTORS.castList);
        for (var c = 0; c < containers.length; c++) {
            var container = containers[c];
            var items = queryAll(SELECTORS.castItem, container);

            for (var i = 0; i < Math.min(castList.length, items.length); i++) {
                var person = castList[i];
                var item = items[i];

                /* Update photo */
                if (person.photo || person.image) {
                    var photo = queryFirst(SELECTORS.castPhoto, item);
                    safeSetSrc(photo, person.photo || person.image);
                }

                /* Update name */
                if (person.name) {
                    var name = queryFirst(SELECTORS.castName, item);
                    safeSetText(name, person.name);
                }

                /* Update role/character */
                if (person.role || person.character) {
                    var role = queryFirst(SELECTORS.castRole, item);
                    safeSetText(role, person.role || person.character);
                }
            }
        }
    }

    /**
     * Update the recommendations sidebar on watch page
     * 
     * @param {Array} recommendations - Array of recommendation objects
     */
    function updateRecommendationsSidebar(recommendations) {
        if (!Array.isArray(recommendations)) return;

        var containers = queryAll(SELECTORS.recommendationsList);
        for (var c = 0; c < containers.length; c++) {
            var container = containers[c];
            var items = queryAll(SELECTORS.recommendationItem, container);

            for (var i = 0; i < Math.min(recommendations.length, items.length); i++) {
                var rec = recommendations[i];
                var item = items[i];

                /* Update thumbnail */
                if (rec.thumbnail || rec.poster) {
                    var img = queryFirst('img', item);
                    safeSetSrc(img, rec.thumbnail || rec.poster);
                }

                /* Update title */
                if (rec.title) {
                    var title = queryFirst('.rec-title, .card-title', item);
                    safeSetText(title, rec.title);
                }

                /* Update metadata (duration, views, etc.) */
                if (rec.meta || rec.duration) {
                    var meta = queryFirst('.rec-meta, .card-meta, .video-duration', item);
                    safeSetText(meta, rec.meta || rec.duration);
                }

                /* Update channel/show name */
                if (rec.channel || rec.show) {
                    var channel = queryFirst('.rec-channel, .card-channel', item);
                    safeSetText(channel, rec.channel || rec.show);
                }
            }
        }
    }

    /**
     * Update the comments section on watch page
     * Adds new comments, updates existing ones
     * 
     * @param {Object} commentsData - Comments data with items array
     */
    function updateCommentsDisplay(commentsData) {
        if (!isPlainObject(commentsData)) return;

        /* Update total comment count */
        if (commentsData.totalCount !== undefined) {
            var countEls = queryAll(SELECTORS.commentCount);
            for (var c = 0; c < countEls.length; c++) {
                safeSetText(countEls[c], formatCount(commentsData.totalCount) + ' Comments');
            }
        }

        var containers = queryAll(SELECTORS.commentSection);
        for (var ci = 0; ci < containers.length; ci++) {
            var container = containers[ci];
            var items = queryAll(SELECTORS.commentItem, container);
            var commentItems = commentsData.items || [];

            for (var i = 0; i < Math.min(commentItems.length, items.length); i++) {
                var comment = commentItems[i];
                var item = items[i];

                /* Update avatar */
                if (comment.avatar) {
                    var avatar = queryFirst(SELECTORS.commentAvatar, item);
                    safeSetSrc(avatar, comment.avatar);
                }

                /* Update username */
                if (comment.username) {
                    var username = queryFirst(SELECTORS.commentUsername, item);
                    safeSetText(username, comment.username);
                }

                /* Update comment text */
                if (comment.text) {
                    var text = queryFirst(SELECTORS.commentText, item);
                    safeSetText(text, comment.text);
                }

                /* Update timestamp */
                if (comment.time) {
                    var time = queryFirst(SELECTORS.commentTime, item);
                    safeSetText(time, comment.time);
                }

                /* Update like count */
                if (comment.likes !== undefined) {
                    var likes = queryFirst(SELECTORS.commentLikes, item);
                    safeSetText(likes, formatCount(comment.likes));
                }
            }
        }
    }

    /* ====================================================================
     * SECTION 10: LIVE TV DOM UPDATERS
     * ==================================================================== */

    /**
     * Update live TV page data without restarting the stream
     * THIS FUNCTION MUST NEVER INTERRUPT THE LIVE STREAM
     * 
     * @param {Object} data - Live TV data
     */
    function updateLivePageData(data) {
        if (!isPlainObject(data)) return;

        /* Update current program info */
        if (isPlainObject(data.currentProgram)) {
            var cp = data.currentProgram;

            if (cp.title) {
                var cpTitle = queryFirst(SELECTORS.currentProgramTitle);
                safeSetText(cpTitle, cp.title);
            }

            if (cp.description) {
                var cpDesc = queryFirst(SELECTORS.currentProgramDesc);
                safeSetText(cpDesc, cp.description);
            }

            if (cp.time) {
                var cpTime = queryFirst(SELECTORS.currentProgramTime);
                safeSetText(cpTime, cp.time);
            }
        }

        /* Update next program info */
        if (isPlainObject(data.nextProgram)) {
            var np = data.nextProgram;

            if (np.title) {
                var npTitle = queryFirst(SELECTORS.nextProgramTitle);
                safeSetText(npTitle, np.title);
            }

            if (np.time) {
                var npTime = queryFirst(SELECTORS.nextProgramTime);
                safeSetText(npTime, np.time);
            }
        }

        /* Update viewer count */
        if (data.viewerCount !== undefined) {
            var viewerEls = queryAll(SELECTORS.liveViewerCount);
            for (var v = 0; v < viewerEls.length; v++) {
                safeSetText(viewerEls[v], formatCount(data.viewerCount) + ' watching now');
            }
        }

        /* Update live status indicator */
        if (data.isLive !== undefined) {
            var statusEls = queryAll(SELECTORS.liveIndicator);
            for (var s = 0; s < statusEls.length; s++) {
                safeToggleClass(statusEls[s], 'active', data.isLive);
                safeToggleClass(statusEls[s], 'offline', !data.isLive);
                safeSetText(statusEls[s], data.isLive ? 'LIVE' : 'OFFLINE');
            }
        }

        /* Update program schedule */
        if (Array.isArray(data.schedule)) {
            updateScheduleDisplay(data.schedule);
        }

        /* Update channel logo (without restarting stream) */
        if (data.channelLogo) {
            var logoEls = queryAll(SELECTORS.channelLogo);
            for (var lo = 0; lo < logoEls.length; lo++) {
                safeSetSrc(logoEls[lo], data.channelLogo);
            }
        }

        /* Update channel name */
        if (data.channelName) {
            var nameEls = queryAll('.channel-name-main, .live-channel-name');
            for (var n = 0; n < nameEls.length; n++) {
                safeSetText(nameEls[n], data.channelName);
            }
        }

        /*
         * NEVER DO ANY OF THESE ON LIVE PAGE:
         * var video = document.querySelector('video');
         * video.src = anything (would restart stream)
         * video.load()
         * video.pause()
         * Any HLS/DASH player destruction or reinitialization
         */
    }

    /**
     * Update the program schedule list
     * 
     * @param {Array} schedule - Array of schedule items
     */
    function updateScheduleDisplay(schedule) {
        if (!Array.isArray(schedule)) return;

        var containers = queryAll(SELECTORS.scheduleList);
        for (var c = 0; c < containers.length; c++) {
            var container = containers[c];
            var items = queryAll(SELECTORS.scheduleItem, container);

            for (var i = 0; i < Math.min(schedule.length, items.length); i++) {
                var program = schedule[i];
                var item = items[i];

                /* Update time */
                if (program.time) {
                    var time = queryFirst(SELECTORS.scheduleTime, item);
                    safeSetText(time, program.time);
                }

                /* Update title */
                if (program.title) {
                    var title = queryFirst(SELECTORS.scheduleTitle, item);
                    safeSetText(title, program.title);
                }

                /* Highlight current program */
                if (program.isCurrent !== undefined) {
                    safeToggleClass(item, 'active', program.isCurrent);
                    safeToggleClass(item, 'current-program', program.isCurrent);
                }

                /* Mark past programs */
                if (program.isPast !== undefined) {
                    safeToggleClass(item, 'past', program.isPast);
                }
            }
        }
    }

    /* ====================================================================
     * SECTION 11: CHANNEL PAGE DOM UPDATERS
     * ==================================================================== */

    /**
     * Update channels grid data
     * 
     * @param {Object} data - Channels data
     */
    function updateChannelsGrid(data) {
        if (!isPlainObject(data)) return;

        var grid = queryFirst(SELECTORS.channelGrid);
        if (!grid) return;

        var cards = queryAll(SELECTORS.channelCard, grid);
        var channelList = data.list || data.channels || [];

        for (var i = 0; i < Math.min(channelList.length, cards.length); i++) {
            var channel = channelList[i];
            var card = cards[i];

            /* Update channel logo */
            if (channel.logo) {
                var logo = queryFirst('.channel-logo img', card);
                safeSetSrc(logo, channel.logo);
            }

            /* Update channel name */
            if (channel.name) {
                var name = queryFirst(SELECTORS.channelName, card);
                safeSetText(name, channel.name);
            }

            /* Update live status */
            if (channel.isLive !== undefined) {
                var status = queryFirst(SELECTORS.channelStatus, card);
                safeSetText(status, channel.isLive ? 'LIVE' : 'OFFLINE');
                safeToggleClass(card, 'live', channel.isLive);
                safeToggleClass(card, 'offline', !channel.isLive);
            }

            /* Update current program name */
            if (channel.currentProgram) {
                var program = queryFirst('.channel-program, .now-playing-name', card);
                safeSetText(program, channel.currentProgram);
            }

            /* Update viewer count */
            if (channel.viewerCount !== undefined) {
                var viewers = queryFirst('.channel-viewers', card);
                safeSetText(viewers, formatCount(channel.viewerCount) + ' watching');
            }
        }
    }

    /* ====================================================================
     * SECTION 12: PROFILE PAGE DOM UPDATERS
     * ==================================================================== */

    /**
     * Update profile page data
     * 
     * @param {Object} data - Profile data
     */
    function updateProfilePageData(data) {
        if (!isPlainObject(data)) return;

        /* Update avatar */
        if (data.avatar) {
            var avatarEls = queryAll(SELECTORS.profileAvatar);
            for (var a = 0; a < avatarEls.length; a++) {
                safeSetSrc(avatarEls[a], data.avatar);
            }
        }

        /* Update username */
        if (data.username || data.displayName) {
            var usernameEls = queryAll(SELECTORS.profileUsername);
            for (var u = 0; u < usernameEls.length; u++) {
                safeSetText(usernameEls[u], data.username || data.displayName);
            }
        }

        /* Update email */
        if (data.email) {
            var emailEls = queryAll(SELECTORS.profileEmail);
            for (var e = 0; e < emailEls.length; e++) {
                safeSetText(emailEls[e], data.email);
            }
        }

        /* Update stats */
        if (isPlainObject(data.stats)) {
            if (data.stats.watched !== undefined) {
                var watchedEls = queryAll(SELECTORS.statWatched);
                for (var w = 0; w < watchedEls.length; w++) {
                    safeSetText(watchedEls[w], String(data.stats.watched));
                }
            }

            if (data.stats.watchlist !== undefined) {
                var watchlistEls = queryAll(SELECTORS.statWatchlist);
                for (var wl = 0; wl < watchlistEls.length; wl++) {
                    safeSetText(watchlistEls[wl], String(data.stats.watchlist));
                }
            }
        }

        /* Update watch history */
        if (Array.isArray(data.watchHistory)) {
            updateWatchHistory(data.watchHistory);
        }
    }

    /**
     * Update watch history list on profile page
     * 
     * @param {Array} historyItems - Array of history items
     */
    function updateWatchHistory(historyItems) {
        var containers = queryAll(SELECTORS.watchHistory);
        for (var c = 0; c < containers.length; c++) {
            var container = containers[c];
            var items = queryAll(SELECTORS.historyItem, container);

            for (var i = 0; i < Math.min(historyItems.length, items.length); i++) {
                var history = historyItems[i];
                var item = items[i];

                /* Update title */
                if (history.title) {
                    var title = queryFirst(SELECTORS.historyTitle, item);
                    safeSetText(title, history.title);
                }

                /* Update progress */
                if (history.progress !== undefined) {
                    var progress = queryFirst(SELECTORS.progressBar, item);
                    if (progress) {
                        safeSetStyle(progress, 'width', history.progress + '%');
                    }
                }

                /* Update thumbnail */
                if (history.thumbnail) {
                    var img = queryFirst('img', item);
                    safeSetSrc(img, history.thumbnail);
                }
            }
        }
    }

    /* ====================================================================
     * SECTION 13: TRANSLATED CONTENT UPDATER
     * ==================================================================== */

    /**
     * Update translated/i18n content across the page
     * Uses data-i18n attributes to find translatable elements
     * 
     * @param {Object} data - Translated content data
     */
    function updateTranslatedContent(data) {
        if (!isPlainObject(data)) return;

        var translations = data.translations || data;

        if (!isPlainObject(translations)) return;

        for (var key in translations) {
            if (!translations.hasOwnProperty(key)) continue;

            var value = translations[key];
            if (typeof value !== 'string') continue;

            /* Find all elements with matching data-i18n attribute */
            var elements = queryAll('[data-i18n="' + key + '"]');
            for (var i = 0; i < elements.length; i++) {
                safeSetText(elements[i], value);
            }

            /* Also check for data-i18n-placeholder for input placeholders */
            var placeholderElements = queryAll('[data-i18n-placeholder="' + key + '"]');
            for (var j = 0; j < placeholderElements.length; j++) {
                if (placeholderElements[j].getAttribute('placeholder') !== value) {
                    placeholderElements[j].setAttribute('placeholder', value);
                }
            }

            /* Check for data-i18n-title for title attributes */
            var titleElements = queryAll('[data-i18n-title="' + key + '"]');
            for (var t = 0; t < titleElements.length; t++) {
                if (titleElements[t].getAttribute('title') !== value) {
                    titleElements[t].setAttribute('title', value);
                }
            }
        }
    }

    /* ====================================================================
     * SECTION 14: MAINTENANCE MODE HANDLER
     * ==================================================================== */

    /**
     * Check if currently on the maintenance page
     * 
     * @returns {boolean} True if on maintenance page
     */
    function isOnMaintenancePage() {
        return state.currentPage === 'maintenance.html';
    }

    /**
     * Show maintenance mode overlay
     * Creates overlay if it doesn't exist
     * 
     * @param {Object} data - Maintenance data with title and message
     */
    function showMaintenanceOverlay(data) {
        if (isOnMaintenancePage()) return;

        var overlay = document.getElementById('maintenance-overlay');

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'maintenance-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
                'background:rgba(0,0,0,0.97);z-index:999999;display:flex;' +
                'align-items:center;justify-content:center;flex-direction:column;' +
                'color:#ffffff;font-family:Arial,sans-serif;text-align:center;padding:20px;';
            document.body.appendChild(overlay);
        }

        var html = '<div style="max-width:500px;">';
        html += '<h1 style="font-size:28px;margin-bottom:16px;">' +
                (data.title || 'Under Maintenance') + '</h1>';
        html += '<p style="font-size:16px;opacity:0.8;line-height:1.6;">' +
                (data.message || 'We\'ll be back soon. Please check back in a few minutes.') + '</p>';

        if (data.estimatedTime) {
            html += '<p style="font-size:14px;opacity:0.6;margin-top:12px;">' +
                    'Estimated time: ' + data.estimatedTime + '</p>';
        }

        html += '</div>';

        overlay.innerHTML = html;
        safeSetDisplay(overlay, 'flex');
    }

    /**
     * Hide maintenance mode overlay
     */
    function hideMaintenanceOverlay() {
        var overlay = document.getElementById('maintenance-overlay');
        if (overlay) {
            safeSetDisplay(overlay, 'none');
        }
    }

    /**
     * Handle maintenance mode data
     * 
     * @param {Object} data - Maintenance node data
     */
    function handleMaintenanceMode(data) {
        if (!isPlainObject(data)) return;

        if (data.enabled === true) {
            showMaintenanceOverlay(data);
        } else {
            hideMaintenanceOverlay();
        }
    }

    /* ====================================================================
     * SECTION 15: DATA REFRESH HANDLERS
     * ==================================================================== */

    /**
     * Map of node names to their refresh handler functions
     * Each handler reads data from Firebase and patches the DOM
     */
    var refreshHandlers = {
        /**
         * Refresh homepage data
         * Updates: featured banner, movie rows, continue watching,
         * watchlist, notifications, announcements
         */
        homepage: function () {
            return readDataNode('homepage').then(function (data) {
                if (!isPlainObject(data)) return;

                /* Check cache to avoid unnecessary DOM updates */
                var cached = getMemoryCache('homepage');
                if (cached && JSON.stringify(cached) === JSON.stringify(data)) {
                    return;
                }

                setMemoryCache('homepage', data);

                requestAnimationFrame(function () {
                    /* Update featured banner */
                    if (isPlainObject(data.featured)) {
                        updateFeaturedBanner(data.featured);
                    }

                    /* Update trending row */
                    if (Array.isArray(data.trending)) {
                        updateContentRow('#trending-row, .trending-section', data.trending);
                    }

                    /* Update latest movies row */
                    if (Array.isArray(data.latest)) {
                        updateContentRow('#latest-row, .latest-section', data.latest);
                    }

                    /* Update recommended row */
                    if (Array.isArray(data.recommended)) {
                        updateContentRow('#recommended-row, .recommended-section', data.recommended);
                    }

                    /* Update continue watching */
                    if (Array.isArray(data.continueWatching)) {
                        updateContinueWatchingSection(data.continueWatching);
                    }

                    /* Update watchlist row */
                    if (Array.isArray(data.watchlist)) {
                        updateContentRow('#watchlist-row, .watchlist-section', data.watchlist);
                    }

                    /* Update recently added row */
                    if (Array.isArray(data.recentlyAdded)) {
                        updateContentRow('#recently-added-row, .recently-added-section', data.recentlyAdded);
                    }

                    /* Update top rated row */
                    if (Array.isArray(data.topRated)) {
                        updateContentRow('#top-rated-row, .top-rated-section', data.topRated);
                    }

                    /* Update popular row */
                    if (Array.isArray(data.popular)) {
                        updateContentRow('#popular-row, .popular-section', data.popular);
                    }

                    /* Update notifications */
                    if (isPlainObject(data.notifications)) {
                        updateNotificationsDisplay(data.notifications);
                    }

                    /* Update announcements */
                    if (isPlainObject(data.announcements)) {
                        updateAnnouncementsDisplay(data.announcements);
                    }

                    dispatchCustomEvent('refresh:pageUpdated', {
                        page: 'index.html',
                        node: 'homepage'
                    });
                });
            });
        },

        /**
         * Refresh movies data
         * Updates movie grids on viewall, movie detail, etc.
         */
        movies: function () {
            return readDataNode('movies').then(function (data) {
                if (!isPlainObject(data)) return;

                var cached = getMemoryCache('movies');
                if (cached && JSON.stringify(cached) === JSON.stringify(data)) {
                    return;
                }

                setMemoryCache('movies', data);

                requestAnimationFrame(function () {
                    /* On watch page, only update metadata */
                    if (WATCH_PAGES.indexOf(state.currentPage) !== -1) {
                        updateWatchPageMetadata(data);
                    } else {
                        /* On other pages, update movie grid */
                        var movieList = data.list || data.movies || [];
                        if (Array.isArray(movieList)) {
                            updateContentRow(SELECTORS.moviesGrid, movieList);
                        }
                    }

                    dispatchCustomEvent('refresh:movieUpdated', { node: 'movies' });
                });
            });
        },

        /**
         * Refresh series data
         */
        series: function () {
            return readDataNode('series').then(function (data) {
                if (!isPlainObject(data)) return;

                var cached = getMemoryCache('series');
                if (cached && JSON.stringify(cached) === JSON.stringify(data)) {
                    return;
                }

                setMemoryCache('series', data);

                requestAnimationFrame(function () {
                    var seriesList = data.list || data.series || [];
                    if (Array.isArray(seriesList)) {
                        updateContentRow(SELECTORS.seriesGrid, seriesList);
                    }

                    dispatchCustomEvent('refresh:seriesUpdated', { node: 'series' });
                });
            });
        },

        /**
         * Refresh channels data
         */
        channels: function () {
            return readDataNode('channels').then(function (data) {
                if (!isPlainObject(data)) return;

                var cached = getMemoryCache('channels');
                if (cached && JSON.stringify(cached) === JSON.stringify(data)) {
                    return;
                }

                setMemoryCache('channels', data);

                requestAnimationFrame(function () {
                    updateChannelsGrid(data);
                });
            });
        },

        /**
         * Refresh live TV data
         * CRITICAL: Never restarts the video stream
         */
        live: function () {
            return readDataNode('live').then(function (data) {
                if (!isPlainObject(data)) return;

                var cached = getMemoryCache('live');
                if (cached && JSON.stringify(cached) === JSON.stringify(data)) {
                    return;
                }

                setMemoryCache('live', data);

                requestAnimationFrame(function () {
                    updateLivePageData(data);
                    dispatchCustomEvent('refresh:liveUpdated', { node: 'live' });
                });
            });
        },

        /**
         * Refresh profile data
         */
        profile: function () {
            return readDataNode('profile').then(function (data) {
                if (!isPlainObject(data)) return;

                var cached = getMemoryCache('profile');
                if (cached && JSON.stringify(cached) === JSON.stringify(data)) {
                    return;
                }

                setMemoryCache('profile', data);

                requestAnimationFrame(function () {
                    updateProfilePageData(data);
                    dispatchCustomEvent('refresh:profileUpdated', { node: 'profile' });
                });
            });
        },

        /**
         * Refresh notifications data
         */
        notifications: function () {
            return readDataNode('notifications').then(function (data) {
                if (!isPlainObject(data)) return;

                var cached = getMemoryCache('notifications');
                if (cached && JSON.stringify(cached) === JSON.stringify(data)) {
                    return;
                }

                setMemoryCache('notifications', data);

                requestAnimationFrame(function () {
                    updateNotificationsDisplay(data);
                });
            });
        },

        /**
         * Refresh recommendations data
         */
        recommendations: function () {
            return readDataNode('recommendations').then(function (data) {
                if (!isPlainObject(data)) return;

                var cached = getMemoryCache('recommendations');
                if (cached && JSON.stringify(cached) === JSON.stringify(data)) {
                    return;
                }

                setMemoryCache('recommendations', data);

                requestAnimationFrame(function () {
                    var recList = data.items || data.list || [];
                    if (Array.isArray(recList)) {
                        updateRecommendationsSidebar(recList);
                    }
                });
            });
        },

        /**
         * Refresh translated content
         */
        translated: function () {
            return readDataNode('translated').then(function (data) {
                if (!isPlainObject(data)) return;

                var cached = getMemoryCache('translated');
                if (cached && JSON.stringify(cached) === JSON.stringify(data)) {
                    return;
                }

                setMemoryCache('translated', data);

                requestAnimationFrame(function () {
                    updateTranslatedContent(data);
                });
            });
        },

        /**
         * Refresh maintenance mode status
         */
        maintenance: function () {
            return readDataNode('maintenance').then(function (data) {
                if (!isPlainObject(data)) return;

                var cached = getMemoryCache('maintenance');
                if (cached && JSON.stringify(cached) === JSON.stringify(data)) {
                    return;
                }

                setMemoryCache('maintenance', data);

                requestAnimationFrame(function () {
                    handleMaintenanceMode(data);
                });
            });
        },

        /**
         * Handle app version updates
         * Can trigger a soft update notification
         */
        appVersion: function () {
            return readDataNode('appVersion').then(function (data) {
                if (!isPlainObject(data)) return;

                setMemoryCache('appVersion', data);

                if (data.version) {
                    log('App version: ' + data.version);

                    /* Dispatch event for other modules to handle */
                    dispatchCustomEvent('app:versionUpdate', {
                        version: data.version,
                        forceUpdate: data.forceUpdate || false,
                        updateMessage: data.updateMessage || ''
                    });
                }
            });
        },

        /**
         * Handle featured/banner specific refresh
         */
        featured: function () {
            /* Delegates to homepage handler */
            return refreshHandlers.homepage();
        },

        /**
         * Handle banners specific refresh
         */
        banners: function () {
            /* Delegates to homepage handler */
            return refreshHandlers.homepage();
        },

        /**
         * Handle continue watching specific refresh
         */
        continueWatching: function () {
            return readDataNode('continueWatching').then(function (data) {
                if (!Array.isArray(data) && !isPlainObject(data)) return;

                var items = Array.isArray(data) ? data : (data.items || []);
                setMemoryCache('continueWatching', items);

                requestAnimationFrame(function () {
                    updateContinueWatchingSection(items);
                });
            });
        },

        /**
         * Handle watchlist specific refresh
         */
        watchlist: function () {
            return readDataNode('watchlist').then(function (data) {
                if (!Array.isArray(data) && !isPlainObject(data)) return;

                var items = Array.isArray(data) ? data : (data.items || []);
                setMemoryCache('watchlist', items);

                requestAnimationFrame(function () {
                    updateContentRow('#watchlist-row, .watchlist-section', items);
                });
            });
        },

        /**
         * Handle watch history specific refresh
         */
        watchHistory: function () {
            return readDataNode('watchHistory').then(function (data) {
                if (!Array.isArray(data) && !isPlainObject(data)) return;

                var items = Array.isArray(data) ? data : (data.items || []);
                setMemoryCache('watchHistory', items);

                requestAnimationFrame(function () {
                    updateWatchHistory(items);
                });
            });
        }
    };

    /* ====================================================================
     * SECTION 16: MAIN REFRESH CYCLE
     * ==================================================================== */

    /**
     * Process detected changes by calling appropriate handlers
     * Updates version cache after successful processing
     * 
     * @param {Array} changes - Array of change objects from detectChanges()
     * @returns {Promise} Resolves when all changes are processed
     */
    function processChanges(changes) {
        if (!Array.isArray(changes) || changes.length === 0) {
            return Promise.resolve();
        }

        state.pendingRefreshes = changes.length;
        var promises = [];

        for (var i = 0; i < changes.length; i++) {
            var change = changes[i];
            var handler = refreshHandlers[change.node];

            if (typeof handler === 'function') {
                /* Update the cached version immediately to prevent re-processing */
                state.cachedVersions[change.node] = change.newVersion;

                /* Create a wrapped promise to track completion */
                (function (node, changeData) {
                    var promise = handler()
                        .then(function () {
                            state.totalChangesApplied++;
                        })
                        .catch(function (error) {
                            log('Handler error for ' + node + ': ' + error.message, 'error');
                            /* Revert version cache on error so it retries next cycle */
                            delete state.cachedVersions[node];
                        })
                        .finally(function () {
                            state.pendingRefreshes--;
                        });

                    promises.push(promise);
                })(change.node, change);
            } else {
                /* No handler for this node, just update version */
                state.cachedVersions[change.node] = change.newVersion;
                state.pendingRefreshes--;
            }
        }

        /* Persist version cache to localStorage */
        saveVersionCache();

        return Promise.all(promises);
    }

    /**
     * Main refresh cycle function
     * Called every 5 seconds by the interval
     * Reads version data, detects changes, processes updates
     */
    function executeRefreshCycle() {
        /* Guard conditions */
        if (!state.isRunning) return;
        if (state.isPaused) return;
        if (!state.isOnline) return;
        if (state.isRefreshing) return;

        /* Skip refresh on slow connections to save bandwidth */
        if (detectSlowConnection()) {
            log('Slow connection detected, skipping this cycle', 'warn');
            return;
        }

        /* Mark as refreshing to prevent overlapping cycles */
        state.isRefreshing = true;
        state.lastRefreshTime = Date.now();

        /* Dispatch start event */
        dispatchCustomEvent('refresh:start', {
            page: state.currentPage,
            timestamp: state.lastRefreshTime,
            cycle: state.totalRefreshCycles + 1
        });

        /* Read refresh node and process changes */
        readRefreshNode()
            .then(function (versionsData) {
                var changes = detectChanges(versionsData);

                if (changes.length > 0) {
                    log('Detected ' + changes.length + ' change(s)');
                    return processChanges(changes);
                }

                return Promise.resolve();
            })
            .then(function () {
                state.totalRefreshCycles++;
                state.retryCount = 0;
                state.lastError = null;

                /* Save last refresh timestamp */
                try {
                    localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
                } catch (e) {
                    /* Ignore localStorage errors */
                }

                /* Dispatch complete event */
                dispatchCustomEvent('refresh:complete', {
                    page: state.currentPage,
                    timestamp: Date.now(),
                    cycle: state.totalRefreshCycles
                });
            })
            .catch(function (error) {
                state.lastError = error.message;
                log('Refresh cycle error: ' + error.message, 'error');

                dispatchCustomEvent('refresh:error', {
                    error: error.message,
                    page: state.currentPage,
                    retryCount: state.retryCount
                });

                handleRefreshError(error);
            })
            .finally(function () {
                state.isRefreshing = false;
            });
    }

    /**
     * Handle refresh errors with exponential backoff retry
     * 
     * @param {Error} error - The error that occurred
     */
    function handleRefreshError(error) {
        state.retryCount++;

        if (state.retryCount <= MAX_RETRY_ATTEMPTS) {
            var delay = RETRY_DELAY_MS * state.retryCount;
            log('Retrying in ' + delay + 'ms (attempt ' +
                state.retryCount + '/' + MAX_RETRY_ATTEMPTS + ')', 'warn');

            if (state.retryTimerId) {
                clearTimeout(state.retryTimerId);
            }

            state.retryTimerId = setTimeout(function () {
                state.retryTimerId = null;
                executeRefreshCycle();
            }, delay);
        } else {
            log('Max retry attempts reached, waiting for next cycle', 'error');
            state.retryCount = 0;
        }
    }

    /* ====================================================================
     * SECTION 17: NETWORK & CONNECTIVITY HANDLERS
     * ==================================================================== */

    /**
     * Handle browser going online
     * Resumes refresh and triggers immediate sync
     */
    function handleOnlineEvent() {
        state.isOnline = true;
        log('Connection restored - online');

        /* Clear any offline state */
        if (state.retryTimerId) {
            clearTimeout(state.retryTimerId);
            state.retryTimerId = null;
        }
        state.retryCount = 0;

        /* Trigger immediate refresh when coming back online */
        if (state.isRunning && !state.isPaused) {
            executeRefreshCycle();
        }
    }

    /**
     * Handle browser going offline
     * Pauses refresh to avoid failed requests
     */
    function handleOfflineEvent() {
        state.isOnline = false;
        log('Connection lost - offline', 'warn');

        /* Clear any pending retries */
        if (state.retryTimerId) {
            clearTimeout(state.retryTimerId);
            state.retryTimerId = null;
        }
    }

    /**
     * Handle connection quality changes
     * Updates slow connection flag
     */
    function handleConnectionChangeEvent() {
        detectSlowConnection();

        if (state.isSlowConnection) {
            var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            log('Slow connection detected: ' + (conn ? conn.effectiveType : 'unknown'), 'warn');
        }
    }

    /* ====================================================================
     * SECTION 18: PAGE VISIBILITY & NAVIGATION
     * ==================================================================== */

    /**
     * Handle page visibility changes (tab focus/blur)
     * Pauses refresh when tab is hidden to save resources
     * Resumes when tab becomes visible again
     */
    function handleVisibilityChangeEvent() {
        if (document.hidden) {
            /* Page is hidden - pause refresh */
            if (state.isRunning && !state.isPaused) {
                log('Page hidden, pausing refresh');
                state.wasRunningBeforeHidden = true;
                pauseInternal();
            }
        } else {
            /* Page is visible again - resume refresh */
            if (state.wasRunningBeforeHidden && state.isPaused) {
                log('Page visible, resuming refresh');
                state.wasRunningBeforeHidden = false;
                resumeInternal();
            }
        }
    }

    /**
     * Detect and handle page changes (for SPAs)
     * Updates currentPage and triggers refresh for new page
     */
    function handlePageChange() {
        var newPage = getCurrentPage();

        if (newPage !== state.currentPage) {
            var oldPage = state.currentPage;
            state.currentPage = newPage;
            log('Page changed: ' + oldPage + ' -> ' + newPage);

            /* Clear page-specific caches that are no longer relevant */
            clearPageSpecificCache(oldPage);

            /* Trigger immediate refresh for new page */
            if (state.isRunning && !state.isPaused && state.isOnline) {
                executeRefreshCycle();
            }
        }
    }

    /**
     * Clear cache entries specific to a page
     * Helps free memory when navigating away
     * 
     * @param {string} page - Page filename
     */
    function clearPageSpecificCache(page) {
        /* Don't clear shared caches like notifications */
        var pageSpecificCaches = {
            'watch.html': ['movies'],
            'video.html': ['movies'],
            'live.html': ['live'],
            'channel.html': ['channels', 'live'],
            'profile.html': ['profile', 'watchHistory'],
            'translated.html': ['translated']
        };

        var cachesToClear = pageSpecificCaches[page];
        if (!Array.isArray(cachesToClear)) return;

        for (var i = 0; i < cachesToClear.length; i++) {
            delete state.memoryCache[cachesToClear[i]];
            delete state.cacheTimestamps[cachesToClear[i]];
        }
    }

    /* ====================================================================
     * SECTION 19: INTERVAL MANAGEMENT
     * ==================================================================== */

    /**
     * Start the refresh interval
     * Sets up the 5-second interval for automatic refresh
     */
    function startInterval() {
        /* Clear any existing interval */
        if (state.intervalId !== null) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }

        /* Set up new interval */
        state.intervalId = setInterval(function () {
            executeRefreshCycle();
        }, REFRESH_INTERVAL_MS);

        state.isRunning = true;
    }

    /**
     * Stop the refresh interval
     * Clears the interval and resets running state
     */
    function stopInterval() {
        if (state.intervalId !== null) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }

        if (state.retryTimerId !== null) {
            clearTimeout(state.retryTimerId);
            state.retryTimerId = null;
        }

        state.isRunning = false;
    }

    /**
     * Internal pause function
     * Stops interval but keeps isPaused flag for resume
     */
    function pauseInternal() {
        if (state.intervalId !== null) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }

        if (state.retryTimerId !== null) {
            clearTimeout(state.retryTimerId);
            state.retryTimerId = null;
        }

        state.isPaused = true;
    }

    /**
     * Internal resume function
     * Restarts interval after pause
     */
    function resumeInternal() {
        state.isPaused = false;
        startInterval();

        /* Immediate refresh on resume */
        executeRefreshCycle();
    }

    /* ====================================================================
     * SECTION 20: PUBLIC API
     * ==================================================================== */

    /**
     * AutoRefresh - Public API Object
     * Exposed globally as window.AutoRefresh
     */
    var AutoRefresh = {

        /**
         * Initialize the AutoRefresh module
         * Sets up event listeners, loads cache, detects page
         * Must be called after config.js has loaded
         * 
         * @returns {Object} AutoRefresh instance (for chaining)
         */
        init: function () {
            /* Prevent double initialization */
            if (state.isInitialized) {
                log('Already initialized');
                return this;
            }

            /* Check if Firebase database is available */
            if (typeof database === 'undefined' || database === null) {
                log('Firebase database not available, will retry...', 'warn');
                setTimeout(function () {
                    AutoRefresh.init();
                }, 500);
                return this;
            }

            log('Initializing...');

            /* Load persisted version cache */
            loadVersionCache();

            /* Detect current page */
            state.currentPage = getCurrentPage();

            /* Check initial connection state */
            state.isOnline = navigator.onLine;
            detectSlowConnection();

            /* Set up network event listeners */
            window.addEventListener('online', handleOnlineEvent);
            window.addEventListener('offline', handleOfflineEvent);

            /* Set up visibility change listener */
            if (typeof document.addEventListener === 'function') {
                document.addEventListener('visibilitychange', handleVisibilityChangeEvent);
            }

            /* Set up connection change listener if API available */
            if (navigator.connection) {
                try {
                    navigator.connection.addEventListener('change', handleConnectionChangeEvent);
                } catch (e) {
                    /* API might not support addEventListener */
                }
            }

            /* Set up navigation listeners for SPA support */
            window.addEventListener('popstate', handlePageChange);
            window.addEventListener('hashchange', handlePageChange);

            /* Listen for custom navigation events from app.js */
            document.addEventListener('page:changed', function (e) {
                if (e.detail && e.detail.page) {
                    state.currentPage = e.detail.page.toLowerCase();
                    log('Custom navigation event: ' + state.currentPage);
                    if (state.isRunning && !state.isPaused && state.isOnline) {
                        executeRefreshCycle();
                    }
                }
            });

            /* Listen for route change events (common in SPAs) */
            document.addEventListener('route:changed', function (e) {
                if (e.detail && e.detail.path) {
                    state.currentPage = getCurrentPage();
                    log('Route change event: ' + state.currentPage);
                    if (state.isRunning && !state.isPaused && state.isOnline) {
                        executeRefreshCycle();
                    }
                }
            });

            state.isInitialized = true;
            log('Initialized successfully - Page: ' + state.currentPage);

            /* Auto-start after initialization */
            return this.start();
        },

        /**
         * Start the auto-refresh cycle
         * Begins the 5-second interval and performs immediate first refresh
         * 
         * @returns {Object} AutoRefresh instance (for chaining)
         */
        start: function () {
            /* Initialize if not already done */
            if (!state.isInitialized) {
                return this.init();
            }

            /* Prevent starting if already running */
            if (state.isRunning && !state.isPaused) {
                log('Already running');
                return this;
            }

            log('Starting auto-refresh (every ' + (REFRESH_INTERVAL_MS / 1000) + 's)');

            /* Start the interval */
            startInterval();

            /* Perform immediate first refresh */
            executeRefreshCycle();

            return this;
        },

        /**
         * Stop the auto-refresh cycle completely
         * Unlike pause(), this clears all state
         * 
         * @returns {Object} AutoRefresh instance (for chaining)
         */
        stop: function () {
            if (!state.isInitialized) return this;

            log('Stopping auto-refresh');
            stopInterval();
            state.isPaused = false;
            state.wasRunningBeforeHidden = false;

            return this;
        },

        /**
         * Pause the auto-refresh cycle
         * Can be resumed with resume()
         * 
         * @returns {Object} AutoRefresh instance (for chaining)
         */
        pause: function () {
            if (!state.isInitialized) return this;
            if (!state.isRunning) return this;
            if (state.isPaused) return this;

            log('Pausing auto-refresh');
            pauseInternal();

            return this;
        },

        /**
         * Resume from a paused state
         * Restarts the interval and performs immediate refresh
         * 
         * @returns {Object} AutoRefresh instance (for chaining)
         */
        resume: function () {
            if (!state.isInitialized) return this;
            if (!state.isPaused) return this;

            log('Resuming auto-refresh');
            resumeInternal();

            return this;
        },

        /**
         * Force an immediate refresh cycle
         * Bypasses the normal interval timing
         * 
         * @returns {Object} AutoRefresh instance (for chaining)
         */
        refreshNow: function () {
            if (!state.isInitialized) {
                log('Not initialized, call init() first', 'warn');
                return this;
            }

            if (!state.isOnline) {
                log('Cannot refresh while offline', 'warn');
                return this;
            }

            log('Forcing immediate refresh');
            executeRefreshCycle();

            return this;
        },

        /**
         * Refresh data for the current page only
         * Reads all relevant nodes and updates DOM
         * 
         * @returns {Promise} Resolves when all page data is refreshed
         */
        refreshCurrentPage: function () {
            if (!state.isInitialized) {
                return Promise.resolve();
            }

            /* Update current page detection */
            state.currentPage = getCurrentPage();
            log('Refreshing current page: ' + state.currentPage);

            var pageNodes = PAGE_NODE_MAP[state.currentPage] || [];
            var promises = [];

            for (var i = 0; i < pageNodes.length; i++) {
                var nodeName = pageNodes[i];
                var handler = refreshHandlers[nodeName];

                if (typeof handler === 'function') {
                    promises.push(
                        handler().catch(function (error) {
                            log('Page refresh error: ' + error.message, 'error');
                        })
                    );
                }
            }

            return Promise.all(promises);
        },

        /**
         * Refresh movies data specifically
         * 
         * @returns {Promise} Resolves when movies are refreshed
         */
        refreshMovies: function () {
            if (!state.isInitialized) return Promise.resolve();
            return refreshHandlers.movies().catch(function (e) {
                log('refreshMovies error: ' + e.message, 'error');
            });
        },

        /**
         * Refresh series data specifically
         * 
         * @returns {Promise} Resolves when series are refreshed
         */
        refreshSeries: function () {
            if (!state.isInitialized) return Promise.resolve();
            return refreshHandlers.series().catch(function (e) {
                log('refreshSeries error: ' + e.message, 'error');
            });
        },

        /**
         * Refresh channels data specifically
         * 
         * @returns {Promise} Resolves when channels are refreshed
         */
        refreshChannels: function () {
            if (!state.isInitialized) return Promise.resolve();
            return refreshHandlers.channels().catch(function (e) {
                log('refreshChannels error: ' + e.message, 'error');
            });
        },

        /**
         * Refresh profile data specifically
         * 
         * @returns {Promise} Resolves when profile is refreshed
         */
        refreshProfile: function () {
            if (!state.isInitialized) return Promise.resolve();
            return refreshHandlers.profile().catch(function (e) {
                log('refreshProfile error: ' + e.message, 'error');
            });
        },

        /**
         * Refresh notifications data specifically
         * 
         * @returns {Promise} Resolves when notifications are refreshed
         */
        refreshNotifications: function () {
            if (!state.isInitialized) return Promise.resolve();
            return refreshHandlers.notifications().catch(function (e) {
                log('refreshNotifications error: ' + e.message, 'error');
            });
        },

        /**
         * Refresh recommendations data specifically
         * 
         * @returns {Promise} Resolves when recommendations are refreshed
         */
        refreshRecommendations: function () {
            if (!state.isInitialized) return Promise.resolve();
            return refreshHandlers.recommendations().catch(function (e) {
                log('refreshRecommendations error: ' + e.message, 'error');
            });
        },

        /**
         * Clear all caches (memory and localStorage)
         * Useful for logout or forced refresh scenarios
         * 
         * @returns {Object} AutoRefresh instance (for chaining)
         */
        clearCache: function () {
            clearAllCaches();
            return this;
        },

        /**
         * Get the current state of the AutoRefresh module
         * Useful for debugging and monitoring
         * 
         * @returns {Object} Current state snapshot
         */
        getState: function () {
            return {
                isInitialized: state.isInitialized,
                isRunning: state.isRunning,
                isPaused: state.isPaused,
                isOnline: state.isOnline,
                isSlowConnection: state.isSlowConnection,
                isRefreshing: state.isRefreshing,
                currentPage: state.currentPage,
                cachedVersions: deepClone(state.cachedVersions),
                cacheSize: Object.keys(state.memoryCache).length,
                lastRefreshTime: state.lastRefreshTime,
                pendingRefreshes: state.pendingRefreshes,
                totalRefreshCycles: state.totalRefreshCycles,
                totalChangesApplied: state.totalChangesApplied,
                retryCount: state.retryCount,
                lastError: state.lastError
            };
        },

        /**
         * Completely destroy the AutoRefresh module
         * Removes all event listeners, clears caches, resets state
         * Should only be called when the module is no longer needed
         * 
         * @returns {Object} AutoRefresh instance (for chaining)
         */
        destroy: function () {
            log('Destroying module...');

            /* Stop all intervals */
            this.stop();

            /* Remove all event listeners */
            window.removeEventListener('online', handleOnlineEvent);
            window.removeEventListener('offline', handleOfflineEvent);
            document.removeEventListener('visibilitychange', handleVisibilityChangeEvent);
            window.removeEventListener('popstate', handlePageChange);
            window.removeEventListener('hashchange', handlePageChange);

            if (navigator.connection) {
                try {
                    navigator.connection.removeEventListener('change', handleConnectionChangeEvent);
                } catch (e) {
                    /* Ignore */
                }
            }

            /* Clear all caches */
            clearAllCaches();

            /* Reset state */
            state.isInitialized = false;
            state.isRunning = false;
            state.isPaused = false;
            state.isRefreshing = false;
            state.totalRefreshCycles = 0;
            state.totalChangesApplied = 0;
            state.retryCount = 0;
            state.lastError = null;
            state.lastRefreshTime = 0;
            state.pendingRefreshes = 0;

            log('Module destroyed');

            return this;
        }
    };

    /* ====================================================================
     * SECTION 21: AUTO-INITIALIZATION
     * ==================================================================== */

    /**
     * Wait for dependencies (config.js) to load, then auto-initialize
     * Checks for Firebase database object availability
     * Retries with backoff until available or timeout
     */
    function waitForDependenciesAndInit() {
        /* Check if database is immediately available */
        if (typeof database !== 'undefined' && database !== null) {
            AutoRefresh.init();
            return;
        }

        /* Set up retry loop */
        var attempts = 0;
        var maxAttempts = 100; /* 10 seconds max wait (100 * 100ms) */
        var retryDelay = 100;

        var checkInterval = setInterval(function () {
            attempts++;

            if (typeof database !== 'undefined' && database !== null) {
                clearInterval(checkInterval);
                AutoRefresh.init();
            } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                log('Initialization timeout: Firebase database not available after 10s', 'error');

                /* Try once more after a longer delay */
                setTimeout(function () {
                    if (typeof database !== 'undefined' && database !== null) {
                        AutoRefresh.init();
                    }
                }, 5000);
            }
        }, retryDelay);
    }

    /**
     * Bootstrap the module when DOM is ready
     * Waits for DOMContentLoaded if needed
     */
    function bootstrap() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', waitForDependenciesAndInit);
        } else {
            /* DOM already loaded */
            waitForDependenciesAndInit();
        }
    }

    /* Start bootstrap process */
    bootstrap();

    /* ====================================================================
     * SECTION 22: GLOBAL EXPORT
     * ==================================================================== */

    /**
     * Export AutoRefresh to global scope
     * Available as: window.AutoRefresh
     */
    global.AutoRefresh = AutoRefresh;

    /**
     * Also export as a property of the global object for module patterns
     * Allows: var refresh = window.AutoRefresh;
     */
    if (typeof global.define === 'function' && global.define.amd) {
        /* AMD support */
        global.define([], function () {
            return AutoRefresh;
        });
    }

})(typeof window !== 'undefined' ? window : this);