import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, makeStyles } from "../components/ui";
import { ApiError, Profile, signIn as apiSignIn } from "../lib/api";
import { useColors } from "../theme";

export default function LoginScreen({ onSignedIn, notice }: { onSignedIn: (p: Profile) => void; notice?: string }) {
  const c = useColors();
  const st = makeStyles(c);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [usePassword, setUsePassword] = useState(false);

  const signIn = async () => {
    setError("");
    if (!code.trim() || !pin) return setError("Enter your staff code and PIN.");
    setBusy(true);
    try {
      onSignedIn(await apiSignIn(code, pin));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? "No signal. You need to be online to sign in." : e instanceof Error ? e.message : "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={st.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        <View style={{ marginBottom: 28 }}>
          <View style={{ width: 48, height: 8, backgroundColor: c.hivis, borderRadius: 4, marginBottom: 14 }} />
          <Text style={st.h1}>Work kms</Text>
          <Text style={[st.muted, { marginTop: 4 }]}>{notice ?? "Sign in with the staff code and PIN the office gave you."}</Text>
        </View>
        <Field label="Staff code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
        <Field
          label={usePassword ? "Password" : "PIN"}
          value={pin}
          onChangeText={setPin}
          keyboardType={usePassword ? "default" : "number-pad"}
          autoCapitalize="none"
          secureTextEntry
          onSubmitEditing={signIn}
        />
        <Pressable onPress={() => setUsePassword(!usePassword)} style={{ marginBottom: 14 }}>
          <Text style={[st.muted, { textDecorationLine: "underline" }]}>
            {usePassword ? "Use a PIN instead" : "Office admin? Use a password instead"}
          </Text>
        </Pressable>
        {error ? <Text style={st.error}>{error}</Text> : null}
        <Button title="Sign in" onPress={signIn} busy={busy} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
