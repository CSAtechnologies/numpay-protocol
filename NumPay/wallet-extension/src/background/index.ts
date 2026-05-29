// NumPay Background Service Worker
// Handles auto-lock timer and extension lifecycle.
//
// The authoritative lock check lives in the popup (isLocked() enforces the
// inactivity timeout on every open, even if this worker was suspended). This
// timer is defense-in-depth for the case where an extension page stays open
// and idle: when it fires we drop the decrypted session from in-memory
// session storage so no plaintext key material survives the timeout.

const AUTO_LOCK_MINUTES = 15;
const SESSION_KEY  = "numpay_session";
const ACTIVITY_KEY = "numpay_lastActivity";

let lockTimer: ReturnType<typeof setTimeout> | null = null;

async function lockNow() {
  await chrome.storage.session.remove([SESSION_KEY, ACTIVITY_KEY]);
}

function resetLockTimer() {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(lockNow, AUTO_LOCK_MINUTES * 60 * 1000);
}

// Popup opens a long-lived port on mount; treat that as activity.
chrome.runtime.onConnect.addListener((port) => {
  resetLockTimer();
  port.onDisconnect.addListener(() => { /* popup closed; timer keeps running */ });
});

// Explicit activity pings from the popup.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ACTIVITY") {
    resetLockTimer();
    sendResponse({ ok: true });
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  // no-op
});
