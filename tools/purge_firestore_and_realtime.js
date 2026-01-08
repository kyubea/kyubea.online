/*
 * tools/purge_firestore_and_realtime.js
 *
 * Admin utility to purge test data:
 * - deletes all docs in `usernames` collection
 * - deletes all docs in `rooms/{roomId}/messages` subcollections (for each room)
 * - removes Realtime Database node `/presence/<roomId>` (default: main)
 *
 * USAGE:
 * 1) Install dependencies (once):
 *    npm install firebase-admin
 *
 * 2) Run with service account JSON and optional args:
 *    node tools/purge_firestore_and_realtime.js --serviceAccount="./service-account.json" --projectId="your-project-id" --databaseURL="https://<your-db>.firebaseio.com" --roomId=main
 *
 * Important: this script uses the Admin SDK and will bypass security rules. Only use in dev/test projects.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function argvFlag(name) {
  const p = process.argv.findIndex(a => a === `--${name}`);
  if (p >= 0 && process.argv[p+1]) return process.argv[p+1];
  // support --name=val
  const pref = process.argv.find(a => a && a.startsWith(`--${name}=`));
  if (pref) return pref.split('=')[1];
  return null;
}

async function deleteCollection(db, collPath, batchSize = 200) {
  const collectionRef = db.collection(collPath);
  let total = 0;
  while (true) {
    const snapshot = await collectionRef.limit(batchSize).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    total += snapshot.size;
    console.log(`deleted ${snapshot.size} docs from ${collPath} (total ${total})`);
    // small delay to avoid overwhelming Firestore
    await new Promise(r => setTimeout(r, 150));
  }
  console.log(`done deleting collection ${collPath}, removed ${total} docs`);
}

async function deleteMessagesInRooms(db, batchSize = 200) {
  const roomsSnapshot = await db.collection('rooms').get();
  console.log(`found ${roomsSnapshot.size} rooms`);
  for (const roomDoc of roomsSnapshot.docs) {
    const messagesPath = `rooms/${roomDoc.id}/messages`;
    console.log(`-> deleting messages in ${messagesPath}`);
    await deleteCollection(db, messagesPath, batchSize);
  }
}

async function run() {
  const serviceAccount = argvFlag('serviceAccount') || process.env.SERVICE_ACCOUNT;
  const projectId = argvFlag('projectId') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT;
  const databaseURL = argvFlag('databaseURL') || process.env.DATABASE_URL;
  const roomId = argvFlag('roomId') || 'main';

  if (!serviceAccount) {
    console.error('Missing --serviceAccount <path> or SERVICE_ACCOUNT env var. Aborting.');
    process.exit(1);
  }
  if (!fs.existsSync(serviceAccount)) {
    console.error('Service account file not found:', serviceAccount);
    process.exit(1);
  }
  const sa = require(path.resolve(serviceAccount));

  const initOpts = { credential: admin.credential.cert(sa) };
  if (databaseURL) initOpts.databaseURL = databaseURL;
  if (projectId) initOpts.projectId = projectId;

  admin.initializeApp(initOpts);
  const firestore = admin.firestore();
  const rdb = admin.database();

  try {
    console.log('Deleting /usernames collection...');
    await deleteCollection(firestore, 'usernames');

    console.log('Deleting /users collection...');
    await deleteCollection(firestore, 'users');

    console.log('Deleting messages in all rooms (rooms/*/messages)...');
    await deleteMessagesInRooms(firestore);

    console.log(`Removing Realtime presence for room '${roomId}' at /presence/${roomId} ...`);
    try {
      await rdb.ref(`/presence/${roomId}`).remove();
      console.log('Realtime presence removed.');
    } catch (e) {
      console.warn('Realtime remove failed:', e.message || e);
    }

    console.log('Purge complete.');
  } catch (err) {
    console.error('Purge failed', err);
  } finally {
    // best-effort shutdown
    try { await firestore.terminate(); } catch(e){}
    process.exit(0);
  }
}

run();
