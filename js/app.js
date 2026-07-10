/* =============================================
   Firebase & ImageKit Configuration
   ============================================= */
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: ENV_CONFIG.FIREBASE_API_KEY,
  authDomain: ENV_CONFIG.FIREBASE_AUTH_DOMAIN,
  projectId: ENV_CONFIG.FIREBASE_PROJECT_ID,
  storageBucket: ENV_CONFIG.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: ENV_CONFIG.FIREBASE_MESSAGING_SENDER_ID,
  appId: ENV_CONFIG.FIREBASE_APP_ID,
  measurementId: ENV_CONFIG.FIREBASE_MEASUREMENT_ID
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();
/* =============================================
   MAINTENANCE MODE INTERCEPTOR (REDIRECTS EVERYONE)
   ============================================= */
(function() {
  // Prevent redirect loop if already on the maintenance page
  if (window.location.pathname.includes('maintenance.html')) return;
  
  var maintenanceRef = database.ref('maintenanceMode');
  
  // Safely redirect to maintenance page
  function redirectToMaintenance() {
    try { window.stop(); } catch (e) {}
    window.location.replace('maintenance.html');
  }
  
  // Listen for maintenance mode changes in real-time
  maintenanceRef.on('value', function(snapshot) {
    var mode = snapshot.val();
    var isMaintenanceActive = (mode === true || (mode && mode.isActive === true));
    
    if (isMaintenanceActive) {
      // Redirects EVERYONE immediately
      redirectToMaintenance();
    }
  });
})();


/* Compute SHA-1 hex digest using Web Crypto API (requires HTTPS) */
function computeSHA1(arrayBuffer) {
  if (!crypto || !crypto.subtle) {
    return Promise.reject(new Error('SHA-1 requires HTTPS (crypto.subtle unavailable)'));
  }
  return crypto.subtle.digest('SHA-1', arrayBuffer).then(function(hashBuffer) {
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  });
}

/* Upload a single part for large file multipart upload */
function uploadB2Part(uploadUrl, authToken, partNumber, arrayBuffer, sha1Hash) {
  return new Promise(function(resolve, reject) {
    var xhr = new XMLHttpRequest();
    
    xhr.addEventListener('load', function() {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new Error('Invalid response for part ' + partNumber)); }
      } else {
        reject(new Error('Part ' + partNumber + ' upload failed (HTTP ' + xhr.status + ')'));
      }
    });
    
    xhr.addEventListener('error', function() {
      reject(new Error('Network error on part ' + partNumber));
    });
    
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Authorization', authToken);
    xhr.setRequestHeader('X-Bz-Part-Number', partNumber.toString());
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Bz-Content-Sha1', sha1Hash);
    xhr.send(arrayBuffer);
  });
}

/* OMDb Config (Get your free key at omdbapi.com) */
const OMDB_CONFIG = {
  apiKey: ENV_CONFIG.OMDB_API_KEY,
  apiUrl: ENV_CONFIG.OMDB_API_URL
};

/* =============================================
   State Management
   ============================================= */
const AppState = {
  currentPage: document.body.dataset.page,
  currentUser: null,
  userProfile: null,
  videosCache: [],
  lastLoadedKey: null,
  currentCategory: 'all',
  currentSort: 'recent',
  currentSearch: '',
  likedVideos: [],
  dislikedVideos: [],
  viewedVideos: [],
  favouriteVideos: [],
  itemsPerPage: 8
  
  
};

/* Load persisted state from localStorage */
try {
  AppState.likedVideos = JSON.parse(localStorage.getItem('sv_liked') || '[]');
  AppState.dislikedVideos = JSON.parse(localStorage.getItem('sv_disliked') || '[]');
  AppState.viewedVideos = JSON.parse(localStorage.getItem('sv_viewed') || '[]');
  AppState.favouriteVideos = JSON.parse(localStorage.getItem('sv_favourites') || '[]');
} catch(e) {}

function persistState() {
  try {
    localStorage.setItem('sv_liked', JSON.stringify(AppState.likedVideos));
    localStorage.setItem('sv_disliked', JSON.stringify(AppState.dislikedVideos));
    localStorage.setItem('sv_viewed', JSON.stringify(AppState.viewedVideos));
    localStorage.setItem('sv_favourites', JSON.stringify(AppState.favouriteVideos));
  } catch(e) {}
}

/* =============================================
   Utility Functions
   ============================================= */
function escapeHTML(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function getThumbnailUrl(videoData) {
  if (videoData.thumbnailUrl && videoData.thumbnailUrl.length > 10) {
    return videoData.thumbnailUrl;
  }
  var title = videoData.title || 'Video';
  var hue = (title.charCodeAt(0) * 37 + (title.charCodeAt(1) || 0) * 53) % 360;
  return 'https://placehold.co/640x360/' + hue.toString(16).padStart(3, '0') + '222/ffffff?text=' + encodeURIComponent(title.substring(0, 20));
}

function getVideoUrl(videoData) {
  if (videoData.videoUrl && videoData.videoUrl.length > 5) {
    return videoData.videoUrl;
  }
  return '';
}

/* =============================================
   Toast Notification System
   ============================================= */
function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  if (!container) return;

  var icons = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  var toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML = '<span class="toast-icon">' + (icons[type] || icons.info) + '</span>' +
    '<span class="toast-message">' + message + '</span>' +
    '<button class="toast-close">&times;</button>';

  container.appendChild(toast);
  toast.querySelector('.toast-close').addEventListener('click', function() { removeToast(toast); });
  setTimeout(function() { removeToast(toast); }, 4000);
}

function removeToast(toast) {
  if (toast.classList.contains('removing')) return;
  toast.classList.add('removing');
  setTimeout(function() { toast.remove(); }, 300);
}

/* =============================================
   Navigation Builder
   ============================================= */
function buildNavigation() {
  var nav = document.getElementById('main-nav');
  if (!nav) return;
  
  var page = AppState.currentPage;
  var user = AppState.currentUser;
  var isLoggedIn = !!user;
  
  var links = [
    { href: 'index.html', text: 'Home' },
    { href: 'series.html', text: 'Series' },
    { href: 'translated.html', text: ' Translated ' },
    { href: 'viewall.html', text: ' All Movies' },
    { href: 'live.html', text: 'Live Tv' }
    
  ];
  
  var activeText = 'Home';
  if (page === 'home') activeText = 'Home';
  if (page === 'viewall') activeText = 'All Movies';
  
  var authHTML = '';
  if (isLoggedIn) {
    var initial = (user.displayName || user.email || 'U')[0].toUpperCase();
    var displayName = user.displayName || 'User';
    var displayEmail = user.email || '';
    
    authHTML = '<div class="nav-user" id="nav-user">' +
      '<button class="nav-user-btn" id="nav-user-btn">' +
      '<span class="nav-avatar">' + initial + '</span>' +
      '</button>' +
      '<div class="user-dropdown" id="user-dropdown">' +
      '<div class="dropdown-user-info">' +
      '<div class="dropdown-avatar">' + initial + '</div>' +
      '<div class="dropdown-user-text">' +
      '<span class="dropdown-user-name">' + escapeHTML(displayName) + '</span>' +
      '<span class="dropdown-user-email">' + escapeHTML(displayEmail) + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="dropdown-divider"></div>' +
      '<a href="profile.html" class="dropdown-item" id="dd-dashboard">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' +
      'My Dashboard' +
      '</a>' +
      '<div class="dropdown-divider"></div>' +
      '<button class="dropdown-item danger" id="dd-logout">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
      'Sign Out' +
      '</button>' +
      '</div>' +
      '</div>';
  } else {
    authHTML = '<a href="login.html" class="btn-outline" style="padding:7px 18px; font-size:0.85rem;">login</a>' +
      '<a href="signup.html" class="btn-accent" style="padding:7px 18px; font-size:0.85rem;">Sign Up</a>';
  }
  
  var linksHTML = '';
  for (var i = 0; i < links.length; i++) {
    var l = links[i];
    var activeClass = l.text === activeText ? ' active' : '';
    linksHTML += '<a href="' + l.href + '" class="nav-link' + activeClass + '">' + l.text + '</a>';
  }
  
  nav.innerHTML = '<div class="nav-inner">' +
    '<a href="index.html" class="nav-logo">' +
    '<img src="https://ik.imagekit.io/s95tumxuk/IMG_2611.png?updatedAt=1780340137129" alt="XSTREAM Logo" class="nav-logo-img">' +
    'XSTRΞAM ' +
    '</a>' +
    '<div class="nav-links">' + linksHTML + '</div>' +
    '<div class="nav-actions">' +
    authHTML +
    '<button class="nav-mobile-btn" id="nav-mobile-btn">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>' +
    '</button>' +
    '</div>' +
    '</div>';
  
  /* Mobile menu */
  var overlay = document.getElementById('mobile-overlay');
  var mobileMenu = document.getElementById('mobile-menu');
  if (overlay && mobileMenu) {
    var mobileLinks = '';
    if (isLoggedIn) {
      var mInitial = (user.displayName || user.email || 'U')[0].toUpperCase();
      var mName = user.displayName || 'User';
      mobileLinks = '<div class="mobile-user-card">' +
        '<div class="mobile-user-avatar">' + mInitial + '</div>' +
        '<div class="mobile-user-text">' +
        '<span class="mobile-user-name">' + escapeHTML(mName) + '</span>' +
        '<span class="mobile-user-email">' + escapeHTML(user.email || '') + '</span>' +
        '</div>' +
        '</div>' +
        '<a href="profile.html" class="mobile-link">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>' +
        'My Dashboard</a>' +
        '<div style="height:1px; background:var(--border); margin:8px 0;"></div>' +
        '<a href="#" class="mobile-link mobile-link-danger" id="mobile-logout">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
        'Sign Out</a>';
    } else {
      mobileLinks = '<a href="login.html" class="mobile-link">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>' +
        'Sign In</a>' +
        '<a href="signup.html" class="mobile-link">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>' +
        'Sign Up</a>';
    }
    
    mobileMenu.innerHTML = '<a href="index.html" class="mobile-link' + (page === 'home' ? ' active' : '') + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>' +
      'Home</a>' +
      '<a href="index.html?sort=trending" class="mobile-link">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>' +
      'Trending</a>' +
      '<a href="viewall.html" class="mobile-link">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>' +
      ' All Movies</a>' +
      '<div style="height:1px; background:var(--border); margin:12px 0;"></div>' +
      mobileLinks;
  }
  
  bindNavEvents();
}

function bindNavEvents() {
  /* Scroll effect */
  var handleScroll = function() {
    var nav = document.getElementById('main-nav');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 20);
  };
  window.removeEventListener('scroll', handleScroll);
  window.addEventListener('scroll', handleScroll);
  handleScroll();
  
  /* Mobile menu toggle */
  var mobileBtn = document.getElementById('nav-mobile-btn');
  var overlay = document.getElementById('mobile-overlay');
  var mobileMenu = document.getElementById('mobile-menu');
  var closeMobile = function() {
    if (overlay) overlay.classList.remove('active');
    if (mobileMenu) mobileMenu.classList.remove('active');
  };
  if (mobileBtn) {
    mobileBtn.addEventListener('click', function() {
      if (overlay) overlay.classList.toggle('active');
      if (mobileMenu) mobileMenu.classList.toggle('active');
    });
  }
  if (overlay) overlay.addEventListener('click', closeMobile);
  if (mobileMenu) {
    var mobileLinks = mobileMenu.querySelectorAll('.mobile-link');
    for (var i = 0; i < mobileLinks.length; i++) {
      mobileLinks[i].addEventListener('click', closeMobile);
    }
  }
  
  /* User dropdown toggle */
  var userBtn = document.getElementById('nav-user-btn');
  var userDiv = document.getElementById('nav-user');
  if (userBtn) {
    userBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (userDiv) userDiv.classList.toggle('open');
    });
  }
  document.addEventListener('click', function() {
    if (userDiv) userDiv.classList.remove('open');
  });
  
  /* Logout handler */
  var logoutHandler = function() {
    auth.signOut().then(function() {
      showToast('Signed out successfully', 'success');
      window.location.href = 'index.html';
    });
  };
  
  var ddLogout = document.getElementById('dd-logout');
  if (ddLogout) ddLogout.addEventListener('click', logoutHandler);
  
  var mobileLogout = document.getElementById('mobile-logout');
  if (mobileLogout) {
    mobileLogout.addEventListener('click', function(e) {
      e.preventDefault();
      closeMobile();
      logoutHandler();
    });
  }
  
  /* My Uploads */
  var ddUploads = document.getElementById('dd-uploads');
  if (ddUploads) {
    ddUploads.addEventListener('click', function(e) {
      e.preventDefault();
      if (AppState.currentUser) {
        window.location.href = 'index.html?user=' + AppState.currentUser.uid;
      }
    });
  }
  
  /* ===== Search Bar Toggle & Rate Limiter ===== */
  var searchBtn = document.getElementById('nav-search-btn');
  var searchBar = document.getElementById('nav-search-bar');
  var searchInput = document.getElementById('nav-search-input');
  var searchClose = document.getElementById('nav-search-close');
  var searchResults = document.getElementById('nav-search-results');
  
  function openSearch() {
    if (searchBar) {
      searchBar.classList.add('active');
      setTimeout(function() { if (searchInput) searchInput.focus(); }, 100);
    }
  }
  
  function closeSearch() {
    if (searchBar) searchBar.classList.remove('active');
    if (searchInput) searchInput.value = '';
    if (searchResults) searchResults.style.display = 'none';
    var tbody = document.getElementById('search-results-body');
    if (tbody) tbody.innerHTML = '';
    var noRes = document.getElementById('search-no-results');
    if (noRes) noRes.style.display = 'none';
  }
  
  if (searchBtn) {
    searchBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = searchBar && searchBar.classList.contains('active');
      if (isOpen) { closeSearch(); } else { openSearch(); }
    });
  }
  
  if (searchClose) {
    searchClose.addEventListener('click', function(e) {
      e.stopPropagation();
      closeSearch();
    });
  }
  
  document.addEventListener('click', function(e) {
    if (searchBar && searchBar.classList.contains('active')) {
      if (!searchBar.contains(e.target) && e.target !== searchBtn) {
        closeSearch();
      }
    }
  });
  
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && searchBar && searchBar.classList.contains('active')) {
      closeSearch();
    }
  });
  
  var searchTimeout = null;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      var query = this.value.trim();
      clearTimeout(searchTimeout);
      
      if (query.length < 2) {
        if (searchResults) searchResults.style.display = 'none';
        var tbody = document.getElementById('search-results-body');
        if (tbody) tbody.innerHTML = '';
        var noRes = document.getElementById('search-no-results');
        if (noRes) noRes.style.display = 'none';
        return;
      }
      
      /* Rate Limiter Check */
      if (typeof RateLimiter !== 'undefined' && !RateLimiter.allowSearch()) {
        var rateLoading = document.getElementById('search-loading');
        if (rateLoading) rateLoading.style.display = 'none';
        if (searchResults) searchResults.style.display = 'block';
        var rateNoRes = document.getElementById('search-no-results');
        if (rateNoRes) {
          rateNoRes.textContent = 'Too many searches. Please wait a moment and try again.';
          rateNoRes.style.display = 'block';
        }
        var rateTbody = document.getElementById('search-results-body');
        if (rateTbody) rateTbody.innerHTML = '';
        return;
      }
      
      var loading = document.getElementById('search-loading');
      if (loading) loading.style.display = 'flex';
      if (searchResults) searchResults.style.display = 'block';
      var noRes = document.getElementById('search-no-results');
      if (noRes) noRes.style.display = 'none';
      
      searchTimeout = setTimeout(function() {
        performSearch(query);
      }, 400);
    });
    
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var query = this.value.trim();
        if (query.length >= 2) {
          
          /* Rate Limiter Check for Enter key */
          if (typeof RateLimiter !== 'undefined' && !RateLimiter.allowSearch()) {
            var entLoading = document.getElementById('search-loading');
            if (entLoading) entLoading.style.display = 'none';
            if (searchResults) searchResults.style.display = 'block';
            var entNoRes = document.getElementById('search-no-results');
            if (entNoRes) {
              entNoRes.textContent = 'Too many searches. Please wait a moment and try again.';
              entNoRes.style.display = 'block';
            }
            var entTbody = document.getElementById('search-results-body');
            if (entTbody) entTbody.innerHTML = '';
            return;
          }
          
          clearTimeout(searchTimeout);
          performSearch(query);
        }
      }
    });
  }
}
/* =============================================
   Year Tags Widget
   ============================================= */
function buildYearTags() {
  var container = document.getElementById('year-cloud');
  if (!container) return;
  
  function renderYears(years) {
    if (years.length === 0) {
      container.innerHTML = '<span style="color:var(--text-muted); font-size:0.8rem;">No years found</span>';
      return;
    }
    var html = '';
    for (var i = 0; i < years.length; i++) {
      html += '<a href="viewall.html?year=' + years[i] + '" class="tag">' + years[i] + '</a>';
    }
    container.innerHTML = html;
  }
  
  /* 1. Try Casha instantly */
  try {
    if (typeof Casha !== 'undefined' && Casha.getAllMovies) {
      var movies = Casha.getAllMovies();
      if (movies && movies.length > 0) {
        var yearSet = {};
        for (var i = 0; i < movies.length; i++) {
          var y = movies[i].year;
          if (y && y.toString().length >= 4) yearSet[y] = true;
        }
        var years = Object.keys(yearSet).sort(function(a, b) { return parseInt(b) - parseInt(a); });
        if (years.length > 0) { renderYears(years); return; }
      }
    }
  } catch (e) {}
  
  /* 2. Fallback to Firebase */
  var descPromise = database.ref('description').once('value');
  var transPromise = database.ref('Translated').once('value');
  
  Promise.all([descPromise, transPromise]).then(function(results) {
    var yearSet = {};
    results[0].forEach(function(child) {
      if (child.key === 'Translated') return;
      var y = child.val().year;
      if (y && y.toString().length >= 4) yearSet[y] = true;
    });
    results[1].forEach(function(child) {
      var y = child.val().year;
      if (y && y.toString().length >= 4) yearSet[y] = true;
    });
    var years = Object.keys(yearSet).sort(function(a, b) { return parseInt(b) - parseInt(a); });
    renderYears(years);
  }).catch(function() {
    container.innerHTML = '<span style="color:var(--text-muted); font-size:0.8rem;">Failed to load</span>';
  });
}
/* =============================================
   Footer Builder
   ============================================= */
function buildFooter() {
  var footer = document.getElementById('main-footer');
   if (!footer) return;
   footer.innerHTML = '<div class="footer-inner">' +
        '<div class="footer-grid">' +
        '<div class="footer-brand">' +
        '<a href="index.html" class="nav-logo">' +
        '<img src="https://ik.imagekit.io/s95tumxuk/IMG_2611.png?updatedAt=1780340137129" alt="XSTREAM MOVIES" class="nav-logo-img">' +
         'XSTRΞAM ⫸ MOVIES' +
       '</a>' +
        '<p>Discover exceptional movies and series from every genre, delivered through a seamless streaming experience designed for passionate film enthusiasts worldwide.</p>' +
      '</div>' +
      '<div class="footer-col">' +
        '<h4>Platform</h4>' +
        '<a href="index.html">Home</a>' +
        '<a href="live.html">Live TV</a>' +
        '<a href="translated.html">Translated Movies</a>' +
        '<a href="index.html?sort=trending">Trending</a>' +
        '<a href="viewall.html"> All Movies</a>' +
      '</div>' +
      '<div class="footer-col">' +
        '<h4>Account</h4>' +
        '<a href="login.html">Sign In</a>' +
        '<a href="signup.html">Sign Up</a>' +
        '<a href="helpcenter.html">Help Center</a>' +
        '<a href="contact.html">Contact</a>' +
      '</div>' +
      '<div class="footer-col">' +
        '<h4>Legal</h4>' +
        '<a href="services.html">Terms of Service</a>' +
        '<a href="privacy.html">Privacy Policy</a>' +
        '<a href="cookies.html">Cookie Policy</a>' +
        '<a href="#">DMCA</a>' +
      '</div>' +
    '</div>' +
    '<div class="footer-bottom">' +
      '<span>&copy; ' + new Date().getFullYear() + ' xstream movies. All rights reserved.</span>' +
      '<div class="footer-socials">' +
        '<a href="#" aria-label="Twitter"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>' +
        '<a href="#" aria-label="YouTube"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></a>' +
        '<a href="#" aria-label="GitHub"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 1.32.888-0 0 1-2.83 0 2.83l-.06-.06a2 2 0 0 1 2.83 0l.06-.06A1.65 1.65 0 0 0 1.82-.33 1.65 1.65 0 0 0-1.82-.33l-.06-.06A2 2 0 0 1 2 2 0 2.83 0 2.83l-.06-.06a1.65 1.65 0 0 0 1.82-.33 1.65 1.65 0 0 0-1.82-.33l-.06-.06a2 2 0 0 1 2 2 0 2.83 0 2.83l-.06-.06a1.65 1.65 0 0 0 1.82-.33 1.65 1.65 0 0 0-1.82-.33l-.06-.06a2 2 0 0 1 2 2 0 2.83 0 2.83l-.06-.06A1.65 1.65 0 0 0 1.82-.33 1.65 1.65 0 0 0-1.82-.33l-.06-.06a2 2 0 0 1 2 2 0 2.83 0 2.83l-.06-.06A1.65 1.65 0 0 0 1.82-.33 1.65 1.65 0 0 0-1.82-.33l-.06-.06a2 2 0 0 1 2 2 0 2.83 0 2.83l-.06-.06Z"/></svg></a>' +
      '</div>' +
    '</div>' +
  '</div>';
}

/* =============================================
   Auth State Observer
   ============================================= */
function initAuthState(onReady) {
  auth.onAuthStateChanged(function(user) {
    AppState.currentUser = user;

    /* Check if user is admin */
   AppState.isAdmin = user && user.uid === ENV_CONFIG.ADMIN_UID;
   
    // ✅ View All page gets unlimited items
 if (AppState.currentPage === 'viewall') {
   AppState.itemsPerPage = 99999;
 } else {
   AppState.itemsPerPage = 8;
 }

    var proceed = function() {
      buildNavigation();
      if (typeof onReady === 'function') onReady();
    };

    if (user) {
      database.ref('users/' + user.uid).once('value').then(function(snap) {
        AppState.userProfile = snap.val() || null;
        proceed();
      }).catch(function() {
        AppState.userProfile = null;
        proceed();
      });
    } else {
      AppState.userProfile = null;
      proceed();
    }
  });
}

/* =============================================
   Helper: Format Numbers & Dates
   ============================================= */
function formatNumber(num) {
  if (num === undefined || num === null) return '0';
  num = parseInt(num);
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  var d = new Date(timestamp);
  var now = new Date();
  var diff = now - d;
  var mins = Math.floor(diff / 60000);
  var hours = Math.floor(diff / 3600000);
  var days = Math.floor(diff / 86400000);
  var months = Math.floor(days / 30);
  var years = Math.floor(days / 365);

  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + ' min ago';
  if (hours < 24) return hours + 'h ago';
  if (days < 30) return days + 'd ago';
  if (months < 12) return months + 'mo ago';
  return years + 'y ago';
}

/* =============================================
   OMDb Integration
   ============================================= */
var omdbCache = {};

function fetchOmdbData(title) {
  if (!title || title.length < 2) return Promise.resolve(null);
  var key = title.toLowerCase().trim();
  
  if (omdbCache[key]) {
    return Promise.resolve(omdbCache[key]);
  }
  
  return fetch(OMDB_CONFIG.apiUrl + '?t=' + encodeURIComponent(title) + '&apikey=' + OMDB_CONFIG.apiKey + '&type=movie')
    .then(function(response) { return response.json(); })
    .then(function(data) {
      if (data.Response === 'True') {
        var result = {
          poster: data.Poster !== 'N/A' ? data.Poster : null,
          year: data.Year || '',
          genre: data.Genre || '',
          rated: data.Rated || '',
          imdbRating: data.imdbRating || '',
          runtime: data.Runtime || '',
          director: data.Director || ''
        };
        omdbCache[key] = result;
        return result;
      }
      return null;
    })
    .catch(function() {
      return null;
    });
}
/* =============================================
   Video Card Builder
   ============================================= */
function createVideoCard(videoData, size) {
  var id = videoData._id || '';
  var thumb = getThumbnailUrl(videoData);
  var title = videoData.title || 'Untitled Video';
  var views = formatNumber(videoData.views || 0);
  var likes = formatNumber(videoData.likes || 0);
  var dislikes = formatNumber(videoData.dislikes || 0);
  var country = videoData.country || '';
  var year = videoData.year || '';
  var genre = videoData.genre || '';
  var rated = videoData.rated || '';
  var imdbRating = videoData.imdbRating || '';
  var runtime = videoData.runtime || '';
  var isTranslated = videoData._isTranslated === true;
  var vjName = videoData.vjName || '';
  var safeTitle = escapeHTML(title);
  var isFav = AppState.favouriteVideos.indexOf(id) >= 0;
  
  var card = document.createElement('article');
  card.className = 'video-card';
  card.setAttribute('role', 'link');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', title);
  
  /* Build metadata badges */
  var metaBadges = '';
  if (year) metaBadges += '<span class="card-meta-year">' + escapeHTML(year) + '</span>';
  if (rated && rated !== 'N/A') metaBadges += '<span class="card-meta-rated">' + escapeHTML(rated) + '</span>';
  if (runtime && runtime !== 'N/A') metaBadges += '<span class="card-meta-runtime">' + escapeHTML(runtime) + '</span>';
  if (imdbRating && imdbRating !== 'N/A') metaBadges += '<span class="card-meta-imdb"><svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z"/></svg> ' + escapeHTML(imdbRating) + '</span>';
  if (isTranslated && vjName) {
  var cleanVjName = vjName.replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim();
  metaBadges += '<span class="card-vj-name">' + escapeHTML(cleanVjName) + '</span>';
}
  var metaHTML = metaBadges ? '<div class="card-meta-badges">' + metaBadges + '</div>' : '';
  
  /* Truncate genre if too long */
  var genreDisplay = genre;
  if (genreDisplay.length > 40) genreDisplay = genreDisplay.substring(0, 40) + '...';
  var genreHTML = genre ? '<span class="card-meta-genre">' + escapeHTML(genreDisplay) + '</span>' : '';
  
  var countryHTML = country ? '<span class="video-card-country">' + escapeHTML(country) + '</span>' : '';
  
  /* Translated badge */
  var translatedBadge = isTranslated ?
    '<span class="card-translated-badge">Translated</span>' :
    '<span class="card-translated-badge card-translated-badge--non">Non Translated</span>';
  
  /* Stats row - only country now */
  var statsHTML = countryHTML ? '<div class="video-card-stats">' + countryHTML + '</div>' : '';
  
  card.innerHTML = '<div class="video-card-thumb">' +
    '<img src="' + thumb + '" alt="' + safeTitle + '" loading="lazy" onerror="this.src=\'https://placehold.co/640x360/e63946/ffffff?text=No+Image\'">' +
    '<div class="video-card-overlay">' +
    '<div class="play-btn-overlay"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div>' +
    '<div class="card-actions">' +
    '<button class="card-action-btn fav-btn ' + (isFav ? 'active' : '') + '" data-id="' + id + '" title="Favourite">' +
    '<svg viewBox="0 0 24 24" fill="' + (isFav ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>' +
    '</button>' +
    '<button class="card-action-btn dl-btn" data-url="' + (videoData.videoUrl || '') + '" data-title="' + safeTitle + '" title="Download">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 8 12 3 17 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
    '</button>' +
    '</div>' +
    '</div>' +
    (runtime ? '<span class="video-card-duration">' + escapeHTML(runtime) + '</span>' : '') +
    translatedBadge +
    '</div>' +
    '<div class="video-card-body">' +
    '<h3 class="video-card-title">' + safeTitle + '</h3>' +
    metaHTML +
    genreHTML +
    statsHTML +
    '</div>';
  
  card.addEventListener('click', function() {
    window.location.href = 'video.html?id=' + id;
  });
  card.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') window.location.href = 'video.html?id=' + id;
  });
  
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
    });
  }
  
  var dlBtn = card.querySelector('.dl-btn');
  if (dlBtn) {
    dlBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var url = this.dataset.url;
      if (!url) {
        showToast('Movie not available for download', 'error');
        return;
      }
      handleFileDownload(url, this.dataset.title || 'video');
    });
  }
  
  return card;
}

function createWidgetVideoItem(videoData) {
  var id = videoData._id || '';
  var thumb = getThumbnailUrl(videoData);
  var title = videoData.title || 'Untitled';
  var views = formatNumber(videoData.views || 0);
  
  var item = document.createElement('div');
  item.className = 'widget-video-item';
  item.innerHTML = '<div class="widget-video-thumb"><img src="' + thumb + '" alt="' + escapeHTML(title) + '" onerror="this.src=\'https://placehold.co/100x64/e63946/ffffff?text=No+Image\'"></div>' +
    '<div class="widget-video-info"><h4>' + escapeHTML(title) + '</h4><span>' + views + ' views</span></div>';
  
  item.addEventListener('click', function() {
    window.location.href = 'video.html?id=' + id;
  });
  return item;
}

/* =============================================
   Lazy Loading Images
   ============================================= */
function initLazyLoading() {
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var img = entry.target;
        var src = img.getAttribute('data-src');
        if (src) {
          img.src = src;
          img.onload = function() { img.classList.add('loaded'); };
          img.onerror = function() {
            img.src = 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'640\' height=\'360\'%3E%3Crect fill=\'%231e1e1e\' width=\'640\' height=\'360\'/%3E%3Ctext x=\'50%25\' y=\'50%25\' dominant-baseline=\'middle\' text-anchor=\'middle\' fill=\'%23555\' font-size=\'18\'%3ENo Thumbnail%3C/text%3E%3C/svg%3E';
            img.classList.add('loaded');
          };
          img.removeAttribute('data-src');
        }
        observer.unobserve(img);
      }
    });
  }, { rootMargin: '100px' });

  var lazyImages = document.querySelectorAll('.lazy-img');
  for (var i = 0; i < lazyImages.length; i++) {
    observer.observe(lazyImages[i]);
  }
}

/* =============================================
   Firebase Video Operations
   ============================================= */

/**
 * Resolves the correct Firebase path for a video ID.
 * Checks the URL for &source=translated to determine
 * whether to look under description/Translated or description.
 */
function resolveVideoPath(videoId) {
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('source') === 'translated') {
    return 'Translated/' + videoId;
  }
  return 'description/' + videoId;
}

function fetchVideos(limit, startAfterKey, category, sort, search) {
  // Fetch from BOTH description and description/Translated simultaneously
  var descPromise = database.ref('description').once('value');
  var transPromise = database.ref('Translated').once('value');
  
  return Promise.all([descPromise, transPromise]).then(function(results) {
    var descSnapshot = results[0];
    var transSnapshot = results[1];
    var videos = [];
    var seenIds = {}; // Deduplicate by ID
    
    // Process direct children of description (skip 'Translated' container)
    descSnapshot.forEach(function(child) {
      if (child.key === 'Translated') return; // Skip the container node
      var data = child.val();
      if (!data || typeof data !== 'object' || !data.title) return; // Skip non-video entries
      if (seenIds[child.key]) return;
      data._id = child.key;
      data._isTranslated = false;
      videos.push(data);
      seenIds[child.key] = true;
    });
    
    // Process children of description/Translated
    transSnapshot.forEach(function(child) {
      var data = child.val();
      if (!data || typeof data !== 'object' || !data.title) return;
      if (seenIds[child.key]) return;
      data._id = child.key;
      data._isTranslated = true;
      videos.push(data);
      seenIds[child.key] = true;
    });
    
        // Filter by category — universal word search across all text fields
    if (category && category !== 'all') {
      var catWord = category.toLowerCase().trim();
      // Escape regex special characters (but keep hyphens/slashes for the next step)
      var safeWord = catWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Allow hyphens and slashes to match spaces, hyphens, or slashes in the text
      // e.g., "science-fiction" matches "Science Fiction", "science-fiction", "science/fiction"
      var pattern = safeWord.replace(/[-\/]/g, '[\\s\\-\\/]+');
      // Use flexible boundaries instead of \b (which breaks on hyphens/slashes)
      var catRegex = new RegExp('(?:^|[^a-zA-Z0-9])' + pattern + '(?:$|[^a-zA-Z0-9])', 'i');
      
      videos = videos.filter(function(v) {
        var searchText = [
          v.title, v.description, v.category, v.genre, v.country, v.rated, v.director, v.vjName
        ].join(' ').toLowerCase();
        return catRegex.test(searchText);
      });
    }
    
    // Filter by user
    var urlParams = new URLSearchParams(window.location.search);
    var userFilter = urlParams.get('user');
    if (userFilter) {
      videos = videos.filter(function(v) { return v.userId === userFilter; });
    }
    
    // Filter by search
    if (search && search.trim()) {
      var q = search.toLowerCase();
      videos = videos.filter(function(v) {
        return (v.title || '').toLowerCase().includes(q) ||
          (v.description || '').toLowerCase().includes(q) ||
          (v.country || '').toLowerCase().includes(q);
      });
    }
        // Filter by year
    var yearFilter = urlParams.get('year');
    if (yearFilter) {
      videos = videos.filter(function(v) {
        return (v.year || '').toString() === yearFilter;
      });
    }
    // Sort
    if (sort === 'views') {
      videos.sort(function(a, b) { return (b.views || 0) - (a.views || 0); });
    } else if (sort === 'likes') {
      videos.sort(function(a, b) { return (b.likes || 0) - (a.likes || 0); });
    } else if (sort === 'trending') {
      var now = Date.now();
      videos.sort(function(a, b) {
        var scoreA = (a.views || 0) + (a.likes || 0) * 5 + Math.max(0, 100000 - (now - (a.createdAt || 0))) / 1000;
        var scoreB = (b.views || 0) + (b.likes || 0) * 5 + Math.max(0, 100000 - (now - (b.createdAt || 0))) / 1000;
        return scoreB - scoreA;
      });
    } else {
      videos.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    }
    
    AppState.videosCache = videos;
    
    var startIdx = 0;
    if (startAfterKey) {
      var idx = videos.findIndex(function(v) { return v._id === startAfterKey; });
      if (idx >= 0) startIdx = idx + 1;
    }
    
    var page = videos.slice(startIdx, startIdx + limit);
    var hasMore = startIdx + limit < videos.length;
    var lastKey = page.length > 0 ? page[page.length - 1]._id : null;
    
    return { videos: page, hasMore: hasMore, lastKey: lastKey, total: videos.length };
  });
}

function fetchVideoById(videoId) {
  /* 1. Check Casha Memory Instantly */
  if (typeof Casha !== 'undefined' && Casha.getAllMovies) {
    var allMovies = Casha.getAllMovies();
    for (var i = 0; i < allMovies.length; i++) {
      if (allMovies[i]._id === videoId) {
        return Promise.resolve(allMovies[i]);
      }
    }
  }
  
  /* 2. Fallback to Firebase */
  return database.ref('Translated/' + videoId).once('value').then(function(snap) {
    if (snap.exists()) {
      var data = snap.val();
      data._id = snap.key;
      data._isTranslated = true;
      return data;
    }
    return database.ref('description/' + videoId).once('value').then(function(snap2) {
      if (!snap2.exists()) return null;
      var data = snap2.val();
      data._id = snap2.key;
      data._isTranslated = false;
      return data;
    });
  });
}

function fetchRelatedVideos(currentId, limit) {
  /* 1. Check Casha Memory Instantly */
  if (typeof Casha !== 'undefined' && Casha.getAllMovies) {
    var videos = Casha.getAllMovies().filter(function(v) { return v._id !== currentId; });
    videos.sort(function(a, b) { return (b.views || 0) - (a.views || 0); });
    return Promise.resolve(videos.slice(0, limit));
  }
  
  /* 2. Fallback to Firebase */
  var descPromise = database.ref('description').once('value');
  var transPromise = database.ref('Translated').once('value');
  
  return Promise.all([descPromise, transPromise]).then(function(results) {
    var videos = [];
    var seenIds = {};
    results[0].forEach(function(child) {
      if (child.key === 'Translated') return;
      var data = child.val();
      if (!data || typeof data !== 'object' || !data.title) return;
      if (child.key === currentId) return;
      if (seenIds[child.key]) return;
      data._id = child.key;
      data._isTranslated = false;
      videos.push(data);
      seenIds[child.key] = true;
    });
    results[1].forEach(function(child) {
      var data = child.val();
      if (!data || typeof data !== 'object' || !data.title) return;
      if (child.key === currentId) return;
      if (seenIds[child.key]) return;
      data._id = child.key;
      data._isTranslated = true;
      videos.push(data);
      seenIds[child.key] = true;
    });
    videos.sort(function(a, b) { return (b.views || 0) - (a.views || 0); });
    return videos.slice(0, limit);
  });
}

function incrementViews(videoId) {
  if (AppState.viewedVideos.indexOf(videoId) >= 0) return;
  var path = resolveVideoPath(videoId);
  database.ref(path + '/views').transaction(function(count) {
    return (count || 0) + 1;
  }, function(error, committed, snapshot) {
    if (error) {
      console.error('[Views] Transaction FAILED for path:', path, '—', error.message);
      /* If unauthenticated user can't write, try without auth */
      if (error.code === 'PERMISSION_DENIED') {
        console.warn('[Views] Permission denied. Your Firebase rules may not allow unauthenticated writes to:', path);
      }
    } else if (committed) {
      console.log('[Views] Incremented to:', snapshot.val(), 'for:', videoId);
    } else {
      console.log('[Views] Transaction aborted (value didn\'t change) for:', videoId);
    }
  });
  
  /* Save to user history */
  if (AppState.currentUser) {
    var uid = AppState.currentUser.uid;
    database.ref('users/' + uid + '/history/' + videoId).set(Date.now());
  }
  
  AppState.viewedVideos.push(videoId);
  persistState();
}

function toggleLike(videoId) {
  var path = resolveVideoPath(videoId);
  var idx = AppState.likedVideos.indexOf(videoId);
  var disIdx = AppState.dislikedVideos.indexOf(videoId);
  
  if (idx >= 0) {
    AppState.likedVideos.splice(idx, 1);
    database.ref(path + '/likes').transaction(function(c) { return Math.max(0, (c || 0) - 1); }, function(err) {
      if (err) console.error('[Like] Failed:', err.message);
    });
  } else {
    AppState.likedVideos.push(videoId);
    database.ref(path + '/likes').transaction(function(c) { return (c || 0) + 1; }, function(err) {
      if (err) console.error('[Like] Failed:', err.message);
    });
    if (disIdx >= 0) {
      AppState.dislikedVideos.splice(disIdx, 1);
      database.ref(path + '/dislikes').transaction(function(c) { return Math.max(0, (c || 0) - 1); });
    }
  }
  persistState();
  updateLikeDislikeUI(videoId);
}

function toggleDislike(videoId) {
  var path = resolveVideoPath(videoId);
  var idx = AppState.dislikedVideos.indexOf(videoId);
  var likeIdx = AppState.likedVideos.indexOf(videoId);
  
  if (idx >= 0) {
    AppState.dislikedVideos.splice(idx, 1);
    database.ref(path + '/dislikes').transaction(function(c) { return Math.max(0, (c || 0) - 1); }, function(err) {
      if (err) console.error('[Dislike] Failed:', err.message);
    });
  } else {
    AppState.dislikedVideos.push(videoId);
    database.ref(path + '/dislikes').transaction(function(c) { return (c || 0) + 1; }, function(err) {
      if (err) console.error('[Dislike] Failed:', err.message);
    });
    if (likeIdx >= 0) {
      AppState.likedVideos.splice(likeIdx, 1);
      database.ref(path + '/likes').transaction(function(c) { return Math.max(0, (c || 0) - 1); });
    }
  }
  persistState();
  updateLikeDislikeUI(videoId);
}

function toggleDislike(videoId) {
  var path = resolveVideoPath(videoId);
  var idx = AppState.dislikedVideos.indexOf(videoId);
  var likeIdx = AppState.likedVideos.indexOf(videoId);
  
  if (idx >= 0) {
    AppState.dislikedVideos.splice(idx, 1);
    database.ref(path + '/dislikes').transaction(function(c) { return Math.max(0, (c || 0) - 1); });
  } else {
    AppState.dislikedVideos.push(videoId);
    database.ref(path + '/dislikes').transaction(function(c) { return (c || 0) + 1; });
    if (likeIdx >= 0) {
      AppState.likedVideos.splice(likeIdx, 1);
      database.ref(path + '/likes').transaction(function(c) { return Math.max(0, (c || 0) - 1); });
    }
  }
  persistState();
  updateLikeDislikeUI(videoId);
}

function updateLikeDislikeUI(videoId) {
  var likeBtn = document.getElementById('like-btn');
  var dislikeBtn = document.getElementById('dislike-btn');
  var likeCount = document.getElementById('like-count');
  var dislikeCount = document.getElementById('dislike-count');
  
  if (!likeBtn) return;
  
  var isLiked = AppState.likedVideos.indexOf(videoId) >= 0;
  var isDisliked = AppState.dislikedVideos.indexOf(videoId) >= 0;
  
  likeBtn.classList.toggle('liked', isLiked);
  dislikeBtn.classList.toggle('disliked', isDisliked);
  
  var path = resolveVideoPath(videoId);
  database.ref(path).once('value').then(function(snap) {
    if (!snap.exists()) return;
    var d = snap.val();
    if (likeCount) likeCount.textContent = formatNumber(d.likes || 0);
    if (dislikeCount) dislikeCount.textContent = formatNumber(d.dislikes || 0);
  });
}




/* =============================================
   Download System
   ============================================= */
function handleFileDownload(url, filename) {
  if (!url) {
    showToast('No movie URL available', 'error');
    return;
  }
  var a = document.createElement('a');
  a.href = url;
  a.download = (filename || 'video') + '.mp4';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { document.body.removeChild(a); }, 100);
}

/* =============================================
   Offline Storage System (IndexedDB)
   ============================================= */
var OfflineDB = (function() {
  var DB_NAME = 'xstream_offline_db';
  var DB_VERSION = 1;
  var STORE_NAME = 'videos';
  var db = null;

  function open() {
    return new Promise(function(resolve, reject) {
      if (db) return resolve(db);
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function(e) {
        var database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = function(e) { db = e.target.result; resolve(db); };
      request.onerror = function(e) { reject(e.target.error); };
    });
  }

  function saveVideo(id, blob, title) {
    return open().then(function(database) {
      return new Promise(function(resolve, reject) {
        var tx = database.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        store.put({ id: id, blob: blob, title: title, size: blob.size, timestamp: Date.now() });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function(e) { reject(e.target.error); };
      });
    });
  }

  function getVideo(id) {
    return open().then(function(database) {
      return new Promise(function(resolve, reject) {
        var tx = database.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var request = store.get(id);
        request.onsuccess = function() { resolve(request.result || null); };
        request.onerror = function(e) { reject(e.target.error); };
      });
    });
  }

  function deleteVideo(id) {
    return open().then(function(database) {
      return new Promise(function(resolve, reject) {
        var tx = database.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function(e) { reject(e.target.error); };
      });
    });
  }

  function getAll() {
    return open().then(function(database) {
      return new Promise(function(resolve, reject) {
        var tx = database.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var request = store.getAll();
        request.onsuccess = function() { resolve(request.result || []); };
        request.onerror = function(e) { reject(e.target.error); };
      });
    });
  }

  return { saveVideo: saveVideo, getVideo: getVideo, deleteVideo: deleteVideo, getAll: getAll };
})();

var MAX_DOWNLOADS = 5;
var MAX_STORAGE_BYTES = 1024 * 1024 * 1024; // 1GB Limit

function getOfflineStorageStats() {
  return OfflineDB.getAll().then(function(items) {
    var totalSize = 0;
    items.forEach(function(item) { totalSize += (item.size || 0); });
    return { count: items.length, totalSizeBytes: totalSize };
  });
}

function renderStorageBar() {
  var container = document.getElementById('storage-bar-container');
  if (!container) return;

  getOfflineStorageStats().then(function(stats) {
    var usedMB = (stats.totalSizeBytes / (1024 * 1024)).toFixed(1);
    var maxMB = (MAX_STORAGE_BYTES / (1024 * 1024)).toFixed(0);
    var percent = Math.min((stats.totalSizeBytes / MAX_STORAGE_BYTES) * 100, 100).toFixed(1);
    var isFull = stats.count >= MAX_DOWNLOADS || stats.totalSizeBytes >= MAX_STORAGE_BYTES;
    var barColor = isFull ? 'var(--error)' : percent > 80 ? 'var(--warning)' : 'var(--accent)';

    container.innerHTML = 
      '<div class="storage-info-row">' +
        '<span class="storage-label">Storage: ' + usedMB + ' MB / ' + maxMB + ' MB</span>' +
        '<span class="storage-label">' + stats.count + ' / ' + MAX_DOWNLOADS + ' Movies</span>' +
      '</div>' +
      '<div class="storage-bar-track">' +
        '<div class="storage-bar-fill" style="width:' + percent + '%; background:' + barColor + ';"></div>' +
      '</div>';
  });
}

function downloadForOffline(videoId, videoUrl, title) {
  return getOfflineStorageStats().then(function(stats) {
    if (stats.count >= MAX_DOWNLOADS) {
      showToast('Download limit reached (Max ' + MAX_DOWNLOADS + '). Delete a downloaded movie to download more.', 'warning');
      return Promise.reject('limit');
    }
    
    showToast('Fetching "' + (title || 'Video') + '" for offline viewing...', 'info');
    
    return fetch(videoUrl).then(function(response) {
      if (!response.ok) throw new Error('Network error');
      return response.blob();
    }).then(function(blob) {
      var newTotalSize = stats.totalSizeBytes + blob.size;
      if (newTotalSize > MAX_STORAGE_BYTES) {
        showToast('Storage full! You need ' + ((newTotalSize - MAX_STORAGE_BYTES) / (1024*1024)).toFixed(1) + ' MB more space.', 'error');
        return Promise.reject('storage');
      }
      
      return OfflineDB.saveVideo(videoId, blob, title).then(function() {
        if (AppState.currentUser) {
          database.ref('users/' + AppState.currentUser.uid + '/downloads/' + videoId).set({
            title: title || 'Untitled',
            downloadedAt: Date.now()
          }).catch(function(){});
        }
        showToast('"' + (title || 'Video') + '" saved for offline viewing!', 'success');
        renderStorageBar();
      });
    }).catch(function(err) {
      if (err !== 'limit' && err !== 'storage') showToast('Failed to download.', 'error');
      throw err;
    });
  });
}

/* =============================================
   Profile Data Loaders (With Play Buttons)
   ============================================= */
function loadUserFavourites(uid) {
  var container = document.getElementById('profile-favourites-list');
  if (!container) return Promise.resolve([]);

  return database.ref('users/' + uid + '/favourites').once('value').then(function(snap) {
    var favIds = [];
    snap.forEach(function(child) { favIds.push(child.key); });
    if (favIds.length === 0) {
      container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);padding:10px 0;">No favourites yet.</p>';
      return Promise.resolve([]);
    }

    return Promise.all(favIds.slice(0, 24).map(function(id) { return fetchVideoById(id); })).then(function(results) {
      var html = '';
      results.forEach(function(v) {
        if (!v) return;
        html += '<div class="widget-video-item" style="cursor:pointer;" onclick="window.location.href=\'video.html?id=' + v._id + '\'">' +
          '<div class="widget-video-thumb">' +
            '<img src="' + getThumbnailUrl(v) + '" alt="' + escapeHTML(v.title || 'Untitled') + '" onerror="this.src=\'https://placehold.co/100x64/e63946/fff?text=No+Image\'">' +
            '<div class="widget-play-overlay"><svg viewBox="0 0 24 24" fill="#fff" width="20" height="20"><polygon points="5,3 19,12 5,21"/></svg></div>' +
          '</div>' +
          '<div class="widget-video-info"><h4>' + escapeHTML(v.title || 'Untitled') + '</h4></div>' +
          '<button class="widget-remove-btn" onclick="event.stopPropagation(); window.removeFavourite(\'' + v._id + '\')" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="18" x2="21" y2="18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2v2"/></svg></button>' +
        '</div>';
      });
      container.innerHTML = html;
      return results;
    });
  }).catch(function() {
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">Could not load favourites.</p>';
    return [];
  });
}

function loadUserDownloads(uid) {
  var container = document.getElementById('profile-downloads-list');
  if (!container) return Promise.resolve([]);
  
  var barContainer = document.getElementById('storage-bar-container');
  if (barContainer) renderStorageBar();

  return database.ref('users/' + uid + '/downloads').once('value').then(function(snap) {
    var items = [];
    snap.forEach(function(child) {
      var data = child.val();
      items.push({ id: child.key, title: data.title, date: data.downloadedAt });
    });

    if (items.length === 0) {
      container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);padding:10px 0;">No downloads yet.</p>';
      return Promise.resolve([]);
    }

    items.sort(function(a, b) { return (b.downloadedAt || 0) - (a.downloadedAt || 0); });

    var html = '';
    items.forEach(function(item) {
      html += '<div class="widget-video-item" style="cursor:pointer;" onclick="window.playOffline(\'' + item.id + '\')">' +
        '<div class="widget-video-thumb">' +
          '<img src="https://placehold.co/100x64/1a1a1a/888?text=Offline" alt="Offline Video">' +
          '<div class="widget-play-overlay offline-badge"><svg viewBox="0 0 24 24" fill="#fff" width="20" height="20"><polygon points="5,3 19,12 5,21"/></svg><span>OFFLINE</span></div>' +
        '</div>' +
        '<div class="widget-video-info"><h4>' + escapeHTML(item.title || 'Untitled') + '</h4><span>' + formatDate(item.downloadedAt) + '</span></div>' +
        '<button class="widget-remove-btn" onclick="event.stopPropagation(); window.removeDownload(\'' + item.id + '\')" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2 2v2"/></svg></button>' +
      '</div>';
    });
    container.innerHTML = html;
    return items;
  }).catch(function() {
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">Could not load downloads.</p>';
    return [];
  });
}

function loadUserHistory(uid) {
  var container = document.getElementById('profile-history-list');
  if (!container) return Promise.resolve([]);

  return database.ref('users/' + uid + '/history').once('value').then(function(snap) {
    var entries = [];
    snap.forEach(function(child) {
      entries.push({ id: child.key, timestamp: child.val() });
    });

    if (entries.length === 0) {
      container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);padding:10px 0;">No watch history yet.</p>';
      return Promise.resolve([]);
    }

    entries.sort(function(a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });

    return Promise.all(entries.slice(0, 30).map(function(entry) { return fetchVideoById(entry.id); })).then(function(results) {
      var html = '';
      results.forEach(function(v) {
        if (!v) return;
        html += '<div class="widget-video-item" style="cursor:pointer;" onclick="window.location.href=\'video.html?id=' + v._id + '\'">' +
          '<div class="widget-video-thumb">' +
            '<img src="' + getThumbnailUrl(v) + '" alt="' + escapeHTML(v.title || 'Untitled') + '" onerror="this.src=\'https://placehold.co/100x64/e63946/fff?text=No+Image\'">' +
            '<div class="widget-play-overlay"><svg viewBox="0 0 24 24" fill="#fff" width="20" height="20"><polygon points="5,3 19,12 5,21"/></svg></div>' +
          '</div>' +
          '<div class="widget-video-info"><h4>' + escapeHTML(v.title || 'Untitled') + '</h4><span>' + formatDate(v.createdAt) + '</span></div>' +
        '</div>';
      });
      container.innerHTML = html;
      return results;
    });
  }).catch(function() {
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">Could not load history.</p>';
    return [];
  });
}

/* Global inline click handlers */
window.removeFavourite = function(videoId) {
  toggleFavourite(videoId);
  showToast('Removed from favourites', 'info');
  if (AppState.currentUser) loadUserFavourites(AppState.currentUser.uid);
};

window.removeDownload = function(videoId) {
  OfflineDB.deleteVideo(videoId).then(function() {
    if (AppState.currentUser) {
      database.ref('users/' + AppState.currentUser.uid + '/downloads/' + videoId).remove();
    }
    showToast('Removed from downloads and storage freed', 'info');
    renderStorageBar();
    if (AppState.currentUser) loadUserDownloads(AppState.currentUser.uid);
  }).catch(function() {
    showToast('Failed to remove.', 'error');
  });
};

window.playOffline = function(videoId) {
  showToast('Loading offline video...', 'info');
  OfflineDB.getVideo(videoId).then(function(data) {
    if (!data || !data.blob) {
      showToast('Offline file missing. It may have been cleared by your browser.', 'error');
      return;
    }
    window.location.href = 'video.html?offline=true&id=' + videoId;
  }).catch(function() {
    showToast('Error accessing offline storage.', 'error');
  });
};

/* =============================================
   Homepage: Render Videos
   ============================================= */
/* --- State for trending rotation --- */
var TrendingState = {
  pool: [],
  displayedIds: [],
  timer: null
};

function renderTrendingVideos() {
  var grid = document.getElementById('trending-grid');
  if (!grid) return;
  
  // Fetch a larger pool so we have room to shuffle
  fetchVideos(40, null, 'all', 'trending', '').then(function(result) {
    grid.innerHTML = '';
    
    if (result.videos.length === 0) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><h3>No trending movies yet</h3></div>';
      return;
    }
    
    TrendingState.pool = result.videos;
    
    // Show first 6 random
    var initial = pickTrending(6, []);
    renderTrendingCards(initial, false);
    
    // Start 5-second auto-rotation
    startTrendingRotation();
  }).catch(function(err) {
    console.error('Trending fetch error:', err);
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><h3>Could not load trending videos</h3></div>';
  });
}

function pickTrending(count, excludeIds) {
  var available = TrendingState.pool.filter(function(v) {
    return excludeIds.indexOf(v._id || v.id) === -1;
  });
  if (available.length < count) available = TrendingState.pool.slice();
  var shuffled = available.slice().sort(function() { return Math.random() - 0.5; });
  return shuffled.slice(0, count);
}

function renderTrendingCards(list, animate) {
  var grid = document.getElementById('trending-grid');
  if (!grid) return;
  
  if (animate) grid.classList.add('shuffling');
  
  var apply = function() {
    grid.innerHTML = '';
    list.forEach(function(v) { grid.appendChild(createVideoCard(v)); });
    TrendingState.displayedIds = list.map(function(v) { return v._id || v.id; });
    initLazyLoading();
    requestAnimationFrame(function() { grid.classList.remove('shuffling'); });
  };
  
  if (animate) {
    setTimeout(apply, 420);
  } else {
    apply();
  }
}

function startTrendingRotation() {
  stopTrendingRotation();
  TrendingState.timer = setInterval(function() {
    var picked = pickTrending(6, TrendingState.displayedIds);
    renderTrendingCards(picked, true);
  }, 20000);
}

function stopTrendingRotation() {
  if (TrendingState.timer) {
    clearInterval(TrendingState.timer);
    TrendingState.timer = null;
  }
}

function renderMainVideos(append) {
  var grid = document.getElementById('videos-grid');
  var loadMoreContainer = document.getElementById('load-more-container');
  var noVideos = document.getElementById('no-videos');
  if (!grid) return;

  if (!append) grid.innerHTML = '';

  fetchVideos(AppState.itemsPerPage, append ? AppState.lastLoadedKey : null, AppState.currentCategory, AppState.currentSort, AppState.currentSearch)
    .then(function(result) {
      AppState.lastLoadedKey = result.lastKey;

      if (result.videos.length === 0 && !append) {
        grid.innerHTML = '';
        if (noVideos) noVideos.style.display = 'block';
        if (loadMoreContainer) loadMoreContainer.style.display = 'none';
        return;
      }
      if (noVideos) noVideos.style.display = 'none';

      result.videos.forEach(function(v) { grid.appendChild(createVideoCard(v)); });
      initLazyLoading();

      if (result.hasMore) {
        if (loadMoreContainer) loadMoreContainer.style.display = 'flex';
      } else {
        if (loadMoreContainer) loadMoreContainer.style.display = 'none';
      }
    })
    .catch(function(err) {
      console.error('Videos fetch error:', err);
      if (!append) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><h3>Could not load movies</h3><p>Please check your connection and try again.</p></div>';
      }
    });
}

function renderSidebarPopular() {
  var container = document.getElementById('popular-videos-widget');
  if (!container) return;

  fetchVideos(5, null, 'all', 'views', '').then(function(result) {
    container.innerHTML = '';
    if (result.videos.length === 0) {
      container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">No movies yet.</p>';
      return;
    }
    result.videos.forEach(function(v) { container.appendChild(createWidgetVideoItem(v)); });
    initLazyLoading();
  }).catch(function() {
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">Could not load.</p>';
  });
}

function updateCategoryCounts() {
  var descPromise = database.ref('description').once('value');
  var transPromise = database.ref('Translated').once('value');
  
  Promise.all([descPromise, transPromise]).then(function(results) {
    var descSnapshot = results[0];
    var transSnapshot = results[1];
    var allVideos = [];
    var seenIds = {};
    
    /* From description (skip Translated container) */
    descSnapshot.forEach(function(child) {
      if (child.key === 'Translated') return;
      var data = child.val();
      if (!data || typeof data !== 'object' || !data.title) return;
      if (seenIds[child.key]) return;
      allVideos.push(data);
      seenIds[child.key] = true;
    });
    
    /* From Translated */
    transSnapshot.forEach(function(child) {
      var data = child.val();
      if (!data || typeof data !== 'object' || !data.title) return;
      if (seenIds[child.key]) return;
      allVideos.push(data);
      seenIds[child.key] = true;
    });
    
    var setCount = function(id, count) {
      var el = document.getElementById(id);
      if (el) el.textContent = count;
    };
    
    setCount('count-all', allVideos.length);
    setCount('chip-count-all', allVideos.length);
    
    /* All categories matching the HTML filter dropdown values */
    var categories = [
      'action',
      'adventure',
      'animation',
      'anime',
      'biography',
      'comingofage',
      'comedy',
      'crime',
      'darkcomedy',
      'disaster',
      'documentary',
      'drama',
      'dystopian',
      'family',
      'fantasy',
      'noir',
      'heist',
      'historical',
      'horror',
      'indie',
      'legal',
      'martialarts',
      'mockumentary',
      'mystery',
      'musical',
      'political',
      'postapocalyptic',
      'psychological',
      'religious',
      'romance',
      'scifi',
      'sciencefiction',
      'slasher',
      'shortfilm',
      'spy',
      'sport',
      'supernatural',
      'survival',
      'thriller',
      'war',
      'western'
    ];
    
    categories.forEach(function(cat) {
      var count = allVideos.filter(function(v) {
        return (v.category || '').toLowerCase() === cat;
      }).length;
      setCount('count-' + cat, count);
      setCount('chip-count-' + cat, count);
    });
  }).catch(function(err) {
    console.error('Category count error:', err);
  });
}

function toggleFavourite(videoId) {
  var idx = AppState.favouriteVideos.indexOf(videoId);
  if (idx >= 0) {
    AppState.favouriteVideos.splice(idx, 1);
    database.ref('users/' + AppState.currentUser.uid + '/favourites/' + videoId).remove();
  } else {
    AppState.favouriteVideos.push(videoId);
    database.ref('users/' + AppState.currentUser.uid + '/favourites/' + videoId).set(Date.now());
  }
  persistState();
}

function removeFavourite(videoId) {
  toggleFavourite(videoId);
  showToast('Removed from favourites', 'info');
  if (AppState.currentUser) loadUserFavourites(AppState.currentUser.uid);
}

function removeDownload(videoId) {
  database.ref('users/' + AppState.currentUser.uid + '/downloads/' + videoId).remove();
  showToast('Removed from downloads', 'info');
  if (AppState.currentUser) loadUserDownloads(AppState.currentUser.uid);
}


/* =============================================
   Series Section: Fetch, Render & Auto-Rotate
   ============================================= */

/* --- State for series rotation --- */
var SeriesState = {
  allSeries: [],
  displayedIds: [],
  isPaused: false,
  rotationTimer: null,
  countdownTimer: null,
  secondsLeft: 10
};

/* -------------------------------------------------------
   fetchSeriesFromDB
   Reads all series from the Firebase "Series" node.
   ------------------------------------------------------- */
function fetchSeriesFromDB() {
  return new Promise(function (resolve, reject) {
    /* Use the shared `database` ref from app.js (same as series.js).
       Fall back to firebase.database() if that variable doesn't exist. */
    var dbRef = (typeof database !== 'undefined' && database)
      ? database
      : firebase.database();

    var ref = dbRef.ref('Series').orderByKey();

    ref.once('value').then(function (snapshot) {
      var seriesArr = [];
      snapshot.forEach(function (child) {
        var data = child.val();
        if (!data || !data.title) return;
        data._id = child.key;
        seriesArr.push(data);
      });
      resolve(seriesArr);
    }).catch(reject);
  });
}

/* -------------------------------------------------------
   pickRandomSeries
   Returns `count` unique items whose _id is NOT in
   the exclude list. Falls back to random with repeats
   when not enough unseen items remain.
   ------------------------------------------------------- */
function pickRandomSeries(pool, count, excludeIds) {
  var available = pool.filter(function (s) {
    return excludeIds.indexOf(s._id) === -1;
  });

  if (available.length < count) available = pool.slice();

  var picked = [];
  var shuffled = available.slice().sort(function () { return Math.random() - 0.5; });
  for (var i = 0; i < count && i < shuffled.length; i++) {
    picked.push(shuffled[i]);
  }
  return picked;
}

/* -------------------------------------------------------
   createSeriesCardForHome
   Builds a card identical in look to createVideoCard
   but clicks go to  watch.html?id=XXX&source=series
   so the watch page reads from the "Series" node.
   ------------------------------------------------------- */
function createSeriesCardForHome(s) {
  var id = s._id || '';
  var thumb = (typeof getThumbnailUrl === 'function') ? getThumbnailUrl(s) : (s.thumbnailUrl || s.posterUrl || 'https://placehold.co/640x360/e63946/ffffff?text=No+Image');
  var title = s.title || 'Untitled Series';
  var views = (typeof formatNumber === 'function') ? formatNumber(s.views || 0) : (s.views || 0);
  var genre = s.genre || '';
  var status = s.status || '';
  var totalSeasons = s.totalSeasons || 0;
  var imdbRating = s.imdbRating || '';
  var isFav = (typeof AppState !== 'undefined' && AppState.favouriteVideos)
    ? AppState.favouriteVideos.indexOf(id) >= 0
    : false;

  var esc = (typeof escapeHTML === 'function') ? escapeHTML : function (t) { return t; };

  var card = document.createElement('article');
  card.className = 'video-card';
  card.setAttribute('role', 'link');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', title);
  card.dataset.id = id;

  /* Status badge */
  var statusBadge = '';
  if (status) {
    var cls = status.toLowerCase() === 'ongoing' ? 'ongoing' : 'completed';
    statusBadge = '<span class="status-badge ' + cls + '" style="font-size:0.65rem;padding:2px 7px;">' + esc(status) + '</span>';
  }

  /* Season count */
  var seasonBadge = totalSeasons > 0
    ? '<span style="font-size:0.7rem;color:var(--text-muted);">' + totalSeasons + 'S</span>'
    : '';

  /* IMDB rating */
  var ratingBadge = '';
  if (imdbRating && imdbRating !== 'N/A') {
    ratingBadge = '<span class="card-meta-imdb" style="font-size:0.7rem;">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01z"/></svg> ' +
      esc(imdbRating) + '</span>';
  }

  /* Genre tag */
  var genreBadge = genre
    ? '<span style="font-size:0.7rem;color:var(--text-secondary);">' + esc(genre) + '</span>'
    : '';

  card.innerHTML =
    '<div class="video-card-thumb">' +
    '<img src="' + thumb + '" alt="' + esc(title) + '" loading="lazy" onerror="this.src=\'https://placehold.co/640x360/e63946/ffffff?text=No+Image\'">' +
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
    '<h3 class="video-card-title">' + esc(title) + '</h3>' +
    '<div class="video-card-stats">' +
    statusBadge + seasonBadge + ratingBadge + genreBadge +
    '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ' + views + '</span>' +
    '</div>' +
    '</div>';

  /* ★ KEY FIX — redirect to series watch page with matching ID ★ */
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
      if (typeof AppState === 'undefined' || !AppState.currentUser) {
        if (typeof showToast === 'function') showToast('Please sign in to add favourites', 'warning');
        return;
      }
      if (typeof toggleFavourite === 'function') toggleFavourite(id);
      this.classList.toggle('active');
      var svg = this.querySelector('svg');
      if (svg) svg.setAttribute('fill', this.classList.contains('active') ? 'currentColor' : 'none');
    });
  }

  return card;
}

/* -------------------------------------------------------
   renderSeriesCards
   Builds cards into #series-grid.
   ★ Now uses createSeriesCardForHome instead of
     createVideoCard so clicks go to the correct page.
   ------------------------------------------------------- */
function renderSeriesCards(seriesList, animate) {
  var grid = document.getElementById('series-grid');
  if (!grid) return;

  if (animate) {
    grid.classList.add('shuffling');
  }

  var applyCards = function () {
    grid.innerHTML = '';

    if (seriesList.length === 0) {
      grid.innerHTML =
        '<div class="empty-state" style="grid-column:1/-1;">' +
        '<h3>No series available yet</h3></div>';
      grid.classList.remove('shuffling');
      return;
    }

    seriesList.forEach(function (s) {
      grid.appendChild(createSeriesCardForHome(s));
    });

    SeriesState.displayedIds = seriesList.map(function (s) { return s._id; });

    if (typeof initLazyLoading === 'function') initLazyLoading();

    requestAnimationFrame(function () {
      grid.classList.remove('shuffling');
    });
  };

  if (animate) {
    setTimeout(applyCards, 420);
  } else {
    applyCards();
  }
}

/* -------------------------------------------------------
   shuffleSeriesNow
   Picks 6 new random series and swaps them in.
   ------------------------------------------------------- */
function shuffleSeriesNow(animate) {
  if (typeof animate === 'undefined') animate = true;
  var picked = pickRandomSeries(SeriesState.allSeries, 6, SeriesState.displayedIds);
  renderSeriesCards(picked, animate);
}

/* -------------------------------------------------------
   Progress bar helpers
   ------------------------------------------------------- */
function startProgressBar() {
  var fill = document.getElementById('series-progress-fill');
  if (!fill) return;
  fill.classList.remove('animating');
  fill.style.width = '0%';
  void fill.offsetWidth;
  fill.classList.add('animating');
}

function resetProgressBar() {
  var fill = document.getElementById('series-progress-fill');
  if (!fill) return;
  fill.classList.remove('animating');
  fill.style.width = '0%';
}

/* -------------------------------------------------------
   Countdown label updater
   ------------------------------------------------------- */
function startCountdown() {
  SeriesState.secondsLeft = 10;
  updateCountdownLabel();
  clearInterval(SeriesState.countdownTimer);
  SeriesState.countdownTimer = setInterval(function () {
    SeriesState.secondsLeft--;
    if (SeriesState.secondsLeft < 0) SeriesState.secondsLeft = 0;
    updateCountdownLabel();
  }, 1000);
}

function stopCountdown() {
  clearInterval(SeriesState.countdownTimer);
  var label = document.getElementById('series-rotation-label');
  if (label) label.textContent = 'Paused';
}

function updateCountdownLabel() {
  var label = document.getElementById('series-rotation-label');
  if (label) label.textContent = 'Shuffles in ' + SeriesState.secondsLeft + 's';
}

/* -------------------------------------------------------
   Rotation loop — fires every 10 seconds
   ------------------------------------------------------- */
function startSeriesRotation() {
  stopSeriesRotation();
  SeriesState.isPaused = false;
  updatePauseButton();

  startProgressBar();
  startCountdown();

  SeriesState.rotationTimer = setInterval(function () {
    if (!SeriesState.isPaused) {
      shuffleSeriesNow(true);
      startProgressBar();
      startCountdown();
    }
  }, 30000);
}

function stopSeriesRotation() {
  clearInterval(SeriesState.rotationTimer);
  clearInterval(SeriesState.countdownTimer);
  SeriesState.rotationTimer = null;
  SeriesState.countdownTimer = null;
  resetProgressBar();
}

function toggleSeriesPause() {
  SeriesState.isPaused = !SeriesState.isPaused;
  updatePauseButton();

  if (SeriesState.isPaused) {
    stopCountdown();
    resetProgressBar();
  } else {
    startProgressBar();
    startCountdown();
  }
}

function updatePauseButton() {
  var btn = document.getElementById('series-pause-btn');
  if (!btn) return;
  var pauseIcon = btn.querySelector('.pause-icon');
  var playIcon = btn.querySelector('.play-icon');
  if (SeriesState.isPaused) {
    if (pauseIcon) pauseIcon.style.display = 'none';
    if (playIcon) playIcon.style.display = 'block';
  } else {
    if (pauseIcon) pauseIcon.style.display = 'block';
    if (playIcon) playIcon.style.display = 'none';
  }
}

/* -------------------------------------------------------
   renderSeriesSection — main entry point
   ------------------------------------------------------- */
function renderSeriesSection() {
  var grid = document.getElementById('series-grid');
  if (!grid) return;

  fetchSeriesFromDB()
    .then(function (allSeries) {
      SeriesState.allSeries = allSeries;

      if (allSeries.length === 0) {
        grid.innerHTML =
          '<div class="empty-state" style="grid-column:1/-1;">' +
          '<h3>No series available yet</h3></div>';
        return;
      }

      var initial = pickRandomSeries(allSeries, 6, []);
      renderSeriesCards(initial, false);
      startSeriesRotation();
    })
    .catch(function (err) {
      console.error('Series fetch error:', err);
      grid.innerHTML =
        '<div class="empty-state" style="grid-column:1/-1;">' +
        '<h3>Could not load series</h3>' +
        '<p>Please check your connection and try again.</p></div>';
    });
}

/* -------------------------------------------------------
   Wire up the pause & shuffle buttons
   ------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', function () {
  var pauseBtn = document.getElementById('series-pause-btn');
  var shuffleBtn = document.getElementById('series-shuffle-btn');

  if (pauseBtn) {
    pauseBtn.addEventListener('click', toggleSeriesPause);
  }

  if (shuffleBtn) {
    shuffleBtn.addEventListener('click', function () {
      shuffleSeriesNow(true);
      if (!SeriesState.isPaused) {
        startProgressBar();
        startCountdown();
      }
    });
  }
});

/* =============================================
   Homepage: Event Bindings
   ============================================= */
function initHomePage() {
  var urlParams = new URLSearchParams(window.location.search);

  AppState.currentSearch = urlParams.get('search') || '';
  var sortParam = urlParams.get('sort');
  if (sortParam === 'trending' || sortParam === 'views' || sortParam === 'likes') {
    AppState.currentSort = sortParam;
  }
  var catParam = urlParams.get('category');
  if (catParam) AppState.currentCategory = catParam;

  var catFilter = document.getElementById('category-filter');
  var sortFilter = document.getElementById('sort-filter');
  if (catFilter) catFilter.value = AppState.currentCategory;
  if (sortFilter) sortFilter.value = AppState.currentSort;

  var heroSearch = document.getElementById('hero-search-input');
  var sidebarSearch = document.getElementById('sidebar-search');
  if (heroSearch && AppState.currentSearch) heroSearch.value = AppState.currentSearch;
  if (sidebarSearch && AppState.currentSearch) sidebarSearch.value = AppState.currentSearch;

  var userFilter = urlParams.get('user');
  var recentTitle = document.getElementById('recent-title');
  if (userFilter && recentTitle) {
    recentTitle.innerHTML = '<svg class="title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> My Uploads';
  }
  
    createHeroParticles();
  initHeroSlider(); /* ← ADD THIS LINE */
  animateCounters();

 

  renderTrendingVideos();
  renderMainVideos(false);
  renderSeriesSection();

  updateCategoryCounts();
  renderSidebarPopular();
  
  

  var heroSearchBtn = document.getElementById('hero-search-btn');
  var doHeroSearch = function() {
    var q = heroSearch ? heroSearch.value.trim() : '';
    var newUrl = q ? 'index.html?search=' + encodeURIComponent(q) : 'index.html';
    window.location.href = newUrl;
  };
  if (heroSearchBtn) heroSearchBtn.addEventListener('click', doHeroSearch);
  if (heroSearch) {
    heroSearch.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doHeroSearch();
    });
  }

  var doSidebarSearch = function() {
    var q = sidebarSearch ? sidebarSearch.value.trim() : '';
    if (q) {
      AppState.currentSearch = q;
      AppState.lastLoadedKey = null;
      renderMainVideos(false);
    }
  };
  if (sidebarSearch) {
    sidebarSearch.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') doSidebarSearch();
    });
  }

  var heroChips = document.getElementById('hero-chips');
  if (heroChips) {
    heroChips.addEventListener('click', function(e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      var allChips = heroChips.querySelectorAll('.chip');
      for (var i = 0; i < allChips.length; i++) allChips[i].classList.remove('active');
      chip.classList.add('active');
      var cat = chip.dataset.category;
      AppState.currentCategory = cat;
      AppState.lastLoadedKey = null;
      if (catFilter) catFilter.value = cat;
      renderMainVideos(false);
    });
  }

  if (catFilter) {
    catFilter.addEventListener('change', function() {
      AppState.currentCategory = catFilter.value;
      AppState.lastLoadedKey = null;
      var sidebarCats = document.querySelectorAll('#sidebar-categories a');
      for (var i = 0; i < sidebarCats.length; i++) {
        sidebarCats[i].classList.toggle('active', sidebarCats[i].dataset.category === AppState.currentCategory);
      }
      renderMainVideos(false);
    });
  }

  if (sortFilter) {
    sortFilter.addEventListener('change', function() {
      AppState.currentSort = sortFilter.value;
      AppState.lastLoadedKey = null;
      renderMainVideos(false);
    });
  }

  var sidebarCategories = document.getElementById('sidebar-categories');
  if (sidebarCategories) {
    sidebarCategories.addEventListener('click', function(e) {
      e.preventDefault();
      var link = e.target.closest('a');
      if (!link) return;
      var allLinks = sidebarCategories.querySelectorAll('a');
      for (var i = 0; i < allLinks.length; i++) allLinks[i].classList.remove('active');
      link.classList.add('active');
      AppState.currentCategory = link.dataset.category;
      AppState.lastLoadedKey = null;
      if (catFilter) catFilter.value = AppState.currentCategory;
      renderMainVideos(false);
    });
  }

  var tagCloud = document.getElementById('tag-cloud');
  if (tagCloud) {
    tagCloud.addEventListener('click', function(e) {
      e.preventDefault();
      var tag = e.target.closest('.tag');
      if (!tag) return;
      var q = tag.textContent.replace('#', '');
      if (heroSearch) heroSearch.value = q;
      AppState.currentSearch = q;
      AppState.lastLoadedKey = null;
      renderMainVideos(false);
    });
  }

  var loadMoreBtn = document.getElementById('load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function() {
      var btn = this;
      btn.style.display = 'none';
      var spinner = document.getElementById('load-more-spinner');
      if (spinner) spinner.style.display = 'block';
      renderMainVideos(true).then(function() {
        btn.style.display = 'inline-flex';
        if (spinner) spinner.style.display = 'none';
      });
    });
  }

  var newsletterBtn = document.getElementById('newsletter-btn');
  if (newsletterBtn) {
    newsletterBtn.addEventListener('click', function() {
      var emailEl = document.getElementById('newsletter-email');
      var email = emailEl ? emailEl.value.trim() : '';
      if (!email || !email.includes('@')) {
        showToast('Please enter a valid email address', 'warning');
        return;
      }
      showToast('Thanks for subscribing!', 'success');
      if (emailEl) emailEl.value = '';
    });
  }

  createHeroParticles();
  animateCounters();
}
  /* More Categories Panel Toggle */
  var moreBtn = document.getElementById('btn-more-categories');
  var morePanel = document.getElementById('more-categories-panel');
  var moreClose = document.getElementById('more-categories-close');
  
  if (moreBtn && morePanel) {
    moreBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      var isOpen = morePanel.classList.contains('open');
      morePanel.classList.toggle('open');
      moreBtn.classList.toggle('active');
      if (!isOpen) {
        /* Close panel when clicking outside */
        setTimeout(function() {
          document.addEventListener('click', closeMorePanel);
        }, 10);
      } else {
        document.removeEventListener('click', closeMorePanel);
      }
    });
    
    if (moreClose) {
      moreClose.addEventListener('click', function(e) {
        e.stopPropagation();
        morePanel.classList.remove('open');
        moreBtn.classList.remove('active');
        document.removeEventListener('click', closeMorePanel);
      });
    }
  }
  
  function closeMorePanel(e) {
    if (morePanel && !morePanel.contains(e.target) && e.target !== moreBtn) {
      morePanel.classList.remove('open');
      moreBtn.classList.remove('active');
      document.removeEventListener('click', closeMorePanel);
    }
  }
/* =============================================
   Hero Particles
   ============================================= */
function createHeroParticles() {
  var container = document.getElementById('hero-particles');
  if (!container) return;
  for (var i = 0; i < 30; i++) {
    var p = document.createElement('div');
    p.className = 'hero-particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.top = (60 + Math.random() * 40) + '%';
    p.style.animationDuration = (4 + Math.random() * 8) + 's';
    p.style.animationDelay = Math.random() * 5 + 's';
    p.style.width = (2 + Math.random() * 3) + 'px';
    p.style.height = p.style.width;
    container.appendChild(p);
  }
}

/* =============================================
   Hero Featured Slider — Background Images
   ============================================= */
var HeroSlider = {
  movies: [],
  currentIndex: 0,
  timer: null,
  interval: 7000,
  isTransitioning: false
};

function fetchHeroSliderMovies() {
  var descPromise = database.ref('description').once('value');
  var transPromise = database.ref('Translated').once('value');

  return Promise.all([descPromise, transPromise]).then(function(results) {
    var movies = [];
    var seenIds = {};

    results[0].forEach(function(child) {
      if (child.key === 'Translated') return;
      var data = child.val();
      if (!data || !data.title) return;
      if (seenIds[child.key]) return;
      if (!data.thumbnailUrl || data.thumbnailUrl.length < 10) return;
      data._id = child.key;
      data._source = 'description';
      movies.push(data);
      seenIds[child.key] = true;
    });

    results[1].forEach(function(child) {
      var data = child.val();
      if (!data || !data.title) return;
      if (seenIds[child.key]) return;
      if (!data.thumbnailUrl || data.thumbnailUrl.length < 10) return;
      data._id = child.key;
      data._source = 'Translated';
      movies.push(data);
      seenIds[child.key] = true;
    });

    for (var i = movies.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = movies[i]; movies[i] = movies[j]; movies[j] = tmp;
    }

    return movies;
  });
}

function buildHeroSlider(movies) {
  var slider = document.getElementById('hero-featured-slider');
  var indicators = document.getElementById('hero-indicators');
  if (!slider) return;

  HeroSlider.movies = movies;
  slider.innerHTML = '';
  if (indicators) indicators.innerHTML = '';

  if (movies.length === 0) return;

  var fragment = document.createDocumentFragment();
  var dotFragment = document.createDocumentFragment();

  movies.forEach(function(movie, index) {
    var slide = document.createElement('div');
    slide.className = 'hero-slide' + (index === 0 ? ' active' : '');
    slide.dataset.index = index;

    var img = document.createElement('img');
    img.src = movie.thumbnailUrl;
    img.alt = movie.title || 'Movie';
    img.loading = index === 0 ? 'eager' : 'lazy';
    img.onerror = function() {
      this.src = 'https://placehold.co/1920x800/0a0a0f/333?text=No+Image';
    };

    slide.appendChild(img);
    fragment.appendChild(slide);

    if (indicators) {
      var dot = document.createElement('button');
      dot.className = 'hero-indicator-dot' + (index === 0 ? ' active' : '');
      dot.dataset.index = index;
      dot.setAttribute('aria-label', 'Go to slide ' + (index + 1));
      dotFragment.appendChild(dot);
    }
  });

  slider.appendChild(fragment);
  if (indicators) indicators.appendChild(dotFragment);

  updateHeroSlideInfo(movies[0]);
}

function updateHeroSlideInfo(movie) {
  var metaEl = document.getElementById('hero-slide-meta');
  var titleEl = document.getElementById('hero-slide-title');
  var watchBtn = document.getElementById('hero-slide-watch-btn');
  var infoEl = document.getElementById('hero-slide-info');

  if (!movie) return;

  var parts = [];
  if (movie.year) parts.push(escapeHTML(movie.year));
  if (movie.genre) {
    var g = movie.genre;
    if (g.length > 20) g = g.substring(0, 20) + '...';
    parts.push(escapeHTML(g));
  }
  if (movie._source === 'Translated' && movie.vjName) {
    parts.push('<span class="meta-vj">' + escapeHTML(movie.vjName.replace('vj-', 'VJ ')) + '</span>');
  }
  if (movie.rated && movie.rated !== 'N/A') parts.push(escapeHTML(movie.rated));

  var metaHTML = '';
  for (var i = 0; i < parts.length; i++) {
    if (i > 0) metaHTML += '<span class="meta-sep">·</span>';
    metaHTML += '<span>' + parts[i] + '</span>';
  }

  if (metaEl) metaEl.innerHTML = metaHTML;
  if (titleEl) titleEl.textContent = movie.title || 'Untitled';

  var source = movie._source === 'Translated' ? '&source=translated' : '';
  if (watchBtn) watchBtn.href = 'video.html?id=' + movie._id + source;

  if (infoEl) {
    infoEl.classList.remove('show');
    void infoEl.offsetWidth;
    infoEl.classList.add('show');
  }
}

function goToHeroSlide(index) {
  if (HeroSlider.isTransitioning) return;
  HeroSlider.isTransitioning = true;

  var slides = document.querySelectorAll('.hero-slide');
  var dots = document.querySelectorAll('.hero-indicator-dot');
  var total = HeroSlider.movies.length;
  if (total === 0) return;

  if (index < 0) index = total - 1;
  if (index >= total) index = 0;

  if (slides[HeroSlider.currentIndex]) slides[HeroSlider.currentIndex].classList.remove('active');
  if (dots[HeroSlider.currentIndex]) dots[HeroSlider.currentIndex].classList.remove('active');

  HeroSlider.currentIndex = index;

  if (slides[index]) slides[index].classList.add('active');
  if (dots[index]) dots[index].classList.add('active');

  updateHeroSlideInfo(HeroSlider.movies[index]);

  setTimeout(function() {
    HeroSlider.isTransitioning = false;
  }, 1200);
}

function nextHeroSlide() {
  goToHeroSlide(HeroSlider.currentIndex + 1);
}

function prevHeroSlide() {
  goToHeroSlide(HeroSlider.currentIndex - 1);
}

function startHeroSliderAuto() {
  stopHeroSliderAuto();
  HeroSlider.timer = setInterval(nextHeroSlide, HeroSlider.interval);
}

function stopHeroSliderAuto() {
  if (HeroSlider.timer) {
    clearInterval(HeroSlider.timer);
    HeroSlider.timer = null;
  }
}

function initHeroSlider() {
  var slider = document.getElementById('hero-featured-slider');
  if (!slider) return;

  fetchHeroSliderMovies().then(function(movies) {
    buildHeroSlider(movies);
    if (movies.length === 0) return;

    startHeroSliderAuto();

    var leftBtn = document.getElementById('hero-arrow-left');
    var rightBtn = document.getElementById('hero-arrow-right');

    if (leftBtn) {
      leftBtn.addEventListener('click', function() {
        stopHeroSliderAuto();
        prevHeroSlide();
        startHeroSliderAuto();
      });
    }

    if (rightBtn) {
      rightBtn.addEventListener('click', function() {
        stopHeroSliderAuto();
        nextHeroSlide();
        startHeroSliderAuto();
      });
    }

    var indicators = document.getElementById('hero-indicators');
    if (indicators) {
      indicators.addEventListener('click', function(e) {
        var dot = e.target.closest('.hero-indicator-dot');
        if (!dot) return;
        var idx = parseInt(dot.dataset.index, 10);
        if (isNaN(idx)) return;
        stopHeroSliderAuto();
        goToHeroSlide(idx);
        startHeroSliderAuto();
      });
    }

    /* Click background image → go to video */
    slider.addEventListener('click', function(e) {
      if (e.target.closest('.hero-arrow') || e.target.closest('.hero-indicators') || e.target.closest('.hero-slide-info') || e.target.closest('.hero-content')) return;
      var movie = HeroSlider.movies[HeroSlider.currentIndex];
      if (!movie) return;
      var source = movie._source === 'Translated' ? '&source=translated' : '';
      window.location.href = 'video.html?id=' + movie._id + source;
    });

    /* Pause on hover */
    var heroSection = slider.closest('.hero');
    if (heroSection) {
      heroSection.addEventListener('mouseenter', stopHeroSliderAuto);
      heroSection.addEventListener('mouseleave', startHeroSliderAuto);
    }

    /* Keyboard */
    document.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowLeft') { stopHeroSliderAuto(); prevHeroSlide(); startHeroSliderAuto(); }
      if (e.key === 'ArrowRight') { stopHeroSliderAuto(); nextHeroSlide(); startHeroSliderAuto(); }
    });

    /* Touch swipe */
    var touchStartX = 0;
    if (heroSection) {
      heroSection.addEventListener('touchstart', function(e) {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });

      heroSection.addEventListener('touchend', function(e) {
        var diff = touchStartX - e.changedTouches[0].screenX;
        if (Math.abs(diff) > 50) {
          stopHeroSliderAuto();
          if (diff > 0) nextHeroSlide(); else prevHeroSlide();
          startHeroSliderAuto();
        }
      }, { passive: true });
    }

  }).catch(function(err) {
    console.error('Hero slider error:', err);
  });
}

/* =============================================
   Stat Counter Animation
   ============================================= */
function animateCounters() {
  var counters = document.querySelectorAll('.stat-number[data-count]');
  for (var i = 0; i < counters.length; i++) {
    (function(el) {
      var target = parseInt(el.dataset.count);
      var duration = 2000;
      var start = performance.now();
      var step = function(now) {
        var elapsed = now - start;
        var progress = Math.min(elapsed / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        var current = Math.floor(eased * target);
        el.textContent = formatNumber(current);
        if (progress < 1) requestAnimationFrame(step);
        else el.textContent = formatNumber(target);
      };
      requestAnimationFrame(step);
    })(counters[i]);
  }
}

/* =============================================
   Login Page (with Device Limit)
   ============================================= */
function initLoginPage() {
  var form = document.getElementById('login-form');
  if (!form) return;
  
  /* Password visibility toggles */
  var toggleBtns = document.querySelectorAll('.toggle-password');
  for (var i = 0; i < toggleBtns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        var targetId = btn.dataset.target;
        var input = document.getElementById(targetId);
        if (!input) return;
        var isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        var eyeOpen = btn.querySelector('.eye-open');
        var eyeClosed = btn.querySelector('.eye-closed');
        if (eyeOpen) eyeOpen.style.display = isPassword ? 'none' : 'block';
        if (eyeClosed) eyeClosed.style.display = isPassword ? 'block' : 'none';
      });
    })(toggleBtns[i]);
  }
  
    // ============================================
    // GOOGLE REDIRECT LOGIN
    // ============================================
    
    // 1. Catch user returning from Google
    firebase.auth().getRedirectResult().then(function(result) {
      if (result.user) {
        var user = result.user;
        var emailKey = user.email.replace(/\./g, '_');
        
        // Ensure user profile exists in DB
        return firebase.database().ref('users/' + emailKey).once('value').then(function(snap) {
          if (!snap.exists()) {
            return firebase.database().ref('users/' + emailKey).set({
              name: user.displayName || 'User',
              email: user.email,
              phone: '',
              country: 'Unknown',
              age: '',
              emailVerified: true,
              createdAt: Date.now()
            });
          }
        }).then(function() {
          showToast('Welcome back!', 'success');
          setTimeout(function() { window.location.href = 'index.html'; }, 1000);
        });
      }
    }).catch(function(err) {
      if (err.code === 'auth/redirect-cancelled-by-user') return;
      console.error('Google Auth Error:', err);
      showToast('Google sign-in failed.', 'error');
    });
    
    // 2. The Button Click
    var googleBtn = document.getElementById('google-login-btn');
    if (googleBtn) {
      googleBtn.addEventListener('click', function() {
        var provider = new firebase.auth.GoogleAuthProvider();
        firebase.auth().signInWithRedirect(provider);
      });
    }
  
  /* Email form submit */
  form.addEventListener('submit', function(e) {
    e.preventDefault();
    clearFormErrors('login');
    
    var email = document.getElementById('login-email').value.trim();
    var password = document.getElementById('login-password').value;
    var remember = document.getElementById('remember-me').checked;
    
    var valid = true;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showFormError('login-email', 'Please enter a valid email address');
      valid = false;
    }
    if (!password || password.length < 6) {
      showFormError('login-password', 'Password must be at least 6 characters');
      valid = false;
    }
    if (!valid) return;
    
    setFormLoading('login', true);
    
    /* Step 1: Check device limit BEFORE Firebase login */
    var deviceCheckPromise;
    if (typeof ADLL !== 'undefined') {
      deviceCheckPromise = ADLL.checkBeforeLogin(email);
    } else {
      deviceCheckPromise = Promise.resolve({ allowed: true });
    }
    
    deviceCheckPromise.then(function(result) {
      /* If device limit reached, redirect */
      if (!result.allowed) {
        try {
          sessionStorage.setItem('xstream_login_credentials', JSON.stringify({
            email: email,
            password: password
          }));
        } catch (e) {}
        setFormLoading('login', false);
        if (typeof ADLL !== 'undefined') {
          ADLL.redirectToLimitPage();
        }
        return null;
      }
      
      /* Step 2: Firebase login */
      var persistence = remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
      return auth.setPersistence(persistence).then(function() {
        return auth.signInWithEmailAndPassword(email, password);
      });
      
    }).then(function(cred) {
      if (!cred) return;
      
      /* Step 3: Ensure profile exists */
      var uid = cred.user.uid;
      var profilePromise = database.ref('users/' + uid).once('value').then(function(snap) {
        if (!snap.exists()) {
          return database.ref('users/' + uid).set({
            fullName: cred.user.displayName || 'User',
            email: cred.user.email || '',
            country: 'Unknown',
            age: '',
            createdAt: Date.now()
          });
        }
      });
      
      /* Step 4: Register this device */
      var devicePromise;
      if (typeof ADLL !== 'undefined') {
        devicePromise = ADLL.registerDevice(uid);
      } else {
        devicePromise = Promise.resolve();
      }
      
      return Promise.all([profilePromise, devicePromise]);
      
    }).then(function() {
      showToast('Welcome back!', 'success');
      setTimeout(function() { window.location.href = 'profile.html'; }, 600);
      
    }).catch(function(err) {
      setFormLoading('login', false);
      showToast(getAuthErrorMessage(err.code), 'error');
    });
  });
}


/* =============================================
   Signup Page (with Email OTP Verification)
   ============================================= */
function initSignupPage() {
  var form = document.getElementById('signup-form');
  if (!form) return;
  
  /* Password visibility toggles */
  var toggleBtns = document.querySelectorAll('.toggle-password');
  for (var i = 0; i < toggleBtns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        var targetId = btn.dataset.target;
        var input = document.getElementById(targetId);
        if (!input) return;
        var isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        var eyeOpen = btn.querySelector('.eye-open');
        var eyeClosed = btn.querySelector('.eye-closed');
        if (eyeOpen) eyeOpen.style.display = isPassword ? 'none' : 'block';
        if (eyeClosed) eyeClosed.style.display = isPassword ? 'block' : 'none';
      });
    })(toggleBtns[i]);
  }
  
/* Password strength meter */
var passwordInput = document.getElementById('signup-password');
if (passwordInput) {
  passwordInput.addEventListener('input', function() {
    var val = passwordInput.value;
    var fill = document.getElementById('strength-fill');
    var text = document.getElementById('strength-text');
    if (!fill || !text) return;
    
    var score = 0;
    if (val.length >= 6) score++;
    if (val.length >= 12) score++;
    if (/[A-Z]/.test(val)) score++;
    if (/[0-9]/.test(val)) score++;
    if (/[^A-Za-z0-9]/.test(val)) score++;
    var levels = [
      { width: '0%', color: 'transparent', label: '' },
      { width: '20%', color: '#e74c3c', label: 'Weak' },
      { width: '40%', color: '#e67e22', label: 'Fair' },
      { width: '60%', color: '#f1c40f', label: 'Good' },
      { width: '80%', color: '#2ecc71', label: 'Strong' },
      { width: '100%', color: '#27ae60', label: 'Excellent' }
    ];
    var level = val.length === 0 ? levels[0] : levels[Math.min(score, 5)];
    fill.style.width = level.width;
    fill.style.background = level.color;
    text.textContent = level.label;
    text.style.color = level.color;
    
    var confirmInput = document.getElementById('signup-confirm-password');
    var confirmError = document.getElementById('signup-confirm-password-error');
    if (confirmInput && confirmError && confirmInput.value.length > 0) {
      if (confirmInput.value === val) {
        confirmError.textContent = '';
        confirmInput.style.borderColor = '';
      }
    }
  });
}
  
  /* Google sign up - REDIRECT METHOD */
  
  // 1. Check if user is returning from Google redirect
  auth.getRedirectResult().then(function(result) {
    if (result.user) {
      var isNewUser = result.additionalUserInfo && result.additionalUserInfo.isNewUser;
      var user = result.user;
      
      if (!user.email) {
        showToast('Could not get email from Google account.', 'error');
        return;
      }
      
      var emailKey = user.email.replace(/\./g, '_');
      
      if (isNewUser) {
        database.ref('users/' + emailKey).once('value').then(function(snap) {
          if (!snap.exists()) {
            return database.ref('users/' + emailKey).set({
              name: user.displayName || 'User',
              email: user.email,
              phone: '',
              country: 'Unknown',
              age: '',
              emailVerified: true,
              createdAt: Date.now()
            });
          }
        }).then(function() {
          showToast('Welcome to xStream!', 'success');
          setTimeout(function() { window.location.href = 'profile.html'; }, 600);
        }).catch(function(error) {
          console.error('Google signup DB error:', error);
          showToast('Failed to save account. Please try again.', 'error');
        });
      } else {
        showToast('Welcome back!', 'success');
        setTimeout(function() { window.location.href = 'profile.html'; }, 600);
      }
    }
  }).catch(function(err) {
    if (err.code === 'auth/redirect-cancelled-by-user') return;
    console.error('Google Auth error:', err);
  });
  
  // 2. The Button Click (Sends user straight to Google)
  var googleBtn = document.getElementById('google-signup-btn');
  if (googleBtn) {
    googleBtn.addEventListener('click', function() {
      var provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithRedirect(provider);
    });
  }
  
/* ============================================
     Form submit — REDIRECT TO OTP VERIFICATION
     ============================================ */
form.addEventListener('submit', function(e) {
  e.preventDefault();
  clearFormErrors('signup');
  
  var name = document.getElementById('signup-name').value.trim();
  var email = document.getElementById('signup-email').value.trim();
  var phone = document.getElementById('signup-phone').value.trim();
  var password = document.getElementById('signup-password').value;
  var confirmPassword = document.getElementById('signup-confirm-password').value;
  var country = document.getElementById('signup-country').value;
  var age = parseInt(document.getElementById('signup-age').value);
  var agreeTerms = document.getElementById('agree-terms').checked;
  
  /* Validation */
  var valid = true;
  if (!name || name.length < 2) {
    showFormError('signup-name', 'Full name must be at least 2 characters');
    valid = false;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFormError('signup-email', 'Please enter a valid email address');
    valid = false;
  }
  if (!phone || !/^\+?[1-9]\d{6,14}$/.test(phone.replace(/[\s\-\(\)]/g, ''))) {
    showFormError('signup-phone', 'Please enter a valid phone number (e.g., +1234567890)');
    valid = false;
  }
  if (!password || password.length < 6) {
    showFormError('signup-password', 'Password must be at least 6 characters');
    valid = false;
  }
  if (password !== confirmPassword) {
    showFormError('signup-confirm-password', 'Passwords do not match');
    valid = false;
  }
  if (!country) {
    showFormError('signup-country', 'Please select your country');
    valid = false;
  }
  if (isNaN(age) || age < 13) {
    showFormError('signup-age', 'You must be at least 13 years old');
    valid = false;
  }
  if (age > 120) {
    showFormError('signup-age', 'Please enter a valid age');
    valid = false;
  }
  if (!agreeTerms) {
    showToast('You must agree to the Terms of Service', 'warning');
    valid = false;
  }
  if (!valid) return;
  
  setFormLoading('signup', true);
  
  /* Normalize phone number for Infobip (remove spaces, dashes, parentheses) */
  var normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');
  if (!normalizedPhone.startsWith('+')) {
    normalizedPhone = '+' + normalizedPhone;
  }
  
  /* Step 1: Check if email already exists in database */
  var emailKey = email.replace(/\./g, '_');
  
  database.ref('users').orderByChild('email').equalTo(email).once('value')
    .then(function(snapshot) {
      if (snapshot.exists()) {
        setFormLoading('signup', false);
        showFormError('signup-email', 'An account with this email already exists');
        return;
      }
      
      /* Step 2: Save signup data to sessionStorage for verification page */
      var signupData = {
        name: name,
        email: email,
        phone: normalizedPhone,
        password: password,
        country: country,
        age: age,
        timestamp: Date.now()
      };
      
      try {
        sessionStorage.setItem('xstream_signup_data', JSON.stringify(signupData));
      } catch (err) {
        setFormLoading('signup', false);
        showToast('Unable to save form data. Please enable cookies.', 'error');
        return;
      }
      
      /* Step 3: Redirect to verification page */
      window.location.href = 'verification.html';
      
    })
    .catch(function(err) {
      setFormLoading('signup', false);
      console.error('Signup pre-check error:', err);
      showToast('Something went wrong. Please try again.', 'error');
    });
});
}



/* =============================================
   B2 Upload — replaces uploadToCloudinary
   Supports: Simple upload (thumbnails) + Large File API (videos 1GB+)
   ============================================= */
function uploadToB2(file, type, progressContainerId, progressFillId, progressTextId) {
  var progressContainer = document.getElementById(progressContainerId);
  var progressFill = document.getElementById(progressFillId);
  var progressText = document.getElementById(progressTextId);
  
  if (progressContainer) progressContainer.style.display = 'flex';
  if (progressFill) progressFill.style.width = '0%';
  if (progressText) progressText.textContent = 'Authorizing...';
  
  var folder = type === 'video' ? 'videos' : 'thumbnails';
  var fileName = folder + '/' + Date.now() + '_' + file.name;
  
  // Videos use Large File API (multipart) for reliability on 1GB+ files
  if (type === 'video') {
    return uploadLargeFileToB2(file, fileName, progressFill, progressText);
  }
  
  // Thumbnails use simple single-request upload
  return uploadSimpleToB2(file, fileName, progressFill, progressText);
}

/* Simple upload — for thumbnails and small files (under 5GB) */
function uploadSimpleToB2(file, fileName, progressFill, progressText) {
  return authorizeB2().then(function(auth) {
    return fetch(auth.apiUrl + '/b2api/v2/b2_get_upload_url', {
      method: 'POST',
      headers: {
        'Authorization': auth.authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ bucketId: B2_CONFIG.bucketId })
    });
  }).then(function(resp) {
    if (!resp.ok) throw new Error('Failed to get B2 upload URL');
    return resp.json();
  }).then(function(uploadInfo) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', function(e) {
        if (e.lengthComputable) {
          var pct = Math.round((e.loaded / e.total) * 100);
          if (progressFill) progressFill.style.width = pct + '%';
          if (progressText) progressText.textContent = pct + '%';
        }
      });
      
      xhr.addEventListener('load', function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var resp = JSON.parse(xhr.responseText);
            var url = b2AuthCache.downloadUrl + '/file/' + B2_CONFIG.bucketName + '/' + resp.fileName;
            resolve(url);
          } catch (e) {
            reject(new Error('Invalid B2 upload response'));
          }
        } else {
          reject(new Error('B2 upload failed (HTTP ' + xhr.status + ')'));
        }
      });
      
      xhr.addEventListener('error', function() {
        reject(new Error('Network error during upload'));
      });
      
      var encodedFileName = encodeURIComponent(fileName).replace(/%2F/g, '/');
      
      xhr.open('POST', uploadInfo.uploadUrl);
      xhr.setRequestHeader('Authorization', uploadInfo.authorizationToken);
      xhr.setRequestHeader('X-Bz-File-Name', encodedFileName);
      xhr.setRequestHeader('Content-Type', file.type || 'b2/x-auto');
      xhr.setRequestHeader('X-Bz-Content-Sha1', 'do_not_verify');
      xhr.send(file);
    });
  });
}

/* Large File Upload — multipart for videos (1GB+ safe, resumable per-part) */
function uploadLargeFileToB2(file, fileName, progressFill, progressText) {
  var fileId = null;
  var partSha1Array = [];
  var uploadedBytes = 0;
  
  return authorizeB2().then(function(auth) {
    // Step 1: Start large file
    return fetch(auth.apiUrl + '/b2api/v2/b2_start_large_file', {
      method: 'POST',
      headers: {
        'Authorization': auth.authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bucketId: B2_CONFIG.bucketId,
        fileName: encodeURIComponent(fileName).replace(/%2F/g, '/'),
        contentType: file.type || 'b2/x-auto'
      })
    });
  }).then(function(resp) {
    if (!resp.ok) {
      throw new Error('Failed to start large file upload');
    }
    return resp.json();
  }).then(function(startData) {
    fileId = startData.fileId;
    
    if (progressText) progressText.textContent = '0%';
    
    // Step 2: Get upload part URL
    return authorizeB2().then(function(auth) {
      return fetch(auth.apiUrl + '/b2api/v2/b2_get_upload_part_url', {
        method: 'POST',
        headers: {
          'Authorization': auth.authorizationToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fileId: fileId })
      });
    });
  }).then(function(resp) {
    if (!resp.ok) throw new Error('Failed to get part upload URL');
    return resp.json();
  }).then(function(partUrlData) {
    // Step 3: Upload parts sequentially
    var totalParts = Math.ceil(file.size / B2_PART_SIZE);
    var sequence = Promise.resolve();
    
    for (var i = 1; i <= totalParts; i++) {
      (function(partNumber) {
        sequence = sequence.then(function() {
          var start = (partNumber - 1) * B2_PART_SIZE;
          var end = Math.min(start + B2_PART_SIZE, file.size);
          var partBlob = file.slice(start, end);
          
          return partBlob.arrayBuffer().then(function(buffer) {
            return computeSHA1(buffer).then(function(sha1) {
              partSha1Array.push(sha1);
              
              return uploadB2Part(
                partUrlData.uploadUrl,
                partUrlData.authorizationToken,
                partNumber,
                buffer,
                sha1
              ).then(function() {
                uploadedBytes += (end - start);
                var pct = Math.round((uploadedBytes / file.size) * 100);
                if (progressFill) progressFill.style.width = pct + '%';
                if (progressText) progressText.textContent = pct + '% (' + partNumber + '/' + totalParts + ' parts)';
              });
            });
          });
        });
      })(i);
    }
    
    return sequence;
  }).then(function() {
    // Step 4: Finish large file
    return authorizeB2().then(function(auth) {
      return fetch(auth.apiUrl + '/b2api/v2/b2_finish_large_file', {
        method: 'POST',
        headers: {
          'Authorization': auth.authorizationToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileId: fileId,
          partSha1Array: partSha1Array
        })
      });
    });
  }).then(function(resp) {
    if (!resp.ok) {
      return resp.text().then(function(text) {
        throw new Error('Failed to finish large file: ' + text);
      });
    }
    var url = b2AuthCache.downloadUrl + '/file/' + B2_CONFIG.bucketName + '/' + encodeURIComponent(fileName).replace(/%2F/g, '/');
    return url;
  }).catch(function(err) {
    // Attempt to cancel the unfinished large file to free B2 storage
    if (fileId) {
      authorizeB2().then(function(auth) {
        fetch(auth.apiUrl + '/b2api/v2/b2_cancel_large_file', {
          method: 'POST',
          headers: {
            'Authorization': auth.authorizationToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fileId: fileId })
        }).catch(function() {});
      }).catch(function() {});
    }
    throw err;
  });
}

/* =============================================
   Video Watch Page
   ============================================= */
function initVideoPage() {
  var urlParams = new URLSearchParams(window.location.search);
  var videoId = urlParams.get('id');
  var isOffline = urlParams.get('offline') === 'true';
  
  if (isOffline) {
    OfflineDB.getVideo(videoId).then(function(data) {
      if (!data || !data.blob) {
        showToast('Offline file not found.', 'error');
        showVideoNotFound();
        return;
      }
      
      var wrapper = document.getElementById('video-player-wrapper');
      var info = document.getElementById('video-info');
      var notFound = document.getElementById('video-not-found');
      
      if (notFound) notFound.style.display = 'none';
      if (wrapper && info) {
        var blobUrl = URL.createObjectURL(data.blob);
        wrapper.innerHTML = '<video controls playsinline src="' + blobUrl + '">Your browser does not support the video tag.</video>';
        
        var videoTitle = document.getElementById('video-title');
        if (videoTitle) videoTitle.textContent = data.title || 'Offline Video';
        
        var videoDescription = document.getElementById('video-description');
        if (videoDescription) videoDescription.textContent = 'You are watching this offline. No internet connection is required.';
        
        var videoMeta = document.querySelector('.video-meta');
        if (videoMeta) videoMeta.style.display = 'none';
        
        info.style.display = 'block';
        document.title = (data.title || 'Offline Video') + ' — Xstream';
      }
    }).catch(function() {
      showVideoNotFound();
    });
    return;
  }
  
  if (!videoId) {
    showVideoNotFound();
    return;
  }
  
  // --- UPDATED: Robust fetch that checks BOTH description and Translated ---
  function fetchVideoFromBothPaths(id) {
    return database.ref('description/' + id).once('value').then(function(snapshot) {
      var data = snapshot.val();
      if (data && data.title) {
        data._id = id;
        data._isTranslated = false;
        return data;
      }
      // If not in regular movies, check Translated
      return database.ref('Translated/' + id).once('value').then(function(transSnap) {
        var transData = transSnap.val();
        if (transData && transData.title) {
          transData._id = id;
          transData._isTranslated = true;
          return transData;
        }
        return null; // Not found in either
      });
    });
  }
  // -----------------------------------------------------------------------
  
  fetchVideoFromBothPaths(videoId).then(function(videoData) {
        if (!videoData) {
          showVideoNotFound();
          return;
        }
        
        renderVideoPlayer(videoData);
        incrementViews(videoId);
        
        // --- ADDED: Thumbnail in Description Box ---
        (function() {
          setTimeout(function() {
            var descBox = document.querySelector('.video-description-box');
            if (descBox && videoData) {
              var thumbUrl = getThumbnailUrl(videoData);
              var thumbHtml = '<div class="desc-thumbnail-wrapper"><img src="' + thumbUrl + '" alt="' + escapeHTML(videoData.title || 'Movie') + ' Thumbnail" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></div>';
              descBox.insertAdjacentHTML('afterbegin', thumbHtml);
            }
          }, 50);
        })();
        
        // Inside renderVideoPlayer(videoData) in video-watch.js, right after the video is set up:

var videoEl = document.querySelector('#video-player-wrapper video');

// 1. Initialize Quality UI & Logic
if (typeof initQuality === 'function') initQuality(videoEl, videoData);

// 2. Handle Resume Popup (Checks DB, shows modal if needed, pauses video behind modal)
if (typeof checkResume === 'function') {
  var currentId = videoData._id || videoData.id;
  videoEl.pause(); // Pause initially to prevent playing behind dialog
  checkResume(currentId).then(function(shouldShow) {
    if (shouldShow) {
      showResumeDialog();
    } else {
      videoEl.play().catch(function(e) { console.log('Autoplay blocked', e); });
    }
  });
}

// 3. Start Continue Watching Tracker (saves every 5s)
if (typeof startContinueTracking === 'function') {
  startContinueTracking(videoData, videoEl);
}
        // ------------------------------------------
    
    /* Like / Dislike */
    var likeBtn = document.getElementById('like-btn');
    var dislikeBtn = document.getElementById('dislike-btn');
    if (likeBtn) likeBtn.addEventListener('click', function() { toggleLike(videoId); });
    if (dislikeBtn) dislikeBtn.addEventListener('click', function() { toggleDislike(videoId); });
    
    /* ═══════════════════════════════════════════════
   Share — Native Web Share API + Warm Messages
   ═══════════════════════════════════════════════ */

/* Helper: Copy text to clipboard with fallback */
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(function() {
      showToast('Link & details copied to clipboard! 📋', 'success');
    }).catch(function() {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  var textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
    showToast('Link & details copied! 📋', 'success');
  } catch (e) {
    showToast('Could not copy — please share manually', 'warning');
  }
  document.body.removeChild(textarea);
}

/* Helper: Update OG meta tags for link previews */
function updateShareMeta(title, description, imageUrl, url) {
  setMeta('og:title', title, 'property');
  setMeta('og:description', description, 'property');
  setMeta('og:image', imageUrl, 'property');
  setMeta('og:url', url, 'property');
  setMeta('og:type', 'video.movie', 'property');
  setMeta('twitter:card', 'summary_large_image', 'name');
  setMeta('twitter:title', title, 'name');
  setMeta('twitter:description', description, 'name');
  setMeta('twitter:image', imageUrl, 'name');
}

function setMeta(key, content, attr) {
  var el = document.querySelector('meta[' + attr + '="' + key + '"]');
  if (el) {
    el.setAttribute('content', content);
  } else {
    var meta = document.createElement('meta');
    meta.setAttribute(attr, key);
    meta.setAttribute('content', content);
    document.head.appendChild(meta);
  }
}

/* Main share handler */
var shareBtn = document.getElementById('share-btn');
if (shareBtn) {
  shareBtn.addEventListener('click', function() {
    /* ── Gather video data from multiple possible sources ── */
    var vd = (typeof currentVideoData !== 'undefined') ? currentVideoData : {};
    var title = vd.title ||
      (document.getElementById('video-title') ? document.getElementById('video-title').textContent.trim() : '') ||
      document.title ||
      'Amazing Movie';
    var year = vd.year || '';
    var genre = vd.genre || '';
    var rating = vd.imdbRating || '';
    var director = vd.director || '';
    var thumbnail = vd.thumbnailUrl || '';
    var url = window.location.href;
    
    /* ── Build warm share text ── */
    var line = '━━━━━━━━━━━━━━━━━━\n';
    var shareText = line +
      '🎬 XSTRΞAM FLIMS\n' +
      line + '\n' +
      '🔥 "' + title + '"\n\n';
    
    if (year) shareText += '📅 Year: ' + year + '\n';
    if (rating) shareText += '⭐ IMDB: ' + rating + '/10\n';
    if (genre) shareText += '🎭 Genre: ' + genre + '\n';
    if (director) shareText += '🎥 Director: ' + director + '\n';
    
    shareText += '\n' +
      '✨ Stream it FREE in HD quality!\n' +
      '🚀 No ads, no signup hassle.\n\n' +
      '👇 Watch now:\n' +
      url + '\n\n' +
      line +
      '📖 "Where every frame tells a story"\n' +
      line;
    
    /* ── Update OG meta tags for rich link previews ── */
    var ogDesc = 'Watch "' + title + '"';
    if (year) ogDesc += ' (' + year + ')';
    if (rating) ogDesc += ' — ⭐ ' + rating + '/10';
    if (genre) ogDesc += ' — ' + genre;
    ogDesc += ' only on XSTREAM FLIMS. Free HD streaming, no ads!';
    
    updateShareMeta(
      title + ' — XSTREAM FLIMS',
      ogDesc,
      thumbnail,
      url
    );
    
    /* ── Share data object ── */
    var shareData = {
      title: '🎬 ' + title + ' — XSTREAM FLIMS',
      text: shareText,
      url: url
    };
    
    /* ── Try native Web Share API (WhatsApp, Telegram, etc.) ── */
    if (navigator.share) {
      navigator.share(shareData).then(function() {
        showToast('Shared successfully! 🎉', 'success');
      }).catch(function(err) {
        // User cancelled the share menu — don't show error
        if (err.name !== 'AbortError') {
          // Actual error — fall back to clipboard
          copyToClipboard(shareText);
        }
      });
    } else {
      /* ── No Web Share API (desktop Chrome, etc.) → clipboard ── */
      copyToClipboard(shareText);
    }
  });
}
    
    /* Favourite */
    var favouriteBtn = document.getElementById('favourite-btn');
    var favouriteLabel = document.getElementById('favourite-label');
    if (favouriteBtn) {
      var isFav = AppState.favouriteVideos.indexOf(videoId) >= 0;
      favouriteBtn.classList.toggle('favourited', isFav);
      if (favouriteLabel) favouriteLabel.textContent = isFav ? 'Favourited' : 'Favourite';
      
      favouriteBtn.addEventListener('click', function() {
        if (!AppState.currentUser) {
          showToast('Please sign in to add favourites', 'warning');
          return;
        }
        toggleFavourite(videoId);
        var nowFav = AppState.favouriteVideos.indexOf(videoId) >= 0;
        favouriteBtn.classList.toggle('favourited', nowFav);
        if (favouriteLabel) favouriteLabel.textContent = nowFav ? 'Favourited' : 'Favourite';
        showToast(nowFav ? 'Added to favourites' : 'Removed from favourites', nowFav ? 'success' : 'info');
      });
    }
    
    /* Download */
    var downloadBtn = document.getElementById('download-btn');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', function() {
        var videoUrl = getVideoUrl(videoData);
        if (!videoUrl) {
          showToast('Movie file not available for download', 'error');
          return;
        }
        
        if (!AppState.currentUser) {
          showToast('Please sign in to download movies', 'warning');
          return;
        }
        
        downloadBtn.classList.add('downloading');
        var dlText = downloadBtn.childNodes[downloadBtn.childNodes.length - 1];
        var originalText = dlText.textContent;
        dlText.textContent = 'Fetching...';
        
        downloadForOffline(videoId, videoUrl, videoData.title || 'Video')
          .then(function() {
            dlText.textContent = 'Saved!';
            setTimeout(function() {
              downloadBtn.classList.remove('downloading');
              dlText.textContent = originalText;
            }, 2000);
          })
          .catch(function() {
            downloadBtn.classList.remove('downloading');
            dlText.textContent = originalText;
          });
      });
    }
    
    updateLikeDislikeUI(videoId);
    
    /* Related Videos */
    fetchRelatedVideos(videoId, 8).then(function(videos) {
      var container = document.getElementById('related-videos');
      if (!container) return;
      container.innerHTML = '';
      if (videos.length === 0) {
        container.innerHTML = '<p style="font-size:0.85rem;color:var(--text-muted);">No related movies found.</p>';
        return;
      }
      videos.forEach(function(v) { container.appendChild(createWidgetVideoItem(v)); });
      initLazyLoading();
    });
    
  }).catch(function(err) {
    console.error('Video fetch error:', err);
    showVideoNotFound();
  });
}



function renderVideoPlayer(videoData) {
  var wrapper = document.getElementById('video-player-wrapper');
  var info = document.getElementById('video-info');
  var notFound = document.getElementById('video-not-found');
  
  if (!wrapper || !info) return;
  if (notFound) notFound.style.display = 'none';
  
  var videoUrl = getVideoUrl(videoData);
  if (videoUrl) {
    // FIXED: Removed the vidEl.play() block to restore iPhone audio
    wrapper.innerHTML = '<video controls playsinline preload="metadata" src="' + videoUrl + '">...</video>';
  } else {
    wrapper.innerHTML = '<div style="aspect-ratio:16/9; display:flex; align-items:center; justify-content:center; background:var(--bg-elevated); flex-direction:column; gap:12px;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" style="color:var(--text-muted)"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="m10 8 5 4-5 4V8z"/></svg><p style="color:var(--text-muted); font-size:0.9rem;"> file not available</p></div>';
  }
  
  var videoTitle = document.getElementById('video-title');
  var videoDescription = document.getElementById('video-description');
  var videoViews = document.querySelector('#video-views span');
  var videoDate = document.querySelector('#video-date span');
  var videoCountryBadge = document.querySelector('#video-country-badge span');
  var likeCount = document.getElementById('like-count');
  var dislikeCount = document.getElementById('dislike-count');
  
  if (videoTitle) videoTitle.textContent = videoData.title || 'Untitled';
  if (videoDescription) videoDescription.textContent = videoData.description || 'No description available.';
  if (videoViews) videoViews.textContent = formatNumber(videoData.views || 0) + ' views';
  if (videoDate) videoDate.textContent = formatDate(videoData.createdAt);
  if (videoCountryBadge) videoCountryBadge.textContent = videoData.country || 'Unknown';
  if (likeCount) likeCount.textContent = formatNumber(videoData.likes || 0);
  if (dislikeCount) dislikeCount.textContent = formatNumber(videoData.dislikes || 0);
  
  info.style.display = 'block';
  document.title = (videoData.title || 'Video') + ' — Xstream';
  
  var metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = (videoData.description || '').substring(0, 160);
}

function showVideoNotFound() {
  var wrapper = document.getElementById('video-player-wrapper');
  var info = document.getElementById('video-info');
  var notFound = document.getElementById('video-not-found');
  if (wrapper) wrapper.style.display = 'none';
  if (info) info.style.display = 'none';
  if (notFound) notFound.style.display = 'block';
}

/* =============================================
   Form Helpers
   ============================================= */
function showFormError(fieldId, message) {
  var errorEl = document.getElementById(fieldId + '-error');
  if (errorEl) errorEl.textContent = message;
  var input = document.getElementById(fieldId);
  if (input) input.style.borderColor = 'var(--error)';
}

function clearFormErrors(prefix) {
  var errorFields = {
    login: ['login-email', 'login-password'],
    signup: ['signup-name', 'signup-email', 'signup-password', 'signup-confirm-password', 'signup-country', 'signup-age'],
    forgot: ['forgot-email'],
    upload: ['video-file', 'thumb-file', 'upload-title', 'upload-desc', 'upload-category']
  };
  var fields = errorFields[prefix] || [];
  fields.forEach(function(id) {
    var errorEl = document.getElementById(id + '-error');
    if (errorEl) errorEl.textContent = '';
    var input = document.getElementById(id);
    if (input) input.style.borderColor = '';
  });
}

function setFormLoading(prefix, loading) {
  var submitId = prefix + '-submit';
  var btn = document.getElementById(submitId);
  if (!btn) return;
  var text = btn.querySelector('.btn-text');
  var spinner = btn.querySelector('.btn-spinner');
  if (loading) {
    btn.disabled = true;
    if (text) text.style.opacity = '0';
    if (spinner) spinner.style.display = 'block';
  } else {
    btn.disabled = false;
    if (text) text.style.opacity = '1';
    if (spinner) spinner.style.display = 'none';
  }
}

function getAuthErrorMessage(code) {
  var messages = {
    'auth/email-already-in-use': 'This email is already registered. Try signing in instead.',
    'auth/invalid-email': 'The email address is not valid.',
    'auth/weak-password': 'Password is too weak. Use at least 8 characters with a mix of letters, numbers, and symbols.',
    'auth/user-not-found': 'No account found with this email address.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Invalid email or password. Please check your credentials.',
    'auth/too-many-requests': 'Too many failed attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Please check your internet connection.',
    'auth/user-disabled': 'This account has been disabled. Contact support for help.',
    'auth/invalid-verification-code': 'The verification code is invalid or expired.',
    'auth/invalid-reset-token': 'The password reset link is invalid or has expired.'
  };
  return messages[code] || 'An unexpected error occurred. Please try again.';
}

/* =============================================
   Profile Page Data Loaders (Rewritten)
   ============================================= */

function loadUserFavourites(uid) {
  var container = document.getElementById('profile-favourites-list');
  if (!container) return Promise.resolve([]);
  
  container.innerHTML = '<div class="profile-loading-state"><div class="profile-spinner"></div><span>Loading favourites...</span></div>';
  
  return database.ref('users/' + uid + '/favourites').once('value').then(function(snap) {
    if (!snap.exists()) {
      container.innerHTML = '<div class="profile-empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><p>No favourites yet</p><span>Browse and save your favourite content</span></div>';
      return Promise.resolve([]);
    }
    
    var movieIds = [];
    var liveChannels = [];
    
    snap.forEach(function(child) {
      var data = child.val();
      if (typeof data === 'number') {
        movieIds.push(child.key);
      } else if (typeof data === 'object' && data.streamUrl) {
        var channelData = Object.assign({ id: child.key }, data);
        liveChannels.push(channelData);
      }
    });
    
    if (movieIds.length === 0 && liveChannels.length === 0) {
      container.innerHTML = '<div class="profile-empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg><p>No favourites yet</p><span>Browse and save your favourite content</span></div>';
      return Promise.resolve([]);
    }
    
    var moviePromises = movieIds.slice(0, 18).map(function(id) {
      return fetchVideoById(id);
    });
    
    return Promise.all(moviePromises).then(function(movieResults) {
      var html = '';
      
      // 1. Render Live TV Channels
      liveChannels.forEach(function(ch) {
        var thumbHtml = ch.thumbnail ?
          '<img src="' + ch.thumbnail + '" alt="' + escapeHTML(ch.name) + '" onerror="this.parentElement.innerHTML=\'<div class=\\\'profile-card-placeholder\\\'>TV</div>\'">' :
          '<div class="profile-card-placeholder">TV</div>';
        
        html += '<div class="profile-card" onclick="window.location.href=\'channel.html?id=' + ch.id + '\'">' +
          '<div class="profile-card-thumb">' +
          thumbHtml +
          '<div class="profile-card-overlay">' +
          '<div class="profile-card-play-btn"><svg viewBox="0 0 24 24" fill="#fff" width="32" height="32"><polygon points="6,3 20,12 6,21"/></svg></div>' +
          '</div>' +
          '<span class="profile-card-badge profile-card-badge--live">LIVE</span>' +
          '</div>' +
          '<div class="profile-card-body">' +
          '<h3 class="profile-card-title">' + escapeHTML(ch.name) + '</h3>' +
          '<p class="profile-card-meta">' + escapeHTML(ch.country || 'Unknown') + ' &bull; ' + escapeHTML(ch.category || 'General') + '</p>' +
          '</div>' +
          '<button class="profile-card-remove" onclick="event.stopPropagation(); removeFavourite(\'' + ch.id + '\')" title="Remove from favourites">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
          '</div>';
      });
      
      // 2. Render Standard Movies
      movieResults.forEach(function(v) {
        if (!v) return;
        
        html += '<div class="profile-card" onclick="window.location.href=\'video.html?id=' + v._id + '\'">' +
          '<div class="profile-card-thumb">' +
          '<img src="' + getThumbnailUrl(v) + '" alt="' + escapeHTML(v.title || 'Untitled') + '" onerror="this.src=\'https://placehold.co/300x170/e63946/fff?text=No+Image\'">' +
          '<div class="profile-card-overlay">' +
          '<div class="profile-card-play-btn"><svg viewBox="0 0 24 24" fill="#fff" width="32" height="32"><polygon points="6,3 20,12 6,21"/></svg></div>' +
          '</div>' +
          '</div>' +
          '<div class="profile-card-body">' +
          '<h3 class="profile-card-title">' + escapeHTML(v.title || 'Untitled') + '</h3>' +
          '<p class="profile-card-meta">' + formatDate(v.createdAt) + '</p>' +
          '</div>' +
          '<button class="profile-card-remove" onclick="event.stopPropagation(); removeFavourite(\'' + v._id + '\')" title="Remove from favourites">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
          '</div>';
      });
      
      container.innerHTML = '<div class="profile-scroll-container">' + html + '</div>';
      
      // Scroll to bottom initially so user can scroll up
      var scrollBox = container.querySelector('.profile-scroll-container');
      if (scrollBox) {
        setTimeout(function() {
          scrollBox.scrollTop = scrollBox.scrollHeight;
        }, 50);
      }
      
      return movieResults.concat(liveChannels);
    });
  }).catch(function(error) {
    console.error('loadUserFavourites error:', error);
    container.innerHTML = '<div class="profile-empty-state profile-empty-state--error"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><p>Failed to load favourites</p><span>Please check your connection and try again</span></div>';
    return [];
  });
}

function loadUserDownloads(uid) {
  var container = document.getElementById('profile-downloads-list');
  if (!container) return Promise.resolve([]);
  
  container.innerHTML = '<div class="profile-loading-state"><div class="profile-spinner"></div><span>Loading downloads...</span></div>';
  
  return database.ref('users/' + uid + '/downloads').once('value').then(function(snap) {
    var items = [];
    snap.forEach(function(child) {
      var data = child.val();
      items.push({
        id: child.key,
        url: data.url,
        title: data.title,
        date: data.downloadedAt
      });
    });
    
    if (items.length === 0) {
      container.innerHTML = '<div class="profile-empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><p>No downloads yet</p><span>Download content to watch offline</span></div>';
      return Promise.resolve([]);
    }
    
    // Fixed: use 'date' property for sorting
    items.sort(function(a, b) {
      return (b.date || 0) - (a.date || 0);
    });
    
    var html = '';
    items.forEach(function(item) {
      html += '<div class="profile-card" onclick="window.playOffline(\'' + item.id + '\')">' +
        '<div class="profile-card-thumb profile-card-thumb--offline">' +
        '<div class="profile-card-overlay">' +
        '<div class="profile-card-play-btn"><svg viewBox="0 0 24 24" fill="#fff" width="32" height="32"><polygon points="6,3 20,12 6,21"/></svg></div>' +
        '<span class="profile-card-offline-label">OFFLINE</span>' +
        '</div>' +
        '</div>' +
        '<div class="profile-card-body">' +
        '<h3 class="profile-card-title">' + escapeHTML(item.title || 'Untitled') + '</h3>' +
        '<p class="profile-card-meta">Downloaded ' + formatDate(item.date) + '</p>' +
        '</div>' +
        '<button class="profile-card-remove" onclick="event.stopPropagation(); removeDownload(\'' + item.id + '\')" title="Remove download">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
        '</div>';
    });
    
    container.innerHTML = '<div class="profile-scroll-container">' + html + '</div>';
    
    // Scroll to bottom initially
    var scrollBox = container.querySelector('.profile-scroll-container');
    if (scrollBox) {
      setTimeout(function() {
        scrollBox.scrollTop = scrollBox.scrollHeight;
      }, 50);
    }
    
    return items;
  }).catch(function(error) {
    console.error('loadUserDownloads error:', error);
    container.innerHTML = '<div class="profile-empty-state profile-empty-state--error"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><p>Failed to load downloads</p><span>Please check your connection and try again</span></div>';
    return [];
  });
}

function loadUserHistory(uid) {
  var container = document.getElementById('profile-history-list');
  if (!container) return Promise.resolve([]);
  
  container.innerHTML = '<div class="profile-loading-state"><div class="profile-spinner"></div><span>Loading history...</span></div>';
  
  return database.ref('users/' + uid + '/history').once('value').then(function(snap) {
    var entries = [];
    snap.forEach(function(child) {
      var ts = child.val();
      entries.push({ id: child.key, timestamp: ts });
    });
    
    if (entries.length === 0) {
      container.innerHTML = '<div class="profile-empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p>No watch history yet</p><span>movies you watch will appear here</span></div>';
      return Promise.resolve([]);
    }
    
    entries.sort(function(a, b) {
      return (b.timestamp || 0) - (a.timestamp || 0);
    });
    
    var topEntries = entries.slice(0, 30);
    var promises = topEntries.map(function(entry) {
      return fetchVideoById(entry.id);
    });
    
    return Promise.all(promises).then(function(results) {
      var html = '';
      results.forEach(function(v, index) {
        if (!v) return;
        
        // Fixed: use actual watch timestamp
        var watchedAt = topEntries[index].timestamp;
        
        html += '<div class="profile-card" onclick="window.location.href=\'video.html?id=' + v._id + '\'">' +
          '<div class="profile-card-thumb">' +
          '<img src="' + getThumbnailUrl(v) + '" alt="' + escapeHTML(v.title || 'Untitled') + '" onerror="this.src=\'https://placehold.co/300x170/e63946/fff?text=No+Image\'">' +
          '<div class="profile-card-overlay">' +
          '<div class="profile-card-play-btn"><svg viewBox="0 0 24 24" fill="#fff" width="32" height="32"><polygon points="6,3 20,12 6,21"/></svg></div>' +
          '</div>' +
          '<span class="profile-card-badge profile-card-badge--history"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Watched</span>' +
          '</div>' +
          '<div class="profile-card-body">' +
          '<h3 class="profile-card-title">' + escapeHTML(v.title || 'Untitled') + '</h3>' +
          '<p class="profile-card-meta">Watched ' + formatDate(watchedAt) + '</p>' +
          '</div>' +
          '</div>';
      });
      
      container.innerHTML = '<div class="profile-scroll-container">' + html + '</div>';
      
      // Scroll to bottom initially
      var scrollBox = container.querySelector('.profile-scroll-container');
      if (scrollBox) {
        setTimeout(function() {
          scrollBox.scrollTop = scrollBox.scrollHeight;
        }, 50);
      }
      
      return results;
    });
  }).catch(function(error) {
    console.error('loadUserHistory error:', error);
    container.innerHTML = '<div class="profile-empty-state profile-empty-state--error"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><p>Failed to load history</p><span>Please check your connection and try again</span></div>';
    return [];
  });
}

/* =============================================
   Clear Watch History
   ============================================= */
function clearWatchHistory(uid) {
  if (!confirm('Clear all watch history?')) return;
  
  var container = document.getElementById('profile-history-list');
  if (container) {
    container.innerHTML = '<div class="profile-loading-state"><div class="profile-spinner"></div><span>Clearing history...</span></div>';
  }
  
  database.ref('users/' + uid + '/history').remove()
    .then(function() {
      if (container) {
        container.innerHTML = '<div class="profile-empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p>No watch history yet</p><span>Movies you watch will appear here</span></div>';
      }
    })
    .catch(function(error) {
      console.error('clearWatchHistory error:', error);
      if (container) {
        container.innerHTML = '<div class="profile-empty-state profile-empty-state--error"><p>Failed to clear history</p></div>';
      }
    });
}

 

/* =============================================
   View All Page — No Pagination
   Reads from "description" + "Translated" ONLY
   ============================================= */
var VIEWALL_STATE = {
  allVideos: [],
  currentCategory: 'all',
  currentSort: 'recent',
  currentYear: ''
};

function initViewAllPage() {
  var grid = document.getElementById('videos-grid');
  if (!grid) return;
  
  var loadMoreBtn = document.getElementById('load-more-btn');
  var catFilter = document.getElementById('category-filter');
  var sortFilter = document.getElementById('sort-filter');
  
  /* Hide Load More — everything loads at once */
  if (loadMoreBtn) loadMoreBtn.style.display = 'none';
  
  /* Read URL params */
  var urlParams = new URLSearchParams(window.location.search);
  VIEWALL_STATE.currentYear = urlParams.get('year') || '';
  VIEWALL_STATE.currentCategory = 'all';
  VIEWALL_STATE.currentSort = 'recent';
  
  var urlSort = urlParams.get('sort');
  var urlCat = urlParams.get('category');
  if (urlSort) VIEWALL_STATE.currentSort = urlSort;
  if (urlCat) VIEWALL_STATE.currentCategory = urlCat;
  
  if (catFilter) catFilter.value = VIEWALL_STATE.currentCategory;
  if (sortFilter) sortFilter.value = VIEWALL_STATE.currentSort;
  
  /* Update page header if filtering by year */
  if (VIEWALL_STATE.currentYear) {
    setViewAllHeader(
      'Movies from ' + VIEWALL_STATE.currentYear,
      'Browse all movies released in ' + VIEWALL_STATE.currentYear + '.',
      'Year: ' + VIEWALL_STATE.currentYear
    );
    showActiveFilterChips();
  } else {
    resetViewAllHeader();
    showActiveFilterChips();
  }
  
  /* Fetch from nodes, then render (uses cache if available for SPA speed) */
  fetchFromBothNodes();
  
  /* ---- Category ---- */
  if (catFilter) {
    catFilter.addEventListener('change', function() {
      VIEWALL_STATE.currentCategory = catFilter.value;
      filterAndRender();
      showActiveFilterChips();
    });
  }
  
  /* ---- Sort ---- */
  if (sortFilter) {
    sortFilter.addEventListener('change', function() {
      VIEWALL_STATE.currentSort = sortFilter.value;
      filterAndRender();
    });
  }
  
  /* ---- Clear filters ---- */
  var clearBtn = document.getElementById('clear-all-filters');
  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      VIEWALL_STATE.currentCategory = 'all';
      VIEWALL_STATE.currentSort = 'recent';
      VIEWALL_STATE.currentYear = '';
      if (catFilter) catFilter.value = 'all';
      if (sortFilter) sortFilter.value = 'recent';
      
      resetViewAllHeader();
      filterAndRender();
      showActiveFilterChips();
    });
  }
}

/* -------------------------------------------------------
   Header Helpers
   ------------------------------------------------------- */
function setViewAllHeader(title, subtitle, breadcrumb) {
  var pageTitle = document.getElementById('viewall-page-title');
  var pageSubtitle = document.getElementById('viewall-page-subtitle');
  var breadcrumbCurrent = document.getElementById('breadcrumb-current');
  var titleEl = document.getElementById('viewall-title');
  
  if (pageTitle) pageTitle.textContent = title;
  if (pageSubtitle) pageSubtitle.textContent = subtitle;
  if (breadcrumbCurrent) breadcrumbCurrent.textContent = breadcrumb;
  if (titleEl) {
    titleEl.innerHTML = '<svg class="title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ' + escapeHTML(title);
  }
}

function resetViewAllHeader() {
  setViewAllHeader(
    'All Movies',
    'Browse the complete collection of Movies from creators worldwide.',
    'All Movies'
  );
  var titleEl = document.getElementById('viewall-title');
  if (titleEl) {
    titleEl.innerHTML = '<svg class="title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> All Movies';
  }
}

/* -------------------------------------------------------
   showActiveFilterChips
   ------------------------------------------------------- */
function showActiveFilterChips() {
  var container = document.getElementById('active-filters');
  var chipsContainer = document.getElementById('active-filter-chips');
  if (!container || !chipsContainer) return;
  
  var hasFilter = false;
  var chipsHTML = '';
  
  if (VIEWALL_STATE.currentYear) {
    hasFilter = true;
    chipsHTML += '<span class="active-chip">Year: ' + escapeHTML(VIEWALL_STATE.currentYear) + ' <button onclick="removeYearFilter()" class="chip-remove">&times;</button></span>';
  }
  
  if (VIEWALL_STATE.currentCategory && VIEWALL_STATE.currentCategory !== 'all') {
    hasFilter = true;
    chipsHTML += '<span class="active-chip">' + escapeHTML(VIEWALL_STATE.currentCategory) + ' <button onclick="removeCategoryFilter()" class="chip-remove">&times;</button></span>';
  }
  
  if (hasFilter) {
    container.style.display = 'flex';
    chipsContainer.innerHTML = chipsHTML;
  } else {
    container.style.display = 'none';
    chipsContainer.innerHTML = '';
  }
}

function removeYearFilter() {
  VIEWALL_STATE.currentYear = '';
  resetViewAllHeader();
  filterAndRender();
  showActiveFilterChips();
}

function removeCategoryFilter() {
  VIEWALL_STATE.currentCategory = 'all';
  var catFilter = document.getElementById('category-filter');
  if (catFilter) catFilter.value = 'all';
  filterAndRender();
  showActiveFilterChips();
}

/* -------------------------------------------------------
   fetchFromBothNodes
   Fires two parallel reads (description + Translated),
   merges into one array. Series are completely excluded.
   ------------------------------------------------------- */
function fetchFromBothNodes() {
  var grid = document.getElementById('videos-grid');
  if (!grid) return;
  
  /* If we already fetched data (e.g. navigating back via SPA), just re-render */
  if (VIEWALL_STATE.allVideos.length > 0) {
    filterAndRender();
    return;
  }
  
  var dbRef = (typeof database !== 'undefined' && database) ? database : firebase.database();
  
  var p1 = dbRef.ref('description').once('value');
  var p2 = dbRef.ref('Translated').once('value');
  
  Promise.all([p1, p2]).then(function(results) {
    VIEWALL_STATE.allVideos = [];
    var seenIds = {};
    var nodeNames = ['description', 'Translated'];
    
    /* Loop through the 2 snapshots */
    for (var i = 0; i < results.length; i++) {
      var snapshot = results[i];
      var source = nodeNames[i];
      
      snapshot.forEach(function(child) {
        if (source === 'description' && child.key === 'Translated') return; // skip container
        var data = child.val();
        if (!data || typeof data !== 'object' || !data.title) return;
        if (seenIds[child.key]) return;
        
        data._id = child.key;
        data._source = source;
        data._isTranslated = (source === 'Translated');
        VIEWALL_STATE.allVideos.push(data);
        seenIds[child.key] = true;
      });
    }
    
    console.log('[ViewAll] Total merged: ' + VIEWALL_STATE.allVideos.length);
    filterAndRender();
    
  }).catch(function(err) {
    console.error('[ViewAll] Fetch error:', err);
    grid.innerHTML =
      '<div class="empty-state" style="grid-column:1/-1;">' +
      '<h3>Could not load Movies</h3>' +
      '<p>Please check your connection and try again.</p></div>';
  });
}

/* -------------------------------------------------------
   filterAndRender
   Filters, sorts, renders from the merged list.
   ------------------------------------------------------- */
function filterAndRender() {
  var grid = document.getElementById('videos-grid');
  var noVideos = document.getElementById('no-videos');
  var badge = document.getElementById('video-count-badge');
  
  if (!grid) return;
  
  var list = VIEWALL_STATE.allVideos.slice();
  
  /* ---- Filter by year ---- */
  if (VIEWALL_STATE.currentYear) {
    var yearStr = VIEWALL_STATE.currentYear.toString();
    list = list.filter(function(v) {
      return (v.year || '').toString() === yearStr;
    });
  }
  
  /* ---- Filter by category ---- */
  if (VIEWALL_STATE.currentCategory && VIEWALL_STATE.currentCategory !== 'all') {
    var cat = VIEWALL_STATE.currentCategory.toLowerCase();
    list = list.filter(function(v) {
      return (v.category || '').toLowerCase() === cat;
    });
  }
  
  /* ---- Sort ---- */
  if (VIEWALL_STATE.currentSort === 'views') {
    list.sort(function(a, b) { return (b.views || 0) - (a.views || 0); });
  } else if (VIEWALL_STATE.currentSort === 'likes') {
    list.sort(function(a, b) { return (b.likes || 0) - (a.likes || 0); });
  } else if (VIEWALL_STATE.currentSort === 'trending') {
    var now = Date.now();
    list.sort(function(a, b) {
      var sA = (a.views || 0) + (a.likes || 0) * 5 + Math.max(0, 100000 - (now - (a.createdAt || 0))) / 1000;
      var sB = (b.views || 0) + (b.likes || 0) * 5 + Math.max(0, 100000 - (now - (b.createdAt || 0))) / 1000;
      return sB - sA;
    });
  } else {
    list.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }
  
  /* ---- Render ---- */
  grid.innerHTML = '';
  
  if (list.length === 0) {
    if (noVideos) noVideos.style.display = 'block';
    if (badge) badge.textContent = '0 Videos';
    return;
  }
  
  if (noVideos) noVideos.style.display = 'none';
  if (badge) badge.textContent = list.length + ' Video' + (list.length !== 1 ? 's' : '');
  
  var fragment = document.createDocumentFragment();
  list.forEach(function(v) {
    fragment.appendChild(createVideoCard(v));
  });
  grid.appendChild(fragment);
  
  if (typeof initLazyLoading === 'function') initLazyLoading();
}
function initViewAllLiveSearch() {
  var searchInput = document.getElementById('viewall-search-input');
  var clearBtn = document.getElementById('viewall-search-clear');
  var grid = document.getElementById('videos-grid');
  var noVideos = document.getElementById('no-videos');
  var loadMoreContainer = document.getElementById('load-more-container');
  var activeFiltersDiv = document.getElementById('active-filters');
  var activeFilterChips = document.getElementById('active-filter-chips');
  var clearAllFilters = document.getElementById('clear-all-filters');
  
  if (!searchInput || !grid) return;
  
  var searchTimeout = null;
  
  function performLiveSearch(query) {
    grid.innerHTML = '';
    noVideos.style.display = 'none';
    if (loadMoreContainer) loadMoreContainer.style.display = 'none';
    
    if (!query || query.trim().length < 2) {
      activeFiltersDiv.style.display = 'none';
      // Reload default view (fallback to fetchVideos if page function missing)
      if (typeof loadViewAllVideos === 'function') {
        loadViewAllVideos();
      } else {
        fetchVideos(AppState.itemsPerPage, null, 'all', 'recent', '').then(function(res) {
          renderResults(res.videos);
        });
      }
      return;
    }
    
    // Show active filter chip
    if (activeFiltersDiv) {
      activeFiltersDiv.style.display = 'flex';
      if (activeFilterChips) {
        activeFilterChips.innerHTML = '<span class="filter-chip">Search: "' + escapeHTML(query) + '"</span>';
      }
    }
    
    // Show skeletons while loading
    for (var i = 0; i < 8; i++) {
      grid.innerHTML += '<div class="skeleton-card"><div class="skeleton skeleton-thumb"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div></div>';
    }
    
    // Fetch universally using the search parameter
    fetchVideos(AppState.itemsPerPage, null, 'all', 'recent', query).then(function(res) {
      grid.innerHTML = '';
      renderResults(res.videos);
    });
  }
  
  function renderResults(videos) {
    if (videos.length === 0) {
      noVideos.style.display = 'flex';
      return;
    }
    for (var i = 0; i < videos.length; i++) {
      grid.appendChild(createVideoCard(videos[i]));
    }
  }
  
  // Live typing listener (debounced at 400ms)
  searchInput.addEventListener('input', function() {
    var query = this.value.trim();
    clearBtn.style.display = query.length > 0 ? 'block' : 'none';
    
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(function() {
      performLiveSearch(query);
    }, 400);
  });
  
  // Clear button
  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      performLiveSearch('');
    });
  }
  
  // "Clear All" text button
  if (clearAllFilters) {
    clearAllFilters.addEventListener('click', function() {
      searchInput.value = '';
      clearBtn.style.display = 'none';
      performLiveSearch('');
    });
  }
  
  // CATCH OLD LINKS: If user comes from homepage sidebar (e.g., ?category=action or ?search=avatar)
  var urlParams = new URLSearchParams(window.location.search);
  var initialSearch = urlParams.get('search') || urlParams.get('q') || urlParams.get('category') || '';
  if (initialSearch && initialSearch.toLowerCase() !== 'all') {
    searchInput.value = initialSearch;
    clearBtn.style.display = 'block';
    performLiveSearch(initialSearch);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initViewAllLiveSearch);
/* =============================================
   Profile Page
   ============================================= */
function initProfilePage() {
  var authGuard = document.getElementById('profile-auth-guard');
  var profileContent = document.getElementById('profile-content');
  
  if (!AppState.currentUser) {
    if (authGuard) authGuard.style.display = 'block';
    if (profileContent) profileContent.style.display = 'none';
    return;
  }
  
  if (authGuard) authGuard.style.display = 'none';
  if (profileContent) profileContent.style.display = 'block';
  
  var user = AppState.currentUser;
  var profile = AppState.userProfile || {};
  
  var avatar = document.getElementById('profile-avatar');
  var nameEl = document.getElementById('profile-name');
  var emailEl = document.getElementById('profile-email');
  var countryEl = document.getElementById('profile-country');
  var ageEl = document.getElementById('profile-age');
  var joinedEl = document.getElementById('profile-joined');
  
  if (avatar) avatar.textContent = (user.displayName || user.email || 'U')[0].toUpperCase();
  if (nameEl) nameEl.textContent = profile.fullName || user.displayName || 'User';
  if (emailEl) emailEl.textContent = user.email || '—';
  if (countryEl) countryEl.textContent = profile.country || 'Unknown';
  if (ageEl) ageEl.textContent = profile.age ? profile.age + ' years' : '—';
  if (joinedEl) joinedEl.textContent = profile.createdAt ? formatDate(profile.createdAt) : '—';
  
  var signOutBtn = document.getElementById('sign-out-btn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', function() {
      auth.signOut().then(function() {
        showToast('Signed out successfully', 'success');
        window.location.href = 'index.html';
      });
    });
  }
  
  loadUserFavourites(user.uid).then(function(favs) {
    var favCount = document.getElementById('stat-favourites');
    if (favCount) favCount.textContent = favs.filter(function(v) { return v !== null; }).length;
  });
  
  loadUserDownloads(user.uid).then(function(dls) {
    var dlCount = document.getElementById('stat-downloads');
    if (dlCount) dlCount.textContent = dls.length;
  });
  
  loadUserHistory(user.uid).then(function(hist) {
    var histCount = document.getElementById('stat-history');
    if (histCount) histCount.textContent = hist.filter(function(v) { return v !== null; }).length;
  });
  
  initProfileTabs();
}

function initProfileTabs() {
  var tabs = document.querySelectorAll('.profile-tab');
  var contents = document.querySelectorAll('.profile-tab-content');
  
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var targetTab = this.dataset.tab;
      tabs.forEach(function(t) { t.classList.remove('active'); });
      this.classList.add('active');
      contents.forEach(function(c) {
        c.classList.remove('active');
        c.style.display = 'none';
      });
      var targetContent = document.getElementById('tab-' + targetTab);
      if (targetContent) {
        targetContent.classList.add('active');
        targetContent.style.display = 'block';
      }
    });
  });
}
/* ============================================
   ADVANCED WEBSITE ANALYTICS SYSTEM v4.1.0
   Enterprise-Grade Client-Side Analytics
   (Stability & Debugging Release)
   ============================================ */
const SiteAnalytics = (function () {

  var CFG = {
    heatmap: { enabled: true, sampleRate: 0.15, gridCols: 50, gridRows: 40, flushInterval: 10000 },
    replay: { enabled: true, sampleRate: 0.03, maxEvents: 3000, snapshotInterval: 15000, maxDuration: 600000 },
    formAnalytics: { enabled: true },
    security: { enabled: true },
    funnels: { enabled: true },
    journey: { enabled: true },
    alerts: { enabled: true },
    aiScoring: { enabled: true },
    seo: { enabled: true },
    utm: { enabled: true },
    deviceIntel: { enabled: true },
    alertThresholds: {
      bounceRate: 70, trafficSpike: 3, errorRate: 5,
      loadTime: 5000, lcp: 4000, cls: 0.25,
      conversionDrop: 30, botRate: 20
    },
    maxQueue: 60, maxRecent: 100, maxHealthDetails: 50,
    maxHeatmapPoints: 8000, maxReplayEvents: 3000,
    maxJourneySteps: 300, maxAlertsPerDay: 50, maxFunnelSteps: 20,
    flushInterval: 30000, clickFlushDelay: 2000,
    heartbeatInterval: 25000, healthRecheck: 60000,
    countryCacheTTL: 86400000, geoTimeout: 4000,
    replayFlushInterval: 30000, heatmapFlushInterval: 10000,
    journeyFlushInterval: 15000
  };

  var FP_KEY = 'artFP', SES_KEY = 'artSes', FV_KEY = 'artFV', VC_KEY = 'artVC';
  var CTRY_KEY = 'artCtry', CTRY_CITY_KEY = 'artCtryCity', CTRY_TS = 'artCtryTs';
  var UTM_KEY = 'artUTM', SEC_KEY = 'artSecScore';

  var db = null, fp = null, sid = null, startTs = 0;
  var flushed = false, visitTracked = false, presRef = null;
  var eventQueue = [], flushTimer = null, clickFlushTimer = null;
  var hasInteracted = false, bounceRecorded = false;
  var sessionPageViews = 0, sessionClicks = 0, sessionSearches = 0;
  var sessionScrollMax = 0, sessionStateChanges = 0;
  var sessionFeatureUsage = 0, sessionAIQueries = 0;

  var country = 'unknown', city = 'unknown', region = 'unknown';
  var isp = 'unknown', ip = 'unknown', ipTimezone = '';

  var gpuRenderer = 'unknown', gpuVendor = 'unknown', ramEstimate = 0;
  var batteryLevel = -1, batteryCharging = false, detectedFonts = [];
  var webglSupported = false, webrtcSupported = false;
  var browserEngine = 'unknown', deviceSubtype = 'standard';

  var utmData = { source: '', medium: '', campaign: '', term: '', content: '' };
  var trafficSource = 'direct';

  var botScore = 0, securityFlags = {}, suspiciousEvents = [];

  var journeySteps = [], lastPageEnterTs = 0, exitPage = '';
  var journeyFlushTimer = null;

  var activeFunnels = {}, definedFunnels = {};
  var formFields = {}, activeFormId = null;

  var mouseGrid = {}, clickGrid = {}, scrollSections = {};
  var rageClicks = [], deadClicks = [], heatmapFlushTimer = null;

  var replayEvents = [], replayActive = false, replayFlushTimer = null;
  var lastDomSnapshot = '', replayStartTime = 0;

  var alertsFired = {}, lastAlertTs = {};
  var visitorScore = 50, anomalyFlags = [];

  var healthMetrics = {}, longTaskCount = 0;
  var apiLatencies = {}, renderBlockingResources = [];
  var seoData = {};

  var geoReady = false;
  /* FIX: Cache device snapshot to prevent infinite recursion in public API */
  var _deviceSnapshotCache = null;

  /* ========================================
     UTILITY HELPERS — FIXED WITH ERROR LOGGING
     ======================================== */
  function safeTx(path, delta) {
    if (!db) return;
    try {
      db.ref(path).transaction(function (currentValue) {
        if (currentValue === null || currentValue === undefined) return delta;
        return (Number(currentValue) || 0) + delta;
      }, function (error, committed, snapshot) {
        if (error) {
          console.error('[Analytics] TX failed:', path, error.message);
        }
      });
    } catch (e) {
      console.error('[Analytics] TX error:', path, e.message);
    }
  }

  function safeSet(path, val) {
    if (!db) return;
    try {
      db.ref(path).set(val).catch(function (error) {
        console.error('[Analytics] SET failed:', path, error.code || error.message);
      });
    } catch (e) {
      console.error('[Analytics] SET error:', path, e.message);
    }
  }

  function safePush(path, val) {
    if (!db) return;
    try {
      db.ref(path).push().set(val).catch(function (error) {
        console.error('[Analytics] PUSH failed:', path, error.code || error.message);
      });
    } catch (e) {
      console.error('[Analytics] PUSH error:', path, e.message);
    }
  }

  function safeUpdate(obj) {
    if (!db) return;
    try {
      db.ref().update(obj).catch(function (error) {
        console.error('[Analytics] UPDATE failed:', error.code || error.message);
      });
    } catch (e) {
      console.error('[Analytics] UPDATE error:', e.message);
    }
  }

  function trimNode(nodePath, max) {
    if (!db) return;
    db.ref(nodePath).orderByKey().limitToFirst(max + 100).once('value').then(function (snap) {
      var data = snap.val();
      if (data) {
        var keys = Object.keys(data);
        if (keys.length > max) {
          var toRemove = keys.slice(0, keys.length - max);
          var deletes = {};
          toRemove.forEach(function (k) { deletes[nodePath + '/' + k] = null; });
          safeUpdate(deletes);
        }
      }
    }).catch(function (err) {
      console.error('[Analytics] trimNode error:', err.message);
    });
  }

  function todayKey() { return new Date().toISOString().split('T')[0]; }
  function pageName() { var h = location.hash.slice(1) || 'home'; return h.split('/')[0]; }
  function fullRoute() { return location.hash.slice(1) || 'home'; }
  function shouldSample(rate) { return Math.random() < rate; }
  function markInteracted() { hasInteracted = true; }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  /* ========================================
     1. FINGERPRINT & IDENTITY
     ======================================== */
  function generateFingerprint() {
    try {
      var c = document.createElement('canvas');
      var ctx = c.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText('FP|' + navigator.language + '|' + screen.width + 'x' + screen.height, 2, 2);
      var hash = c.toDataURL().split('').reduce(function (a, b) { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
      var parts = [
        hash, navigator.language, screen.width + 'x' + screen.height, screen.colorDepth,
        new Date().getTimezoneOffset(), navigator.hardwareConcurrency || 0,
        navigator.platform || '', (navigator.deviceMemory || 0).toString(),
        navigator.maxTouchPoints || 0
      ];
      var h = 0, str = parts.join('|');
      for (var i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
      return 'fp_' + Math.abs(h).toString(36);
    } catch (e) {
      return 'fp_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6);
    }
  }
  function getFingerprint() {
    var stored = localStorage.getItem(FP_KEY);
    if (!stored) { stored = generateFingerprint(); localStorage.setItem(FP_KEY, stored); }
    return stored;
  }
  function isFirstVisit() {
    if (localStorage.getItem(FV_KEY) === '1') return false;
    localStorage.setItem(FV_KEY, '1');
    return true;
  }
  function getVisitCount() {
    var vc = parseInt(localStorage.getItem(VC_KEY) || '0', 10);
    vc++;
    localStorage.setItem(VC_KEY, vc.toString());
    return vc;
  }
  function getVisitCategory(vc) {
    if (vc === 1) return 'new';
    if (vc <= 3) return 'returning';
    if (vc <= 10) return 'frequent';
    return 'loyal';
  }
  function getSessionId() {
    var s = sessionStorage.getItem(SES_KEY);
    if (!s) {
      s = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
      sessionStorage.setItem(SES_KEY, s);
    }
    return s;
  }

  /* ========================================
     2. DEVICE & TECH INTELLIGENCE
     ======================================== */
  function getDevice() {
    var ua = navigator.userAgent;
    if (/Mobile|Android(?!.*Tablet)|iPhone|iPod|webOS|BlackBerry/i.test(ua)) return 'Mobile';
    if (/iPad|Android.*Tablet|Silk|Kindle|PlayBook/i.test(ua)) return 'Tablet';
    return 'Desktop';
  }
  function detectDeviceSubtype() {
    var ua = navigator.userAgent;
    if (/SmartTV|HbbTV|NetCast|NETTV|AppleTV|tvOS|CrKey|Tizen.*TV|WebTV|GoogleTV/i.test(ua)) return 'tv';
    if (/PlayStation|Xbox|Nintendo/i.test(ua)) return 'console';
    if (/Fold|Galaxy Z|Surface Duo/i.test(ua) || (screen.width < 600 && matchMedia('(min-width:600px)').matches)) return 'foldable';
    if (/Watch|Wearable/i.test(ua)) return 'wearable';
    return 'standard';
  }
  function getBrowser() {
    var ua = navigator.userAgent;
    if (ua.includes('Edg')) return 'Edge';
    if (ua.includes('OPR') || ua.includes('Opera')) return 'Opera';
    if (ua.includes('Chrome') && !ua.includes('Edg')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
    if (ua.includes('Brave')) return 'Brave';
    if (ua.includes('Vivaldi')) return 'Vivaldi';
    return 'Other';
  }
  function getBrowserVersion() {
    var ua = navigator.userAgent;
    var m = ua.match(/(Chrome|Firefox|Safari|Edge|Opera|OPR|Brave|Vivaldi)\/(\d+[\.\d]*)/);
    return m ? m[2] : 'unknown';
  }
  function getBrowserEngine() {
    var ua = navigator.userAgent;
    if (ua.includes('AppleWebKit')) {
      if (ua.includes('Chrome') || ua.includes('Edg')) return 'Blink';
      return 'WebKit';
    }
    if (ua.includes('Gecko/')) return 'Gecko';
    if (ua.includes('Trident')) return 'Trident';
    return 'Unknown';
  }
  function getOS() {
    var ua = navigator.userAgent;
    if (ua.includes('Windows NT 10')) return 'Windows 10+';
    if (ua.includes('Windows')) return 'Windows';
    if (ua.includes('Mac OS X')) {
      var v = ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
      return v ? 'macOS ' + v[1].replace(/_/g, '.') : 'macOS';
    }
    if (ua.includes('Android')) {
      var av = ua.match(/Android (\d+[\.\d]*)/);
      return av ? 'Android ' + av[0].replace('Android ', '') : 'Android';
    }
    if (ua.includes('iPhone') || ua.includes('iPad')) {
      var iv = ua.match(/OS (\d+_\d+)/);
      return iv ? 'iOS ' + iv[1].replace('_', '.') : 'iOS';
    }
    if (ua.includes('Linux')) return 'Linux';
    if (ua.includes('CrOS')) return 'ChromeOS';
    return 'Other';
  }
  function getGPUInfo() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return;
      webglSupported = true;
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        gpuRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || 'unknown';
        gpuVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || 'unknown';
      }
    } catch (e) { }
  }
  function getRAM() { if (navigator.deviceMemory) ramEstimate = navigator.deviceMemory; }
  function getBattery() {
    if (!navigator.getBattery) return;
    try {
      navigator.getBattery().then(function (bat) {
        batteryLevel = Math.round(bat.level * 100);
        batteryCharging = bat.charging;
        bat.addEventListener('levelchange', function () {
          batteryLevel = Math.round(bat.level * 100);
          enqueue({ type: 'battery_change', page: pageName(), level: batteryLevel, charging: bat.charging });
        });
        bat.addEventListener('chargingchange', function () {
          batteryCharging = bat.charging;
          enqueue({ type: 'battery_change', page: pageName(), level: batteryLevel, charging: bat.charging });
        });
      }).catch(function () { });
    } catch (e) { }
  }
  function detectFonts() {
    try {
      var testFonts = ['Arial', 'Helvetica', 'Times New Roman', 'Courier', 'Verdana', 'Georgia',
        'Comic Sans MS', 'Impact', 'Trebuchet MS', 'Palatino', 'Lucida Console',
        'Tahoma', 'Segoe UI', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
        'Source Sans Pro', 'Noto Sans', 'Ubuntu', 'DejaVu Sans', 'Font Awesome'];
      var baseFonts = ['monospace', 'sans-serif', 'serif'];
      var span = document.createElement('span');
      span.style.cssText = 'position:absolute;left:-9999px;font-size:72px;visibility:hidden;';
      span.textContent = 'mmmmmmmmmmlli';
      document.body.appendChild(span);
      var baseWidths = {};
      baseFonts.forEach(function (bf) { span.style.fontFamily = bf; baseWidths[bf] = span.offsetWidth; });
      testFonts.forEach(function (tf) {
        var found = false;
        for (var i = 0; i < baseFonts.length; i++) {
          span.style.fontFamily = "'" + tf + "'," + baseFonts[i];
          if (span.offsetWidth !== baseWidths[baseFonts[i]]) { found = true; break; }
        }
        if (found) detectedFonts.push(tf);
      });
      document.body.removeChild(span);
    } catch (e) { }
  }
  function checkWebRTC() {
    webrtcSupported = !!(window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection);
  }
  function getDarkMode() { try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; } }
  function getReducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }
  function getInputMethod() {
    if (navigator.maxTouchPoints > 1) return 'touch';
    if ('ontouchstart' in window) return 'touch';
    return 'mouse';
  }
  function detectAdBlocker() {
    try {
      var t = document.createElement('div');
      t.innerHTML = '&nbsp;';
      t.className = 'adsbox ad-banner ad-banner-top ad_placeholder ad_wrapper';
      t.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;';
      document.body.appendChild(t);
      var blocked = (t.offsetHeight === 0 || t.offsetParent === null || t.clientHeight === 0);
      document.body.removeChild(t);
      return blocked;
    } catch (e) { return false; }
  }
  function getReferrer() {
    if (document.referrer) {
      try { return new URL(document.referrer).hostname; } catch (e) { return document.referrer.substring(0, 100); }
    }
    return 'direct';
  }
  function collectDeviceInfo() {
    if (CFG.deviceIntel.enabled) {
      getGPUInfo(); getRAM(); getBattery(); detectFonts(); checkWebRTC();
      deviceSubtype = detectDeviceSubtype(); browserEngine = getBrowserEngine();
    }
  }

  /* FIX: Internal builder — builds and caches the snapshot object */
  function _buildDeviceSnapshot() {
    _deviceSnapshotCache = {
      dev: getDevice(), devSubtype: deviceSubtype, brw: getBrowser(),
      brwVersion: getBrowserVersion(), engine: browserEngine, os: getOS(),
      scr: screen.width + 'x' + screen.height, colorDepth: screen.colorDepth,
      gpu: gpuRenderer.substring(0, 80), gpuVendor: gpuVendor.substring(0, 40),
      ram: ramEstimate, cores: navigator.hardwareConcurrency || 0,
      touchPoints: navigator.maxTouchPoints || 0,
      pixelRatio: window.devicePixelRatio || 1, battery: batteryLevel,
      batteryCharging: batteryCharging, webgl: webglSupported,
      webrtc: webrtcSupported, fontCount: detectedFonts.length,
      darkMode: getDarkMode(), reducedMotion: getReducedMotion(),
      inputMethod: getInputMethod(), adBlocker: detectAdBlocker(),
      lang: navigator.language, langs: (navigator.languages || []).slice(0, 5),
      cookiesEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack === '1',
      pdfViewer: navigator.pdfViewerEnabled !== false, online: navigator.onLine
    };
    return _deviceSnapshotCache;
  }

  /* ========================================
     3. GEO INTELLIGENCE
     ======================================== */
  function detectCountry(callback) {
    var cached = localStorage.getItem(CTRY_KEY);
    var cachedTs = parseInt(localStorage.getItem(CTRY_TS) || '0', 10);
    if (cached && (Date.now() - cachedTs) < CFG.countryCacheTTL) {
      country = cached;
      city = localStorage.getItem(CTRY_CITY_KEY) || 'unknown';
      geoReady = true;
      runVPNDetection();
      callback(cached, city);
      return;
    }
    var apis = [
      { url: 'https://ipwho.is/', parse: function (d) {
          var tz = d.timezone && d.timezone.id ? d.timezone.id : '';
          return { cc: d.country_code, city: d.city || 'unknown', region: d.region || 'unknown', isp: d.connection_isp || 'unknown', ip: d.ip || 'unknown', tz: tz };
        }},
      { url: 'https://ipapi.co/json/', parse: function (d) {
          return { cc: d.country_code, city: d.city || 'unknown', region: d.region || 'unknown', isp: d.org || 'unknown', ip: d.ip || 'unknown', tz: d.timezone || '' };
        }},
      { url: 'https://freeipapi.com/api/json', parse: function (d) {
          return { cc: d.countryCode, city: d.cityName || 'unknown', region: d.regionName || 'unknown', isp: d.isp || 'unknown', ip: d.ipAddress || 'unknown', tz: d.timeZone || '' };
        }}
    ];
    function tryApi(index) {
      if (index >= apis.length) {
        country = cached || 'unknown'; city = 'unknown'; region = 'unknown';
        geoReady = true; runVPNDetection(); callback(country, city); return;
      }
      var controller = new AbortController();
      var tid = setTimeout(function () { controller.abort(); }, CFG.geoTimeout);
      fetch(apis[index].url, { signal: controller.signal })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          clearTimeout(tid);
          try {
            var p = apis[index].parse(data);
            if (p.cc && p.cc.length === 2) {
              country = p.cc; city = p.city; region = p.region;
              isp = p.isp; ip = p.ip; ipTimezone = p.tz;
              localStorage.setItem(CTRY_KEY, country);
              localStorage.setItem(CTRY_CITY_KEY, city);
              localStorage.setItem(CTRY_TS, Date.now().toString());
              geoReady = true; runVPNDetection(); callback(country, city);
            } else { tryApi(index + 1); }
          } catch (ex) { tryApi(index + 1); }
        })
        .catch(function () { clearTimeout(tid); tryApi(index + 1); });
    }
    tryApi(0);
  }

  function runVPNDetection() {
    if (ipTimezone && ipTimezone !== 'unknown') {
      var browserTz = '';
      try { browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { }
      if (browserTz && browserTz !== ipTimezone) {
        securityFlags.tzMismatch = true;
      }
    }
    var langCountry = (navigator.language || '').split('-')[1];
    if (langCountry && country !== 'unknown' && langCountry.toLowerCase() !== country.toLowerCase()) {
      securityFlags.langCountryMismatch = true;
    }
    if (securityFlags.tzMismatch || securityFlags.langCountryMismatch) {
      var current = botScore || 0;
      var add = 0;
      if (securityFlags.tzMismatch) add += 8;
      if (securityFlags.langCountryMismatch) add += 8;
      botScore = clamp(current + add, 0, 100);
    }
  }
  function detectVPNHints() { return runVPNDetection(); }

  /* ========================================
     4. UTM & TRAFFIC SOURCE
     ======================================== */
  function parseUTM() {
    if (!CFG.utm.enabled) return;
    try {
      var params = new URLSearchParams(location.search);
      var utm = {
        source: params.get('utm_source') || '', medium: params.get('utm_medium') || '',
        campaign: params.get('utm_campaign') || '', term: params.get('utm_term') || '',
        content: params.get('utm_content') || ''
      };
      if (utm.source || utm.medium || utm.campaign) {
        utmData = utm;
        sessionStorage.setItem(UTM_KEY, JSON.stringify(utm));
      } else {
        var stored = sessionStorage.getItem(UTM_KEY);
        if (stored) { try { utmData = JSON.parse(stored); } catch (e) { } }
      }
    } catch (e) { }
  }
  function classifyTrafficSource() {
    if (utmData.source) {
      var src = utmData.source.toLowerCase();
      if (src.includes('google') && utmData.medium === 'cpc') trafficSource = 'paid_google';
      else if (src.includes('google')) trafficSource = 'organic_google';
      else if (src.includes('facebook') || src.includes('fb')) trafficSource = 'paid_social';
      else if (src.includes('instagram') || src.includes('ig')) trafficSource = 'paid_social';
      else if (src.includes('twitter') || src.includes('x.com')) trafficSource = 'paid_social';
      else if (src.includes('linkedin')) trafficSource = 'paid_social';
      else if (src.includes('tiktok')) trafficSource = 'paid_social';
      else if (utmData.medium === 'email') trafficSource = 'email';
      else if (utmData.medium === 'cpc' || utmData.medium === 'ppc') trafficSource = 'paid_ads';
      else if (utmData.medium === 'referral') trafficSource = 'referral';
      else if (utmData.medium === 'affiliate') trafficSource = 'affiliate';
      else if (utmData.medium === 'influencer') trafficSource = 'influencer';
      else trafficSource = 'campaign';
      return;
    }
    var ref = document.referrer;
    if (!ref) { trafficSource = 'direct'; return; }
    var host = '';
    try { host = new URL(ref).hostname; } catch (e) { trafficSource = 'direct'; return; }
    if (host.includes('google') || host.includes('bing') || host.includes('yahoo') ||
      host.includes('duckduckgo') || host.includes('yandex') || host.includes('baidu')) {
      trafficSource = 'organic_search';
    } else if (host.includes('facebook') || host.includes('fb') || host.includes('instagram') ||
      host.includes('twitter') || host.includes('x.com') || host.includes('linkedin') ||
      host.includes('tiktok') || host.includes('pinterest') || host.includes('reddit') ||
      host.includes('youtube') || host.includes('tumblr') || host.includes('snapchat')) {
      trafficSource = 'social';
    } else if (host === location.hostname) {
      trafficSource = 'direct';
    } else {
      trafficSource = 'referral';
    }
  }
  function writeUTMData() {
    if (!db) return;
    var td = todayKey();
    safeTx('analytics/traffic/sources/' + trafficSource, 1);
    safeTx('analytics/daily/' + td + '/trafficSources/' + trafficSource, 1);
    if (utmData.source) {
      var comboKey = [utmData.source, utmData.medium, utmData.campaign].filter(Boolean).join('|');
      var hash = 0;
      for (var i = 0; i < comboKey.length; i++) { hash = ((hash << 5) - hash) + comboKey.charCodeAt(i); hash |= 0; }
      var ck = 'utm_' + Math.abs(hash).toString(36);
      safeTx('analytics/utm/combinations/' + ck, 1);
      safeTx('analytics/utm/sources/' + utmData.source, 1);
      if (utmData.medium) safeTx('analytics/utm/mediums/' + utmData.medium, 1);
      if (utmData.campaign) safeTx('analytics/utm/campaigns/' + utmData.campaign, 1);
      if (utmData.term) safeTx('analytics/utm/terms/' + utmData.term.substring(0, 50), 1);
      if (utmData.content) safeTx('analytics/utm/contents/' + utmData.content.substring(0, 50), 1);
      safePush('analytics/utm/details/' + td, {
        source: utmData.source, medium: utmData.medium, campaign: utmData.campaign,
        term: utmData.term, content: utmData.content, page: pageName(),
        fp: fp, ts: Date.now(), converted: false
      });
    }
  }

  /* ========================================
     5. PAGE, ROUTING & JOURNEY TRACKING
     ======================================== */
  function recordJourneyStep(page, route) {
    if (!CFG.journey.enabled) return;
    var now = Date.now();
    var step = { page: page, route: route, ts: now };
    if (lastPageEnterTs > 0) step.duration = now - lastPageEnterTs;
    lastPageEnterTs = now;
    exitPage = page;
    journeySteps.push(step);
    if (journeySteps.length > CFG.maxJourneySteps) journeySteps.shift();
  }
  function flushJourney() {
    if (!db || journeySteps.length === 0) return;
    var steps = journeySteps.splice(0, journeySteps.length);
    safeSet('analytics/journeys/' + sid, {
      fp: fp, dev: getDevice(), brw: getBrowser(), country: country,
      trafficSource: trafficSource, utm: utmData,
      steps: steps, exitPage: exitPage, ts: startTs
    });
    for (var i = 0; i < steps.length - 1; i++) {
      var pathKey = steps[i].page + ' \u2192 ' + steps[i + 1].page;
      safeTx('analytics/paths/' + pathKey, 1);
    }
    if (exitPage) safeTx('analytics/exitPages/' + exitPage, 1);
  }
  function trackStateChanges() {
    window.addEventListener('hashchange', function (e) {
      var from = 'unknown', to = 'unknown', fullFrom = '', fullTo = '';
      try {
        fullFrom = new URL(e.oldURL).hash.slice(1) || 'home';
        fullTo = new URL(e.newURL).hash.slice(1) || 'home';
        from = fullFrom.split('/')[0]; to = fullTo.split('/')[0];
      } catch (ex) { }
      markInteracted(); sessionStateChanges++;
      enqueue({ type: 'route_change', from: from, to: to, fullFrom: fullFrom, fullTo: fullTo });
      recordJourneyStep(to, fullTo);
      clearTimeout(journeyFlushTimer);
      journeyFlushTimer = setTimeout(flushJourney, CFG.journeyFlushInterval);
    });
    var ignoredKeys = [FP_KEY, SES_KEY, FV_KEY, VC_KEY, CTRY_KEY, CTRY_TS, CTRY_CITY_KEY, UTM_KEY, SEC_KEY];
    window.addEventListener('storage', function (e) {
      if (e.key && ignoredKeys.indexOf(e.key) === -1) {
        markInteracted(); sessionStateChanges++;
        enqueue({ type: 'state_change', key: e.key, oldValue: (e.oldValue || '').substring(0, 80), newValue: (e.newValue || '').substring(0, 80) });
      }
    });
    var hiddenTime = 0;
    document.addEventListener('visibilitychange', function () {
      var now = Date.now();
      if (document.visibilityState === 'hidden') { hiddenTime = now; enqueue({ type: 'tab_hidden', page: pageName() }); }
      else if (hiddenTime > 0) {
        var awayMs = now - hiddenTime;
        enqueue({ type: 'tab_visible', page: pageName(), awayMs: awayMs });
        if (awayMs > 1000 && db) safeTx('analytics/daily/' + todayKey() + '/awayTime', Math.round(awayMs / 1000));
        hiddenTime = 0;
      }
    });
    window.addEventListener('orientationchange', function () {
      var orient = 'unknown';
      try { orient = screen.orientation ? screen.orientation.type : (window.innerWidth > window.innerHeight ? 'landscape-primary' : 'portrait-primary'); } catch (ex) { }
      enqueue({ type: 'orientation', page: pageName(), orientation: orient });
    });
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { enqueue({ type: 'resize', page: pageName(), w: window.innerWidth, h: window.innerHeight }); }, 2000);
    });
    window.addEventListener('online', function () { enqueue({ type: 'connection_change', page: pageName(), status: 'online' }); });
    window.addEventListener('offline', function () { enqueue({ type: 'connection_change', page: pageName(), status: 'offline' }); });
  }

  /* ========================================
     6. HEALTH & PERFORMANCE
     ======================================== */
  function capturePerformanceMetrics() {
    var m = {};
    if (window.performance && performance.timing) {
      var t = performance.timing, ns = t.navigationStart;
      if (t.loadEventEnd > 0) { m.loadTime = t.loadEventEnd - ns; m.domReady = t.domContentLoadedEventEnd - ns; }
      if (t.domainLookupEnd > 0) m.dnsTime = t.domainLookupEnd - t.domainLookupStart;
      if (t.connectEnd > 0) m.tcpTime = t.connectEnd - t.connectStart;
      if (t.responseStart > 0) m.ttfb = t.responseStart - t.requestStart;
      if (t.responseEnd > 0 && t.responseStart > 0) m.downloadTime = t.responseEnd - t.responseStart;
      if (t.secureConnectionStart > 0 && t.connectEnd > 0) m.sslTime = t.secureConnectionStart - t.connectStart;
    }
    if (navigator.connection) {
      var conn = navigator.connection;
      m.connectionType = conn.effectiveType || 'unknown'; m.downlink = conn.downlink || 0;
      m.rtt = conn.rtt || 0; m.saveData = conn.saveData || false;
    }
    m.domNodes = document.querySelectorAll('*').length;
    m.viewportW = window.innerWidth; m.viewportH = window.innerHeight;
    m.pixelRatio = window.devicePixelRatio || 1; m.touchPoints = navigator.maxTouchPoints || 0;
    if (performance.memory) { m.memoryUsed = Math.round(performance.memory.usedJSHeapSize / 1048576); m.memoryTotal = Math.round(performance.memory.totalJSHeapSize / 1048576); }
    m.darkMode = getDarkMode(); m.reducedMotion = getReducedMotion();
    m.inputMethod = getInputMethod(); m.adBlocker = detectAdBlocker();
    m.online = navigator.onLine; m.cookiesEnabled = navigator.cookieEnabled;
    m.doNotTrack = navigator.doNotTrack === '1'; m.pdfViewer = navigator.pdfViewerEnabled !== false;
    m.language = navigator.language; m.languages = (navigator.languages || []).slice(0, 5);
    m.longTaskCount = longTaskCount;
    if (Object.keys(apiLatencies).length > 0) {
      var latSum = 0, latCount = 0, latMax = 0;
      for (var k in apiLatencies) { latSum += apiLatencies[k].total; latCount += apiLatencies[k].count; latMax = Math.max(latMax, apiLatencies[k].max); }
      m.apiLatencyAvg = latCount > 0 ? Math.round(latSum / latCount) : 0;
      m.apiLatencyMax = latMax; m.apiEndpoints = Object.keys(apiLatencies).length;
    }
    m.renderBlockingCount = renderBlockingResources.length;
    healthMetrics = m; return m;
  }
  function observeModernMetrics() {
    if (!('PerformanceObserver' in window)) return;
    var td = todayKey();
    try { new PerformanceObserver(function (list) {
      if (!db) return; var entries = list.getEntries(), lcp = entries[entries.length - 1];
      healthMetrics.lcp = Math.round(lcp.startTime); safeTx('analytics/health/' + td + '/lcpSamples', 1);
      safeSet('analytics/health/' + td + '/lcpLatest', healthMetrics.lcp);
    }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) { }
    try { var clsVal = 0; new PerformanceObserver(function (list) {
      if (!db) return; list.getEntries().forEach(function (entry) { if (!entry.hadRecentInput) clsVal += entry.value; });
      healthMetrics.cls = Math.round(clsVal * 1000); safeSet('analytics/health/' + td + '/clsLatest', healthMetrics.cls);
    }).observe({ type: 'layout-shift', buffered: true }); } catch (e) { }
    try { new PerformanceObserver(function (list) {
      if (!db) return; list.getEntries().forEach(function (entry) {
        var dur = Math.round(entry.duration); healthMetrics.inp = Math.max(healthMetrics.inp || 0, dur);
        safeTx('analytics/health/' + td + '/interactionSamples', 1); safeSet('analytics/health/' + td + '/inpLatest', healthMetrics.inp);
      });
    }).observe({ type: 'first-input', buffered: true }); } catch (e) { }
    try { new PerformanceObserver(function (list) {
      if (!db) return; var count = list.getEntries().length; longTaskCount += count;
      safeTx('analytics/health/' + td + '/longTasks', count);
      if (count > 0) fireAlert('long_tasks', 'warning', 'Long tasks detected: ' + count + ' in batch', { count: count });
    }).observe({ type: 'longtask', buffered: true }); } catch (e) { }
    try { performance.getEntriesByType('paint').forEach(function (entry) {
      if (entry.name === 'first-contentful-paint') {
        healthMetrics.fcp = Math.round(entry.startTime); safeSet('analytics/health/' + td + '/fcpLatest', healthMetrics.fcp);
        safeTx('analytics/health/' + td + '/fcpSamples', 1);
      }
    }); } catch (e) { }
    try { var navEntries = performance.getEntriesByType('navigation');
      if (navEntries.length > 0) { var nav = navEntries[0]; healthMetrics.transferSize = nav.transferSize || 0; healthMetrics.encodedBodySize = nav.encodedBodySize || 0; healthMetrics.decodedBodySize = nav.decodedBodySize || 0; }
    } catch (e) { }
    try { performance.getEntriesByType('resource').forEach(function (r) {
      if (r.transferSize > 0 && r.startTime < (healthMetrics.fcp || 2000)) {
        if (r.name.match(/\.(css|js)(\?|$)/i) && r.duration > 100) {
          renderBlockingResources.push({ name: r.name.substring(0, 150), duration: Math.round(r.duration), size: r.transferSize });
        }
      }
    }); } catch (e) { }
  }
  function trackAPILatency(endpoint, durationMs) {
    if (!apiLatencies[endpoint]) apiLatencies[endpoint] = { total: 0, count: 0, max: 0 };
    apiLatencies[endpoint].total += durationMs; apiLatencies[endpoint].count++;
    apiLatencies[endpoint].max = Math.max(apiLatencies[endpoint].max, durationMs);
    if (durationMs > 3000) fireAlert('slow_api', 'warning', 'Slow API: ' + endpoint + ' took ' + durationMs + 'ms', { endpoint: endpoint, duration: durationMs });
  }
  function calculateHealthScore() {
    var score = 100, m = healthMetrics;
    if (m.loadTime) { if (m.loadTime > 6000) score -= 30; else if (m.loadTime > 4000) score -= 22; else if (m.loadTime > 2500) score -= 12; else if (m.loadTime > 1500) score -= 5; }
    if (m.lcp) { if (m.lcp > 5000) score -= 25; else if (m.lcp > 3000) score -= 18; else if (m.lcp > 2000) score -= 8; else if (m.lcp > 1200) score -= 3; }
    if (m.cls !== undefined) { var cr = m.cls / 1000; if (cr > 0.25) score -= 20; else if (cr > 0.1) score -= 12; else if (cr > 0.05) score -= 4; }
    if (m.inp) { if (m.inp > 600) score -= 15; else if (m.inp > 300) score -= 10; else if (m.inp > 150) score -= 4; }
    if (m.ttfb) { if (m.ttfb > 1200) score -= 10; else if (m.ttfb > 600) score -= 6; else if (m.ttfb > 300) score -= 2; }
    if (m.longTaskCount > 10) score -= 5;
    if (m.apiLatencyAvg > 2000) score -= 8;
    if (m.renderBlockingCount > 5) score -= 5;
    if (m.memoryUsed && m.memoryTotal && m.memoryUsed / m.memoryTotal > 0.85) score -= 8;
    return Math.max(0, Math.min(100, score));
  }
  function getHealthStatus(score) { if (score >= 80) return 'healthy'; if (score >= 55) return 'degraded'; return 'warning'; }
  function writeHealthSnapshot() {
    if (!db) return;
    var td = todayKey(), metrics = capturePerformanceMetrics(), score = calculateHealthScore(), status = getHealthStatus(score);
    var snapshot = {};
    for (var k in metrics) snapshot[k] = metrics[k];
    snapshot.pg = pageName(); snapshot.fullRoute = fullRoute(); snapshot.dev = getDevice();
    snapshot.devSubtype = deviceSubtype; snapshot.brw = getBrowser(); snapshot.os = getOS();
    snapshot.engine = browserEngine; snapshot.gpu = gpuRenderer.substring(0, 80);
    snapshot.ram = ramEstimate; snapshot.battery = batteryLevel; snapshot.country = country;
    snapshot.city = city; snapshot.region = region; snapshot.isp = isp; snapshot.ip = ip;
    snapshot.ts = Date.now(); snapshot.sid = sid; snapshot.fp = fp; snapshot.score = score;
    snapshot.status = status; snapshot.renderBlocking = renderBlockingResources.slice(0, 10);
    snapshot.apiLatencies = apiLatencies; snapshot.botScore = botScore;
    snapshot.visitorScore = visitorScore; snapshot.trafficSource = trafficSource; snapshot.utm = utmData;
    safePush('analytics/health/' + td + '/snapshots', snapshot);
    safeSet('analytics/health/latest', snapshot); safeSet('analytics/health/status', status); safeSet('analytics/health/score', score);
    safeTx('analytics/health/' + td + '/sessions', 1);
    if (metrics.loadTime) safeTx('analytics/health/' + td + '/loadTimeSum', metrics.loadTime);
    if (metrics.ttfb) safeTx('analytics/health/' + td + '/ttfbSum', metrics.ttfb);
    if (metrics.domReady) safeTx('analytics/health/' + td + '/domReadySum', metrics.domReady);
    if (metrics.transferSize) safeTx('analytics/health/' + td + '/transferSizeSum', metrics.transferSize);
    if (metrics.connectionType && metrics.connectionType !== 'unknown') safeTx('analytics/health/' + td + '/connections/' + metrics.connectionType, 1);
    if (metrics.loadTime > CFG.alertThresholds.loadTime) fireAlert('slow_page', 'warning', 'Slow page load: ' + metrics.loadTime + 'ms on ' + pageName(), { page: pageName(), loadTime: metrics.loadTime });
    if (metrics.lcp > CFG.alertThresholds.lcp) fireAlert('slow_lcp', 'warning', 'High LCP: ' + metrics.lcp + 'ms on ' + pageName(), { page: pageName(), lcp: metrics.lcp });
    if (metrics.cls !== undefined && (metrics.cls / 1000) > CFG.alertThresholds.cls) fireAlert('high_cls', 'warning', 'High CLS: ' + (metrics.cls / 1000).toFixed(3) + ' on ' + pageName(), { page: pageName(), cls: metrics.cls });
    trimNode('analytics/health/' + td + '/snapshots', CFG.maxHealthDetails);
  }
  function trackAllErrors() {
    window.addEventListener('error', function (e) {
      if (!db) return; var td = todayKey();
      if (!e.target || e.target === window) {
        safeTx('analytics/health/' + td + '/errors', 1);
        safePush('analytics/health/' + td + '/errorDetails', {
          msg: (e.message || 'Unknown error').substring(0, 300), file: (e.filename || '').substring(0, 150),
          line: e.lineno || 0, col: e.colno || 0, pg: pageName(), fullRoute: fullRoute(),
          dev: getDevice(), brw: getBrowser(), country: country, ts: Date.now()
        });
        trimNode('analytics/health/' + td + '/errorDetails', CFG.maxHealthDetails);
        var errorRateKey = 'error_rate_' + td;
        if (!lastAlertTs[errorRateKey]) lastAlertTs[errorRateKey] = 0;
        if (Date.now() - lastAlertTs[errorRateKey] > 300000) {
          fireAlert('js_error', 'error', 'JS Error: ' + (e.message || '').substring(0, 100), { file: e.filename, line: e.lineno });
          lastAlertTs[errorRateKey] = Date.now();
        }
      } else {
        safeTx('analytics/health/' + td + '/resourceErrors', 1);
        var src = '', tag = (e.target.tagName || 'unknown').toLowerCase();
        if (tag === 'img') src = 'img:' + (e.target.src || '').substring(0, 200);
        else if (tag === 'script') src = 'script:' + (e.target.src || '').substring(0, 200);
        else if (tag === 'link') src = 'css:' + (e.target.href || '').substring(0, 200);
        else src = tag + ':' + ((e.target.src || e.target.href || '').substring(0, 200));
        safePush('analytics/health/' + td + '/resourceErrorDetails', { src: src, tag: tag, pg: pageName(), country: country, ts: Date.now() });
        trimNode('analytics/health/' + td + '/resourceErrorDetails', CFG.maxHealthDetails);
        if (tag === 'a' || tag === 'link') safePush('analytics/seo/brokenLinks/' + td, { src: src, tag: tag, pg: pageName(), ts: Date.now() });
      }
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      if (!db) return; var td = todayKey();
      safeTx('analytics/health/' + td + '/unhandledRejections', 1);
      var reason = ''; try { reason = String(e.reason).substring(0, 300); } catch (ex) { reason = 'Unknown'; }
      safePush('analytics/health/' + td + '/rejectionDetails', { reason: reason, pg: pageName(), country: country, ts: Date.now() });
      trimNode('analytics/health/' + td + '/rejectionDetails', CFG.maxHealthDetails);
    });
  }

  /* ========================================
     7. HEATMAP ENGINE
     ======================================== */
  function initHeatmap() {
    if (!CFG.heatmap.enabled || !shouldSample(CFG.heatmap.sampleRate)) return;
    var cols = CFG.heatmap.gridCols, rows = CFG.heatmap.gridRows, mouseTimer = null;
    document.addEventListener('mousemove', function (e) {
      if (mouseTimer) return; mouseTimer = setTimeout(function () { mouseTimer = null; }, 100);
      var col = clamp(Math.floor((e.clientX / window.innerWidth) * cols), 0, cols - 1);
      var row = clamp(Math.floor((e.clientY / window.innerHeight) * rows), 0, rows - 1);
      var cell = col + '_' + row; mouseGrid[cell] = (mouseGrid[cell] || 0) + 1;
      if (replayActive) replayEvents.push({ t: Date.now() - replayStartTime, type: 'mouse', x: e.clientX, y: e.clientY });
    }, { passive: true });
    var clickTimestamps = {};
    document.addEventListener('click', function (e) {
      var col = clamp(Math.floor((e.clientX / window.innerWidth) * cols), 0, cols - 1);
      var row = clamp(Math.floor((e.clientY / window.innerHeight) * rows), 0, rows - 1);
      var cell = col + '_' + row; clickGrid[cell] = (clickGrid[cell] || 0) + 1;
      var now = Date.now();
      if (!clickTimestamps[cell]) clickTimestamps[cell] = [];
      clickTimestamps[cell] = clickTimestamps[cell].filter(function (t) { return now - t < 1000; });
      clickTimestamps[cell].push(now);
      if (clickTimestamps[cell].length >= 3) {
        rageClicks.push({ x: e.clientX, y: e.clientY, page: pageName(), ts: now, count: clickTimestamps[cell].length });
        if (rageClicks.length > 50) rageClicks.shift();
        enqueue({ type: 'rage_click', page: pageName(), x: e.clientX, y: e.clientY, count: clickTimestamps[cell].length });
      }
      var target = e.target;
      if (!target.closest('a, button, input, select, textarea, [role="button"], [onclick], [data-action], label')) {
        deadClicks.push({ x: e.clientX, y: e.clientY, page: pageName(), ts: now, tag: target.tagName });
        if (deadClicks.length > 50) deadClicks.shift();
        enqueue({ type: 'dead_click', page: pageName(), x: e.clientX, y: e.clientY, tag: target.tagName });
      }
    }, { passive: true });
    var scrollAttTimer, attentionStart = {};
    window.addEventListener('scroll', function () {
      clearTimeout(scrollAttTimer);
      scrollAttTimer = setTimeout(function () {
        var vh = window.innerHeight, st = window.pageYOffset, sections = 6;
        for (var s = 0; s < sections; s++) {
          var sectionTop = st + (vh / sections) * s;
          var el = document.elementFromPoint(window.innerWidth / 2, sectionTop + (vh / sections / 2));
          if (el && el !== document.documentElement && el !== document.body) {
            if (!attentionStart[s]) attentionStart[s] = Date.now();
          } else if (attentionStart[s]) {
            var dur = Date.now() - attentionStart[s];
            if (dur > 200) scrollSections[s] = (scrollSections[s] || 0) + dur;
            delete attentionStart[s];
          }
        }
      }, 300);
    }, { passive: true });
    heatmapFlushTimer = setInterval(flushHeatmap, CFG.heatmapFlushInterval);
  }
  function flushHeatmap() {
    if (!db) return; var pg = pageName(), td = todayKey();
    if (Object.keys(mouseGrid).length > 0) { var md = {}; for (var c in mouseGrid) md[c] = mouseGrid[c]; safePush('analytics/heatmaps/' + pg + '/' + td + '/mouse', { grid: md, ts: Date.now(), vp: window.innerWidth + 'x' + window.innerHeight }); mouseGrid = {}; }
    if (Object.keys(clickGrid).length > 0) { var cd = {}; for (var c2 in clickGrid) cd[c2] = clickGrid[c2]; safePush('analytics/heatmaps/' + pg + '/' + td + '/clicks', { grid: cd, ts: Date.now(), vp: window.innerWidth + 'x' + window.innerHeight }); clickGrid = {}; }
    if (Object.keys(scrollSections).length > 0) { safePush('analytics/heatmaps/' + pg + '/' + td + '/attention', { sections: scrollSections, ts: Date.now() }); scrollSections = {}; }
    if (rageClicks.length > 0) { safePush('analytics/heatmaps/' + pg + '/' + td + '/rageClicks', rageClicks.slice()); rageClicks = []; }
    if (deadClicks.length > 0) { safePush('analytics/heatmaps/' + pg + '/' + td + '/deadClicks', deadClicks.slice()); deadClicks = []; }
  }

  /* ========================================
     8. SESSION REPLAY
     ======================================== */
  function initReplay() {
    if (!CFG.replay.enabled || !shouldSample(CFG.replay.sampleRate)) return;
    replayActive = true; replayStartTime = Date.now();
    document.addEventListener('scroll', function () { if (replayActive) replayEvents.push({ t: Date.now() - replayStartTime, type: 'scroll', y: window.pageYOffset, vh: window.innerHeight, dh: document.documentElement.scrollHeight }); }, { passive: true });
    document.addEventListener('click', function (e) { if (replayActive) replayEvents.push({ t: Date.now() - replayStartTime, type: 'click', x: e.clientX, y: e.clientY, target: (e.target.tagName || '').toLowerCase(), id: (e.target.id || '').substring(0, 40), cls: (e.target.className || '').substring(0, 60) }); }, { passive: true });
    document.addEventListener('input', function (e) { if (!replayActive || !e.target) return; var el = e.target; replayEvents.push({ t: Date.now() - replayStartTime, type: 'input', tag: el.tagName, id: (el.id || '').substring(0, 40), valueLen: (el.value || '').length, inputType: el.type }); }, { passive: true });
    document.addEventListener('focusin', function (e) { if (replayActive) replayEvents.push({ t: Date.now() - replayStartTime, type: 'focus', tag: (e.target.tagName || '').toLowerCase(), id: (e.target.id || '').substring(0, 40) }); }, { passive: true });
    window.addEventListener('resize', function () { if (replayActive) replayEvents.push({ t: Date.now() - replayStartTime, type: 'resize', w: window.innerWidth, h: window.innerHeight }); });
    setInterval(function () { if (replayActive) replayEvents.push({ t: Date.now() - replayStartTime, type: 'dom_snapshot', data: captureDomSummary() }); }, CFG.replay.snapshotInterval);
    window.addEventListener('hashchange', function () { if (replayActive) replayEvents.push({ t: Date.now() - replayStartTime, type: 'navigate', url: location.hash.slice(1) || 'home' }); });
    replayFlushTimer = setInterval(flushReplay, CFG.replayFlushInterval);
    setTimeout(function () { if (replayActive) stopReplay(); }, CFG.replay.maxDuration);
  }
  function captureDomSummary() {
    try { return { title: (document.title || '').substring(0, 100), url: location.hash.slice(1) || 'home', textLen: (document.body.innerText || '').length, nodeCount: document.querySelectorAll('*').length, formCount: document.querySelectorAll('form').length, imgCount: document.querySelectorAll('img').length, linkCount: document.querySelectorAll('a[href]').length, inputCount: document.querySelectorAll('input, select, textarea').length, visibleHeight: document.documentElement.scrollHeight, viewportH: window.innerHeight }; } catch (e) { return { error: true }; }
  }
  function flushReplay() {
    if (!db || !replayActive || replayEvents.length === 0) return;
    var events = replayEvents.splice(0, replayEvents.length);
    safeSet('analytics/replays/' + sid, { fp: fp, dev: getDevice(), brw: getBrowser(), country: country, startTs: replayStartTime, endTs: Date.now(), pageCount: sessionPageViews, clickCount: sessionClicks, events: events, eventCount: events.length });
    trimNode('analytics/replays', 200);
  }
  function stopReplay() { replayActive = false; if (replayFlushTimer) clearInterval(replayFlushTimer); flushReplay(); }

  /* ========================================
     9. FORM ANALYTICS
     ======================================== */
  function initFormAnalytics() {
    if (!CFG.formAnalytics.enabled) return;
    document.addEventListener('focusin', function (e) {
      var field = e.target; if (!field || !field.form) return;
      var formId = field.form.id || field.form.action || field.form.className || 'form_' + Array.from(document.forms).indexOf(field.form);
      var fieldName = field.name || field.id || field.type || field.tagName.toLowerCase();
      activeFormId = formId; var key = formId + '|' + fieldName;
      if (!formFields[key]) formFields[key] = { formId: formId, field: fieldName, focusCount: 0, errorCount: 0, charsTyped: 0, firstFocusTs: Date.now(), lastFocusTs: 0, totalFocusTime: 0, typingSamples: [], abandoned: false, submitted: false };
      formFields[key].focusCount++; formFields[key].lastFocusTs = Date.now(); formFields[key]._focusStart = Date.now();
    });
    document.addEventListener('focusout', function (e) {
      var field = e.target; if (!field || !field.form) return;
      var formId = field.form.id || field.form.action || field.form.className || 'form_' + Array.from(document.forms).indexOf(field.form);
      var fieldName = field.name || field.id || field.type || field.tagName.toLowerCase();
      var key = formId + '|' + fieldName;
      if (formFields[key] && formFields[key]._focusStart) { formFields[key].totalFocusTime += Date.now() - formFields[key]._focusStart; delete formFields[key]._focusStart; }
    });
    document.addEventListener('input', function (e) {
      var field = e.target; if (!field || !field.form) return;
      var formId = field.form.id || field.form.action || field.form.className || 'form_' + Array.from(document.forms).indexOf(field.form);
      var fieldName = field.name || field.id || field.type || field.tagName.toLowerCase();
      var key = formId + '|' + fieldName; if (!formFields[key]) return;
      formFields[key].charsTyped++;
      var now = Date.now();
      if (formFields[key]._lastInputTs) { var gap = now - formFields[key]._lastInputTs; if (gap < 2000) { formFields[key].typingSamples.push(gap); if (formFields[key].typingSamples.length > 50) formFields[key].typingSamples.shift(); } }
      formFields[key]._lastInputTs = now;
    });
    document.addEventListener('invalid', function (e) {
      var field = e.target; if (!field || !field.form) return;
      var formId = field.form.id || field.form.action || field.form.className || 'form_' + Array.from(document.forms).indexOf(field.form);
      var fieldName = field.name || field.id || field.type || field.tagName.toLowerCase();
      var key = formId + '|' + fieldName; if (!formFields[key]) return;
      formFields[key].errorCount++;
      enqueue({ type: 'form_error', page: pageName(), formId: formId, field: fieldName, validationMsg: (field.validationMessage || '').substring(0, 80) });
    }, true);
    document.addEventListener('submit', function (e) {
      var form = e.target; if (!form) return;
      var formId = form.id || form.action || form.className || 'form_' + Array.from(document.forms).indexOf(form);
      markInteracted(); enqueue({ type: 'form_submit', page: pageName(), formId: formId.substring(0, 80) });
      for (var key in formFields) { if (formFields[key].formId === formId) formFields[key].submitted = true; }
      flushFormAnalytics(formId, false);
    });
    window.addEventListener('beforeunload', function () {
      for (var key in formFields) { if (!formFields[key].submitted && formFields[key].focusCount > 0) formFields[key].abandoned = true; }
      flushFormAnalytics(null, true);
    });
  }
  function flushFormAnalytics(specificFormId, isExit) {
    if (!db) return;
    for (var key in formFields) {
      var f = formFields[key];
      if (specificFormId && f.formId !== specificFormId) continue;
      if (!isExit && f.submitted) continue;
      if (f.focusCount === 0) continue;
      var avgTypingSpeed = 0;
      if (f.typingSamples.length > 2) { var sum = 0; f.typingSamples.forEach(function (s) { sum += s; }); avgTypingSpeed = Math.round(sum / f.typingSamples.length); }
      safePush('analytics/forms/' + f.formId + '/fields/' + f.field, { formId: f.formId, field: f.field, page: pageName(), focusCount: f.focusCount, errorCount: f.errorCount, charsTyped: f.charsTyped, totalFocusTime: f.totalFocusTime, avgTypingSpeed: avgTypingSpeed, abandoned: f.abandoned, submitted: f.submitted, ts: Date.now(), country: country });
      safeTx('analytics/forms/' + f.formId + '/totalFocuses', f.focusCount);
      if (f.errorCount > 0) safeTx('analytics/forms/' + f.formId + '/totalErrors', f.errorCount);
      if (f.submitted) safeTx('analytics/forms/' + f.formId + '/submissions', 1);
      if (f.abandoned) safeTx('analytics/forms/' + f.formId + '/abandonments', 1);
      if (f.errorCount >= 2) safeTx('analytics/forms/' + f.formId + '/problematicFields/' + f.field, f.errorCount);
      delete formFields[key];
    }
  }

  /* ========================================
     10. SECURITY ENGINE
     ======================================== */
  function initSecurity() {
    if (!CFG.security.enabled) return;
    var botIndicators = 0;
    if (navigator.webdriver === true) { botIndicators += 40; securityFlags.webdriver = true; }
    if (window.callPhantom || window._phantom) { botIndicators += 35; securityFlags.phantom = true; }
    if (window.__nightmare) { botIndicators += 35; securityFlags.nightmare = true; }
    if (navigator.plugins.length === 0 && getBrowser() === 'Chrome') { botIndicators += 10; securityFlags.noPlugins = true; }
    if (navigator.languages === undefined) { botIndicators += 10; securityFlags.noLanguages = true; }
    var ua = navigator.userAgent;
    if (/bot|crawl|spider|scrape|slurp|mediapartners|preview|fetch|curl|wget|python|java|httpclient/i.test(ua)) { botIndicators += 50; securityFlags.botUA = true; }
    var devtoolsOpen = false, threshold = 160;
    var checkDevTools = function () {
      if (window.outerWidth - window.innerWidth > threshold || window.outerHeight - window.innerHeight > threshold) { if (!devtoolsOpen) { devtoolsOpen = true; securityFlags.devtools = true; botIndicators += 5; } } else { devtoolsOpen = false; }
    };
    setInterval(checkDevTools, 3000);
    var navTimes = [];
    window.addEventListener('hashchange', function () { var now = Date.now(); navTimes.push(now); navTimes = navTimes.filter(function (t) { return now - t < 10000; }); if (navTimes.length > 15) { securityFlags.rapidNav = true; botIndicators += 20; } });
    var clickTimes = [];
    document.addEventListener('click', function () { var now = Date.now(); clickTimes.push(now); clickTimes = clickTimes.filter(function (t) { return now - t < 5000; }); if (clickTimes.length > 20) { securityFlags.rapidClicks = true; botIndicators += 15; } });
    var mouseMoved = false;
    document.addEventListener('mousemove', function () { mouseMoved = true; }, { passive: true });
    setTimeout(function () { if (!mouseMoved && Date.now() - startTs > 5000) { securityFlags.noMouse = true; botIndicators += 15; } }, 8000);
    botScore = clamp(botIndicators, 0, 100);
    localStorage.setItem(SEC_KEY, botScore.toString());
    if (db) {
      safeSet('analytics/security/botScores/' + fp, { score: botScore, flags: securityFlags, ua: ua.substring(0, 200), dev: getDevice(), brw: getBrowser(), country: country, isp: isp, ip: ip, ts: Date.now(), sid: sid });
      if (botScore > 50) {
        safePush('analytics/security/suspicious/' + todayKey(), { fp: fp, score: botScore, flags: securityFlags, country: country, isp: isp, ip: ip, dev: getDevice(), ts: Date.now(), sid: sid });
        fireAlert('bot_detected', 'critical', 'High bot score: ' + botScore, { fp: fp, flags: securityFlags, ip: ip });
      }
      if (securityFlags.botUA) {
        safeTx('analytics/security/crawlers', 1);
        var crawlerName = ua.match(/(Googlebot|Bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|facebot|ia_archiver)/i);
        if (crawlerName) safeTx('analytics/security/crawlers/' + crawlerName[1].toLowerCase(), 1);
      }
    }
  }

  /* ========================================
     11. FUNNEL ENGINE
     ======================================== */
  function defineFunnel(funnelId, steps) { if (!CFG.funnels.enabled) return; definedFunnels[funnelId] = { steps: steps, definedAt: Date.now() }; }
  function trackFunnelStep(funnelId, stepName) {
    if (!CFG.funnels.enabled || !db) return;
    var funnel = definedFunnels[funnelId]; if (!funnel) return;
    var stepIndex = funnel.steps.indexOf(stepName); if (stepIndex === -1) return;
    if (!activeFunnels[funnelId]) activeFunnels[funnelId] = { startedAt: Date.now(), currentStep: -1, completed: false };
    var af = activeFunnels[funnelId];
    if (stepIndex === af.currentStep + 1) {
      af.currentStep = stepIndex;
      safeTx('analytics/funnels/' + funnelId + '/steps/' + stepName + '/entries', 1);
      var timeToStep = Date.now() - af.startedAt;
      safeTx('analytics/funnels/' + funnelId + '/steps/' + stepName + '/timeSum', timeToStep);
      safeTx('analytics/funnels/' + funnelId + '/steps/' + stepName + '/timeSamples', 1);
      if (stepIndex === funnel.steps.length - 1) {
        af.completed = true; safeTx('analytics/funnels/' + funnelId + '/completions', 1);
        var totalTime = Date.now() - af.startedAt;
        safeTx('analytics/funnels/' + funnelId + '/completionTimeSum', totalTime);
        safeTx('analytics/funnels/' + funnelId + '/completionTimeSamples', 1);
        enqueue({ type: 'funnel_complete', funnelId: funnelId, duration: totalTime });
      }
      if (stepIndex > 0) { var prevStep = funnel.steps[stepIndex - 1]; safeTx('analytics/funnels/' + funnelId + '/dropoffs/' + prevStep, 1); }
    }
  }

  /* ========================================
     12. ALERT ENGINE
     ======================================== */
  function fireAlert(type, severity, message, data) {
    if (!CFG.alerts.enabled || !db) return;
    var rateKey = type + '_' + Math.floor(Date.now() / 3600000);
    if (alertsFired[rateKey] && alertsFired[rateKey] >= 3) return;
    alertsFired[rateKey] = (alertsFired[rateKey] || 0) + 1;
    var dayKey = todayKey();
    if (alertsFired[dayKey] && alertsFired[dayKey] >= CFG.maxAlertsPerDay) return;
    alertsFired[dayKey] = (alertsFired[dayKey] || 0) + 1;
    safePush('analytics/alerts/' + dayKey, { type: type, severity: severity, message: message.substring(0, 300), data: data || {}, page: pageName(), country: country, fp: fp, ts: Date.now(), dispatched: false });
  }

  /* ========================================
     13. AI SCORING
     ======================================== */
  function calculateVisitorScore() {
    if (!CFG.aiScoring.enabled) return 50;
    var score = 0, dur = (Date.now() - startTs) / 1000;
    score += clamp(Math.floor(dur / 10), 0, 20);
    score += clamp(sessionPageViews * 5, 0, 15);
    score += clamp(Math.floor(sessionClicks / 3), 0, 10);
    score += clamp(Math.floor(sessionScrollMax / 10), 0, 10);
    score += clamp(sessionSearches * 4, 0, 8);
    var vc = parseInt(localStorage.getItem(VC_KEY) || '1', 10);
    if (vc > 1) score += clamp(vc * 2, 0, 12);
    score += clamp(sessionFeatureUsage * 2, 0, 10);
    score += clamp(sessionAIQueries * 4, 0, 8);
    score += clamp(Object.keys(formFields).length * 2, 0, 7);
    score -= Math.floor(botScore * 0.3);
    if (dur > 60 && !hasInteracted) score -= 15;
    visitorScore = clamp(score, 0, 100); return visitorScore;
  }
  function detectAnomalies() {
    if (!CFG.aiScoring.enabled || !db) return;
    var dur = (Date.now() - startTs) / 1000;
    if (dur > 300 && !hasInteracted) { anomalyFlags.push({ type: 'ghost_session', duration: Math.round(dur) }); fireAlert('anomaly_ghost', 'warning', 'Ghost session: ' + Math.round(dur) + 's no interaction', { duration: dur }); }
    if (sessionStateChanges > 20 && dur < 60) anomalyFlags.push({ type: 'rapid_navigation', changes: sessionStateChanges, duration: Math.round(dur) });
    if (sessionScrollMax === 100 && dur < 3) anomalyFlags.push({ type: 'instant_scroll' });
  }
  function writeAIScores() {
    if (!db) return; var score = calculateVisitorScore();
    safeSet('analytics/ai/visitorScores/' + fp, { score: score, factors: { duration: Math.round((Date.now() - startTs) / 1000), pageViews: sessionPageViews, clicks: sessionClicks, scrollMax: sessionScrollMax, searches: sessionSearches, featureUsage: sessionFeatureUsage, aiQueries: sessionAIQueries, botScore: botScore, hasInteracted: hasInteracted }, country: country, dev: getDevice(), ts: Date.now(), sid: sid });
    if (anomalyFlags.length > 0) safePush('analytics/ai/anomalies/' + todayKey(), { fp: fp, anomalies: anomalyFlags, country: country, ts: Date.now(), sid: sid });
    var segment = 'low'; if (score >= 70) segment = 'high'; else if (score >= 40) segment = 'medium';
    safeTx('analytics/ai/segments/' + segment, 1);
    safeTx('analytics/ai/segmentScores/' + segment + 'Sum', score);
    safeTx('analytics/ai/segmentScores/' + segment + 'Samples', 1);
  }

  /* ========================================
     14. SEO MONITOR
     ======================================== */
  function scanSEO() {
    if (!CFG.seo.enabled) return;
    var issues = [], score = 100, pg = pageName();
    var title = document.title || '';
    if (!title || title.length === 0) { issues.push({ type: 'error', msg: 'Missing title tag' }); score -= 15; }
    else if (title.length < 10) { issues.push({ type: 'warning', msg: 'Title too short: ' + title.length + ' chars' }); score -= 5; }
    else if (title.length > 60) { issues.push({ type: 'warning', msg: 'Title too long: ' + title.length + ' chars (max 60)' }); score -= 5; }
    var metaDesc = document.querySelector('meta[name="description"]');
    var descContent = metaDesc ? (metaDesc.getAttribute('content') || '') : '';
    if (!descContent) { issues.push({ type: 'error', msg: 'Missing meta description' }); score -= 10; }
    else if (descContent.length < 50) { issues.push({ type: 'warning', msg: 'Meta description too short' }); score -= 3; }
    else if (descContent.length > 160) { issues.push({ type: 'warning', msg: 'Meta description too long' }); score -= 3; }
    var metaRobots = document.querySelector('meta[name="robots"]');
    var robotsContent = metaRobots ? (metaRobots.getAttribute('content') || '') : '';
    if (robotsContent.includes('noindex')) { issues.push({ type: 'warning', msg: 'Page has noindex directive' }); score -= 20; }
    if (!document.querySelector('link[rel="canonical"]')) { issues.push({ type: 'info', msg: 'Missing canonical URL' }); score -= 3; }
    var ogTags = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'], ogMissing = [];
    ogTags.forEach(function (tag) { if (!document.querySelector('meta[property="' + tag + '"]')) ogMissing.push(tag); });
    if (ogMissing.length > 0) { issues.push({ type: 'info', msg: 'Missing OG tags: ' + ogMissing.join(', ') }); score -= ogMissing.length * 1; }
    var tcTags = ['twitter:card', 'twitter:title', 'twitter:description'], tcMissing = [];
    tcTags.forEach(function (tag) { if (!document.querySelector('meta[name="' + tag + '"]')) tcMissing.push(tag); });
    if (tcMissing.length === 3) { issues.push({ type: 'info', msg: 'Missing Twitter Card tags' }); score -= 2; }
    var h1s = document.querySelectorAll('h1');
    if (h1s.length === 0) { issues.push({ type: 'error', msg: 'Missing H1 tag' }); score -= 10; }
    else if (h1s.length > 1) { issues.push({ type: 'warning', msg: 'Multiple H1 tags: ' + h1s.length }); score -= 3; }
    if (document.querySelectorAll('h2').length === 0) { issues.push({ type: 'info', msg: 'No H2 tags found' }); score -= 2; }
    var jsonLd = document.querySelectorAll('script[type="application/ld+json"]');
    if (jsonLd.length === 0) { issues.push({ type: 'info', msg: 'No structured data (JSON-LD) found' }); score -= 3; }
    else { var sdValid = true; jsonLd.forEach(function (el) { try { JSON.parse(el.textContent); } catch (e) { sdValid = false; issues.push({ type: 'error', msg: 'Invalid JSON-LD' }); score -= 5; } }); }
    var imgs = document.querySelectorAll('img'), imgNoAlt = 0;
    imgs.forEach(function (img) { if (!img.getAttribute('alt') && !img.hasAttribute('aria-hidden')) imgNoAlt++; });
    if (imgNoAlt > 0) { issues.push({ type: 'warning', msg: imgNoAlt + ' images missing alt text' }); score -= clamp(imgNoAlt, 0, 5); }
    var links = document.querySelectorAll('a[href]'), emptyLinks = 0;
    links.forEach(function (a) { if (!a.textContent.trim() && !a.getAttribute('aria-label')) emptyLinks++; });
    if (emptyLinks > 0) { issues.push({ type: 'warning', msg: emptyLinks + ' links missing text/aria-label' }); score -= clamp(emptyLinks, 0, 3); }
    if (!document.documentElement.getAttribute('lang')) { issues.push({ type: 'warning', msg: 'Missing html lang attribute' }); score -= 3; }
    if (!document.querySelector('meta[name="viewport"]')) { issues.push({ type: 'error', msg: 'Missing viewport meta tag' }); score -= 10; }
    seoData = { page: pg, score: clamp(score, 0, 100), issues: issues, title: title.substring(0, 100), description: descContent.substring(0, 200), h1Count: h1s.length, h2Count: document.querySelectorAll('h2').length, imgCount: imgs.length, imgNoAlt: imgNoAlt, linkCount: links.length, jsonLdCount: jsonLd.length, hasCanonical: !!document.querySelector('link[rel="canonical"]'), hasViewport: !!document.querySelector('meta[name="viewport"]'), robots: robotsContent, ts: Date.now() };
    if (db) {
      safeSet('analytics/seo/pages/' + pg, seoData);
      safeTx('analytics/seo/pages/' + pg + '/scoreSum', seoData.score);
      safeTx('analytics/seo/pages/' + pg + '/scoreSamples', 1);
      safeTx('analytics/seo/globalScoreSum', seoData.score);
      safeTx('analytics/seo/globalScoreSamples', 1);
      if (issues.filter(function (i) { return i.type === 'error'; }).length > 0) fireAlert('seo_issues', 'warning', 'SEO issues on ' + pg + ': ' + issues.filter(function (i) { return i.type === 'error'; }).length + ' errors', { page: pg, issues: issues });
    }
  }

  /* ========================================
     15. BEHAVIOR TRACKING
     ======================================== */
  function trackScrollDepth() {
    var reported = {}, milestones = [25, 50, 75, 90, 100], scrollTimer;
    window.addEventListener('scroll', function () {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        var st = window.pageYOffset || document.documentElement.scrollTop;
        var dh = document.documentElement.scrollHeight - window.innerHeight;
        var pct = dh > 0 ? Math.min(100, Math.round((st / dh) * 100)) : 0;
        milestones.forEach(function (m) { if (pct >= m && !reported[m]) { reported[m] = true; markInteracted(); enqueue({ type: 'scroll', page: pageName(), depth: m }); } });
      }, 150);
    }, { passive: true });
  }
  function trackSearchQueries() {
    var searchTimers = {};
    document.addEventListener('input', function (e) {
      var el = e.target; if (!el) return;
      var isSearch = el.type === 'search' || (el.placeholder && /search|بحث|chercher|buscar|rechercher|找/i.test(el.placeholder)) || (el.name && /search|query|q|keyword/i.test(el.name)) || (el.id && /search|query/i.test(el.id)) || el.closest('.search-box, .search-bar, .search-container, [role="search"]');
      if (!isSearch) return;
      var elId = el.id || el.name || el.placeholder || 'search';
      clearTimeout(searchTimers[elId]);
      searchTimers[elId] = setTimeout(function () { var query = el.value.trim(); if (query.length >= 2) { markInteracted(); enqueue({ type: 'search', page: pageName(), query: query }); } }, 1200);
    });
    document.addEventListener('submit', function (e) {
      var form = e.target; if (!form) return;
      var input = form.querySelector('input[type="search"], input[type="text"][name*="search"], input[type="text"][name*="q"], input[name*="search"], input[name*="query"], input[name*="keyword"]');
      if (input && input.value.trim().length >= 2) { markInteracted(); enqueue({ type: 'search_submit', page: pageName(), query: input.value.trim() }); }
    });
  }
  function trackExternalLinks() {
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href]'); if (!link) return; var href = link.href || '';
      var isExternal = href.startsWith('http') && !href.includes(location.hostname);
      var isDownload = link.hasAttribute('download') || /\.(pdf|zip|rar|7z|doc|docx|xls|xlsx|ppt|pptx|csv|txt|exe|dmg|apk|mp[34]|wav|ogg|avi|mov)(\?|#|$)/i.test(href);
      if (isExternal) { markInteracted(); enqueue({ type: 'external_link', page: pageName(), url: href.substring(0, 250), label: (link.textContent || '').trim().substring(0, 80) }); }
      if (isDownload) { markInteracted(); enqueue({ type: 'download', page: pageName(), url: href.substring(0, 250), label: (link.textContent || '').trim().substring(0, 80) }); }
      if (href.startsWith('mailto:')) { markInteracted(); enqueue({ type: 'mailto', page: pageName(), email: href.replace('mailto:', '').substring(0, 80) }); }
      if (href.startsWith('tel:')) { markInteracted(); enqueue({ type: 'tel_click', page: pageName(), phone: href.replace('tel:', '').substring(0, 30) }); }
    });
  }
  function detectBounce() {
    window.addEventListener('beforeunload', function () {
      if (bounceRecorded) return; var elapsed = Date.now() - startTs;
      if (elapsed < 5000 && !hasInteracted) { bounceRecorded = true; if (db) safeTx('analytics/daily/' + todayKey() + '/bounces', 1); }
      exitPage = pageName();
    });
  }

  /* ========================================
     16. QUEUE & FLUSH ENGINE
     ======================================== */
  function enqueue(event) {
    eventQueue.push({
      ts: Date.now(), fp: fp, sid: sid,
      dev: getDevice(), devSubtype: deviceSubtype,
      brw: getBrowser(), brwVersion: getBrowserVersion(),
      engine: browserEngine, os: getOS(),
      scr: screen.width + 'x' + screen.height,
      gpu: gpuRenderer.substring(0, 60), ram: ramEstimate, battery: batteryLevel,
      ref: getReferrer(), country: country, city: city, isp: isp,
      trafficSource: trafficSource, utm: utmData,
      type: event.type, page: event.page, label: event.label || '',
      depth: event.depth, from: event.from, to: event.to,
      fullFrom: event.fullFrom || '', fullTo: event.fullTo || '',
      key: event.key || '', oldValue: event.oldValue || '', newValue: event.newValue || '',
      query: event.query || '', formId: event.formId || '',
      field: event.field || '',
      url: event.url || '', email: event.email || '', phone: event.phone || '',
      awayMs: event.awayMs || 0, orientation: event.orientation || '',
      w: event.w || 0, h: event.h || 0, status: event.status || '',
      isNew: event.isNew || false, visitCount: event.visitCount || 0,
      eventType: event.eventType || '', data: event.data || {},
      feature: event.feature || '', action: event.action || '',
      widget: event.widget || '', metadata: event.metadata || {},
      x: event.x || 0, y: event.y || 0, count: event.count || 0,
      tag: event.tag || '', validationMsg: event.validationMsg || '',
      funnelId: event.funnelId || '', duration: event.duration || 0
    });
    if (eventQueue.length >= CFG.maxQueue) flushQueue();
  }
  function computeEngagementScore() {
    var timePts = Math.min(30, Math.floor((Date.now() - startTs) / 6000));
    var viewsPts = Math.min(20, sessionPageViews * 5);
    var clicksPts = Math.min(20, sessionClicks * 2);
    var scrollPts = Math.min(15, Math.floor(sessionScrollMax / 100 * 15));
    var searchPts = Math.min(10, sessionSearches * 5);
    var statePts = Math.min(5, sessionStateChanges);
    var featurePts = Math.min(15, sessionFeatureUsage * 3);
    var aiPts = Math.min(10, sessionAIQueries * 5);
    return Math.min(100, timePts + viewsPts + clicksPts + scrollPts + searchPts + statePts + featurePts + aiPts);
  }
  function flushQueue() {
    if (!db || eventQueue.length === 0) return;
    var batch = eventQueue.splice(0, eventQueue.length), td = todayKey();
    var views = 0, clickCount = 0, routeChanges = 0, formSubmits = 0;
    var externalLinks = 0, downloads = 0, mailtos = 0, telClicks = 0;
    var tabHides = 0, connChanges = 0, aiQueries = 0;
    var rageClickCount = 0, deadClickCount = 0;
    var pageViews = {}, pageClicks = {}, clickDetails = [];
    var referrers = {}, devices = {}, browsers = {}, engines = {}, devSubtypes = {};
    var scrollCounts = {}, stateChangeKeys = {}, searchQueries = {};
    var customEvents = {}, orientations = {};
    var routeFlows = {}, featureUsage = {}, dashboardInteractions = {}, aiInteractions = {};
    var formErrors = {}, gpus = {};
    batch.forEach(function (ev) {
      switch (ev.type) {
        case 'view': views++; sessionPageViews++; pageViews[ev.page] = (pageViews[ev.page] || 0) + 1; break;
        case 'click': clickCount++; sessionClicks++; pageClicks[ev.page] = (pageClicks[ev.page] || 0) + 1; if (clickDetails.length < 20) clickDetails.push({ page: ev.page, label: ev.label.substring(0, 80), dev: ev.dev, brw: ev.brw, country: ev.country, ts: ev.ts }); break;
        case 'scroll': var dk = ev.depth + '%'; scrollCounts[dk] = (scrollCounts[dk] || 0) + 1; sessionScrollMax = Math.max(sessionScrollMax, ev.depth); break;
        case 'route_change': routeChanges++; if (ev.from && ev.to) { var fk = ev.from + ' \u2192 ' + ev.to; routeFlows[fk] = (routeFlows[fk] || 0) + 1; } break;
        case 'state_change': stateChangeKeys[ev.key] = (stateChangeKeys[ev.key] || 0) + 1; break;
        case 'search': case 'search_submit': var q = ev.query.toLowerCase().trim().substring(0, 60); if (q) { searchQueries[q] = (searchQueries[q] || 0) + 1; sessionSearches++; } break;
        case 'form_submit': formSubmits++; break;
        case 'form_error': var feKey = ev.formId + '|' + ev.field; formErrors[feKey] = (formErrors[feKey] || 0) + 1; break;
        case 'external_link': externalLinks++; break;
        case 'download': downloads++; break;
        case 'mailto': mailtos++; break;
        case 'tel_click': telClicks++; break;
        case 'custom': var cKey = ev.eventType + (ev.label ? '/' + ev.label : ''); customEvents[cKey] = (customEvents[cKey] || 0) + 1; break;
        case 'tab_hidden': tabHides++; break;
        case 'connection_change': connChanges++; break;
        case 'orientation': orientations[ev.orientation] = (orientations[ev.orientation] || 0) + 1; break;
        case 'rage_click': rageClickCount++; break;
        case 'dead_click': deadClickCount++; break;
        case 'feature_usage': sessionFeatureUsage++; var fuKey = ev.feature + ':' + ev.action; featureUsage[fuKey] = (featureUsage[fuKey] || 0) + 1; break;
        case 'dashboard_interaction': var diKey = ev.widget + ':' + ev.action; dashboardInteractions[diKey] = (dashboardInteractions[diKey] || 0) + 1; break;
        case 'ai_interaction': sessionAIQueries++; aiQueries++; var aiKey = ev.action || 'query'; aiInteractions[aiKey] = (aiInteractions[aiKey] || 0) + 1; break;
        case 'funnel_complete': break;
      }
      if (ev.ref) referrers[ev.ref] = (referrers[ev.ref] || 0) + 1;
      devices[ev.dev] = (devices[ev.dev] || 0) + 1;
      browsers[ev.brw] = (browsers[ev.brw] || 0) + 1;
      if (ev.engine) engines[ev.engine] = (engines[ev.engine] || 0) + 1;
      if (ev.devSubtype && ev.devSubtype !== 'standard') devSubtypes[ev.devSubtype] = (devSubtypes[ev.devSubtype] || 0) + 1;
      if (ev.gpu && ev.gpu !== 'unknown') gpus[ev.gpu] = (gpus[ev.gpu] || 0) + 1;
    });
    var updates = {};
    var dur = Math.round((Date.now() - startTs) / 1000);
    if (dur >= 2) { updates['analytics/daily/' + td + '/duration'] = dur; safeTx('analytics/daily/' + td + '/sessions', 1); }
    updates['analytics/daily/' + td + '/engagement'] = computeEngagementScore();
    clickDetails.forEach(function (ev) { var pk = db.ref('analytics/recent').push().key; updates['analytics/recent/' + pk] = ev; });
    if (Object.keys(updates).length > 0) safeUpdate(updates);
    if (views > 0) safeTx('analytics/daily/' + td + '/views', views);
    if (clickCount > 0) safeTx('analytics/daily/' + td + '/clicks', clickCount);
    if (routeChanges > 0) safeTx('analytics/daily/' + td + '/routeChanges', routeChanges);
    if (formSubmits > 0) safeTx('analytics/daily/' + td + '/formSubmits', formSubmits);
    if (externalLinks > 0) safeTx('analytics/daily/' + td + '/externalLinks', externalLinks);
    if (downloads > 0) safeTx('analytics/daily/' + td + '/downloads', downloads);
    if (mailtos > 0) safeTx('analytics/daily/' + td + '/mailtos', mailtos);
    if (telClicks > 0) safeTx('analytics/daily/' + td + '/telClicks', telClicks);
    if (tabHides > 0) safeTx('analytics/daily/' + td + '/tabHides', tabHides);
    if (connChanges > 0) safeTx('analytics/daily/' + td + '/connectionChanges', connChanges);
    if (aiQueries > 0) safeTx('analytics/daily/' + td + '/aiQueries', aiQueries);
    if (rageClickCount > 0) safeTx('analytics/daily/' + td + '/rageClicks', rageClickCount);
    if (deadClickCount > 0) safeTx('analytics/daily/' + td + '/deadClicks', deadClickCount);
    for (var pg in pageViews) safeTx('analytics/pages/' + pg + '/views', pageViews[pg]);
    for (var pg2 in pageClicks) safeTx('analytics/pages/' + pg2 + '/clicks', pageClicks[pg2]);
    for (var dk2 in scrollCounts) safeTx('analytics/daily/' + td + '/scroll/' + dk2, scrollCounts[dk2]);
    for (var rf in routeFlows) safeTx('analytics/routeFlows/' + rf, routeFlows[rf]);
    for (var ref in referrers) safeTx('analytics/referrers/' + ref, referrers[ref]);
    for (var dev in devices) safeTx('analytics/devices/' + dev, devices[dev]);
    for (var brw in browsers) safeTx('analytics/browsers/' + brw, browsers[brw]);
    for (var eng in engines) safeTx('analytics/engines/' + eng, engines[eng]);
    for (var ds in devSubtypes) safeTx('analytics/deviceSubtypes/' + ds, devSubtypes[ds]);
    for (var gpu in gpus) safeTx('analytics/gpus/' + gpu.substring(0, 60), gpus[gpu]);
    if (country !== 'unknown') { safeTx('analytics/countries/' + country, 1); safeTx('analytics/daily/' + td + '/countries/' + country, 1); }
    if (city !== 'unknown' && country !== 'unknown') safeTx('analytics/cities/' + country + '/' + city, 1);
    if (region !== 'unknown' && country !== 'unknown') safeTx('analytics/regions/' + country + '/' + region, 1);
    if (isp !== 'unknown') safeTx('analytics/isps/' + isp.substring(0, 60), 1);
    for (var sk in stateChangeKeys) safeTx('analytics/stateChanges/' + sk, stateChangeKeys[sk]);
    for (var sq in searchQueries) safeTx('analytics/searches/' + sq, searchQueries[sq]);
    for (var ce in customEvents) safeTx('analytics/events/' + ce, customEvents[ce]);
    for (var oo in orientations) safeTx('analytics/orientations/' + oo, orientations[oo]);
    for (var fe in formErrors) safeTx('analytics/formErrors/' + fe, formErrors[fe]);
    for (var ff in featureUsage) safeTx('analytics/features/' + ff, featureUsage[ff]);
    for (var dd in dashboardInteractions) safeTx('analytics/dashboard/' + dd, dashboardInteractions[dd]);
    for (var ai in aiInteractions) safeTx('analytics/ai/interactions/' + ai, aiInteractions[ai]);
    trimNode('analytics/recent', CFG.maxRecent);
  }

  /* ========================================
     17. VISIT TRACKING & PRESENCE
     ======================================== */
  function trackVisit(isNew, visitCount) {
    if (!db || visitTracked) return; visitTracked = true;
    var pg = pageName(), td = todayKey(), visitCat = getVisitCategory(visitCount), devSnap = _buildDeviceSnapshot();
    var dk = 'adv_' + td + '_' + fp;
    if (!sessionStorage.getItem(dk)) {
      sessionStorage.setItem(dk, '1');
      safeTx('analytics/daily/' + td + '/visitors', 1);
      safeTx('analytics/daily/' + td + '/' + (isNew ? 'newVisitors' : 'returningVisitors'), 1);
      safeTx('analytics/daily/' + td + '/visitCategories/' + visitCat, 1);
    }
    var pk = 'apv_' + pg + '_' + fp;
    if (!sessionStorage.getItem(pk)) { sessionStorage.setItem(pk, '1'); safeTx('analytics/pages/' + pg + '/visitors', 1); }
    if (country !== 'unknown') { var ck = 'ac_' + country + '_' + fp; if (!sessionStorage.getItem(ck)) { sessionStorage.setItem(ck, '1'); safeTx('analytics/countryVisitors/' + country, 1); } }
    if (getDarkMode()) safeTx('analytics/daily/' + td + '/darkModeUsers', 1);
    if (getReducedMotion()) safeTx('analytics/daily/' + td + '/reducedMotionUsers', 1);
    safeTx('analytics/daily/' + td + '/inputMethods/' + getInputMethod(), 1);
    if (detectAdBlocker()) safeTx('analytics/daily/' + td + '/adBlockerUsers', 1);
    var lang = (navigator.language || 'unknown').split('-')[0];
    safeTx('analytics/daily/' + td + '/languages/' + lang, 1);
    safeTx('analytics/engines/' + browserEngine, 1);
    if (deviceSubtype !== 'standard') safeTx('analytics/deviceSubtypes/' + deviceSubtype, 1);
    writeUTMData();
    if (isNew) {
      safeSet('analytics/fingerprints/' + fp, {
        firstSeen: Date.now(), dev: devSnap.dev, devSubtype: devSnap.devSubtype,
        brw: devSnap.brw, brwVersion: devSnap.brwVersion, engine: devSnap.engine,
        os: devSnap.os, scr: devSnap.scr, gpu: devSnap.gpu, ram: devSnap.ram,
        cores: devSnap.cores, touchPoints: devSnap.touchPoints, pixelRatio: devSnap.pixelRatio,
        webgl: devSnap.webgl, webrtc: devSnap.webrtc, fontCount: devSnap.fontCount,
        ref: getReferrer(), country: country, city: city, region: region, isp: isp, ip: ip,
        lang: devSnap.lang, darkMode: devSnap.darkMode, inputMethod: devSnap.inputMethod,
        adBlocker: devSnap.adBlocker, trafficSource: trafficSource, utm: utmData,
        battery: devSnap.battery, timezone: ''
      });
    }
    safeTx('analytics/visitFrequency/' + visitCat, 1);
    enqueue({ type: 'view', page: pg, isNew: isNew, visitCount: visitCount });
  }
  function setupPresence() {
    if (!db || presRef) return;
    presRef = db.ref('analytics/live/' + fp);
    presRef.onDisconnect().remove();
    presRef.set({ pg: pageName(), fullRoute: fullRoute(), dev: getDevice(), devSubtype: deviceSubtype, brw: getBrowser(), engine: browserEngine, country: country, city: city, isp: isp, gpu: gpuRenderer.substring(0, 60), ram: ramEstimate, battery: batteryLevel, trafficSource: trafficSource, utm: utmData, botScore: botScore, visitorScore: visitorScore, t: Date.now(), sid: sid });
    var hb = setInterval(function () { try { presRef.update({ pg: pageName(), fullRoute: fullRoute(), t: Date.now(), visitorScore: calculateVisitorScore() }); } catch (e) { clearInterval(hb); } }, CFG.heartbeatInterval);
    window.addEventListener('hashchange', function () { try { presRef.update({ pg: pageName(), fullRoute: fullRoute(), t: Date.now() }); } catch (e) { } });
  }

  /* ========================================
     19. PUBLIC API
     ======================================== */
  function trackEvent(eventType, label, data) { markInteracted(); enqueue({ type: 'custom', eventType: eventType, label: label || '', data: data || {} }); }
  function trackFeatureUsage(feature, action, metadata) { markInteracted(); enqueue({ type: 'feature_usage', feature: feature, action: action, metadata: metadata || {} }); }
  function trackDashboardInteraction(widget, action, metadata) { markInteracted(); enqueue({ type: 'dashboard_interaction', widget: widget, action: action, metadata: metadata || {} }); }
  function trackAIInteraction(action, query, metadata) { markInteracted(); enqueue({ type: 'ai_interaction', action: action, query: query || '', metadata: metadata || {} }); }
  function trackConversion(conversionId, value, metadata) {
    markInteracted();
    enqueue({ type: 'conversion', eventType: 'conversion', label: conversionId, data: { value: value || 0, metadata: metadata || {}, utm: utmData, trafficSource: trafficSource } });
    if (db) {
      safeTx('analytics/conversions/' + conversionId + '/count', 1);
      safeTx('analytics/conversions/' + conversionId + '/valueSum', value || 0);
      safeTx('analytics/conversions/' + conversionId + '/valueSamples', 1);
      safeTx('analytics/trafficSources/' + trafficSource + '/conversions', 1);
      if (utmData.source) {
        var comboKey = [utmData.source, utmData.medium, utmData.campaign].filter(Boolean).join('|');
        var hash = 0;
        for (var i = 0; i < comboKey.length; i++) { hash = ((hash << 5) - hash) + comboKey.charCodeAt(i); hash |= 0; }
        safeTx('analytics/utm/combinations/utm_' + Math.abs(hash).toString(36) + '/conversions', 1);
      }
    }
  }
  function trackAPICall(endpoint, durationMs, statusCode) {
    trackAPILatency(endpoint, durationMs);
    if (db) {
      var td = todayKey();
      safeTx('analytics/api/' + endpoint + '/calls', 1);
      safeTx('analytics/api/' + endpoint + '/latencySum', durationMs);
      if (statusCode >= 400) { safeTx('analytics/api/' + endpoint + '/errors', 1); fireAlert('api_error', 'error', 'API error: ' + endpoint + ' \u2192 ' + statusCode, { endpoint: endpoint, status: statusCode, duration: durationMs }); }
    }
  }
  function getHealthMetrics() { return healthMetrics; }
  function getCountry() { return country; }
  function getCity() { return city; }
  function getISP() { return isp; }
  function getIP() { return ip; }
  function getBotScore() { return botScore; }
  function getVisitorScore() { return calculateVisitorScore(); }
  function getSEOData() { return seoData; }
  function getUTMData() { return utmData; }
  function getTrafficSource() { return trafficSource; }
  function getSecurityFlags() { return securityFlags; }
  /* FIX: Return cached snapshot instead of calling itself */
  function getDeviceSnapshot() { return _deviceSnapshotCache || _buildDeviceSnapshot(); }

  /* ========================================
     20. INITIALIZATION
     ======================================== */
  function flush() {
    if (!db || flushed) return; flushed = true;
    flushQueue(); flushHeatmap(); flushReplay(); flushJourney();
    flushFormAnalytics(null, true); writeAIScores(); detectAnomalies();
  }
  function init(analyticsDb) {
    if (!analyticsDb) {
      console.error('[Analytics] No database instance provided!');
      return;
    }
    db = analyticsDb;

    /* FIX: Connection test — confirms writes actually work */
    console.log('[Analytics] Testing database connection...');
    db.ref('analytics/_conn').set(true)
      .then(function () {
        console.log('[Analytics] ✅ DB connected — analytics will save under /analytics');
        db.ref('analytics/_conn').remove();
      })
      .catch(function (err) {
        console.error('[Analytics] ❌ DB write FAILED:', err.code || err.message);
        console.error('[Analytics] → Check databaseURL in AUTH_CONFIG');
        console.error('[Analytics] → Check Firebase Realtime Database rules');
      });

    fp = getFingerprint(); sid = getSessionId();
    var isNew = isFirstVisit(); var visitCount = getVisitCount(); startTs = Date.now();

    /* Build device snapshot once at init */
    _buildDeviceSnapshot();

    collectDeviceInfo();
    parseUTM(); classifyTrafficSource();
    initSecurity();
    setTimeout(scanSEO, 1000);
    lastPageEnterTs = Date.now();
    recordJourneyStep(pageName(), fullRoute());
    detectCountry(function (cc, c) {
      country = cc; city = c; trackVisit(isNew, visitCount); setupPresence();
    });
    setTimeout(function () { if (!visitTracked) { trackVisit(isNew, visitCount); setupPresence(); } }, 5000);
    document.addEventListener('click', function (e) {
      var el = e.target.closest(
        'button, a, .artwork-card, .artist-profile-card, .nav-link, ' +
        '.btn, [role="button"], .search-view-btn, .dropdown-item, .tab, ' +
        '.filter-btn, .sort-btn, .toggle, .accordion-trigger, .carousel-btn, ' +
        '.modal-trigger, .close-btn, .menu-item, .breadcrumb-item, ' +
        '.pagination-btn, .share-btn, .favorite-btn, .like-btn, ' +
        '.comment-btn, .play-btn, .zoom-btn, .expand-btn, ' +
        '[data-action], [data-id], [data-artwork-id], [data-artist], ' +
        '[data-page], [data-tab], [data-curr], [data-lang], ' +
        '[data-filter], [data-sort], [data-category]'
      );
      if (!el) return;
      markInteracted(); sessionClicks++;
      var lbl = '';
      if (el.dataset.action) lbl = 'action:' + el.dataset.action;
      else if (el.dataset.id) lbl = el.dataset.id;
      else if (el.dataset.artworkId) lbl = el.dataset.artworkId;
      else if (el.dataset.artist) lbl = el.dataset.artist;
      else if (el.dataset.page) lbl = el.dataset.page;
      else if (el.dataset.tab) lbl = 'tab:' + el.dataset.tab;
      else if (el.dataset.curr) lbl = 'currency:' + el.dataset.curr;
      else if (el.dataset.lang) lbl = 'lang:' + el.dataset.lang;
      else if (el.dataset.filter) lbl = 'filter:' + el.dataset.filter;
      else if (el.dataset.sort) lbl = 'sort:' + el.dataset.sort;
      else if (el.dataset.category) lbl = 'category:' + el.dataset.category;
      else if (el.getAttribute('aria-label')) lbl = el.getAttribute('aria-label');
      else if (el.textContent) lbl = el.textContent.trim().substring(0, 80);
      if (!lbl) lbl = el.tagName.toLowerCase();
      enqueue({ type: 'click', page: pageName(), label: lbl });
      clearTimeout(clickFlushTimer);
      clickFlushTimer = setTimeout(flushQueue, CFG.clickFlushDelay);
    });
    trackScrollDepth(); trackStateChanges(); trackSearchQueries();
    trackExternalLinks(); trackAllErrors(); detectBounce();
    initHeatmap(); initReplay(); initFormAnalytics();
    observeModernMetrics();
    if (document.readyState === 'complete') { setTimeout(writeHealthSnapshot, 600); }
    else { window.addEventListener('load', function () { setTimeout(writeHealthSnapshot, 600); }); }
    setInterval(function () { if (db) { var sc = calculateHealthScore(); safeSet('analytics/health/score', sc); safeSet('analytics/health/status', getHealthStatus(sc)); } }, CFG.healthRecheck);
    setInterval(function () { if (db) writeAIScores(); }, 30000);
    setInterval(function () { detectAnomalies(); }, 60000);
    clearTimeout(journeyFlushTimer);
    journeyFlushTimer = setInterval(flushJourney, CFG.journeyFlushInterval);
    flushTimer = setInterval(flushQueue, CFG.flushInterval);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushQueue(); });
    window.addEventListener('hashchange', function () { setTimeout(scanSEO, 500); });
  }

  return {
    init: init,
    trackEvent: trackEvent, trackFeatureUsage: trackFeatureUsage,
    trackDashboardInteraction: trackDashboardInteraction,
    trackAIInteraction: trackAIInteraction, trackConversion: trackConversion,
    trackAPICall: trackAPICall, defineFunnel: defineFunnel,
    trackFunnelStep: trackFunnelStep, config: CFG,
    getHealthMetrics: getHealthMetrics, getCountry: getCountry,
    getCity: getCity, getISP: getISP, getIP: getIP,
    getBotScore: getBotScore, getVisitorScore: getVisitorScore,
    getSEOData: getSEOData, getUTMData: getUTMData,
    getTrafficSource: getTrafficSource, getSecurityFlags: getSecurityFlags,
    getDeviceSnapshot: getDeviceSnapshot,
    getFingerprint: function () { return fp; },
    getSessionId: function () { return sid; },
    getSessionPageViews: function () { return sessionPageViews; },
    getSessionClicks: function () { return sessionClicks; },
    getSessionDuration: function () { return Math.round((Date.now() - startTs) / 1000); }
  };
})();
/* =============================================
   Draggable Floating Search Results
   ============================================= */
(function() {
  var input = document.getElementById('sidebar-search');
  var clearBtn = document.getElementById('sidebar-search-clear');
  var panel = document.getElementById('sidebar-search-results');
  if (!input || !panel) return;
  
  var allVideosCache = null;
  var cachePromise = null;
  var debounceTimer = null;
  var DEBOUNCE_MS = 250;
  var MAX_RESULTS = 25;
  
  /* ---- Drag system ---- */
  var isDragging = false;
  var dragOffsetX = 0;
  var dragOffsetY = 0;
  
  function startDrag(clientX, clientY) {
    isDragging = true;
    var rect = panel.getBoundingClientRect();
    dragOffsetX = clientX - rect.left;
    dragOffsetY = clientY - rect.top;
    panel.style.transition = 'none';
    document.body.style.userSelect = 'none';
  }
  
  function moveDrag(clientX, clientY) {
    if (!isDragging) return;
    var pw = panel.offsetWidth;
    var ph = panel.offsetHeight;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    
    var x = clientX - dragOffsetX;
    var y = clientY - dragOffsetY;
    
    /* Clamp so it never goes off-screen */
    if (x < 4) x = 4;
    if (x + pw > vw - 4) x = vw - pw - 4;
    if (y < 4) y = 4;
    if (y + ph > vh - 4) y = vh - ph - 4;
    
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }
  
  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    panel.style.transition = '';
    document.body.style.userSelect = '';
  }
  
  document.addEventListener('mousemove', function(e) { moveDrag(e.clientX, e.clientY); });
  document.addEventListener('mouseup', endDrag);
  document.addEventListener('touchmove', function(e) {
    if (isDragging) {
      e.preventDefault();
      moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });
  document.addEventListener('touchend', endDrag);
  /* ---- End drag system ---- */
  
  /* Build the drag bar HTML */
  var dragBarHTML =
    '<div class="ssr-drag-bar">' +
    '<div class="ssr-drag-dots"><span></span><span></span><span></span></div>' +
    '<span class="ssr-drag-label">Search Results</span>' +
    '<button class="ssr-drag-close" id="ssr-close-btn" aria-label="Close results">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
    '</button>' +
    '</div>';
  
  function ensureCache() {
    if (allVideosCache) return Promise.resolve(allVideosCache);
    if (cachePromise) return cachePromise;
    
    cachePromise = Promise.all([
      database.ref('description').once('value'),
      database.ref('Translated').once('value')
    ]).then(function(results) {
      var videos = [];
      var seen = {};
      
      results[0].forEach(function(child) {
        if (child.key === 'Translated') return;
        var d = child.val();
        if (!d || !d.title) return;
        if (seen[child.key]) return;
        d._id = child.key;
        d._isTranslated = false;
        videos.push(d);
        seen[child.key] = true;
      });
      
      results[1].forEach(function(child) {
        var d = child.val();
        if (!d || !d.title) return;
        if (seen[child.key]) return;
        d._id = child.key;
        d._isTranslated = true;
        videos.push(d);
        seen[child.key] = true;
      });
      
      videos.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      allVideosCache = videos;
      return videos;
    }).catch(function(err) {
      cachePromise = null;
      console.error('[SidebarSearch] Cache failed:', err);
      return [];
    });
    
    return cachePromise;
  }
  
  function highlight(text, query) {
    if (!query) return escapeHTML(text || '');
    var safe = escapeHTML(text || '');
    var safeQ = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      return safe.replace(new RegExp('(' + safeQ + ')', 'gi'), '<mark>$1</mark>');
    } catch (e) { return safe; }
  }
  
  function trunc(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max) + '…' : str;
  }
  
  function renderResults(results, query) {
    var bodyHTML = '';
    if (results.length === 0) {
      bodyHTML =
        '<div class="ssr-empty">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><line x1="8" y1="11" x2="14" y2="11"/></svg>' +
        'No movies found for "' + escapeHTML(query) + '"' +
        '</div>';
    } else {
      for (var i = 0; i < results.length; i++) {
        var v = results[i];
        var thumb = getThumbnailUrl(v);
        var bc = v._isTranslated ? 'ssr-badge--t' : 'ssr-badge--d';
        var bt = v._isTranslated ? 'Translated' : 'Movies';
        var ds = trunc(v.description || '', 55);
        var yr = v.year ? escapeHTML(v.year) : '';
        var gn = v.genre ? escapeHTML(trunc(v.genre, 22)) : '';
        
        bodyHTML +=
          '<div class="ssr-item" data-id="' + v._id + '" tabindex="0">' +
          '<img class="ssr-thumb" src="' + thumb + '" alt="" loading="lazy" onerror="this.src=\'https://placehold.co/60x38/e63946/fff?text=—\'">' +
          '<div class="ssr-body">' +
          '<div class="ssr-title">' + highlight(v.title, query) + '</div>' +
          '<div class="ssr-meta">' +
          '<span class="ssr-badge ' + bc + '">' + bt + '</span>' +
          (yr ? '<span>' + yr + '</span>' : '') +
          (gn ? '<span>' + gn + '</span>' : '') +
          '</div>' +
          (ds ? '<div class="ssr-desc">' + highlight(ds, query) + '</div>' : '') +
          '</div>' +
          '</div>';
      }
    }
    
    panel.innerHTML = dragBarHTML + '<div class="ssr-scroll">' + bodyHTML + '</div>';
    panel.classList.add('ssr-active');
    
    /* Bind drag bar events */
    var bar = panel.querySelector('.ssr-drag-bar');
    bar.addEventListener('mousedown', function(e) {
      if (e.target.closest('#ssr-close-btn')) return;
      startDrag(e.clientX, e.clientY);
    });
    bar.addEventListener('touchstart', function(e) {
      if (e.target.closest('#ssr-close-btn')) return;
      startDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    
    /* Bind close button */
    var closeBtn = document.getElementById('ssr-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function() {
        panel.classList.remove('ssr-active');
        panel.innerHTML = '';
      });
    }
    
    /* Bind result clicks */
    var items = panel.querySelectorAll('.ssr-item');
    for (var j = 0; j < items.length; j++) {
      (function(item) {
        var go = function() { window.location.href = 'video.html?id=' + item.dataset.id; };
        item.addEventListener('click', go);
        item.addEventListener('keydown', function(e) { if (e.key === 'Enter') go(); });
      })(items[j]);
    }
  }
  
  function executeSearch(query) {
    query = query.trim();
    clearBtn.style.display = query ? 'block' : 'none';
    
    if (query.length < 2) {
      panel.classList.remove('ssr-active');
      panel.innerHTML = '';
      return;
    }
    
    panel.innerHTML = dragBarHTML + '<div class="ssr-scroll"><div class="ssr-loading">Searching…</div></div>';
    panel.classList.add('ssr-active');
    
    /* Default position: left side, vertically centered */
    panel.style.left = '20px';
    panel.style.top = Math.max(20, (window.innerHeight - 400) / 2) + 'px';
    
    var q = query.toLowerCase();
    
    ensureCache().then(function(videos) {
      if (input.value.trim().toLowerCase() !== q) return;
      
      var matches = [];
      for (var i = 0; i < videos.length && matches.length < MAX_RESULTS; i++) {
        var v = videos[i];
        var tM = (v.title || '').toLowerCase().indexOf(q) >= 0;
        var dM = (v.description || '').toLowerCase().indexOf(q) >= 0;
        var cM = (v.country || '').toLowerCase().indexOf(q) >= 0;
        var gM = (v.genre || '').toLowerCase().indexOf(q) >= 0;
        
        if (tM || dM || cM || gM) {
          v._s = tM ? 0 : (dM ? 1 : 2);
          matches.push(v);
        }
      }
      
      matches.sort(function(a, b) { return a._s - b._s; });
      renderResults(matches, query);
    });
  }
  
  input.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    var val = this.value;
    debounceTimer = setTimeout(function() { executeSearch(val); }, DEBOUNCE_MS);
  });
  
  clearBtn.addEventListener('click', function() {
    input.value = '';
    clearBtn.style.display = 'none';
    panel.classList.remove('ssr-active');
    panel.innerHTML = '';
    input.focus();
  });
  
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      panel.classList.remove('ssr-active');
      panel.innerHTML = '';
      input.blur();
    }
  });
  
  input.addEventListener('focus', function() {
    if (this.value.trim().length >= 2 && !panel.classList.contains('ssr-active')) {
      executeSearch(this.value);
    }
  });
})();
/* =============================================
   Initialize Application
   ============================================= */
function init() {
  buildFooter();
  buildYearTags();
  
  initAuthState(function() {
    switch (AppState.currentPage) {
      case 'home':
        initHomePage();
        break;
      case 'translated':
        if (typeof initTranslatedPage === 'function') initTranslatedPage();
        else initViewAllPage();
        break;
      case 'viewall':
        initViewAllPage();
        break;
        // ===== ADD THESE =====
      case 'series':
        // Don't call initSeriesPage() here - series.js handles it
        break;
      case 'watch':
        // Don't call initWatchPage() here - series.js handles it
        break;
        // ======================
      case 'login':
        initLoginPage();
        break;
      case 'signup':
        initSignupPage();
        break;
      case 'upload':
        initUploadPage();
        break;
      case 'video':
        initVideoPage();
        break;
      case 'profile':
        initProfilePage();
        break;
    }
  });
}

/* Run on DOM ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
} 

/* =============================================
   Initialize SiteAnalytics
   ============================================= */
document.addEventListener('DOMContentLoaded', function() {
  // Wait for Firebase Auth to be ready before starting analytics
  auth.onAuthStateChanged(function(user) {
    // We initialize analytics regardless of login status to track all visitors
    if (typeof SiteAnalytics !== 'undefined' && typeof database !== 'undefined') {
      try {
        SiteAnalytics.init(database);
        console.log("✅ SiteAnalytics initialized. Tracking data under /Analytic");
      } catch (e) {
        console.error("❌ Failed to initialize SiteAnalytics:", e);
      }
    } else {
      console.warn("⚠️ SiteAnalytics or Firebase Database not found.");
    }
  });
});
