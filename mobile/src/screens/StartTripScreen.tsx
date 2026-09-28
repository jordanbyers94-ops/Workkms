import React, { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, makeStyles } from "../components/ui";
import { Vehicle } from "../lib/api";
import { PermissionError, startTracking } from "../lib/tracking";
import { getVehicles, lastOdometer } from "../lib/trips";
import { useColors } from "../theme";
import { VehiclePicker } from "./TripFormScreen";

type Props = { uid: string; onStarted: () => void; onCancel: () => void; onAddCar: () => void };

export default function StartTripScreen({ uid, onStarted, onCancel, onAddCar }: Props) {
  const c = useColors();
  const st = makeStyles(c);
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [startOdo, setStartOdo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getVehicles().then((v) => { setVehicles(v); if (v[0]) setVehicleId(v[0].id); });
  }, []);
  useEffect(() => {
    const v = vehicles?.find((x) => x.id === vehicleId);
    lastOdometer(uid, v).then((o) => setStartOdo(o != null ? String(o) : ""));
  }, [vehicleId, vehicles, uid]);

  const start = async () => {
    setError("");
    const odo = Number(startOdo.replace(/[,\s]/g, ""));
    if (!vehicleId) return setError("Choose your car.");
    if (!startOdo.trim() || !Number.isFinite(odo) || odo <= 0) return setError("Enter the odometer reading now, before you drive off.");
    setBusy(true);
    try {
      await startTracking({ vehicle_id: vehicleId, start_odo: odo });
      onStarted();
    } catch (e) {
      Alert.alert("Can't start GPS", e instanceof PermissionError ? e.message : "Something went wrong starting GPS. Try again, or log the trip by odometer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={st.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={st.h1}>Start GPS trip</Text>
          <Pressable onPress={onCancel} hitSlop={12}><Text style={[st.muted, { fontWeight: "600", fontSize: 16 }]}>Cancel</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          {vehicles && !vehicles.length ? (
            <>
              <Text style={[st.muted, { marginBottom: 14 }]}>Add your car first. Every trip in the logbook needs to say which car it was in.</Text>
              <Button title="Add your car" onPress={onAddCar} />
            </>
          ) : (
            <>
              <VehiclePicker vehicles={vehicles ?? []} value={vehicleId} onChange={setVehicleId} onAddCar={onAddCar} />
              <Field
                label="Odometer now"
                value={startOdo}
                onChangeText={setStartOdo}
                keyboardType="decimal-pad"
                hint="Check the dash and correct it if it's different. The ATO logbook needs the start reading for every trip."
              />
              {error ? <Text style={st.error}>{error}</Text> : null}
              <Button title="Start tracking" onPress={start} busy={busy} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
