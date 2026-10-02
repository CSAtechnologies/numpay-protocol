// OS-scheduled background task wiring for the receive watcher. Imported for
// its side effect (defineTask MUST run at bundle-load time so the headless
// launch finds the task) from App.tsx; ensureReceiveWatch() is then called
// once the wallet is unlocked.
//
// Delivery expectations: Android schedules background fetch loosely — ~15
// minutes is the floor and Doze can defer it. Foreground sync is near-live;
// this task covers closed-app native and token deposits on a best-effort basis.

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";
import { runReceiveCheck } from "./receiveWatch";

const RECEIVE_TASK = "numpay-receive-watch";

TaskManager.defineTask(RECEIVE_TASK, async () => {
  const notified = await runReceiveCheck(); // never throws
  return notified
    ? BackgroundFetch.BackgroundFetchResult.NewData
    : BackgroundFetch.BackgroundFetchResult.NoData;
});

/**
 * Ask for notification permission (Android 13+ prompts; older grants
 * silently) and register the background task. Idempotent; safe to call on
 * every unlock. Returns false when the OS refuses (permission denied or
 * background fetch restricted) — the app keeps working, just without the
 * closed-app "you got paid".
 */
export async function ensureReceiveWatch(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Received funds",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) {
      perm = await Notifications.requestPermissionsAsync();
    }
    if (!perm.granted) return false;

    const status = await BackgroundFetch.getStatusAsync();
    if (status !== BackgroundFetch.BackgroundFetchStatus.Available) return false;

    if (!(await TaskManager.isTaskRegisteredAsync(RECEIVE_TASK))) {
      await BackgroundFetch.registerTaskAsync(RECEIVE_TASK, {
        minimumInterval: 15 * 60, // seconds; the practical Android floor
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
    return true;
  } catch {
    return false;
  }
}
