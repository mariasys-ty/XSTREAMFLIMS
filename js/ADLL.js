/**
 * Account Device Limit Login (ADLL)
 * Limits each account to 2 simultaneous devices
 */

var ADLL = (function() {
  'use strict';

  /* ============================================
     CONFIGURATION
     ============================================ */
  var CONFIG = {
    MAX_DEVICES: 2,
    DEVICE_KEY: 'xstream_device_id',
    SESSION_KEY: 'xstream_session',
    LIMIT_PAGE: 'account-device-limit.html',
    FINGERPRINT_TIMEOUT: 500
  };

  /* ============================================
     STATE
     ============================================ */
  var currentDeviceId = null;
  var currentUserUid = null;

  /* ============================================
     GENERATE DEVICE FINGERPRINT
     ============================================ */
  function generateFingerprint() {
    var components = [];

    // User agent
    components.push(navigator.userAgent);

    // Screen info
    components.push(screen.width + 'x' + screen.height);
    components.push(screen.colorDepth);

    // Timezone
    components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);

    // Language
    components.push(navigator.language);

    // Platform
    components.push(navigator.platform);

    // Hardware concurrency
    components.push(navigator.hardwareConcurrency || 'na');

    // Device memory (if available)
    if (navigator.deviceMemory) {
      components.push(navigator.deviceMemory);
    }

    // Canvas fingerprint (simplified)
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 50;
      var ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('xStream', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('xStream', 4, 17);
      components.push(canvas.toDataURL());
    } catch (e) {
      components.push('no-canvas');
    }

    // Hash the combined string
    var raw = components.join('|||');
    return hashString(raw);
  }

  /* ============================================
     SIMPLE HASH FUNCTION
     ============================================ */
  function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      var char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    // Convert to positive hex string
    var hex = Math.abs(hash).toString(16).toUpperCase();
    while (hex.length < 16) {
      hex = '0' + hex;
    }
    return hex;
  }

  /* ============================================
     GET OR CREATE DEVICE ID
     ============================================ */
  function getDeviceId() {
    if (currentDeviceId) return currentDeviceId;

    var stored = localStorage.getItem(CONFIG.DEVICE_KEY);

    if (stored) {
      // Verify fingerprint still matches
      var parts = stored.split('_');
      if (parts.length === 2) {
        var storedFingerprint = parts[0];
        var storedId = parts[1];
        var currentFingerprint = generateFingerprint();

        if (storedFingerprint === currentFingerprint) {
          currentDeviceId = storedId;
          return currentDeviceId;
        }
      }
    }

    // Generate new device ID
    var fingerprint = generateFingerprint();
    var randomPart = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    var newId = fingerprint + '_' + randomPart;

    localStorage.setItem(CONFIG.DEVICE_KEY, newId);
    currentDeviceId = newId;

    return currentDeviceId;
  }

  /* ============================================
     GET DEVICE INFO
     ============================================ */
  function getDeviceInfo() {
    var ua = navigator.userAgent;
    var browser = 'Unknown Browser';
    var os = 'Unknown OS';

    // Detect browser
    if (ua.indexOf('Firefox') > -1) browser = 'Firefox';
    else if (ua.indexOf('SamsungBrowser') > -1) browser = 'Samsung Browser';
    else if (ua.indexOf('Opera') > -1 || ua.indexOf('OPR') > -1) browser = 'Opera';
    else if (ua.indexOf('Edg') > -1) browser = 'Edge';
    else if (ua.indexOf('Chrome') > -1) browser = 'Chrome';
    else if (ua.indexOf('Safari') > -1) browser = 'Safari';

    // Detect OS
    if (ua.indexOf('Windows') > -1) os = 'Windows';
    else if (ua.indexOf('Mac') > -1) os = 'macOS';
    else if (ua.indexOf('Android') > -1) os = 'Android';
    else if (ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) os = 'iOS';
    else if (ua.indexOf('Linux') > -1) os = 'Linux';

    return {
      id: getDeviceId(),
      name: browser + ' - ' + os,
      browser: browser,
      os: os,
      userAgent: ua,
      fingerprint: getDeviceId().split('_')[0],
      createdAt: Date.now()
    };
  }

  /* ============================================
     CHECK DEVICE LIMIT BEFORE LOGIN
     Called BEFORE Firebase auth completes
     ============================================ */
  function checkBeforeLogin(email) {
    return new Promise(function(resolve, reject) {
      var emailKey = email.replace(/\./g, '_');

      database.ref('users').orderByChild('email').equalTo(email).once('value')
        .then(function(snapshot) {
          if (!snapshot.exists()) {
            // New user, allow login
            resolve({ allowed: true, isNewUser: true });
            return;
          }

          var userData = null;
          var userUid = null;

          snapshot.forEach(function(child) {
            userData = child.val();
            userUid = child.key;
          });

          if (!userData || !userUid) {
            resolve({ allowed: true, isNewUser: false });
            return;
          }

          // Check devices
          database.ref('users/' + userUid + '/devices').once('value')
            .then(function(devicesSnapshot) {
              var devices = devicesSnapshot.val() || {};
              var deviceList = Object.keys(devices);
              var currentDeviceId = getDeviceId();

              // Clean up expired devices (older than 30 days)
              var now = Date.now();
              var thirtyDays = 30 * 24 * 60 * 60 * 1000;
              var toRemove = [];

              for (var i = 0; i < deviceList.length; i++) {
                if (now - devices[deviceList[i]].lastActive > thirtyDays) {
                  toRemove.push(deviceList[i]);
                }
              }

              // Remove expired devices
              if (toRemove.length > 0) {
                var cleanupPromises = toRemove.map(function(key) {
                  return database.ref('users/' + userUid + '/devices/' + key).remove();
                });
                return Promise.all(cleanupPromises).then(function() {
                  // Recount after cleanup
                  return database.ref('users/' + userUid + '/devices').once('value');
                });
              }

              return devicesSnapshot;
            })
            .then(function(cleanSnapshot) {
              var cleanDevices = cleanSnapshot.val() || {};
              var cleanList = Object.keys(cleanDevices);
              var currentDeviceId = getDeviceId();

              // Check if this device is already registered
              var isKnownDevice = cleanDevices.hasOwnProperty(currentDeviceId);

              if (isKnownDevice) {
                // This device is already authorized
                currentUserUid = userUid;
                resolve({ allowed: true, isNewUser: false, isKnownDevice: true, uid: userUid });
                return;
              }

              // Check if under limit
              if (cleanList.length < CONFIG.MAX_DEVICES) {
                currentUserUid = userUid;
                resolve({ allowed: true, isNewUser: false, isKnownDevice: false, uid: userUid });
                return;
              }

              // Limit reached
              currentUserUid = userUid;

              // Store user info for limit page
              var limitData = {
                uid: userUid,
                email: email,
                name: userData.fullName || email,
                currentDeviceId: currentDeviceId,
                currentDeviceInfo: getDeviceInfo(),
                timestamp: Date.now()
              };

              try {
                sessionStorage.setItem('xstream_device_limit', JSON.stringify(limitData));
              } catch (e) {
                console.error('Could not save limit data:', e);
              }

              resolve({ allowed: false, uid: userUid, email: email, name: userData.fullName || email });
            })
            .catch(function(error) {
              console.error('Device check error:', error);
              // On error, allow login (fail open)
              resolve({ allowed: true, isNewUser: false });
            });
        })
        .catch(function(error) {
          console.error('User lookup error:', error);
          // On error, allow login
          resolve({ allowed: true, isNewUser: true });
        });
    });
  }

  /* ============================================
     REGISTER DEVICE AFTER SUCCESSFUL LOGIN
     ============================================ */
  function registerDevice(uid) {
    var deviceInfo = getDeviceInfo();
    deviceInfo.lastActive = Date.now();
    deviceInfo.isCurrent = true;

    // Mark all other devices as not current
    var updates = {};

    return database.ref('users/' + uid + '/devices').once('value')
      .then(function(snapshot) {
        var devices = snapshot.val() || {};
        var keys = Object.keys(devices);

        // Mark others as not current
        for (var i = 0; i < keys.length; i++) {
          if (keys[i] !== deviceInfo.id) {
            updates['users/' + uid + '/devices/' + keys[i] + '/isCurrent'] = false;
          }
        }

        // Add/update current device
        updates['users/' + uid + '/devices/' + deviceInfo.id] = deviceInfo;

        // Update session info
        var sessionData = {
          uid: uid,
          deviceId: deviceInfo.id,
          loggedInAt: Date.now()
        };

        try {
          localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(sessionData));
        } catch (e) {
          console.warn('Could not save session:', e);
        }

        return database.ref().update(updates);
      });
  }

  /* ============================================
     REMOVE DEVICE
     ============================================ */
  function removeDevice(uid, deviceId) {
    return database.ref('users/' + uid + '/devices/' + deviceId).remove();
  }

  /* ============================================
     GET ALL DEVICES FOR A USER
     ============================================ */
  function getDevices(uid) {
    return database.ref('users/' + uid + '/devices')
      .orderByChild('lastActive')
      .once('value')
      .then(function(snapshot) {
        var devices = [];
        var data = snapshot.val() || {};

        var keys = Object.keys(data);
        for (var i = 0; i < keys.length; i++) {
          var device = data[keys[i]];
          device.id = keys[i];
          devices.push(device);
        }

        // Sort by most recent first
        devices.sort(function(a, b) {
          return b.lastActive - a.lastActive;
        });

        return devices;
      });
  }

  /* ============================================
     LOGOUT AND REMOVE CURRENT DEVICE
     ============================================ */
  function logoutAndRemoveDevice(uid) {
    var deviceId = getDeviceId();

    return database.ref('users/' + uid + '/devices/' + deviceId).remove()
      .then(function() {
        localStorage.removeItem(CONFIG.SESSION_KEY);
        return auth.signOut();
      });
  }

  /* ============================================
     CHECK CURRENT SESSION VALIDITY
     Call this on app load to verify session
     ============================================ */
  function validateSession() {
    return new Promise(function(resolve) {
      var sessionStr = localStorage.getItem(CONFIG.SESSION_KEY);

      if (!sessionStr) {
        resolve({ valid: false, reason: 'no_session' });
        return;
      }

      try {
        var session = JSON.parse(sessionStr);

        if (!session.uid || !session.deviceId) {
          resolve({ valid: false, reason: 'invalid_session' });
          return;
        }

        // Check if device still exists in user's devices
        database.ref('users/' + session.uid + '/devices/' + session.deviceId).once('value')
          .then(function(snapshot) {
            if (!snapshot.exists()) {
              // Device was removed (logged out elsewhere)
              localStorage.removeItem(CONFIG.SESSION_KEY);
              auth.signOut();
              resolve({ valid: false, reason: 'device_removed' });
              return;
            }

            // Update last active
            database.ref('users/' + session.uid + '/devices/' + session.deviceId + '/lastActive')
              .set(Date.now());

            resolve({ valid: true, uid: session.uid, deviceId: session.deviceId });
          })
          .catch(function() {
            resolve({ valid: true, uid: session.uid }); // Fail open
          });

      } catch (e) {
        resolve({ valid: false, reason: 'parse_error' });
      }
    });
  }

  /* ============================================
     REDIRECT TO DEVICE LIMIT PAGE
     ============================================ */
  function redirectToLimitPage() {
    window.location.href = CONFIG.LIMIT_PAGE;
  }

  /* ============================================
     GET CURRENT DEVICE ID
     ============================================ */
  function getCurrentDeviceId() {
    return getDeviceId();
  }

  /* ============================================
     FORMAT TIME AGO
     ============================================ */
  function timeAgo(timestamp) {
    var seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'Just now';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ago';
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    if (days < 30) return days + 'd ago';
    return new Date(timestamp).toLocaleDateString();
  }

  /* ============================================
     PUBLIC API
     ============================================ */
  return {
    CONFIG: CONFIG,
    checkBeforeLogin: checkBeforeLogin,
    registerDevice: registerDevice,
    removeDevice: removeDevice,
    getDevices: getDevices,
    logoutAndRemoveDevice: logoutAndRemoveDevice,
    validateSession: validateSession,
    redirectToLimitPage: redirectToLimitPage,
    getCurrentDeviceId: getCurrentDeviceId,
    getDeviceInfo: getDeviceInfo,
    timeAgo: timeAgo
  };

})();