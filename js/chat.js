import { app } from './firebase/firebase-config.js';
import { getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, linkWithPopup, signInWithRedirect, getRedirectResult, linkWithRedirect } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import { getFirestore, collection, query, orderBy, limit, addDoc, serverTimestamp as firestoreServerTimestamp, onSnapshot, doc as docRef, getDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';
import { getDatabase, ref, set, onDisconnect, onValue, serverTimestamp as rtdbServerTimestamp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js';
import { claimDisplayName } from './firebase/claimName.js';

const auth = getAuth(app);
const db = getFirestore(app);
const rdb = getDatabase(app);

const ROOM_ID = 'main';

// sanitize text (very small) — strip tags
function sanitize(text) {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
}

function makeChatWindow() {
  // initialize chat window
  const html = `
    <div class="chat-root">
      <div class="chat-header">
        <div class="current-name">
          <span id="myStatusDot" class="status-dot offline" aria-hidden="true"></span>
          <span id="currentNameDisplay">(not set)</span>
        </div>
        <div class="name-edit">
          <label class="name-label" for="chatName">Name</label>
          <input id="chatName" placeholder="Enter your name" />
          <button id="setNameBtn" class="dock-btn">Set</button>
        </div>
        <span id="nameStatus" class="name-status" aria-live="polite"></span>
      </div>

      <div class="chat-body">
        <div class="chat-left">
          <div id="messages" class="chat-messages" aria-live="polite"></div>
          <div id="replyPreview" class="reply-preview" aria-live="polite" aria-atomic="true" hidden>
            <div class="reply-title">Replying to <span id="replyAuthor"></span></div>
            <div class="reply-snippet" id="replySnippet"></div>
            <button id="replyCancel" type="button" class="reply-cancel" title="Cancel reply">✕</button>
          </div>
          <form id="msgForm" class="chat-form">
            <input id="msgInput" autocomplete="off" placeholder="Type a message…" />
            <button type="submit" class="dock-btn dock-btn-small send-btn">Send</button>
          </form>
        </div>
      </div>
    </div>
  `;
  const _win = createWindow('Live Chat Demo', html, { left: 4, top: 77, width: 522, height: 482, allowResize: true, minWidth: 480, minHeight: 360, maxWidth: 780, maxHeight: 640 });
  // mark this window so css can scope chat-specific layout (prevent win-body scroll)
  try { if (_win && _win.classList) _win.classList.add('chat-window'); } catch (e) {}

  // create online users window
  const usersHtml = `
    <div class="users-root">
      <div class="members-header">
        <strong id="onlineCount">Online</strong>
        <div class="users-controls">
          <button id="usersMenuBtn" class="dock-btn dock-btn-small" title="Sort & Filter">⋮</button>
          <div id="usersMenu" class="users-menu" aria-hidden="true">
            <div class="menu-section"><strong>Sort</strong></div>
            <label class="menu-item"><input type="radio" name="sortMode" value="named-az" checked> Named A→Z (default)</label>
            <label class="menu-item"><input type="radio" name="sortMode" value="online-then-az"> Online first, then A→Z</label>
            <div class="menu-sep"></div>
            <div class="menu-section"><strong>Filter</strong></div>
            <label class="menu-item"><input type="checkbox" id="hideAnonsChk" checked> Hide anonymous users</label>
            <div class="menu-sep"></div>
            <div class="menu-section"><strong>Pins & Hidden</strong></div>
            <div class="menu-actions">
              <button id="clearPinsBtn" class="dock-btn dock-btn-small" type="button">Clear pins</button>
              <button id="clearHiddenBtn" class="dock-btn dock-btn-small" type="button">Clear hidden</button>
            </div>
          </div>
        </div>
      </div>
      <div id="participants" class="participants"></div>
      <div id="userCtxMenu" class="users-context-menu" aria-hidden="true"></div>
    </div>
  `;
  const _usersWin = createWindow('Online Users', usersHtml, { left: 530, top: 77, width: 302, height: 542, allowResize: true, minWidth: 200, minHeight: 260, maxWidth: 640, maxHeight: 900 });
  try { if (_usersWin && _usersWin.classList) _usersWin.classList.add('users-window'); } catch (e) {}
  // reference for participants list inside the separate users window
  let participantsEl = document.getElementById('participants');
  const usersMenuBtn = _usersWin ? _usersWin.querySelector('#usersMenuBtn') : null;
  const usersMenu = _usersWin ? _usersWin.querySelector('#usersMenu') : null;
  const hideAnonsChk = _usersWin ? _usersWin.querySelector('#hideAnonsChk') : null;
  const clearPinsBtn = _usersWin ? _usersWin.querySelector('#clearPinsBtn') : null;
  const clearHiddenBtn = _usersWin ? _usersWin.querySelector('#clearHiddenBtn') : null;
  // global context menu element; move it to <body> so it can float above any window
  let userCtxMenu = document.getElementById('userCtxMenu') || (_usersWin ? _usersWin.querySelector('#userCtxMenu') : null);
  try {
    if (userCtxMenu && userCtxMenu.parentElement !== document.body) {
      document.body.appendChild(userCtxMenu);
    }
  } catch (e) { /* ignore reparent errors */ }

  const nameInput = document.getElementById('chatName');
  const setNameBtn = document.getElementById('setNameBtn');
  const nameStatusEl = document.getElementById('nameStatus');
  const messagesEl = document.getElementById('messages');
  const currentNameDisplay = document.getElementById('currentNameDisplay');
  const myStatusDot = document.getElementById('myStatusDot');
  // small gray uid tail next to current name
  let currentUidTag = null;
  const form = document.getElementById('msgForm');
  const input = document.getElementById('msgInput');
  const replyPreviewEl = document.getElementById('replyPreview');
  const replyAuthorEl = document.getElementById('replyAuthor');
  const replySnippetEl = document.getElementById('replySnippet');
  const replyCancelBtn = document.getElementById('replyCancel');
  let currentReply = null; // { id, author, snippet }

  // move the status element into the window header controls so it appears left of the minimize button
  try {
    const headerControls = _win && _win.querySelector ? _win.querySelector('.win-controls') : null;
    if (headerControls && nameStatusEl) {
      // insert before the first control button so it's left of the minimize/close button
      headerControls.insertBefore(nameStatusEl, headerControls.firstChild || null);
    }
  } catch (e) { /* ignore DOM reposition errors */ }

  // restore name from localStorage
  let displayName = localStorage.getItem('chat.displayName') || '';
  if (displayName) nameInput.value = displayName;
  // show current name in header; default to 'anonymous' when not set
  currentNameDisplay.textContent = displayName || 'anonymous';
  // ensure an adjacent tag span exists to show (#xxxx)
  try {
    const nameContainer = currentNameDisplay.parentElement;
    if (nameContainer && !currentUidTag) {
      currentUidTag = document.createElement('span');
      currentUidTag.id = 'currentUidTag';
      currentUidTag.className = 'uid-tag';
      nameContainer.appendChild(currentUidTag);
    }
  } catch (e) { /* ignore */ }

  

  // simple rendering helpers
  function renderMessage(doc) {
    const data = doc.data();
    const m = document.createElement('div');
    m.className = 'chat-msg';
    // mark messages sent by this client
    if (currentUid && data.uid === currentUid) m.classList.add('mine');
    const header = document.createElement('div'); header.className = 'chat-msg-header';
    const who = document.createElement('div'); who.className = 'chat-msg-who';
    const authorName = data.author || 'anonymous';
    who.textContent = authorName;
    // append uid tail next to name
    if (data.uid && typeof data.uid === 'string') {
      const tail = data.uid.slice(-4);
      const tag = document.createElement('span');
      tag.className = 'uid-tag';
      tag.textContent = ` (#${tail})`;
      who.appendChild(tag);
    }
    header.appendChild(who);
    // meta: timestamp + reply action
    const meta = document.createElement('div'); meta.className = 'chat-msg-meta';
    const tsSpan = document.createElement('span'); tsSpan.className = 'msg-time'; tsSpan.textContent = formatTimestamp(data.ts);
    const replyBtn = document.createElement('button'); replyBtn.type = 'button'; replyBtn.className = 'msg-reply'; replyBtn.textContent = 'Reply';
    replyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setCurrentReply({ id: doc.id, author: authorName, snippet: (data.text || '') });
    });
    // allow opening the same user actions menu from the chat message author
    try {
      who.style.cursor = 'pointer';
      who.title = 'User actions';
      const entryForMsg = { uid: data.uid, name: authorName };
      const openFromWho = (ev) => { ev.preventDefault(); ev.stopPropagation(); openUserCtxMenu(entryForMsg, who); };
      who.addEventListener('click', openFromWho);
      who.addEventListener('contextmenu', openFromWho);
      who.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') openFromWho(ev); });
    } catch (_) {}
    meta.appendChild(tsSpan);
    meta.appendChild(replyBtn);
    header.appendChild(meta);

    // optional quoted block if this message replies to another
    if (data.replyToAuthor || data.replyToSnippet) {
      const quote = document.createElement('div');
      quote.className = 'reply-quote';
      const qa = document.createElement('div'); qa.className = 'reply-quote-author'; qa.textContent = data.replyToAuthor || 'anonymous';
      const qs = document.createElement('div'); qs.className = 'reply-quote-snippet'; qs.textContent = (data.replyToSnippet || '').slice(0, 140);
      quote.appendChild(qa);
      quote.appendChild(qs);
      m.appendChild(quote);
    }

    const when = document.createElement('div'); when.className = 'chat-msg-text';
    when.innerHTML = sanitize(data.text || '');
    m.appendChild(header);
    m.appendChild(when);
    messagesEl.appendChild(m);
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // messages listener
  const msgsRef = collection(db, 'rooms', ROOM_ID, 'messages');
  const q = query(msgsRef, orderBy('ts', 'desc'), limit(100));
  onSnapshot(q, snap => {
    // render in chronological order
    const docs = [];
    snap.forEach(d => docs.push(d));
    messagesEl.innerHTML = '';
    docs.reverse().forEach(d => renderMessage(d));
    scrollToBottom();
  }, err => {
    console.error('messages listener failed', err);
  });

  // presence handling
  let presenceRef = null;
  let currentUid = null;
  let participantsMap = {};
  // preferences for users list
  const LS_KEYS = {
    settings: 'chat.users.settings',
    pinned: 'chat.users.pinned',
    hidden: 'chat.users.hidden'
  };
  let settings = { sortMode: 'named-az', hideAnons: true };
  let pinned = new Set();
  let hidden = new Set();
  function loadPrefs() {
    try {
      const rawS = localStorage.getItem(LS_KEYS.settings);
      if (rawS) settings = Object.assign(settings, JSON.parse(rawS));
    } catch (e) {}
    try {
      const rawP = localStorage.getItem(LS_KEYS.pinned);
      if (rawP) pinned = new Set(JSON.parse(rawP));
    } catch (e) {}
    try {
      const rawH = localStorage.getItem(LS_KEYS.hidden);
      if (rawH) hidden = new Set(JSON.parse(rawH));
    } catch (e) {}
  }
  function savePrefs() {
    try { localStorage.setItem(LS_KEYS.settings, JSON.stringify(settings)); } catch (e) {}
    try { localStorage.setItem(LS_KEYS.pinned, JSON.stringify(Array.from(pinned))); } catch (e) {}
    try { localStorage.setItem(LS_KEYS.hidden, JSON.stringify(Array.from(hidden))); } catch (e) {}
  }
  loadPrefs();
  // sync UI from prefs
  try {
    if (hideAnonsChk) hideAnonsChk.checked = !!settings.hideAnons;
    if (usersMenu) {
      const radios = usersMenu.querySelectorAll('input[name="sortMode"]');
      radios.forEach(r => r.checked = (r.value === settings.sortMode));
    }
  } catch (e) {}
  // menu open/close
  function toggleUsersMenu(show) {
    if (!usersMenu) return;
    const willShow = (show === undefined) ? (usersMenu.getAttribute('aria-hidden') === 'true') : !!show;
    usersMenu.setAttribute('aria-hidden', willShow ? 'false' : 'true');
    usersMenu.classList.toggle('open', willShow);
  }
  if (usersMenuBtn) usersMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleUsersMenu(); });
  document.addEventListener('click', () => { if (usersMenu && usersMenu.classList.contains('open')) toggleUsersMenu(false); });
  // menu interactions
  if (usersMenu) {
    usersMenu.addEventListener('change', (e) => {
      const t = e.target;
      if (t && t.name === 'sortMode') {
        settings.sortMode = t.value;
        savePrefs();
        renderParticipants();
      }
      if (t && t.id === 'hideAnonsChk') {
        settings.hideAnons = !!t.checked;
        savePrefs();
        renderParticipants();
      }
    });
  }
  if (clearPinsBtn) clearPinsBtn.addEventListener('click', () => { pinned.clear(); savePrefs(); renderParticipants(); });
  if (clearHiddenBtn) clearHiddenBtn.addEventListener('click', () => { hidden.clear(); savePrefs(); renderParticipants(); });

  // per-user context menu helpers
  function closeUserCtxMenu() {
    if (!userCtxMenu) return;
    userCtxMenu.setAttribute('aria-hidden', 'true');
    userCtxMenu.classList.remove('open');
    userCtxMenu.innerHTML = '';
  }
  function openUserCtxMenu(entry, anchorEl) {
    if (!userCtxMenu || !_usersWin) return;
    // build menu content depending on entry state
    const isSelf = currentUid && entry.uid === currentUid;
    const pinnedNow = pinned.has(entry.uid);
    userCtxMenu.innerHTML = `
      <div class="menu">
        <button type="button" class="menu-item" data-action="pin">${pinnedNow ? 'Unpin' : 'Pin'} user</button>
        ${isSelf ? '' : '<button type="button" class="menu-item" data-action="hide">Hide user</button>'}
      </div>
    `;
    // position near the anchor using viewport coordinates so it appears
    // directly below the clicked name regardless of scroll/parents
    try {
      const aRect = anchorEl.getBoundingClientRect();
      let top = aRect.bottom + 6; // 6px gap below
      let left = aRect.left;
      // open first so we can measure, then adjust for viewport edges
      userCtxMenu.style.top = `${Math.round(top)}px`;
      userCtxMenu.style.left = `${Math.round(left)}px`;
      userCtxMenu.setAttribute('aria-hidden', 'false');
      userCtxMenu.classList.add('open');
      const mRect = userCtxMenu.getBoundingClientRect();
      if (mRect.right > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - 8 - mRect.width);
      }
      if (mRect.bottom > window.innerHeight - 8) {
        top = Math.max(8, aRect.top - 6 - mRect.height);
      }
      userCtxMenu.style.top = `${Math.round(top)}px`;
      userCtxMenu.style.left = `${Math.round(left)}px`;
    } catch (e) {
      // fallback if positioning calculation failed
      userCtxMenu.style.top = '80px';
      userCtxMenu.style.left = '80px';
      userCtxMenu.setAttribute('aria-hidden', 'false');
      userCtxMenu.classList.add('open');
    }
    // wire actions
    const onClick = (ev) => {
      const btn = ev.target.closest('.menu-item');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'pin') {
        if (pinned.has(entry.uid)) pinned.delete(entry.uid); else pinned.add(entry.uid);
        savePrefs();
        closeUserCtxMenu();
        renderParticipants();
      } else if (action === 'hide' && !isSelf) {
        hidden.add(entry.uid);
        savePrefs();
        closeUserCtxMenu();
        renderParticipants();
      }
    };
    userCtxMenu.onclick = onClick;
  }
  // close context menu on outside click or scroll
  document.addEventListener('click', (e) => {
    // if click is not inside the context menu, close it
    if (userCtxMenu && userCtxMenu.classList.contains('open')) {
      const within = e.target && (userCtxMenu.contains(e.target));
      const clickedParticipant = e.target && (participantsEl && participantsEl.contains(e.target));
      if (!within && !clickedParticipant) closeUserCtxMenu();
    }
  });
  if (participantsEl) participantsEl.addEventListener('scroll', () => closeUserCtxMenu(), { passive: true });
  if (messagesEl) messagesEl.addEventListener('scroll', () => closeUserCtxMenu(), { passive: true });

  // disable message form until auth completes to avoid rejected writes
  input.disabled = true;
  form.querySelector('button')?.setAttribute('disabled', 'true');
  setNameBtn.setAttribute('disabled', 'true');

  async function updatePresence() {
    if (!currentUid) return;
    if (!displayName) displayName = (localStorage.getItem('chat.displayName') || 'anonymous');
    try {
      presenceRef = ref(rdb, `presence/${ROOM_ID}/${currentUid}`);
      // set onDisconnect to mark the user offline with a server timestamp
      // keep a record of lastSeen for offline users
      await onDisconnect(presenceRef).set({ name: displayName, online: false, lastSeen: rtdbServerTimestamp() }).catch((e)=>{
        console.warn('[presence] onDisconnect.set failed', e);
      });
      // mark online now with server timestamp
      await set(presenceRef, { name: displayName, online: true, lastSeen: rtdbServerTimestamp() }).catch((e)=>{
        console.warn('[presence] set failed', e);
      });
    } catch (e) { console.error('presence failed', e); }
  }

  // Ensure the current display name is actually owned by this uid in the
  // usernames registry; if not, reset to anonymous and update presence.
  async function reconcileDisplayNameWithRegistry() {
    try {
      const key = (displayName || '').trim().toLowerCase();
      if (!key || key === 'anonymous' || key === 'anon') return;
      const snap = await getDoc(docRef(db, 'usernames', key));
      const ownerUid = snap.exists() ? (snap.data() && snap.data().uid) : null;
      if (!ownerUid || ownerUid !== currentUid) {
        // Not our name — reset locally and update UI + presence
        displayName = '';
        try { localStorage.removeItem('chat.displayName'); } catch (e) {}
        currentNameDisplay.textContent = 'anonymous';
        await updatePresence();
      }
    } catch (e) { /* ignore; non-owner sessions will self-correct next tick */ }
  }

  // listen for presence changes
  const presRefAll = ref(rdb, `presence/${ROOM_ID}`);
  function isAnonymousName(n) {
    const s = (n || '').trim().toLowerCase();
    return !s || s === 'anonymous' || s === 'anon';
  }
  function sortEntries(list) {
    const mode = settings.sortMode || 'named-az';
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (mode === 'online-then-az') {
      return list.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        // prioritize named over anonymous when online status equal
        const aAnon = isAnonymousName(a.name), bAnon = isAnonymousName(b.name);
        if (aAnon !== bAnon) return aAnon ? 1 : -1;
        return byName(a, b);
      });
    }
    // default: named A→Z; if anonymous are shown, they appear after named (A→Z)
    return list.sort((a, b) => {
      const aAnon = isAnonymousName(a.name), bAnon = isAnonymousName(b.name);
      if (aAnon !== bAnon) return aAnon ? 1 : -1; // named first
      return byName(a, b);
    });
  }
  function renderParticipants() {
    const o = participantsMap || {};
    participantsEl.innerHTML = '';
    const keys = Object.keys(o);
    // build base entries
    let entries = keys.map(k => ({
      uid: k,
      name: (o[k] && o[k].name) || 'anonymous',
      online: !!(o[k] && o[k].online),
      lastSeen: o[k] && o[k].lastSeen ? Number(o[k].lastSeen) : 0,
      pinned: pinned.has(k),
      hidden: hidden.has(k)
    }));
    // filter hidden
    entries = entries.filter(e => !e.hidden);
    // optionally hide anonymous
    if (settings.hideAnons) entries = entries.filter(e => !isAnonymousName(e.name));
    // split pinned/non-pinned, then build grouped sections based on sort mode
    const pinnedList = entries.filter(e => e.pinned);
    const rest = entries.filter(e => !e.pinned);
    sortEntries(pinnedList);

    let groups = [];
    if (pinnedList.length) groups.push({ title: 'Pinned', items: pinnedList });

    if ((settings.sortMode || 'named-az') === 'online-then-az') {
      // group by online status
      const online = rest.filter(e => e.online);
      const offline = rest.filter(e => !e.online);
      sortEntries(online);
      sortEntries(offline);
      if (online.length) groups.push({ title: 'Online', items: online });
      if (offline.length) groups.push({ title: 'Offline', items: offline });
    } else {
      // default: named first then anonymous if shown
      const named = rest.filter(e => !isAnonymousName(e.name));
      const anon = rest.filter(e => isAnonymousName(e.name));
      sortEntries(named);
      sortEntries(anon);
      if (named.length) groups.push({ title: 'Named', items: named });
      if (anon.length) groups.push({ title: 'Anonymous', items: anon });
    }

    const finalList = groups.flatMap(g => g.items);

    // update counts based on filtered list
    const onlineCount = finalList.filter(e => e.online).length;
    const totalCount = finalList.length;
    const onlineCountEl = document.getElementById('onlineCount');
    if (onlineCountEl) onlineCountEl.textContent = `Online${settings.hideAnons ? ' (named)' : ''}: ${onlineCount} / ${totalCount}`;

    // render groups with headings
    groups.forEach(group => {
      if (!group.items || group.items.length === 0) return;
      const header = document.createElement('div');
      header.className = 'group-header';
      header.textContent = group.title;
      participantsEl.appendChild(header);

      group.items.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'participant';
      item.tabIndex = 0;
      // status dot
      const dot = document.createElement('span');
      dot.className = 'participant-dot ' + (entry.online ? 'online' : 'offline');
      item.appendChild(dot);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'participant-name';
      nameSpan.textContent = entry.name;
      item.appendChild(nameSpan);

      // uid tail next to name
      if (entry.uid) {
        const tag = document.createElement('span');
        tag.className = 'uid-tag';
        tag.textContent = ` (#${String(entry.uid).slice(-4)})`;
        item.appendChild(tag);
      }

      // mark current user
      if (currentUid && entry.uid === currentUid) {
        const you = document.createElement('span');
        you.className = 'you-tag';
        you.textContent = ' (you)';
        item.appendChild(you);
      }

      if (!entry.online && entry.lastSeen) {
        const last = document.createElement('div');
        last.className = 'last-seen';
        last.textContent = timeAgo(entry.lastSeen);
        item.appendChild(last);
      }

      // open context menu on click or contextmenu
      item.addEventListener('click', (ev) => { ev.stopPropagation(); openUserCtxMenu(entry, item); });
      item.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); openUserCtxMenu(entry, item); });
      item.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openUserCtxMenu(entry, item); } });

      participantsEl.appendChild(item);
      });
    });
    // update my status dot and current display
    try {
      if (currentUid && participantsMap[currentUid]) {
        const isOnline = !!participantsMap[currentUid].online;
        myStatusDot.classList.toggle('online', isOnline);
        myStatusDot.classList.toggle('offline', !isOnline);
      } else {
        myStatusDot.classList.remove('online'); myStatusDot.classList.add('offline');
      }
      currentNameDisplay.textContent = displayName || (participantsMap[currentUid] && participantsMap[currentUid].name) || 'anonymous';
      // update uid tag in header
      if (currentUidTag) currentUidTag.textContent = currentUid ? ` (#${String(currentUid).slice(-4)})` : '';
    } catch (e) { /* ignore UI update errors */ }
  }
  onValue(presRefAll, async snap => {
    participantsMap = snap.val() || {};
    renderParticipants();
  }, err => {
    console.error('[presence] listener failed', err);
    try { showNameStatus('Presence unavailable'); } catch(e) {}
  });

  // helper: format relative time
  function timeAgo(ms) {
    const diff = Date.now() - ms;
    const s = Math.floor(diff / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s/60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m/60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h/24);
    return `${d}d ago`;
  }

  // format Firestore timestamp into a short local time (and date if not today)
  function formatTimestamp(ts) {
    try {
      let date = null;
      if (!ts) return '';
      if (typeof ts.toDate === 'function') date = ts.toDate();
      else if (typeof ts === 'number') date = new Date(ts);
      else if (ts.seconds) date = new Date(ts.seconds * 1000);
      if (!date) return '';
      const now = new Date();
      const sameDay = date.toDateString() === now.toDateString();
      const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return sameDay ? timeStr : (date.toLocaleDateString() + ' ' + timeStr);
    } catch (e) { return ''; }
  }

  function setCurrentReply(info) {
    currentReply = info ? { id: info.id, author: info.author || 'anonymous', snippet: (info.snippet || '').toString() } : null;
    try {
      if (currentReply && replyPreviewEl) {
        replyAuthorEl.textContent = currentReply.author;
        replySnippetEl.textContent = currentReply.snippet.slice(0, 140);
        replyPreviewEl.hidden = false;
      } else if (replyPreviewEl) {
        replyPreviewEl.hidden = true;
        replyAuthorEl.textContent = '';
        replySnippetEl.textContent = '';
      }
    } catch (e) {}
  }
  if (replyCancelBtn) replyCancelBtn.addEventListener('click', () => setCurrentReply(null));

  // auth and message send
  let isOwnerFlag = false;
  async function refreshOwnerFlag() {
    try {
      const u = auth.currentUser;
      if (!u) { isOwnerFlag = false; return; }
      const snap = await getDoc(docRef(db, 'owners', u.uid));
      isOwnerFlag = !!(snap && snap.exists());
    } catch (_) {
      isOwnerFlag = false;
    }
  }

  onAuthStateChanged(auth, async user => {
    if (!user) return;
    currentUid = user.uid;
    // show uid tail in header as soon as we know the uid
    try { if (currentUidTag) currentUidTag.textContent = currentUid ? ` (#${String(currentUid).slice(-4)})` : ''; } catch (e) {}
    // ensure displayName exists
    if (!displayName) {
      displayName = localStorage.getItem('chat.displayName') || ('anonymous');
      nameInput.value = displayName;
    }
    await refreshOwnerFlag();
    // self-heal any stale local display name that we don't own anymore
    await reconcileDisplayNameWithRegistry();
    updatePresence();
    // enable form now that we're authenticated
    input.disabled = false;
    form.querySelector('button')?.removeAttribute('disabled');
    setNameBtn.removeAttribute('disabled');
  });

  // set name handler with duplicate detection
  let _nameStatusTimer = null;
  // show a transient name feedback message under the buttons; doesn't shift layout
  function showNameStatus(msg) {
    try {
      if (!_nameStatusTimer) {
        // ensure element exists
      }
      nameStatusEl.textContent = msg || '';
      nameStatusEl.classList.add('visible');
      // clear any existing timer
      if (_nameStatusTimer) clearTimeout(_nameStatusTimer);
      _nameStatusTimer = setTimeout(() => {
        nameStatusEl.classList.remove('visible');
        // clear text shortly after fade so screen readers won't repeatedly announce it
        setTimeout(() => { nameStatusEl.textContent = ''; }, 260);
        _nameStatusTimer = null;
      }, 3000);
    } catch (e) { /* ignore UI errors */ }
  }
  async function setName() {
    let desired = sanitize(nameInput.value || '') || '';
    // if user already has a non-anonymous name set and they re-submit the same name, short-circuit
    if (displayName && displayName !== 'anonymous' && desired === displayName) {
      showNameStatus('Name already set');
      return;
    }
    if (!desired) {
      showNameStatus('Please choose a name');
      return;
    }
    const nameKeyTest = desired.trim().toLowerCase();
    if (nameKeyTest === 'anon' || nameKeyTest === 'anonymous') {
      showNameStatus('That name is reserved — pick another');
      return;
    }
    try {
      const res = await claimDisplayName(db, auth, desired);
      if (!res.ok) {
        // attempt to read the username doc to show who holds it (reads are allowed by rules)
        // attempt to read username doc for a friendlier error message
        try {
          const nameKey = desired.trim().toLowerCase();
          const unameDoc = await getDoc(docRef(db, 'usernames', nameKey));
          // nothing to log in production
        } catch (re) { /* ignore read failures */ }
        // show specific error when possible; prefer a machine code if provided
        const code = (res.code || res.error || '').toString();
        if (code === 'name-taken' || code.indexOf('name-taken') >= 0) {
          showNameStatus('Name taken — try another');
        } else if (code === 'not-authenticated') {
          showNameStatus('You must be signed in to set a name');
        } else if (code.indexOf('permission') >= 0 || code.indexOf('PERMISSION') >= 0 || code.indexOf('insufficient') >= 0) {
          showNameStatus('Permission denied — check Firestore rules and that rules are deployed');
        } else {
          // fallback to returned error message for debugging / clarity
          showNameStatus('Error setting name: ' + (res.error || code || 'unknown'));
        }
        return;
      }
      // success: use desired name as displayName
      displayName = desired;
      localStorage.setItem('chat.displayName', displayName);
      // update header display immediately
      currentNameDisplay.textContent = displayName;
      updatePresence();
      // show success briefly
  showNameStatus(`Name set: ${displayName}`);
    } catch (err) {
      console.error('claimDisplayName failed', err);
  showNameStatus('Error setting name: ' + (err && err.message ? err.message : err));
    }
  }
  setNameBtn.addEventListener('click', () => setName());

  // handle redirect result (after signIn/linkWithRedirect) before anonymous sign-in
  (async () => {
    try {
      const res = await getRedirectResult(auth);
      if (res && res.user) {
        await refreshOwnerFlag();
        updatePresence();
        showNameStatus(isOwnerFlag ? 'Signed in as owner' : 'Signed in');
      }
    } catch (e) {
      const code = e && e.code ? String(e.code) : '';
      if (code) console.warn('[auth redirect] error', code);
    } finally {
      // ensure anonymous sign-in if still not authenticated
      if (!auth.currentUser) {
        try { await signInAnonymously(auth); } catch (err) { console.error('auth error', err); }
      }
    }
  })();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = sanitize(input.value || '');
    if (!text) return;
    if (!auth.currentUser) return;
    try {
      const docBody = {
        text,
        uid: auth.currentUser.uid,
        author: displayName || 'anonymous',
        ts: firestoreServerTimestamp()
      };
      if (currentReply && currentReply.id) {
        // store reply metadata for easy rendering without extra reads
        docBody.replyToId = currentReply.id;
        docBody.replyToAuthor = currentReply.author || 'anonymous';
        docBody.replyToSnippet = (currentReply.snippet || '').slice(0, 280);
      }
      await addDoc(msgsRef, docBody);
      input.value = '';
      setCurrentReply(null);
    } catch (e) { console.error('send failed', e); }
  });
}

// create the chat window when DOM is ready and createWindow exists
document.addEventListener('DOMContentLoaded', () => {
  // wait a frame for windows system to initialize
  requestAnimationFrame(() => {
    // if createWindow isn't ready yet (rare race), poll briefly and retry
    if (typeof createWindow === 'function') {
      try { makeChatWindow(); } catch (e) { console.error('[chat] makeChatWindow failed', e); }
      return;
    }
    console.warn('[chat] createWindow not available yet; retrying');
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (typeof createWindow === 'function') {
        clearInterval(id);
        try { makeChatWindow(); } catch (e) { console.error('[chat] makeChatWindow failed', e); }
        return;
      }
      if (tries > 12) {
        clearInterval(id);
        console.error('[chat] createWindow never became available after retries');
      }
    }, 150);
  });
});
