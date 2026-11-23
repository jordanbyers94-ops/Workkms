// Automatic drive detection and the CarPlay screen.
//
// How detection works (battery friendly):
//  1. While parked, the phone only watches a 150 m circle around where the car stopped (geofence).
//  2. Leaving the circle (or plugging into CarPlay) starts GPS tracking.
//  3. Parked for 5 minutes (or CarPlay unplugged) ends the drive. It goes into "Trips to sort" on the
//     phone, and a new circle is set where the car stopped.
// Trips to sort stay on the phone until the tech marks them Business or Private.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { getCachedProfile, getToken } from "./api";
import { CarPlayAction, listenCarPlay, publishCarPlay } from "./carplay";
import { duration, fmtKm, round1, todayISO } from "./dates";
import { Decision, GEOFENCE_RADIUS_M, keepTrip } from "./drive";
import {
  discardTracking,
  ensureAlwaysPermission,
  getTracking,
  hasAlwaysPermission,
  setTracking,
  setTrackingHooks,
  startAutoTracking,
  stopUpdates,
  Tracking,
} from "./tracking";
import { addToSort, AutoTrip, cachedVehicles, getToSort, lastOdometer, listTrips, newTripId, removeToSort, saveTrip, setToSort, Trip } from "./trips";

export const GEOFENCE_TASK = "work-kms-geofence";
const SETTINGS_KEY = "auto:settings:v1";

export type AutoSettings = { enabled: boolean; vehicle_id: string | null };

export async function getAutoSettings(): Promise<AutoSettings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    return raw ? { enabled: false, vehicle_id: null, ...JSON.parse(raw) } : { enabled: false, vehicle_id: null };
  } catch {
    return { enabled: false, vehicle_id: null };
  }
}
async function saveAutoSettings(s: AutoSettings) {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

async function signedInUid(): Promise<string | null> {
  const [token, profile] = await Promise.all([getToken(), getCachedProfile()]);
  return token && profile ? profile.id : null;
}

/** The car auto trips go against: the one chosen in settings, else the last one used, else the first. */
async function defaultVehicleId(uid: string): Promise<string | null> {
  const cars = await cachedVehicles();
  const s = await getAutoSettings();
  if (s.vehicle_id && cars.some((c) => c.id === s.vehicle_id)) return s.vehicle_id;
  const last = (await listTrips(uid)).find((t) => t.vehicle_id && cars.some((c) => c.id === t.vehicle_id));
  return last?.vehicle_id ?? cars[0]?.id ?? null;
}

// ---------- Geofence: notice when the car leaves where it was parked ----------

async function armGeofence(at: { lat: number; lng: number }) {
  try {
    await Location.startGeofencingAsync(GEOFENCE_TASK, [
      { identifier: "last-stop", latitude: at.lat, longitude: at.lng, radius: GEOFENCE_RADIUS_M, notifyOnEnter: false, notifyOnExit: true },
    ]);
  } catch {
    // Location is off or not allowed; the app still works manually
  }
}

async function armGeofenceHere() {
  try {
    const pos =
      (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 200 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    if (pos) await armGeofence({ lat: pos.coords.latitude, lng: pos.coords.longitude });
  } catch {
    // try again next time the app opens
  }
}

async function disarmGeofence() {
  try {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  } catch {
    // nothing to stop
  }
}

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) return;
  const { eventType, region } = (data ?? {}) as { eventType?: Location.GeofencingEventType; region?: Location.LocationRegion };
  if (eventType !== Location.GeofencingEventType.Exit || !region) return;
  await startAutoTrip("auto", { lat: region.latitude, lng: region.longitude });
});

// ---------- Starting and ending automatic trips ----------

export async function startAutoTrip(via: "auto" | "carplay", from?: { lat: number; lng: number }) {
  const uid = await signedInUid();
  if (!uid) return false;
  const settings = await getAutoSettings();
  if (via === "auto" && !settings.enabled) return false;
  const current = await getTracking();
  if (current?.status === "tracking") return false;
  const vehicle_id = await defaultVehicleId(uid);
  if (!vehicle_id) return false;
  await disarmGeofence();
  const ok = await startAutoTracking({ vehicle_id, via, from });
  await refreshCarPlay();
  return ok;
}

/** Turn a finished drive into a trip to sort. Works for manual GPS trips finished from CarPlay too. */
async function moveToSort(t: Tracking, endedAt: number): Promise<AutoTrip | null> {
  const uid = await signedInUid();
  if (!uid || !t.vehicle_id) return null;
  const meters = t.meters;
  const fromCarPlay = t.via === "carplay" || t.via === "manual";
  if (t.auto && !keepTrip(meters, t.maxSpeed ?? 0, fromCarPlay)) return null;
  const km = round1(meters / 1000);
  // A manual GPS trip has a real start reading. Auto trips carry on from the car's last reading.
  const cars = await cachedVehicles();
  const start = t.start_odo ?? (await lastOdometer(uid, cars.find((c) => c.id === t.vehicle_id)));
  const trip: AutoTrip = {
    id: newTripId(),
    startedAt: t.startedAt,
    endedAt,
    meters,
    vehicle_id: t.vehicle_id,
    start_odo: start,
    end_odo: start != null ? round1(start + km) : null,
    odo_estimated: t.start_odo == null,
    start: t.start,
    end: t.moveAnchor ? { lat: t.moveAnchor.lat, lng: t.moveAnchor.lng } : t.last ? { lat: t.last.lat, lng: t.last.lng } : t.end,
    via: t.via ?? "auto",
  };
  await addToSort(uid, trip);
  return trip;
}

/** End whatever trip is running and put it in Trips to sort, then watch for the next drive. */
export async function endTripToSort(endedAt = Date.now()) {
  const t = await getTracking();
  if (!t) return;
  await stopUpdates();
  await setTracking(null);
  const trip = t.status === "tracking" || t.status === "done" ? await moveToSort(t, t.endedAt ?? endedAt) : null;
  const where = trip?.end ?? (t.last ? { lat: t.last.lat, lng: t.last.lng } : null);
  if ((await getAutoSettings()).enabled) {
    if (where) await armGeofence(where);
    else await armGeofenceHere();
  }
  await refreshCarPlay();
}

async function onDecision(d: Decision) {
  if (d.action === "end") return endTripToSort(d.endedAt);
  if (d.action === "cancel") {
    // It was a walk, not a drive
    const t = await getTracking();
    await discardTracking();
    if ((await getAutoSettings()).enabled) {
      if (t?.last) await armGeofence({ lat: t.last.lat, lng: t.last.lng });
      else await armGeofenceHere();
    }
    await refreshCarPlay();
  }
}

// ---------- Settings ----------

export async function enableAuto(vehicle_id: string | null) {
  await ensureAlwaysPermission();
  await saveAutoSettings({ enabled: true, vehicle_id });
  const t = await getTracking();
  if (t?.status !== "tracking") await armGeofenceHere();
  await refreshCarPlay();
}

export async function setAutoVehicle(vehicle_id: string | null) {
  await saveAutoSettings({ ...(await getAutoSettings()), vehicle_id });
}

export async function disableAuto() {
  await saveAutoSettings({ ...(await getAutoSettings()), enabled: false });
  await disarmGeofence();
  const t = await getTracking();
  if (t?.status === "tracking" && t.auto && t.via === "auto") await endTripToSort();
  await refreshCarPlay();
}

/** Signing out stops everything. */
export async function stopAllAuto() {
  await saveAutoSettings({ enabled: false, vehicle_id: null });
  await disarmGeofence();
  await discardTracking();
  publishCarPlay({ signedIn: false, autoOn: false, tracking: null, toSort: [] });
}

/** When the app opens: make sure the watch is armed and catch any drive that ended while closed. */
export async function autoHousekeeping() {
  const s = await getAutoSettings();
  const t = await getTracking();
  if (s.enabled && (await hasAlwaysPermission()) && t?.status !== "tracking" && !(await Location.hasStartedGeofencingAsync(GEOFENCE_TASK).catch(() => false))) {
    await armGeofenceHere();
  }
  await refreshCarPlay();
}

// ---------- Sorting ----------

export function toTrip(uid: string, a: AutoTrip, type: "business" | "private", extra: Partial<Trip> = {}): Trip {
  const business = type === "business";
  const date = todayISO(new Date(a.startedAt));
  const end = todayISO(new Date(a.endedAt));
  return {
    id: a.id,
    user_id: uid,
    vehicle_id: a.vehicle_id,
    trip_date: date,
    end_date: end,
    trip_type: type,
    started_at: new Date(a.startedAt).toISOString(),
    ended_at: new Date(a.endedAt).toISOString(),
    km: a.start_odo != null && a.end_odo != null ? round1(a.end_odo - a.start_odo) : round1(a.meters / 1000),
    start_odo: a.start_odo,
    end_odo: a.end_odo,
    source: "gps",
    gps_km: round1(a.meters / 1000),
    from_text: null,
    to_text: null,
    job_no: null,
    purpose: null,
    // Private trips never keep location
    start_lat: business ? a.start?.lat ?? null : null,
    start_lng: business ? a.start?.lng ?? null : null,
    end_lat: business ? a.end?.lat ?? null : null,
    end_lng: business ? a.end?.lng ?? null : null,
    deleted: false,
    auto_detected: a.via !== "manual",
    odo_estimated: a.odo_estimated,
    ...extra,
  };
}

export async function sortAsPrivate(uid: string, a: AutoTrip) {
  if (a.start_odo == null) throw new Error("Add an odometer check for this car first, so the trip has odometer readings.");
  await saveTrip(uid, toTrip(uid, a, "private"));
  await removeToSort(uid, a.id, false);
  await refreshCarPlay();
}

export async function discardToSort(uid: string, a: AutoTrip) {
  await removeToSort(uid, a.id, true);
  await refreshCarPlay();
}

/** Business trips still need a job or reason, so CarPlay only marks them for later. */
async function tagForLater(uid: string, id: string, tag: "business" | "private") {
  const list = await getToSort(uid);
  await setToSort(uid, list.map((a) => (a.id === id ? { ...a, tag } : a)));
}

// ---------- CarPlay ----------

let lastPublish = 0;
export async function refreshCarPlay() {
  const uid = await signedInUid();
  if (!uid) return publishCarPlay({ signedIn: false, autoOn: false, tracking: null, toSort: [] });
  const [t, list, s] = await Promise.all([getTracking(), getToSort(uid), getAutoSettings()]);
  lastPublish = Date.now();
  publishCarPlay({
    signedIn: true,
    autoOn: s.enabled,
    tracking: t?.status === "tracking" ? { km: round1(t.meters / 1000), minutes: Math.floor((Date.now() - t.startedAt) / 60000), auto: !!t.auto } : null,
    toSort: list
      .slice()
      .reverse()
      .slice(0, 12)
      .map((a) => {
        const d = new Date(a.startedAt);
        const when = `${d.toLocaleDateString("en-AU", { weekday: "short" })} ${d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}`;
        return {
          id: a.id,
          title: `${when}, ${fmtKm(a.meters / 1000)} km`,
          detail: a.tag === "business" ? "Business: add the job on your phone" : duration(a.endedAt - a.startedAt),
          tag: a.tag ?? null,
        };
      }),
  });
}

async function onCarPlayAction(a: CarPlayAction) {
  const uid = await signedInUid();
  if (!uid) return;
  const t = await getTracking();
  switch (a.type) {
    case "connected":
      // Plugging into the car is a sure sign of a drive
      if ((await getAutoSettings()).enabled && t?.status !== "tracking") await startAutoTrip("carplay");
      break;
    case "disconnected":
      if (t?.status === "tracking" && t.auto) await endTripToSort();
      break;
    case "start":
      if (t?.status !== "tracking") await startAutoTrip("carplay");
      break;
    case "finish":
      if (t?.status === "tracking") await endTripToSort();
      break;
    case "tag": {
      const trip = (await getToSort(uid)).find((x) => x.id === a.id);
      if (!trip) break;
      if (a.as === "private" && trip.start_odo != null) await sortAsPrivate(uid, trip);
      else await tagForLater(uid, a.id, a.as);
      break;
    }
  }
  await refreshCarPlay();
}

setTrackingHooks({
  onDecision,
  onChange: async () => {
    // Keep the car screen's km figure fresh without hammering it
    if (Date.now() - lastPublish > 4000) await refreshCarPlay();
  },
});
listenCarPlay(onCarPlayAction);
