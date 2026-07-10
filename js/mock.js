/**
 * mock.js — Skeleton Loading Placeholders for Movie Streaming
 *
 * Renders shimmer placeholder cards, hero banners, category pills,
 * and section loaders while real API data is being fetched.
 *
 * Usage:
 *   MockLoader.showAllMocks({ minimumTime: 1200 });
 *   // ... fetch from TMDB / Firebase ...
 *   await MockLoader.hideAllMocks();
 *   renderMovies(data);
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════════
     INTERNAL STATE
     ═══════════════════════════════════════════════════════════════ */

  let _cssInjected  = false;   // Ensures stylesheet is added only once
  let _showTimestamp = 0;      // When showAllMocks was last called
  let _minimumTime   = 0;      // Optional minimum display duration (ms)
  let _isHiding      = false;  // Prevents concurrent hide operations
  let _hidePromise   = null;   // Resolves when current hide finishes

  /* ═══════════════════════════════════════════════════════════════
     CONSTANTS
     ═══════════════════════════════════════════════════════════════ */

  const ATTR         = 'data-mock-placeholder';   // Marks every mock node
  const SECTION_ATTR = 'data-mock-section';       // Marks section containers
  const FADE_MS      = 350;                       // Fade-out duration (matches CSS)

  /* ═══════════════════════════════════════════════════════════════
     1. CSS INJECTION  — runs exactly once
     ═══════════════════════════════════════════════════════════════ */

  function injectCSS() {
    if (_cssInjected) return;
    _cssInjected = true;

    const style = document.createElement('style');
    style.id = 'mock-loader-styles';
    style.textContent = `

      /* ── Shimmer keyframes ─────────────────────────────────── */
      @keyframes mock-shimmer {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      /* ── Base shimmer element ──────────────────────────────── */
      .mock-shimmer {
        background: linear-gradient(90deg, #222 25%, #333 50%, #222 75%);
        background-size: 200% 100%;
        animation: mock-shimmer 1.3s ease-in-out infinite;
        border-radius: 4px;
        color: transparent !important;
        user-select: none;
        pointer-events: none;
      }

      /* ── Fade transition (applied to every mock node) ──────── */
      [${ATTR}] {
        transition: opacity ${FADE_MS}ms ease;
      }
      [${ATTR}].mock-fade-out {
        opacity: 0 !important;
      }

      /* ── Hero skeleton ─────────────────────────────────────── */
      .mock-hero {
        width: 100%;
        min-height: 480px;
        position: relative;
        overflow: hidden;
        border-radius: 12px;
        background: #1a1a1a;
      }
      .mock-hero-bg {
        position: absolute;
        inset: 0;
        border-radius: 12px;
      }
      .mock-hero-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          to right,
          rgba(0,0,0,0.85) 0%,
          rgba(0,0,0,0.50) 50%,
          rgba(0,0,0,0.15) 100%
        );
        border-radius: 12px;
      }
      .mock-hero-overlay-bottom {
        position: absolute;
        bottom: 0; left: 0; right: 0;
        height: 160px;
        background: linear-gradient(to top, rgba(0,0,0,0.9), transparent);
        border-radius: 0 0 12px 12px;
      }
      .mock-hero-content {
        position: absolute;
        bottom: 90px;
        left: 48px;
        max-width: 520px;
        z-index: 2;
      }
      .mock-hero-title {
        height: 46px;
        width: 72%;
        margin-bottom: 18px;
        border-radius: 6px;
      }
      .mock-hero-line {
        height: 13px;
        margin-bottom: 10px;
        border-radius: 3px;
      }
      .mock-hero-meta {
        display: flex;
        gap: 14px;
        align-items: center;
        margin: 22px 0;
      }
      .mock-hero-meta-item {
        height: 15px;
        border-radius: 3px;
      }
      .mock-hero-buttons {
        display: flex;
        gap: 14px;
        margin-top: 6px;
      }
      .mock-hero-btn {
        height: 46px;
        border-radius: 8px;
      }
      .mock-hero-bottom {
        position: absolute;
        bottom: 24px;
        left: 48px;
        right: 48px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        z-index: 2;
      }
      .mock-hero-info-panel {
        display: flex;
        gap: 16px;
      }
      .mock-hero-info-item {
        height: 14px;
        width: 80px;
        border-radius: 3px;
      }
      .mock-hero-dots {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .mock-hero-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      .mock-hero-dot-active {
        width: 28px;
        border-radius: 5px;
      }

      /* ── Movie card skeleton ───────────────────────────────── */
      .mock-card {
        flex-shrink: 0;
      }
      .mock-card-poster-wrap {
        position: relative;
        width: 100%;
        aspect-ratio: 2 / 3;
        border-radius: 10px;
        overflow: hidden;
        margin-bottom: 12px;
      }
      .mock-card-poster {
        position: absolute;
        inset: 0;
        border-radius: 10px;
      }
      .mock-card-rating {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 44px;
        height: 24px;
        border-radius: 6px;
        overflow: hidden;
        z-index: 1;
      }
      .mock-card-rating > .mock-shimmer {
        border-radius: 6px;
        width: 100%;
        height: 100%;
      }
      .mock-card-info {
        padding: 0 2px;
      }
      .mock-card-title {
        height: 16px;
        width: 85%;
        margin-bottom: 7px;
        border-radius: 3px;
      }
      .mock-card-genre {
        height: 12px;
        width: 55%;
        margin-bottom: 10px;
        border-radius: 3px;
      }
      .mock-card-badges {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 10px;
      }
      .mock-card-badge {
        height: 22px;
        border-radius: 5px;
      }
      .mock-card-tags {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .mock-card-tag {
        height: 22px;
        border-radius: 12px;
      }

      /* ── Category pills skeleton ───────────────────────────── */
      .mock-categories {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        padding: 4px 0;
      }
      .mock-category-pill {
        height: 38px;
        border-radius: 19px;
      }

      /* ── Generic section loading bars ──────────────────────── */
      .mock-section-bars {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .mock-section-bar {
        flex: 1;
        min-width: 140px;
        height: 200px;
        border-radius: 10px;
      }

      /* ── Responsive: tablet ────────────────────────────────── */
      @media (max-width: 768px) {
        .mock-hero {
          min-height: 360px;
          border-radius: 8px;
        }
        .mock-hero-bg,
        .mock-hero-overlay,
        .mock-hero-overlay-bottom {
          border-radius: 8px;
        }
        .mock-hero-content {
          left: 20px;
          bottom: 70px;
          max-width: 85%;
        }
        .mock-hero-title {
          height: 34px;
          width: 80%;
        }
        .mock-hero-bottom {
          left: 20px;
          right: 20px;
          bottom: 16px;
        }
        .mock-hero-info-panel { display: none; }
        .mock-hero-btn { height: 40px; }
      }

      /* ── Responsive: mobile ────────────────────────────────── */
      @media (max-width: 480px) {
        .mock-hero {
          min-height: 300px;
          border-radius: 6px;
        }
        .mock-hero-bg,
        .mock-hero-overlay,
        .mock-hero-overlay-bottom {
          border-radius: 6px;
        }
        .mock-hero-content {
          left: 16px;
          bottom: 58px;
        }
        .mock-hero-line { height: 11px; }
        .mock-hero-buttons {
          flex-direction: column;
          gap: 8px;
        }
        .mock-hero-btn { width: 100% !important; }
        .mock-hero-bottom {
          left: 16px;
          right: 16px;
          bottom: 12px;
        }
      }

      /* ── Accessibility: reduced motion ─────────────────────── */
      @media (prefers-reduced-motion: reduce) {
        .mock-shimmer {
          animation: none;
          background: #2a2a2a;
        }
        [${ATTR}] { transition: none; }
      }
    `;

    document.head.appendChild(style);
  }

  /* ═══════════════════════════════════════════════════════════════
     2. DOM HELPERS
     ═══════════════════════════════════════════════════════════════ */

  /** Create an element with optional className and inline styles */
  function createEl(tag, className, styles) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (styles) Object.assign(node.style, styles);
    return node;
  }

  /** Create a shimmer div with optional extra class and inline styles */
  function shimmer(className, styles) {
    return createEl(
      'div',
      'mock-shimmer' + (className ? ' ' + className : ''),
      styles
    );
  }

  /** Mark a node as a mock placeholder */
  function markMock(node) {
    node.setAttribute(ATTR, '');
    return node;
  }

  /** Resolve a container: use the provided element, or find by data attribute */
  function resolveContainer(provided, sectionName) {
    if (provided && provided.nodeType === 1) return provided;
    if (sectionName) return document.querySelector(`[${SECTION_ATTR}="${sectionName}"]`);
    return null;
  }

  /** Get all mock nodes inside a container */
  function getMocksIn(container) {
    if (!container) return [];
    return container.querySelectorAll(`[${ATTR}]`);
  }

  /* ═══════════════════════════════════════════════════════════════
     3. BUILDERS — each returns a single DOM node
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Hero placeholder: full-width banner with gradient overlays,
   * title, description lines, metadata, buttons, info panel, and dots.
   */
  function buildHero() {
    const hero = markMock(createEl('div', 'mock-hero'));

    // Layer 1: shimmer background
    hero.appendChild(shimmer('mock-hero-bg'));

    // Layer 2: gradient overlays (simulate image + bottom fade)
    hero.appendChild(createEl('div', 'mock-hero-overlay'));
    hero.appendChild(createEl('div', 'mock-hero-overlay-bottom'));

    // Layer 3: text content
    const content = createEl('div', 'mock-hero-content');

    content.appendChild(shimmer('mock-hero-title'));
    content.appendChild(shimmer('mock-hero-line', { width: '92%' }));
    content.appendChild(shimmer('mock-hero-line', { width: '76%' }));
    content.appendChild(shimmer('mock-hero-line', { width: '52%' }));

    // Metadata row (year, duration, rating, language)
    const meta = createEl('div', 'mock-hero-meta');
    meta.appendChild(shimmer('mock-hero-meta-item', { width: '55px' }));
    meta.appendChild(shimmer('mock-hero-meta-item', { width: '42px' }));
    meta.appendChild(shimmer('mock-hero-meta-item', { width: '68px' }));
    meta.appendChild(shimmer('mock-hero-meta-item', { width: '78px' }));
    content.appendChild(meta);

    // Action buttons
    const buttons = createEl('div', 'mock-hero-buttons');
    buttons.appendChild(shimmer('mock-hero-btn', { width: '152px' }));
    buttons.appendChild(shimmer('mock-hero-btn', { width: '124px' }));
    content.appendChild(buttons);

    hero.appendChild(content);

    // Layer 4: bottom bar — info panel + slider dots
    const bottom = createEl('div', 'mock-hero-bottom');

    const infoPanel = createEl('div', 'mock-hero-info-panel');
    infoPanel.appendChild(shimmer('mock-hero-info-item', { width: '92px' }));
    infoPanel.appendChild(shimmer('mock-hero-info-item', { width: '72px' }));
    infoPanel.appendChild(shimmer('mock-hero-info-item', { width: '104px' }));
    bottom.appendChild(infoPanel);

    const dots = createEl('div', 'mock-hero-dots');
    dots.appendChild(shimmer('mock-hero-dot mock-hero-dot-active'));  // active dot
    dots.appendChild(shimmer('mock-hero-dot'));
    dots.appendChild(shimmer('mock-hero-dot'));
    dots.appendChild(shimmer('mock-hero-dot'));
    dots.appendChild(shimmer('mock-hero-dot'));
    bottom.appendChild(dots);

    hero.appendChild(bottom);
    return hero;
  }

  /**
   * Movie card placeholder: poster, rating badge, title, genre,
   * year/duration/translated badges, and bottom tags.
   */
  function buildMovieCard() {
    const card = markMock(createEl('div', 'mock-card'));

    // Poster area
    const posterWrap = createEl('div', 'mock-card-poster-wrap');
    posterWrap.appendChild(shimmer('mock-card-poster'));

    // Rating badge (top-right corner of poster)
    const ratingWrap = createEl('div', 'mock-card-rating');
    ratingWrap.appendChild(shimmer());
    posterWrap.appendChild(ratingWrap);

    card.appendChild(posterWrap);

    // Text info below poster
    const info = createEl('div', 'mock-card-info');

    info.appendChild(shimmer('mock-card-title'));
    info.appendChild(shimmer('mock-card-genre'));

    // Badges row: year, duration, translated indicator
    const badges = createEl('div', 'mock-card-badges');
    badges.appendChild(shimmer('mock-card-badge', { width: '38px' }));   // year
    badges.appendChild(shimmer('mock-card-badge', { width: '54px' }));   // duration
    badges.appendChild(shimmer('mock-card-badge', { width: '40px' }));   // sub/dub
    info.appendChild(badges);

    // Bottom tags
    const tags = createEl('div', 'mock-card-tags');
    tags.appendChild(shimmer('mock-card-tag', { width: '60px' }));
    tags.appendChild(shimmer('mock-card-tag', { width: '50px' }));
    info.appendChild(tags);

    card.appendChild(info);
    return card;
  }

  /**
   * Category pills: a flex row of rounded shimmer pills with
   * varying widths for visual realism.
   */
  function buildCategoryPills(count) {
    const wrapper = markMock(createEl('div', 'mock-categories'));

    // Predefined widths that mimic real genre name lengths
    const widths = [82, 96, 70, 112, 86, 102, 74, 92, 66, 108, 88, 76, 100, 80, 116];

    for (let i = 0; i < count; i++) {
      const w = widths[i % widths.length];
      wrapper.appendChild(shimmer('mock-category-pill', { width: w + 'px' }));
    }

    return wrapper;
  }

  /**
   * Generic section loading: several tall shimmer bars.
   */
  function buildSectionBars(count) {
    const wrapper = markMock(createEl('div', 'mock-section-bars'));

    for (let i = 0; i < count; i++) {
      wrapper.appendChild(shimmer('mock-section-bar'));
    }

    return wrapper;
  }

  /* ═══════════════════════════════════════════════════════════════
     4. FADE-OUT & REMOVAL UTILITY
     ═══════════════════════════════════════════════════════════════ */

  /**
   * Adds the fade-out class to each element, waits for the CSS
   * transition to finish, then removes every node from the DOM.
   * Returns a Promise that resolves when cleanup is complete.
   */
  function fadeOutAndRemove(nodeList) {
    return new Promise(function (resolve) {
      if (!nodeList || nodeList.length === 0) {
        resolve();
        return;
      }

      var nodes = Array.prototype.slice.call(nodeList);

      // Kick off the CSS fade
      nodes.forEach(function (n) { n.classList.add('mock-fade-out'); });

      // After the transition finishes, detach from DOM
      setTimeout(function () {
        nodes.forEach(function (n) {
          if (n.parentNode) n.parentNode.removeChild(n);
        });
        nodes = null; // release reference
        resolve();
      }, FADE_MS + 30); // small buffer for rendering jitter
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     5. PUBLIC API
     ═══════════════════════════════════════════════════════════════ */

  /**
   * showHeroMock([container])
   * Renders a hero skeleton inside the given container, or inside
   * the element marked with data-mock-section="hero" if omitted.
   */
  function showHeroMock(container) {
    injectCSS();
    var target = resolveContainer(container, 'hero');
    if (!target) return;
    target.appendChild(buildHero());
  }

  /**
   * hideHeroMock([container]) → Promise
   * Fades out and removes the hero placeholder.
   */
  function hideHeroMock(container) {
    var target = resolveContainer(container, 'hero');
    if (!target) return Promise.resolve();
    return fadeOutAndRemove(getMocksIn(target));
  }

  /**
   * showMovieGridMock(container, count)
   * Renders `count` movie card skeletons into `container`
   * using a DocumentFragment for minimal reflow.
   */
  function showMovieGridMock(container, count) {
    if (!container || container.nodeType !== 1) return;
    injectCSS();

    count = Math.max(1, Math.min(count || 8, 60));

    var fragment = document.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      fragment.appendChild(buildMovieCard());
    }
    container.appendChild(fragment);
  }

  /**
   * hideMovieGridMock(container) → Promise
   * Fades out and removes all card skeletons inside `container`.
   */
  function hideMovieGridMock(container) {
    if (!container) return Promise.resolve();
    return fadeOutAndRemove(getMocksIn(container));
  }

  /**
   * showSectionLoading(section)
   * Inserts generic shimmer bars into any section element.
   */
  function showSectionLoading(section) {
    if (!section || section.nodeType !== 1) return;
    injectCSS();
    section.appendChild(buildSectionBars(6));
  }

  /**
   * hideSectionLoading(section) → Promise
   * Removes the shimmer bars from the section.
   */
  function hideSectionLoading(section) {
    if (!section) return Promise.resolve();
    return fadeOutAndRemove(getMocksIn(section));
  }

  /* ═══════════════════════════════════════════════════════════════
     6. SECTION BUILDER REGISTRY
     Maps section names → the function that populates them.
     Used by showAllMocks() for automatic rendering.
     ═══════════════════════════════════════════════════════════════ */

  var SECTION_BUILDERS = {
    'hero':               function (c) { c.appendChild(buildHero()); },
    'trending':           function (c) { showMovieGridMock(c, 8); },
    'popular':            function (c) { showMovieGridMock(c, 12); },
    'latest':             function (c) { showMovieGridMock(c, 8); },
    'latest-uploads':     function (c) { showMovieGridMock(c, 8); },
    'series':             function (c) { showMovieGridMock(c, 8); },
    'upcoming':           function (c) { showMovieGridMock(c, 6); },
    'search':             function (c) { showMovieGridMock(c, 12); },
    'continue-watching':  function (c) { showMovieGridMock(c, 6); },
    'recommended':        function (c) { showMovieGridMock(c, 8); },
    'categories':         function (c) { c.appendChild(buildCategoryPills(12)); },
  };

  /* ═══════════════════════════════════════════════════════════════
     7. showAllMocks / hideAllMocks
     ═══════════════════════════════════════════════════════════════ */

  /**
   * showAllMocks([options])
   *
   * Scans the page for every [data-mock-section] element and fills
   * it with the appropriate skeleton type. Accepts an optional
   * options object:
   *
   *   {
   *     minimumTime: 1200,        // keep placeholders visible at least this long
   *     containers: {             // override auto-detected containers
   *       hero:     myHeroEl,
   *       popular:  myPopularEl,
   *       ...
   *     }
   *   }
   */
  function showAllMocks(options) {
    options = options || {};
    injectCSS();

    _showTimestamp = Date.now();
    _minimumTime   = options.minimumTime || 0;

    var overrides = options.containers || {};

    // Find every section that wants a mock
    var sections = document.querySelectorAll('[' + SECTION_ATTR + ']');

    sections.forEach(function (section) {
      var type      = section.getAttribute(SECTION_ATTR);
      var container = overrides[type] || section;
      var builder   = SECTION_BUILDERS[type];

      if (builder) {
        builder(container);
      } else {
        // Unknown section type → generic bars
        showSectionLoading(container);
      }
    });
  }

  /**
   * hideAllMocks([callback]) → Promise
   *
   * Fades out every mock placeholder on the page, waits for the
   * minimum display time (if configured), then removes all mock
   * nodes from the DOM. Supports both callback and Promise styles:
   *
   *   // Promise
   *   await MockLoader.hideAllMocks();
   *
   *   // Callback
   *   MockLoader.hideAllMocks(function () { renderMovies(data); });
   *
   * If called while a hide is already in progress, the same
   * Promise is returned (no duplicate animations).
   */
  function hideAllMocks(callback) {
    // If a hide is already running, just piggyback on its promise
    if (_isHiding && _hidePromise) {
      if (callback) _hidePromise.then(callback);
      return _hidePromise;
    }

    _isHiding = true;

    _hidePromise = new Promise(function (resolve) {
      function done() {
        _isHiding    = false;
        _hidePromise = null;
        if (callback) callback();
        resolve();
      }

      var allMocks = document.querySelectorAll('[' + ATTR + ']');

      // Nothing to hide
      if (allMocks.length === 0) {
        done();
        return;
      }

      // Enforce minimum display time
      var elapsed   = Date.now() - _showTimestamp;
      var remaining = Math.max(0, _minimumTime - elapsed);

      function performHide() {
        fadeOutAndRemove(allMocks).then(done);
      }

      if (remaining > 0) {
        setTimeout(performHide, remaining);
      } else {
        performHide();
      }
    });

    return _hidePromise;
  }

  /* ═══════════════════════════════════════════════════════════════
     8. GLOBAL EXPORT
     ═══════════════════════════════════════════════════════════════ */

  window.MockLoader = {
    showHeroMock:       showHeroMock,
    hideHeroMock:       hideHeroMock,
    showMovieGridMock:  showMovieGridMock,
    hideMovieGridMock:  hideMovieGridMock,
    showSectionLoading: showSectionLoading,
    hideSectionLoading: hideSectionLoading,
    showAllMocks:       showAllMocks,
    hideAllMocks:       hideAllMocks,
  };

})();