import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from "react-native";
import { Colors, useColors } from "../theme";

export function Button({
  title, onPress, kind = "primary", disabled, busy,
}: { title: string; onPress: () => void; kind?: "primary" | "dark" | "ghost" | "danger"; disabled?: boolean; busy?: boolean }) {
  const c = useColors();
  const bg = kind === "primary" ? c.hivis : kind === "dark" ? c.ink : "transparent";
  const fg = kind === "primary" ? c.hivisInk : kind === "dark" ? c.bg : kind === "danger" ? c.danger : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        kind === "ghost" && { borderWidth: 1, borderColor: c.line, backgroundColor: c.surface },
        kind === "danger" && { paddingHorizontal: 8 },
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  const c = useColors();
  return (
    <View style={{ marginBottom: 12, flex: 1 }}>
      <Text style={[s.label, { color: c.ink }]}>{label}</Text>
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[s.input, { backgroundColor: c.field, borderColor: c.line, color: c.ink }, props.style]}
      />
      {hint ? <Text style={[s.hint, { color: c.muted }]}>{hint}</Text> : null}
    </View>
  );
}

export function Segmented<T extends string>({
  value, options, onChange,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <View style={[s.seg, { backgroundColor: c.field, borderColor: c.line }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[s.segBtn, on && { backgroundColor: c.ink }]}
          >
            <Text style={{ fontWeight: "600", color: on ? c.bg : c.muted }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    h1: { fontSize: 28, fontWeight: "800", color: c.ink },
    h2: { fontSize: 18, fontWeight: "700", color: c.ink },
    muted: { color: c.muted, fontSize: 14 },
    card: { backgroundColor: c.surface, borderRadius: 14, borderWidth: 1, borderColor: c.line },
    error: { color: c.danger, fontWeight: "500", marginBottom: 10 },
  });

const s = StyleSheet.create({
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  btnText: { fontSize: 18, fontWeight: "800" },
  label: { fontSize: 14, fontWeight: "600", marginBottom: 4 },
  input: { height: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  hint: { fontSize: 13, marginTop: 4 },
  seg: { flexDirection: "row", borderWidth: 1, borderRadius: 12, padding: 3, marginBottom: 14 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: "center" },
});
