const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const MESSAGES_COLLECTION = 'rooms/{roomId}/messages';

// simple rate-limit (N messages in last T seconds)
const MAX_MSG = 6;
const WINDOW_SECONDS = 10;

exports.onMessageCreate = functions.firestore
  .document(MESSAGES_COLLECTION)
  .onCreate(async (snap, context) => {
    const msg = snap.data();
    const uid = msg.uid;
    const roomId = context.params.roomId;
    if (!uid) return;

    // get now and window start
    const now = admin.firestore.Timestamp.now();
    const windowStart = admin.firestore.Timestamp.fromMillis(now.toMillis() - WINDOW_SECONDS * 1000);

    // query messages in same room from this user in the time window
    const msgsRef = admin.firestore()
      .collection('rooms').doc(roomId)
      .collection('messages');

    const recent = await msgsRef.where('uid','==',uid)
      .where('ts','>=', windowStart).get();

    if (recent.size > MAX_MSG) {
      // delete or flag message
      await snap.ref.delete(); 
      
      await admin.firestore().collection('moderation').add({
        uid, roomId, reason: 'rate-limit', ts: now.toMillis()
      });
    } else {
    }
  });