// Shared RN components, ported from the extension popup's design system
// (index.css component classes + AlertCard.tsx). Every mobile screen builds
// from these so the phone app keeps the extension's visual language; only
// touch sizing differs where noted.
import type { ReactNode } from "react";
import {
  Pressable, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from "react-native";
import type { SendErrorView } from "@numpay/core/sendErrors";
import { colors, radius, type as ts } from "./theme";

// ── Buttons (.btn-primary / .btn-secondary + danger tone) ────────────────────
export function Btn({
  label, onPress, variant = "primary", disabled, style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        st.btn,
        variant === "secondary" && st.btnSecondary,
        variant === "danger" && st.btnDanger,
        disabled && { opacity: 0.35 },
        pressed && !disabled && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      <Text style={[st.btnText, variant === "secondary" && { color: colors.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ── Input (.input-field) ──────────────────────────────────────────────────────
export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={[st.input, props.style]}
    />
  );
}

// ── Pill chip (.pill / .pill-brand) — chain filters, selectors ───────────────
export function Chip({
  label, active, onPress, icon,
}: { label: string; active?: boolean; onPress: () => void; icon?: ReactNode }) {
  return (
    <Pressable onPress={onPress} style={[st.pill, active && st.pillBrand]}>
      {icon}
      <Text style={[st.pillText, active && st.pillTextBrand]}>{label}</Text>
    </Pressable>
  );
}

// ── Card (.premium-card) ─────────────────────────────────────────────────────
export function Card({
  children, style,
}: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[st.card, style]}>{children}</View>;
}

// ── Section label (.section-label) ───────────────────────────────────────────
export function SectionLabel({ text, style }: { text: string; style?: StyleProp<ViewStyle> }) {
  return <Text style={[st.sectionLabel, style as object]}>{text.toUpperCase()}</Text>;
}

// ── Screen header: back chevron + title (Layout.tsx pattern, phone-sized) ────
export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <View style={st.header}>
      {onBack && (
        <Pressable onPress={onBack} style={st.iconBtn} hitSlop={8}>
          <Text style={{ color: colors.muted, fontSize: 18, marginTop: -2 }}>{"‹"}</Text>
        </Pressable>
      )}
      <Text style={st.headerTitle}>{title}</Text>
    </View>
  );
}

// ── AlertCard — RN port of components/AlertCard.tsx ──────────────────────────
// Titled hairline + icon tile, plain-language body, optional hint row,
// optional Required/Available figure tiles, optional "funds are safe" line.
export interface AlertCardProps {
  title: string;
  body: string;
  hint?: string;
  tone?: "danger" | "amber";
  figures?: { required: string; available: string; unit: string };
  safe?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AlertCard({
  title, body, hint, tone = "danger", figures, safe, style,
}: AlertCardProps) {
  const color = tone === "danger" ? colors.danger : colors.amber;
  const iconBg = tone === "danger" ? colors.dangerTint : colors.amberTint;
  return (
    <Card style={[{ overflow: "hidden" }, style]}>
      <View style={{ height: 2, backgroundColor: color, opacity: 0.55 }} />
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={[st.alertIconTile, { backgroundColor: iconBg }]}>
            <Text style={{ color, fontSize: 15, fontWeight: "700" }}>!</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color, fontSize: 13, fontWeight: "700", marginBottom: 2 }}>{title}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16 }}>{body}</Text>
          </View>
        </View>
        {figures && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <View style={st.figureTile}>
              <Text style={st.figureLabel}>REQUIRED</Text>
              <Text style={st.figureValue}>
                ~{figures.required} <Text style={st.figureUnit}>{figures.unit}</Text>
              </Text>
            </View>
            <View style={st.figureTile}>
              <Text style={st.figureLabel}>AVAILABLE</Text>
              <Text style={[st.figureValue, { color }]}>
                {figures.available} <Text style={st.figureUnit}>{figures.unit}</Text>
              </Text>
            </View>
          </View>
        )}
        {hint && (
          <View style={st.hintBox}>
            <Text style={{ color: colors.muted, fontSize: 10.5, lineHeight: 15 }}>{hint}</Text>
          </View>
        )}
        {safe && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
            <Text style={{ color: colors.success, fontSize: 11 }}>{"✓"}</Text>
            <Text style={{ color: colors.success, fontSize: 10, fontWeight: "500" }}>
              Nothing was sent. Your funds are safe.
            </Text>
          </View>
        )}
      </View>
    </Card>
  );
}

// Render a parsed SendErrorView (from @numpay/core/sendErrors).
export function SendErrorCard({ view, style }: { view: SendErrorView; style?: StyleProp<ViewStyle> }) {
  return (
    <AlertCard
      title={view.title} body={view.body} hint={view.hint}
      tone={view.tone} safe={view.safe} style={style}
    />
  );
}

const st = StyleSheet.create({
  btn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderRadius: radius.button,
    backgroundColor: colors.brand,
    marginTop: 12,
  },
  btnSecondary: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnDanger: { backgroundColor: "#5b1f2b" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: ts.body },

  input: {
    width: "100%",
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: radius.input,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: ts.body,
    marginTop: 10,
  },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  pillBrand: {
    backgroundColor: "rgba(124, 109, 240, 0.14)",
    borderColor: "rgba(124, 109, 240, 0.32)",
  },
  pillText: { color: colors.textSecondary, fontSize: 12 },
  pillTextBrand: { color: colors.brand2, fontWeight: "600" },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
  },

  sectionLabel: {
    fontSize: ts.label,
    fontWeight: "600",
    letterSpacing: 1.2,
    color: colors.muted2,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  headerTitle: { color: colors.textPrimary, fontSize: ts.h2, fontWeight: "600" },
  iconBtn: {
    width: 32, height: 32,
    borderRadius: radius.iconBtn,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },

  alertIconTile: {
    width: 36, height: 36, borderRadius: radius.tile,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  figureTile: {
    flex: 1, borderRadius: radius.tile,
    backgroundColor: colors.surface3, paddingHorizontal: 12, paddingVertical: 8,
  },
  hintBox: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.tile,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  figureLabel: { fontSize: 9, letterSpacing: 1, color: colors.muted, marginBottom: 2 },
  figureValue: { fontSize: 13, fontWeight: "700", color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  figureUnit: { fontSize: 10, color: colors.muted, fontWeight: "600" },
});
