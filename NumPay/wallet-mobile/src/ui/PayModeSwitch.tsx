import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { colors, radius, themedStyles, type as ts } from "./theme";
import { ReceiveIcon, SendIcon } from "./icons";
import { Tappable } from "./components";

export function PayModeSwitch({ mode, onSend, onReceive }: {
  mode: "send" | "receive";
  onSend: () => void;
  onReceive: () => void;
}) {
  return (
    <View style={st.track} accessibilityRole="tablist">
      <ModeButton
        label="Send"
        active={mode === "send"}
        onPress={onSend}
        icon={<SendIcon size={16} color={mode === "send" ? colors.textPrimary : colors.muted} />}
      />
      <ModeButton
        label="Receive"
        active={mode === "receive"}
        onPress={onReceive}
        icon={<ReceiveIcon size={16} color={mode === "receive" ? colors.textPrimary : colors.muted} />}
      />
    </View>
  );
}

function ModeButton({ label, active, onPress, icon }: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: ReactNode;
}) {
  return (
    <Tappable
      feedback="tile"
      borderRadius={radius.button}
      onPress={onPress}
      style={[st.item, active && st.itemActive]}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      {icon}
      <Text style={[st.label, active && st.labelActive]}>{label}</Text>
    </Tappable>
  );
}

const st = themedStyles((colors) => ({
  track: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: radius.button,
    backgroundColor: colors.surface1,
    marginBottom: 14,
  },
  item: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.input,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  itemActive: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { color: colors.muted, fontSize: ts.row, fontWeight: "600" },
  labelActive: { color: colors.textPrimary },
}));
