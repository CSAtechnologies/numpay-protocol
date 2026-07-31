/**
 * Transient messages that must not move the page.
 *
 * The old pattern put every failure into the layout: "Refresh failed" pushed
 * the whole dashboard down, and a wrong PIN grew the lock screen. Both meant
 * the content you were reading jumped under your thumb at the exact moment
 * something went wrong, which is the worst possible time for it.
 *
 * A toast is the right home for anything the user does not have to ACT on. If
 * the message needs a decision, it belongs in a Sheet; if it needs to persist
 * until fixed (an unsupported chain, a missing route), it stays an inline
 * Notice. This is only for "that didn't work, try again".
 *
 * One host, mounted once at the app root, driven through a tiny module-level
 * bus so any screen can call `toast.error(...)` without threading a prop or a
 * context provider down every tree.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, themedStyles } from "./theme";
import { noticeTone, type NoticeToneInput } from "./notice";
import { AlertIcon, CheckIcon, XIcon } from "./icons";

export interface ToastMessage {
  id: number;
  title: string;
  body?: string;
  tone: NoticeToneInput;
  /** ms on screen. Longer for anything with a body worth reading. */
  duration: number;
}

type Listener = (t: ToastMessage) => void;
let listener: Listener | null = null;
let nextId = 1;

function emit(title: string, body: string | undefined, tone: NoticeToneInput, duration?: number) {
  // No host mounted (a screen rendered in isolation, a test): drop it rather
  // than queue forever. A toast is by definition not worth replaying later.
  if (!listener) return;
  listener({
    id: nextId++,
    title,
    body,
    tone,
    duration: duration ?? (body ? 4600 : 3200),
  });
}

export const toast = {
  error: (title: string, body?: string, duration?: number) => emit(title, body, "danger", duration),
  warn:  (title: string, body?: string, duration?: number) => emit(title, body, "caution", duration),
  info:  (title: string, body?: string, duration?: number) => emit(title, body, "info", duration),
  success: (title: string, body?: string, duration?: number) => emit(title, body, "success", duration),
};

/**
 * Mount once, at the app root, ABOVE the screens and below the lock overlays:
 * a toast about a failed refresh must not float over a PIN prompt.
 */
export function ToastHost() {
  const [current, setCurrent] = useState<ToastMessage | null>(null);
  const y = useRef(new Animated.Value(-140)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    Animated.timing(y, {
      toValue: -140, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(({ finished }) => { if (finished) setCurrent(null); });
  }, [y]);

  useEffect(() => {
    listener = (t) => {
      // A newer message replaces the current one outright. Queueing would make
      // a burst of failures (one per chain in a sweep) take half a minute to
      // drain, long after the user has moved on.
      if (timer.current) clearTimeout(timer.current);
      setCurrent(t);
      y.setValue(-140);
      Animated.spring(y, {
        toValue: 0, damping: 22, stiffness: 240, mass: 0.85, useNativeDriver: true,
      }).start();
      timer.current = setTimeout(() => {
        Animated.timing(y, {
          toValue: -140, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true,
        }).start(({ finished }) => { if (finished) setCurrent(null); });
      }, t.duration);
    };
    return () => {
      listener = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [y]);

  if (!current) return null;
  const t = noticeTone(current.tone);
  const Glyph = current.tone === "success" ? CheckIcon : AlertIcon;

  return (
    <View style={st.host} pointerEvents="box-none">
      <Animated.View style={{ transform: [{ translateY: y }] }}>
        <Pressable
          onPress={hide}
          accessibilityRole="alert"
          accessibilityLabel={`${current.title}${current.body ? `. ${current.body}` : ""}`}
          style={st.toast}
        >
          <View style={[st.icon, { backgroundColor: t.tint, borderColor: t.line }]}>
            <Glyph size={14} color={t.fg} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[st.title, { color: t.fg }]} numberOfLines={1}>{current.title}</Text>
            {!!current.body && (
              <Text style={st.body} numberOfLines={2}>{current.body}</Text>
            )}
          </View>
          <View style={st.dismiss}>
            <XIcon size={13} color={colors.muted2} />
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const st = themedStyles((colors) => ({
  host: {
    position: "absolute",
    // Clears the status bar without a safe-area library, matching the fixed
    // offsets BottomNav already uses at the other end of the screen.
    top: 44,
    left: spacing.screen,
    right: spacing.screen,
    zIndex: 60,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: radius.card,
    backgroundColor: colors.sheet,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  icon: {
    width: 30, height: 30, borderRadius: 10,
    borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 13, fontWeight: "700" },
  body: { color: colors.textSecondary, fontSize: 11.5, lineHeight: 16, marginTop: 1 },
  dismiss: { paddingLeft: 2, paddingRight: 2 },
}));
