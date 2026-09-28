import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, makeStyles } from "../components/ui";
import { ApiError } from "../lib/api";
import { addVehicle } from "../lib/trips";
import { useColors } from "../theme";

export default function VehicleScreen({ onDone }: { onDone: () => void }) {
  const c = useColors();
  const st = makeStyles(c);
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [engine, setEngine] = useState("");
  const [rego, setRego] = useState("");
  const [name, setName] = useState("");
  const [heavy, setHeavy] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError("");
    if (!make.trim() || !model.trim() || !engine.trim() || !rego.trim()) return setError("Fill in make, model, engine capacity and rego. The ATO needs all four.");
    setBusy(true);
    try {
      await addVehicle({ name: name.trim(), make: make.trim(), model: model.trim(), engine: engine.trim(), rego: rego.trim(), is_car: !heavy });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? "You need signal to add a car. Try again when you're back online." : e instanceof Error ? e.message : "Couldn't save the car.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={st.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={st.h1}>Add your car</Text>
          <Pressable onPress={onDone} hitSlop={12}><Text style={[st.muted, { fontWeight: "600", fontSize: 16 }]}>Cancel</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={[st.muted, { marginBottom: 14 }]}>The ATO logbook needs your car's make, model, engine capacity and rego. They're all on your rego papers.</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Field label="Make" value={make} onChangeText={setMake} placeholder="Toyota" />
            <Field label="Model" value={model} onChangeText={setModel} placeholder="Hilux SR5" />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Field label="Engine capacity" value={engine} onChangeText={setEngine} placeholder="2.8L" autoCapitalize="characters" />
            <Field label="Rego" value={rego} onChangeText={setRego} placeholder="123ABC" autoCapitalize="characters" />
          </View>
          <Field label="Nickname (optional)" value={name} onChangeText={setName} placeholder="Work ute" />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <Switch value={heavy} onValueChange={setHeavy} />
            <Text style={{ color: c.ink, flex: 1 }}>Carries 1 tonne or more, or 9 or more people</Text>
          </View>
          {error ? <Text style={st.error}>{error}</Text> : null}
          <Button title="Save car" onPress={save} busy={busy} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
