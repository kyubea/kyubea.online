import { app } from './firebase/firebase-config.js';
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import { getFirestore, collection, getDocs, query, orderBy, limit, deleteDoc, doc, getDoc, Timestamp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';
import { getDatabase, ref, get as rget, child } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js';

// owner gating is determined by existence of a document at owners/{uid}; no email or uid is embedded in client code

const auth = getAuth(app);
const db = getFirestore(app);
const rdb = getDatabase(app);

const googleBtn = document.getElementById('googleSignIn');
const authInfo = document.getElementById('authInfo');
const ownerBadge = document.getElementById('ownerBadge');

const releaseNameInput = document.getElementById('releaseNameInput');
const releaseNameBtn = document.getElementById('releaseNameBtn');
const nameActionMsg = document.getElementById('nameActionMsg');

const usersTbody = document.getElementById('usersTbody');
const usersStatus = document.getElementById('usersStatus');
const userSearch = document.getElementById('userSearch');
const refreshBtn = document.getElementById('refreshUsers');

let OWNER = false;
function isOwner() { return OWNER; }
async function refreshOwner() {
  try {
    const u = auth.currentUser;
    if (!u) { OWNER = false; return OWNER; }
    const snap = await getDoc(doc(db, 'owners', u.uid));
    OWNER = !!(snap && snap.exists());
    ownerBadge.style.display = OWNER ? '' : 'none';
    updateOwnerUI();
    return OWNER;
  } catch (_) {
    OWNER = false;
    ownerBadge.style.display = 'none';
    updateOwnerUI();
    return OWNER;
  }
}

function formatTs(ts) {
  try {
    if (!ts) return '';
    let d = null;
    if (ts instanceof Timestamp || (ts && typeof ts.toDate === 'function')) d = ts.toDate();
    else if (typeof ts === 'number') d = new Date(ts);
    else if (ts && ts.seconds) d = new Date(ts.seconds * 1000);
    if (!d) return '';
    return d.toLocaleString();
  } catch { return ''; }
}

function setAuthInfo(msg, {ok=false}={}){
  if (!authInfo) return;
  authInfo.textContent = msg;
  authInfo.classList.toggle('status-ok', !!ok);
  authInfo.classList.toggle('status-bad', !ok);
}

async function loadPresenceMap() {
  try {
    const snap = await rget(ref(rdb, 'presence/main'));
    return snap.exists() ? snap.val() : {};
  } catch { return {}; }
}

async function listUsers() {
  if (!isOwner()) {
    usersTbody.innerHTML = '';
    usersStatus.textContent = 'Sign in as owner to view users';
    return;
  }
  usersTbody.innerHTML = '';
  usersStatus.textContent = 'Loading…';
  const pres = await loadPresenceMap();
  const qy = query(collection(db, 'users'), orderBy('name')); // name index is not required for simple orderBy single field
  const snap = await getDocs(qy);
  const rows = [];
  snap.forEach(docSnap => {
    const d = docSnap.data();
    const uid = docSnap.id;
    rows.push({
      uid,
      name: d.name || 'anonymous',
      nameKey: d.nameKey || '',
      createdAt: d.createdAt || null,
      online: !!(pres && pres[uid] && pres[uid].online)
    });
  });
  const filter = (userSearch.value || '').trim().toLowerCase();
  const view = rows.filter(r => !filter || r.name.toLowerCase().includes(filter) || r.uid.toLowerCase().includes(filter));
  view.sort((a,b)=> a.name.localeCompare(b.name));

  for (const r of view) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.name)}</td>
      <td class="muted">${r.uid}</td>
      <td>${escapeHtml(r.nameKey)}</td>
      <td class="muted">${formatTs(r.createdAt) || ''}</td>
      <td>${r.online ? '<span class="status-ok">online</span>' : '<span class="muted">offline</span>'}</td>
      <td>
        <button class="btn" data-act="release" data-uid="${r.uid}" data-namekey="${r.nameKey}">Release name</button>
        <button class="btn danger" data-act="deluser" data-uid="${r.uid}">Delete user</button>
      </td>
    `;
    usersTbody.appendChild(tr);
  }
  usersStatus.textContent = `${view.length} users shown`;
}

function escapeHtml(s){ return (s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

async function forceRelease(nameKey){
  if (!isOwner()) throw new Error('owner-only');
  const key = (nameKey||'').trim().toLowerCase();
  if (!key) throw new Error('missing name');
  await deleteDoc(doc(db, 'usernames', key));
}

async function deleteUser(uid){
  if (!isOwner()) throw new Error('owner-only');
  await deleteDoc(doc(db, 'users', uid));
}

// wire actions
onAuthStateChanged(auth, async (u)=>{
  if (u) {
    setAuthInfo(`${u.email || '(no-email)'} – ${u.uid}`, { ok:true });
  } else {
    setAuthInfo('Not signed in');
  }
  await refreshOwner();
  // refresh lists when auth/owner changes
  try { await listUsers(); } catch (e) { usersStatus.textContent = `Error: ${e}`; }
  try { await loadMessages(); } catch {}
});

googleBtn.addEventListener('click', async ()=>{
  try {
    const provider = new GoogleAuthProvider();
    setAuthInfo('Opening Google sign-in…');
    try {
      await signInWithPopup(auth, provider);
    } catch (popupErr) {
      // attempt redirect on popup-blocked or mobile
      const { signInWithRedirect } = await import('https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js');
      await signInWithRedirect(auth, provider);
      return;
    }
  } catch (e) {
    const code = e && e.code ? String(e.code) : '';
    if (code === 'auth/unauthorized-domain') {
      authInfo.innerHTML = `Unauthorized domain. Add <code>localhost</code>, <code>127.0.0.1</code> and your site domains (e.g., <code>bunbea.moe</code>) to Firebase Console → Authentication → Settings → Authorized domains. Then retry.`;
      authInfo.classList.remove('status-ok');
      authInfo.classList.add('status-bad');
      return;
    }
    if (code === 'auth/operation-not-allowed') {
      setAuthInfo('Enable Google provider in Firebase Auth → Sign-in method', { ok:false });
      return;
    }
    if (code === 'auth/popup-blocked') {
      setAuthInfo('Popup blocked. Allow popups for this site or try again (will use redirect).', { ok:false });
      return;
    }
    if (code === 'auth/popup-closed-by-user') {
      setAuthInfo('Popup closed. Try again.', { ok:false });
      return;
    }
    alert('Sign-in failed: ' + (e && e.message ? e.message : e));
  }
});

// handle redirect results (mobile) to surface errors
(async () => {
  try {
    const { getRedirectResult } = await import('https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js');
    const res = await getRedirectResult(auth);
    if (res && res.user) {
      setAuthInfo(`${res.user.email || '(no-email)'} – ${res.user.uid}`, { ok:true });
    }
  } catch (e) {
    const code = e && e.code ? String(e.code) : '';
    if (code) setAuthInfo(`Sign-in error: ${code}`, { ok:false });
  }
})();

releaseNameBtn.addEventListener('click', async ()=>{
  try {
    await forceRelease(releaseNameInput.value);
    nameActionMsg.textContent = 'Released';
    setTimeout(()=> nameActionMsg.textContent = '', 1500);
    await listUsers();
  } catch (e) {
    nameActionMsg.textContent = 'Error: ' + (e && e.message ? e.message : e);
  }
});

refreshBtn.addEventListener('click', ()=> listUsers());
userSearch.addEventListener('input', ()=> listUsers());

usersTbody.addEventListener('click', async (ev)=>{
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.getAttribute('data-act');
  const uid = btn.getAttribute('data-uid');
  const nameKey = btn.getAttribute('data-namekey');
  try {
    if (act === 'release') {
      if (!nameKey) return alert('No nameKey on record');
      if (!confirm(`Force release '${nameKey}'?`)) return;
      await forceRelease(nameKey);
    } else if (act === 'deluser') {
      if (!confirm(`Delete user doc ${uid}?`)) return;
      await deleteUser(uid);
    }
    await listUsers();
  } catch (e) {
    alert('Action failed: ' + (e && e.message ? e.message : e));
  }
});

// initial
listUsers().catch(()=>{});

// messages management
const roomIdInput = document.getElementById('roomIdInput');
const msgFilterName = document.getElementById('msgFilterName');
const msgFilterUid = document.getElementById('msgFilterUid');
const msgSort = document.getElementById('msgSort');
const msgLimit = document.getElementById('msgLimit');
const refreshMsgs = document.getElementById('refreshMsgs');
const deleteSelectedBtn = document.getElementById('deleteSelected');
const msgsTbody = document.getElementById('msgsTbody');
const msgsStatus = document.getElementById('msgsStatus');
const selectAllMsgs = document.getElementById('selectAllMsgs');

function messageRow({roomId, id, author, text, uid, ts}){
  const tr = document.createElement('tr');
  const timeStr = formatTs(ts);
  const snippet = (text || '').toString().slice(0, 140).replaceAll('\n',' ');
  tr.innerHTML = `
    <td><input type="checkbox" data-id="${id}" data-room="${roomId}"></td>
    <td class="muted">${timeStr}</td>
    <td>${escapeHtml(author || 'anonymous')}</td>
    <td>${escapeHtml(snippet)}</td>
    <td class="muted">${uid || ''}</td>
    <td>
      <button class="btn danger" data-act="delmsg" data-id="${id}" data-room="${roomId}">Delete</button>
    </td>
  `;
  return tr;
}

async function loadMessages(){
  if (!msgsTbody) return;
  if (!isOwner()) {
    msgsTbody.innerHTML = '';
    msgsStatus.textContent = 'Sign in as owner to view messages';
    return;
  }
  msgsTbody.innerHTML='';
  msgsStatus.textContent = 'Loading…';
  const roomId = (roomIdInput?.value || 'main').trim();
  const sort = (msgSort?.value || 'desc') === 'asc' ? 'asc' : 'desc';
  let n = parseInt(msgLimit?.value || '100', 10);
  if (!Number.isFinite(n) || n < 20) n = 100;
  const col = collection(db, 'rooms', roomId, 'messages');
  const qy = query(col, orderBy('ts', sort), limit(n));
  const snap = await getDocs(qy);
  const rows = [];
  const nameFilter = (msgFilterName?.value || '').toLowerCase();
  const uidEnd = (msgFilterUid?.value || '').trim();
  snap.forEach(docSnap => {
    const d = docSnap.data();
    let pass = true;
    if (nameFilter) pass = pass && (String(d.author || '').toLowerCase().includes(nameFilter));
    if (uidEnd) pass = pass && (String(d.uid || '').endsWith(uidEnd));
    if (pass) rows.push({ roomId, id: docSnap.id, author: d.author, text: d.text, uid: d.uid, ts: d.ts});
  });
  rows.forEach(r => msgsTbody.appendChild(messageRow(r)));
  msgsStatus.textContent = `${rows.length} messages loaded from room '${roomId}'`;
}

async function deleteMessage(roomId, id){
  if (!isOwner()) throw new Error('owner-only');
  await deleteDoc(doc(db, 'rooms', roomId, 'messages', id));
}

async function deleteSelected(){
  if (!isOwner()) return alert('Owner only');
  const checks = Array.from(msgsTbody.querySelectorAll('input[type="checkbox"][data-id]:checked'));
  if (!checks.length) return alert('No messages selected');
  if (!confirm(`Delete ${checks.length} selected messages?`)) return;
  let count = 0;
  for (const c of checks) {
    const id = c.getAttribute('data-id');
    const room = c.getAttribute('data-room');
    try { await deleteMessage(room, id); count += 1; } catch (e) { console.warn('delete failed', id, e); }
  }
  msgsStatus.textContent = `Deleted ${count} messages`;
  await loadMessages();
}

msgsTbody?.addEventListener('click', async (ev)=>{
  const btn = ev.target.closest('button[data-act="delmsg"]');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  const room = btn.getAttribute('data-room');
  if (!confirm('Delete this message?')) return;
  try { await deleteMessage(room, id); } catch (e) { alert('Delete failed: ' + (e && e.message ? e.message : e)); }
  await loadMessages();
});

selectAllMsgs?.addEventListener('change', ()=>{
  const on = !!selectAllMsgs.checked;
  msgsTbody.querySelectorAll('input[type="checkbox"][data-id]').forEach(cb => cb.checked = on);
});

refreshMsgs?.addEventListener('click', ()=> loadMessages());
[msgFilterName, msgFilterUid, msgSort, msgLimit, roomIdInput].forEach(el=>{
  el?.addEventListener('change', ()=> loadMessages());
});

deleteSelectedBtn?.addEventListener('click', ()=> deleteSelected());

// gate the admin features until owner is signed in
function updateOwnerUI(){
  const disabled = !isOwner();
  document.querySelectorAll('.btn, .admin-input').forEach(el=>{
    if (el.id === 'googleSignIn') return; // keep sign-in enabled
    el.disabled = disabled;
  });
}

onAuthStateChanged(auth, ()=>{ updateOwnerUI(); });

// initial messages load
loadMessages().catch(()=>{});
