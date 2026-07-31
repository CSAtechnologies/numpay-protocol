/**
 * Bottom sheet: the ONE place a modal surface appears in the app.
 *
 * Before this, every interruption picked its own treatment. "Confirm it's you"
 * and "Session expired" were AlertCards stacked into the page flow, so they
 * shoved the layout around and read as page content rather than as something
 * asking for an answer. Swap's confirm was a hand-rolled centred Modal with its
 * own scrim, radius and button row. Nothing agreed with anything.
 *
 * Now: one shell, one motion, one dismissal contract. Anything that interrupts
 * the user goes through Sheet, so the app has a single vocabulary for "this is
 * on top of what you were doing".
 *
 * Motion is deliberately a spring rather than a timing curve — a sheet that
 * decelerates into place reads as a physical surface, and it is the single
 * cheapest thing that separates a modern wallet from a web form in a WebView.
 * Reduced-motion is honoured by dropping to a short fade.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo, Animated, BackHandler, Dimensions, Easing, Modal,
  PanResponder, Pressable, ScrollView, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from "react-native";
import { colors, radius, SHEET_BOTTOM_INSET, spacing, type as ts, themedStyles } from "./theme";
import { noticeTone, type NoticeTone } from "./notice";

const SCREEN_H = Dimensions.get("window").height;
// Far enough that the sheet is fully offscreen before it springs, whatever it
// ends up measuring. Measuring first would cost a frame and show a flash.
const HIDDEN_Y = SCREEN_H;
// Past this, releasing completes the dismissal instead of snapping back. Low
// enough that a decisive flick works, high enough that a scroll that starts
// with a stray downward drag does not close the sheet by accident.
const DISMISS_TRAVEL = 110;
const DISMISS_VELOCITY = 0.6;

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
  /** Bold line at the top of the content. Omit for a fully custom sheet. */
  title?: string;
  /** One or two lines under the title. */
  body?: string;
  /** Tinted icon tile above the title. Pair with `tone` for its colour. */
  icon?: ReactNode;
  tone?: NoticeTone;
  /**
   * Whether the backdrop, the swipe and the hardware back may close this.
   * False for a sheet that must be answered (a signing prompt), which then has
   * to supply its own explicit way out.
   */
  dismissable?: boolean;
  /** Cap the sheet's height and scroll inside it. Default 0.86 of the screen. */
  maxHeightRatio?: number;
  contentStyle?: StyleProp<ViewStyle>;
}

export function Sheet({
  open, onClose, children, title, body, icon, tone = "info",
  dismissable = true, maxHeightRatio = 0.86, contentStyle,
}: SheetProps) {
  // `mounted` outlives `open` so the close animation gets to run before the
  // Modal is torn down; without it a dismissal just blinks out.
  const [mounted, setMounted] = useState(open);
  const y = useRef(new Animated.Value(HIDDEN_Y)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { reduceMotion.current = on; })
      .catch(() => {});
  }, []);

  const animateOut = useCallback((after: () => void) => {
    Animated.parallel([
      Animated.timing(y, {
        toValue: HIDDEN_Y, duration: reduceMotion.current ? 120 : 200,
        easing: Easing.in(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 0, duration: reduceMotion.current ? 120 : 180, useNativeDriver: true,
      }),
    ]).start(({ finished }) => { if (finished) after(); });
  }, [fade, y]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      y.setValue(HIDDEN_Y);
      fade.setValue(0);
      Animated.parallel([
        reduceMotion.current
          ? Animated.timing(y, { toValue: 0, duration: 120, useNativeDriver: true })
          : Animated.spring(y, {
              toValue: 0,
              // Tuned by hand: enough damping that it settles without a visible
              // bounce (a bouncy wallet sheet reads as a toy), enough tension
              // that it still feels thrown rather than eased.
              damping: 26, stiffness: 260, mass: 0.9,
              overshootClamping: false, useNativeDriver: true,
            }),
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      animateOut(() => setMounted(false));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Android hardware back closes the top-most sheet rather than the screen
  // behind it. Modal's onRequestClose covers this too, but only on Android and
  // only when the Modal itself has focus; this keeps the behaviour explicit.
  useEffect(() => {
    if (!mounted || !dismissable) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [mounted, dismissable, onClose]);

  // Swipe-to-dismiss on the handle area. Only downward drags are tracked, so a
  // sheet whose body scrolls is not fighting its own gesture.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => dismissable && g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => { if (g.dy > 0) y.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > DISMISS_TRAVEL || g.vy > DISMISS_VELOCITY) { onClose(); return; }
        Animated.spring(y, {
          toValue: 0, damping: 26, stiffness: 260, mass: 0.9, useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  if (!mounted) return null;
  const t = noticeTone(tone);

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => { if (dismissable) onClose(); }}
    >
      <View style={st.root}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
            onPress={() => { if (dismissable) onClose(); }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>

        <Animated.View
          style={[
            st.sheet,
            { maxHeight: SCREEN_H * maxHeightRatio, transform: [{ translateY: y }] },
          ]}
        >
          <View {...pan.panHandlers} style={st.handleZone}>
            <View style={st.handle} />
          </View>

          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[st.content, contentStyle]}
          >
            {icon && (
              <View style={[st.iconTile, { backgroundColor: t.tint, borderColor: t.line }]}>
                {icon}
              </View>
            )}
            {!!title && <Text style={st.title}>{title}</Text>}
            {!!body && <Text style={st.body}>{body}</Text>}
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * The common shape: a question, a destructive-or-not answer, and a way out.
 * Exists so "are you sure" prompts cannot drift apart across screens.
 */
export function ConfirmSheet({
  open, onClose, onConfirm, title, body, confirmLabel = "Confirm",
  cancelLabel = "Cancel", tone = "caution", icon, busy, children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: NoticeTone;
  icon?: ReactNode;
  busy?: boolean;
  /** Detail rows between the body and the actions. */
  children?: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} body={body} icon={icon} tone={tone}>
      {children}
      <SheetActions
        onCancel={onClose}
        onConfirm={onConfirm}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        danger={tone === "danger"}
        busy={busy}
      />
    </Sheet>
  );
}

/**
 * Stacked actions: primary on top, cancel below it as a ghost.
 *
 * Stacked rather than side-by-side on purpose. A phone-width row puts a
 * destructive confirm within a thumb-slip of cancel, and the two read as equals
 * when they are not. Full-width targets are also simply easier to hit.
 */
export function SheetActions({
  onConfirm, onCancel, confirmLabel, cancelLabel = "Cancel", danger, busy, disabled,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={st.actions}>
      <Pressable
        onPress={onConfirm}
        disabled={busy || disabled}
        accessibilityRole="button"
        style={({ pressed }) => [
          st.primary,
          danger && { backgroundColor: colors.dangerBtn },
          (busy || disabled) && { opacity: 0.45 },
          pressed && !(busy || disabled) && { transform: [{ scale: 0.985 }] },
        ]}
      >
        <Text style={st.primaryText}>{busy ? "Working…" : confirmLabel}</Text>
      </Pressable>
      <Pressable
        onPress={onCancel}
        disabled={busy}
        accessibilityRole="button"
        style={({ pressed }) => [st.ghost, pressed && { backgroundColor: colors.surface2 }]}
      >
        <Text style={st.ghostText}>{cancelLabel}</Text>
      </Pressable>
    </View>
  );
}

/** Label/value line for sheets that preview a transaction before it is signed. */
export function SheetRow({ label, value, strong }: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={st.row}>
      <Text style={st.rowLabel}>{label}</Text>
      <Text style={[st.rowValue, strong && { color: colors.textPrimary, fontWeight: "700" }]}>
        {value}
      </Text>
    </View>
  );
}

/** Grouped container for SheetRows: one inset panel instead of loose lines. */
export function SheetPanel({ children, style }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[st.panel, style]}>{children}</View>;
}

const st = themedStyles((colors) => ({
  root: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.sheet,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    // Upward shadow: the sheet is lit from the page it covers.
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -8 },
    elevation: 24,
  },
  handleZone: { paddingTop: 10, paddingBottom: 6, alignItems: "center" },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.sheetHandle,
  },
  content: {
    paddingHorizontal: spacing.screen,
    paddingTop: 6,
    paddingBottom: SHEET_BOTTOM_INSET,
  },

  iconTile: {
    width: 46, height: 46, borderRadius: 15,
    borderWidth: 1,
    alignItems: "center", justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  body: {
    color: colors.textSecondary,
    fontSize: ts.body,
    lineHeight: 20,
    marginTop: 6,
  },

  actions: { marginTop: 20, gap: 8 },
  primary: {
    width: "100%",
    paddingVertical: 15,
    borderRadius: radius.button,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  primaryText: { color: colors.onBrand, fontSize: 15, fontWeight: "600" },
  ghost: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: radius.button,
    alignItems: "center", justifyContent: "center",
  },
  ghostText: { color: colors.muted, fontSize: 14, fontWeight: "600" },

  panel: {
    marginTop: 16,
    borderRadius: radius.tile,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 10,
  },
  rowLabel: { color: colors.muted, fontSize: 12.5, flexShrink: 0 },
  rowValue: {
    color: colors.textSecondary,
    fontSize: 12.5,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "right",
  },
}));
