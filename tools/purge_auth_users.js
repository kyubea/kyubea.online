/*
 * tools/purge_auth_users.js
 *
 * Admin utility to delete Firebase Authentication users in bulk.
 * Supports deleting all users or only anonymous accounts.
 *
 * USAGE:
 * 1) Install dependencies (once):
 *    npm install firebase-admin
 *
 * 2) Run with service account JSON and optional flags:
 *    node tools/purge_auth_users.js --serviceAccount="./service-account.json" --projectId="your-project-id" --anonymousOnly=true --dryRun=false
 *
 * Notes:
 * - Uses Admin SDK and bypasses rules.
 * - deleteUsers can delete up to 1000 uids per call; this script paginates and batches.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

function argvFlag(name, def = null) {
  const equal = process.argv.find(a => a.startsWith(`--${name}=`));
  if (equal) return equal.split('=')[1];
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0) {
    const next = process.argv[idx + 1];
    if (next && !next.startsWith('--')) return next;
    return true; // boolean flag present
  }
  return def;
}

function toBool(v, def = false) {
  if (v === true) return true;
  if (v === false) return false;
  if (v == null) return def;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

function isAnonymousUser(userRecord) {
  // Anonymous accounts have empty providerData array
  return Array.isArray(userRecord.providerData) && userRecord.providerData.length === 0;
}

async function run() {
  const serviceAccount = argvFlag('serviceAccount') || process.env.SERVICE_ACCOUNT;
  const projectId = argvFlag('projectId') || process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT;
  const anonymousOnly = toBool(argvFlag('anonymousOnly'), false);
  const dryRun = toBool(argvFlag('dryRun'), false);
  const batchSize = parseInt(argvFlag('batch', 1000), 10);

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
  if (projectId) initOpts.projectId = projectId;
  admin.initializeApp(initOpts);

  const auth = admin.auth();
  let pageToken = undefined;
  let totalScanned = 0;
  let totalMatched = 0;
  let totalDeleted = 0;

  try {
    console.log(`Starting purge: anonymousOnly=${anonymousOnly} dryRun=${dryRun}`);
    while (true) {
      const list = await auth.listUsers(1000, pageToken);
      const users = list.users || [];
      if (users.length === 0) break;
      totalScanned += users.length;

      const matched = anonymousOnly ? users.filter(isAnonymousUser) : users;
      totalMatched += matched.length;

      if (dryRun) {
        console.log(`Would delete ${matched.length} users in this page (scanned ${users.length}).`);
      } else {
        // delete in batches of batchSize (<= 1000)
        for (let i = 0; i < matched.length; i += batchSize) {
          const slice = matched.slice(i, i + batchSize);
          const uids = slice.map(u => u.uid);
          if (uids.length === 0) continue;
          const res = await auth.deleteUsers(uids);
          totalDeleted += res.successCount || 0;
          const failures = (res.errors || []).length;
          console.log(`Deleted ${res.successCount || 0}, failures ${failures} (batch ${i / batchSize + 1}).`);
        }
      }

      pageToken = list.pageToken;
      if (!pageToken) break;
    }

    console.log(`Done. Scanned=${totalScanned} Matched=${totalMatched} Deleted=${totalDeleted}${dryRun ? ' (dry run)' : ''}.`);
  } catch (err) {
    console.error('Auth purge failed', err);
  } finally {
    process.exit(0);
  }
}

run();
