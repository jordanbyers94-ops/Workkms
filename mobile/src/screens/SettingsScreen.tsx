import React, { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, makeStyles } from "../components/ui";
import { ApiError, Vehicle } from "../lib/api";
import { disableAuto, enableAuto, getAutoSettings, setAutoVehicle } from "../lib/auto";
import { carPlayBuiltIn } from "../lib/carplay";
import { fmtKm } from "../lib/dates";
import { PermissionError } from "../lib/tracking";
import { getVehicles, lastOdometer, saveOdoCheck } from "../lib/trips";
import { useColors } from "../theme";
import { VehiclePicker } from "./TripFormScreen";

type Props = { uid: string; onDone: () => void; onAddCar: () => void };

export default function SettingsScreen({ uid, onDone, onAddCar }: Props) {
  const c = useColors();
  const st = makeStyles(c);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [auto, setAuto] = useState(false);
  const [autoCar, setAutoCar] = useState<string | null>(null);
  const [checkCar, setCheckCar] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [odo, setOdo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);

  useEffect(() => {
    (async () => {
      const v = await getVehicles();
      setVehicles(v);
      const s = await getAutoSettings();
      setAuto(s.enabled);
      const car = s.vehicle_id ?? v[0]?.id ?? null;
      setAutoCar(car);
      setCheckCar(car);
    })();
  }, []);

  useEffect(() => {
    lastOdometer(uid, vehicles.find((v) => v.id === checkCar)).then(setEstimate);
  }, [uid, checkCar, vehicles]);

  const toggleAuto = async (on: boolean) => {
    setMsg(null);
    if (on && !vehicles.length) return setMsg({ text: "Add your car first. Detected drives need a car to go against.", err: true });
    try {
      if (on) await enableAuto(autoCar);
      else await disableAuto();
      setAuto(on);
    } catch (e) {
      if (e instanceof PermissionError) Alert.alert("Location needed", e.message);
      else setMsg({ text: "Couldn't change the setting. Try again.", err: true });
    }
  };

  const saveCheck = async () => {
    setMsg(null);
    const n = Number(odo.replace(/[,\s]/g, ""));
    if (!checkCar) return setMsg({ text: "Choose the car.", err: true });
    if (!odo.trim() || !Number.isFinite(n) || n <= 0) return setMsg({ text: "Enter the reading from the dash.", err: true });
    setBusy(true);
    try {
      await saveOdoCheck(uid, checkCar, n);
      const diff = estimate != null ? Math.round((n - estimate) * 10) / 10 : null;
      setMsg({
        text: diff == null || Math.abs(diff) < 1 ? "Saved." : `Saved. That's ${fmtKm(Math.abs(diff))} km ${diff > 0 ? "more" : "less"} than the app's estimate. Trips from now on start from this reading.`,
        err: false,
      });
      setOdo("");
      setEstimate(n);
    } catch (e) {
      setMsg({ text: e instanceof ApiError && e.status === 0 ? "You need signal to save an odometer check." : e instanceof Error ? e.message : "Couldn't save.", err: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={st.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={st.h1}>Settings</Text>
          <Pressable onPress={onDone} hitSlop={12}><Text style={[st.muted, { fontWeight: "600", fontSize: 16 }]}>Done</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={[st.card, { padding: 16, marginBottom: 18 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Text style={[st.h2, { flex: 1 }]}>Detect drives automatically</Text>
              <Switch value={auto} onValueChange={toggleAuto} />
            </View>
            <Text style={[st.muted, { marginTop: 8 }]}>
              When you drive off, the app starts measuring by itself. When you've been parked for 5 minutes it stops, and the drive waits under
              Trips to sort until you mark it Business or Private. Drives you haven't sorted stay on your phone. Nothing is sent to the office
              until you sort it, and private trips never include locations.
            </Text>
            <Text style={[st.muted, { marginTop: 8 }]}>
              Needs location set to Always (iPhone) or Allow all the time (Android). The first few hundred metres of each drive are counted
              as a straight line, so short trips can read a little low.
            </Text>
            {vehicles.length ? (
              <View style={{ marginTop: 12 }}>
                <VehiclePicker
                  vehicles={vehicles}
                  value={autoCar}
                  onChange={(id) => { setAutoCar(id); setAutoVehicle(id); }}
                  onAddCar={onAddCar}
                />
              </View>
            ) : (
              <View style={{ marginTop: 12 }}><Button title="Add your car" kind="ghost" onPress={onAddCar} /></View>
            )}
          </View>

          <View style={[st.card, { padding: 16, marginBottom: 18 }]}>
            <Text style={st.h2}>Odometer check</Text>
            <Text style={[st.muted, { marginTop: 6, marginBottom: 12 }]}>
              Detected drives work out odometer readings from GPS. Enter the real reading off the dash about once a week so your logbook
              stays accurate. It's saved to your logbook.
            </Text>
            {vehicles.length ? <VehiclePicker vehicles={vehicles} value={checkCar} onChange={setCheckCar} onAddCar={onAddCar} /> : null}
            <Field
              label="Reading on the dash now"
              value={odo}
              onChangeText={setOdo}
              keyboardType="decimal-pad"
              hint={estimate != null ? `The app's estimate is ${fmtKm(estimate)} km.` : undefined}
            />
            <Button title="Save odometer check" onPress={saveCheck} busy={busy} />
          </View>

          {Platform.OS === "ios" ? (
            <View style={[st.card, { padding: 16, marginBottom: 18 }]}>
              <Text style={st.h2}>CarPlay</Text>
              <Text style={[st.muted, { marginTop: 6 }]}>
                {carPlayBuiltIn
                  ? "Work kms shows on your car's CarPlay screen. With drive detection on, plugging into CarPlay starts a trip and unplugging ends it. You can start and finish trips there and mark drives Private, or Business to finish on your phone."
                  : "This version of the app doesn't include CarPlay yet."}
              </Text>
            </View>
          ) : null}

          {msg ? <Text style={msg.err ? st.error : [st.muted, { color: c.ink }]}>{msg.text}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
