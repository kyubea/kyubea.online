(function () {
  // insert the tab bar (components/tabBar.js defines insertTabBar)
  if (typeof insertTabBar === 'function') insertTabBar();

  // create a small directory bar above the tab bar
  (function() {
    const tab = document.querySelector('.tab-bar');
    if (!tab) return;
    if (document.querySelector('.dir-bar')) return; // already present
    const dirBar = document.createElement('div');
    dirBar.className = 'dir-bar';
    dirBar.innerHTML = '<span class="dir-icon">▣</span><span class="dir-text"></span>';
    tab.parentNode.insertBefore(dirBar, tab);
    // compute a friendly page name to display
    function prettyNameFromPath() {
      // prefer document.title when available and not generic
      const title = (document.title || '').trim();
      if (title && title.toLowerCase() !== 'untitled') return title;

      const filename = (window.location.pathname || '/').split('/').pop() || 'index.html';
      let name = filename;
      // map index to Home
      if (name === '' || name === 'index.html' || name === 'index.htm') return 'Home';
      // remove extension
      const dot = name.lastIndexOf('.');
      if (dot > 0) name = name.substring(0, dot);
      // replace separators with spaces and capitalize words
      name = name.replace(/[-_\.]+/g, ' ');
      name = name.split(' ').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
      return name || 'Home';
    }

    const dirTextEl = dirBar.querySelector('.dir-text');

    const fullPath = (window.location.pathname || '/');
    let directoryPath = fullPath;
    if (!directoryPath.endsWith('/')) {
      const idx = directoryPath.lastIndexOf('/');
      directoryPath = directoryPath.substring(0, idx + 1) || '/';
    }

    // clear existing content and build anchors
    dirTextEl.innerHTML = '';
    // root link - update to show "Beatrice Womack"
    const rootLink = document.createElement('a');
    rootLink.href = 'index.html';
    rootLink.className = 'dir-link';
    rootLink.textContent = 'Beatrice Womack';
    dirTextEl.appendChild(rootLink);

    // add intermediate segments
    const segments = directoryPath.split('/').filter(Boolean);
    let acc = '/';
    segments.forEach((seg) => {
      acc += seg + '/';
      const sep = document.createTextNode(' / ');
      dirTextEl.appendChild(sep);
      const a = document.createElement('a');
      a.href = acc;
      a.className = 'dir-link';
      // prettify segment (replace dashes/underscores)
      a.textContent = seg.replace(/[-_]+/g, ' ');
      a.title = acc;
      dirTextEl.appendChild(a);
    });

    // append the current page name as the last (non-clickable) breadcrumb
    const pageName = prettyNameFromPath();
    if (pageName) {
      if (pageName === 'Home' && segments.length === 0) {
        // if already at root, replace the root link with a non-clickable current indicator
        const current = document.createElement('span');
        current.className = 'dir-current';
        current.textContent = pageName;
        rootLink.replaceWith(current);
      } else {
        const sep = document.createTextNode(' / ');
        dirTextEl.appendChild(sep);
        const current = document.createElement('span');
        current.className = 'dir-current';
        current.textContent = pageName;
        dirTextEl.appendChild(current);
      }
    }
  })();

  (function blogScrollbarVisibility() {
    function watchBlogPosts() {
      const posts = document.querySelectorAll('.blog-window .blog-post');
      posts.forEach(p => {
        let timer = null;
        p.addEventListener('scroll', () => {
          p.classList.add('scrolling');
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => { p.classList.remove('scrolling'); timer = null; }, 300);
        }, { passive: true });
        // also ensure class cleared on mouseout
        p.addEventListener('mouseleave', () => { p.classList.remove('scrolling'); });
      });
    }
    // run after DOM ready; also support dynamic windows created later by observing mutations
    document.addEventListener('DOMContentLoaded', () => setTimeout(watchBlogPosts, 50));
    // observe DOM for added blog windows
    const mo = new MutationObserver((m) => { watchBlogPosts(); });
    mo.observe(document.body, { childList: true, subtree: true });
  })();

  (function chatScrollbarVisibility() {
    function watchChatAreas() {
      const areas = [];
      document.querySelectorAll('.chat-window .chat-messages').forEach(a => areas.push(a));
      document.querySelectorAll('.chat-window .participants').forEach(a => areas.push(a));
      areas.forEach(a => {
        let timer = null;
        a.addEventListener('scroll', () => {
          a.classList.add('scrolling');
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => { a.classList.remove('scrolling'); timer = null; }, 300);
        }, { passive: true });
        a.addEventListener('mouseleave', () => { a.classList.remove('scrolling'); });
      });
    }
    document.addEventListener('DOMContentLoaded', () => setTimeout(watchChatAreas, 50));
    const mo = new MutationObserver(() => watchChatAreas());
    mo.observe(document.body, { childList: true, subtree: true });
  })();
})();