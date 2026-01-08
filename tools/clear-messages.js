/*
 * Clear all messages from the chat
 * Usage: node tools/clear-messages.js
 */

const admin = require('firebase-admin');
const serviceAccount = require('../service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://bunbea-baf6e-default-rtdb.firebaseio.com"
});

const db = admin.firestore();

async function clearMessages() {
  console.log('Clearing all messages from rooms/main/messages...');
  
  const messagesRef = db.collection('rooms').doc('main').collection('messages');
  
  let deletedCount = 0;
  let hasMore = true;
  
  while (hasMore) {
    const snapshot = await messagesRef.limit(500).get();
    
    if (snapshot.empty) {
      hasMore = false;
      break;
    }
    
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
      deletedCount++;
    });
    
    await batch.commit();
    console.log(`Deleted ${snapshot.size} messages (total: ${deletedCount})`);
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`✅ Done! Deleted ${deletedCount} total messages`);
  process.exit(0);
}

clearMessages().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
