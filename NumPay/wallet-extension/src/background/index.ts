// NumPay Background Service Worker
// Handles auto-lock timer and extension lifecycle

const AUTO_LOCK_MINUTES = 15;
let lockTimer: ReturnType<typeof setTimeout> | null = null;

function resetLockTimer() {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(async () => {
    await chrome.storage.local.set({ numpay_locked: "true" });
  }, AUTO_LOCK_MINUTES * 60 * 1000);
}

// Reset timer when popup opens
chrome.runtime.onConnect.addListener(() => {
  resetLockTimer();
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "ACTIVITY") {
    resetLockTimer();
    sendResponse({ ok: true });
  }
});

// Initial setup
chrome.runtime.onInstalled.addListener(() => {
  console.log("NumPay wallet installed");
});
