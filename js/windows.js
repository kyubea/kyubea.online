// js/windows.js
(function () {
  // feature flag to toggle snap visuals (keep framework available, default hidden)
  const ENABLE_SNAP_VISUALS = false;
  const zBase = 1000;
  let zCounter = zBase;
  let creationIndex = 0;
  let windowIdCounter = 0;
  const STORAGE_KEY = 'chatspace.windows';

  // snapping overlay SVG id
  const SNAP_OVERLAY_ID = 'snap-overlay-svg';

  // simple slug helper for stable ids
  function slugify(s) {
    return (s || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'win';
  }

  // track shift key state globally so drag/resize can opt-out of snapping when held.
  let _shiftPressed = false;
  try {
    window.addEventListener('keydown', (ev) => { if (ev.key === 'Shift') _shiftPressed = true; });
    window.addEventListener('keyup', (ev) => { if (ev.key === 'Shift') _shiftPressed = false; });
    // clear on blur (e.g., if user switches apps while holding shift)
    window.addEventListener('blur', () => { _shiftPressed = false; });
  } catch (e) { /* ignore in restricted environments */ }

  function loadWindowStates() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.warn('Failed to load window states', e);
      return {};
    }
  }

  function saveWindowStates(states) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
    } catch (e) {
      console.warn('Failed to save window states', e);
    }
  }

  function getWindowState(winId) {
    const states = loadWindowStates();
    return states[winId] || null;
  }

  function setWindowState(winId, patch) {
    if (!winId) return;
    const states = loadWindowStates();
    const prev = states[winId] || {};
    states[winId] = Object.assign({}, prev, patch);
    saveWindowStates(states);
  }

  function deleteWindowStateKey(winId, key) {
    if (!winId) return;
    const states = loadWindowStates();
    if (!states[winId]) return;
    try {
      if (states[winId].hasOwnProperty(key)) delete states[winId][key];
      // if object becomes empty, keep it (other code expects an object), but save nonetheless
      saveWindowStates(states);
    } catch (e) { /* ignore */ }
  }

  function makeWindowElement(title, content) {
    const win = document.createElement('div');
    win.className = 'window';
    win.tabIndex = 0;
    win.innerHTML = `
      <div class="win-header">
        <div class="win-title">${title}</div>
        <div class="win-controls">
          <button class="win-btn btn-close" title="Close">✕</button>
        </div>
      </div>
      <div class="win-body">${content}</div>
    `;
    return win;
  }

  // --- Snap overlay helpers ---
  function ensureSnapOverlay() {
    let svg = document.getElementById(SNAP_OVERLAY_ID);
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('id', SNAP_OVERLAY_ID);
      svg.setAttribute('class', 'snap-overlay');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.position = 'fixed';
      svg.style.left = '0';
      svg.style.top = '0';
      svg.style.pointerEvents = 'none';
      svg.style.zIndex = 20000; // above windows while dragging
      document.body.appendChild(svg);
    }
    // keep viewport sized viewBox for simple coords
    try {
      svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    } catch (e) { /* ignore */ }
    return svg;
  }

  function clearSnapOverlay() {
    const svg = document.getElementById(SNAP_OVERLAY_ID);
    if (svg) svg.innerHTML = '';
  }

  function hideSnapOverlay() {
    const svg = document.getElementById(SNAP_OVERLAY_ID);
    if (svg) svg.style.display = 'none';
  }

  function showSnapOverlay() {
    if (!ENABLE_SNAP_VISUALS) return ensureSnapOverlay();
    const svg = ensureSnapOverlay();
    svg.style.display = 'block';
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    return svg;
  }

  function bringToFront(el) {
    zCounter++;
    el.style.zIndex = zCounter;
    document.querySelectorAll('.window').forEach(w => w.dataset.active = 'false');
    el.dataset.active = 'true';
  }

  function enableDrag(win, handle) {
    let startX, startY, origX, origY, dragging = false;
    let lastSavedAt = 0;

    // margin from edges
    const EDGE_MARGIN = 4; // px
    const SNAP_THRESHOLD = 24; // px

    function getBounds() {
      // viewport-aware bounds (page coordinates)
      const winW = win.offsetWidth;
      const winH = win.offsetHeight;
      const docWidth = document.documentElement.clientWidth;
      const docHeight = window.innerHeight;
      const scrollY = window.scrollY || window.pageYOffset || 0;

      // top boundary: don't go above the tab bar if present
      const tab = document.querySelector('.tab-bar');
      let minTop = EDGE_MARGIN + scrollY;
      if (tab) {
        const rect = tab.getBoundingClientRect();
        minTop = Math.max(minTop, rect.bottom + scrollY + 4); // 6px gap under tab bar
      }

      // if a dock bar is visible under the tab-bar, ensure windows can't be dragged
      const inlineDock = document.querySelector('.window-dock-bar.visible');
      if (inlineDock) {
        try {
          const rect = inlineDock.getBoundingClientRect();
          minTop = Math.max(minTop, rect.bottom + scrollY + 4);
        } catch (e) { /* ignore */ }
      } else {
        const globalDock = document.querySelector('.window-dock-bar.window-dock-global');
        if (globalDock && globalDock.style && globalDock.style.display !== 'none') {
          try {
            const rect = globalDock.getBoundingClientRect();
            // rect.top is the top of the global dock in viewport coords
            globalDock.__topPage = rect.top + scrollY;
          } catch (e) { /* ignore */ }
        }
      }

      const minLeft = EDGE_MARGIN;
      const maxLeft = Math.max(minLeft, docWidth - winW - EDGE_MARGIN);
      const maxTop = Math.max(minTop, scrollY + docHeight - winH - EDGE_MARGIN);
      // if a global dock is present, ensure the window bottom stays above the dock top
      const globalDock2 = document.querySelector('.window-dock-bar.window-dock-global');
      if (globalDock2 && globalDock2.style && globalDock2.style.display !== 'none' && globalDock2.__topPage) {
        const dockTopPage = globalDock2.__topPage;
        // maximum top so that top + winH <= dockTopPage - EDGE_MARGIN
        const maxTopDueToDock = dockTopPage - EDGE_MARGIN - winH;
        return { minLeft, minTop, maxLeft, maxTop: Math.max(minTop, Math.min(maxTop, maxTopDueToDock)) };
      }

      return { minLeft, minTop, maxLeft, maxTop };
    }

    const onPointerMove = (e) => {
      if (!dragging) return;
      // if shift is held, disable snapping visuals
      if (_shiftPressed || (e && e.shiftKey)) {
        try { hideSnapOverlay(); } catch (err) {}
      }
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - startX;
      const dy = clientY - startY;
      let newLeft = origX + dx;
      let newTop = origY + dy;

      // clamp to bounds
      const b = getBounds();
      newLeft = Math.max(b.minLeft, Math.min(b.maxLeft, newLeft));
      newTop = Math.max(b.minTop, Math.min(b.maxTop, newTop));

      win.style.left = newLeft + 'px';
      win.style.top = newTop + 'px';

      // throttled save of current position so changes persist even if the page
      try {
        const now = Date.now();
        if (now - lastSavedAt > 250) {
          lastSavedAt = now;
          try { setWindowState(win.dataset.winId, { left: parseInt(newLeft, 10), top: parseInt(newTop, 10) }); } catch (e) {}
        }
      } catch (e) { /* ignore persistence errors */ }

      if (ENABLE_SNAP_VISUALS) try {
        if (_shiftPressed || (e && e.shiftKey)) {
          // don't show visuals while shift is held
        } else {
          const svg = showSnapOverlay();
          svg.innerHTML = '';
          const SNAP_THRESHOLD = 24;
          const VISUAL_THRESHOLD = SNAP_THRESHOLD * 2.2;
          const PADDING = 4;
          const left = newLeft;
          const top = newTop;
          const winW = win.offsetWidth;
          const winH = win.offsetHeight;
          const others = Array.from(document.querySelectorAll('.window')).filter(w => w !== win && !w.classList.contains('closing') && !w.classList.contains('minimized'));
          const dCorners = [
            {x: left, y: top, name: 'tl'},
            {x: left + winW, y: top, name: 'tr'},
            {x: left, y: top + winH, name: 'bl'},
            {x: left + winW, y: top + winH, name: 'br'}
          ];
          others.forEach(o => {
            const oLeft = o.offsetLeft;
            const oTop = o.offsetTop;
            const oW = o.offsetWidth;
            const oH = o.offsetHeight;
            const oRight = oLeft + oW;
            const oBottom = oTop + oH;
            const corners = [
              {x: oLeft, y: oTop},
              {x: oRight, y: oTop},
              {x: oLeft, y: oBottom},
              {x: oRight, y: oBottom}
            ];
            corners.forEach(corner => {
              let best = {d: Infinity, dc: dCorners[0]};
              dCorners.forEach(dc => {
                const dx = dc.x - corner.x;
                const dy = dc.y - corner.y;
                const d = Math.sqrt(dx*dx + dy*dy);
                if (d < best.d) best = {d, dc};
              });
              const d = best.d;
              const baseOpacity = Math.max(0, Math.min(1, (VISUAL_THRESHOLD - d) / VISUAL_THRESHOLD));
              if (baseOpacity <= 0) return;
              const line = document.createElementNS('http://www.w3.org/2000/svg','line');
              line.setAttribute('x1', Math.round(best.dc.x));
              line.setAttribute('y1', Math.round(best.dc.y));
              line.setAttribute('x2', Math.round(corner.x));
              line.setAttribute('y2', Math.round(corner.y));
              line.setAttribute('class','snap-line');
              line.style.opacity = String(Math.max(0.08, baseOpacity));
              line.style.strokeWidth = '2';
              svg.appendChild(line);
            });
          });
        }
      } catch (err) { /* don't break dragging on overlay errors */ }
    };

    const onPointerUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onPointerMove);
      document.removeEventListener('mouseup', onPointerUp);
      document.removeEventListener('touchmove', onPointerMove);
      document.removeEventListener('touchend', onPointerUp);
      handle.style.cursor = 'grab';

  // ensure final position is saved
  try { setWindowState(win.dataset.winId, { left: parseInt(win.style.left||0,10), top: parseInt(win.style.top||0,10) }); } catch(e){}
  // remove unload listener added at drag start
  try { window.removeEventListener('beforeunload', saveOnUnload); } catch (e) {}
  // if shift is held, ignore snapping entirely and just persist current location
  if (_shiftPressed) {
    try { hideSnapOverlay(); } catch(e){}
    return;
  }

      // perform snapping to edges/corners and other windows if close enough
      const b = getBounds();
      const left = parseInt(win.style.left || 0, 10);
      const top = parseInt(win.style.top || 0, 10);
      const winW = win.offsetWidth;
      const winH = win.offsetHeight;

      // build snap candidates and pick the best one within snap_threshold;
      // prefer aligning edges (especially header/top alignment) over padding placements,
      // and only snap when within snap_threshold of a candidate; also include viewport edges
      let finalLeft = left;
      let finalTop = top;

      const horizCandidates = [];
      const vertCandidates = [];
      const PADDING = 4; // gap between windows

      // include viewport edge candidates (left/right)
      horizCandidates.push({x: b.minLeft, prio: 2});
      horizCandidates.push({x: b.maxLeft, prio: 2});
      // include viewport edge candidates (top/bottom)
      vertCandidates.push({y: b.minTop, prio: 2});
      vertCandidates.push({y: b.maxTop, prio: 2});

      const others = Array.from(document.querySelectorAll('.window')).filter(w => w !== win && !w.classList.contains('closing'));
      others.forEach(o => {
        const oLeft = o.offsetLeft;
        const oTop = o.offsetTop;
        const oW = o.offsetWidth;
        const oH = o.offsetHeight;
        const oRight = oLeft + oW;
        const oBottom = oTop + oH;

        // horizontal alignment candidates
        // align left edges
        horizCandidates.push({x: oLeft, prio: 0});
        // align right edges (so our right == their right)
        horizCandidates.push({x: oRight - winW, prio: 0});
        // place to the right with padding
        horizCandidates.push({x: oRight + PADDING, prio: 1});
        // place to the left with padding
        horizCandidates.push({x: oLeft - winW - PADDING, prio: 1});

        // vertical alignment candidates
        // align top edges (prefer header alignment)
        vertCandidates.push({y: oTop, prio: 0});
        // align bottom edges (so our bottom == their bottom)
        vertCandidates.push({y: oBottom - winH, prio: 0});
        // place below with padding
        vertCandidates.push({y: oBottom + PADDING, prio: 1});
        // place above with padding
        vertCandidates.push({y: oTop - winH - PADDING, prio: 1});
      });

      // choose best horizontal candidate
      let bestHoriz = {d: Infinity, prio: Infinity, x: left};
      horizCandidates.forEach(c => {
        const d = Math.abs(left - c.x);
        if (d <= SNAP_THRESHOLD) {
          if (d < bestHoriz.d || (d === bestHoriz.d && c.prio < bestHoriz.prio)) {
            bestHoriz = {d, prio: c.prio, x: c.x};
          }
        }
      });
      if (bestHoriz.d <= SNAP_THRESHOLD) finalLeft = bestHoriz.x;

      // choose best vertical candidate
      let bestVert = {d: Infinity, prio: Infinity, y: top};
      vertCandidates.forEach(c => {
        const d = Math.abs(top - c.y);
        if (d <= SNAP_THRESHOLD) {
          if (d < bestVert.d || (d === bestVert.d && c.prio < bestVert.prio)) {
            bestVert = {d, prio: c.prio, y: c.y};
          }
        }
      });
      if (bestVert.d <= SNAP_THRESHOLD) finalTop = bestVert.y;

  // hide overlay when finished
  try { hideSnapOverlay(); } catch(e) {}

      // clamp final positions to bounds
      finalLeft = Math.max(b.minLeft, Math.min(b.maxLeft, finalLeft));
      finalTop = Math.max(b.minTop, Math.min(b.maxTop, finalTop));

      // if a change will occur, animate to the snapped position briefly
      if (finalLeft !== left || finalTop !== top) {
        win.style.transition = 'left 150ms ease, top 150ms ease';
        // force reflow to ensure transition
        // eslint-disable-next-line no-unused-expressions
        win.offsetWidth;
        win.style.left = finalLeft + 'px';
        win.style.top = finalTop + 'px';
        const cleanup = () => {
          win.style.transition = '';
          win.removeEventListener('transitionend', cleanup);
          // persist final snapped position
          try { setWindowState(win.dataset.winId, { left: finalLeft, top: finalTop }); } catch(e){}
        };
        win.addEventListener('transitionend', cleanup);
      } else {
        // even if not snapped, persist current location
        try { setWindowState(win.dataset.winId, { left: finalLeft, top: finalTop }); } catch(e){}
      }
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      bringToFront(win);
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX = parseInt(win.style.left || 0, 10);
      origY = parseInt(win.style.top || 0, 10);
      document.addEventListener('mousemove', onPointerMove);
      document.addEventListener('mouseup', onPointerUp);
      handle.style.cursor = 'grabbing';
      // save on page unload while dragging so in-progress drag persists
      window.addEventListener('beforeunload', saveOnUnload);
    });

    handle.addEventListener('touchstart', (e) => {
      e.preventDefault();
      bringToFront(win);
      dragging = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      origX = parseInt(win.style.left || 0, 10);
      origY = parseInt(win.style.top || 0, 10);
      document.addEventListener('touchmove', onPointerMove, {passive:false});
      document.addEventListener('touchend', onPointerUp);
      window.addEventListener('beforeunload', saveOnUnload);
    });

    function saveOnUnload() {
      try { setWindowState(win.dataset.winId, { left: parseInt(win.style.left||0,10), top: parseInt(win.style.top||0,10) }); } catch(e){}
    }
  }

  // --- resize helpers ---
  function enableResize(win, opts = {}) {
  // create a visible resize handle in the bottom-right corner
  const resizer = document.createElement('div');
  resizer.className = 'win-resizer';
  win.appendChild(resizer);
  // create a small indicator that shows current size while resizing
  const indicator = document.createElement('div');
  indicator.className = 'win-resizer-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.textContent = '';
  win.appendChild(indicator);

    let startX, startY, startW, startH, resizing = false;
    const minW = (opts.minWidth !== undefined) ? opts.minWidth : 160;
    const minH = (opts.minHeight !== undefined) ? opts.minHeight : 120;
    const maxW = (opts.maxWidth !== undefined) ? opts.maxWidth : Math.max(800, window.innerWidth - 40);
    const maxH = (opts.maxHeight !== undefined) ? opts.maxHeight : Math.max(600, window.innerHeight - 80);

    let lastSavedAt = 0;

    const onMove = (e) => {
      if (!resizing) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  let newW = Math.round(startW + (clientX - startX));
  let newH = Math.round(startH + (clientY - startY));
  // snapping during resize: attempt to align the right/bottom edges with other windows or viewport;
  // skip snapping if shift is held (user wants to ignore snapping while resizing)
  if (!(_shiftPressed || (e && e.shiftKey))) try {
        const SNAP_THRESHOLD = 24;
        const PADDING = 4; // preserve the same gap used by drag snapping
        const left = win.offsetLeft;
        const top = win.offsetTop;
        const others = Array.from(document.querySelectorAll('.window')).filter(w => w !== win && !w.classList.contains('closing') && !w.classList.contains('minimized'));
        const horizCandidates = [];
        const vertCandidates = [];

        // other windows candidates (preserve padded placements and edge alignments);
        // only consider candidates from windows that overlap in the perpendicular axis so snapping
        // feels intentional (e.g., vertical snaps consider horizontal overlap)
        others.forEach(o => {
          const oLeft = o.offsetLeft;
          const oTop = o.offsetTop;
          const oW = o.offsetWidth;
          const oH = o.offsetHeight;
          const oRight = oLeft + oW;
          const oBottom = oTop + oH;

          // compute overlap in x and y between this window and the other window;
          // use the current intended size (newW/newH) which reflects the size
          // while dragging the resizer and ensures perpendicular overlap checks
          // correctly surface vertical (bottom) and horizontal snaps
          const overlapX = Math.max(0, Math.min(left + newW, oRight) - Math.max(left, oLeft));
          const overlapY = Math.max(0, Math.min(top + newH, oBottom) - Math.max(top, oTop));
          const MIN_OVERLAP = 12; // px required to consider snapping

          // horizontal candidates (only if vertical overlap exists)
          if (overlapY >= MIN_OVERLAP) {
            // align right-to-right
            horizCandidates.push({w: oRight - left, prio: 0});
            // align right to just left-of-other with padding (our right = their left - PADDING)
            horizCandidates.push({w: (oLeft - PADDING) - left, prio: 1});
            // align right to just right-of-other with padding (our right = their right + PADDING)
            horizCandidates.push({w: (oRight + PADDING) - left, prio: 1});
          }

          // vertical candidates (only if horizontal overlap exists)
          if (overlapX >= MIN_OVERLAP) {
            // align bottom-to-bottom
            vertCandidates.push({h: oBottom - top, prio: 0});
            // align bottom to just above other with padding (our bottom = their top - PADDING)
            vertCandidates.push({h: (oTop - PADDING) - top, prio: 1});
            // align bottom to just below other with padding
            vertCandidates.push({h: (oBottom + PADDING) - top, prio: 1});
          }
        });

        // viewport edge candidates (snap to right/bottom of viewport)
        try {
          const scrollY = window.scrollY || window.pageYOffset || 0;
          const EDGE_MARGIN = 4;
          const viewportRight = document.documentElement.clientWidth - EDGE_MARGIN;
          const viewportBottomPage = scrollY + window.innerHeight - EDGE_MARGIN;
          horizCandidates.push({w: viewportRight - left, prio: 2});
          vertCandidates.push({h: viewportBottomPage - top, prio: 2});
        } catch (e) { /* ignore viewport */ }

        // choose best horizontal candidate (only snap when close, preserving gaps via padded candidates)
        let bestW = {d: Infinity, prio: Infinity, w: newW};
        horizCandidates.forEach(c => {
          // ignore invalid widths
          if (typeof c.w !== 'number' || c.w <= 0) return;
          const d = Math.abs(newW - c.w);
          if (d <= SNAP_THRESHOLD) {
            if (d < bestW.d || (d === bestW.d && c.prio < bestW.prio)) bestW = {d, prio: c.prio, w: c.w};
          }
        });
        if (bestW.d <= SNAP_THRESHOLD) newW = bestW.w;

        // choose best vertical candidate
        let bestH = {d: Infinity, prio: Infinity, h: newH};
        vertCandidates.forEach(c => {
          if (typeof c.h !== 'number' || c.h <= 0) return;
          const d = Math.abs(newH - c.h);
          if (d <= SNAP_THRESHOLD) {
            if (d < bestH.d || (d === bestH.d && c.prio < bestH.prio)) bestH = {d, prio: c.prio, h: c.h};
          }
        });
        if (bestH.d <= SNAP_THRESHOLD) newH = bestH.h;
      } catch (e) { /* ignore snapping errors */ }

      // enforce viewport bounds regardless of provided maxWidth/Height
      try {
        const EDGE_MARGIN = 4;
        const left = win.offsetLeft;
        const top = win.offsetTop;
        const viewportRight = document.documentElement.clientWidth - EDGE_MARGIN;
        const viewportBottomPage = (window.scrollY || window.pageYOffset || 0) + window.innerHeight - EDGE_MARGIN;
        const maxWViewport = Math.max(minW, viewportRight - left);
        const maxHViewport = Math.max(minH, viewportBottomPage - top);
        // shrink computed maxima to fit viewport
        newW = Math.min(newW, maxWViewport);
        newH = Math.min(newH, maxHViewport);
      } catch (e) { /* ignore */ }

      // finally clamp to allowed min/max
      newW = Math.max(minW, Math.min(maxW, newW));
      newH = Math.max(minH, Math.min(maxH, newH));
      win.style.width = newW + 'px';
      win.style.height = newH + 'px';

      // update indicator text and show it
      try {
        indicator.textContent = newW + '×' + newH;
        indicator.classList.add('visible');
      } catch (e) {}

      // throttle saving
      try {
        const now = Date.now();
        if (now - lastSavedAt > 250) {
          lastSavedAt = now;
          try { setWindowState(win.dataset.winId, { width: newW, height: newH }); } catch(e){}
        }
      } catch (e) { /* ignore */ }
    };

    const onUp = () => {
      if (!resizing) return;
      resizing = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      // persist final size
      try { setWindowState(win.dataset.winId, { width: parseInt(win.style.width||0,10), height: parseInt(win.style.height||0,10) }); } catch(e){}
      resizer.style.cursor = 'se-resize';
      // hide indicator after finishing
      try { indicator.classList.remove('visible'); } catch(e){}
    };

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = win.offsetWidth;
      startH = win.offsetHeight;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      resizer.style.cursor = 'grabbing';
      // show indicator immediately
      try { indicator.textContent = startW + '×' + startH; indicator.classList.add('visible'); } catch(e){}
    });

    resizer.addEventListener('touchstart', (e) => {
      e.preventDefault();
      resizing = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startW = win.offsetWidth;
      startH = win.offsetHeight;
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
      try { indicator.textContent = startW + '×' + startH; indicator.classList.add('visible'); } catch(e){}
    });

    // ensure resizer is not selectable
    resizer.addEventListener('dragstart', (e) => e.preventDefault());
  }

  function createWindow(title, htmlContent, opts = {}) {
    const container = opts.container ? document.querySelector(opts.container) : document.body;
    const win = makeWindowElement(title, htmlContent);
    // stable id: prefer opts.id; otherwise derive from current pathname + title so it's consistent across reloads
    const filename = (window.location.pathname || '/').split('/').pop() || 'index.html';
    const baseName = filename === '' ? 'index' : filename.replace(/\.[^/.]+$/, '');
    const stableId = opts.id || (baseName + '::' + slugify(title));
    const winId = 'win-' + stableId;
    win.dataset.winId = winId;
    container.appendChild(win);

    // assign a staggered enter delay based on creation order
    creationIndex += 1;
    const delayMs = creationIndex * 110; // stagger spacing (ms)
    win.style.setProperty('--enter-delay', delayMs + 'ms');
    // start in the 'enter' state, then remove the class to animate in
    win.classList.add('enter');
    // remove the enter state on next frame so transition runs
    requestAnimationFrame(() => requestAnimationFrame(() => win.classList.remove('enter')));

  // initial position — prefer saved state, then opts, then defaults
  const saved = getWindowState(winId);
  const left = (saved && saved.left !== undefined) ? saved.left : (opts.left !== undefined ? opts.left : 40);
  const top = (saved && saved.top !== undefined) ? saved.top : (opts.top !== undefined ? opts.top : 40);
  win.style.left = left + 'px';
  win.style.top = top + 'px';
  // optional size from opts (for testing varied window sizes)
  // size: prefer saved size, then opts
  if (saved && saved.width !== undefined) {
    win.style.width = (typeof saved.width === 'number' ? saved.width + 'px' : saved.width);
  } else if (opts.width !== undefined) {
    win.style.width = (typeof opts.width === 'number' ? opts.width + 'px' : opts.width);
  }
  if (saved && saved.height !== undefined) {
    win.style.height = (typeof saved.height === 'number' ? saved.height + 'px' : saved.height);
  } else if (opts.height !== undefined) {
    win.style.height = (typeof opts.height === 'number' ? opts.height + 'px' : opts.height);
  }

    // bring to front on click
    win.addEventListener('mousedown', () => bringToFront(win));
    // close button now minimizes instead of removing
    const btnClose = win.querySelector('.btn-close');
    btnClose.addEventListener('click', () => {
      // if already minimized or closing, ignore
      if (win.classList.contains('closing') || win.classList.contains('minimized')) return;
      // remove enter delay so any animations are immediate
      win.style.removeProperty('--enter-delay');
      minimizeWindow(win);
    });

    // enable drag
    const handle = win.querySelector('.win-header');
  enableDrag(win, handle);

    // enable resize if allowed by options or persisted state
    try {
      const allow = opts && (opts.allowResize === true || (saved && saved.width && saved.height));
      if (allow) {
        // apply min/max if provided
        if (opts.minWidth !== undefined) win.style.minWidth = (typeof opts.minWidth === 'number' ? opts.minWidth + 'px' : opts.minWidth);
        if (opts.minHeight !== undefined) win.style.minHeight = (typeof opts.minHeight === 'number' ? opts.minHeight + 'px' : opts.minHeight);
        if (opts.maxWidth !== undefined) win.style.maxWidth = (typeof opts.maxWidth === 'number' ? opts.maxWidth + 'px' : opts.maxWidth);
        if (opts.maxHeight !== undefined) win.style.maxHeight = (typeof opts.maxHeight === 'number' ? opts.maxHeight + 'px' : opts.maxHeight);
        enableResize(win, opts);
      }
    } catch (e) { /* ignore */ }

    // keyboard move when focused
    win.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 20 : 8;
      const leftNum = parseInt(win.style.left || 0, 10);
      const topNum = parseInt(win.style.top || 0, 10);
      if (e.key === 'ArrowLeft') { win.style.left = (leftNum - step) + 'px'; e.preventDefault(); }
      if (e.key === 'ArrowRight') { win.style.left = (leftNum + step) + 'px'; e.preventDefault(); }
      if (e.key === 'ArrowUp') { win.style.top = (topNum - step) + 'px'; e.preventDefault(); }
      if (e.key === 'ArrowDown') { win.style.top = (topNum + step) + 'px'; e.preventDefault(); }
    });
    // persist keyboard move changes
    win.addEventListener('keyup', (e) => {
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
        try { setWindowState(win.dataset.winId, { left: parseInt(win.style.left||0,10), top: parseInt(win.style.top||0,10) }); } catch(e){}
      }
    });

    bringToFront(win);

    // if saved state says minimized, apply minimize (after insertion so dock exists)
    if (saved && saved.minimized) {
      // defer a tick so DOM is stable
      requestAnimationFrame(() => {
        if (!win.classList.contains('minimized')) minimizeWindow(win);
      });
    }
    return win;
  }

  // create or get dock area (inside .tab-bar if available, otherwise bottom-right corner)
  function getDockContainer() {
    const tab = document.querySelector('.tab-bar');
    if (tab) {
      // prefer a dedicated dock bar directly below the tab bar
      let dockBar = document.querySelector('.window-dock-bar');
      if (!dockBar) {
        dockBar = document.createElement('div');
        dockBar.className = 'window-dock-bar';
        // insert immediately after the tab bar
        tab.parentNode.insertBefore(dockBar, tab.nextSibling);
        const inner = document.createElement('div');
        inner.className = 'window-dock';
        dockBar.appendChild(inner);
      }
      return dockBar.querySelector('.window-dock');
    }
    // fallback: create a dock bar in the bottom-right if there's no tab bar
    let globalBar = document.querySelector('.window-dock-global');
    if (!globalBar) {
      const outer = document.createElement('div');
      outer.className = 'window-dock-bar window-dock-global';
      // position fixed bottom-right for the global bar
      Object.assign(outer.style, {
        position: 'fixed',
        right: '12px',
        bottom: '12px',
        width: 'auto',
        padding: '6px 8px',
        zIndex: 999999,
      });
      const inner = document.createElement('div');
      inner.className = 'window-dock';
      outer.appendChild(inner);
      document.body.appendChild(outer);
      globalBar = outer;
    }
    return globalBar.querySelector('.window-dock');
  }

  function minimizeWindow(win) {
    const winId = win.dataset.winId;
    // add minimized class to visually hide or shrink
    win.classList.add('minimized');
    win.style.opacity = '0';
    win.style.pointerEvents = 'none';
    // create dock button
    const dock = getDockContainer();
    const btn = document.createElement('button');
    btn.className = 'dock-btn';
    btn.type = 'button';
    btn.title = win.querySelector('.win-title')?.textContent || 'window';
    btn.dataset.target = winId;
    btn.textContent = (btn.title || '•').slice(0, 10);
    btn.addEventListener('click', () => restoreWindow(winId));
    dock.appendChild(btn);
    // show the dock bar if needed
    const dockBarParent = dock.closest('.window-dock-bar');
    if (dockBarParent) {
      dockBarParent.classList.add('visible');
      // adjust any windows that would be overlapped by the now-visible dock
      adjustWindowsForDock(dockBarParent);
    } else if (dock.classList.contains('window-dock-global')) {
      // fallback dock: make it visible
      dock.style.display = 'flex';
    }
    // persist minimized state and position
    try { setWindowState(winId, { minimized: true, left: parseInt(win.style.left||0,10), top: parseInt(win.style.top||0,10) }); } catch(e){}
  }

  // dock is shown: calculate which windows would be overlapped and
  // apply a temporary translation to push them below the dock; avoid
  // changing `top` or persisting positions to prevent reload quirks —
  // compute and apply the shift dynamically instead
  function adjustWindowsForDock(dockBarElement) {
    if (!dockBarElement) return;
    try {
      const dockRect = dockBarElement.getBoundingClientRect();
      const scrollY = window.scrollY || window.pageYOffset || 0;
      const dockBottomPage = scrollY + dockRect.bottom;
      const GAP = 8;
      const wins = Array.from(document.querySelectorAll('.window')).filter(w => !w.classList.contains('minimized') && !w.classList.contains('closing'));
      wins.forEach(w => {
        const winTop = w.offsetTop;
        // if the window's top is above the dock bottom (i.e. it would be overlapped), push it down
        if (winTop < dockBottomPage + GAP) {
          const neededShift = Math.max(0, (dockBottomPage + GAP) - winTop);
          // mark as temporarily pushed; store shift amount on dataset (non-persistent)
          try { w.dataset.pushedByDock = String(neededShift); } catch (e) {}
          // animate using transform so we don't alter the absolute 'top' value or persist it
          w.style.transition = 'transform 220ms ease';
          // force reflow
          w.offsetWidth;
          // respect any existing transform by concatenation if needed (most windows don't use transforms)
          w.style.transform = `translateY(${neededShift}px)`;
          const cleanup = () => { w.style.transition = ''; w.removeEventListener('transitionend', cleanup); };
          w.addEventListener('transitionend', cleanup);
        }
      });
    } catch (e) {
      console.warn('adjustWindowsForDock failed', e);
    }
  }

  // restore windows that were adjusted for the dock back to their previous top positions
  function restoreWindowsFromDock() {
    try {
      // restore windows that were temporarily pushed by the dock
      const pushed = Array.from(document.querySelectorAll('.window')).filter(w => !w.classList.contains('minimized') && !w.classList.contains('closing') && w.dataset.pushedByDock);
      pushed.forEach(w => {
        // animate transform back to zero
        w.style.transition = 'transform 220ms ease';
        // force reflow
        w.offsetWidth;
        w.style.transform = 'translateY(0px)';
        const cleanup = () => { w.style.transition = ''; w.removeEventListener('transitionend', cleanup); };
        w.addEventListener('transitionend', cleanup);
        // remove temporary dataset marker
        try { delete w.dataset.pushedByDock; } catch (e) {}
        // if there are any old persisted preDockTop/docked markers from earlier versions,
        // remove them to avoid confusing reload logic (non-blocking)
        try { deleteWindowStateKey(w.dataset.winId, 'preDockTop'); deleteWindowStateKey(w.dataset.winId, 'docked'); } catch (e) {}
      });
    } catch (e) {
      console.warn('restoreWindowsFromDock failed', e);
    }
  }

  function restoreWindow(winId) {
    const win = document.querySelector(`.window[data-win-id="${winId}"]`);
    if (!win) return;
    // find and remove dock button
    const dock = getDockContainer();
    const btn = dock.querySelector(`.dock-btn[data-target="${winId}"]`);
    if (btn) btn.remove();
    // if no more dock buttons, hide the dock bar
    const dockChildren = dock.querySelectorAll ? dock.querySelectorAll('.dock-btn') : [];
    if ((dockChildren.length === 0) && dock) {
      const dockBarParent = dock.closest('.window-dock-bar');
      if (dockBarParent) {
        dockBarParent.classList.remove('visible');
        // when the dock retreats, restore any windows we moved down earlier
        try { restoreWindowsFromDock(); } catch(e) {}
      } else if (dock.classList.contains('window-dock-global')) {
        dock.style.display = 'none';
        try { restoreWindowsFromDock(); } catch(e) {}
      }
    }

    // restore visual state
    win.classList.remove('minimized');
    win.style.pointerEvents = '';
    // animate restore
    win.style.transition = 'opacity 180ms ease, transform 180ms ease';
    win.style.opacity = '1';
    bringToFront(win);
    // please restore persist
    try { setWindowState(winId, { minimized: false }); } catch(e){}

    const cleanup = () => { win.style.transition = ''; win.removeEventListener('transitionend', cleanup); };
    win.addEventListener('transitionend', cleanup);
  }

  // expose globally
  window.createWindow = createWindow;
})();
