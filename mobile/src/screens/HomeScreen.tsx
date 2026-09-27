import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AppState, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, makeStyles } from "../components/ui";
import { duration, fmtKm, fyLabel, fyOf, parseISO, round1, todayISO, weekStartISO } from "../lib/dates";
import { Profile } from "../lib/api";
import { discardTracking, finishTracking, getTracking, PermissionError, resumeIfNeeded, startTracking, Tracking } from "../lib/tracking";
import { listTrips, sync, SyncResult, Trip } from "../lib/trips";
import { useColors } from "../theme";

type Props = {
  profile: Profile;
  onLog: () => void;
  onSaveGps: (t: Tracking) => void;
  onEdit: (trip: Trip) => void;
  onSignOut: () => void;
};

export default function HomeScreen({ profile, onLog, onSaveGps, onEdit, onSignOut }: Props) {
  const c = useColors();
  const st = makeStyles(c);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [syncState, setSyncState] = useState<SyncResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  const loadLocal = useCallback(async () => {
    setTrips(await listTrips(profile.id));
    setTracking(await getTracking());
  }, [profile.id]);

  const doSync = useCallback(async () => {
    const r = await sync(profile.id).catch(() => ({ ok: false, pending: 0, message: "Couldn't reach the server." }));
    setSyncState(r);
    await loadLocal();
  }, [profile.id, loadLocal]);

  useEffect(() => {
    loadLocal();
    doSync();
    resumeIfNeeded().catch(() => {});
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") { loadLocal(); doSync(); } });
    return () => sub.remove();
  }, [loadLocal, doSync]);

  // Refresh the live GPS figure every 2 seconds while a trip is running.
  useEffect(() => {
    if (tracking?.status !== "tracking") return;
    const id = setInterval(async () => { setTracking(await getTracking()); tick((n) => n + 1); }, 2000);
    return () => clearInterval(id);
  }, [tracking?.status]);

  const fy = fyOf(todayISO());
  const stats = useMemo(() => {
    const thisFy = trips.filter((t) => fyOf(t.trip_date) === fy);
    const ws = weekStartISO();
    const sum = (l: Trip[]) => round1(l.reduce((s, t) => s + Number(t.km), 0));
    return { fy: sum(thisFy), week: sum(thisFy.filter((t) => t.trip_date >= ws)), count: thisFy.length };
  }, [trips, fy]);

  const start = async () => {
    setBusy(true);
    try {
      await startTracking();
      setTracking(await getTracking());
    } catch (e) {
      Alert.alert("Can't start GPS", e instanceof PermissionError ? e.message : "Something went wrong starting GPS. Try again, or log the trip manually.");
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    setBusy(true);
    const t = await finishTracking();
    setBusy(false);
    if (t) onSaveGps(t);
  };
  const discard = () =>
    Alert.alert("Discard this GPS trip?", "The distance measured so far won't be saved.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: async () => { await discardTracking(); setTracking(null); } },
    ]);

  const syncText = !syncState ? "Syncing…"
    : syncState.ok && !syncState.pending ? "All trips uploaded"
    : syncState.pending ? `${syncState.pending} trip${syncState.pending === 1 ? "" : "s"} waiting to upload`
    : syncState.message ?? "Couldn't sync";

  const header = (
    <View style={{ paddingHorizontal: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <View>
          <Text style={st.h1}>Work kms</Text>
          <Text style={st.muted}>{profile.full_name}</Text>
        </View>
        <Pressable onPress={onSignOut} hitSlop={10}><Text style={[st.muted, { fontWeight: "600" }]}>Sign out</Text></Pressable>
      </View>

      <View style={{ backgroundColor: c.ink, borderRadius: 16, padding: 16, marginTop: 16 }}>
        <Text style={{ color: c.bg, opacity: 0.7, fontSize: 14 }}>{fyLabel(fy)}</Text>
        <Text style={{ color: c.bg, fontSize: 44, fontWeight: "800", fontVariant: ["tabular-nums"] }}>
          {fmtKm(stats.fy)} <Text style={{ fontSize: 20, color: c.hivis }}>km</Text>
        </Text>
        <Text style={{ color: c.bg, opacity: 0.7 }}>{fmtKm(stats.week)} km this week, {stats.count} trips this year</Text>
      </View>

      <Pressable onPress={doSync}>
        <Text style={[st.muted, { marginTop: 8, marginLeft: 2 }]}>{syncText}</Text>
      </Pressable>

      {tracking ? (
        <View style={{ marginTop: 14, borderRadius: 16, borderWidth: 2, borderColor: c.hivis, backgroundColor: c.surface, padding: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tracking.status === "tracking" && tracking.lastFixAt ? c.ok : c.muted }} />
            <Text style={{ fontWeight: "700", color: c.ink }}>{tracking.status === "tracking" ? "Tracking with GPS" : "GPS trip ready to save"}</Text>
          </View>
          <Text style={{ fontSize: 52, fontWeight: "800", color: c.ink, marginTop: 6, fontVariant: ["tabular-nums"] }}>
            {fmtKm(tracking.meters / 1000)} <Text style={{ fontSize: 22, color: c.muted }}>km</Text>
          </Text>
          <Text style={st.muted}>
            {duration((tracking.endedAt ?? Date.now()) - tracking.startedAt)}
            {tracking.status === "tracking"
              ? tracking.lastFixAt ? `, accurate to about ${tracking.accuracy} m` : ", waiting for a GPS signal"
              : " drive. Add the job details and save it."}
          </Text>
          {tracking.status === "tracking" ? (
            <Text style={[st.muted, { marginTop: 8 }]}>You can lock your phone or use other apps. Tracking keeps going until you finish.</Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 14, alignItems: "center" }}>
            <Button title="Discard" kind="danger" onPress={discard} />
            <View style={{ flex: 1 }}>
              {tracking.status === "tracking"
                ? <Button title="Finish trip" onPress={finish} busy={busy} />
                : <Button title="Save trip" onPress={() => onSaveGps(tracking)} />}
            </View>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
          <View style={{ flex: 1 }}><Button title="Log manually" kind="dark" onPress={onLog} /></View>
          <View style={{ flex: 1 }}><Button title="Start GPS trip" onPress={start} busy={busy} /></View>
        </View>
      )}

      <Text style={[st.h2, { marginTop: 24, marginBottom: 8 }]}>Recent trips</Text>
    </View>
  );

  return (
    <SafeAreaView style={st.screen} edges={["top", "left", "right"]}>
      <FlatList
        data={trips.slice(0, 200)}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await doSync(); setRefreshing(false); }} />}
        ListEmptyComponent={<Text style={[st.muted, { paddingHorizontal: 18 }]}>No trips yet. Start a GPS trip or log one manually.</Text>}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item: t }) => {
          const d = parseISO(t.trip_date);
          const title = t.purpose || t.job_no || [t.from_text, t.to_text].filter(Boolean).join(" to ") || "Work trip";
          const sub = [t.job_no && t.purpose ? `Job ${t.job_no}` : "", t.to_text, t.source === "gps" ? "GPS" : t.source === "odometer" ? "Odometer" : ""]
            .filter(Boolean).join(", ");
          return (
            <Pressable onPress={() => onEdit(t)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderColor: c.line, opacity: pressed ? 0.6 : 1 }]}>
              <View style={{ width: 40, alignItems: "center" }}>
                <Text style={[st.muted, { fontSize: 12 }]}>{d.toLocaleDateString("en-AU", { weekday: "short" })}</Text>
                <Text style={{ fontSize: 20, fontWeight: "700", color: c.ink }}>{d.getDate()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontWeight: "600", color: c.ink }}>{title}</Text>
                {sub ? <Text numberOfLines={1} style={[st.muted, { fontSize: 13 }]}>{sub}</Text> : null}
              </View>
              <Text style={{ fontSize: 18, fontWeight: "700", color: c.ink }}>{fmtKm(Number(t.km))} <Text style={[st.muted, { fontSize: 13 }]}>km</Text></Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}
