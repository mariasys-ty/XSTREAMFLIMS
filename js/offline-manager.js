/* =============================================
   OFFLINE MANAGER v1.0.0
   Standalone module for offline functionality
   Load AFTER main script but BEFORE page init
   ============================================= */

var OfflineManager = (function() {
  'use strict';
  
  // ============================================
  // CONFIGURATION
  // ============================================
  var CONFIG = {
    DB_NAME: 'xstream_offline',
    DB_VERSION: 2,
    STORES: {
      videos: 'videos',           // Downloaded video blobs
      metadata: 'video_meta',     // Video metadata for offline display
      favourites: 'favourites',   // Cached favourites
      history: 'history',         // Cached history
      syncQueue: 'sync_queue',    // Pending actions when offline
      thumbnails: 'thumbnails'    // Cached thumbnail blobs
    },
    MAX_VIDEO_STORAGE_MB: 1024,   // 1GB max for videos
    MAX_CACHE_AGE: 24 * 60 * 60 * 1000, // 24 hours for cache
    SW_PATH: '/sw.js',
    SW_SCOPE: '/'
  };
  
  // ============================================
  // STATE
  // ============================================
  var db = null;
  var dbReady = false;
  var isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  var listeners = { online: [], offline: [], sync: [], storage: [] };
  var syncInProgress = false;
  var _initPromise = null;
  
  // ============================================
  // DATABASE LAYER
  // ============================================
  function openDB() {
    if (_initPromise) return _initPromise;
    
    _initPromise = new Promise(function(resolve, reject) {
      if (db) { dbReady = true; resolve(db); return; }
      
      var request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
      
      request.onupgradeneeded = function(event) {
        var database = event.target.result;
        
        // Videos store - stores actual blob + metadata
        if (!database.objectStoreNames.contains(CONFIG.STORES.videos)) {
          var vidStore = database.createObjectStore(CONFIG.STORES.videos, { keyPath: 'id' });
          vidStore.createIndex('downloadedAt', 'downloadedAt', { unique: false });
          vidStore.createIndex('title', 'title', { unique: false });
          vidStore.createIndex('size', 'size', { unique: false });
        }
        
        // Metadata store - lightweight video info for lists
        if (!database.objectStoreNames.contains(CONFIG.STORES.metadata)) {
          var metaStore = database.createObjectStore(CONFIG.STORES.metadata, { keyPath: 'id' });
          metaStore.createIndex('title', 'title', { unique: false });
        }
        
        // Favourites cache
        if (!database.objectStoreNames.contains(CONFIG.STORES.favourites)) {
          var favStore = database.createObjectStore(CONFIG.STORES.favourites, { keyPath: 'id' });
          favStore.createIndex('cachedAt', 'cachedAt', { unique: false });
        }
        
        // History cache
        if (!database.objectStoreNames.contains(CONFIG.STORES.history)) {
          var histStore = database.createObjectStore(CONFIG.STORES.history, { keyPath: 'id' });
          histStore.createIndex('watchedAt', 'watchedAt', { unique: false });
        }
        
        // Sync queue - pending actions
        if (!database.objectStoreNames.contains(CONFIG.STORES.syncQueue)) {
          var syncStore = database.createObjectStore(CONFIG.STORES.syncQueue, { keyPath: 'id', autoIncrement: true });
          syncStore.createIndex('type', 'type', { unique: false });
          syncStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        
        // Thumbnails cache
        if (!database.objectStoreNames.contains(CONFIG.STORES.thumbnails)) {
          database.createObjectStore(CONFIG.STORES.thumbnails, { keyPath: 'url' });
        }
      };
      
      request.onsuccess = function(event) {
        db = event.target.result;
        dbReady = true;
        
        // Handle unexpected closes
        db.onclose = function() {
          dbReady = false;
          db = null;
          _initPromise = null;
        };
        
        db.onerror = function(e) {
          console.error('[OfflineManager] DB error:', e.target.error);
        };
        
        resolve(db);
      };
      
      request.onerror = function(event) {
        console.error('[OfflineManager] Failed to open DB:', event.target.error);
        reject(event.target.error);
      };
    });
    
    return _initPromise;
  }
  
  // Generic store operations
  function storeGet(storeName, key) {
    return openDB().then(function(database) {
      return new Promise(function(resolve, reject) {
        var tx = database.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var req = store.get(key);
        req.onsuccess = function() { resolve(req.result || null); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }
  
  function storePut(storeName, data) {
    return openDB().then(function(database) {
      return new Promise(function(resolve, reject) {
        var tx = database.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        var req = store.put(data);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }
  
  function storeDelete(storeName, key) {
    return openDB().then(function(database) {
      return new Promise(function(resolve, reject) {
        var tx = database.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        var req = store.delete(key);
        req.onsuccess = function() { resolve(); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }
  
  function storeGetAll(storeName, indexName, direction) {
    return openDB().then(function(database) {
      return new Promise(function(resolve, reject) {
        var tx = database.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var req;
        
        if (indexName) {
          var index = store.index(indexName);
          req = index.openCursor(null, direction || 'prev');
        } else {
          req = store.openCursor(null, direction || 'prev');
        }
        
        var results = [];
        req.onsuccess = function(event) {
          var cursor = event.target.result;
          if (cursor) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        req.onerror = function() { reject(req.error); };
      });
    });
  }
  
  function storeClear(storeName) {
    return openDB().then(function(database) {
      return new Promise(function(resolve, reject) {
        var tx = database.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        var req = store.clear();
        req.onsuccess = function() { resolve(); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }
  
  function storeCount(storeName) {
    return openDB().then(function(database) {
      return new Promise(function(resolve, reject) {
        var tx = database.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var req = store.count();
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }
  
  // ============================================
  // NETWORK STATUS
  // ============================================
  function initNetworkListeners() {
    if (typeof window === 'undefined') return;
    
    window.addEventListener('online', function() {
      isOnline = true;
      _notifyListeners('online', true);
      _showOfflineIndicator(false);
      _processSyncQueue();
    });
    
    window.addEventListener('offline', function() {
      isOnline = false;
      _notifyListeners('offline', false);
      _showOfflineIndicator(true);
    });
    
    // Initial state
    _showOfflineIndicator(!isOnline);
  }
  
  function _showOfflineIndicator(show) {
    if (typeof document === 'undefined') return;
    
    var indicator = document.getElementById('offline-status-bar');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'offline-status-bar';
      indicator.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
        'background:linear-gradient(135deg,#e63946,#c0392b);color:#fff;' +
        'padding:8px 16px;font-size:13px;font-weight:500;text-align:center;' +
        'transform:translateY(-100%);transition:transform 0.3s ease;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
        'box-shadow:0 2px 10px rgba(0,0,0,0.2);';
      document.body.appendChild(indicator);
    }
    
    if (show) {
      indicator.innerHTML = '<svg style="width:16px;height:16px;vertical-align:middle;margin-right:6px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>' +
        'You\'re offline — Downloaded videos still available';
      indicator.style.transform = 'translateY(0)';
    } else {
      indicator.style.transform = 'translateY(-100%)';
    }
  }
  
  function _notifyListeners(event, data) {
    var list = listeners[event] || [];
    list.forEach(function(fn) {
      try { fn(data); } catch(e) { console.warn('[OfflineManager] Listener error:', e); }
    });
  }
  
  // ============================================
  // VIDEO DOWNLOADS (Offline Playback)
  // ============================================
  
  /**
   * Download a video for offline viewing
   * @param {string} videoId - Video ID
   * @param {string} videoUrl - Direct URL to video file
   * @param {object} metaData - Video metadata object
   * @param {function} onProgress - Progress callback (0-100)
   * @returns {Promise}
   */
  function downloadVideo(videoId, videoUrl, metaData, onProgress) {
    return getStorageStats().then(function(stats) {
      // Check count limit (from your existing code)
      if (typeof MAX_DOWNLOADS !== 'undefined' && stats.count >= MAX_DOWNLOADS) {
        return Promise.reject({ code: 'LIMIT_REACHED', message: 'Download limit reached (Max ' + MAX_DOWNLOADS + ')' });
      }
      
      // Show start toast
      if (typeof showToast === 'function') {
        showToast('Downloading "' + (metaData.title || 'Video') + '" for offline...', 'info');
      }
      
      // Fetch the video
      return fetch(videoUrl).then(function(response) {
        if (!response.ok) {
          throw { code: 'FETCH_FAILED', message: 'Failed to fetch video (HTTP ' + response.status + ')' };
        }
        
        var contentLength = response.headers.get('content-length');
        var totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
        var receivedBytes = 0;
        
        // Check size limit BEFORE downloading fully
        var maxBytes = (CONFIG.MAX_VIDEO_STORAGE_MB * 1024 * 1024);
        if (stats.totalSize + totalBytes > maxBytes) {
          return Promise.reject({ 
            code: 'STORAGE_FULL', 
            message: 'Not enough storage. Need ' + formatBytes(totalBytes) + ' but only ' + formatBytes(maxBytes - stats.totalSize) + ' available.',
            needed: totalBytes,
            available: maxBytes - stats.totalSize
          });
        }
        
        // Read with progress
        var reader = response.body.getReader();
        var chunks = [];
        
        function readChunk() {
          return reader.read().then(function(result) {
            if (result.done) {
              var blob = new Blob(chunks, { type: 'video/mp4' });
              return { blob: blob, size: blob.size };
            }
            
            chunks.push(result.value);
            receivedBytes += result.value.length;
            
            // Report progress
            if (onProgress && totalBytes > 0) {
              var pct = Math.round((receivedBytes / totalBytes) * 100);
              onProgress(pct);
            } else if (onProgress) {
              // Indeterminate progress
              onProgress(-1);
            }
            
            return readChunk();
          });
        }
        
        return readChunk();
      }).then(function(result) {
        // Save to IndexedDB
        var videoRecord = {
          id: videoId,
          blob: result.blob,
          size: result.size,
          title: metaData.title || 'Untitled',
          thumbnailUrl: metaData.thumbnailUrl || '',
          downloadedAt: Date.now()
        };
        
        return storePut(CONFIG.STORES.videos, videoRecord).then(function() {
          // Also save metadata separately for quick listing
          var metaRecord = {
            id: videoId,
            title: metaData.title || 'Untitled',
            thumbnailUrl: metaData.thumbnailUrl || '',
            createdAt: metaData.createdAt || null,
            country: metaData.country || '',
            genre: metaData.genre || '',
            year: metaData.year || '',
            runtime: metaData.runtime || '',
            downloadedAt: Date.now(),
            size: result.size
          };
          
          return storePut(CONFIG.STORES.metadata, metaRecord).then(function() {
            // Save to Firebase if online
            if (isOnline && typeof database !== 'undefined' && typeof AppState !== 'undefined' && AppState.currentUser) {
              database.ref('users/' + AppState.currentUser.uid + '/downloads/' + videoId).set({
                title: metaData.title || 'Untitled',
                downloadedAt: Date.now(),
                size: result.size
              }).catch(function() { /* silent */ });
            }
            
            // Update storage bar if exists
            if (typeof renderStorageBar === 'function') {
              renderStorageBar();
            }
            
            _notifyListeners('storage', getStorageStats());
            
            if (typeof showToast === 'function') {
              showToast('"' + (metaData.title || 'Video') + '" saved for offline!', 'success');
            }
            
            return videoRecord;
          });
        });
      });
    }).catch(function(err) {
      if (err.code === 'LIMIT_REACHED' || err.code === 'STORAGE_FULL') {
        if (typeof showToast === 'function') {
          showToast(err.message, err.code === 'STORAGE_FULL' ? 'error' : 'warning');
        }
      } else if (err.code !== 'FETCH_FAILED') {
        if (typeof showToast === 'function') {
          showToast('Download failed. Check your connection.', 'error');
        }
      }
      throw err;
    });
  }
  
  /**
   * Get a downloaded video blob
   */
  function getVideoBlob(videoId) {
    return storeGet(CONFIG.STORES.videos, videoId).then(function(record) {
      if (!record || !record.blob) return null;
      return record.blob;
    });
  }
  
  /**
   * Get video metadata (without blob)
   */
  function getVideoMeta(videoId) {
    return storeGet(CONFIG.STORES.metadata, videoId);
  }
  
  /**
   * Get all downloaded video metadata (sorted by date)
   */
  function getAllDownloads() {
    return storeGetAll(CONFIG.STORES.metadata, 'downloadedAt', 'prev');
  }
  
  /**
   * Delete a downloaded video
   */
  function deleteVideo(videoId) {
    return Promise.all([
      storeDelete(CONFIG.STORES.videos, videoId),
      storeDelete(CONFIG.STORES.metadata, videoId)
    ]).then(function() {
      // Also remove from Firebase if online
      if (isOnline && typeof database !== 'undefined' && typeof AppState !== 'undefined' && AppState.currentUser) {
        return database.ref('users/' + AppState.currentUser.uid + '/downloads/' + videoId).remove();
      } else {
        // Queue for sync
        return queueSyncAction('delete_download', { videoId: videoId });
      }
    });
  }
  
  /**
   * Check if a video is downloaded
   */
  function isVideoDownloaded(videoId) {
    return storeGet(CONFIG.STORES.videos, videoId).then(function(r) { return !!r; });
  }
  
  // ============================================
  // FAVOURITES CACHE
  // ============================================
  
  /**
   * Cache favourites for offline access
   */
  function cacheFavourites(videoIds, videoDataList) {
    if (!videoIds || videoIds.length === 0) return Promise.resolve();
    
    var now = Date.now();
    var promises = videoDataList.map(function(video, index) {
      if (!video) return Promise.resolve();
      return storePut(CONFIG.STORES.favourites, {
        id: video._id || videoIds[index],
        title: video.title || 'Untitled',
        thumbnailUrl: video.thumbnailUrl || '',
        createdAt: video.createdAt || null,
        country: video.country || '',
        genre: video.genre || '',
        year: video.year || '',
        views: video.views || 0,
        likes: video.likes || 0,
        cachedAt: now
      });
    });
    
    return Promise.all(promises).catch(function(e) {
      console.warn('[OfflineManager] Cache favourites failed:', e);
    });
  }
  
  /**
   * Get cached favourites
   */
  function getCachedFavourites() {
    return storeGetAll(CONFIG.STORES.favourites, 'cachedAt', 'prev');
  }
  
  /**
   * Clear favourites cache
   */
  function clearFavouritesCache() {
    return storeClear(CONFIG.STORES.favourites);
  }
  
  /**
   * Remove a favourite from cache
   */
  function removeCachedFavourite(videoId) {
    return storeDelete(CONFIG.STORES.favourites, videoId);
  }
  
  // ============================================
  // HISTORY CACHE
  // ============================================
  
  /**
   * Cache history for offline access
   */
  function cacheHistory(entries) {
    if (!entries || entries.length === 0) return Promise.resolve();
    
    var promises = entries.map(function(entry) {
      return storePut(CONFIG.STORES.history, {
        id: entry.id,
        title: entry.title || 'Untitled',
        thumbnailUrl: entry.thumbnailUrl || '',
        createdAt: entry.createdAt || null,
        watchedAt: entry.watchedAt || Date.now()
      });
    });
    
    return Promise.all(promises).catch(function(e) {
      console.warn('[OfflineManager] Cache history failed:', e);
    });
  }
  
  /**
   * Get cached history
   */
  function getCachedHistory() {
    return storeGetAll(CONFIG.STORES.history, 'watchedAt', 'prev');
  }
  
  /**
   * Clear history cache
   */
  function clearHistoryCache() {
    return storeClear(CONFIG.STORES.history);
  }
  
  // ============================================
  // THUMBNAIL CACHE
  // ============================================
  
  /**
   * Cache a thumbnail image
   */
  function cacheThumbnail(url, blob) {
    return storePut(CONFIG.STORES.thumbnails, { url: url, blob: blob, cachedAt: Date.now() });
  }
  
  /**
   * Get a cached thumbnail
   */
  function getCachedThumbnail(url) {
    return storeGet(CONFIG.STORES.thumbnails, url).then(function(record) {
      return record ? record.blob : null;
    });
  }
  
  /**
   * Fetch and cache a thumbnail
   */
  function fetchAndCacheThumbnail(url) {
    if (!url || url.includes('placehold.co')) return Promise.resolve(null);
    
    return getCachedThumbnail(url).then(function(cached) {
      if (cached) return cached;
      
      return fetch(url).then(function(response) {
        if (!response.ok) return null;
        return response.blob();
      }).then(function(blob) {
        if (blob) {
          cacheThumbnail(url, blob).catch(function() {});
        }
        return blob;
      }).catch(function() {
        return null;
      });
    });
  }
  
  // ============================================
  // SYNC QUEUE (Offline Actions)
  // ============================================
  
  /**
   * Queue an action to sync when back online
   */
  function queueSyncAction(type, data) {
    return storePut(CONFIG.STORES.syncQueue, {
      type: type,
      data: data,
      createdAt: Date.now(),
      retries: 0
    });
  }
  
  /**
   * Process the sync queue when online
   */
  function _processSyncQueue() {
    if (syncInProgress || !isOnline) return;
    if (typeof database === 'undefined') return;
    
    syncInProgress = true;
    
    storeGetAll(CONFIG.STORES.syncQueue, 'createdAt', 'asc').then(function(queue) {
      if (queue.length === 0) {
        syncInProgress = false;
        return;
      }
      
      console.log('[OfflineManager] Processing ' + queue.length + ' queued actions');
      
      var chain = Promise.resolve();
      
      queue.forEach(function(item) {
        chain = chain.then(function() {
          return _processSyncItem(item);
        });
      });
      
      return chain.then(function() {
        syncInProgress = false;
        _notifyListeners('sync', { completed: queue.length });
      }).catch(function(err) {
        syncInProgress = false;
        console.error('[OfflineManager] Sync error:', err);
      });
    }).catch(function(err) {
      syncInProgress = false;
      console.error('[OfflineManager] Queue read error:', err);
    });
  }
  
  function _processSyncItem(item) {
    if (!isOnline) return Promise.resolve();
    
    var uid = (typeof AppState !== 'undefined' && AppState.currentUser) ? AppState.currentUser.uid : null;
    if (!uid) return storeDelete(CONFIG.STORES.syncQueue, item.id);
    
    var action;
    
    switch (item.type) {
      case 'remove_favourite':
        action = database.ref('users/' + uid + '/favourites/' + item.data.videoId).remove();
        break;
        
      case 'add_favourite':
        action = database.ref('users/' + uid + '/favourites/' + item.data.videoId).set(Date.now());
        break;
        
      case 'delete_download':
        action = database.ref('users/' + uid + '/downloads/' + item.data.videoId).remove();
        break;
        
      case 'clear_history':
        action = database.ref('users/' + uid + '/history').remove();
        break;
        
      case 'increment_views':
        var path = 'description/' + item.data.videoId;
        action = database.ref(path + '/views').transaction(function(c) { 
          return (c || 0) + 1; 
        });
        break;
        
      case 'toggle_like':
        var likePath = 'description/' + item.data.videoId + '/likes';
        var delta = item.data.add ? 1 : -1;
        action = database.ref(likePath).transaction(function(c) { 
          return Math.max(0, (c || 0) + delta); 
        });
        break;
        
      default:
        console.warn('[OfflineManager] Unknown sync action:', item.type);
        return storeDelete(CONFIG.STORES.syncQueue, item.id);
    }
    
    return action
      .then(function() {
        return storeDelete(CONFIG.STORES.syncQueue, item.id);
      })
      .catch(function(err) {
        // Retry logic
        item.retries = (item.retries || 0) + 1;
        if (item.retries < 3) {
          return storePut(CONFIG.STORES.syncQueue, item);
        } else {
          console.error('[OfflineManager] Sync action failed after 3 retries:', item.type);
          return storeDelete(CONFIG.STORES.syncQueue, item.id);
        }
      });
  }
  
  // ============================================
  // STORAGE STATS
  // ============================================
  
  function getStorageStats() {
    return storeGetAll(CONFIG.STORES.videos).then(function(videos) {
      var totalSize = 0;
      videos.forEach(function(v) { totalSize += (v.size || 0); });
      
      return {
        count: videos.length,
        totalSize: totalSize,
        maxSize: CONFIG.MAX_VIDEO_STORAGE_MB * 1024 * 1024,
        usedPercent: ((totalSize / (CONFIG.MAX_VIDEO_STORAGE_MB * 1024 * 1024)) * 100).toFixed(1)
      };
    });
  }
  
  // ============================================
  // SERVICE WORKER
  // ============================================
  
  function registerServiceWorker() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      console.warn('[OfflineManager] Service Workers not supported');
      return Promise.resolve(false);
    }
    
    return navigator.serviceWorker.register(CONFIG.SW_PATH, { scope: CONFIG.SW_SCOPE })
      .then(function(registration) {
        console.log('[OfflineManager] SW registered:', registration.scope);
        
        // Check for updates periodically
        setInterval(function() {
          registration.update().catch(function() {});
        }, 60 * 60 * 1000); // Every hour
        
        // Handle updates
        registration.addEventListener('updatefound', function() {
          var newWorker = registration.installing;
          newWorker.addEventListener('statechange', function() {
            if (newWorker.state === 'activated') {
              console.log('[OfflineManager] New SW activated');
              if (typeof showToast === 'function') {
                showToast('App updated! Refresh for latest version.', 'info');
              }
            }
          });
        });
        
        return true;
      })
      .catch(function(err) {
        console.warn('[OfflineManager] SW registration failed:', err.message);
        return false;
      });
  }
  
  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
  
  function isCacheExpired(cachedAt) {
    return (Date.now() - cachedAt) > CONFIG.MAX_CACHE_AGE;
  }
  
  // ============================================
  // CLEANUP
  // ============================================
  
  function clearExpiredCache() {
    var promises = [];
    
    // Clear expired favourites
    promises.push(storeGetAll(CONFIG.STORES.favourites).then(function(items) {
      var deletePromises = items.filter(function(item) {
        return isCacheExpired(item.cachedAt);
      }).map(function(item) {
        return storeDelete(CONFIG.STORES.favourites, item.id);
      });
      return Promise.all(deletePromises);
    }));
    
    // Clear expired history
    promises.push(storeGetAll(CONFIG.STORES.history).then(function(items) {
      var deletePromises = items.filter(function(item) {
        return isCacheExpired(item.watchedAt);
      }).map(function(item) {
        return storeDelete(CONFIG.STORES.history, item.id);
      });
      return Promise.all(deletePromises);
    }));
    
    // Clear expired thumbnails (older than 7 days)
    var thumbExpiry = 7 * 24 * 60 * 60 * 1000;
    promises.push(storeGetAll(CONFIG.STORES.thumbnails).then(function(items) {
      var deletePromises = items.filter(function(item) {
        return (Date.now() - item.cachedAt) > thumbExpiry;
      }).map(function(item) {
        return storeDelete(CONFIG.STORES.thumbnails, item.url);
      });
      return Promise.all(deletePromises);
    }));
    
    return Promise.all(promises).catch(function() {});
  }
  
  function clearAllData() {
    return Promise.all([
      storeClear(CONFIG.STORES.videos),
      storeClear(CONFIG.STORES.metadata),
      storeClear(CONFIG.STORES.favourites),
      storeClear(CONFIG.STORES.history),
      storeClear(CONFIG.STORES.syncQueue),
      storeClear(CONFIG.STORES.thumbnails)
    ]);
  }
  
  // ============================================
  // INITIALIZATION
  // ============================================
  
  function init() {
    console.log('[OfflineManager] Initializing...');
    
    return openDB()
      .then(function() {
        console.log('[OfflineManager] Database ready');
        initNetworkListeners();
        
        // Clean expired cache on init
        return clearExpiredCache();
      })
      .then(function() {
        // Register service worker
        return registerServiceWorker();
      })
      .then(function(swRegistered) {
        console.log('[OfflineManager] Initialized. Online:', isOnline, 'SW:', swRegistered);
        return {
          online: isOnline,
          swRegistered: swRegistered
        };
      })
      .catch(function(err) {
        console.error('[OfflineManager] Init failed:', err);
        // Still set up network listeners even if DB fails
        initNetworkListeners();
        return {
          online: isOnline,
          swRegistered: false,
          error: err.message
        };
      });
  }
  
  // Auto-init when DOM ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }
  
  // ============================================
  // PUBLIC API
  // ============================================
  return {
    // State
    isOnline: function() { return isOnline; },
    isReady: function() { return dbReady; },
    
    // Events
    onOnline: function(fn) { listeners.online.push(fn); },
    onOffline: function(fn) { listeners.offline.push(fn); },
    onSync: function(fn) { listeners.sync.push(fn); },
    onStorageChange: function(fn) { listeners.storage.push(fn); },
    
    // Videos
    downloadVideo: downloadVideo,
    getVideoBlob: getVideoBlob,
    getVideoMeta: getVideoMeta,
    getAllDownloads: getAllDownloads,
    deleteVideo: deleteVideo,
    isVideoDownloaded: isVideoDownloaded,
    
    // Favourites
    cacheFavourites: cacheFavourites,
    getCachedFavourites: getCachedFavourites,
    clearFavouritesCache: clearFavouritesCache,
    removeCachedFavourite: removeCachedFavourite,
    
    // History
    cacheHistory: cacheHistory,
    getCachedHistory: getCachedHistory,
    clearHistoryCache: clearHistoryCache,
    
    // Thumbnails
    cacheThumbnail: cacheThumbnail,
    getCachedThumbnail: getCachedThumbnail,
    fetchAndCacheThumbnail: fetchAndCacheThumbnail,
    
    // Sync
    queueSyncAction: queueSyncAction,
    processSyncQueue: _processSyncQueue,
    
    // Storage
    getStorageStats: getStorageStats,
    clearAllData: clearAllData,
    clearExpiredCache: clearExpiredCache,
    
    // Utils
    formatBytes: formatBytes,
    
    // Init
    init: init,
    registerServiceWorker: registerServiceWorker
  };
})();