/**
 * Maintenance Mode - Blocks content rendering until check passes
 * 
 * This script prevents page content from being created during maintenance.
 * Content scripts should wait for window.maintenanceCheckComplete before rendering.
 */

import { app } from './firebase/firebase-config.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import { getFirestore, doc, getDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';

const auth = getAuth(app);
const db = getFirestore(app);

const isAdminPage = window.location.pathname.includes('admin');

// Block content rendering by default (will be resolved after check)
let resolveMaintenanceCheck;
window.maintenanceCheckComplete = new Promise(resolve => {
  resolveMaintenanceCheck = resolve;
});

// Track state
let overlayEl = null;
let isOwner = false;
let maintenanceConfig = null;
let authResolved = false;
let configResolved = false;

function createOverlay(message) {
  if (overlayEl) return;
  
  overlayEl = document.createElement('div');
  overlayEl.id = 'maintenance-overlay';
  overlayEl.innerHTML = `
    <div class="maintenance-content">
      <div class="maintenance-header">Maintenance</div>
      <div class="maintenance-body">
        <div class="maintenance-icon">^_^</div>
        <h1>Be Right Back!</h1>
        <p class="maintenance-message">${escapeHtml(message || 'Site is undergoing maintenance. Check back soon!')}</p>
        <div class="maintenance-hint">This won't take long!</div>
      </div>
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
  removeOwnerIndicator();
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

function updateMaintenanceState() {
  // Wait until both auth and config are resolved
  if (!authResolved || !configResolved) return;
  
  // If maintenance is disabled, allow content
  if (!maintenanceConfig || !maintenanceConfig.enabled) {
    removeOverlay();
    resolveMaintenanceCheck(true); // Allow content to render
    return;
  }
  
  // If maintenance is enabled but owner can bypass
  if (maintenanceConfig.allowOwner && isOwner) {
    removeOverlay();
    showOwnerIndicator();
    resolveMaintenanceCheck(true); // Allow content to render
    return;
  }
  
  // Maintenance is active and user cannot bypass
  // Show overlay and DO NOT resolve the promise (content stays blocked)
  createOverlay(maintenanceConfig.message);
  // Don't call resolveMaintenanceCheck - content should not render
}

// Initialize
if (!isAdminPage) {
  // Listen for auth state changes
  onAuthStateChanged(auth, async (user) => {
    await checkOwnerStatus(user);
    authResolved = true;
    updateMaintenanceState();
  });

  // Listen for maintenance config
  onSnapshot(doc(db, 'config', 'maintenance'), (snap) => {
    if (snap.exists()) {
      maintenanceConfig = snap.data();
    } else {
      maintenanceConfig = { enabled: false };
    }
    configResolved = true;
    updateMaintenanceState();
  }, (error) => {
    console.log('Maintenance config not found, assuming disabled');
    maintenanceConfig = { enabled: false };
    configResolved = true;
    updateMaintenanceState();
  });
} else {
  // Admin page always allowed
  resolveMaintenanceCheck(true);
}

export { checkOwnerStatus };
