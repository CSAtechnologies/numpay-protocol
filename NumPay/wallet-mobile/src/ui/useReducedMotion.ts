import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Stay still until the OS preference arrives, and follow changes while open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let live = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      changed = true;
      if (live) setReduced(value);
    });
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live && !changed) setReduced(value);
    }).catch(() => { /* Keep a static control if the preference is unavailable. */ });
    return () => { live = false; subscription.remove(); };
  }, []);
  return reduced;
}
