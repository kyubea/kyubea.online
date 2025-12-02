class TabBar {
    static unreadMsgCount = 0;
    static STORAGE_KEY = 'chatspace.unread';
    static badge = null;

    static initialize() {
        // Get the current page path
        const currentPath = window.location.pathname.split('/').pop() || 'index.html';
        // load persisted unread count
        try {
            const raw = localStorage.getItem(TabBar.STORAGE_KEY);
            TabBar.unreadMsgCount = raw ? parseInt(raw, 10) || 0 : 0;
        } catch (e) {
            TabBar.unreadMsgCount = 0;
        }

        TabBar.badge = document.querySelector('.badge');
        TabBar.updateBadge();
        
        // Set active tab based on current page
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => {
            const href = tab.getAttribute('href');
            if ((href === '#' && currentPath === 'index.html') || 
                (href !== '#' && currentPath.includes(href))) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        if (currentPath.toLowerCase().includes('chat')) {
            TabBar.clearUnread();
        }
    }

    static updateBadge() {
        if (!TabBar.badge) return;
        if (TabBar.unreadMsgCount > 0) {
            // cap display at 20+
            const displayText = (TabBar.unreadMsgCount > 20) ? '20+' : String(TabBar.unreadMsgCount);
            TabBar.badge.textContent = displayText;
            // mark long text for smaller font
            if (displayText.length > 2) TabBar.badge.classList.add('long'); else TabBar.badge.classList.remove('long');
            TabBar.badge.style.display = 'inline-flex';
        } else {
            TabBar.badge.style.display = 'none';
            TabBar.badge.classList.remove('long');
        }
    }

    static incrementUnread() {
        TabBar.unreadMsgCount++;
        try { localStorage.setItem(TabBar.STORAGE_KEY, String(TabBar.unreadMsgCount)); } catch(e){}
        TabBar.updateBadge();
        // flash the badge briefly to indicate a new message
        try {
            const b = TabBar.badge;
            if (b) {
                b.classList.remove('flash');
                // force reflow to restart animation
                // eslint-disable-next-line no-unused-expressions
                b.offsetWidth;
                b.classList.add('flash');
                b.addEventListener('animationend', () => b.classList.remove('flash'), { once: true });
            }
        } catch (e) {}
    }

    static clearUnread() {
        TabBar.unreadMsgCount = 0;
        try { localStorage.setItem(TabBar.STORAGE_KEY, '0'); } catch(e){}
        TabBar.updateBadge();
    }
}