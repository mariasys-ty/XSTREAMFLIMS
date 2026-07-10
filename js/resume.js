/**
 * resume.js
 * Handles the "Resume Watching" dialog and logic.
 * Supports Firebase, localStorage, offline videos, and Translated movies.
 */
(function() {
 'use strict';
 
 var MIN_RESUME_TIME = 30; // Don't show dialog if less than 30 seconds
 var _isDialogOpen = false;
 var _currentVideoData = null;
 
 // Inject CSS once
 if (!document.getElementById('resume-dialog-styles')) {
  var style = document.createElement('style');
  style.id = 'resume-dialog-styles';
  style.textContent = [
   '.resume-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 99999; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s ease; pointer-events: none; }',
   '.resume-overlay.active { opacity: 1; pointer-events: auto; }',
   '.resume-card { background: #181818; border-radius: 8px; width: 90%; max-width: 400px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.6); transform: scale(0.9); transition: transform 0.3s ease; }',
   '.resume-overlay.active .resume-card { transform: scale(1); }',
   '.resume-thumb { width: 100%; height: 200px; object-fit: cover; display: block; }',
   '.resume-info { padding: 20px; }',
   '.resume-title { color: #fff; font-size: 18px; font-weight: bold; margin: 0 0 5px 0; }',
   '.resume-time { color: #aaa; font-size: 14px; margin: 0 0 20px 0; }',
   '.resume-buttons { display: flex; gap: 10px; }',
   '.resume-btn { flex: 1; padding: 10px; border-radius: 4px; border: none; font-size: 15px; font-weight: bold; cursor: pointer; transition: background 0.2s; }',
   '.resume-btn-primary { background: #fff; color: #000; }',
   '.resume-btn-primary:hover { background: #e0e0e0; }',
   '.resume-btn-secondary { background: rgba(255,255,255,0.1); color: #fff; }',
   '.resume-btn-secondary:hover { background: rgba(255,255,255,0.2); }'
  ].join('\n');
  document.head.appendChild(style);
 }
 
 /**
  * Format seconds into M:SS
  */
 function _formatTime(sec) {
  if (isNaN(sec) || sec < 0) sec = 0;
  var m = Math.floor(sec / 60);
  var s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
 }
 
 /**
  * Check if we should show the resume dialog
  */
 window.checkResume = function(videoId) {
  return window.loadContinueWatching().then(function(data) {
   var progressData = data[videoId];
   
   // Handle corrupted/missing data safely
   if (!progressData || typeof progressData.currentTime !== 'number') {
    return false;
   }
   
   // If under 30 seconds or over 95%, do not show
   if (progressData.currentTime < MIN_RESUME_TIME) {
    window.removeContinueWatching(videoId);
    return false;
   }
   if (progressData.progress >= 95) {
    window.removeContinueWatching(videoId);
    return false;
   }
   
   _currentVideoData = progressData;
   return true;
  }).catch(function() {
   return false;
  });
 };
 
 /**
  * Show the Netflix-style Resume Dialog
  */
 window.showResumeDialog = function() {
  if (_isDialogOpen || !_currentVideoData) return;
  _isDialogOpen = true;
  
  var data = _currentVideoData;
  var thumbSrc = data.thumbnail || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  
  var overlay = document.createElement('div');
  overlay.className = 'resume-overlay';
  overlay.id = 'resume-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  
  overlay.innerHTML =
   '<div class="resume-card">' +
   '<img class="resume-thumb" src="' + thumbSrc + '" alt="Thumbnail" onerror="this.style.display=\'none\'">' +
   '<div class="resume-info">' +
   '<h2 class="resume-title">Resume "' + (data.title || 'Untitled') + '"</h2>' +
   '<p class="resume-time">Continue from ' + _formatTime(data.currentTime) + '?</p>' +
   '<div class="resume-buttons">' +
   '<button class="resume-btn resume-btn-primary" id="resume-yes-btn">Resume</button>' +
   '<button class="resume-btn resume-btn-secondary" id="resume-no-btn">Start Over</button>' +
   '</div>' +
   '</div>' +
   '</div>';
  
  document.body.appendChild(overlay);
  
  // Force reflow for CSS transition
  overlay.offsetHeight;
  overlay.classList.add('active');
  
  // Event Listeners
  document.getElementById('resume-yes-btn').addEventListener('click', function() {
   var video = document.querySelector('#video-player-wrapper video');
   if (video) window.resumePlayback(video, data.currentTime);
   window.hideResumeDialog();
  });
  
  document.getElementById('resume-no-btn').addEventListener('click', function() {
   var video = document.querySelector('#video-player-wrapper video');
   var videoId = new URLSearchParams(window.location.search).get('id');
   if (video) window.restartPlayback(video, videoId);
   window.hideResumeDialog();
  });
  
  // Keyboard Accessibility
  overlay._keyHandler = function(e) {
   if (e.key === 'Escape') {
    // Treat ESC as Start Over so the video doesn't just sit there hidden
    var video = document.querySelector('#video-player-wrapper video');
    var videoId = new URLSearchParams(window.location.search).get('id');
    if (video) window.restartPlayback(video, videoId);
    window.hideResumeDialog();
   }
  };
  document.addEventListener('keydown', overlay._keyHandler);
 };
 
 /**
  * Hide and destroy the dialog
  */
 window.hideResumeDialog = function() {
  var overlay = document.getElementById('resume-overlay');
  if (!overlay) return;
  
  overlay.classList.remove('active');
  
  // Remove event listener
  if (overlay._keyHandler) {
   document.removeEventListener('keydown', overlay._keyHandler);
  }
  
  // Remove from DOM after animation
  setTimeout(function() {
   if (overlay && overlay.parentNode) {
    overlay.parentNode.removeChild(overlay);
   }
   _isDialogOpen = false;
  }, 300);
 };
 
 /**
  * Resume playback from specific time
  */
 window.resumePlayback = function(videoElement, savedTime) {
  if (!videoElement || isNaN(savedTime)) return;
  
  function applyTime() {
   videoElement.currentTime = savedTime;
   videoElement.play().catch(function(e) {
    console.log('Auto-play prevented:', e);
   });
  }
  
  // Wait for metadata to load before setting time
  if (videoElement.readyState >= 1) { // HAVE_METADATA
   applyTime();
  } else {
   videoElement.addEventListener('loadedmetadata', applyTime, { once: true });
  }
 };
 
 /**
  * Restart playback from 0
  */
 window.restartPlayback = function(videoElement, videoId) {
  if (videoId) {
   window.removeContinueWatching(videoId);
  }
  if (!videoElement) return;
  
  function applyStart() {
   videoElement.currentTime = 0;
   videoElement.play().catch(function(e) {
    console.log('Auto-play prevented:', e);
   });
  }
  
  if (videoElement.readyState >= 1) {
   applyStart();
  } else {
   videoElement.addEventListener('loadedmetadata', applyStart, { once: true });
  }
 };
 
})();