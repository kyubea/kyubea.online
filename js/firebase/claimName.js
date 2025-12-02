// js/firebase/claimName.js
// usage: await claimDisplayName(db, auth, 'DesiredName');

import { doc, runTransaction, serverTimestamp, setDoc, deleteDoc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

export async function claimDisplayName(db, auth, displayName) {
  if (!auth.currentUser) throw new Error('not-authenticated');
  const uid = auth.currentUser.uid;

  const nameKey = displayName.trim().toLowerCase();
  if (!nameKey) throw new Error('invalid-name');

  // disallow reserved generic anonymous names
  const RESERVED = new Set(['anon', 'anonymous']);
  if (RESERVED.has(nameKey)) {
    throw new Error('reserved-name');
  }

  const usernameRef = doc(db, 'usernames', nameKey);
  const userRef = doc(db, 'users', uid);

  // how long anonymous reservations last (ms); change as desired
  const NAME_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
  try {
    // read existing user doc to determine if this is a create or update
    let oldNameKey = null;
    try {
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const data = userSnap.data();
        oldNameKey = data && data.nameKey ? data.nameKey : null;
      }
    } catch (e) {
      // ignore read errors; attempt reservation and let the subsequent write fail with a clear error
    }

    // if the user already owns this nameKey, it's a no-op — return success immediately
    if (oldNameKey && oldNameKey === nameKey) {
      return { ok: true };
    }

    // step 1: atomically reserve the username key (fail if it exists)
    await runTransaction(db, async (tx) => {
      const unameSnap = await tx.get(usernameRef);
      if (unameSnap.exists()) {
        throw new Error('name-taken');
      }
      tx.set(usernameRef, {
        uid,
        displayName,
        createdAt: serverTimestamp(),
        // expiresAt is set client-side; firestore ttl can be enabled on this field
        expiresAt: new Date(Date.now() + NAME_TTL_MS)
      });
    });

    // step 2: either create or update the user profile referencing the reserved nameKey;
    // if the user already exists, perform an update (only name/nameKey) so rules for updates apply
    if (oldNameKey) {
      await updateDoc(userRef, {
        name: displayName,
        nameKey: nameKey
      });
    } else {
      // creating new user document
      await setDoc(userRef, {
        name: displayName,
        nameKey: nameKey,
        createdAt: serverTimestamp()
      });
    }

    // step 3: if there was a previous name reservation for this user, remove it
    // (so the old name becomes available); ignore errors here
    if (oldNameKey && oldNameKey !== nameKey) {
      try { await deleteDoc(doc(db, 'usernames', oldNameKey)); } catch (e) {}
    }

    return { ok: true };
  } catch (err) {
    // if the user profile write failed after we reserved the username, attempt cleanup
    try {
      await deleteDoc(usernameRef);
    } catch (cleanupErr) {
      // cleanup may be disallowed by rules; warn and continue to return the original error
      try {
        const snap = await getDoc(usernameRef);
        console.warn('[claimDisplayName] failed to cleanup reservation; username doc:', snap.exists() ? snap.data() : null, cleanupErr);
      } catch (readErr) {
        console.warn('[claimDisplayName] failed to cleanup reservation; also failed to read username', readErr, cleanupErr);
      }
      console.warn('claimDisplayName: failed to cleanup reservation', cleanupErr);
    }
    // normalize error with code when available so client can react programmatically
    const out = { ok: false, error: (err && err.message) ? err.message : String(err), code: (err && err.code) ? err.code : (err && err.message) ? err.message : String(err) };
    return out;
  }
}

// and ur done !! wow ..