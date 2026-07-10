/* =============================================
   ThreatGuard.js v2.0 (Client-Side Security & Moderation System)
   Features: Risk Scoring, Progressive Punishments, Device Fingerprinting, 
   Geo-Logging, Appeals System, Session Monitoring, and Tamper Detection.
   ============================================= */

const ThreatGuard = {
  // --- FIREBASE CONFIGURATION ---
  firebaseConfig: {
    apiKey: "AIzaSyCvrWHOHXmVmHkl451aQA6XFCWy7xA9jFw",
    authDomain: "xstream-9f21e.firebaseapp.com",
    databaseURL: "https://xstream-9f21e-default-rtdb.firebaseio.com",
    projectId: "xstream-9f21e",
    storageBucket: "xstream-9f21e.firebasestorage.app",
    messagingSenderId: "179015046758",
    appId: "1:179015046758:web:e7da8143826b59b49e7fa7",
    measurementId: "G-RN9E44VEFY"
  },
  db: null,
  userId: null,
  fingerprint: null,
  geoData: null,
  sessionId: null,
  banOverlay: null,
  toastContainer: null,
  appealListenerRef: null,

  // Rate Limiting State
  rateLimits: {
    clicks: { timestamps: [], max: 30, window: 5000, points: 15, category: 'Bot Activity' },
    keys: { timestamps: [], max: 50, window: 5000, points: 15, category: 'Spam' },
    forms: { timestamps: [], max: 5, window: 10000, points: 25, category: 'Spam' },
    navigation: { timestamps: [], max: 15, window: 5000, points: 20, category: 'Automation' }
  },

  // --- INITIALIZATION ---
  init: function() {
    this.setupFirebase();
    if (!this.db) return;

    this.identifyUser();
    this.generateFingerprint();
    this.fetchGeoData(); // Async
    this.setupSessionMonitor();
    this.checkBanStatus();
    this.setupSecurityMonitors();
    this.setupToastContainer();
    this.protectSystem();
    
    console.log('🛡️ ThreatGuard v2.0: Advanced security systems active.');
  },

  // --- 1. CORE SETUP & IDENTIFICATION ---
  setupFirebase: function() {
    try {
      if (typeof firebase === 'undefined') {
        console.error("🛡️ ThreatGuard: Firebase SDK missing!");
        return;
      }
      if (!firebase.apps.length) {
        firebase.initializeApp(this.firebaseConfig);
      }
      this.db = firebase.database();
    } catch (e) {
      console.error("ThreatGuard: Firebase initialization failed.", e);
    }
  },

  identifyUser: function() {
    let id = localStorage.getItem('threatguard_uid');
    if (!id) {
      id = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
      localStorage.setItem('threatguard_uid', id);
    }
    this.userId = id;
    this.updateUserProfile();
  },

  generateFingerprint: function() {
    const nav = navigator;
    const raw = `${nav.userAgent}${screen.width}${screen.height}${screen.colorDepth}${Intl.DateTimeFormat().resolvedOptions().timeZone}${nav.language}${nav.platform}`;
    // Simple DJB2 Hash
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(i);
      hash |= 0; 
    }
    this.fingerprint = 'fp_' + Math.abs(hash).toString(36);
    this.checkBanEvasion();
  },

  updateUserProfile: function() {
    const profileData = {
      userId: this.userId,
      fingerprint: this.fingerprint,
      lastSeen: firebase.database.ServerValue.TIMESTAMP,
      browserInfo: navigator.userAgent,
      deviceInfo: navigator.platform || 'Unknown',
      language: navigator.language,
      screenSize: `${screen.width}x${screen.height}`
    };
    this.db.ref('user_profiles/' + this.userId).update(profileData);
  },

  fetchGeoData: async function() {
    try {
      const response = await fetch('https://ipapi.co/json/');
      this.geoData = await response.json();
      this.db.ref('user_profiles/' + this.userId).update({
        country: this.geoData.country_name || 'Unknown',
        region: this.geoData.region || 'Unknown',
        city: this.geoData.city || 'Unknown'
      });
    } catch (e) {
      this.geoData = { country: 'Unknown', region: 'Unknown', city: 'Unknown' };
    }
  },

  // --- 2. SESSION MONITORING ---
  setupSessionMonitor: function() {
    this.sessionId = 'sess_' + Math.random().toString(36).substr(2, 9);
    const sessionRef = this.db.ref('active_sessions/' + this.sessionId);
    
    sessionRef.set({
      userId: this.userId,
      fingerprint: this.fingerprint,
      startAt: firebase.database.ServerValue.TIMESTAMP,
      lastActivity: firebase.database.ServerValue.TIMESTAMP,
      currentPage: window.location.pathname,
      loginStatus: 'unknown'
    });

    // Update last activity every 30 seconds
    setInterval(() => {
      sessionRef.update({ lastActivity: firebase.database.ServerValue.TIMESTAMP });
    }, 30000);

    // Track page navigation
    let originalPushState = history.pushState;
    history.pushState = function() {
      originalPushState.apply(this, arguments);
      sessionRef.update({ currentPage: window.location.pathname });
    };
    window.addEventListener('popstate', () => {
      sessionRef.update({ currentPage: window.location.pathname });
    });

    // Clean up on leave
    window.addEventListener('beforeunload', () => {
      sessionRef.remove();
    });
  },

  // --- 3. RISK ENGINE & PROGRESSIVE PUNISHMENT ---
  addRiskPoints: function(points, reason, category) {
    this.db.ref('threats/' + this.userId).once('value', (snapshot) => {
      let userData = snapshot.val() || { isBanned: false, riskScore: 0, offenseCount: 0 };
      if (userData.isBanned) return; // Already banned

      const newScore = (userData.riskScore || 0) + points;
      userData.riskScore = newScore;

      // Log the event
      this.logSecurityEvent(reason, category, points);

      // Evaluate Thresholds
      if (newScore >= 150) {
        this.applyProgressiveBan(userData, reason);
      } else if (newScore >= 100) {
        this.showToast('Restricted Mode Active', 'Your actions have triggered security restrictions.', 'warning');
        this.db.ref('threats/' + this.userId).update(userData);
      } else if (newScore >= 50) {
        this.showToast('Security Warning', 'Suspicious activity detected. Please slow down.', 'warning');
        this.db.ref('threats/' + this.userId).update(userData);
      } else {
        this.db.ref('threats/' + this.userId).update(userData);
      }
    });
  },

  applyProgressiveBan: function(userData, reason) {
    const offenseCount = (userData.offenseCount || 0) + 1;
    let durationMs = 0;

    // Progressive Punishment System
    switch (offenseCount) {
      case 1: durationMs = 30 * 60 * 1000; break;      // 30 mins
      case 2: durationMs = 60 * 60 * 1000; break;      // 1 hour
      case 3: durationMs = 12 * 60 * 60 * 1000; break; // 12 hours
      case 4: durationMs = 24 * 60 * 60 * 1000; break; // 24 hours
      default: durationMs = 7 * 24 * 60 * 60 * 1000;   // 7 days
    }

    const expiresAt = Date.now() + durationMs;
    const appealId = 'appeal_' + Math.random().toString(36).substr(2, 9);

    const banData = {
      isBanned: true,
      reason: reason,
      riskScore: userData.riskScore,
      offenseCount: offenseCount,
      expiresAt: expiresAt,
      activeAppealId: appealId,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    this.db.ref('threats/' + this.userId).update(banData);
    this.db.ref('offense_history/' + this.userId + '/' + offenseCount).set({
      reason: reason,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      duration: durationMs
    });

    this.updateSecurityMetrics('activeBans');
    this.applyBanUI(reason, expiresAt, appealId);
  },

  // --- 4. LOGGING & METRICS ---
  logSecurityEvent: function(reason, category, points) {
    const logData = {
      userId: this.userId,
      fingerprint: this.fingerprint,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      threatType: reason,
      category: category || 'Other',
      riskScore: points,
      currentPage: window.location.pathname,
      browserInfo: navigator.userAgent,
      screenSize: `${screen.width}x${screen.height}`,
      language: navigator.language,
      referrer: document.referrer || 'Direct',
      deviceType: /Mobi|Android/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop',
      country: this.geoData ? this.geoData.country_name : 'Fetching...'
    };
    this.db.ref('security_logs').push(logData);
    this.updateSecurityMetrics('totalViolations');
  },

  updateSecurityMetrics: function(metric) {
    const ref = this.db.ref('security_metrics/' + metric);
    ref.transaction((currentCount) => {
      return (currentCount || 0) + 1;
    });
  },

  // --- 5. BAN SYSTEM & APPEALS UI ---
   checkBanStatus: function() {
    if (!this.db) return;
    
    this.db.ref('threats/' + this.userId).on('value', (snapshot) => {
      const data = snapshot.val();
      if (data && data.isBanned) {
        const now = Date.now();
        const expiresAt = data.expiresAt || 0;
        
        if (now < expiresAt) {
          this.applyBanUI(data.reason || 'Security Violation', expiresAt);
        } else {
          // Ban expired, remove from Firebase automatically
          this.db.ref('threats/' + this.userId).remove();
          this.removeBanUI();
        }
      } else {
        // FIX: If the record is deleted (Admin unban) or isBanned is false, 
        // REMOVE THE OVERLAY so the user can access the site again!
        this.removeBanUI();
      }
    });
  },

  applyBanUI: function(reason, expiresAt, appealId) {
    if (document.getElementById('threatguard-overlay')) return; 

    const overlay = document.createElement('div');
    overlay.id = 'threatguard-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0, 0, 0, 0.92); backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px);
      z-index: 9999999; display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: white; font-family: 'Inter', sans-serif; text-align: center; padding: 20px;
      overflow-y: auto;
    `;
    
    overlay.innerHTML = `
      <div style="max-width: 600px; width: 100%;">
        <h1 style="font-size: 3rem; color: #ff4757; margin-bottom: 10px;">🚫 ACCESS DENIED</h1>
        <h2 style="font-size: 1.5rem; font-weight: 400; margin-bottom: 20px;">Malicious Activity Detected</h2>
        <p style="font-size: 1.1rem; margin-bottom: 10px; color: #ccc;">
          Reason: <strong style="color: white;">${reason}</strong>
        </p>
        <p id="threatguard-timer" style="font-size: 1.5rem; margin-bottom: 40px; font-weight: bold; color: #ff4757;"></p>
        
        <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 10px; border: 1px solid #333; text-align: left;">
          <h3 style="color: white; margin-bottom: 15px; text-align: center;">Submit an Appeal</h3>
          <form id="threatguard-appeal-form" style="display: flex; flex-direction: column; gap: 15px;">
            <input type="text" id="tg-appeal-name" placeholder="Full Name" required style="padding: 12px; border-radius: 5px; border: 1px solid #444; background: #222; color: white;">
            <input type="email" id="tg-appeal-email" placeholder="Email Address" required style="padding: 12px; border-radius: 5px; border: 1px solid #444; background: #222; color: white;">
            <textarea id="tg-appeal-reason" placeholder="Reason for Appeal" required rows="3" style="padding: 12px; border-radius: 5px; border: 1px solid #444; background: #222; color: white; resize: vertical;"></textarea>
            <textarea id="tg-appeal-notes" placeholder="Additional Notes (Optional)" rows="2" style="padding: 12px; border-radius: 5px; border: 1px solid #444; background: #222; color: white; resize: vertical;"></textarea>
            <label style="display: flex; align-items: center; gap: 10px; font-size: 0.9rem; color: #ccc;">
              <input type="checkbox" id="tg-appeal-agree" required style="width: 18px; height: 18px;">
              I agree that my appeal will be reviewed.
            </label>
            <button type="submit" style="padding: 12px; background: #ff4757; color: white; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; font-size: 1rem;">
              Submit Appeal
            </button>
          </form>
          <div id="tg-appeal-status" style="margin-top: 20px; text-align: center; display: none; color: #2ecc71; font-weight: bold;"></div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    this.banOverlay = overlay;
    document.body.style.overflow = 'hidden';
    
    this.startBanCountdown(expiresAt);
    this.setupAppealForm(appealId, reason);
    this.listenForAppealDecision(appealId);
  },

  startBanCountdown: function(expiresAt) {
    const timerEl = document.getElementById('threatguard-timer');
    const interval = setInterval(() => {
      if (!document.contains(this.banOverlay)) {
        clearInterval(interval);
        return;
      }
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        clearInterval(interval);
        window.location.reload();
        return;
      }
      const mins = Math.floor((remaining % 3600000) / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      if (timerEl) timerEl.textContent = `${mins}m ${secs}s remaining`;
    }, 1000);
  },

  removeBanUI: function() {
    const overlay = document.getElementById('threatguard-overlay');
    if (overlay) overlay.remove();
    document.body.style.overflow = 'auto';
    if (this.appealListenerRef) this.appealListenerRef.off();
  },

  setupAppealForm: function(appealId, banReason) {
    const form = document.getElementById('threatguard-appeal-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('tg-appeal-name').value;
      const email = document.getElementById('tg-appeal-email').value;
      const reason = document.getElementById('tg-appeal-reason').value;
      const notes = document.getElementById('tg-appeal-notes').value;

      const appealData = {
        appealId: appealId,
        userId: this.userId,
        name: name,
        email: email,
        reason: reason,
        notes: notes,
        banReason: banReason,
        submittedAt: firebase.database.ServerValue.TIMESTAMP,
        status: 'Pending'
      };

      this.db.ref('Submission/' + appealId).set(appealData);
      this.updateSecurityMetrics('appealCount');

      form.style.display = 'none';
      const statusDiv = document.getElementById('tg-appeal-status');
      statusDiv.style.display = 'block';
      statusDiv.style.color = '#f39c12';
      statusDiv.innerText = 'Appeal Submitted! Awaiting admin review...';
      
      this.showToast('Appeal Submitted', 'Your appeal is pending review.', 'info');
    });
  },

  listenForAppealDecision: function(appealId) {
    if (!appealId) return;
    this.appealListenerRef = this.db.ref('Submission/' + appealId);
    this.appealListenerRef.on('value', (snapshot) => {
      const appealData = snapshot.val();
      if (!appealData) return;

      const statusDiv = document.getElementById('tg-appeal-status');
      if (statusDiv && appealData.status !== 'Pending') {
        if (appealData.status === 'Approved') {
          statusDiv.style.color = '#2ecc71';
          statusDiv.innerText = 'Appeal Approved! Restoring access...';
          // Remove ban immediately
          this.db.ref('threats/' + this.userId).update({ isBanned: false, riskScore: 0 });
          this.updateSecurityMetrics('approvedAppeals');
          setTimeout(() => window.location.reload(), 2000);
        } else if (appealData.status === 'Rejected') {
          statusDiv.style.color = '#ff4757';
          statusDiv.innerText = 'Appeal Rejected. You must wait for the ban to expire.';
          this.updateSecurityMetrics('rejectedAppeals');
        }
      }
    });
  },

  // --- 6. SECURITY MONITORS & RATE LIMITING ---
  setupSecurityMonitors: function() {
    // Click Rate Limit
    document.addEventListener('click', () => this.checkRateLimit('clicks', 'Click Spamming'));
    
    // Keyboard Rate Limit & DevTools
    document.addEventListener('keydown', (e) => {
      this.checkRateLimit('keys', 'Keyboard Spamming');
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i'))) {
        e.preventDefault();
        this.addRiskPoints(50, 'Attempted to open Developer Tools', 'Exploitation');
      }
    });

    // Form submission limit
    document.addEventListener('submit', () => this.checkRateLimit('forms', 'Form Spamming'));

    // Right click block
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.addRiskPoints(15, 'Right-Click Inspect Attempt', 'Tampering');
    });

    // Navigation spam (using History API override from session monitor)
    const origPush = history.pushState;
    const self = this;
    history.pushState = function() {
      origPush.apply(this, arguments);
      self.checkRateLimit('navigation', 'Rapid Navigation');
    };
  },

  checkRateLimit: function(type, reason) {
    const config = this.rateLimits[type];
    const now = Date.now();
    config.timestamps.push(now);
    config.timestamps = config.timestamps.filter(t => now - t < config.window);

    if (config.timestamps.length > config.max) {
      this.addRiskPoints(config.points, reason, config.category);
      config.timestamps = []; // Reset to prevent immediate re-triggering
    }
  },

  // Manual Trigger
  reportThreat: function(reason, category, points = 25) {
    this.addRiskPoints(points, reason, category || 'Abuse');
  },

  // --- 7. TAMPER DETECTION & ANTI-EVASION ---
  protectSystem: function() {
    // A. Protect Overlay from removal
    const observer = new MutationObserver((mutations) => {
      if (this.banOverlay && !document.contains(this.banOverlay)) {
        document.body.appendChild(this.banOverlay);
        this.addRiskPoints(100, 'Attempted to remove Security Overlay', 'Tampering');
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // B. Protect ThreatGuard Object
    const self = this;
    function protectProperty(obj, propName) {
      let value = obj[propName];
      Object.defineProperty(obj, propName, {
        get: function() { return value; },
        set: function(newValue) {
          self.addRiskPoints(100, `Attempted to override ThreatGuard.${propName}`, 'Tampering');
          return value; // Deny change
        },
        configurable: false
      });
    }
    protectProperty(this, 'addRiskPoints');
    protectProperty(this, 'applyBanUI');
  },

  checkBanEvasion: function() {
    // Check if fingerprint is associated with an active ban on a different userId
    this.db.ref('user_profiles').orderByChild('fingerprint').equalTo(this.fingerprint).once('value', (snapshot) => {
      const profiles = snapshot.val();
      if (profiles) {
        Object.keys(profiles).forEach(uid => {
          if (uid !== this.userId) {
            // Same device, different user! Check if other user is banned
            this.db.ref('threats/' + uid).once('value', (banSnap) => {
              if (banSnap.val() && banSnap.val().isBanned) {
                this.addRiskPoints(150, 'Ban Evasion Attempt Detected', 'Exploitation');
              }
            });
          }
        });
      }
    });
  },

  // --- 8. UI NOTIFICATIONS ---
  setupToastContainer: function() {
    let container = document.getElementById('threatguard-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'threatguard-toast-container';
      container.style.cssText = `position: fixed; top: 20px; right: 20px; z-index: 9999998; display: flex; flex-direction: column; gap: 10px;`;
      document.body.appendChild(container);
    }
    this.toastContainer = container;
  },

  showToast: function(title, message, type = 'info') {
    if (!this.toastContainer) return;
    const colors = { info: '#3498db', warning: '#f39c12', error: '#e74c3c', success: '#2ecc71' };
    const toast = document.createElement('div');
    toast.style.cssText = `
      background: rgba(20, 20, 20, 0.95); color: white; padding: 15px 20px; border-radius: 8px;
      border-left: 5px solid ${colors[type]}; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      font-family: 'Inter', sans-serif; min-width: 300px; opacity: 0; transition: opacity 0.3s ease;
    `;
    toast.innerHTML = `<strong style="display:block; margin-bottom:5px;">${title}</strong><span style="font-size:0.9rem; color:#ccc;">${message}</span>`;
    
    this.toastContainer.appendChild(toast);
    setTimeout(() => toast.style.opacity = 1, 10);

    setTimeout(() => {
      toast.style.opacity = 0;
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
};

// Initialize ThreatGuard immediately
ThreatGuard.init();