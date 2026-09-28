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
  onAddCar: () => void;
};

const num = (v: string) => {
  const s = v.replace(/[,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const str = (n: number | null | undefined) => (n == null ? "" : String(n));
const VAGUE = /^(work|business|job|jobs|site|travel|trip|drive|driving|client|customer)$/i;

export function VehiclePicker({ vehicles, value, onChange, onAddCar }: { vehicles: Vehicle[]; value: string | null; onChange: (id: string) => void; onAddCar: () => void }) {
  const c = useColors();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: c.ink, marginBottom: 6 }}>Car</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {vehicles.map((v) => {
          const on = v.id === value;
          return (
            <Pressable
              key={v.id}
              onPress={() => onChange(v.id)}
              accessibilityState={{ selected: on }}
              style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: on ? c.ink : c.line, backgroundColor: on ? c.ink : c.surface }}
            >
              <Text style={{ color: on ? c.bg : c.ink, fontWeight: "600" }}>{v.name}{v.rego ? ` (${v.rego})` : ""}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={onAddCar} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderStyle: "dashed", borderColor: c.line }}>
          <Text style={{ color: c.muted, fontWeight: "600" }}>+ Add car</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function TripFormScreen({ uid, kind, trip, tracking, onDone, onAddCar }: Props) {
  const c = useColors();
  const st = makeStyles(c);
  const gpsKm = tracking ? round1(tracking.meters / 1000) : trip?.gps_km ?? null;
  const isGps = kind === "gps" || trip?.source === "gps";

  const [type, setType] = useState<"business" | "private">(trip?.trip_type ?? "business");
  const [date, setDate] = useState(trip?.trip_date ?? (tracking ? todayISO(new Date(tracking.startedAt)) : todayISO()));
  const [endDate, setEndDate] = useState(
    trip?.end_date && trip.end_date !== trip.trip_date ? trip.end_date : tracking?.endedAt && todayISO(new Date(tracking.endedAt)) !== todayISO(new Date(tracking.startedAt)) ? todayISO(new Date(tracking.endedAt)) : ""
  );
  const [startOdo, setStartOdo] = useState(str(trip?.start_odo ?? tracking?.start_odo));
  const [endOdo, setEndOdo] = useState(
    str(trip?.end_odo ?? (tracking?.start_odo != null && gpsKm != null ? round1(tracking.start_odo + gpsKm) : null))
  );
  const [jobNo, setJobNo] = useState(trip?.job_no ?? "");
  const [purpose, setPurpose] = useState(trip?.purpose ?? "");
  const [from, setFrom] = useState(trip?.from_text ?? "");
  const [to, setTo] = useState(trip?.to_text ?? "");
  const [vehicleId, setVehicleId] = useState<string | null>(trip?.vehicle_id ?? tracking?.vehicle_id ?? null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getVehicles().then(async (v) => {
      setVehicles(v);
      if (kind === "new") {
        // Default to the car from the last trip, then its latest odometer
        const last = (await listTrips(uid)).find((t) => t.vehicle_id && v.some((x) => x.id === t.vehicle_id));
        setVehicleId((cur) => cur ?? last?.vehicle_id ?? v[0]?.id ?? null);
      }
    });
  }, [kind, uid]);

  useEffect(() => {
    if (kind !== "new" || !vehicleId) return;
    lastOdometer(uid, vehicles.find((v) => v.id === vehicleId)).then((o) => setStartOdo(o != null ? String(o) : ""));
  }, [kind, uid, vehicleId, vehicles]);

  const s = num(startOdo), e = num(endOdo);
  const odoKm = s != null && e != null && e > s ? round1(e - s) : null;

  const save = async () => {
    setError("");
    if (!vehicleId) return setError("Choose which car the trip was in.");
    if (!isValidISO(date)) return setError("Enter the date as YYYY-MM-DD, for example " + todayISO() + ".");
    if (date > todayISO()) return setError("The date can't be in the future.");
    if (endDate && (!isValidISO(endDate) || endDate < date || endDate > todayISO())) return setError("The end date must be on or after the start date, and not in the future.");
    if (s == null || e == null) return setError("Enter the odometer at the start and end of the trip.");
    if (e <= s) return setError("The end odometer needs to be higher than the start.");
    const km = round1(e - s);
    if (km >= 3000) return setError("That's over 3,000 km. Check the odometer readings.");
    if (type === "business") {
      if (!jobNo.trim() && !purpose.trim()) return setError("Add a job number or the reason for the trip.");
      if (!jobNo.trim() && VAGUE.test(purpose.trim())) return setError(`"${purpose.trim()}" is too vague for the ATO. Add the job, client or site.`);
    }
    if (isGps && gpsKm != null && gpsKm > 1 && Math.abs(km - gpsKm) / gpsKm > 0.2) {
      const ok = await new Promise<boolean>((resolve) =>
        Alert.alert("Check the odometer", `The readings give ${fmtKm(km)} km but GPS measured ${fmtKm(gpsKm)} km. Save anyway?`, [
          { text: "Fix it", style: "cancel", onPress: () => resolve(false) },
          { text: "Save", onPress: () => resolve(true) },
        ])
      );
      if (!ok) return;
    }

    const business = type === "business";
    const row: Trip = {
      id: trip?.id ?? newTripId(),
      user_id: uid,
      vehicle_id: vehicleId,
      trip_date: date,
      end_date: endDate || date,
      trip_type: type,
      started_at: trip?.started_at ?? (tracking ? new Date(tracking.startedAt).toISOString() : null),
      ended_at: trip?.ended_at ?? (tracking?.endedAt ? new Date(tracking.endedAt).toISOString() : null),
      km,
      start_odo: s,
      end_odo: e,
      source: isGps ? "gps" : "odometer",
      gps_km: trip?.gps_km ?? (kind === "gps" ? gpsKm : null),
      from_text: from.trim() || null,
      to_text: to.trim() || null,
      job_no: business ? jobNo.trim() || null : null,
      purpose: business ? purpose.trim() || null : null,
      // Private trips never keep location
      start_lat: business ? trip?.start_lat ?? tracking?.start?.lat ?? null : null,
      start_lng: business ? trip?.start_lng ?? tracking?.start?.lng ?? null : null,
      end_lat: business ? trip?.end_lat ?? tracking?.end?.lat ?? null : null,
      end_lng: business ? trip?.end_lng ?? tracking?.end?.lng ?? null : null,
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
    Alert.alert("Delete this trip?", "It will be removed from your logbook.", [
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
          <Segmented value={type} onChange={setType} options={[{ value: "business", label: "Business" }, { value: "private", label: "Private" }]} />
          {type === "private" ? (
            <Text style={[st.muted, { marginTop: -6, marginBottom: 12 }]}>Private trips only need the odometer readings. They count toward your own logbook and aren't shared with the office.</Text>
          ) : null}

          <VehiclePicker vehicles={vehicles} value={vehicleId} onChange={setVehicleId} onAddCar={onAddCar} />

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Field label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
            <Field label="End date" value={endDate} onChangeText={setEndDate} placeholder="Same day" keyboardType="numbers-and-punctuation" />
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Field label="Start odometer" value={startOdo} onChangeText={setStartOdo} keyboardType="decimal-pad" />
            <Field label="End odometer" value={endOdo} onChangeText={setEndOdo} keyboardType="decimal-pad" />
          </View>
          <Text style={{ fontSize: 22, fontWeight: "700", color: c.ink, marginBottom: 4, minHeight: 28 }}>{odoKm != null ? `${fmtKm(odoKm)} km` : ""}</Text>
          {isGps && gpsKm != null ? (
            <Text style={[st.muted, { marginBottom: 12 }]}>GPS measured {fmtKm(gpsKm)} km. Check the end reading against the dash and correct it if needed.</Text>
          ) : <View style={{ height: 8 }} />}

          {type === "business" ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="Job number" value={jobNo} onChangeText={setJobNo} autoCapitalize="characters" />
              <View style={{ flex: 2 }}>
                <Field label="Reason for trip" value={purpose} onChangeText={setPurpose} placeholder="e.g. Switchboard upgrade, 12 Smith St" />
              </View>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Field label="From" value={from} onChangeText={setFrom} />
            <Field label="To" value={to} onChangeText={setTo} />
          </View>
          <Text style={[st.muted, { marginBottom: 14, fontSize: 13 }]}>Several trips in a row on the same day can be logged as one trip.</Text>

          {error ? <Text style={st.error}>{error}</Text> : null}
          <Button title="Save trip" onPress={save} busy={busy} />
          {kind === "edit" ? <View style={{ marginTop: 10 }}><Button title="Delete trip" kind="danger" onPress={remove} /></View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
