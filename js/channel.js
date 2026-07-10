/* =============================================
   Channel Watch Page Logic (Strictly for custom channels.json)
   Premium Quality & Sharing
   ============================================= */

var hlsInstance = null;
var allChannelsData = [];
var currentChannelData = null;

var sidebarHlsInstance = null;
var sidebarPreviewVideo = null;

var NAV_CHANNEL_KEY = 'xstream_nav_channel';

var PremiumHlsConfig = {
  enableWorker: true, lowLatencyMode: false, maxBufferLength: 30, maxMaxBufferLength: 600,
  startFragPrefetch: true, testBandwidth: true, abrEwmaDefaultEstimate: 5000000, capLevelToPlayerSize: false       
};

var SidebarHlsConfig = {
  enableWorker: true, lowLatencyMode: false, capLevelToPlayerSize: true, maxBufferLength: 10
};

if (typeof escapeHTML === 'undefined') {
  window.escapeHTML = function(str) { if (!str) return ''; var div = document.createElement('div'); div.appendChild(document.createTextNode(str)); return div.innerHTML; };
}
if (typeof formatNumber === 'undefined') {
  window.formatNumber = function(num) { if (!num) return '0'; if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'; if (num >= 1000) return (num / 1000).toFixed(1) + 'K'; return num.toString(); };
}

document.addEventListener('DOMContentLoaded', function() { initChannelPage(); });

function injectChannelStyles() {
  if (document.getElementById('channel-premium-styles')) return;
  var style = document.createElement('style');
  style.id = 'channel-premium-styles';
  style.innerHTML = `
    /* Scoped to content areas only - NOT header */
    #video-player-wrapper img,
    #video-player-wrapper video,
    .widget-video-thumb img,
    .widget-video-thumb video,
    .sidebar-preview-video,
    #video-info img {
      image-rendering: -webkit-optimize-contrast;
      image-rendering: crisp-edges;
    }
    .widget-video-thumb { position: relative; overflow: hidden; }
    .sidebar-preview-video { width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; background: #000; z-index: 1; }
  `;
  document.head.appendChild(style);
}

function sanitizeChannelId(rawId, name, country) {
  if (rawId && typeof rawId === 'string' && rawId.trim().length > 0) {
    return rawId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
  var generated = (name || 'unknown') + '-' + (country || 'int');
  return generated.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function findChannelById(channels, targetId) {
  if (!targetId || !channels || channels.length === 0) return null;
  
  var targetLower = targetId.toLowerCase().trim();
  
  for (var i = 0; i < channels.length; i++) {
    var ch = channels[i];
    
    if (String(ch.id).toLowerCase() === targetLower) return ch;
    
    var sanitizedOrigId = sanitizeChannelId(ch.id, ch.name, ch.country);
    if (sanitizedOrigId === targetLower) return ch;
    
    var generatedId = ((ch.name || 'unknown') + '-' + (ch.country || 'int')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    if (generatedId === targetLower) return ch;
    
    if (ch.id && String(ch.id).toLowerCase() === targetLower) return ch;
  }
  
  return null;
}

function getNavFallback() {
  try {
    var data = sessionStorage.getItem(NAV_CHANNEL_KEY);
    if (data) {
      var parsed = JSON.parse(data);
      if (parsed.timestamp && (Date.now() - parsed.timestamp) < 30000) {
        return parsed;
      }
      sessionStorage.removeItem(NAV_CHANNEL_KEY);
    }
  } catch (e) {
    console.warn('Could not read navigation fallback:', e);
  }
  return null;
}

function clearNavFallback() {
  try {
    sessionStorage.removeItem(NAV_CHANNEL_KEY);
  } catch (e) {}
}

function initChannelPage() {
  injectChannelStyles(); 
  var urlParams = new URLSearchParams(window.location.search);
  var channelId = urlParams.get('id');
  
  if (!channelId) {
    var fallback = getNavFallback();
    if (fallback) {
      currentChannelData = {
        id: fallback.id,
        name: fallback.name,
        category: fallback.category,
        thumbnail: fallback.thumbnail,
        streamUrl: fallback.streamUrl,
        country: fallback.country,
        views: Math.floor(Math.random() * 100000) + 1000
      };
      renderPlayer(currentChannelData);
      renderChannelInfo(currentChannelData);
      setupShareButton(currentChannelData);
      document.title = currentChannelData.name + ' — Xstream';
      fetchChannelsForSuggestions(currentChannelData);
      clearNavFallback();
      return;
    }
    showErrorState(); 
    fetchFallbackSuggestions(); 
    return;
  }
  
  fetch('channels.json')
    .then(function(response) { if (!response.ok) throw new Error('Failed to load'); return response.json(); })
    .then(function(rawData) {
      allChannelsData = rawData.filter(function(ch) { return ch.streamUrl && ch.streamUrl.startsWith('http') && ch.category; })
        .map(function(ch) {
          var rawThumb = ch.logo || ''; 
          var cleanThumb = (rawThumb && rawThumb.startsWith('http')) ? rawThumb : '';
          var safeId = sanitizeChannelId(ch.id, ch.name, ch.country);
          return { 
            id: safeId, 
            name: ch.name || 'Unknown Channel', 
            category: ch.category.toLowerCase(), 
            thumbnail: cleanThumb, 
            streamUrl: ch.streamUrl, 
            country: (ch.country || 'INT').toUpperCase(), 
            views: Math.floor(Math.random() * 100000) + 1000 
          };
        });
      
      var currentChannel = findChannelById(allChannelsData, channelId);
      
      if (!currentChannel) {
        var fallback = getNavFallback();
        if (fallback && fallback.streamUrl) {
          console.log('Channel not found in list, using navigation fallback');
          currentChannel = {
            id: fallback.id,
            name: fallback.name,
            category: fallback.category,
            thumbnail: fallback.thumbnail,
            streamUrl: fallback.streamUrl,
            country: fallback.country,
            views: Math.floor(Math.random() * 100000) + 1000
          };
          clearNavFallback();
        } else {
          clearNavFallback();
          showErrorState(); 
          renderSuggestions(null); 
          return;
        }
      } else {
        clearNavFallback();
      }
      
      currentChannelData = currentChannel; 
      renderPlayer(currentChannel);
      renderChannelInfo(currentChannel);
      setupShareButton(currentChannel); 
      renderSuggestions(currentChannel);
      document.title = currentChannel.name + ' — Xstream';
    })
    .catch(function(error) { 
      console.error('Error:', error); 
      
      var fallback = getNavFallback();
      if (fallback && fallback.streamUrl) {
        console.log('Using navigation fallback due to fetch error');
        currentChannelData = {
          id: fallback.id,
          name: fallback.name,
          category: fallback.category,
          thumbnail: fallback.thumbnail,
          streamUrl: fallback.streamUrl,
          country: fallback.country,
          views: Math.floor(Math.random() * 100000) + 1000
        };
        renderPlayer(currentChannelData);
        renderChannelInfo(currentChannelData);
        setupShareButton(currentChannelData);
        document.title = currentChannelData.name + ' — Xstream';
        clearNavFallback();
        return;
      }
      
      showErrorState(); 
      fetchFallbackSuggestions(); 
    });
}

function fetchChannelsForSuggestions(currentChannel) {
  fetch('channels.json')
    .then(function(r) { return r.json(); })
    .then(function(rawData) {
      allChannelsData = rawData.filter(function(ch) { return ch.streamUrl && ch.streamUrl.startsWith('http') && ch.category; })
        .map(function(ch) {
          var rawThumb = ch.logo || ''; 
          var cleanThumb = (rawThumb && rawThumb.startsWith('http')) ? rawThumb : '';
          var safeId = sanitizeChannelId(ch.id, ch.name, ch.country);
          return { 
            id: safeId, 
            name: ch.name || 'Unknown Channel', 
            category: ch.category.toLowerCase(), 
            thumbnail: cleanThumb, 
            streamUrl: ch.streamUrl, 
            country: (ch.country || 'INT').toUpperCase(), 
            views: Math.floor(Math.random() * 100000) + 1000 
          };
        });
      renderSuggestions(currentChannel);
    })
    .catch(function(e) {
      renderSuggestions(currentChannel);
    });
}

function fetchFallbackSuggestions() {
  fetch('channels.json').then(function(r) { return r.json(); }).then(function(rawData) {
    allChannelsData = rawData.filter(function(ch) { return ch.streamUrl && ch.streamUrl.startsWith('http') && ch.category; })
    .map(function(ch) {
      var rawThumb = ch.logo || ''; var cleanThumb = (rawThumb && rawThumb.startsWith('http')) ? rawThumb : '';
      var safeId = sanitizeChannelId(ch.id, ch.name, ch.country);
      return { id: safeId, name: ch.name || 'Unknown Channel', category: ch.category.toLowerCase(), thumbnail: cleanThumb, streamUrl: ch.streamUrl, country: (ch.country || 'INT').toUpperCase(), views: Math.floor(Math.random() * 100000) + 1000 };
    }); renderSuggestions(null);
  }).catch(function(e) {});
}

function renderPlayer(channel) {
  var wrapper = document.getElementById('video-player-wrapper'); if (!wrapper) return;
  wrapper.innerHTML = '<div style="position: relative; width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 12px; overflow: hidden;"><video id="live-video-player" controls playsinline style="width:100%; height:100%; object-fit:contain; background:#000;"></video></div>';
  var videoContainer = wrapper.firstChild; var video = document.getElementById('live-video-player');
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  if (Hls.isSupported()) {
    hlsInstance = new Hls(PremiumHlsConfig); hlsInstance.loadSource(channel.streamUrl); hlsInstance.attachMedia(video);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, function() { attemptPlay(video, videoContainer); });
    hlsInstance.on(Hls.Events.ERROR, function(event, data) { 
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { 
          hlsInstance.startLoad(); 
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hlsInstance.recoverMediaError();
        } else {
          console.error('Fatal HLS error:', data);
          showStreamError(videoContainer, 'Stream unavailable. Try another channel.');
        }
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) { 
    video.src = channel.streamUrl; 
    video.addEventListener('loadedmetadata', function() { attemptPlay(video, videoContainer); }, { once: true });
    video.addEventListener('error', function() { showStreamError(videoContainer, 'Stream unavailable. Try another channel.'); }, { once: true });
  }
  else { video.src = channel.streamUrl; attemptPlay(video, videoContainer); }
}

function showStreamError(container, message) {
  var errorOverlay = document.createElement('div');
  errorOverlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); display:flex; align-items:center; justify-content:center; z-index:10; border-radius: 12px;';
  errorOverlay.innerHTML = '<div style="text-align:center; color:white; font-family: Poppins, sans-serif;"><svg viewBox="0 0 24 24" fill="none" stroke="#ff4757" stroke-width="2" width="50" height="50" style="margin-bottom: 15px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><p style="font-size: 1rem; font-weight: 500;">' + escapeHTML(message) + '</p></div>';
  container.appendChild(errorOverlay);
}

function attemptPlay(video, container) {
  var playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch(function() {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:10; border-radius: 12px;';
      overlay.innerHTML = '<div style="text-align:center; color:white; font-family: Poppins, sans-serif;"><div style="width:80px; height:80px; background:rgba(255,255,255,0.1); border: 2px solid rgba(255,255,255,0.5); border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px;"><svg viewBox="0 0 24 24" fill="white" width="40" height="40" style="margin-left: 5px;"><polygon points="6,3 20,12 6,21"/></svg></div><p style="font-size: 1.1rem; font-weight: 600;">Click to Play Stream</p></div>';
      container.appendChild(overlay);
      overlay.addEventListener('click', function() { video.play(); overlay.style.opacity = '0'; overlay.style.transition = 'opacity 0.3s'; setTimeout(function() { overlay.remove(); }, 300); triggerLandscapeView(video, container); }, { once: true });
    });
  }
}

function triggerLandscapeView(video, container) {
  if (container.requestFullscreen) { container.requestFullscreen().then(function() { lockOrientation(); }).catch(function(err) { if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); }); } 
  else if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); }
}

function lockOrientation() {
  if (screen.orientation && screen.orientation.lock) { screen.orientation.lock('landscape').catch(function(e) {}); }
}

function renderChannelInfo(channel) {
  var infoContainer = document.getElementById('video-info'); if (infoContainer) infoContainer.style.display = 'block';
  var titleEl = document.getElementById('video-title'); if (titleEl) titleEl.textContent = channel.name;
  var viewsEl = document.getElementById('video-views'); if (viewsEl) viewsEl.querySelector('span').textContent = formatNumber(channel.views) + ' viewers';
  var countryEl = document.getElementById('video-country-badge'); if (countryEl) countryEl.querySelector('span').textContent = channel.country;
  
  var categoryEl = document.getElementById('video-category-badge');
  if (categoryEl) {
    var catSpan = categoryEl.querySelector('span');
    if (catSpan) catSpan.textContent = channel.category.charAt(0).toUpperCase() + channel.category.slice(1);
  }
}

function setupShareButton(channel) {
  var shareBtn = document.getElementById('share-btn');
  if (!shareBtn) return;

  shareBtn.addEventListener('click', function() {
    var channelUrl = window.location.origin + window.location.pathname + '?id=' + encodeURIComponent(channel.id);
    var shareText = 'Watch ' + channel.name + ' (' + channel.category.charAt(0).toUpperCase() + channel.category.slice(1) + ') live on Xstream!\n\nLink: ' + channelUrl;
    
    if (navigator.share) {
      navigator.share({
        title: channel.name + ' — Xstream',
        text: shareText,
        url: channelUrl
      }).catch(function(err) {
        console.log('Share cancelled or failed:', err);
      });
    } 
    else {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(shareText).then(function() {
          triggerToast('Share link copied to clipboard!');
        }).catch(function() {
          triggerToast('Could not copy link.');
        });
      } else {
        triggerToast('Your browser does not support sharing.');
      }
    }
  });
}

function triggerToast(message) {
  if (typeof showToast === 'function') { showToast(message); return; }
  var container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 10000;';
    document.body.appendChild(container);
  }
  var toast = document.createElement('div');
  toast.style.cssText = 'background: #333; color: #fff; padding: 12px 20px; border-radius: 8px; margin-bottom: 10px; font-size: 0.9rem; box-shadow: 0 4px 10px rgba(0,0,0,0.3); animation: fadeIn 0.3s;';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function() { toast.remove(); }, 300); }, 3000);
}

function startSidebarPreview(videoEl, streamUrl) {
  stopSidebarPreview(); sidebarPreviewVideo = videoEl;
  if (Hls.isSupported()) { sidebarHlsInstance = new Hls(SidebarHlsConfig); sidebarHlsInstance.loadSource(streamUrl); sidebarHlsInstance.attachMedia(videoEl); sidebarHlsInstance.on(Hls.Events.MANIFEST_PARSED, function() { videoEl.play().catch(e => {}); }); } 
  else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) { videoEl.src = streamUrl; videoEl.play().catch(e => {}); }
}

function stopSidebarPreview() {
  if (sidebarHlsInstance) { sidebarHlsInstance.destroy(); sidebarHlsInstance = null; }
  if (sidebarPreviewVideo) { sidebarPreviewVideo.pause(); sidebarPreviewVideo.removeAttribute('src'); sidebarPreviewVideo.load(); sidebarPreviewVideo = null; }
}

function navigateToChannel(channel) {
  try {
    sessionStorage.setItem(NAV_CHANNEL_KEY, JSON.stringify({
      id: channel.id,
      name: channel.name,
      category: channel.category,
      thumbnail: channel.thumbnail,
      streamUrl: channel.streamUrl,
      country: channel.country,
      timestamp: Date.now()
    }));
  } catch (e) {}
  
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  stopSidebarPreview();
  
  window.location.href = 'channel.html?id=' + encodeURIComponent(channel.id);
}

function renderSuggestions(currentChannel) {
  var container = document.getElementById('related-videos'); if (!container) return; container.innerHTML = '';
  var suggested = currentChannel ? allChannelsData.filter(function(ch) { return String(ch.id) !== String(currentChannel.id); }).slice(0, 8) : allChannelsData.slice(0, 8);
  if (suggested.length === 0) { container.innerHTML = '<p style="color: var(--text-secondary); padding: 10px;">No other channels available.</p>'; return; }
  
  suggested.forEach(function(ch) {
    var item = document.createElement('div'); 
    item.className = 'widget-video-item'; 
    item.style.cursor = 'pointer';
    item.setAttribute('tabindex', '0');
    item.setAttribute('role', 'link');
    item.setAttribute('aria-label', 'Watch ' + ch.name);
    
    var hasLogo = !!ch.thumbnail; 
    var thumbContent = hasLogo ? '<img src="' + ch.thumbnail + '" alt="' + escapeHTML(ch.name) + '" loading="lazy" onerror="this.onerror=null; this.style.display=\'none\';">' : '<video class="sidebar-preview-video" muted loop playsinline preload="none"></video>';
    var liveBadge = '<span class="live-indicator-dot" style="position: absolute; top: 5px; left: 5px; z-index: 5; font-size: 0.6rem;">LIVE</span>';
    var playOverlay = '<div class="video-card-overlay" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index:4; display:flex; align-items:center; justify-content:center;"><div class="play-btn-overlay"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div></div>';
    item.innerHTML = '<div class="widget-video-thumb">' + thumbContent + liveBadge + playOverlay + '</div><div class="widget-video-info"><h4>' + escapeHTML(ch.name) + '</h4><span>' + escapeHTML(ch.country || '') + ' • ' + ch.category + '</span></div>';
    
    if (!hasLogo) { 
      var vidEl = item.querySelector('.sidebar-preview-video'); 
      item.addEventListener('mouseenter', function() { startSidebarPreview(vidEl, ch.streamUrl); }); 
      item.addEventListener('mouseleave', function() { stopSidebarPreview(); }); 
    }
    
    item.addEventListener('click', function(e) {
      e.preventDefault();
      navigateToChannel(ch);
    });
    item.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigateToChannel(ch);
      }
    });
    
    container.appendChild(item);
  });
}

function showErrorState() {
  var wrapper = document.getElementById('video-player-wrapper'); if (wrapper) wrapper.innerHTML = ''; 
  var notFound = document.getElementById('video-not-found'); if (notFound) notFound.style.display = 'block';
}