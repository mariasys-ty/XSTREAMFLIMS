/* =============================================
   Live TV Page Logic v2.1
   Sources: channels.json + streams/*.m3u
   Features: Premium HLS, Verified Streams,
   Category Recommendations, Favorites, PiP,
   Infinite Scroll, Smart Background Refresh
   ============================================= */

// ==================== CONFIGURATION ====================
var LiveConfig = {
  heroRotationInterval: 45000,
  heroMaxErrors: 5,
  heroErrorRetryDelay: 2000,
  verifyBatchSize: 6,
  verifyTimeout: 8000,
  verifyMaxResults: 8,
  gridPageSize: 24,
  searchDebounce: 300,
  jsonRefreshInterval: 300000,
  m3uRefreshInterval: 1800000,
  reverifyInterval: 900000,
  recentMaxItems: 8,
  localChannelSlots: 10,
  ipTimeout: 3000,
  m3uFetchBatchSize: 6,
  m3uMaxChannelsPerFile: 300,
  previewCleanupDelay: 500
};

var CategoryIcons = {
  news:'newspaper', sport:'trophy', sports:'trophy', weather:'cloud',
  music:'music', movie:'film', movies:'film', cinema:'film',
  kids:'star', cartoon:'star', documentary:'globe', religious:'heart',
  faith:'heart', travel:'plane', shop:'bag', shopping:'bag',
  legislative:'landmark', parliament:'landmark', event:'calendar',
  entertainment:'tv', comedy:'smile', drama:'masks', education:'book',
  food:'utensils', lifestyle:'home', gaming:'gamepad', tech:'cpu',
  science:'flask', nature:'tree', history:'clock', general:'tv',
  culture:'palette', business:'briefcase', health:'heart-pulse',
  fashion:'shirt', auto:'car', animals:'paw-print'
};

var M3U_PRIMARY_CODES = [
  'us','uk','gb','ca','au','de','fr','es','it','pt','nl','be','ch',
  'at','se','no','dk','fi','pl','tr','gr','ru','jp','kr','in','br',
  'mx','ar','co','eg','sa','ae','ng','ke','za','id','ph','th','vn','my'
];
var M3U_SECONDARY_CODES = [
  'ie','cz','sk','hu','ro','bg','hr','rs','ua','ge','am','az','kz',
  'tw','hk','pk','bd','lk','np','sg','mn','kw','qa','bh','om','jo',
  'lb','il','ly','tn','dz','ma','sd','so','et','tz','ug','rw','gh',
  'ci','sn','cm','pa','cr','pe','cl','uy','py','ve','cu','do','ht','ec'
];

var CountryNames = {
  US:'United States',GB:'United Kingdom',UK:'United Kingdom',CA:'Canada',
  AU:'Australia',DE:'Germany',FR:'France',ES:'Spain',IT:'Italy',PT:'Portugal',
  NL:'Netherlands',BE:'Belgium',CH:'Switzerland',AT:'Austria',SE:'Sweden',
  NO:'Norway',DK:'Denmark',FI:'Finland',IE:'Ireland',PL:'Poland',
  CZ:'Czechia',SK:'Slovakia',HU:'Hungary',RO:'Romania',BG:'Bulgaria',
  HR:'Croatia',RS:'Serbia',TR:'Turkey',GR:'Greece',RU:'Russia',
  UA:'Ukraine',GE:'Georgia',AM:'Armenia',JP:'Japan',KR:'South Korea',
  IN:'India',PK:'Pakistan',BD:'Bangladesh',CN:'China',TW:'Taiwan',
  HK:'Hong Kong',TH:'Thailand',VN:'Vietnam',MY:'Malaysia',ID:'Indonesia',
  PH:'Philippines',SG:'Singapore',SA:'Saudi Arabia',AE:'UAE',KW:'Kuwait',
  QA:'Qatar',BH:'Bahrain',OM:'Oman',JO:'Jordan',LB:'Lebanon',
  IL:'Israel',EG:'Egypt',LY:'Libya',TN:'Tunisia',DZ:'Algeria',
  MA:'Morocco',NG:'Nigeria',KE:'Kenya',ZA:'South Africa',ET:'Ethiopia',
  GH:'Ghana',BR:'Brazil',MX:'Mexico',AR:'Argentina',CO:'Colombia',
  PE:'Peru',CL:'Chile',VE:'Venezuela',CU:'Cuba',DO:'Dominican Rep.',
  PA:'Panama',CR:'Costa Rica',EC:'Ecuador',UY:'Uruguay',PY:'Paraguay',
  BO:'Bolivia'
};

// ==================== STATE ====================
var LiveAppState = {
  allChannels: [],
  verifiedLiveChannels: [],
  failedChannels: {},
  currentCategory: 'all',
  currentSearch: '',
  lastDataHash: '',
  userCountry: null,
  heroIsVerified: false,
  displayCount: LiveConfig.gridPageSize,
  isFetchingM3U: false,
  m3uAvailableCodes: [],
  favorites: [],
  showOffline: false,
  refreshTimers: { json: null, m3u: null, verify: null },
  lastRefresh: { json: 0, m3u: 0, verify: 0 },
  sources: { json: 0, m3u: 0 },
  qualityMap: {},
  isInitialLoad: true
};

var heroHlsInstance = null;
var heroRotationTimer = null;
var activePreviewHls = null;
var activePreviewVideo = null;
var currentHeroChannel = null;
var heroErrorCount = 0;
var pipVideo = null;
var pipHls = null;

var CACHE_JSON_KEY = 'xstream_channels_cache';
var CACHE_M3U_KEY = 'xstream_m3u_cache';
var CACHE_M3U_INDEX_KEY = 'xstream_m3u_index';
var RECENT_KEY = 'xstream_recent_channels';
var FAVORITES_KEY = 'xstream_favorites';
var COUNTRY_CACHE_KEY = 'xstream_country_cache';
var NAV_CHANNEL_KEY = 'xstream_nav_channel';

var PremiumHlsConfig = {
  enableWorker: true, lowLatencyMode: false,
  maxBufferLength: 20, maxMaxBufferLength: 400,
  startFragPrefetch: true, testBandwidth: true,
  abrEwmaDefaultEstimate: 5000000, capLevelToPlayerSize: false
};

var LightHlsConfig = {
  enableWorker: true, lowLatencyMode: false,
  maxBufferLength: 3, maxMaxBufferLength: 6,
  startFragPrefetch: false, testBandwidth: false,
  abrEwmaDefaultEstimate: 2000000
};

// ==================== UTILITIES ====================
function escapeHTML(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function formatNumber(num) {
  if (!num || num < 1000) return String(num || 0);
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

function hashString(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getDeterministicViews(ch) {
  return (hashString(ch.name + '|' + ch.streamUrl) % 95000) + 5000;
}

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .replace(/\?.*$/, '')
    .replace(/#.*/, '')
    .replace(/\/(index\.m3u8)?$/i, '')
    .toLowerCase();
}

function isValidStreamUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  if (url.length < 25) return false;
  if (url.indexOf('..') !== -1) return false;
  if (/error|invalid|undefined|null|example\.com|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(url)) return false;
  var clean = url.split('?')[0].split('#')[0].toLowerCase();
  return /\.(m3u8|mpd|mp4|ts|flv)/.test(clean) || /\/live\//i.test(url) || /\/stream\//i.test(url) || /\/play\//i.test(url);
}

function isBrokenUrl(url) {
  if (!url) return true;
  var n = normalizeUrl(url);
  if (n.length < 15) return true;
  if (!/\.|:/.test(n)) return true;
  if (/^(undefined|null|none|empty|na|n\/a|tbd|todo)$/i.test(n)) return true;
  if (/error|fail|broken|invalid|not.?found|unavailable/i.test(n)) return true;
  return false;
}

function getCountryName(code) {
  return CountryNames[code] || code || 'INT';
}

function getCategoryIcon(cat) {
  var key = (cat || 'general').toLowerCase();
  return CategoryIcons[key] || 'tv';
}

function getCategoryIconSVG(cat) {
  var icon = getCategoryIcon(cat);
  var icons = {
    'newspaper':'<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><line x1="10" y1="6" x2="18" y2="6"/><line x1="10" y1="10" x2="18" y2="10"/><line x1="10" y1="14" x2="14" y2="14"/>',
    'trophy':'<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    'cloud':'<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    'music':'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    'film':'<rect width="20" height="20" x="2" y="2" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
    'star':'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    'globe':'<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    'heart':'<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    'plane':'<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    'bag':'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    'landmark':'<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/>',
    'calendar':'<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    'tv':'<rect width="20" height="15" x="2" y="7" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>',
    'smile':'<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
    'book':'<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    'utensils':'<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    'home':'<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    'gamepad':'<line x1="6" y1="11" x2="10" y2="11"/><line x1="8" y1="9" x2="8" y2="13"/><line x1="15" y1="12" x2="15.01" y2="12"/><line x1="18" y1="10" x2="18.01" y2="10"/><rect width="20" height="12" x="2" y="6" rx="2"/>',
    'cpu':'<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
    'flask':'<path d="M9 3h6"/><path d="M10 9V3h4v6l5 8.5a2 2 0 0 1-1.7 3H6.7a2 2 0 0 1-1.7-3Z"/>',
    'tree':'<path d="M12 22v-7"/><path d="M17 8a5 5 0 0 0-10 0c-2.5 0-5 2.5-5 5h20c0-2.5-2.5-5-5-5z"/><path d="M15 3l-3 5-3-5"/>',
    'clock':'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    'palette':'<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
    'briefcase':'<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    'heart-pulse':'<path d="M19.14 15.18c-.76.84-1.93 1.32-3.14 1.32-1.21 0-2.38-.48-3.14-1.32L12 14.24l-.86.94c-.76.84-1.93 1.32-3.14 1.32-1.21 0-2.38-.48-3.14-1.32C3.56 13.86 3 12.48 3 10.96 3 8.12 5.51 5.56 8.27 3.34L12 .82l3.73 2.52C18.49 5.56 21 8.12 21 10.96c0 1.52-.56 2.9-1.86 4.22Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
    'shirt':'<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23Z"/>',
    'car':'<path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/><circle cx="6.5" cy="16.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
    'paw-print':'<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="4" cy="8" r="2"/><path d="M9 10a5 5 0 0 1 6 0c1.2 1.4 1.8 3 1.8 4.5C16.8 17.4 14.3 20 12 20s-4.8-2.6-4.8-5.5C7.2 13 7.8 11.4 9 10z"/>',
    'masks':'<path d="M7 11a4 4 0 0 1 8 0c0 1.86-1.27 3.43-3 3.89V21H8v-6.11C6.27 14.43 5 12.86 5 11a4 4 0 0 1 2-3.46"/><path d="M13 7.54V3h4v4.54"/><path d="M15 11a4 4 0 0 0 0 8"/>'
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;">' + (icons[icon] || icons['tv']) + '</svg>';
}

function getQualityColor(q) {
  switch(q) {
    case 'FHD': return '#00b894';
    case 'HD': return '#0984e3';
    case 'SD': return '#fdcb6e';
    default: return '#636e72';
  }
}

function timeAgo(timestamp) {
  var diff = Date.now() - timestamp;
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  var days = Math.floor(hours / 24);
  if (days < 7) return days + 'd ago';
  return new Date(timestamp).toLocaleDateString();
}

function getDeviceCapability() {
  var cores = navigator.hardwareConcurrency || 2;
  var mem = navigator.deviceMemory || 4;
  var isMobile = /Mobi|Android/i.test(navigator.userAgent);
  var isLowEnd = cores <= 2 || mem <= 2 || isMobile;
  return { cores: cores, memory: mem, isMobile: isMobile, isLowEnd: isLowEnd,
    maxConcurrent: isLowEnd ? 3 : Math.min(cores, 8) };
}

// ==================== M3U PARSER ====================
function parseM3U(content, sourceCountry) {
  if (!content || typeof content !== 'string') return [];
  content = content.replace(/^\uFEFF/, '').trim();
  if (!content.startsWith('#EXTM3U')) return [];

  var lines = content.split('\n');
  var channels = [];
  var currentInfo = null;
  var count = 0;
  var seenUrls = {};

  for (var i = 0; i < lines.length && count < LiveConfig.m3uMaxChannelsPerFile; i++) {
    var line = lines[i].trim();

    if (line.startsWith('#EXTINF')) {
      currentInfo = parseExtInf(line);
      if (!currentInfo.country && sourceCountry) currentInfo.country = sourceCountry.toUpperCase();
    } else if (line && !line.startsWith('#') && currentInfo) {
      if (isValidStreamUrl(line) && !isBrokenUrl(line)) {
        var normKey = normalizeUrl(line);
        if (!seenUrls[normKey]) {
          seenUrls[normKey] = true;
          channels.push({
            name: currentInfo.name || 'Unknown Channel',
            category: sanitizeCategory(currentInfo.group || 'general'),
            thumbnail: (currentInfo.logo && currentInfo.logo.startsWith('http')) ? currentInfo.logo : '',
            streamUrl: line,
            country: (currentInfo.country || sourceCountry || 'INT').toUpperCase().substring(0, 3)
          });
          count++;
        }
      }
      currentInfo = null;
    } else if (line.startsWith('#EXTGRP:')) {
      if (currentInfo && !currentInfo.group) currentInfo.group = line.substring(8).trim();
    }
  }
  return channels;
}

function parseExtInf(line) {
  var info = { name: '', logo: '', group: '', country: '' };
  var m;
  m = line.match(/tvg-name="([^"]*)"/i); if (m) info.name = m[1];
  m = line.match(/tvg-logo="([^"]*)"/i); if (m) info.logo = m[1];
  m = line.match(/group-title="([^"]*)"/i); if (m) info.group = m[1];
  m = line.match(/tvg-country="([^"]*)"/i); if (m) info.country = m[1];
  if (!info.name) {
    var ci = line.lastIndexOf(',');
    if (ci > -1) info.name = line.substring(ci + 1).trim();
  }
  return info;
}

function sanitizeCategory(cat) {
  if (!cat) return 'general';
  return cat.toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 30);
}

// ==================== DATA FETCHING ====================
function fetchAllChannelSources() {
  var grid = document.getElementById('live-tv-grid');
  if (grid) grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="spinner" style="margin:0 auto 20px;"></div><h3>Loading World TV Channels...</h3><p style="color:var(--text-secondary);font-size:0.9rem;">Scanning channels.json & stream files...</p></div>';

  var cachedJson = getCache(CACHE_JSON_KEY);
  var cachedM3U = getCache(CACHE_M3U_KEY);

  var jsonReady = false, m3uReady = false;
  var jsonChannels = [], m3uChannels = [];

  function tryRender() {
    if (jsonReady && m3uReady) {
      var merged = mergeChannelSources(jsonChannels, m3uChannels);
      if (merged.length > 0) {
        processMergedChannels(merged);
      } else if (!jsonChannels.length && !m3uChannels.length) {
        var offlineEl = document.getElementById('tv-service-offline');
        if (offlineEl) offlineEl.style.display = 'block';
        if (grid) grid.innerHTML = '';
      }
    }
  }

  if (cachedJson) {
    jsonChannels = cachedJson;
    jsonReady = true;
    tryRender();
  }
  fetch('channels.json')
    .then(function(r) { if (!r.ok) throw new Error('Not found'); return r.json(); })
    .then(function(data) {
      setCache(CACHE_JSON_KEY, data);
      jsonChannels = data;
      LiveAppState.lastRefresh.json = Date.now();
      jsonReady = true;
      tryRender();
    })
    .catch(function() {
      if (!jsonReady) { jsonReady = true; tryRender(); }
    });

  if (cachedM3U && cachedM3U.length > 0) {
    m3uChannels = cachedM3U;
    m3uReady = true;
    tryRender();
  }
  fetchM3UStreams().then(function(channels) {
    if (channels.length > 0) {
      setCache(CACHE_M3U_KEY, channels);
      m3uChannels = channels;
      LiveAppState.lastRefresh.m3u = Date.now();
    }
    m3uReady = true;
    tryRender();
  }).catch(function() {
    m3uReady = true;
    tryRender();
  });
}

function fetchM3UStreams() {
  return new Promise(function(resolve) {
    var cachedIndex = getCache(CACHE_M3U_INDEX_KEY);
    var codesToTry = [];

    if (cachedIndex && Array.isArray(cachedIndex) && cachedIndex.length > 0) {
      codesToTry = cachedIndex;
    } else {
      fetch('streams/index.json')
        .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
        .then(function(index) {
          if (Array.isArray(index) && index.length > 0) {
            codesToTry = index.map(function(c) { return String(c).toLowerCase().replace('.m3u',''); });
            setCache(CACHE_M3U_INDEX_KEY, codesToTry);
            processM3UBatch(codesToTry, resolve);
            return;
          }
          throw new Error();
        })
        .catch(function() {
          codesToTry = M3U_PRIMARY_CODES.slice();
          processM3UBatch(codesToTry, resolve);
        });
      return;
    }
    processM3UBatch(codesToTry, resolve);
  });
}

function processM3UBatch(codes, resolve) {
  var allChannels = [];
  var batchSize = LiveConfig.m3uFetchBatchSize;
  var index = 0;
  var foundCodes = [];

  function fetchBatch() {
    var batch = codes.slice(index, index + batchSize);
    if (batch.length === 0) {
      if (foundCodes.length > 0) setCache(CACHE_M3U_INDEX_KEY, foundCodes);
      LiveAppState.m3uAvailableCodes = foundCodes;
      resolve(allChannels);
      return;
    }
    index += batchSize;

    var promises = batch.map(function(code) {
      return fetch('streams/' + code + '.m3u')
        .then(function(r) { if (!r.ok) throw new Error(); return r.text(); })
        .then(function(text) {
          var parsed = parseM3U(text, code);
          foundCodes.push(code);
          return parsed;
        })
        .catch(function() { return []; });
    });

    Promise.allSettled(promises).then(function(results) {
      results.forEach(function(r) {
        if (r.status === 'fulfilled' && r.value.length > 0) {
          allChannels = allChannels.concat(r.value);
        }
      });
      if (allChannels.length < 20 && index >= codes.length && codes === M3U_PRIMARY_CODES) {
        codes = M3U_SECONDARY_CODES;
        index = 0;
      }
      fetchBatch();
    });
  }
  fetchBatch();
}

// ==================== DATA PROCESSING ====================
function mergeChannelSources(jsonData, m3uChannels) {
  var jsonProcessed = [];
  if (Array.isArray(jsonData)) {
    jsonProcessed = jsonData.filter(function(ch) {
      return ch.streamUrl && isValidStreamUrl(ch.streamUrl) && !isBrokenUrl(ch.streamUrl) && ch.category;
    }).map(function(ch) {
      var rawThumb = ch.logo || '';
      var cleanThumb = (rawThumb && rawThumb.startsWith('http')) ? rawThumb : '';
      var rawId = ch.id || (ch.name + '-' + ch.country);
      return {
        id: rawId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        name: ch.name || 'Unknown Channel',
        category: (ch.category || 'general').toLowerCase(),
        thumbnail: cleanThumb,
        hasLogo: !!cleanThumb,
        streamUrl: ch.streamUrl,
        country: (ch.country || 'INT').toUpperCase().substring(0, 3),
        source: 'json'
      };
    });
  }

  var m3uProcessed = m3uChannels.filter(function(ch) {
    return ch.streamUrl && isValidStreamUrl(ch.streamUrl) && !isBrokenUrl(ch.streamUrl);
  }).map(function(ch) {
    var rawId = ch.name + '-' + ch.country + '-' + hashString(ch.streamUrl).toString(36);
    return {
      id: rawId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      name: ch.name || 'Unknown Channel',
      category: ch.category || 'general',
      thumbnail: ch.thumbnail || '',
      hasLogo: !!ch.thumbnail,
      streamUrl: ch.streamUrl,
      country: ch.country || 'INT',
      source: 'm3u'
    };
  });

  LiveAppState.sources.json = jsonProcessed.length;
  LiveAppState.sources.m3u = m3uProcessed.length;

  return deduplicateChannels(jsonProcessed.concat(m3uProcessed));
}

function deduplicateChannels(channels) {
  var seen = {};
  var result = [];

  // Sort so JSON channels come first, then by hasLogo (prefer channels with logos)
  var sorted = channels.slice().sort(function(a, b) {
    if (a.source !== b.source) return a.source === 'json' ? -1 : 1;
    if (a.hasLogo !== b.hasLogo) return a.hasLogo ? -1 : 1;
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return 0;
  });

  for (var i = 0; i < sorted.length; i++) {
    var ch = sorted[i];
    var normKey = normalizeUrl(ch.streamUrl);

    if (!seen[normKey]) {
      seen[normKey] = true;
      ch.views = getDeterministicViews(ch);
      result.push(ch);
    }
    // If duplicate, skip entirely — first occurrence (best version) is kept
  }
  return result;
}

function processMergedChannels(channels) {
  if (channels.length === 0) {
    var noChannels = document.getElementById('no-channels');
    if (noChannels) noChannels.style.display = 'block';
    return;
  }

  LiveAppState.lastDataHash = hashString(JSON.stringify(channels.map(function(c) { return c.streamUrl; })));
  LiveAppState.allChannels = channels;
  LiveAppState.allChannels.sort(function(a, b) { return (b.views || 0) - (a.views || 0); });

  var grid = document.getElementById('live-tv-grid');
  var offlineEl = document.getElementById('tv-service-offline');
  if (grid) grid.innerHTML = '';
  if (offlineEl) offlineEl.style.display = 'none';

  loadFavorites();
  renderLivePage();
  initHeroPlayer();
  startBackgroundRefresh();

  if (LiveAppState.isInitialLoad) {
    LiveAppState.isInitialLoad = false;
    updateSourceIndicator();
  }
}

// ==================== IP DETECTION ====================
function fetchUserCountry() {
  try {
    var cached = localStorage.getItem(COUNTRY_CACHE_KEY);
    if (cached) {
      var parsed = JSON.parse(cached);
      if (Date.now() - parsed.ts < 86400000) {
        LiveAppState.userCountry = parsed.country;
        filterAndRenderGrid();
        return;
      }
    }
  } catch(e) {}

  var controller = new AbortController();
  var timeoutId = setTimeout(function() { controller.abort(); }, LiveConfig.ipTimeout);

  fetch('https://ipapi.co/json/', { signal: controller.signal })
    .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function(data) {
      clearTimeout(timeoutId);
      if (data && data.country_code) {
        LiveAppState.userCountry = data.country_code.toUpperCase();
        try { localStorage.setItem(COUNTRY_CACHE_KEY, JSON.stringify({ country: LiveAppState.userCountry, ts: Date.now() })); } catch(e) {}
        filterAndRenderGrid();
      }
    })
    .catch(function() {
      clearTimeout(timeoutId);
      var guessed = guessCountryFromTimezone();
      if (guessed) { LiveAppState.userCountry = guessed; filterAndRenderGrid(); }
    });
}

function guessCountryFromTimezone() {
  try {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    var map = {
      'America/New_York':'US','America/Chicago':'US','America/Denver':'US','America/Los_Angeles':'US',
      'Europe/London':'GB','Europe/Paris':'FR','Europe/Berlin':'DE','Europe/Madrid':'ES',
      'Europe/Rome':'IT','Europe/Amsterdam':'NL','Europe/Brussels':'BE','Europe/Vienna':'AT',
      'Europe/Stockholm':'SE','Europe/Oslo':'NO','Europe/Copenhagen':'DK','Europe/Helsinki':'FI',
      'Europe/Dublin':'IE','Europe/Warsaw':'PL','Europe/Prague':'CZ','Europe/Budapest':'HU',
      'Europe/Bucharest':'RO','Europe/Sofia':'BG','Europe/Zagreb':'HR','Europe/Belgrade':'RS',
      'Europe/Athens':'GR','Europe/Istanbul':'TR','Europe/Moscow':'RU','Europe/Kiev':'UA',
      'Asia/Tokyo':'JP','Asia/Seoul':'KR','Asia/Shanghai':'CN','Asia/Taipei':'TW',
      'Asia/Hong_Kong':'HK','Asia/Kolkata':'IN','Asia/Dhaka':'BD','Asia/Colombo':'LK',
      'Asia/Karachi':'PK','Asia/Bangkok':'TH','Asia/Ho_Chi_Minh':'VN','Asia/Jakarta':'ID',
      'Asia/Manila':'PH','Asia/Singapore':'SG','Asia/Riyadh':'SA','Asia/Dubai':'AE',
      'Africa/Cairo':'EG','Africa/Lagos':'NG','Africa/Nairobi':'KE','Africa/Johannesburg':'ZA',
      'America/Sao_Paulo':'BR','America/Mexico_City':'MX','America/Buenos_Aires':'AR',
      'America/Bogota':'CO','America/Lima':'PE','America/Santiago':'CL','Asia/Tehran':'IR'
    };
    return map[tz] || null;
  } catch(e) { return null; }
}

// ==================== CACHING ====================
function setCache(key, data) { try { localStorage.setItem(key, JSON.stringify(data)); } catch(e) {} }
function getCache(key) { try { var d = localStorage.getItem(key); return d ? JSON.parse(d) : null; } catch(e) { return null; } }

// ==================== HERO ENGINE ====================
function initHeroPlayer() {
  if (LiveAppState.allChannels.length === 0) return;
  playRandomHeroChannel();
}

function playRandomHeroChannel() {
  clearTimeout(heroRotationTimer);
  var video = document.getElementById('hero-video-player');
  var nameEl = document.getElementById('hero-channel-name');
  var progEl = document.getElementById('hero-program-title');
  if (!video) return;

  if (heroErrorCount >= LiveConfig.heroMaxErrors) {
    if (nameEl) nameEl.textContent = 'Live TV';
    if (progEl) progEl.textContent = 'Select a channel below to start watching';
    destroyHeroPlayer();
    return;
  }

  var pool = LiveAppState.verifiedLiveChannels.length > 0 ? LiveAppState.verifiedLiveChannels : LiveAppState.allChannels;
  if (pool.length === 0) return;

  var channel = pool[Math.floor(Math.random() * pool.length)];
  if (currentHeroChannel && channel.id === currentHeroChannel.id && pool.length > 1) {
    channel = pool[(pool.indexOf(channel) + 1) % pool.length];
  }
  currentHeroChannel = channel;

  if (nameEl) nameEl.textContent = channel.name;
  if (progEl) progEl.textContent = getSimulatedProgram(channel);

  destroyHeroPlayer();

  if (Hls.isSupported()) {
    heroHlsInstance = new Hls(PremiumHlsConfig);
    heroHlsInstance.loadSource(channel.streamUrl);
    heroHlsInstance.attachMedia(video);
    heroHlsInstance.on(Hls.Events.MANIFEST_PARSED, function() {
      heroErrorCount = 0;
      video.play().catch(function() {});
      heroRotationTimer = setTimeout(playRandomHeroChannel, LiveConfig.heroRotationInterval);
    });
    heroHlsInstance.on(Hls.Events.ERROR, function(ev, data) {
      if (data.fatal) {
        heroErrorCount++;
        destroyHeroPlayer();
        heroRotationTimer = setTimeout(playRandomHeroChannel, LiveConfig.heroErrorRetryDelay);
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = channel.streamUrl;
    var onMeta = function() {
      heroErrorCount = 0;
      video.play().catch(function() {});
      heroRotationTimer = setTimeout(playRandomHeroChannel, LiveConfig.heroRotationInterval);
    };
    var onErr = function() {
      heroErrorCount++;
      heroRotationTimer = setTimeout(playRandomHeroChannel, LiveConfig.heroErrorRetryDelay);
    };
    video.addEventListener('loadedmetadata', onMeta, { once: true });
    video.addEventListener('error', onErr, { once: true });
  }
}

function destroyHeroPlayer() {
  if (heroHlsInstance) { heroHlsInstance.destroy(); heroHlsInstance = null; }
  var video = document.getElementById('hero-video-player');
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
}

function upgradeHeroToVerified() {
  if (LiveAppState.verifiedLiveChannels.length > 0 && !LiveAppState.heroIsVerified) {
    LiveAppState.heroIsVerified = true;
    heroErrorCount = 0;
    playRandomHeroChannel();
  }
}

// ==================== VERIFICATION ENGINE ====================
function testAndRenderRecommended() {
  var section = document.getElementById('recommended-channels-section');
  if (!section) return;

  var device = getDeviceCapability();
  if (device.isLowEnd && navigator.getBattery) {
    navigator.getBattery().then(function(b) {
      if (b.saving) { section.style.display = 'none'; return; }
      runVerification(device);
    }).catch(function() { runVerification(device); });
  } else {
    runVerification(device);
  }
}

function runVerification(device) {
  var row = document.getElementById('recommended-channels-row');
  var section = document.getElementById('recommended-channels-section');
  if (!row || !section) return;

  LiveAppState.verifiedLiveChannels = [];
  LiveAppState.qualityMap = {};
  LiveAppState.failedChannels = {};

  var preferredCats = getPreferredCategories();
  var channelsToTest = LiveAppState.allChannels.slice();

  channelsToTest.sort(function(a, b) {
    var aPref = preferredCats.indexOf(a.category);
    var bPref = preferredCats.indexOf(b.category);
    if (aPref === -1 && bPref === -1) return (b.views || 0) - (a.views || 0);
    if (aPref === -1) return 1;
    if (bPref === -1) return -1;
    return aPref - bPref;
  });

  var maxTest = Math.min(channelsToTest.length, device.isLowEnd ? 8 : 15);
  channelsToTest = channelsToTest.slice(0, maxTest);

  var workingChannels = [];
  var testsRunning = 0;
  var maxResults = LiveConfig.verifyMaxResults;
  var batchSize = device.maxConcurrent;
  var batchIndex = 0;
  var isDone = false;

  function renderVerifiedByCategory() {
    if (workingChannels.length === 0) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    row.innerHTML = '';

    var groups = {};
    workingChannels.forEach(function(ch) {
      var cat = ch.category || 'general';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(ch);
    });

    var sortedCats = Object.keys(groups).sort(function(a, b) {
      var ai = preferredCats.indexOf(a), bi = preferredCats.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    sortedCats.forEach(function(cat) {
      var groupEl = document.createElement('div');
      groupEl.style.cssText = 'margin-bottom:16px;';
      var catLabel = document.createElement('div');
      catLabel.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:0.8rem;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;';
      catLabel.innerHTML = getCategoryIconSVG(cat) + ' <span>' + escapeHTML(cat) + '</span>';
      groupEl.appendChild(catLabel);

      var catRow = document.createElement('div');
      catRow.style.cssText = 'display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;scroll-snap-type:x mandatory;';
      groups[cat].forEach(function(ch) { catRow.appendChild(createVerifiedCard(ch)); });
      groupEl.appendChild(catRow);
      row.appendChild(groupEl);
    });
  }

  function processBatch() {
    if (isDone || workingChannels.length >= maxResults) {
      if (!isDone) { isDone = true; renderVerifiedByCategory(); upgradeHeroToVerified(); updateOfflineBadges(); }
      return;
    }
    var batch = channelsToTest.slice(batchIndex, batchIndex + batchSize);
    if (batch.length === 0) {
      if (!isDone) { isDone = true; renderVerifiedByCategory(); upgradeHeroToVerified(); updateOfflineBadges(); }
      return;
    }
    batchIndex += batchSize;

    batch.forEach(function(ch) {
      if (isDone) return;
      testsRunning++;
      var testVideo = document.createElement('video');
      testVideo.muted = true; testVideo.playsInline = true;
      var testHls = null;
      var timeoutId = setTimeout(function() { finishTest(); }, LiveConfig.verifyTimeout);
      var testDone = false;

      function finishTest() {
        if (testDone) return; testDone = true;
        clearTimeout(timeoutId);
        if (testHls) { testHls.destroy(); testHls = null; }
        testVideo.removeAttribute('src'); testVideo.load();
        testsRunning--;
        if (testsRunning <= 0) processBatch();
      }

      if (Hls.isSupported()) {
        testHls = new Hls(LightHlsConfig);
        testHls.loadSource(ch.streamUrl);
        testHls.attachMedia(testVideo);
        testHls.on(Hls.Events.MANIFEST_PARSED, function() {
          if (!testDone && workingChannels.length < maxResults) {
            var maxH = 0;
            if (testHls.levels) { for (var i = 0; i < testHls.levels.length; i++) { if (testHls.levels[i].height > maxH) maxH = testHls.levels[i].height; } }
            var quality = maxH >= 1080 ? 'FHD' : maxH >= 720 ? 'HD' : maxH >= 480 ? 'SD' : 'LD';
            ch.quality = quality;
            LiveAppState.qualityMap[ch.id] = quality;
            workingChannels.push(ch);
            LiveAppState.verifiedLiveChannels.push(ch);
            if (workingChannels.length >= 2) renderVerifiedByCategory();
          }
          finishTest();
        });
        testHls.on(Hls.Events.ERROR, function(ev, data) {
          if (data.fatal) { LiveAppState.failedChannels[ch.id] = true; finishTest(); }
        });
      } else if (testVideo.canPlayType('application/vnd.apple.mpegurl')) {
        testVideo.src = ch.streamUrl;
        testVideo.addEventListener('loadedmetadata', function() {
          if (!testDone && workingChannels.length < maxResults) {
            ch.quality = 'HD'; LiveAppState.qualityMap[ch.id] = 'HD';
            workingChannels.push(ch); LiveAppState.verifiedLiveChannels.push(ch);
            if (workingChannels.length >= 2) renderVerifiedByCategory();
          }
          finishTest();
        }, { once: true });
        testVideo.addEventListener('error', function() { LiveAppState.failedChannels[ch.id] = true; finishTest(); }, { once: true });
      } else { finishTest(); }
    });
  }
  processBatch();
}

function updateOfflineBadges() {
  document.querySelectorAll('.channel-offline-badge').forEach(function(el) { el.remove(); });
  if (LiveAppState.showOffline) return;
  var cards = document.querySelectorAll('.video-card[data-channel-id]');
  cards.forEach(function(card) {
    var id = card.getAttribute('data-channel-id');
    if (LiveAppState.failedChannels[id]) {
      var badge = document.createElement('div');
      badge.className = 'channel-offline-badge';
      badge.textContent = 'OFFLINE';
      card.querySelector('.video-card-thumb').appendChild(badge);
    }
  });
}

// ==================== RENDERING ====================
function renderLivePage() {
  renderRecentlyWatched();
  filterAndRenderGrid();
  updateLiveCategoryCounts();
  renderPopularChannels();
  setTimeout(testAndRenderRecommended, 1500);
}

function filterAndRenderGrid() {
  var search = LiveAppState.currentSearch.toLowerCase().trim();
  var category = LiveAppState.currentCategory;
  var filtered = LiveAppState.allChannels;

  if (category === 'favorites') {
    filtered = filtered.filter(function(ch) { return LiveAppState.favorites.indexOf(ch.id) !== -1; });
  } else if (search) {
    filtered = filtered.filter(function(ch) {
      return (ch.name || '').toLowerCase().includes(search) ||
             (ch.country || '').toLowerCase().includes(search) ||
             (ch.category || '').toLowerCase().includes(search);
    });
  } else if (category && category !== 'all') {
    filtered = filtered.filter(function(ch) { return ch.category === category; });
  }

  if (!LiveAppState.showOffline) {
    filtered = filtered.filter(function(ch) { return !LiveAppState.failedChannels[ch.id]; });
  }

  var channelsToDisplay = [];
  if (!search && (category === 'all' || !category) && LiveAppState.userCountry) {
    var local = filtered.filter(function(ch) { return ch.country === LiveAppState.userCountry; });
    var global = filtered.filter(function(ch) { return ch.country !== LiveAppState.userCountry; });
    channelsToDisplay = local.slice(0, LiveConfig.localChannelSlots).concat(global.slice(0, LiveConfig.gridPageSize - local.slice(0, LiveConfig.localChannelSlots).length));
  } else {
    channelsToDisplay = filtered.slice(0, LiveConfig.gridPageSize);
  }

  LiveAppState.displayCount = channelsToDisplay.length;
  renderChannelGrid(channelsToDisplay);
  updateChannelCountBadge(filtered.length);
  renderLoadMoreButton(filtered.length);
}

function getFilteredChannels() {
  var search = LiveAppState.currentSearch.toLowerCase().trim();
  var category = LiveAppState.currentCategory;
  var filtered = LiveAppState.allChannels;

  if (category === 'favorites') {
    filtered = filtered.filter(function(ch) { return LiveAppState.favorites.indexOf(ch.id) !== -1; });
  } else if (search) {
    filtered = filtered.filter(function(ch) {
      return (ch.name || '').toLowerCase().includes(search) ||
             (ch.country || '').toLowerCase().includes(search) ||
             (ch.category || '').toLowerCase().includes(search);
    });
  } else if (category && category !== 'all') {
    filtered = filtered.filter(function(ch) { return ch.category === category; });
  }
  if (!LiveAppState.showOffline) {
    filtered = filtered.filter(function(ch) { return !LiveAppState.failedChannels[ch.id]; });
  }
  return filtered;
}

function renderChannelGrid(channels) {
  var grid = document.getElementById('live-tv-grid');
  var noChannels = document.getElementById('no-channels');
  if (!grid) return;
  if (channels.length === 0) { if (noChannels) noChannels.style.display = 'block'; grid.innerHTML = ''; return; }
  if (noChannels) noChannels.style.display = 'none';
  var fragment = document.createDocumentFragment();
  channels.forEach(function(ch) { fragment.appendChild(createLiveChannelCard(ch)); });
  grid.innerHTML = '';
  grid.appendChild(fragment);
}

function renderLoadMoreButton(totalAvailable) {
  var existing = document.getElementById('load-more-container');
  if (existing) existing.remove();
  if (LiveAppState.displayCount >= totalAvailable) return;

  var container = document.createElement('div');
  container.id = 'load-more-container';
  container.style.cssText = 'grid-column:1/-1;text-align:center;padding:20px 0;';
  var btn = document.createElement('button');
  btn.id = 'load-more-btn';
  btn.className = 'action-btn';
  btn.style.cssText = 'background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);padding:12px 40px;border-radius:30px;font-size:0.95rem;cursor:pointer;transition:all 0.2s;font-family:"Poppins",sans-serif;';
  btn.innerHTML = 'Load More Channels (' + (totalAvailable - LiveAppState.displayCount) + ' remaining)';
  btn.addEventListener('click', loadMoreChannels);
  btn.addEventListener('mouseenter', function() { this.style.background = 'var(--accent)'; this.style.color = '#fff'; this.style.borderColor = 'var(--accent)'; });
  btn.addEventListener('mouseleave', function() { this.style.background = 'var(--bg-secondary)'; this.style.color = 'var(--text-primary)'; this.style.borderColor = 'var(--border-color)'; });
  container.appendChild(btn);
  var grid = document.getElementById('live-tv-grid');
  if (grid) grid.parentNode.insertBefore(container, grid.nextSibling);
}

function loadMoreChannels() {
  var filtered = getFilteredChannels();
  var nextBatch = filtered.slice(LiveAppState.displayCount, LiveAppState.displayCount + LiveConfig.gridPageSize);
  if (nextBatch.length === 0) return;
  var grid = document.getElementById('live-tv-grid');
  if (!grid) return;
  var fragment = document.createDocumentFragment();
  nextBatch.forEach(function(ch) { fragment.appendChild(createLiveChannelCard(ch)); });
  grid.appendChild(fragment);
  LiveAppState.displayCount += nextBatch.length;
  renderLoadMoreButton(filtered.length);
}

function updateChannelCountBadge(count) {
  var badge = document.getElementById('channel-count-badge');
  if (badge) badge.textContent = count + ' Channels';
}

function updateLiveCategoryCounts() {
  var channels = LiveAppState.allChannels;
  var setCount = function(id, count) { var el = document.getElementById(id); if (el) el.textContent = count; };
  setCount('count-all', channels.length);
  setCount('count-favorites', LiveAppState.favorites.length);
  var catCounts = {};
  channels.forEach(function(ch) { var cat = ch.category || 'general'; catCounts[cat] = (catCounts[cat] || 0) + 1; });
  Object.keys(catCounts).forEach(function(cat) { setCount('count-' + cat, catCounts[cat]); });
}

function renderPopularChannels() {
  var container = document.getElementById('popular-channels-widget');
  if (!container) return;
  var popular = LiveAppState.allChannels.slice(0, 6);
  container.innerHTML = '';
  if (popular.length === 0) return;
  var fragment = document.createDocumentFragment();
  popular.forEach(function(ch) {
    var item = document.createElement('div');
    item.className = 'widget-video-item';
    item.style.cursor = 'pointer';
    var thumbHtml = ch.thumbnail ? '<img src="' + ch.thumbnail + '" alt="' + escapeHTML(ch.name) + '" loading="lazy" onerror="this.onerror=null;this.style.display=\'none\';">' : '';
    item.innerHTML = '<div class="widget-video-thumb">' + thumbHtml + '</div><div class="widget-video-info"><h4>' + escapeHTML(ch.name) + '</h4><span>' + getCountryName(ch.country) + ' &bull; ' + formatNumber(ch.views) + '</span></div>';
    item.addEventListener('click', function() { goToChannel(ch); });
    fragment.appendChild(item);
  });
  container.appendChild(fragment);
}

function updateSourceIndicator() {
  var existing = document.getElementById('source-indicator');
  if (existing) existing.remove();
  var j = LiveAppState.sources.json, m = LiveAppState.sources.m3u, t = j + m;
  if (t === 0) return;
  var el = document.createElement('div');
  el.id = 'source-indicator';
  el.style.cssText = 'grid-column:1/-1;text-align:center;font-size:0.75rem;color:var(--text-secondary);padding:8px 0;opacity:0.7;';
  el.innerHTML = j + ' C &bull; ' + m + ' S &bull; ' + t + ' total channels';
  var grid = document.getElementById('live-tv-grid');
  if (grid) grid.parentNode.insertBefore(el, grid);
}

// ==================== CARD CREATION ====================
function createLiveChannelCard(channel) {
  var card = document.createElement('article');
  card.className = 'video-card';
  card.setAttribute('tabindex', '0');
  card.setAttribute('data-channel-id', channel.id);

  var isFav = LiveAppState.favorites.indexOf(channel.id) !== -1;
  var quality = LiveAppState.qualityMap[channel.id] || '';
  var isOffline = !!LiveAppState.failedChannels[channel.id];

  var thumbContent = '';
  if (channel.hasLogo) {
    thumbContent = '<img src="' + channel.thumbnail + '" alt="' + escapeHTML(channel.name) + '" loading="lazy" onerror="this.onerror=null;this.style.display=\'none\';this.parentNode.querySelector(\'.live-preview-video\').style.display=\'block\';">';
  }
  thumbContent += '<video class="live-preview-video" muted loop playsinline preload="none" style="' + (channel.hasLogo ? 'display:none;' : '') + '"></video>';

  var qualityBadge = quality ? '<span class="quality-badge" style="position:absolute;bottom:8px;left:8px;background:' + getQualityColor(quality) + ';color:#fff;font-size:0.6rem;padding:2px 6px;border-radius:3px;font-weight:700;z-index:5;letter-spacing:0.5px;">' + quality + '</span>' : '';
  var offlineBadge = isOffline ? '<div class="channel-offline-badge" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.85);color:#ff4757;padding:6px 14px;border-radius:6px;font-size:0.75rem;font-weight:700;z-index:5;letter-spacing:0.5px;">OFFLINE</div>' : '';
  var sourceTag = channel.source === 'm3u' ? '<span style="font-size:0.6rem;color:var(--text-secondary);opacity:0.5;margin-left:2px;">M3U</span>' : '';

  // Heart SVG paths
  var heartPath = '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>';
  var heartFill = isFav ? 'currentColor' : 'none';

  card.innerHTML =
    '<div class="video-card-thumb">' +
      thumbContent +
      // Country — TOP LEFT
      (channel.country ? '<span class="video-card-country" style="position:absolute;top:10px;left:10px;z-index:5!important;right:auto!important;">' + escapeHTML(channel.country) + '</span>' : '') +
      // Favorite heart — TOP RIGHT
      '<button class="fav-btn" data-id="' + channel.id + '" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.55);border:none;color:' + (isFav ? '#ff4757' : 'rgba(255,255,255,0.6)') + ';width:30px;height:30px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:6;transition:all 0.2s;backdrop-filter:blur(4px);" title="' + (isFav ? 'Remove from Favorites' : 'Add to Favorites') + '">' +
        '<svg viewBox="0 0 24 24" fill="' + heartFill + '" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;transition:fill 0.2s;">' + heartPath + '</svg>' +
      '</button>' +
      // Play overlay — CENTER
      '<div class="video-card-overlay" style="z-index:2;">' +
        '<div class="play-btn-overlay"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div>' +
        // PiP button — BOTTOM RIGHT
        '<button class="pip-btn" title="Picture in Picture" style="position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.65);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:5;opacity:0;transition:opacity 0.2s;backdrop-filter:blur(4px);">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><rect x="2" y="3" width="20" height="14" rx="2"/><rect x="12" y="9" width="8" height="8" rx="1" fill="currentColor" opacity="0.3"/></svg>' +
        '</button>' +
      '</div>' +
      qualityBadge + offlineBadge +
    '</div>' +
    '<div class="video-card-body">' +
      '<h3 class="video-card-title">' + escapeHTML(channel.name) + '</h3>' +
      '<span class="card-now-playing">' + escapeHTML(getSimulatedProgram(channel)) + '</span>' +
      '<div class="video-card-stats">' +
        // LIVE indicator — inline in stats
        '<span style="display:inline-flex;align-items:center;gap:3px;color:#ff4757;font-weight:700;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.5px;"><span style="width:6px;height:6px;background:#ff4757;border-radius:50%;display:inline-block;animation:pulse-badge 2s infinite;"></span> Live</span>' +
        '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;vertical-align:middle;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> ' + formatNumber(channel.views) + '</span>' +
        '<span style="display:flex;align-items:center;gap:4px;">' + getCategoryIconSVG(channel.category) + ' <span style="text-transform:uppercase;font-weight:600;font-size:0.75rem;color:var(--accent);">' + escapeHTML(channel.category || 'Live') + '</span></span>' +
        sourceTag +
      '</div>' +
    '</div>';

  // Preview on hover
  var vidEl = card.querySelector('.live-preview-video');
  card.addEventListener('mouseenter', function() {
    card.querySelector('.pip-btn').style.opacity = '1';
    if (!channel.hasLogo || vidEl.style.display === 'block') {
      startCardPreview(vidEl, channel.streamUrl);
    }
  });
  card.addEventListener('mouseleave', function() {
    card.querySelector('.pip-btn').style.opacity = '0';
    stopCardPreview();
  });

  // Favorite button
  card.querySelector('.fav-btn').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(channel.id);
    var btn = card.querySelector('.fav-btn');
    var isNowFav = LiveAppState.favorites.indexOf(channel.id) !== -1;
    btn.style.color = isNowFav ? '#ff4757' : 'rgba(255,255,255,0.6)';
    btn.querySelector('svg').setAttribute('fill', isNowFav ? 'currentColor' : 'none');
    btn.title = isNowFav ? 'Remove from Favorites' : 'Add to Favorites';
    updateLiveCategoryCounts();
    if (LiveAppState.currentCategory === 'favorites') filterAndRenderGrid();
  });

  // PiP button
  card.querySelector('.pip-btn').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    startPiP(channel.streamUrl, channel.name);
  });

  card.addEventListener('click', function() { goToChannel(channel); });
  card.addEventListener('keydown', function(e) { if (e.key === 'Enter') goToChannel(channel); });
  return card;
}

function createVerifiedCard(channel) {
  var item = document.createElement('a');
  item.href = '#';
  item.className = 'video-card';
  item.style.cssText = 'min-width:200px;max-width:200px;scroll-snap-align:start;text-decoration:none;color:inherit;position:relative;';
  item.setAttribute('data-channel-id', channel.id);

  var quality = channel.quality || LiveAppState.qualityMap[channel.id] || '';
  var thumbHtml = channel.thumbnail ? '<img src="' + channel.thumbnail + '" alt="' + escapeHTML(channel.name) + '" loading="lazy" onerror="this.onerror=null;this.style.display=\'none\';">' : '';
  var qualityBadge = quality ? '<span style="position:absolute;bottom:6px;left:6px;background:' + getQualityColor(quality) + ';color:#fff;font-size:0.55rem;padding:1px 4px;border-radius:2px;font-weight:700;z-index:5;">' + quality + '</span>' : '';

  item.innerHTML =
    '<div class="video-card-thumb" style="height:112px;">' + thumbHtml +
    '<div class="video-card-overlay"><div class="play-btn-overlay"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div></div>' +
    '<div class="verified-live-badge">VERIFIED</div>' + qualityBadge +
    '</div>' +
    '<div class="video-card-body" style="padding:8px 0;">' +
      '<h3 class="video-card-title" style="font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHTML(channel.name) + '</h3>' +
      '<span style="font-size:0.7rem;color:var(--text-secondary);">' + getCountryName(channel.country) + '</span>' +
    '</div>';

  item.addEventListener('click', function(e) { e.preventDefault(); goToChannel(channel); });
  return item;
}

// ==================== CARD PREVIEWS ====================
function startCardPreview(videoEl, streamUrl) {
  stopCardPreview();
  activePreviewVideo = videoEl;
  if (Hls.isSupported()) {
    activePreviewHls = new Hls(LightHlsConfig);
    activePreviewHls.loadSource(streamUrl);
    activePreviewHls.attachMedia(videoEl);
    activePreviewHls.on(Hls.Events.MANIFEST_PARSED, function() { videoEl.play().catch(function() {}); });
    activePreviewHls.on(Hls.Events.ERROR, function(ev, data) { if (data.fatal) stopCardPreview(); });
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = streamUrl;
    videoEl.play().catch(function() {});
  }
}

function stopCardPreview() {
  if (activePreviewHls) { activePreviewHls.destroy(); activePreviewHls = null; }
  if (activePreviewVideo) {
    activePreviewVideo.pause();
    activePreviewVideo.removeAttribute('src');
    activePreviewVideo.load();
    activePreviewVideo = null;
  }
}

function setupPreviewCleanup() {
  var scrollTimer;
  window.addEventListener('scroll', function() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(stopCardPreview, LiveConfig.previewCleanupDelay);
  }, { passive: true });
  document.addEventListener('visibilitychange', function() { if (document.hidden) stopCardPreview(); });
}

// ==================== FAVORITES ====================
function loadFavorites() {
  try { var data = localStorage.getItem(FAVORITES_KEY); LiveAppState.favorites = data ? JSON.parse(data) : []; } catch(e) { LiveAppState.favorites = []; }
}

function toggleFavorite(channelId) {
  var idx = LiveAppState.favorites.indexOf(channelId);
  if (idx === -1) { LiveAppState.favorites.push(channelId); } else { LiveAppState.favorites.splice(idx, 1); }
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(LiveAppState.favorites)); } catch(e) {}
}

function isFavorite(channelId) { return LiveAppState.favorites.indexOf(channelId) !== -1; }

// ==================== PICTURE IN PICTURE ====================
function startPiP(streamUrl, channelName) {
  if (!document.pictureInPictureEnabled) { showPiPNotSupported(); return; }
  if (pipHls) { pipHls.destroy(); pipHls = null; }
  if (pipVideo) { pipVideo.remove(); pipVideo = null; }

  pipVideo = document.createElement('video');
  pipVideo.muted = false;
  pipVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
  document.body.appendChild(pipVideo);

  if (Hls.isSupported()) {
    pipHls = new Hls(PremiumHlsConfig);
    pipHls.loadSource(streamUrl);
    pipHls.attachMedia(pipVideo);
    pipHls.on(Hls.Events.MANIFEST_PARSED, function() {
      pipVideo.play().then(function() { return pipVideo.requestPictureInPicture(); }).then(function() { pipVideo.style.cssText = ''; }).catch(function() { cleanupPiP(); });
    });
    pipHls.on(Hls.Events.ERROR, function(ev, data) { if (data.fatal) { cleanupPiP(); showPiPError(); } });
  } else if (pipVideo.canPlayType('application/vnd.apple.mpegurl')) {
    pipVideo.src = streamUrl;
    pipVideo.addEventListener('loadedmetadata', function() {
      pipVideo.play().then(function() { return pipVideo.requestPictureInPicture(); }).then(function() { pipVideo.style.cssText = ''; }).catch(function() { cleanupPiP(); });
    }, { once: true });
  }
  pipVideo.addEventListener('leavepictureinpicture', cleanupPiP);
}

function cleanupPiP() { if (pipHls) { pipHls.destroy(); pipHls = null; } if (pipVideo) { pipVideo.remove(); pipVideo = null; } }

function showPiPNotSupported() {
  var toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:var(--bg-secondary);color:var(--text-primary);padding:12px 24px;border-radius:12px;font-size:0.9rem;z-index:9999;border:1px solid var(--border-color);box-shadow:0 4px 20px rgba(0,0,0,0.3);animation:fadeInUp 0.3s ease;';
  toast.textContent = 'Picture-in-Picture is not supported in this browser';
  document.body.appendChild(toast);
  setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function() { toast.remove(); }, 300); }, 3000);
}

function showPiPError() {
  var toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#ff4757;color:#fff;padding:12px 24px;border-radius:12px;font-size:0.9rem;z-index:9999;box-shadow:0 4px 20px rgba(255,71,87,0.3);';
  toast.textContent = 'Could not start Picture-in-Picture. Stream may be offline.';
  document.body.appendChild(toast);
  setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function() { toast.remove(); }, 300); }, 3000);
}

// ==================== RECENT HISTORY ====================
function saveToRecent(channel) {
  var recent = getRecent();
  recent = recent.filter(function(ch) { return ch.id !== channel.id; });
  recent.unshift({ id: channel.id, name: channel.name, thumbnail: channel.thumbnail, country: channel.country, streamUrl: channel.streamUrl, category: channel.category, hasLogo: channel.hasLogo, timestamp: Date.now() });
  if (recent.length > LiveConfig.recentMaxItems) recent = recent.slice(0, LiveConfig.recentMaxItems);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); } catch(e) {}
}

function getRecent() { try { var d = localStorage.getItem(RECENT_KEY); return d ? JSON.parse(d) : []; } catch(e) { return []; } }

function getPreferredCategories() {
  var recent = getRecent();
  var catCounts = {};
  recent.forEach(function(ch) { var cat = ch.category || 'general'; catCounts[cat] = (catCounts[cat] || 0) + 1; });
  return Object.keys(catCounts).sort(function(a, b) { return catCounts[b] - catCounts[a]; });
}

function renderRecentlyWatched() {
  var section = document.getElementById('recently-watched-section');
  var row = document.getElementById('recent-channels-row');
  if (!section || !row) return;
  var recent = getRecent();
  if (recent.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block'; row.innerHTML = '';
  recent.forEach(function(ch) {
    var item = document.createElement('a');
    item.href = '#'; item.className = 'video-card';
    item.style.cssText = 'min-width:200px;max-width:200px;scroll-snap-align:start;text-decoration:none;color:inherit;position:relative;';
    var thumbHtml = ch.thumbnail ? '<img src="' + ch.thumbnail + '" alt="' + escapeHTML(ch.name) + '" loading="lazy" onerror="this.onerror=null;this.style.display=\'none\';">' : '';
    var timeStr = ch.timestamp ? timeAgo(ch.timestamp) : '';
    item.innerHTML = '<div class="video-card-thumb" style="height:112px;">' + thumbHtml + '<div class="video-card-overlay"><div class="play-btn-overlay"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div></div></div><div class="video-card-body" style="padding:8px 0;"><h3 class="video-card-title" style="font-size:0.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHTML(ch.name) + '</h3><span style="font-size:0.7rem;color:var(--text-secondary);">' + (timeStr || getCountryName(ch.country)) + '</span></div>';
    item.addEventListener('click', function(e) { e.preventDefault(); goToChannel(ch); });
    row.appendChild(item);
  });
}

// ==================== SIMULATED PROGRAM ====================
function getSimulatedProgram(channel) {
  var cat = channel.category || '';
  if (cat.includes('news')) return 'Live News Desk & Breaking Updates';
  if (cat.includes('sport')) return 'Live Sports Broadcast';
  if (cat.includes('weather')) return 'Live Weather Broadcast';
  if (cat.includes('music')) return 'Non-Stop Music Videos';
  if (cat.includes('movie') || cat.includes('cinema')) return 'Now Showing: Feature Film';
  if (cat.includes('kids') || cat.includes('cartoon')) return 'Kids Entertainment Live';
  if (cat.includes('documentary')) return 'Documentary & Factual Programming';
  if (cat.includes('religious') || cat.includes('faith')) return 'Live Spiritual Programming';
  if (cat.includes('travel')) return 'Live Destination & Travel Guide';
  if (cat.includes('shop') || cat.includes('shopping')) return 'Live Shopping Channel';
  if (cat.includes('legislative') || cat.includes('parliament')) return 'Live Parliamentary Proceedings';
  if (cat.includes('event')) return 'Live Event Coverage';
  if (cat.includes('entertainment')) return 'Entertainment & Talk Shows';
  if (cat.includes('comedy')) return 'Comedy & Entertainment';
  if (cat.includes('education')) return 'Educational Programming';
  if (cat.includes('food')) return 'Cooking & Food Shows';
  if (cat.includes('gaming')) return 'Live Gaming Streams';
  return 'Live Broadcast';
}

// ==================== BACKGROUND REFRESH ====================
function startBackgroundRefresh() {
  if (LiveAppState.refreshTimers.json) clearInterval(LiveAppState.refreshTimers.json);
  if (LiveAppState.refreshTimers.m3u) clearInterval(LiveAppState.refreshTimers.m3u);
  if (LiveAppState.refreshTimers.verify) clearInterval(LiveAppState.refreshTimers.verify);
  LiveAppState.refreshTimers.json = setInterval(backgroundRefreshJson, LiveConfig.jsonRefreshInterval);
  LiveAppState.refreshTimers.m3u = setInterval(backgroundRefreshM3U, LiveConfig.m3uRefreshInterval);
  LiveAppState.refreshTimers.verify = setInterval(backgroundReverify, LiveConfig.reverifyInterval);
}

function backgroundRefreshJson() {
  fetch('channels.json').then(function(r) { if (!r.ok) throw new Error(); return r.json(); }).then(function(data) {
    var newHash = hashString(JSON.stringify(data.map(function(c) { return c.streamUrl; })));
    if (newHash !== LiveAppState.lastDataHash) { setCache(CACHE_JSON_KEY, data); silentMergeJson(data); showRefreshIndicator(); }
    LiveAppState.lastRefresh.json = Date.now();
  }).catch(function() {});
}

function backgroundRefreshM3U() {
  fetchM3UStreams().then(function(channels) {
    if (channels.length > 0) { setCache(CACHE_M3U_KEY, channels); silentMergeM3U(channels); showRefreshIndicator(); }
    LiveAppState.lastRefresh.m3u = Date.now();
  }).catch(function() {});
}

function backgroundReverify() {
  var device = getDeviceCapability();
  if (device.isLowEnd) return;
  var toVerify = LiveAppState.allChannels.filter(function(ch) { return !LiveAppState.qualityMap[ch.id] && !LiveAppState.failedChannels[ch.id]; }).slice(0, 8);
  if (toVerify.length === 0) return;
  var newVerified = [], running = 0;
  toVerify.forEach(function(ch) {
    running++;
    var tv = document.createElement('video'); tv.muted = true; tv.playsInline = true;
    var h = null, tid = setTimeout(function() { done(); }, 6000), d = false;
    function done() { if (d) return; d = true; clearTimeout(tid); if (h) { h.destroy(); h = null; } tv.removeAttribute('src'); tv.load(); running--; if (running <= 0 && newVerified.length > 0) { newVerified.forEach(function(nv) { if (!LiveAppState.verifiedLiveChannels.some(function(v) { return v.id === nv.id; })) LiveAppState.verifiedLiveChannels.push(nv); }); upgradeHeroToVerified(); } }
    if (Hls.isSupported()) {
      h = new Hls(LightHlsConfig); h.loadSource(ch.streamUrl); h.attachMedia(tv);
      h.on(Hls.Events.MANIFEST_PARSED, function() { var maxH = 0; if (h.levels) for (var i = 0; i < h.levels.length; i++) if (h.levels[i].height > maxH) maxH = h.levels[i].height; ch.quality = maxH >= 1080 ? 'FHD' : maxH >= 720 ? 'HD' : maxH >= 480 ? 'SD' : 'LD'; LiveAppState.qualityMap[ch.id] = ch.quality; newVerified.push(ch); done(); });
      h.on(Hls.Events.ERROR, function(ev, data) { if (data.fatal) { LiveAppState.failedChannels[ch.id] = true; done(); } });
    } else { done(); }
  });
}

function silentMergeJson(jsonData) {
  var jp = jsonData.filter(function(ch) { return ch.streamUrl && isValidStreamUrl(ch.streamUrl) && !isBrokenUrl(ch.streamUrl) && ch.category; }).map(function(ch) {
    var rt = ch.logo || '', ct = (rt && rt.startsWith('http')) ? rt : '', ri = ch.id || (ch.name + '-' + ch.country);
    return { id: ri.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''), name: ch.name || 'Unknown Channel', category: (ch.category||'general').toLowerCase(), thumbnail: ct, hasLogo: !!ct, streamUrl: ch.streamUrl, country: (ch.country||'INT').toUpperCase().substring(0,3), source: 'json' };
  });
  LiveAppState.sources.json = jp.length;
  var existing = LiveAppState.allChannels.filter(function(c) { return c.source !== 'json'; });
  LiveAppState.allChannels = deduplicateChannels(existing.concat(jp));
  LiveAppState.allChannels.sort(function(a, b) { return (b.views||0) - (a.views||0); });
  filterAndRenderGrid(); updateLiveCategoryCounts(); renderPopularChannels(); updateSourceIndicator();
}

function silentMergeM3U(m3uChannels) {
  var mp = m3uChannels.filter(function(ch) { return ch.streamUrl && isValidStreamUrl(ch.streamUrl) && !isBrokenUrl(ch.streamUrl); }).map(function(ch) {
    var ri = ch.name + '-' + ch.country + '-' + hashString(ch.streamUrl).toString(36);
    return { id: ri.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''), name: ch.name || 'Unknown Channel', category: ch.category || 'general', thumbnail: ch.thumbnail || '', hasLogo: !!ch.thumbnail, streamUrl: ch.streamUrl, country: ch.country || 'INT', source: 'm3u' };
  });
  LiveAppState.sources.m3u = mp.length;
  var existing = LiveAppState.allChannels.filter(function(c) { return c.source !== 'm3u'; });
  LiveAppState.allChannels = deduplicateChannels(existing.concat(mp));
  LiveAppState.allChannels.sort(function(a, b) { return (b.views||0) - (a.views||0); });
  filterAndRenderGrid(); updateLiveCategoryCounts(); updateSourceIndicator();
}

function showRefreshIndicator() {
  var el = document.getElementById('refresh-indicator');
  if (!el) {
    el = document.createElement('div'); el.id = 'refresh-indicator';
    el.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--bg-secondary);color:var(--text-primary);padding:8px 16px;border-radius:20px;font-size:0.8rem;z-index:9999;border:1px solid var(--border-color);box-shadow:0 2px 10px rgba(0,0,0,0.2);opacity:0;transition:opacity 0.3s;display:flex;align-items:center;gap:6px;';
    el.innerHTML = '<span style="width:6px;height:6px;background:#00b894;border-radius:50%;"></span> Updated';
    document.body.appendChild(el);
  }
  el.style.opacity = '1';
  setTimeout(function() { el.style.opacity = '0'; }, 2000);
}

// ==================== NAVIGATION ====================
function goToChannel(channel) {
  saveToRecent(channel);
  try { sessionStorage.setItem(NAV_CHANNEL_KEY, JSON.stringify({ id: channel.id, name: channel.name, category: channel.category, thumbnail: channel.thumbnail, streamUrl: channel.streamUrl, country: channel.country, timestamp: Date.now() })); } catch(e) {}
  window.location.href = 'channel.html?id=' + encodeURIComponent(channel.id);
}

function shufflePlay() {
  if (LiveAppState.allChannels.length === 0) return;
  var pool = LiveAppState.verifiedLiveChannels.length > 0 ? LiveAppState.verifiedLiveChannels : LiveAppState.allChannels;
  goToChannel(pool[Math.floor(Math.random() * pool.length)]);
}

// ==================== UI INJECTION ====================
function injectHeroStyles() {
  if (document.getElementById('hero-dynamic-styles')) return;
  var style = document.createElement('style');
  style.id = 'hero-dynamic-styles';
  style.innerHTML = '' +
    '#live-hero-section,#live-hero-section img,#live-hero-section video,.video-card img,.video-card video{image-rendering:-webkit-optimize-contrast;image-rendering:crisp-edges;backface-visibility:hidden;-webkit-font-smoothing:antialiased;}' +
    '#live-hero-section{position:relative;width:100%;height:50vh;min-height:300px;max-height:500px;background:#000;border-radius:16px;overflow:hidden;margin-bottom:30px;grid-column:1/-1;}' +
    '#hero-video-player{width:100%;height:100%;object-fit:cover;opacity:0.6;pointer-events:none;}' +
    '.hero-overlay{position:absolute;bottom:0;left:0;width:100%;height:70%;background:linear-gradient(to top,rgba(0,0,0,0.95),transparent);display:flex;align-items:flex-end;padding:40px;box-sizing:border-box;}' +
    '.hero-content{color:#fff;max-width:600px;z-index:2;}' +
    '.hero-live-badge{display:inline-block;background:#ff4757;color:#fff;padding:4px 10px;border-radius:4px;font-size:0.75rem;font-weight:700;margin-bottom:12px;letter-spacing:1px;animation:pulse-badge 2s infinite;}' +
    '@keyframes pulse-badge{0%,100%{opacity:1;}50%{opacity:0.7;}}' +
    '.hero-channel-name{font-family:"Poppins",sans-serif;font-size:2.2rem;font-weight:800;margin:0 0 8px 0;line-height:1.2;text-shadow:0 2px 4px rgba(0,0,0,0.5);}' +
    '.hero-program-title{font-size:1rem;color:#ccc;margin:0 0 20px 0;font-style:italic;}' +
    '#hero-watch-btn{display:inline-flex;align-items:center;gap:8px;background:var(--accent,#ff4757);color:#fff;text-decoration:none;padding:12px 28px;border-radius:30px;font-weight:600;font-size:1rem;transition:transform 0.2s,box-shadow 0.2s;cursor:pointer;border:none;}' +
    '#hero-watch-btn:hover{transform:scale(1.05);box-shadow:0 4px 15px rgba(255,71,87,0.4);}' +
    '.card-now-playing{display:block;font-size:0.8rem;color:var(--text-secondary,#888);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.live-preview-video{width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0;background:#000;z-index:1;}' +
    '.video-card-thumb{position:relative;}' +
    '.verified-live-badge{position:absolute;top:8px;right:8px;background:#00b894;color:#fff;font-size:0.6rem;padding:2px 6px;border-radius:4px;font-weight:700;z-index:6;letter-spacing:0.5px;}' +
    '.channel-offline-badge{pointer-events:none;}' +
    '.fav-btn:hover{transform:scale(1.15)!important;background:rgba(0,0,0,0.75)!important;}' +
    '.fav-btn:active{transform:scale(0.9)!important;}' +
    '.pip-btn:hover{background:rgba(255,255,255,0.25)!important;}' +
    '@keyframes fadeInUp{from{opacity:0;transform:translateX(-50%) translateY(10px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}';
  document.head.appendChild(style);
}

function injectExtraUI() {
  var gridWrapper = document.getElementById('live-tv-grid');
  if (!gridWrapper || gridWrapper.dataset.uiInjected === 'true') return;
  gridWrapper.dataset.uiInjected = 'true';

  var heroSection = document.createElement('div');
  heroSection.id = 'live-hero-section';
  heroSection.innerHTML = '<video id="hero-video-player" muted loop playsinline></video><div class="hero-overlay"><div class="hero-content"><span class="hero-live-badge">● LIVE NOW</span><h2 class="hero-channel-name" id="hero-channel-name">Loading Channel...</h2><p class="hero-program-title" id="hero-program-title"></p><button id="hero-watch-btn" type="button"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Watch Now</button></div></div>';
  gridWrapper.parentNode.insertBefore(heroSection, gridWrapper);
  document.getElementById('hero-watch-btn').addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); if (currentHeroChannel) goToChannel(currentHeroChannel); });

  var recentSection = document.createElement('div');
  recentSection.id = 'recently-watched-section';
  recentSection.style.cssText = 'grid-column:1/-1;margin-bottom:20px;display:none;';
  recentSection.innerHTML = '<h3 style="margin-bottom:15px;font-size:1.2rem;color:var(--text-primary);display:flex;align-items:center;gap:8px;"><svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" style="width:18px;height:18px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Continue Watching</h3><div id="recent-channels-row" style="display:flex;gap:15px;overflow-x:auto;padding-bottom:10px;scroll-snap-type:x mandatory;"></div>';
  gridWrapper.parentNode.insertBefore(recentSection, gridWrapper);

  var recommendedSection = document.createElement('div');
  recommendedSection.id = 'recommended-channels-section';
  recommendedSection.style.cssText = 'grid-column:1/-1;margin-bottom:20px;display:none;';
  recommendedSection.innerHTML = '<h3 style="margin-bottom:15px;font-size:1.2rem;color:var(--text-primary);display:flex;align-items:center;gap:8px;"><svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" style="width:18px;height:18px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Verified Live Now</h3><div id="recommended-channels-row" style="max-height:400px;overflow-y:auto;padding-right:8px;"></div>';
  gridWrapper.parentNode.insertBefore(recommendedSection, gridWrapper);

  var controlsRow = document.createElement('div');
  controlsRow.style.cssText = 'grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;margin-bottom:15px;flex-wrap:wrap;gap:10px;';
  var leftControls = document.createElement('div');
  leftControls.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;';
  var shuffleBtn = document.createElement('button');
  shuffleBtn.className = 'action-btn';
  shuffleBtn.style.cssText = 'background:var(--accent);color:#fff;border:none;padding:10px 20px;border-radius:25px;cursor:pointer;font-size:0.9rem;display:flex;align-items:center;gap:6px;transition:transform 0.2s,box-shadow 0.2s;font-family:"Poppins",sans-serif;';
  shuffleBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg> Surprise Me';
  shuffleBtn.addEventListener('click', shufflePlay);
  shuffleBtn.addEventListener('mouseenter', function() { this.style.transform = 'scale(1.05)'; this.style.boxShadow = '0 4px 15px rgba(255,71,87,0.3)'; });
  shuffleBtn.addEventListener('mouseleave', function() { this.style.transform = ''; this.style.boxShadow = ''; });
  leftControls.appendChild(shuffleBtn);
  var offlineToggle = document.createElement('label');
  offlineToggle.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:0.85rem;color:var(--text-secondary);cursor:pointer;user-select:none;';
  offlineToggle.innerHTML = '<input type="checkbox" id="show-offline-toggle" style="accent-color:var(--accent);"> Show offline';
  offlineToggle.querySelector('input').addEventListener('change', function() { LiveAppState.showOffline = this.checked; filterAndRenderGrid(); });
  leftControls.appendChild(offlineToggle);
  controlsRow.appendChild(leftControls);
  gridWrapper.parentNode.insertBefore(controlsRow, gridWrapper);
}

// ==================== EVENT BINDING ====================
function bindLiveEvents() {
  var dropdownFilter = document.getElementById('live-category-filter');
  if (dropdownFilter) {
    var favOpt = document.createElement('option'); favOpt.value = 'favorites'; favOpt.textContent = '❤️ Favorites';
    dropdownFilter.appendChild(favOpt);
    dropdownFilter.addEventListener('change', function() {
      LiveAppState.currentCategory = this.value; LiveAppState.currentSearch = ''; LiveAppState.displayCount = 0;
      var si = document.getElementById('live-search'); if (si) si.value = '';
      syncSidebarActiveState(this.value); filterAndRenderGrid();
    });
  }

  var sidebarLinks = document.getElementById('live-sidebar-categories');
  if (sidebarLinks) {
    var favLink = document.createElement('a'); favLink.href = '#'; favLink.dataset.category = 'favorites';
    favLink.innerHTML = '❤️ <span>Favorites</span> <span class="count" id="count-favorites">0</span>';
    sidebarLinks.appendChild(favLink);
    sidebarLinks.addEventListener('click', function(e) {
      e.preventDefault(); var link = e.target.closest('a'); if (!link) return;
      var all = sidebarLinks.querySelectorAll('a'); for (var i = 0; i < all.length; i++) all[i].classList.remove('active');
      link.classList.add('active'); LiveAppState.currentCategory = link.dataset.category;
      LiveAppState.currentSearch = ''; LiveAppState.displayCount = 0;
      var si = document.getElementById('live-search'); if (si) si.value = '';
      if (dropdownFilter) dropdownFilter.value = link.dataset.category;
      filterAndRenderGrid();
    });
  }

  var searchInput = document.getElementById('live-search');
  if (searchInput) {
    var searchTimer;
    searchInput.addEventListener('input', function() {
      clearTimeout(searchTimer); var val = this.value;
      searchTimer = setTimeout(function() { LiveAppState.currentSearch = val; LiveAppState.displayCount = 0; filterAndRenderGrid(); }, LiveConfig.searchDebounce);
    });
  }
}

function syncSidebarActiveState(category) {
  var links = document.querySelectorAll('#live-sidebar-categories a');
  for (var i = 0; i < links.length; i++) { links[i].classList.toggle('active', links[i].dataset.category === category); }
}

function setupKeyboardNav() {
  document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    var cards = Array.prototype.slice.call(document.querySelectorAll('#live-tv-grid .video-card'));
    if (cards.length === 0) return;
    var focused = document.activeElement;
    var currentIndex = cards.indexOf(focused);
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); cards[currentIndex >= 0 ? Math.min(currentIndex + 1, cards.length - 1) : 0].focus(); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); cards[currentIndex > 0 ? currentIndex - 1 : 0].focus(); }
    else if (e.key === 'f' && focused) { var id = focused.getAttribute('data-channel-id'); if (id) { toggleFavorite(id); focused.querySelector('.fav-btn').click(); } }
  });
}

// ==================== INITIALIZATION ====================
function initLivePage() {
  if (document.body.dataset.page !== 'live') return;
  injectHeroStyles(); injectExtraUI(); fetchUserCountry(); fetchAllChannelSources();
  bindLiveEvents(); setupKeyboardNav(); setupPreviewCleanup();
  window.addEventListener('beforeunload', function() {
    destroyHeroPlayer(); stopCardPreview(); cleanupPiP();
    if (LiveAppState.refreshTimers.json) clearInterval(LiveAppState.refreshTimers.json);
    if (LiveAppState.refreshTimers.m3u) clearInterval(LiveAppState.refreshTimers.m3u);
    if (LiveAppState.refreshTimers.verify) clearInterval(LiveAppState.refreshTimers.verify);
  });
}

document.addEventListener('DOMContentLoaded', function() { setTimeout(initLivePage, 100); });