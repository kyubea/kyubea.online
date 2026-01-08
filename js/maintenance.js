/**
 * Maintenance Mode Check
 * 
 * Checks Firestore for maintenance status and shows overlay if enabled.
 * Owners can bypass maintenance mode when signed in.
 * 
 * Usage: Add <script type="module" src="/js/maintenance.js"></script> to any page.
 * 
 * Toggle maintenance via:
 *   - Firebase Console: Firestore → config/maintenance → enabled: true/false
 *   - Admin page toggle button
 *   - Firebase CLI: firebase firestore:set config/maintenance --data '{"enabled":true,"message":"..."}'
 */

import { app } from './firebase/firebase-config.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import { getFirestore, doc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';

const auth = getAuth(app);
const db = getFirestore(app);

// Skip maintenance check on admin page so owner can always access it
const isAdminPage = window.location.pathname.includes('admin');

let overlayEl = null;
let isOwner = false;
let maintenanceConfig = null;

function createOverlay(message) {
  if (overlayEl) return;
  
  overlayEl = document.createElement('div');
  overlayEl.id = 'maintenance-overlay';
  overlayEl.innerHTML = `
    <div class="maintenance-content">
      <div class="maintenance-icon">🔧</div>
      <h1>Under Maintenance</h1>
      <p class="maintenance-message">${escapeHtml(message || 'Site is undergoing maintenance. Check back soon!')}</p>
      <div class="maintenance-hint">This won't take long!</div>
    </div>
  `;
  document.body.appendChild(overlayEl);
  document.body.classList.add('maintenance-active');
}

function removeOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
    document.body.classList.remove('maintenance-active');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function checkOwnerStatus(user) {
  if (!user) {
    isOwner = false;
    return false;
  }
  try {
    const ownerDoc = await getDoc(doc(db, 'owners', user.uid));
    isOwner = ownerDoc.exists();
    return isOwner;
  } catch (e) {
    isOwner = false;
    return false;
  }
}

function updateMaintenanceState() {
  if (!maintenanceConfig || !maintenanceConfig.enabled) {
    removeOverlay();
    return;
  }
  
  // If maintenance is enabled but owner can bypass
  if (maintenanceConfig.allowOwner && isOwner) {
    removeOverlay();
    // Show small indicator that maintenance mode is active
    showOwnerIndicator();
    return;
  }
  
  // Show maintenance overlay
  createOverlay(maintenanceConfig.message);
}

function showOwnerIndicator() {
  if (document.getElementById('maintenance-owner-badge')) return;
  
  const badge = document.createElement('div');
  badge.id = 'maintenance-owner-badge';
  badge.innerHTML = '🔧 Maintenance mode active (owner bypass)';
  badge.title = 'Other visitors see the maintenance page';
  document.body.appendChild(badge);
}

function removeOwnerIndicator() {
  const badge = document.getElementById('maintenance-owner-badge');
  if (badge) badge.remove();
}

// Initialize
if (!isAdminPage) {
  // Listen for auth state changes
  onAuthStateChanged(auth, async (user) => {
    await checkOwnerStatus(user);
    updateMaintenanceState();
  });

  // Listen for maintenance config changes (real-time updates!)
  onSnapshot(doc(db, 'config', 'maintenance'), (snap) => {
    if (snap.exists()) {
      maintenanceConfig = snap.data();
    } else {
      maintenanceConfig = { enabled: false };
    }
    updateMaintenanceState();
  }, (error) => {
    // If config doesn't exist, assume no maintenance
    console.log('Maintenance config not found, assuming disabled');
    maintenanceConfig = { enabled: false };
    updateMaintenanceState();
  });
}

// Export for admin page usage
export { checkOwnerStatus };
