// NumPay Background Service Worker
// Handles auto-lock timer and extension lifecycle.
//
// The authoritative lock check lives in the popup (isLocked() enforces the
// inactivity timeout on every open, even if this worker was suspended). This
// timer is defense-in-depth for the case where an extension page stays open
// and idle: when it fires we drop the decrypted session from in-memory
// session storage so no plaintext key material survives the timeout.

import { initDappRouter, broadcastDappLock } from "./dappRouter";

const AUTO_LOCK_MINUTES = 15;
const SESSION_KEY  = "numpay_session";
const ACTIVITY_KEY = "numpay_lastActivity";
const ALARM_NAME   = "numpay-autolock";

async function lockNow() {
  await chrome.storage.session.remove([SESSION_KEY, ACTIVITY_KEY]);
  // Tell connected dApps the account is gone while locked.
  broadcastDappLock();
}

// Route dApp (window.ethereum) traffic from content bridges.
initDappRouter();

// Use chrome.alarms, not setTimeout. MV3 suspends the idle service worker
// (~30s) and destroys any pending setTimeout, so the old timer never fired while
// the popup was closed, leaving the decrypted session in place past the timeout
// (CUSTODY-1). An alarm is persisted by the browser and wakes the worker to
// lock even after suspension. Re-creating the alarm with the same name resets
// the countdown on each activity ping.
function resetLockTimer() {
  chrome.alarms.create(ALARM_NAME, { delayInMinutes: AUTO_LOCK_MINUTES });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void lockNow();
});

// Popup opens a long-lived port on mount; treat that as activity.
chrome.runtime.onConnect.addListener((port) => {
  resetLockTimer();
  port.onDisconnect.addListener(() => { /* popup closed; alarm keeps running */ });
});

// Explicit activity pings from the popup. Only our own extension pages send
// these (a content script in a web page has a `sender.tab`); ignore anything
// else so a page cannot keep the wallet awake or reset the auto-lock timer.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  if (msg?.type === "ACTIVITY") {
    resetLockTimer();
    sendResponse({ ok: true });
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  // no-op
});
