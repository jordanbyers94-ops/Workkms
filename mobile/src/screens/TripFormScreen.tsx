import React, { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field, makeStyles, Segmented } from "../components/ui";
import { fmtKm, isValidISO, round1, todayISO } from "../lib/dates";
import { Vehicle } from "../lib/api";
import { discardTracking, Tracking } from "../lib/tracking";
import { deleteTrip, getVehicles, lastOdometer, listTrips, newTripId, saveTrip, Trip } from "../lib/trips";
import { useColors } from "../theme";

type Props = {
  uid: string;
  kind: "new" | "edit" | "gps";
  trip?: Trip;
  tracking?: Tracking;
  onDone: () => void;
};

const num = (v: string) => {
  const s = v.replace(/[,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const str = (n: number | null | undefined) => (n == null ? "" : String(n));

export default function TripFormScreen({ uid, kind, trip, tracking, onDone }: Props) {
  const c = useColors();
  const st = makeStyles(c);
  const gpsKm = tracking ? round1(tracking.meters / 1000) : trip?.gps_km ?? null;

  const [mode, setMode] = useState<"odometer" | "manual">(trip?.source === "manual" ? "manual" : "odometer");
  const [date, setDate] = useState(trip?.trip_date ?? (tracking ? todayISO(new Date(tracking.startedAt)) : todayISO()));
  const [startOdo, setStartOdo] = useState(str(trip?.start_odo));
  const [endOdo, setEndOdo] = useState(str(trip?.end_odo));
  const [km, setKm] = useState(trip ? str(trip.km) : gpsKm != null ? String(gpsKm) : "");
  const [jobNo, setJobNo] = useState(trip?.job_no ?? "");
  const [purpose, setPurpose] = useState(trip?.purpose ?? "");
  const [from, setFrom] = useState(trip?.from_text ?? "");
  const [to, setTo] = useState(trip?.to_text ?? "");
  const [vehicleId, setVehicleId] = useState<string | null>(trip?.vehicle_id ?? null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const isGps = kind === "gps" || trip?.source === "gps";

  useEffect(() => {
    getVehicles().then(setVehicles);
    if (kind === "new") lastOdometer(uid).then((v) => { if (v != null) setStartOdo(String(v)); });
    if (kind !== "edit") {
      // Default to the vehicle used on the last trip
      listTrips(uid).then((l) => { const v = l.find((t) => t.vehicle_id)?.vehicle_id; if (v) setVehicleId((cur) => cur ?? v); });
    }
  }, [kind, uid]);

  const s = num(startOdo), e = num(endOdo);
  const odoKm = s != null && e != null && e > s ? round1(e - s) : null;

  const save = async () => {
    setError("");
    if (!isValidISO(date)) return setError("Enter the date as YYYY-MM-DD, for example " + todayISO() + ".");
    if (date > todayISO()) return setError("The date can't be in the future.");
    if (!jobNo.trim() && !purpose.trim()) return setError("Add a job number or purpose so the office knows what the trip was for.");

    let tripKm: number;
    let start_odo: number | null = null, end_odo: number | null = null;
    let source = trip?.source ?? (kind === "gps" ? "gps" : mode);

    if (isGps) {
      const k = num(km);
      if (k == null || k <= 0) return setError("Enter the distance in km.");
      tripKm = round1(k);
    } else if (mode === "odometer") {
      if (s == null || e == null) return setError("Enter both odometer readings.");
      if (e <= s) return setError("The end reading needs to be higher than the start reading.");
      tripKm = round1(e - s); start_odo = s; end_odo = e; source = "odometer";
    } else {
      const k = num(km);
      if (k == null || k <= 0) return setError("Enter the distance in km.");
      tripKm = round1(k); source = "manual";
    }
    if (tripKm >= 3000) return setError("That's over 3,000 km. Check the distance.");

    const row: Trip = {
      id: trip?.id ?? newTripId(),
      user_id: uid,
      vehicle_id: vehicleId,
      trip_date: date,
      started_at: trip?.started_at ?? (tracking ? new Date(tracking.startedAt).toISOString() : null),
      ended_at: trip?.ended_at ?? (tracking?.endedAt ? new Date(tracking.endedAt).toISOString() : null),
      km: tripKm,
      start_odo, end_odo,
      source,
      gps_km: trip?.gps_km ?? (kind === "gps" ? gpsKm : null),
      from_text: from.trim() || null,
      to_text: to.trim() || null,
      job_no: jobNo.trim() || null,
      purpose: purpose.trim() || null,
      start_lat: trip?.start_lat ?? tracking?.start?.lat ?? null,
      start_lng: trip?.start_lng ?? tracking?.start?.lng ?? null,
      end_lat: trip?.end_lat ?? tracking?.end?.lat ?? null,
      end_lng: trip?.end_lng ?? tracking?.end?.lng ?? null,
      deleted: false,
    };
    setBusy(true);
    try {
      await saveTrip(uid, row);
      if (kind === "gps") await discardTracking();
      onDone();
    } catch {
      setError("Couldn't save the trip on this phone. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert("Delete this trip?", "It will be removed from your logbook. The office keeps a record of deleted trips.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => { if (trip) await deleteTrip(uid, trip); onDone(); } },
    ]);

  const title = kind === "edit" ? "Edit trip" : kind === "gps" ? "Save GPS trip" : "Log a trip";

  return (
    <SafeAreaView style={st.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={st.h1}>{title}</Text>
          <Pressable onPress={onDone} hitSlop={12}><Text style={[st.muted, { fontWeight: "600", fontSize: 16 }]}>Cancel</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {!isGps ? (
            <Segmented value={mode} onChange={setMode} options={[{ value: "odometer", label: "Odometer" }, { value: "manual", label: "Distance" }]} />
          ) : null}

          <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />

          {isGps ? (
            <Field
              label="Distance (km)"
              value={km}
              onChangeText={setKm}
              keyboardType="decimal-pad"
              hint={gpsKm != null ? `GPS measured ${fmtKm(gpsKm)} km. If you change it, the office still sees the GPS figure.` : undefined}
            />
          ) : mode === "odometer" ? (
            <>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Field label="Start odometer" value={startOdo} onChangeText={setStartOdo} keyboardType="decimal-pad" />
                <Field label="End odometer" value={endOdo} onChangeText={setEndOdo} keyboardType="decimal-pad" />
              </View>
              <Text style={{ fontSize: 22, fontWeight: "700", color: c.ink, marginBottom: 12, minHeight: 28 }}>
                {odoKm != null ? `${fmtKm(odoKm)} km` : ""}
              </Text>
            </>
          ) : (
            <Field label="Distance (km)" value={km} onChangeText={setKm} keyboardType="decimal-pad" />
          )}

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Field label="Job number" value={jobNo} onChangeText={setJobNo} autoCapitalize="characters" />
            <View style={{ flex: 2 }}>
              <Field label="Purpose" value={purpose} onChangeText={setPurpose} placeholder="e.g. Switchboard upgrade" />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Field label="From" value={from} onChangeText={setFrom} />
            <Field label="To" value={to} onChangeText={setTo} />
          </View>

          {vehicles.length ? (
            <View style={{ marginBottom: 14 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: c.ink, marginBottom: 6 }}>Vehicle</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {vehicles.map((v) => {
                  const on = v.id === vehicleId;
                  return (
                    <Pressable
                      key={v.id}
                      onPress={() => setVehicleId(on ? null : v.id)}
                      accessibilityState={{ selected: on }}
                      style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: on ? c.ink : c.line, backgroundColor: on ? c.ink : c.surface }}
                    >
                      <Text style={{ color: on ? c.bg : c.ink, fontWeight: "600" }}>{v.name}{v.rego ? ` (${v.rego})` : ""}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {error ? <Text style={st.error}>{error}</Text> : null}
          <Button title="Save trip" onPress={save} busy={busy} />
          {kind === "edit" ? <View style={{ marginTop: 10 }}><Button title="Delete trip" kind="danger" onPress={remove} /></View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
